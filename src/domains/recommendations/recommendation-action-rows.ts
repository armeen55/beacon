/**
 * QA-verdict row shapes (CORE 100K Lane D, 2026-07-21).
 *
 * This module once built the /recommendations ranked action table
 * (`buildRecommendationActionRows`, ~2,300 lines). That page is now a redirect
 * stub to /changes, and the table builder's last production consumer was the
 * push gate, which only ever read the deterministic QA verdict
 * (`recommendation-qa.ts`). The table machinery is deleted; what survives here
 * is:
 *
 *   - `ActionRowType` + `actionRowTypeForEdit`: the customer-facing action
 *     taxonomy and the `ActionType` mapping that drives the QA's
 *     push-readiness classification.
 *   - `RecommendationActionRow`: the minimal row shape
 *     `buildRecommendationQaVerdict` and `deriveRowTopicFit` read. Assembled
 *     by `load-action-row-by-edit.ts` from a persisted edit at push time.
 *   - `computeEvidenceDepth`: the grounding-category counter feeding
 *     `deriveConfidence`, pinned against the persisted queue.
 *
 * Pure / deterministic. No I/O. No React.
 */

import type { ActionType } from "./action-types";
import type { SpecificEditEvidenceRef } from "./specific-edit-provider";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

// ── Type system ─────────────────────────────────────────────────────────

/**
 * Operator-facing action category. Ten visible types + meta-actions
 * (review_decision / regenerate_edit) for recs that need operator judgment
 * instead of a copy-paste edit. The QA layer keys push readiness off this
 * (paste_ready / manual / review_only).
 */
export type ActionRowType =
  | "create_page"
  | "edit_h1"
  | "edit_h2"
  | "edit_title"
  | "edit_meta"
  | "add_schema"
  | "add_faq"
  | "add_section"
  | "improve_copy"
  | "add_internal_links"
  | "add_comparison_table"
  | "technical_fix"
  | "review_decision"
  | "regenerate_edit";

/**
 * The minimal row-shaped input the deterministic QA verdict reads
 * (`buildRecommendationQaVerdict` + `deriveRowTopicFit`). The full table row
 * died with the /recommendations table; this is the surviving contract.
 */
export type RecommendationActionRow = {
  readonly actionType: ActionRowType;
  /** Clean target label ("Whole Home Remodel page" / "Homepage"). */
  readonly targetLabel: string;
  /** Resolved target URL (or null for new-page targets). */
  readonly targetUrl: string | null;
  readonly detail: {
    /** Exact "after" copy the operator would ship. Null for meta-actions. */
    readonly proposedText: string | null;
    /** Operator-readable motive label (drives the QA's "why this exists"). */
    readonly motiveLabel: string | null;
    /** What Beacon will watch after acceptance. */
    readonly measurementPlan: string | null;
    /** AI-answer observation count (denormalized from rec.evidence). */
    readonly observationCount: number;
    /** Top REAL competitor with their primary share, when present. */
    readonly topCompetitor: { name: string; primaryPct: number } | null;
    /** Number-rich Google Search evidence bullets (may be absent). */
    readonly gscEvidenceLines?: ReadonlyArray<EvidenceLine>;
    /** Microsoft Clarity friction evidence bullets (may be absent). */
    readonly clarityEvidenceLines?: ReadonlyArray<EvidenceLine>;
    /** AI-answer gap evidence bullets (may be absent). */
    readonly aeoEvidenceLines?: ReadonlyArray<EvidenceLine>;
  };
};

/**
 * Map an `ActionType` (specific-edit taxonomy) to the operator-facing
 * `ActionRowType`. Multiple action types may collapse into one row
 * type: e.g., `add_h2_section` and `rewrite_h2` both map to `edit_h2`.
 */
