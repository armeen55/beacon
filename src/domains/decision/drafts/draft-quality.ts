/** draft-quality: the PURE, deterministic trust gate over an atomic rewrite. It answers one question about the words a customer would paste: are they safe to offer, do they owe a look first, or do they earn nothing at all. No LLM at runtime, no I/O, just the fields the caller supplies. REJECT (hide the copy) is NARROW and high confidence: the rewrite drops the words the page is about, it introduces boilerplate spam, it introduces a ranking word the line it replaces does not already carry, or a number or named thing in it is grounded nowhere. `useful_but_needs_review` is BROAD: a real factual claim stays COPYABLE and flagged, because auto-rejecting them killed good output. The rules: - RELEVANCE: a rewrite that no longer names what the page is about orphans the page. - SUPERLATIVE: a ranking word the replaced line already carries is the page own claim and is kept; every wider one is refused. - COUNT: a count the page own captured words do not carry is confirmed before publishing, never blocked. - FACTUAL ENTAILMENT: numbers, dates, named entities and superlatives must be traceable to the page own stored body, the evidence text, or the query; a violation is `unverified_claim` and blocks the copy, while a contradiction a dated authoritative fact backs is an allowed CORRECTION that rides along. - `missing_source`: a NEW specific fact the page does not state and no admitted reading carries is held until a source is on file. A SECOND door once lived here, `evaluateDraftQuality`, an answer-block gate with an 80 to 150 word band: it had no production caller, and asked of all 56 stored body drafts on 2026-09-05 its band refused every one of them, including all six finished changes, because a Smallest-Complete-Treatment answer is one sentence under a heading. Its other rules fired on nothing at all (page talk 0, punt 0, dictionary opening 0, relevance 0, superlative 0) and its one pronoun-opener refusal was a row the live doors already refused, so it was deleted whole rather than wired. Four statuses in the union above are now written by nothing and are kept because the store still reads them off rows judged before this. */
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import { hasQualifyingAuthoritativeSource, type ClassifiableSource } from "@/domains/decision/drafts/source-authority";

export type DraftQualityStatus =
  | "ready"
  | "useful_but_needs_review"
  | "generic_rejected"
  | "relevance_rejected"
  | "fact_risk"
  | "unsupported_claim"
  | "too_thin"
  | "malformed"
  | "missing_source"
  | "needs_source_check"
  | "stale_data_changed"
  | "not_quotable"
  | "unverified_claim";

export type DraftQualityResult = {
  status: DraftQualityStatus;
  reasons: string[];
  /** Safe to surface a one-click copy/paste button. Only ready + needs-review. */
  copyAllowed: boolean;
  /** Re-drafting this is likely to help (generic/thin/off-topic/malformed). */
  canRegenerate: boolean;
  confidence: "high" | "medium" | "low";
  /** N8 (2026-07-02, operator correction): plain-English lines for claims that CONTRADICT the target page's own text but are backed by a dated, authoritative source (a stale page being corrected, not an invention). Present only when the factual-entailment check ran AND found at least one correction; absent otherwise (never an empty array vs. "not checked" ambiguity - callers test for `undefined`). A draft can be "ready" AND carry corrections at the same time - corrections never block copy/publish, they are shown alongside it so the operator sees what changed and why. */
  corrections?: string[];
};

// ── shared vocabulary + helpers ───────────────────────────────────────────────

/** NO default vocabulary. A hardcoded vertical list here silently rejected every
 *  shallow draft for any account outside that vertical ("drops the page's core
 *  entity"), which is the founder-config leak in its purest form. Callers pass the
 *  candidate's OWN words; an empty list means the entity check cannot run and must
 *  not fabricate a verdict. */
const DEFAULT_CONTEXT_TOKENS: string[] = [];

/** Any non-Latin script carries its own subject words; token containment cannot judge it. */
const NON_LATIN_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/** With no vocabulary from the caller there is nothing to check against, so the
 *  gate passes rather than inventing a verdict about words it was never given. */
function hasContext(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  if (NON_LATIN_SCRIPT.test(text)) return true;
  const lower = text.toLowerCase();
  return tokens.some((t) => lower.includes(t.toLowerCase()));
}

