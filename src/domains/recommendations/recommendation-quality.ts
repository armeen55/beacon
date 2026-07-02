/**
 * recommendation-quality (2026-07-01, Move 4) — the deterministic QUALITY GATE that
 * every recommendation passes before it can enter a daily plan or appear as a
 * high-confidence Ready action. PURE, no I/O, no LLM. NOT a recommendation engine — a
 * quality-control layer that COMPOSES the existing checks (relevance-gate intent fit,
 * draft-quality copy gate, safe-answer-block factual firewall) and adds the gaps the
 * real failures exposed: action↔goal consistency (year-intent omission), sibling-page
 * ownership, lever eligibility (proof-blocked / protected control / contamination),
 * internal-link alignment, and origin-definitiveness cautions.
 *
 * Decisions separate HARD vetoes (rejected / needs_evidence) from SOFT cautions
 * (approved_with_caution). Reason codes are stable + internal; the UI translates them.
 * Pinned by recommendation-quality.test.ts + the adversarial regression corpus.
 */
import { internalLinkRelevance } from "@/domains/evidence/relevance-gate";
import { evaluateDraftQuality, evaluateTitleMetaQuality, evaluateInternalLinkQuality, DEFAULT_CONTEXT_TOKENS } from "@/domains/drafts/draft-quality";
import { checkAnswerFactualSafety } from "@/domains/experiments/safe-answer-block";

const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "on", "with", "flag", "page", "iran", "iranian"]);
/** Distinctive tokens from a page label, so the copy gate checks a meta/title against the
 *  PAGE's own entity (e.g. "umayyad", "caliphate") — not only a fixed global vocabulary.
 *  Tenant-agnostic: derived from the label, never hard-coded. */
