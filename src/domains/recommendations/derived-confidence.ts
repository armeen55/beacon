/**
 * Derived confidence label — Trust Sprint Mini-Phase T4.4 (2026-05-06).
 *
 * Per the Trust Sprint Phase 2.B audit: every shipped recommendation
 * row in production carries `confidence: "medium"`. The label is
 * therefore meaningless as a trust signal — the operator cannot tell
 * a thin single-prompt row from a multi-prompt + owned-page + competitor
 * row by looking at confidence.
 *
 * T4.4 fixes this WITHOUT mutating existing rows:
 *
 *   - Pure derivation from row-level signals already wired in T4.2:
 *     evidence depth, affected-prompt count, owned-page presence,
 *     competitor presence, AI-search-query presence, multi-prompt
 *     evidence, brand-assertion presence, FAQ-answer thinness.
 *
 *   - Customer-safe labels (NOT raw "high/medium/low"):
 *       "Strong evidence"   — multi-prompt + owned-page + at least one
 *                             of: competitor / search query / brand assertion
 *       "Moderate evidence" — at least 2 grounding categories present
 *                             (e.g., multi-prompt + competitor; single-
 *                             prompt + owned-page + competitor)
 *       "Needs review"      — single-prompt thin grounding, OR FAQ
 *                             answer with no stronger grounding (mirrors
 *                             abstention-contract Rule D), OR row hits
 *                             abstention-contract Rule B / C if computed
 *                             on the row's evidence array.
 *
 * Honesty contract:
 *   - "Strong evidence" requires at LEAST 4 of the 6 evidence depth
 *     categories present (T4.2's `computeEvidenceDepth` >= 4).
 *   - "Needs review" is the floor for any row whose evidence is too
 *     thin to ship without operator inspection. Never gets re-labeled
 *     as Moderate by some env flag.
 *   - Operator may still ship a "Needs review" rec; the label is a
 *     signal, not a gate. The actual ship/abstain gate lives in the
 *     T4.1 validator path.
 */

import type { SpecificEditEvidenceRef } from "./specific-edit-provider";

export type DerivedConfidenceLabel =
  | "strong_evidence"
  | "moderate_evidence"
  | "needs_review";

/**
 * Customer-facing display strings. Operator-locked phrasing.
 */
export const DERIVED_CONFIDENCE_DISPLAY: Record<
  DerivedConfidenceLabel,
  string
> = {
  strong_evidence: "Strong evidence",
  moderate_evidence: "Moderate evidence",
  needs_review: "Needs review",
};

/**
 * One-sentence operator-safe explanation per label. Used by tooltips +
 * the rec drawer's confidence section.
 */
export const DERIVED_CONFIDENCE_EXPLANATION: Record<
  DerivedConfidenceLabel,
  string
> = {
  strong_evidence:
    "Grounded in multiple prompts, an owned page, and at least one of: competitor pressure, AI search-query signal, or a brand assertion — or strong first-party Google Search demand for this page.",
  moderate_evidence:
    "At least two grounding signals present (or meaningful first-party Google Search demand for this page), but missing one major category — e.g., no owned-page match, or single-prompt only.",
  needs_review:
    "Thin grounding — single prompt without supporting structural signals. Operator inspection recommended before shipping.",
};

export type DeriveConfidenceInput = {
  /** Evidence refs from the persisted row (or the live packet). */
  evidenceRefs: ReadonlyArray<SpecificEditEvidenceRef>;
  /** Evidence depth score from T4.2 (`computeEvidenceDepth`). 0..6. */
  evidenceDepth: number;
  /** Affected-prompt count (denormalized to row.detail). */
  affectedPromptCount: number;
  /** Whether the row's `target_element_key` is a `faq_answer[…]:…`. */
  isFaqAnswer: boolean;
  /** Top competitor presence (signal even when competitor refs missing). */
  hasTopCompetitor: boolean;
  /**
   * Pivot 2026-06-13 — first-party Google Search demand for the target
   * page (28-day impressions, from `gscSignal.impressions28d`). Real
   * search demand is strong first-party evidence that exists
   * INDEPENDENTLY of AI-citation grounding: a page Google shows for
   * queries thousands of times is not "thin" just because few AI
   * prompts cite it. It can only RAISE the label, never lower it — so
   * a demand-backed card never reads "Needs more evidence". Thresholds
   * mirror the `priorityForRow` GSC floors. Optional / undefined when
   * the page has no GSC signal (label falls back to the AEO rubric).
   */
  gscImpressions?: number;
};

