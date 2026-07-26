/**
 * draft-quality (2026-06-28 — Prepared Output Quality Gate) — a PURE, deterministic
 * trust gate over prepared output. It answers one question per draft: "is this good
 * enough to copy/paste, does it need a human review first, or is it junk we should
 * not call ready?" No LLM at runtime, no I/O — just the parsed draft fields.
 *
 * Design (grounded in a real Iranopedia draft audit + an adversarial false-rejection
 * pass — see scripts/wf-draft-quality.js):
 *  - REJECT (hide copy) is NARROW + high-confidence: generic dictionary openings,
 *    punt/meta non-answers, off-topic, no-draft, too-thin, malformed, strong
 *    marketing superlatives. These are unambiguously bad.
 *  - "useful_but_needs_review" is BROAD: real factual/historical claims (dates,
 *    counts, "official", dynasties) stay COPYABLE but flagged for a human check —
 *    the adversarial pass proved auto-rejecting these kills good output.
 *  - The generic-opening rule fires ONLY when the FIRST sentence is a dictionary
 *    frame ("A/An/The X is/are…", "X refers to…") AND that first sentence carries
 *    no content-context token. That precisely separates "A gift is a voluntarily
 *    transferred item…" (REJECT) from "An Iranian wedding comprises…" (PASS).
 *
 *  - BEACON 500 item 78 (2026-07-02) added a QUOTABILITY check to
 *    `evaluateDraftQuality`: an answer block that fails its own passage-level
 *    answerability rules (src/domains/evidence/pages/passage-answerability.ts - the
 *    same self-contained/entity-first/concrete-fact/on-topic rubric used to
 *    score page passages) is rejected the same way a generic or thin draft
 *    is, with a plain-English fix instead of a lint label. Additive: it only
 *    fires on drafts that already pass every earlier check, so no existing
 *    "ready" verdict flips without a real quotability problem (pinned by test).
 *
 *  - N8 (2026-07-02, Quality Constitution law 3) added a FACTUAL ENTAILMENT
 *    check to `evaluateDraftQuality`: numbers/dates, named entities, and
 *    superlatives in the draft must be backed by the target page's own stored
 *    body (page_snapshots body_paragraph_sample), the evidence text, or the
 *    query (src/domains/decision/drafts/factual-entailment.ts). Strictly additive and
 *    opt-in: it only runs when a caller supplies `pageBodyText` and/or
 *    `evidenceText`, so every existing pinned fixture (none of which pass
 *    those fields) keeps its exact prior verdict. When it does run and finds
 *    a violation, the draft downgrades to "unverified_claim" (copy blocked)
 *    with the plain-English violation as the reason - the same shape every
 *    other rejection in this file already uses.
 *
 *  - W5 (2026-07-09, J-69/J-70/J-71) added THREE checks:
 *    1. A word-count BAND for answer blocks: 80-150 words ("40-60 is too
 *       thin" per the operator's own words). Below 80 is `too_thin`
 *       (unchanged status, new threshold); above 150 is `not_quotable` (it no
 *       longer reads as one liftable answer). This REPLACES the old <25-word
 *       hard floor and drops this file's reliance on checkPassageRules'
 *       30-70 "self-contained" band for answer-block length (that band still
 *       serves page PASSAGES unchanged, passage-answerability.ts is
 *       untouched); the `pronoun_opener` rule from the same quotability check
 *       is kept as-is.
 *    2. `missing_source` (J-69, "EVERY factual draft requires 1-2
 *       authoritative sources before it is paste-ready. No exceptions."): a
 *       FACTUAL draft (see `isFactualClaim`) with zero authoritative sources
 *       whose claim overlaps the draft's own claim tokens is held, copy
 *       blocked, AND not regeneratable (redrafting cannot invent authority;
 *       the honest fix is "add a source", not "try again"). This SUPERSEDES
 *       the old "specific fact + zero evidenceRefs → useful_but_needs_review"
 *       rule above: a generic evidence-COUNT was always a weaker proxy for a
 *       real, checkable citation, so some previously-"needs review" fixtures
 *       now correctly surface as "needs a source" instead, that retroactive
 *       flip is the point, not a bug. Formatting/technical kinds (a
 *       title/meta/h1 rewrite that only rephrases, internal_link,
 *       schema fixes, a claim-free answer block) are NEVER source-gated.
 *       `isFactualClaim` returning false means there is nothing to source.
 *    3. A soft first-mention check (J-70), see `checkFirstMention`, only
 *       when the tenant has configured `firstMention`; a miss never blocks,
 *       it just downgrades an otherwise-ready draft to
 *       `useful_but_needs_review` with a plain reason.
 */

