/** draft-quality: a PURE, deterministic trust gate over prepared output. It answers one question per draft: "is this good enough to copy and paste, does it need a human review first, or is it junk we should not call ready?" No LLM at runtime, no I/O, just the parsed draft fields. REJECT (hide the copy) is NARROW and high confidence: generic dictionary openings, punt or meta non-answers, off topic, no draft, too thin, malformed, strong marketing superlatives. `useful_but_needs_review` is BROAD: real factual claims stay COPYABLE and flagged for a human check, because auto-rejecting them killed good output. The generic-opening rule fires ONLY when the FIRST sentence is a dictionary frame AND carries no content-context token, which separates "A gift is a voluntarily transferred item" from "An Iranian wedding comprises". The other four rules this file composes: - QUOTABILITY: an answer block that fails the shared passage-answerability rubric is rejected like a generic or thin draft, with a plain-English fix instead of a lint label. - FACTUAL ENTAILMENT: numbers, dates, named entities and superlatives must be backed by the page's own stored body, the evidence text, or the query. Opt-in on the fields the caller supplies; a violation downgrades to `unverified_claim` and blocks the copy. - AN ANSWER-BLOCK WORD BAND of 80 to 150 words: under is `too_thin`, over is `not_quotable`, because it no longer reads as one liftable answer. - `missing_source`: a FACTUAL draft with zero authoritative sources overlapping its own claim tokens is held, copy blocked, and NOT regeneratable, because redrafting cannot invent authority and the honest fix is "add a source". Formatting and technical kinds are never source-gated. A source check runs only where the account configured one, and a miss downgrades rather than blocks. */
import { checkPassageRules } from "@/domains/evidence/pages/passage-answerability";
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import {
  hasQualifyingAuthoritativeSource,
  draftFactsCoveredBySources,
  classifySourceAuthority,
  extractDomain,
  type ClassifiableSource,
} from "@/domains/decision/drafts/source-authority";

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

function firstSentence(text: string): string {
  const parts = text.trim().split(/(?<=[.!?])\s+/);
  return parts[0] ?? text.trim();
}

export function wordCount(text: string): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Trim one uncovered claim sentence to a readable length for an operator-facing
 *  reason (so the "needs a source" line names WHICH claim, not just "a claim"). */