/** First-party Google Search demand thresholds (mirror priorityForRow). */
const GSC_STRONG_IMPRESSIONS = 1000;
const GSC_MODERATE_IMPRESSIONS = 200;

/**
 * Pure derivation. Same input → same output.
 *
 * First-party Google Search demand is applied as a FLOOR on top of the
 * AEO-evidence rubric: it can raise the label (heavy demand → Strong;
 * meaningful demand rescues an otherwise-thin row from "Needs review")
 * but never lowers an already-strong AEO grounding.
 */
export function deriveConfidence(
  input: DeriveConfidenceInput,
): DerivedConfidenceLabel {
  const gscImpressions = input.gscImpressions ?? 0;
  // Heavy first-party demand is strong evidence on its own.
  if (gscImpressions >= GSC_STRONG_IMPRESSIONS) return "strong_evidence";

  const base = deriveAeoConfidence(input);
  // Meaningful demand prevents a "Needs review" floor — the page is
  // provably trafficked even when AI-citation grounding is thin.
  if (base === "needs_review" && gscImpressions >= GSC_MODERATE_IMPRESSIONS) {
    return "moderate_evidence";
  }
  return base;
}

/**
 * AEO-evidence rubric (prompts / owned-page / competitor / search-query
 * / brand-assertion / evidence-depth). The first-party-demand floor in
 * `deriveConfidence` wraps this.
 */
function deriveAeoConfidence(
  input: DeriveConfidenceInput,
): DerivedConfidenceLabel {
  const refs = input.evidenceRefs ?? [];
  const promptCount = refs.filter((r) => r.type === "prompt").length;
  const ownedPageCount = refs.filter((r) => r.type === "owned_page").length;
  const competitorCount = refs.filter((r) => r.type === "competitor").length;
  // search_query / brand_assertion are not in the persisted union today
  // but the helper supports them when they arrive (mirrors T4.3).
  const searchQueryCount = refs.filter(
    (r) => (r as { type: string }).type === "search_query",
  ).length;
  const brandAssertionCount = refs.filter(
    (r) => (r as { type: string }).type === "brand_assertion",
  ).length;

  const hasMultiPrompt = promptCount >= 2 || input.affectedPromptCount >= 2;
  const hasOwnedPage = ownedPageCount > 0;
  const hasCompetitor = competitorCount > 0 || input.hasTopCompetitor;
  const hasSearchQuery = searchQueryCount > 0;
  const hasBrandAssertion = brandAssertionCount > 0;

  // ── Strong: multi-prompt + owned page + at least one supporting signal ──
  if (hasMultiPrompt && hasOwnedPage && (hasCompetitor || hasSearchQuery || hasBrandAssertion)) {
    return "strong_evidence";
  }
  // Or a high evidence depth (≥ 4) regardless of which mix.
  if (input.evidenceDepth >= 4) {
    return "strong_evidence";
  }

  // ── Needs review: thin single-prompt rows without supporting signals ──
  // FAQ answer with single prompt + no owned page + no competitor + no
  // search query + no brand assertion mirrors T4.1 abstention rule D.
  if (input.isFaqAnswer) {
    if (
      !hasMultiPrompt &&
      !hasOwnedPage &&
      !hasCompetitor &&
      !hasSearchQuery &&
      !hasBrandAssertion
    ) {
      return "needs_review";
    }
  }
  // Single-prompt row with NO grounding categories at all.
  if (
    !hasMultiPrompt &&
    !hasOwnedPage &&
    !hasCompetitor &&
    !hasSearchQuery &&
    !hasBrandAssertion
  ) {
    return "needs_review";
  }
  // Single-prompt row with only ONE grounding category (and it's
  // depth=1 just from prompt). Treat as needs_review unless evidence
  // depth ≥ 2 (which means the multi-prompt bonus or another category
  // kicked in). hasTopCompetitor (sourced from rec-level evidence)
  // counts as an additional grounding signal even when the row's
  // competitorRefs is empty — operator-locked since topCompetitor is
  // surfaced on the row's customer-facing evidence panel.
  const effectiveDepth = input.evidenceDepth + (hasCompetitor && competitorCount === 0 ? 1 : 0);
  if (effectiveDepth <= 1) {
    return "needs_review";
  }

  // ── Default: moderate evidence ──
  return "moderate_evidence";
}