function pageEntityTokens(label: string): string[] {
  return (label || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

export type QualityDecision =
  | "approved"
  | "approved_with_caution"
  | "needs_revision"
  | "rejected"
  | "needs_evidence";

/** Stable internal reason codes (never rendered raw — the UI translates). */
export type QualityReasonCode =
  | "wrong_page_intent"
  | "query_action_mismatch"
  | "year_intent_incomplete"
  | "unsupported_fact"
  | "fact_contradicted"
  | "destination_irrelevant"
  | "anchor_destination_mismatch"
  | "self_link"
  | "duplicate_link"
  | "proof_blocked_lever"
  | "active_measurement_conflict"
  | "protected_control"
  | "measurement_insufficient"
  | "verification_unsupported"
  | "generic_template"
  | "unsupported_scope_promise"
  | "missing_page_content"
  | "sibling_ownership_conflict"
  | "definitive_origin_claim"
  | "directional_measurement"
  | "thin_or_malformed"
  | "no_meaningful_change";

// "refresh" (item 56): a fading page's new-section pick. Its proposedText is a short HEADING,
// not long-form copy, so it deliberately takes only the generic gates (intent fit, proof
// blocks, origin claims) - neither the section word-floor nor the title/meta length rules.
export type QualityLever = "meta" | "title" | "h1" | "internal_link" | "answer_block" | "schema" | "section" | "new_page" | "cro" | "refresh";

export type RecommendationInput = {
  lever: QualityLever;
  pagePath: string;
  pageLabel: string;
  targetQuery: string;
  currentText?: string | null;
  proposedText: string;
  /** Does THIS page own the target query (false ⇒ a sibling/other page owns it)? Default true. */
  pageOwnsQuery?: boolean;
  siblingOwnerLabel?: string | null;
  // internal-link specifics
  destinationPath?: string | null;
  destinationLabel?: string | null;
  anchorText?: string | null;
  sourceSentence?: string | null;
  // answer-block specifics
  sourceSentences?: string[];
  answerAtTop?: boolean;
  // lever eligibility (from proof + topology)
  proofBlockedLevers?: string[];
  isProtectedControl?: boolean;
  pageMeasuringSameLever?: boolean;
  controlsAvailable?: number;
  minControls?: number;
  strategy?: "balanced" | "growth" | "clean";
  verifiable?: boolean;
  /** Measurement is directional only (e.g. new page / CRO) — surfaced as a caution. */
  directionalOnly?: boolean;
};

export type QualityCheck = { code: QualityReasonCode; severity: "hard" | "soft"; detail: string };

export type RecommendationQualityResult = {
  decision: QualityDecision;
  score: number; // 0..100, for ranking only — never the sole gate
  hardFailures: QualityCheck[];
  cautions: QualityCheck[];
  checks: QualityCheck[];
  operatorReason: string; // friendly, no raw codes
  version: string;
};

export const RECOMMENDATION_QUALITY_VERSION = "rq-1";

const YEAR = /\b(1[5-9]\d{2}|20\d{2})\b/;
const WHERE_INTENT = /\b(where is|where are|located|location of)\b/i;
const COMPARISON_INTENT = /\b(vs\.?|versus|compared|difference between)\b/i;
/** Definitive cultural/religious/historical ORIGIN claims that should be qualified. */
const DEFINITIVE_ORIGIN = /\b(rooted in|originated (?:in|from)|derives? from|stems from|descend(?:s|ed) from)\b/i;
const ORIGIN_DOMAIN = /\b(zoroastrian|islam(?:ic)?|christian|jewish|pagan|ancient|mytholog|religio|dynast)/i;

function friendly(code: QualityReasonCode, detail: string): string {
  const map: Record<QualityReasonCode, string> = {
    wrong_page_intent: "This doesn’t match what the page is about.",
    query_action_mismatch: "The change doesn’t accomplish what the target search needs.",
    year_intent_incomplete: "The search asks about a specific year, but the answer doesn’t give it.",
    unsupported_fact: "A factual claim here needs supporting evidence first.",
    fact_contradicted: "A claim here looks factually wrong.",
    destination_irrelevant: "The linked page isn’t related to this page.",
    anchor_destination_mismatch: "The link text doesn’t describe where it points.",
    self_link: "This links the page to itself.",
    duplicate_link: "This link already exists nearby.",
    proof_blocked_lever: "Beacon already measured this kind of change here and it didn’t help.",
    active_measurement_conflict: "This page is already measuring a change — a second one would muddy the proof.",
    protected_control: "This page is a comparison control for a live experiment.",
    measurement_insufficient: "There aren’t enough comparison pages to measure this honestly.",
    verification_unsupported: "Beacon can’t confirm this change on the live page.",
    generic_template: "This is a generic template, not a specific improvement.",
    unsupported_scope_promise: "This promises more than the page actually delivers.",
    missing_page_content: "The page doesn’t have the content this change assumes.",
    sibling_ownership_conflict: "This belongs to a different (sibling) page.",
    definitive_origin_claim: "This states a contested origin as settled fact.",
    directional_measurement: "Measurement will be directional, not a clean comparison.",
    thin_or_malformed: "The proposed text is too thin or malformed.",
    no_meaningful_change: "This isn’t a meaningful change from what’s already there.",
  };
  return detail || map[code];
}

function hard(code: QualityReasonCode, detail = ""): QualityCheck { return { code, severity: "hard", detail: friendly(code, detail) }; }
function soft(code: QualityReasonCode, detail = ""): QualityCheck { return { code, severity: "soft", detail: friendly(code, detail) }; }

/** The single quality reviewer. PURE. Composes the existing gates + Move-4 checks. */
export function reviewRecommendation(input: RecommendationInput): RecommendationQualityResult {
  const hardFailures: QualityCheck[] = [];
  const cautions: QualityCheck[] = [];
  let needsEvidence = false;
  let needsRevision = false;
  const proposed = (input.proposedText ?? "").trim();
  const query = (input.targetQuery ?? "").trim();

  // ── A. PAGE–QUERY INTENT FIT ────────────────────────────────────────────────
  if (input.pageOwnsQuery === false) {
    hardFailures.push(hard("sibling_ownership_conflict", input.siblingOwnerLabel ? `“${query}” belongs to ${input.siblingOwnerLabel}.` : ""));
  } else if (query) {
    // Reuse the relevance gate: does the change topic relate to the page topic?
    const fit = internalLinkRelevance(query, input.pageLabel);
    if (!fit.relevant) hardFailures.push(hard("wrong_page_intent", `“${query}” doesn’t share a distinctive term with “${input.pageLabel}”.`));
  }

  // ── B. LEVER ELIGIBILITY ────────────────────────────────────────────────────
  if (input.isProtectedControl) hardFailures.push(hard("protected_control"));
  if (input.pageMeasuringSameLever) hardFailures.push(hard("active_measurement_conflict"));
  if ((input.proofBlockedLevers ?? []).includes(input.lever)) hardFailures.push(hard("proof_blocked_lever"));
  if (input.verifiable === false) hardFailures.push(hard("verification_unsupported"));
  if (input.controlsAvailable != null) {
    const min = input.minControls ?? 2;
    if (input.strategy === "clean" && input.controlsAvailable < min) hardFailures.push(hard("measurement_insufficient", `${input.controlsAvailable} clean controls, need ${min}.`));
    else if (input.controlsAvailable < min) cautions.push(soft("measurement_insufficient", `${input.controlsAvailable} comparison page(s).`));
  }
  if (input.directionalOnly) cautions.push(soft("directional_measurement"));

  // ── C. ACTION–GOAL CONSISTENCY ──────────────────────────────────────────────
  // Year-intent: the query names a specific year; the answer/meta must include it.
  const yearInQuery = query.match(YEAR);
  if (yearInQuery && !YEAR.test(proposed)) {
    // Only a hard failure for answer/meta/title levers where the copy IS the answer.
    if (input.lever === "answer_block" || input.lever === "meta" || input.lever === "title") {
      hardFailures.push(hard("year_intent_incomplete", `Search names ${yearInQuery[0]}; the copy omits it.`));
    }
  }
  if (WHERE_INTENT.test(query) && input.lever === "answer_block") {
    // a "where is" answer should name a place (very light heuristic: a capitalized place token in proposed)
    const hasPlace = /[A-Z][a-z]+/.test(proposed);
    if (!hasPlace) cautions.push(soft("query_action_mismatch", "A “where is” search expects a place in the answer."));
  }
  if (COMPARISON_INTENT.test(query) && input.lever === "answer_block") {
    cautions.push(soft("query_action_mismatch", "A comparison search expects both items contrasted."));
  }

  // ── D/E/H. COPY QUALITY + FACTUAL (reuse draft-quality + answer firewall) ────
  // The copy gate checks the proposed text against the page's OWN entity tokens + the
  // default vocabulary, so a meta that names "Umayyad Caliphate" isn't falsely read as
  // "dropped the entity" just because the global list lacks that dynasty.
  const contextTokens = [...DEFAULT_CONTEXT_TOKENS, ...pageEntityTokens(input.pageLabel)];
  if (input.lever === "meta" || input.lever === "title" || input.lever === "h1") {
    const dq = evaluateTitleMetaQuality({ after: proposed, before: input.currentText ?? null, field: input.lever === "meta" ? "meta" : "title", query, contextTokens });
    mapDraftStatus(dq.status, dq.reasons, hardFailures, cautions, (n) => { needsRevision = needsRevision || n; });
  } else if (input.lever === "section") {
    // Sections are long-form — the draft-quality word floor + generic/relevance checks apply.
    const dq = evaluateDraftQuality({ answer: proposed, query, topicLabel: input.pageLabel, contextTokens });
    mapDraftStatus(dq.status, dq.reasons, hardFailures, cautions, (n) => { needsRevision = needsRevision || n; });
  } else if (input.lever === "answer_block") {
    // Answer blocks are INTENTIONALLY concise (the safe lever caps 6–45 words), so the
    // long-form word floor does NOT apply. Gate on: real text, the factual firewall,
    // and answer placement. Intent/year/origin checks already ran above.
    if (proposed.split(/\s+/).filter(Boolean).length < 4) hardFailures.push(hard("thin_or_malformed", "Answer is too short to be useful."));
    if (input.sourceSentences && input.sourceSentences.length > 0) {
      const safety = checkAnswerFactualSafety(proposed, input.sourceSentences);
      if (!safety.passed) { needsEvidence = true; cautions.push(soft("unsupported_fact", safety.reasons[0] ?? "Claim not supported by the page text.")); }
    }
    if (input.answerAtTop === false) cautions.push(soft("query_action_mismatch", "The answer isn’t near the top of the page."));
  } else if (input.lever === "internal_link") {
    // ── F. INTERNAL-LINK QUALITY ──────────────────────────────────────────────
    const destPath = (input.destinationPath ?? "").trim();
    if (destPath && destPath === input.pagePath.trim()) hardFailures.push(hard("self_link"));
    if (input.destinationLabel) {
      const linkFit = internalLinkRelevance(query || input.pageLabel, input.destinationLabel);
      if (!linkFit.relevant) hardFailures.push(hard("destination_irrelevant", `“${input.pageLabel}” → “${input.destinationLabel}” share no distinctive term.`));
      if (input.anchorText) {
        const anchorFit = internalLinkRelevance(input.anchorText, input.destinationLabel);
        if (!anchorFit.relevant) hardFailures.push(hard("anchor_destination_mismatch", `Anchor “${input.anchorText}” doesn’t describe “${input.destinationLabel}”.`));
      }
    }
    const dq = evaluateInternalLinkQuality({ sourcePage: input.pageLabel, targetPage: input.destinationLabel ?? input.destinationPath ?? "", anchorText: input.anchorText ?? "", linkSentence: input.sourceSentence ?? "" });
    mapDraftStatus(dq.status, dq.reasons, hardFailures, cautions, (n) => { needsRevision = needsRevision || n; });
  }

  // ── Origin-definitiveness caution (any text lever): a contested cultural/religious
  //    origin stated as settled fact should be qualified, not rejected. ──
  if (DEFINITIVE_ORIGIN.test(proposed) && ORIGIN_DOMAIN.test(proposed)) {
    cautions.push(soft("definitive_origin_claim", "State the origin as widely associated/believed, not settled."));
  }

  // ── no-meaningful-change: proposed equals current (text levers) ──
  if (input.currentText && proposed && norm(proposed) === norm(input.currentText)) {
    needsRevision = true;
    cautions.push(soft("no_meaningful_change"));
  }

  // ── Decide (hard veto first; needs_evidence before caution) ──
  const checks = [...hardFailures, ...cautions];
  let decision: QualityDecision;
  if (hardFailures.length > 0) decision = hardFailures.some(isRevisable) && !hardFailures.some(isFatal) ? "needs_revision" : "rejected";
  else if (needsEvidence) decision = "needs_evidence";
  else if (needsRevision) decision = "needs_revision";
  else if (cautions.length > 0) decision = "approved_with_caution";
  else decision = "approved";

  const score = scoreOf(decision, cautions.length);
  const operatorReason =
    decision === "approved" ? "Quality checked." :
    decision === "approved_with_caution" ? (cautions[0]?.detail ?? "Approved with a caution.") :
    (hardFailures[0]?.detail ?? cautions[0]?.detail ?? "Needs review.");

  return { decision, score, hardFailures, cautions, checks, operatorReason, version: RECOMMENDATION_QUALITY_VERSION };
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A hard failure that a deterministic rewrite could fix (vs a fatal wrong-page veto). */
function isRevisable(c: QualityCheck): boolean {
  return c.code === "year_intent_incomplete" || c.code === "generic_template" || c.code === "thin_or_malformed";
}
function isFatal(c: QualityCheck): boolean {
  return c.code === "wrong_page_intent" || c.code === "sibling_ownership_conflict" || c.code === "destination_irrelevant" ||
    c.code === "anchor_destination_mismatch" || c.code === "self_link" || c.code === "protected_control" ||
    c.code === "proof_blocked_lever" || c.code === "active_measurement_conflict" || c.code === "fact_contradicted" ||
    c.code === "measurement_insufficient" || c.code === "verification_unsupported";
}

/** Map a draft-quality status onto our hard/soft buckets. */
function mapDraftStatus(
  status: string,
  reasons: string[],
  hardFailures: QualityCheck[],
  cautions: QualityCheck[],
  markRevision: (n: boolean) => void,
): void {
  const detail = reasons[0] ?? "";
  switch (status) {
    case "ready":
      return;
    case "relevance_rejected":
      hardFailures.push(hard("wrong_page_intent", detail)); return;
    case "fact_risk":
    case "unsupported_claim":
      cautions.push(soft("unsupported_fact", detail)); return;
    case "generic_rejected":
      hardFailures.push(hard("generic_template", detail)); markRevision(true); return;
    case "too_thin":
    case "malformed":
      hardFailures.push(hard("thin_or_malformed", detail)); markRevision(true); return;
    case "useful_but_needs_review":
      cautions.push(soft("unsupported_fact", detail)); return;
    case "missing_source":
      cautions.push(soft("unsupported_fact", detail)); return;
    default:
      return;
  }
}

function scoreOf(decision: QualityDecision, cautionCount: number): number {
  if (decision === "rejected") return 0;
  if (decision === "needs_revision") return 25;
  if (decision === "needs_evidence") return 40;
  if (decision === "approved_with_caution") return Math.max(55, 80 - cautionCount * 8);
  return 95;
}

/** Does this result allow the recommendation into a daily plan / high-confidence Ready? */
export function passesDailyGate(r: RecommendationQualityResult): boolean {
  return r.decision === "approved" || r.decision === "approved_with_caution";
}

/** Compact UI label for a decision. */
export function qualityLabel(decision: QualityDecision): string {
  return {
    approved: "Quality checked",
    approved_with_caution: "Quality checked · caution",
    needs_revision: "Needs revision",
    rejected: "Rejected",
    needs_evidence: "Needs factual support",
  }[decision];
}