function shortClaim(text: string, max = 120): string {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "A/An/The <noun> is/are …" or "<X> refers to …", a context-free dictionary frame. */
const DICTIONARY_FRAME = /^\s*(?:a|an|the)\s+[a-z][\w-]*\s+(?:is|are)\b|\brefers?\s+to\b/i;

/** A draft that talks ABOUT the page/source instead of answering (meta non-answer). */
const META_NONANSWER =
  /\bthe\s+\w+\s+page\s+(?:summari[sz]es|outlines|describes|covers)\b|\bthis\s+(?:page|article)\s+(?:summari[sz]es|covers|describes)\b|\bthe team has documented\b|\bcites?\s+[\w.-]+\.\w+\s+as a source\b|\bconsult (?:that|the) citation\b|\bsee the (?:linked|cited)\b/i;

/** A draft that defers instead of answering ("varies", "check elsewhere", "consult"). */
const PUNT_NONANSWER =
  /\b(?:varies|vary over time|changes over time|check the individual|consult up-to-date|for an accurate answer,? (?:check|see)|refer to (?:official|the) (?:site|sources)|look it up)\b/i;

/** STRONG marketing superlatives (narrow on purpose, descriptive "official flag" is
 *  NOT flagged; only unsupported promotional claims). */
const STRONG_SUPERLATIVE =
  /\b(?:the best|the only|#1|number one|world'?s (?:best|largest|oldest|first|leading)|the (?:greatest|finest) \w+ (?:ever|of all time))\b/i;

/** Title/meta boilerplate spam. */
const TITLE_BOILERPLATE =
  /\(\s*20\d{2}\s+guide\s*\)|\b(?:complete|ultimate|definitive|essential)\s+guide\b|\beverything you need to know\b/i;

/** A specific count introduced in a title ("150+", "Top 50"), flag for verification. */
const COUNT_CLAIM = /\b\d{2,}\s*\+|\btop\s+\d+\b/i;

/** A concrete date/count/"official"/"national X" claim, the narrow factual
 *  signal this file has used since the first draft audit. Reused (per the
 *  W5 architecture) both as one leg of `isFactualClaim` below AND, on its
 *  own, as the narrow "did this rewrite introduce a NEW specific fact"
 *  trigger for atomic title/meta edits (see evaluateTitleMetaQuality), a
 *  rewrite that only rephrases the SAME fact is never source-gated. */
// W5 P2 (2026-07-09): the count clause counts Persian (U+06F0-U+06F9) and Arabic-Indic (U+0660-U+0669) digits too, so a claim written in a non-Latin
// numeral system ("۳۰۰۰ years") is still recognized as a specific fact and source-gated the same as "3000 years" (the leading \b is dropped only on
// that clause because a word boundary is ill-defined next to a non-ASCII digit; the year and phrase clauses keep theirs).
const SPECIFIC_FACT =
  /\b(?:18|19|20)\d{2}\b|[\d٠-٩۰-۹]+\s*(?:times|years|km|km2|species|provinces|dynasties)\b|\bofficial\b|\bnational (?:animal|flag|symbol|language|bird)\b/i;

/** Any digit run, the plainest "this asserts a number" signal. W5 P2: includes
 *  Persian + Arabic-Indic digits so a number in a non-Latin numeral system
 *  still counts (no \b, which is ill-defined next to a non-ASCII digit). */
const GENERIC_NUMBER = /[\d٠-٩۰-۹][\d٠-٩۰-۹,.]*/;

/** A run of 2+ consecutive capitalized words, a proper-noun-shaped span
 *  ("Nowruz Activities", "the Lion and Sun", "Sizdah Bedar"). Deliberately
 *  simple (no plural-fold/brand-suffix sophistication, this is a boolean
 *  presence check for GATING, not entity extraction), see
 *  factual-entailment.ts's `extractCapitalizedSpans` for the fuller version
 *  used to verify a specific entity is grounded. */
const NAMED_ENTITY_SPAN = /\b[A-Z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*)+\b/;

/** "X is/was/are/were a/an/the Y", a definitional assertion about the world,
 *  not a hedge or a question. */
const DEFINITIONAL_ASSERTION = /\b(?:is|was|are|were)\s+(?:a|an|the)\b/i;

/**
 * W5 (J-69/J-71) FACTUAL classifier: true when `text` asserts something checkable, a specific fact, any number, a proper-noun-shaped span, or a
 * definitional claim. A draft with NONE of these makes no claim to verify: it is claim-free and is NEVER source-gated (a purely navigational
 * sentence, an instruction, a question). Deliberately broad, per J-69 ("no exceptions"), most real encyclopedic prose asserts SOMETHING, and
 * that is the intended effect: a "ready" verdict now means "grounded and sourced," not merely "reads fine."
 */
export function isFactualClaim(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    SPECIFIC_FACT.test(t) ||
    GENERIC_NUMBER.test(t) ||
    NAMED_ENTITY_SPAN.test(t) ||
    DEFINITIONAL_ASSERTION.test(t)
  );
}

/** Drafter last-mile G5 (2026-07-10): when a FACTUAL draft's claims are not covered by a qualifying (authoritative + verified) source, decide HOW to hold it. If one of the cited sources is from an authority-strong domain that Beacon could not READ (a 403/robots block, marked `fetchBlocked` at generation time), this is NOT "no source" - it is "I could not check this citation." Hold it as `needs_source_check` (copy blocked, one-click-from-ready, NEVER silently ready) with copy that names the domain, instead of the harsher `missing_source`. The distinction is honest and never weakens the floor: paste-ready still REQUIRES verified coverage (this branch is only reached when coverage FAILED), so a blocked authoritative source can never masquerade as verified. Authority is re-derived here (never the LLM's guess), consistent with the rest of the source gate. Returns the exact operator-facing hold verdict. */
function resolveSourceHold(
  coverage: { uncovered: string[] },
  sources: readonly ClassifiableSource[] | undefined,
  allowlist: readonly string[] | undefined,
): DraftQualityResult {
  const blockedAuthoritative = (sources ?? []).filter(
    (s) =>
      s.fetchBlocked === true &&
      s.verified !== true &&
      classifySourceAuthority(s, allowlist) === "authoritative",
  );
  if (blockedAuthoritative.length > 0) {
    const domain = extractDomain(blockedAuthoritative[0]!) || "that source";
    return {
      status: "needs_source_check",
      reasons: [
        `I could not read ${domain} myself (it blocks robots). Check this citation before you paste.`,
      ],
      copyAllowed: false,
      canRegenerate: false,
      confidence: "medium",
    };
  }
  const claim = coverage.uncovered[0];
  return {
    status: "missing_source",
    reasons: [
      claim
        ? `This claim still needs a cited authoritative source: "${shortClaim(claim)}". Add 1-2 before this is paste-ready.`
        : "States a claim with no cited authoritative source yet. Add 1-2 before this is paste-ready.",
    ],
    copyAllowed: false,
    canRegenerate: false,
    confidence: "medium",
  };
}

/**
 * Drafter last-mile G6 (2026-07-10): when a draft is ALREADY fully covered by a verified authoritative source but ALSO cites an authority-strong source Beacon
 * could not read (a 403/robots block), return a one-line note naming it. The draft is paste-ready on its verified backing - the blocked citation never holds
 * it hostage - but the operator is told plainly so they can drop or check that one
 * citation. Returns undefined when there is no such blocked authoritative source. Authority is re-derived here, never the LLM's guess.
 */
function blockedAuthoritativeNote(
  sources: readonly ClassifiableSource[] | undefined,
  allowlist: readonly string[] | undefined,
): string | undefined {
  const blocked = (sources ?? []).filter(
    (s) => s.fetchBlocked === true && s.verified !== true && classifySourceAuthority(s, allowlist) === "authoritative",
  );
  if (blocked.length === 0) return undefined;
  const domain = extractDomain(blocked[0]!) || "one cited source";
  return `I could not read ${domain} myself (it blocks robots), but this draft is fully backed by other verified sources, so it is safe to paste. Drop or check that citation if you like.`;
}

// ── answer-block / opening quality ────────────────────────────────────────────

type EvaluateDraftInput = {
  /** The answer/opening text (raw string or structured .answer). */
  answer: string | null | undefined;
  /** The query/topic the draft must answer (for relevance + entity checks). */
  query?: string | null;
  topicLabel?: string | null;
  /** Number of grounding evidence refs on a structured draft (raw drafts = 0). */
  evidenceRefs?: number;
  /** Content-context vocabulary; defaults to DEFAULT_CONTEXT_TOKENS. */
  contextTokens?: string[];
  /** N8: the target page's OWN stored body text (page_snapshots
   *  body_paragraph_sample joined). Supplying this (and/or evidenceText) turns
   *  ON the factual-entailment check below; omitting both leaves this function
   *  byte-identical to its pre-N8 behavior. */
  pageBodyText?: string | null;
  /** N8: flattened evidence-packet text (numbers/facts the draft may cite). */
  evidenceText?: string | null;
  /** N8 (operator correction): dated, sourced facts Beacon already has on
   *  file. A claim that contradicts the page but is backed by one of these is
   *  an ALLOWED CORRECTION, not a violation - see factual-entailment.ts. */
  authoritativeFacts?: readonly AuthoritativeFact[];
  /** W5 (J-69): the draft's own cited sources. Authority is ALWAYS
   *  re-derived here via source-authority.ts, a source's own `authority`
   *  field (if present) is never trusted. Omitted/empty = no sources, the
   *  honest default for most drafts today. */
  sources?: readonly ClassifiableSource[];
  /** W5 (J-69): this tenant's own curated authoritative-domain allowlist
   *  (BusinessProfile.authoritativeSourceDomains). Omitted = only the
   *  universal .gov/.edu + named encyclopedic/press set applies. */
  authoritativeSourceDomains?: readonly string[];
};

/** Evaluate a prepared answer block / opening. */
export function evaluateDraftQuality(input: EvaluateDraftInput): DraftQualityResult {
  const answer = (input.answer ?? "").trim();
  const tokens = input.contextTokens ?? DEFAULT_CONTEXT_TOKENS;

  if (!answer) {
    return { status: "malformed", reasons: ["No draft text."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }

  const words = wordCount(answer);
  const s1 = firstSentence(answer);

  // 1. Meta / punt non-answers (talks about the page, or defers) → too thin to use.
  if (META_NONANSWER.test(answer)) {
    return { status: "too_thin", reasons: ["Describes the page/source instead of answering the question."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (PUNT_NONANSWER.test(answer) && words < 60) {
    return { status: "too_thin", reasons: ["Defers instead of answering (“varies / check elsewhere”)."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }

  // 2. Generic dictionary opening with no content context in the FIRST sentence.
  if (DICTIONARY_FRAME.test(s1) && !hasContext(s1, tokens)) {
    return {
      status: "generic_rejected",
      reasons: ["Opens with a context-free dictionary definition instead of this page's own subject, so it reads generic."],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "high",
    };
  }

  // 4. Relevance: the whole answer carries no content context at all → likely off-topic
  //    for a Persian-culture page.
  if (!hasContext(answer, tokens)) {
    return {
      status: "relevance_rejected",
      reasons: ["None of this page's own subject words appear anywhere, so this is likely off-topic."],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "medium",
    };
  }

  // 5. Strong unsupported marketing superlative → hide copy.
  if (STRONG_SUPERLATIVE.test(answer)) {
    return {
      status: "unsupported_claim",
      reasons: ["Contains an unsupported superlative claim (“best/only/#1”)."],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "medium",
    };
  }

  // 6. J-71 band: an answer block runs 80-150 words ("40-60 is too thin," per
  //    the operator's own words). This replaces the old <25-word hard floor
  //    AND this file's reliance on checkPassageRules' 30-70 "self-contained"
  //    band below (that band serves page PASSAGES, not the answer-block
  //    contract - see the module docstring). Below the floor is the same
  //    `too_thin` status the old floor used; above the ceiling is
  //    `not_quotable` (trimmable, not a rewrite from scratch).
  if (words < 80) {
    return {
      status: "too_thin",
      reasons: [`Only ${words} words. An answer block needs 80-150 words with sources to be quotable (40-60 is too thin).`],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "high",
    };
  }
  if (words > 150) {
    return {
      status: "not_quotable",
      reasons: [`Runs ${words} words. Trim it to 150 or fewer so it still reads as one quotable answer.`],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "high",
    };
  }

  // 7. Quotability (item 78): a draft that opens with a pronoun instead of
  //    naming the subject cannot be lifted out of context and quoted on its
  //    own, the whole point of an answer block. (The self-contained LENGTH
  //    half of this check is now the J-71 band above, checkPassageRules'
  //    30-70 word band still exists for page passages, but no longer governs
  //    answer-block length here.)
  const quotability = checkPassageRules(answer, input.query ?? input.topicLabel ?? "");
  const pronounFail = quotability.find((c) => c.code === "pronoun_opener" && !c.passed);
  if (pronounFail) {
    return {
      status: "not_quotable",
      reasons: [pronounFail.fix],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "high",
    };
  }

  // 8. Factual entailment (N8, law 3; operator correction 2026-07-02) - only runs when a caller supplies page body and/or evidence text; otherwise this is a no-op (see the module docstring). Every number, named entity, and superlative in the draft must be traceable to the page's own body, the evidence, the query, or a dated authoritative fact. An UNSUPPORTED claim (found nowhere) blocks copy. A claim that contradicts the page but IS backed by a dated fact is an allowed CORRECTION - it never blocks, it rides along on a "ready" result so the operator sees what changed and why.
  let entailmentCorrections: string[] | undefined;
  if (input.pageBodyText || input.evidenceText || input.authoritativeFacts?.length) {
    const entailment = checkFactualEntailment({
      draftText: answer,
      pageBodyText: input.pageBodyText,
      evidenceText: input.evidenceText,
      query: input.query ?? input.topicLabel ?? null,
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

  // 9. J-69 (no exceptions): a FACTUAL draft with zero qualifying
  //    authoritative sources is HELD, not shipped. This supersedes the old
  //    "specific fact + zero evidenceRefs -> useful_but_needs_review" rule
  //    (a generic evidence-count was always a weaker proxy for a real,
  //    checkable citation). canRegenerate is false, redrafting cannot
  //    invent authority; the honest fix is "add a source."
  let blockedSourceNote: string | undefined;
  if (isFactualClaim(answer)) {
    const coverage = draftFactsCoveredBySources(answer, input.sources, input.authoritativeSourceDomains);
    if (!coverage.covered) {
      // G5: hold as `needs_source_check` (not `missing_source`) when a cited authority-strong source could not be READ (403/robots block). Never
      // silently ready - copy stays blocked until the operator checks it.
      return resolveSourceHold(coverage, input.sources, input.authoritativeSourceDomains);
    }
    // G6 (2026-07-10) multi-source combination: the draft IS fully covered by a verified authoritative source. An ADDITIONAL citation that Beacon could not
    // read (403/robots block) must NOT hold the draft hostage - classify by the
    // covered status - but it is noted so the operator knows one citation was unreadable while the draft still stands on its verified backing.
    blockedSourceNote = blockedAuthoritativeNote(input.sources, input.authoritativeSourceDomains);
  }

  // 10. J-70 (the tenant first-mention rule) IS GONE. It was a soft downgrade driven by a per-account config
  //     (BusinessProfile.firstMention) that no caller ever threaded into this gate, so it never once ran on a
  //     real draft. Whether copy names a subject the way a reader needs is what the editor contract's judge
  //     rules on, over the real page, rather than a character-range test nobody supplied a range to.

  return {
    status: "ready",
    reasons: [
      "Answers the topic with page-specific context; no risky claims detected.",
      ...(blockedSourceNote ? [blockedSourceNote] : []),
    ],
    copyAllowed: true,
    canRegenerate: false,
    confidence: "high",
    ...(entailmentCorrections ? { corrections: entailmentCorrections } : {}),
  };
}

// ── title / meta (atomic edit) quality ────────────────────────────────────────

type EvaluateTitleInput = {
  before?: string | null;
  after: string | null | undefined;
  field?: "title" | "meta" | string;
  query?: string | null;
  contextTokens?: string[];
  /** N8: same opt-in factual-entailment inputs as EvaluateDraftInput. */
  pageBodyText?: string | null;
  evidenceText?: string | null;
  authoritativeFacts?: readonly AuthoritativeFact[];
  /** W5 (J-69): same contract as EvaluateDraftInput.sources, only consulted
   *  when the rewrite introduces a NEW specific fact `before` didn't carry
   *  (see the narrow SPECIFIC_FACT check below); a pure rephrase never
   *  reaches this at all. */
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

  // Factual entailment (N8, law 3; operator correction 2026-07-02) - same opt-in contract as evaluateDraftQuality: a claim contradicting the page
  // but backed by a dated authoritative fact is an allowed correction, never a violation - see the module docstring on evaluateDraftQuality.
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

  // J-69 (no exceptions): a rewrite that introduces a NEW specific fact (a date/count/"official"/"national X" that `before` did NOT already carry) needs an authoritative source before it is paste-ready. A pure rephrase, the same facts as before, just reworded, asserts nothing new and is never held up on this; that mirrors the COUNT_CLAIM check above, using the same narrow SPECIFIC_FACT signal rather than the broader classifier evaluateDraftQuality uses. AND A FACT THE PAGE ITSELF CARRIES IS NOT NEW IN A BODY FIELD EITHER (live 19:08 on /jersey-evolution): the exemption was written for meta, title and h1 alone, so a section listing 1978, 1998, 2006, 2014, 2018 and 2022, which are the page's own section headings and exactly the words the writer is told it may restate, was held for introducing six new facts, while `before` is empty for a new section so every one of them read as new. What is new is what the PAGE does not say, whatever field says it. A FIELD SUMMARISES THE PAGE, SO ITS FACTS COME FROM THE PAGE. Comparing only against the line being replaced makes any figure a "new" fact the moment a generic description is improved: /iran-animals/asiatic-cheetah was held for "a new fact with no cited authoritative source" over "Iran's national animal is the Asiatic cheetah", a sentence its own stored page carries word for word. What is new is what the PAGE does not say. Only the matched fact is looked for, never every word of the line, because requiring the whole sentence verbatim refuses ordinary paraphrase around a fact the page does carry. A fact the page never states still needs one. A PAGE ASSERTING A THING ABOUT THE WORLD IS NOT EVIDENCE THE THING IS TRUE. Summarising the page is a description's whole job so its facts may come from the page, but "Iran's national animal is the Asiatic cheetah" is a claim about a COUNTRY and iranopedia.com saying it does not make it so. Authoritative sources confirm the cheetah is critically endangered and survives only in Iran; they do not establish the national-animal claim. A symbol or officialness claim is never carried by the page alone and owes a real source; an ordinary page fact still is.
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
