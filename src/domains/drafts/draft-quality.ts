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
 *    answerability rules (src/domains/pages/passage-answerability.ts - the
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
 *    query (src/domains/drafts/factual-entailment.ts). Strictly additive and
 *    opt-in: it only runs when a caller supplies `pageBodyText` and/or
 *    `evidenceText`, so every existing pinned fixture (none of which pass
 *    those fields) keeps its exact prior verdict. When it does run and finds
 *    a violation, the draft downgrades to "unverified_claim" (copy blocked)
 *    with the plain-English violation as the reason - the same shape every
 *    other rejection in this file already uses.
 */

import { checkPassageRules } from "@/domains/pages/passage-answerability";
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/drafts/factual-entailment";

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

  // 2. Too thin (hard floor).
  if (words < 25) {
    return { status: "too_thin", reasons: [`Only ${words} words — too short to be a useful answer block.`], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }

  // 3. Generic dictionary opening with no content context in the FIRST sentence.
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

  // 6. Factual claims that warrant a human check — COPYABLE but flagged. A raw draft
  //    (evidenceRefs===0) carrying a specific number/date/year/"official" claim is the
  //    classic "probably right, but verify" case. Hedged claims are exempt.
  const refs = input.evidenceRefs ?? 0;
  const HEDGE = /\b(?:approximately|about|around|estimated|reportedly|may|might|varies|not (?:officially )?(?:announced|confirmed)|has not been (?:officially )?announced)\b/i;
  const SPECIFIC_FACT = /\b(?:18|19|20)\d{2}\b|\b\d+\s*(?:times|years|km|km2|species|provinces|dynasties)\b|\bofficial\b|\bnational (?:animal|flag|symbol|language|bird)\b/i;
  if (refs === 0 && SPECIFIC_FACT.test(answer) && !HEDGE.test(answer)) {
    return {
      status: "useful_but_needs_review",
      reasons: ["States a specific fact (date/number/“official”) with no cited source — verify before publishing."],
      copyAllowed: true,
      canRegenerate: false,
      confidence: "medium",
    };
  }

  // 7. Quotability (item 78): a draft that reads well by every earlier check but
  //    opens with a pronoun instead of naming the subject, or runs far outside the
  //    self-contained 30-70 word answer-block band, cannot be lifted out of context
  //    and quoted on its own, the whole point of an answer block. Narrow on purpose:
  //    checked against the REAL Iranopedia draft corpus, every existing "ready" answer
  //    already names its subject first and sits inside that band, so this never flips
  //    a passing draft, it only catches the two objective, fixable defects the item
  //    calls out. "No number/date" and "off-topic vs. the query" are NOT hard-rejected
  //    here because good encyclopedic openers routinely carry neither and still read
  //    fine (ab-2/ab-3 in the pinned corpus have no digit at all).
  const quotability = checkPassageRules(answer, input.query ?? input.topicLabel ?? "");
  const pronounFail = quotability.find((c) => c.code === "pronoun_opener" && !c.passed);
  const lengthFail = quotability.find((c) => c.code === "not_self_contained" && !c.passed);
  if (pronounFail || lengthFail) {
    return {
      status: "not_quotable",
      reasons: [pronounFail, lengthFail].filter((c): c is NonNullable<typeof c> => Boolean(c)).map((c) => c.fix),
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

  return {
    status: "ready",
    reasons: ["Answers the topic with page-specific context; no risky claims detected."],
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
};

const ALLOWED_SCHEMA = new Set(["article", "faqpage", "webpage", "blogposting", "howto", "itemlist"]);

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
  if (outline.length < 3) {
    return { status: "too_thin", reasons: [`Outline has only ${outline.length} sections.`], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }

  // Soft flags → useful_but_needs_review (copyable, but worth a look).
  if (faqs.length < 3) reasons.push("Fewer than 3 FAQ questions.");
  const badSchema = schema.filter((s) => !ALLOWED_SCHEMA.has(s.toLowerCase()));
  if (badSchema.length) reasons.push(`Schema type may not fit a content page: ${badSchema.join(", ")}.`);
  if (input.hasSerpVerdict === false) reasons.push("No live-SERP verdict yet — confirm Google demand before building.");

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
 *  relevance / superlative / thin), sized for a section body rather than a
 *  40-60 word answer block. */
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

// ── CRO / experience-fix quality ──────────────────────────────────────────────

export type EvaluateCROInput = {
  frictionType?: string | null;
  location?: string | null;
  fix?: string | null;
  evidenceRefs?: number;
};

/** Evaluate a CRO/fix_experience draft. Must name a real fix grounded in friction. */
export function evaluateCROFixQuality(input: EvaluateCROInput): DraftQualityResult {
  const fix = (input.fix ?? "").trim();
  const location = (input.location ?? "").trim();
  if (!fix || !location) {
    return { status: "malformed", reasons: ["Missing fix or location."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (wordCount(fix) < 6) {
    return { status: "too_thin", reasons: ["Fix is too vague to act on."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  // A CRO fix with zero grounding is a guess — flag for review (Clarity evidence needed).
  if ((input.evidenceRefs ?? 0) === 0) {
    return { status: "useful_but_needs_review", reasons: ["No Clarity/analytics evidence cited — confirm the friction before changing the page."], copyAllowed: true, canRegenerate: false, confidence: "medium" };
  }
  return { status: "ready", reasons: ["Concrete, located fix grounded in friction evidence."], copyAllowed: true, canRegenerate: false, confidence: "high" };
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
};

/** Evaluate a PreparedMovePack by dispatching on its structuredDraft kind. A pack
 *  with no draft (null structuredDraft, or a pre-draft lifecycle status) is too_thin
 *  — NEVER let it fall through as ready (the adversarial pass's #1 finding). */
export function evaluatePreparedPackQuality(input: EvaluatePackInput): DraftQualityResult {
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
    });
  }
  if (sd.kind === "cro_fix") {
    return evaluateCROFixQuality({
      frictionType: typeof v.frictionType === "string" ? v.frictionType : null,
      location: typeof v.location === "string" ? v.location : null,
      fix: typeof v.fix === "string" ? v.fix : null,
      evidenceRefs: Array.isArray(v.evidenceRefs) ? v.evidenceRefs.length : 0,
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
    case "missing_source": return "Needs source";
    case "stale_data_changed": return "Data changed";
    case "not_quotable": return "Not quotable";
    case "unverified_claim": return "Unverified claim";
  }
}