export function actionRowTypeForEdit(actionType: ActionType): ActionRowType {
  switch (actionType) {
    case "edit_title":
      return "edit_title";
    case "edit_meta":
      return "edit_meta";
    case "change_h1":
      return "edit_h1";
    case "add_h2_section":
    case "rewrite_h2":
    // full_rewrite (BEACON 500 item 61, 2026-07-02): agentic section rewrites
    // target an h2-delimited section, same shape as rewrite_h2.
    case "full_rewrite":
      return "edit_h2";
    case "add_faq":
    case "rewrite_faq":
      return "add_faq";
    case "add_schema":
    case "fix_schema":
      return "add_schema";
    case "add_internal_link":
      return "add_internal_links";
    case "add_proof_section":
    case "add_cost_section":
    case "add_timeline_section":
    case "add_answer_block":
      return "add_section";
    case "add_comparison_section":
    case "add_table":
      return "add_comparison_table";
    case "edit_table_row":
      return "improve_copy";
    case "reorder_sections":
      return "technical_fix";
    case "create_page":
      return "create_page";
    case "split_page":
    case "merge_pages":
      return "review_decision";
    case "watch":
      return "review_decision";
    // Off-site / manual action types (Section 7 C7b, 2026-05-16) are
    // operator tasks, not publishable copy: review_decision keeps them
    // out of the paste-ready push path.
    case "claim_gbp":
    case "optimize_gbp_profile":
    case "request_gbp_reviews":
    case "claim_or_optimize_houzz":
    case "claim_or_optimize_yelp":
    case "submit_to_industry_directory":
    case "pursue_local_pr":
      return "review_decision";
    // Registry-expansion arms (Slice 4.5.B/C, 2026-05-19): every entry
    // carries generatorActive: false, so no production path emits these
    // today; the exhaustive switch stays honest.
    case "update_intro":
    case "add_h3_section":
    case "add_image_alt_text":
      return "review_decision";
    case "fix_sitemap":
    case "fix_robots":
    case "fix_noindex":
    case "fix_status_code":
    case "fix_canonical":
      return "review_decision";
    // Clarity fuse (2026-06-13): page-experience defects are an
    // investigation task, never a paste-ready push.
    case "fix_page_experience":
      return "review_decision";
    // improve_meta (2026-06-16): NON-PUSHABLE directive (the owner writes a
    // meta + often expands the page). Maps to review_decision, NOT
    // edit_meta: the proposed_text is instruction prose, never offered as a
    // pasteable / publishable meta string.
    case "improve_meta":
      return "review_decision";
  }
}

/**
 * T4.2 (2026-05-06): evidence-depth counter: how many distinct
 * grounding-signal categories an evidence array carries. The categories
 * tracked match the structural sources the abstention contract (T4.1)
 * considers grounding:
 *
 *   - prompt: at least one prompt evidence ref → +1
 *   - multi-prompt bonus: ≥2 prompt refs → +1
 *   - owned_page: at least one owned-page evidence ref → +1
 *   - competitor: at least one competitor evidence ref → +1
 *   - element: at least one page-element evidence ref → +1
 *   - prior_outcome: at least one prior-outcome evidence ref → +1
 *
 * Returns 0..6. Higher = richer evidence. Feeds `deriveConfidence`
 * (derived-confidence.ts), which is pinned against the persisted queue by
 * tests/persistence/derived-confidence-against-ritz-queue.test.ts. Pure.
 */
export function computeEvidenceDepth(
  evidenceRefs: ReadonlyArray<SpecificEditEvidenceRef>,
): number {
  let promptCount = 0;
  let ownedPageCount = 0;
  let competitorCount = 0;
  let elementCount = 0;
  let priorOutcomeCount = 0;
  for (const ref of evidenceRefs) {
    switch (ref.type) {
      case "prompt":
        promptCount += 1;
        break;
      case "owned_page":
        ownedPageCount += 1;
        break;
      case "competitor":
        competitorCount += 1;
        break;
      case "element":
        elementCount += 1;
        break;
      case "prior_outcome":
        priorOutcomeCount += 1;
        break;
    }
  }
  let depth = 0;
  if (promptCount > 0) depth += 1;
  if (promptCount >= 2) depth += 1; // multi-prompt bonus
  if (ownedPageCount > 0) depth += 1;
  if (competitorCount > 0) depth += 1;
  if (elementCount > 0) depth += 1;
  if (priorOutcomeCount > 0) depth += 1;
  return depth;
}