import { checkPassageRules } from "@/domains/evidence/pages/passage-answerability";
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import {
  hasQualifyingAuthoritativeSource,
  draftFactsCoveredBySources,
  classifySourceAuthority,
  extractDomain,
  type ClassifiableSource,
} from "@/domains/decision/drafts/source-authority";
import { checkFirstMention, type FirstMentionConfig } from "@/domains/decision/drafts/first-mention-check";

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
  /** N8 (2026-07-02, operator correction): plain-English lines for claims that
   *  CONTRADICT the target page's own text but are backed by a dated,
   *  authoritative source (a stale page being corrected, not an invention).
   *  Present only when the factual-entailment check ran AND found at least
   *  one correction; absent otherwise (never an empty array vs. "not checked"
   *  ambiguity - callers test for `undefined`). A draft can be "ready" AND
   *  carry corrections at the same time - corrections never block copy/publish,
   *  they are shown alongside it so the operator sees what changed and why. */
  corrections?: string[];
};

// ── shared vocabulary + helpers ───────────────────────────────────────────────

/** Default content-context vocabulary (Iranopedia is the live tenant). Overridable
 *  per call via opts.contextTokens so the gate is not hard-wired to one vertical. */
export const DEFAULT_CONTEXT_TOKENS = [
  "iran", "iranian", "persia", "persian", "farsi", "tehran", "nowruz", "mehregan",
  "yalda", "achaemenid", "safavid", "abbasid", "sassanid", "qajar", "pahlavi",
  "sofreh", "haft-seen", "haft seen", "shiraz", "isfahan", "tabriz", "faravahar",
];

const PERSIAN_SCRIPT = /[؀-ۿ]/;

