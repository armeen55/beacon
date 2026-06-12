/**
 * 2026-05-20 — Slice 4.5.D.α₀a.3b — pure promotion orchestrator
 * + caps.
 *
 * Thin three-stage composition over the 4 already-shipped pure
 * primitives:
 *   • α₀a.1 — `eligibilityForTrigger` + `priorityScore`
 *   • α₀a.2 — `buildPromotionDedupeKey` + `buildPromotionCooldownKey`
 *   • α₀a.3a — `applyPromotionSafetyGates`
 *
 * Pure. No I/O. No mutation. NO imports from `recommended-edits-
 * persistence` or `recommendation-response-store`. NO writes.
 *
 * Surplus rows are PRESERVED in the output (`eligible: false` +
 * cap-specific suppression_reason) so the operator-only
 * Promotion Preview UI (α₀b, future) can show the full picture.
 *
 * Cap suppression reasons (`max_rows_per_page` /
 * `max_rows_per_family`) live in the orchestrator-side
 * `PromotionResultSuppressionReason` union — they do NOT extend
 * the locked α₀a.3a `SuppressionReason` (12 values, pinned by
 * the no-diagnostic-only-promotion invariant).
 */

import type { ActionType } from "@/domains/recommendations/action-types";
import type { PageType } from "@/domains/recommendation-intelligence/page-classifier";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

import type { EligibilityTier } from "@/domains/recommendation-intelligence/promotion-eligibility";
import { priorityScore } from "@/domains/recommendation-intelligence/priority-score";
import {
  buildPromotionCooldownKey,
  buildPromotionDedupeKey,
  type PromotionEditAnchor,
  type PromotionResponseAnchor,
} from "@/domains/recommendation-intelligence/dedupe-cooldown";
import {
  applyPromotionSafetyGates,
  type SuppressionReason,
} from "@/domains/recommendation-intelligence/safety-gates";

// ---------------------------------------------------------------------------
// Locked caps (Section 4.5.O7 + O8)
// ---------------------------------------------------------------------------

/** Pinned by `recommendation-intelligence-max-rows-per-page`. */
export const MAX_ROWS_PER_PAGE = 5;

/** Pinned by `recommendation-intelligence-max-rows-per-family`. */
export const MAX_ROWS_PER_FAMILY = 10;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Extended union for orchestrator output ONLY. The 12-value
 * `SuppressionReason` from `safety-gates.ts` stays locked.
 */
export type PromotionResultSuppressionReason =
  | SuppressionReason
  | "max_rows_per_page"
  | "max_rows_per_family";

export type PromotionResult = {
  candidate: RecommendationCandidateRow;
  tier: EligibilityTier;
  eligible: boolean;
  suppression_reason: PromotionResultSuppressionReason | null;
  cooldown_expires_at: string | null;
  priority_score: number;
  promotion_dedupe_key: string;
  promotion_cooldown_key: string;
};

export type SelectPromotableCandidatesInput = {
  tenantId: string;
  triggerCandidates: ReadonlyArray<RecommendationCandidateRow>;
  recommendedEdits: ReadonlyArray<PromotionEditAnchor>;
  recommendationResponses: ReadonlyArray<PromotionResponseAnchor>;
  /** Caller-computed page type per target_url. Missing entries
   *  resolve to null → content-edit gate fails closed. */
  pageTypeByUrl: ReadonlyMap<string, PageType>;
  now: Date;
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function selectPromotableCandidates(
  input: SelectPromotableCandidatesInput,
): PromotionResult[] {
  // Stage 1 — per-candidate gate + score + key build.
  const stage1: PromotionResult[] = input.triggerCandidates.map((candidate) => {
    const pageType =
      candidate.target_url == null
        ? null
        : input.pageTypeByUrl.get(candidate.target_url) ?? null;

    const outcome = applyPromotionSafetyGates(candidate, {
      tenantId: input.tenantId,
      targetPageType: pageType,
      recommendedEdits: input.recommendedEdits,
      recommendationResponses: input.recommendationResponses,
      // Forward-compat: candidate row has no `prerequisite_key`
      // today; treat absence as "resolved".
      prerequisiteResolved: true,
      now: input.now,
    });

    const score = priorityScore({
      trigger_signal: candidate.trigger_signal,
      action_type: candidate.action_type,
      target_page_type: pageType ?? "other",
      confidence: candidate.confidence,
      prerequisite_resolved: true,
      safety_flags: candidate.safety_flags,
      // Fusion-EV slice (2026-06-12): first-party expected-clicks
      // upside, when the predicate computed one.
      upside_clicks_28d: candidate.upside_clicks_28d,
    });

    const promotion_dedupe_key = buildPromotionDedupeKey({
      tenantId: candidate.tenant_id,
      actionType: candidate.action_type,
      targetUrl: candidate.target_url,
      // Forward-compat slot — candidate row has no element key
      // today. Matches α₀a.3a's safety-gates pattern.
      targetElementKey: null,
      topicClusterLabel: candidate.topic_cluster_label,
    });
    const promotion_cooldown_key = buildPromotionCooldownKey({
      tenantId: candidate.tenant_id,
      actionType: candidate.action_type,
      targetUrl: candidate.target_url,
    });

    return {
      candidate,
      tier: outcome.tier,
      eligible: outcome.eligible,
      suppression_reason: outcome.suppression_reason,
      cooldown_expires_at: outcome.cooldown_expires_at,
      priority_score: score,
      promotion_dedupe_key,
      promotion_cooldown_key,
    };
  });

  // Stage 2 — partition + sort.
  const eligibleRows = stage1.filter((r) => r.eligible);
  const ineligibleRows = stage1.filter((r) => !r.eligible);
  eligibleRows.sort((a, b) => {
    if (b.priority_score !== a.priority_score) {
      return b.priority_score - a.priority_score;
    }
    return a.promotion_dedupe_key.localeCompare(b.promotion_dedupe_key);
  });

  // Stage 3 — caps. Iterate eligibles in priority order. Surplus
  // rows flip to eligible: false with cap-specific suppression.
  // Per-page check runs BEFORE per-family check.
  const perPage = new Map<string, number>();
  const perFamily = new Map<ActionType, number>();
  const capped: PromotionResult[] = [];
  for (const row of eligibleRows) {
    const pageKey = row.candidate.target_url ?? "no_url";
    const familyKey = row.candidate.action_type;
    const pageCount = perPage.get(pageKey) ?? 0;
    const familyCount = perFamily.get(familyKey) ?? 0;
    if (pageCount >= MAX_ROWS_PER_PAGE) {
      capped.push({
        ...row,
        eligible: false,
        suppression_reason: "max_rows_per_page",
      });
      continue;
    }
    if (familyCount >= MAX_ROWS_PER_FAMILY) {
      capped.push({
        ...row,
        eligible: false,
        suppression_reason: "max_rows_per_family",
      });
      continue;
    }
    perPage.set(pageKey, pageCount + 1);
    perFamily.set(familyKey, familyCount + 1);
    capped.push(row);
  }

  return [...capped, ...ineligibleRows];
}