/** STRONG marketing superlatives (narrow on purpose, descriptive "official flag" is NOT flagged; only unsupported promotional claims). */
const STRONG_SUPERLATIVE =
  /\b(?:the best|the only|#1|number one|world'?s (?:best|largest|oldest|first|leading)|the (?:greatest|finest) \w+ (?:ever|of all time))\b/i;

/** Title/meta boilerplate spam. */
const TITLE_BOILERPLATE =
  /\(\s*20\d{2}\s+guide\s*\)|\b(?:complete|ultimate|definitive|essential)\s+guide\b|\beverything you need to know\b/i;

/** A specific count introduced in a title ("150+", "Top 50"), flag for verification. */
const COUNT_CLAIM = /\b\d{2,}\s*\+|\btop\s+\d+\b/i;

/** A concrete date/count/"official"/"national X" claim, the narrow factual signal this file has used since the first draft audit: the "did this rewrite introduce a NEW specific fact" trigger for every atomic edit (see evaluateTitleMetaQuality), so a rewrite that only rephrases the SAME fact is never source-gated. */
// W5 P2 (2026-07-09): the count clause counts Persian (U+06F0-U+06F9) and Arabic-Indic (U+0660-U+0669) digits too, so a claim written in a non-Latin
// numeral system ("۳۰۰۰ years") is still recognized as a specific fact and source-gated the same as "3000 years" (the leading \b is dropped only on
// that clause because a word boundary is ill-defined next to a non-ASCII digit; the year and phrase clauses keep theirs).
const SPECIFIC_FACT =
  /\b(?:18|19|20)\d{2}\b|[\d٠-٩۰-۹]+\s*(?:times|years|km|km2|species|provinces|dynasties)\b|\bofficial\b|\bnational (?:animal|flag|symbol|language|bird)\b/i;

// ── title / meta (atomic edit) quality ────────────────────────────────────────

type EvaluateTitleInput = {
  before?: string | null;
  after: string | null | undefined;
  field?: "title" | "meta" | string;
  query?: string | null;
  contextTokens?: string[];
  /** N8: the opt-in factual-entailment inputs; supplying either turns the entailment check below ON. */
  pageBodyText?: string | null;
  evidenceText?: string | null;
  authoritativeFacts?: readonly AuthoritativeFact[];
  /** W5 (J-69): the draft's own cited sources, authority ALWAYS re-derived here through source-authority.ts and never trusted off the source's own field. Consulted only when the rewrite introduces a NEW specific fact `before` did not carry (the narrow SPECIFIC_FACT check below); a pure rephrase never reaches it. */
  sources?: readonly ClassifiableSource[];
  authoritativeSourceDomains?: readonly string[]; /** THE ROW'S OWN CHECKED SUPPORT, PAIRED WITH THE CLAIM THAT STANDS ON IT: one entry per (claim, cited fact id), carrying the claim's own words beside the admitted reading's, because the support that answers for an assertion is the support that assertion cites and never the row's other readings. Absent means the caller holds no record, and the rule below then asks exactly what it asked before this field existed. */ citedSupport?: readonly { id: string; claim: string; fact: string }[];
};

/** Evaluate an atomic title/meta rewrite. */
export function evaluateTitleMetaQuality(input: EvaluateTitleInput): DraftQualityResult {
  const after = (input.after ?? "").trim();
  const before = (input.before ?? "").trim();
  const tokens = input.contextTokens ?? DEFAULT_CONTEXT_TOKENS;

  if (!after) {
    return { status: "malformed", reasons: ["No rewritten value."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (before && after.toLowerCase() === before.toLowerCase()) {
    return { status: "too_thin", reasons: ["Rewrite is identical to the current value."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  // Entity dropped: the rewrite no longer names the topic → orphans the page.
  if (!hasContext(after, tokens)) {
    return {
      status: "relevance_rejected",
      reasons: ["Rewrite drops the words this page is actually about."],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "medium",
    };
  }
  // Boilerplate NEWLY introduced (removing it is an improvement, not a flag).
  if (TITLE_BOILERPLATE.test(after) && !TITLE_BOILERPLATE.test(before)) {
    return {
      status: "generic_rejected",
      reasons: ["Introduces boilerplate spam (“Complete Guide” / “(YYYY Guide)”)."],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "high",
    };
  }
  if (STRONG_SUPERLATIVE.test(after) && !STRONG_SUPERLATIVE.test(before)) { // A RANKING WORD THE REPLACED WORDS ALREADY CARRY IS THE PAGE'S OWN, NOT THE WRITER'S CLAIM (live 11:30Z, 2026-09-05). /cuisine's stored passage says "the best Persian food", the writer was ordered four times to keep everything true that passage says and once never to write "the best", and six provider calls bought two identical refusals. A REPLACEMENT may keep the exact ranking word the line it replaces already carries; an addition replaces nothing, so its `before` is empty and every ranking word is still refused here, exactly as before.
    return { status: "unsupported_claim", reasons: ["Title makes an unsupported superlative claim."], copyAllowed: false, canRegenerate: true, confidence: "medium" };
  }
  /* A COUNT THE PAGE'S OWN CAPTURED WORDS ALREADY CARRY IS DELIVERED, NOT "TO CONFIRM" (probe, 2026-09-05). /iran-animals/green-sea-turtle stood held on a description saying "80+ year lifespan" while the page's own stored body says "Average Lifespan: 80+ years", so the canon asked a person to check a figure it had been handed. The packet is read first, exactly as the SPECIFIC_FACT rule below already reads it: every count in the line must appear as its own number in the page text or the banked evidence, matched on the digits so "80+", "80 plus" and "Top 50" against "50 entries" all count as delivered. A count nothing on file carries still asks. */ const packet = `${input.pageBodyText ?? ""} ${input.evidenceText ?? ""}`.replace(/\s+/g, " "), counts = after.match(new RegExp(COUNT_CLAIM.source, "gi")) ?? [], delivered = counts.length > 0 && counts.every((c) => { const d = /\d+/.exec(c)?.[0] ?? ""; return d !== "" && new RegExp(`(?<!\\d)${d}(?!\\d)`).test(packet); });
  if (COUNT_CLAIM.test(after) && !COUNT_CLAIM.test(before) && !delivered) {
    return {
      status: "useful_but_needs_review",
      reasons: ["Introduces a count (150+, Top 50) that this page's captured words do not carry, so confirm the page delivers it before publishing."],
      copyAllowed: true,
      canRegenerate: false,
      confidence: "medium",
    };
  }

  // Factual entailment (N8, law 3; operator correction 2026-07-02), opt-in on the fields the caller supplies: a claim contradicting the page but backed by a dated authoritative fact is an allowed correction, never a violation.
  let entailmentCorrections: string[] | undefined;
  if (input.pageBodyText || input.evidenceText || input.authoritativeFacts?.length) {
    const entailment = checkFactualEntailment({
      draftText: after,
      pageBodyText: input.pageBodyText,
      evidenceText: input.evidenceText,
      query: input.query ?? null,
      authoritativeFacts: input.authoritativeFacts,
    });
    if (!entailment.entailed) {
      return {
        status: "unverified_claim",
        reasons: entailment.violations,
        copyAllowed: false,
        canRegenerate: true,
        confidence: "high",
      };
    }
    if (entailment.corrections.length > 0) entailmentCorrections = entailment.corrections;
  }

  // J-69 (no exceptions): a rewrite that introduces a NEW specific fact (a date/count/"official"/"national X" that `before` did NOT already carry) needs an authoritative source before it is paste-ready. A pure rephrase, the same facts as before, just reworded, asserts nothing new and is never held up on this; that mirrors the COUNT_CLAIM check above and uses the same narrow SPECIFIC_FACT signal. AND A FACT THE PAGE ITSELF CARRIES IS NOT NEW IN A BODY FIELD EITHER (live 19:08 on /jersey-evolution): the exemption was written for meta, title and h1 alone, so a section listing 1978, 1998, 2006, 2014, 2018 and 2022, which are the page's own section headings and exactly the words the writer is told it may restate, was held for introducing six new facts, while `before` is empty for a new section so every one of them read as new. What is new is what the PAGE does not say, whatever field says it. A FIELD SUMMARISES THE PAGE, SO ITS FACTS COME FROM THE PAGE. Comparing only against the line being replaced makes any figure a "new" fact the moment a generic description is improved: /iran-animals/asiatic-cheetah was held for "a new fact with no cited authoritative source" over "Iran's national animal is the Asiatic cheetah", a sentence its own stored page carries word for word. What is new is what the PAGE does not say. Only the matched fact is looked for, never every word of the line, because requiring the whole sentence verbatim refuses ordinary paraphrase around a fact the page does carry. A fact the page never states still needs one. A PAGE ASSERTING A THING ABOUT THE WORLD IS NOT EVIDENCE THE THING IS TRUE. Summarising the page is a description's whole job so its facts may come from the page, but "Iran's national animal is the Asiatic cheetah" is a claim about a COUNTRY and iranopedia.com saying it does not make it so. Authoritative sources confirm the cheetah is critically endangered and survives only in Iran; they do not establish the national-animal claim. A symbol or officialness claim is never carried by the page alone and owes a real source; an ordinary page fact still is.
  /* AUTHORITY IS DECIDED ONCE, AT THE CONSUMER THAT ADMITTED THE READING (live 07:01Z, /iran-flags/pahlavi-iran-flag). The first substantive body answer the ordinary paid walk ever drafted under the proportional bar was refused here for "no cited authoritative source" while its own claim cited fact-1, a checked publisher sentence banked on the row and admitted by `authorizedCorrections`, because this rule read the account's trusted-domain list and the proposal's source pack and never the row's own checked support. A claim whose supportedBy names a fact id present in the row's supportFacts IS a cited authoritative source here, and an admitted reading is evidence about the world in the way a page asserting a thing about the world never is, so it answers a symbol or officialness claim too. */ const flat = (t: string): string => t.replace(/\s+/g, " ").toLowerCase(), pageWords = flat(input.pageBodyText ?? "");
  const owedFacts = (t: string): string[] => (t.match(new RegExp(SPECIFIC_FACT.source, "gi")) ?? []).filter((f) => { const needle = flat(f); /* AND THE RULE FIRES FOR THE SPECIFIC FACT NO ADMITTED SUPPORT CARRIES, never for the whole line: asked of the sentence, one unbacked figure beside five the page itself states refused all six and briefed a redraft to go and source words it had lifted off the page. AND THE SUPPORT THAT ANSWERS FOR A FIGURE IS THE SUPPORT ITS OWN CLAIM CITES (reviewer, round five): matched against every admitted reading on the row joined together, a claim standing on a reading that says only that the animals are grey was licensed to assert a count because a DIFFERENT claim's reading happened to mention that year, so a claim with no support of its own passed on a sibling's. The asserting claim has to carry the figure and the reading that claim cites has to carry it too. */
    return !(input.citedSupport ?? []).some((s) => flat(s.claim).includes(needle) && flat(s.fact).includes(needle)) && (pageWords.length === 0 || !pageWords.includes(needle) || /\bnational (?:animal|flag|symbol|language|bird)\b|\bofficial\b/i.test(f)); });
  const owed = SPECIFIC_FACT.test(after) && !SPECIFIC_FACT.test(before) ? owedFacts(after) : [];
  if (owed.length > 0 && !hasQualifyingAuthoritativeSource(after, input.sources, input.authoritativeSourceDomains)) {
    return {
      status: "missing_source",
      reasons: [`Introduces a new fact with no cited authoritative source yet ("${owed[0]}"). Add one before this is paste-ready.`],
      copyAllowed: false,
      canRegenerate: false,
      confidence: "medium",
    };
  }

  return {
    status: "ready",
    reasons: ["Entity-forward rewrite, no boilerplate or unsupported claim."],
    copyAllowed: true,
    canRegenerate: false,
    confidence: "high",
    ...(entailmentCorrections ? { corrections: entailmentCorrections } : {}),
  };
}