function hasContext(text: string, tokens: string[]): boolean {
  if (PERSIAN_SCRIPT.test(text)) return true;
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

/** "A/An/The <noun> is/are …" or "<X> refers to …" — a context-free dictionary frame. */
const DICTIONARY_FRAME = /^\s*(?:a|an|the)\s+[a-z][\w-]*\s+(?:is|are)\b|\brefers?\s+to\b/i;

/** A draft that talks ABOUT the page/source instead of answering (meta non-answer). */
const META_NONANSWER =
  /\bthe\s+\w+\s+page\s+(?:summari[sz]es|outlines|describes|covers)\b|\bthis\s+(?:page|article)\s+(?:summari[sz]es|covers|describes)\b|\bthe team has documented\b|\bcites?\s+[\w.-]+\.\w+\s+as a source\b|\bconsult (?:that|the) citation\b|\bsee the (?:linked|cited)\b/i;

/** A draft that defers instead of answering ("varies", "check elsewhere", "consult"). */
const PUNT_NONANSWER =
  /\b(?:varies|vary over time|changes over time|check the individual|consult up-to-date|for an accurate answer,? (?:check|see)|refer to (?:official|the) (?:site|sources)|look it up)\b/i;

/** STRONG marketing superlatives (narrow on purpose — descriptive "official flag" is
 *  NOT flagged; only unsupported promotional claims). */
const STRONG_SUPERLATIVE =
  /\b(?:the best|the only|#1|number one|world'?s (?:best|largest|oldest|first|leading)|the (?:greatest|finest) \w+ (?:ever|of all time))\b/i;

/** Title/meta boilerplate spam. */
const TITLE_BOILERPLATE =
  /\(\s*20\d{2}\s+guide\s*\)|\b(?:complete|ultimate|definitive|essential)\s+guide\b|\beverything you need to know\b/i;

/** A specific count introduced in a title ("150+", "Top 50") — flag for verification. */
const COUNT_CLAIM = /\b\d{2,}\s*\+|\btop\s+\d+\b/i;

/** A concrete date/count/"official"/"national X" claim, the narrow factual
 *  signal this file has used since the first draft audit. Reused (per the
 *  W5 architecture) both as one leg of `isFactualClaim` below AND, on its
 *  own, as the narrow "did this rewrite introduce a NEW specific fact"
 *  trigger for atomic title/meta edits (see evaluateTitleMetaQuality), a
 *  rewrite that only rephrases the SAME fact is never source-gated. */
// W5 P2 (2026-07-09): the count clause counts Persian (U+06F0-U+06F9) and
// Arabic-Indic (U+0660-U+0669) digits too, so a claim written in a non-Latin
// numeral system ("۳۰۰۰ years") is still recognized as a specific fact and
// source-gated the same as "3000 years" (the leading \b is dropped only on
// that clause because a word boundary is ill-defined next to a non-ASCII
// digit; the year and phrase clauses keep theirs).
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
 * W5 (J-69/J-71) FACTUAL classifier: true when `text` asserts something
 * checkable, a specific fact, any number, a proper-noun-shaped span, or a
 * definitional claim. A draft with NONE of these makes no claim to verify:
 * it is claim-free and is NEVER source-gated (a purely navigational
 * sentence, an instruction, a question). Deliberately broad, per J-69
 * ("no exceptions"), most real encyclopedic prose asserts SOMETHING, and
 * that is the intended effect: a "ready" verdict now means "grounded and
 * sourced," not merely "reads fine."
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

/**
 * Drafter last-mile G5 (2026-07-10): when a FACTUAL draft's claims are not
 * covered by a qualifying (authoritative + verified) source, decide HOW to hold
 * it. If one of the cited sources is from an authority-strong domain that Beacon
 * could not READ (a 403/robots block, marked `fetchBlocked` at generation time),
 * this is NOT "no source" - it is "I could not check this citation." Hold it as
 * `needs_source_check` (copy blocked, one-click-from-ready, NEVER silently ready)
 * with copy that names the domain, instead of the harsher `missing_source`.
 *
 * The distinction is honest and never weakens the floor: paste-ready still
 * REQUIRES verified coverage (this branch is only reached when coverage FAILED),
 * so a blocked authoritative source can never masquerade as verified. Authority
 * is re-derived here (never the LLM's guess), consistent with the rest of the
 * source gate. Returns the exact operator-facing hold verdict.
 */
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
 * Drafter last-mile G6 (2026-07-10): when a draft is ALREADY fully covered by a
 * verified authoritative source but ALSO cites an authority-strong source Beacon
 * could not read (a 403/robots block), return a one-line note naming it. The
 * draft is paste-ready on its verified backing - the blocked citation never holds
 * it hostage - but the operator is told plainly so they can drop or check that one
 * citation. Returns undefined when there is no such blocked authoritative source.
 * Authority is re-derived here, never the LLM's guess.
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

export type EvaluateDraftInput = {
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
  /** W5 (J-70): this tenant's first-mention rule (BusinessProfile.
   *  firstMention). Null/omitted = the rule contributes nothing, byte-
   *  identical evaluation to a tenant that never configured one. */
  firstMentionConfig?: FirstMentionConfig | null;
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
      reasons: ["Opens with a context-free dictionary definition (no Iran/Persian framing) — reads generic, not page-specific."],
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
      reasons: ["No Iran/Persian context anywhere — likely off-topic for this page."],
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

  // 8. Factual entailment (N8, law 3; operator correction 2026-07-02) - only
  //    runs when a caller supplies page body and/or evidence text; otherwise
  //    this is a no-op (see the module docstring). Every number, named entity,
  //    and superlative in the draft must be traceable to the page's own body,
  //    the evidence, the query, or a dated authoritative fact. An UNSUPPORTED
  //    claim (found nowhere) blocks copy. A claim that contradicts the page
  //    but IS backed by a dated fact is an allowed CORRECTION - it never
  //    blocks, it rides along on a "ready" result so the operator sees what
  //    changed and why.
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
      // G5: hold as `needs_source_check` (not `missing_source`) when a cited
      // authority-strong source could not be READ (403/robots block). Never
      // silently ready - copy stays blocked until the operator checks it.
      return resolveSourceHold(coverage, input.sources, input.authoritativeSourceDomains);
    }
    // G6 (2026-07-10) multi-source combination: the draft IS fully covered by a
    // verified authoritative source. An ADDITIONAL citation that Beacon could not
    // read (403/robots block) must NOT hold the draft hostage - classify by the
    // covered status - but it is noted so the operator knows one citation was
    // unreadable while the draft still stands on its verified backing.
    blockedSourceNote = blockedAuthoritativeNote(input.sources, input.authoritativeSourceDomains);
  }

  // 10. J-70 (soft): the tenant's first-mention rule (native script +
  //     optional transliteration/English gloss). Absent config = no-op. A
  //     miss never blocks, it downgrades ready to a plain "worth a look".
  const firstMention = checkFirstMention(answer, input.firstMentionConfig);
  if (!firstMention.ok) {
    return {
      status: "useful_but_needs_review",
      reasons: [firstMention.reason, ...(blockedSourceNote ? [blockedSourceNote] : [])],
      copyAllowed: true,
      canRegenerate: false,
      confidence: "high",
      ...(entailmentCorrections ? { corrections: entailmentCorrections } : {}),
    };
  }

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

export type EvaluateTitleInput = {
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
  authoritativeSourceDomains?: readonly string[];
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
      reasons: ["Rewrite drops the page’s core entity (no Iran/Persian term)."],
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
  if (STRONG_SUPERLATIVE.test(after)) {
    return { status: "unsupported_claim", reasons: ["Title makes an unsupported superlative claim."], copyAllowed: false, canRegenerate: true, confidence: "medium" };
  }
  // A specific count introduced in the rewrite that wasn't in the original → verify.
  if (COUNT_CLAIM.test(after) && !COUNT_CLAIM.test(before)) {
    return {
      status: "useful_but_needs_review",
      reasons: ["Introduces a specific count (e.g. “150+”) — confirm the page actually delivers it."],
      copyAllowed: true,
      canRegenerate: false,
      confidence: "medium",
    };
  }

  // Factual entailment (N8, law 3; operator correction 2026-07-02) - same
  // opt-in contract as evaluateDraftQuality: a claim contradicting the page
  // but backed by a dated authoritative fact is an allowed correction, never
  // a violation - see the module docstring on evaluateDraftQuality.
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

  // J-69 (no exceptions): a rewrite that introduces a NEW specific fact (a
  // date/count/"official"/"national X" that `before` did NOT already carry)
  // needs an authoritative source before it is paste-ready. A pure rephrase,
  // the same facts as before, just reworded, asserts nothing new and is
  // never held up on this; that mirrors the COUNT_CLAIM check above, using
  // the same narrow SPECIFIC_FACT signal rather than the broader classifier
  // evaluateDraftQuality uses (a title/meta field is a formatting edit, not
  // a fresh answer-block claim, see the module docstring).
  if (SPECIFIC_FACT.test(after) && !SPECIFIC_FACT.test(before) && !hasQualifyingAuthoritativeSource(after, input.sources, input.authoritativeSourceDomains)) {
    return {
      status: "missing_source",
      reasons: ["Introduces a new fact with no cited authoritative source yet. Add one before this is paste-ready."],
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

// ── create-page brief quality ─────────────────────────────────────────────────

export type EvaluateBriefInput = {
  title?: string | null;
  meta?: string | null;
  opening?: string | null;
  outline?: string[] | null;
  faqQuestions?: string[] | null;
  schemaTypes?: string[] | null;
  /** True when a DataForSEO verdict has been computed for this topic. */
  hasSerpVerdict?: boolean;
  contextTokens?: string[];
  /** W5 P1-4 (2026-07-09): the brief's own cited sources. Same contract as
   *  EvaluateDraftInput.sources - a FACTUAL openingAnswer with no qualifying
   *  authoritative source is held as missing_source, exactly like an answer
   *  block. Omitted/empty = no sources (the honest default). */
  sources?: readonly ClassifiableSource[];
  /** W5 P1-4: this tenant's own curated authoritative-domain allowlist. */
  authoritativeSourceDomains?: readonly string[];
};

const ALLOWED_SCHEMA = new Set(["article", "faqpage", "webpage", "blogposting", "howto", "itemlist"]);

/** An opening that ANNOUNCES the page instead of ANSWERING the question. The
 *  reader asked something; a page that opens by describing itself has spent the
 *  one extractable paragraph AI and Google read on nothing. Bounded literal
 *  starts, no NLP, so a real answer that happens to contain these words passes. */
const OPENING_ANNOUNCES =
  /^\s*(?:this (?:page|article|guide|post)|in this (?:page|article|guide|post)|the following)\b/i;

/** The lead sentence to judge: a bare restated question ("What are X?") is a
 *  frame, so the announcement check moves to the sentence that follows it. */
function announcingLead(opening: string): boolean {
  const sentences = opening.split(/(?<=[.?!])\s+/);
  const first = sentences[0] ?? "";
  if (OPENING_ANNOUNCES.test(first)) return true;
  return /\?\s*$/.test(first.trim()) && OPENING_ANNOUNCES.test(sentences[1] ?? "");
}

/** Evaluate a structured new-page brief. */
export function evaluateCreatePageBriefQuality(input: EvaluateBriefInput): DraftQualityResult {
  const tokens = input.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  const title = (input.title ?? "").trim();
  const meta = (input.meta ?? "").trim();
  const opening = (input.opening ?? "").trim();
  const outline = Array.isArray(input.outline) ? input.outline.filter((s) => (s ?? "").trim()) : [];
  const faqs = Array.isArray(input.faqQuestions) ? input.faqQuestions.filter((s) => (s ?? "").trim()) : [];
  const schema = Array.isArray(input.schemaTypes) ? input.schemaTypes : [];

  const reasons: string[] = [];

  if (!title || !meta || !opening || outline.length === 0) {
    return { status: "malformed", reasons: ["Brief is missing a required field (title/meta/opening/outline)."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (TITLE_BOILERPLATE.test(title)) {
    return { status: "generic_rejected", reasons: ["Title is boilerplate spam (“Complete Guide” / “(YYYY Guide)”)."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  // Generic dictionary opening with no content context.
  if (DICTIONARY_FRAME.test(firstSentence(opening)) && !hasContext(firstSentence(opening), tokens)) {
    return { status: "generic_rejected", reasons: ["Opening is a context-free dictionary definition (no Iran/Persian framing)."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (!hasContext(opening, tokens)) {
    return { status: "relevance_rejected", reasons: ["Opening carries no Iran/Persian context."], copyAllowed: false, canRegenerate: true, confidence: "medium" };
  }
  if (announcingLead(opening)) {
    return { status: "too_thin", reasons: ["Opening announces the page instead of answering the question. Lead with the answer."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (outline.length < 3) {
    return { status: "too_thin", reasons: [`Outline has only ${outline.length} sections.`], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }

  // W5 P1-4 (J-69, no exceptions): a FACTUAL openingAnswer with no qualifying
  // authoritative source is HELD, exactly like an answer block. The opening is
  // the extractable claim the new page leads with, so it earns the same
  // source floor. canRegenerate is false - redrafting cannot invent authority;
  // the honest fix is "add a source."
  if (isFactualClaim(opening)) {
    const coverage = draftFactsCoveredBySources(opening, input.sources, input.authoritativeSourceDomains);
    if (!coverage.covered) {
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
  }

  // Soft flags → useful_but_needs_review (copyable, but worth a look).
  if (faqs.length < 3) reasons.push("Fewer than 3 FAQ questions.");
  const badSchema = schema.filter((s) => !ALLOWED_SCHEMA.has(s.toLowerCase()));
  if (badSchema.length) reasons.push(`Schema type may not fit a content page: ${badSchema.join(", ")}.`);
  if (input.hasSerpVerdict === false) reasons.push("I have not checked what Google shows for this topic yet, so confirm the demand before you build.");

  if (reasons.length) {
    return { status: "useful_but_needs_review", reasons, copyAllowed: true, canRegenerate: false, confidence: "medium" };
  }
  return { status: "ready", reasons: ["Page-specific brief: contextual opening, real outline, FAQs, fitting schema."], copyAllowed: true, canRegenerate: false, confidence: "high" };
}

// ── section draft quality (BEACON 500 item 55 - outline-to-draft pipeline) ────

export type EvaluateSectionInput = {
  heading?: string | null;
  body?: string | null;
  /** Number of sources attached to this section (SectionDraftSchema requires >=1
   *  at the schema level; this is a defense-in-depth check for hand-built input). */
  sourceCount?: number;
  contextTokens?: string[];
};

/** Plan-not-prose language: the section describes what it WILL cover instead of
 *  covering it ("This section will present…", "planned subsections"). Found in
 *  the first real Iranopedia full-page run (thin grounding pushes the LLM toward
 *  meta-planning to avoid inventing facts). Narrow + future-tense on purpose so
 *  legitimate present-tense synthesis ("this section synthesizes…") passes. */
const SECTION_PLAN_LANGUAGE =
  /\bthis (?:section|article|page) will\b|\bplanned sub(?:section|topic)s?\b|\bis a planned sub(?:section|topic)\b|\bintended (?:readers|chronological|subsections?)\b/i;

/** Evaluate one drafted page section (heading + body) from the item-55 walker.
 *  Shares the same trust rails as evaluateDraftQuality (generic opening / punt /
 *  relevance / superlative / thin), sized for a section body rather than an
 *  80-150 word answer block. */
export function evaluateSectionDraftQuality(input: EvaluateSectionInput): DraftQualityResult {
  const heading = (input.heading ?? "").trim();
  const body = (input.body ?? "").trim();
  const tokens = input.contextTokens ?? DEFAULT_CONTEXT_TOKENS;

  if (!heading || !body) {
    return { status: "malformed", reasons: ["Section is missing a heading or body."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if ((input.sourceCount ?? 1) < 1) {
    return { status: "missing_source", reasons: ["Section carries no source — every section must ground at least one claim."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }

  const words = wordCount(body);
  const s1 = firstSentence(body);

  if (META_NONANSWER.test(body)) {
    return { status: "too_thin", reasons: ["Describes the page/source instead of covering the section topic."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (SECTION_PLAN_LANGUAGE.test(body)) {
    return { status: "too_thin", reasons: ["Reads like a content plan (“this section will cover…”) instead of finished prose."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (PUNT_NONANSWER.test(body) && words < 60) {
    return { status: "too_thin", reasons: ["Defers instead of covering the topic (“varies / check elsewhere”)."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (words < 20) {
    return { status: "too_thin", reasons: [`Only ${words} words — too short for a page section.`], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (DICTIONARY_FRAME.test(s1) && !hasContext(s1, tokens)) {
    return {
      status: "generic_rejected",
      reasons: ["Opens with a context-free dictionary definition — reads generic, not page-specific."],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "high",
    };
  }
  if (!hasContext(`${heading} ${body}`, tokens)) {
    return { status: "relevance_rejected", reasons: ["No page-topic context anywhere in this section — likely off-topic."], copyAllowed: false, canRegenerate: true, confidence: "medium" };
  }
  if (STRONG_SUPERLATIVE.test(body)) {
    return { status: "unsupported_claim", reasons: ["Contains an unsupported superlative claim (“best/only/#1”)."], copyAllowed: false, canRegenerate: true, confidence: "medium" };
  }
  return { status: "ready", reasons: ["Covers the section topic with page-specific context; sourced; no risky claims detected."], copyAllowed: true, canRegenerate: false, confidence: "high" };
}

// ── internal-link quality ─────────────────────────────────────────────────────

export type EvaluateInternalLinkInput = {
  sourcePage?: string | null;
  targetPage?: string | null;
  anchorText?: string | null;
  linkSentence?: string | null;
};

/** Evaluate an internal-link draft. Hard rules: no self-link, anchor present, anchor
 *  must appear in the link sentence (so it reads in context). */
export function evaluateInternalLinkQuality(input: EvaluateInternalLinkInput): DraftQualityResult {
  const src = (input.sourcePage ?? "").trim();
  const tgt = (input.targetPage ?? "").trim();
  const anchor = (input.anchorText ?? "").trim();
  const sentence = (input.linkSentence ?? "").trim();
  if (!src || !tgt || !anchor) {
    return { status: "malformed", reasons: ["Missing source, target, or anchor."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  // Self-link: same page linking to itself adds nothing and can look like a bug.
  const a = src.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
  const b = tgt.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
  if (a === b) {
    return { status: "relevance_rejected", reasons: ["Self-link — source and target are the same page."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (sentence && !sentence.toLowerCase().includes(anchor.toLowerCase())) {
    return { status: "useful_but_needs_review", reasons: ["Anchor text does not appear in the link sentence — verify it reads in context."], copyAllowed: true, canRegenerate: false, confidence: "medium" };
  }
  if (STRONG_SUPERLATIVE.test(anchor)) {
    return { status: "unsupported_claim", reasons: ["Anchor makes an unsupported superlative claim."], copyAllowed: false, canRegenerate: true, confidence: "medium" };
  }
  return { status: "ready", reasons: ["Distinct source/target, descriptive anchor, reads in context."], copyAllowed: true, canRegenerate: false, confidence: "high" };
}

// ── prepared-pack dispatch (the critical adversarial fix) ──────────────────────

export type EvaluatePackInput = {
  /** The pack's structuredDraft { kind, value } — null until drafted. */
  structuredDraft?: { kind?: string; value?: unknown } | null;
  /** Lifecycle status; demand_found / competitors_read = no draft yet. */
  preparedStatus?: string | null;
  moveType?: string | null;
  contextTokens?: string[];
  /** N8: same opt-in factual-entailment inputs as EvaluateDraftInput, threaded
   *  through to the answer_block/atomic_edit dispatch below. Omitting both
   *  leaves this function byte-identical to its pre-N8 behavior. */
  pageBodyText?: string | null;
  evidenceText?: string | null;
  authoritativeFacts?: readonly AuthoritativeFact[];
  /** W5 (J-69/J-70): tenant config threaded to the answer_block/atomic_edit
   *  dispatch below, a draft's OWN `sources` field (parsed from the
   *  structured draft value) always wins; these are the tenant-level pieces
   *  the draft itself doesn't carry. Omitting both leaves this function
   *  byte-identical to its pre-W5 behavior. */
  authoritativeSourceDomains?: readonly string[];
  firstMentionConfig?: FirstMentionConfig | null;
  /** R16 (P6 LLM engine pack): the drafter's de-templating guard flagged this
   *  draft as a near-copy of recent same-family drafts ("reads like a repeat").
   *  A ready verdict is DEMOTED to useful_but_needs_review - copy stays allowed
   *  (repetition is a review concern, not a trust breach), and regeneration is
   *  offered. Omitting the field leaves every verdict byte-identical. */
  repeatFlagged?: boolean;
};

/** Evaluate a PreparedMovePack by dispatching on its structuredDraft kind. A pack
 *  with no draft (null structuredDraft, or a pre-draft lifecycle status) is too_thin
 *  — NEVER let it fall through as ready (the adversarial pass's #1 finding). */
export function evaluatePreparedPackQuality(input: EvaluatePackInput): DraftQualityResult {
  const base = evaluatePreparedPackQualityBase(input);
  // R16 de-templating demotion: "ready" + repeat-flagged -> needs review.
  if (input.repeatFlagged === true && base.status === "ready") {
    return {
      ...base,
      status: "useful_but_needs_review",
      reasons: ["Reads like a repeat of recent drafts. Give it a quick look before shipping.", ...base.reasons],
      canRegenerate: true,
      confidence: base.confidence === "high" ? "medium" : base.confidence,
    };
  }
  return base;
}

function evaluatePreparedPackQualityBase(input: EvaluatePackInput): DraftQualityResult {
  const sd = input.structuredDraft;
  if (!sd || !sd.kind || sd.value == null) {
    return { status: "too_thin", reasons: ["No draft generated yet — prepare this move to produce one."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  const v = sd.value as Record<string, unknown>;
  if (sd.kind === "answer_block") {
    return evaluateDraftQuality({
      answer: typeof v.answer === "string" ? v.answer : "",
      evidenceRefs: Array.isArray(v.evidenceRefs) ? v.evidenceRefs.length : 0,
      contextTokens: input.contextTokens,
      pageBodyText: input.pageBodyText,
      evidenceText: input.evidenceText,
      authoritativeFacts: input.authoritativeFacts,
      sources: Array.isArray(v.sources) ? (v.sources as ClassifiableSource[]) : undefined,
      authoritativeSourceDomains: input.authoritativeSourceDomains,
      firstMentionConfig: input.firstMentionConfig,
    });
  }
  if (sd.kind === "atomic_edit") {
    return evaluateTitleMetaQuality({
      before: typeof v.before === "string" ? v.before : null,
      after: typeof v.after === "string" ? v.after : "",
      field: typeof v.field === "string" ? v.field : undefined,
      contextTokens: input.contextTokens,
      pageBodyText: input.pageBodyText,
      evidenceText: input.evidenceText,
      authoritativeFacts: input.authoritativeFacts,
      sources: Array.isArray(v.sources) ? (v.sources as ClassifiableSource[]) : undefined,
      authoritativeSourceDomains: input.authoritativeSourceDomains,
    });
  }
  if (sd.kind === "create_page_brief") {
    return evaluateCreatePageBriefQuality({
      title: typeof v.proposedTitle === "string" ? v.proposedTitle : null,
      meta: typeof v.metaDescription === "string" ? v.metaDescription : null,
      opening: typeof v.openingAnswer === "string" ? v.openingAnswer : null,
      outline: Array.isArray(v.outline) ? (v.outline as string[]) : null,
      faqQuestions: Array.isArray(v.faqQuestions) ? (v.faqQuestions as string[]) : null,
      schemaTypes: Array.isArray(v.schemaTypes) ? (v.schemaTypes as string[]) : null,
      contextTokens: input.contextTokens,
      // W5 P1-4: the brief's OWN sources[] drive its openingAnswer source gate.
      sources: Array.isArray(v.sources) ? (v.sources as ClassifiableSource[]) : undefined,
      authoritativeSourceDomains: input.authoritativeSourceDomains,
    });
  }
  if (sd.kind === "internal_link") {
    return evaluateInternalLinkQuality({
      sourcePage: typeof v.sourcePage === "string" ? v.sourcePage : null,
      targetPage: typeof v.targetPage === "string" ? v.targetPage : null,
      anchorText: typeof v.anchorText === "string" ? v.anchorText : null,
      linkSentence: typeof v.linkSentence === "string" ? v.linkSentence : null,
    });
  }
  // Unknown draft kind — don't pretend it's ready.
  return { status: "malformed", reasons: [`Unrecognized draft kind: ${sd.kind}.`], copyAllowed: false, canRegenerate: true, confidence: "high" };
}

/** Short human label for a status (UI chip). */
export function qualityLabel(status: DraftQualityStatus): string {
  switch (status) {
    case "ready": return "Ready";
    case "useful_but_needs_review": return "Needs review";
    case "generic_rejected": return "Generic draft";
    case "relevance_rejected": return "Topic mismatch";
    case "fact_risk": return "Fact risk";
    case "unsupported_claim": return "Unsupported claim";
    case "too_thin": return "Too thin";
    case "malformed": return "Malformed";
    case "missing_source": return "Needs a source";
    case "needs_source_check": return "Check the source";
    case "stale_data_changed": return "Data changed";
    case "not_quotable": return "Not quotable";
    case "unverified_claim": return "Unverified claim";
  }
}
