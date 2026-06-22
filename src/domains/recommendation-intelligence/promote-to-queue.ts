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

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
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
// Fusion corroboration (FUSION_ROADMAP item #3, 2026-06-14)
// ---------------------------------------------------------------------------

/**
 * Independent signal CLASSES a target_url can carry. Two candidates on
 * the same page from the SAME class (e.g. gsc_low_ctr + gsc_striking_
 * distance) corroborate only ONCE — they are the same kind of evidence
 * (first-party demand). Corroboration means ≥2 DISTINCT classes.
 *
 * Mapping confirmed from the trigger source (2026-06-14):
 *   • gsc-low-ctr.ts        → "gsc_low_ctr", "gsc_striking_distance"
 *   • gsc-decay.ts          → "gsc_decay"
 *   • clarity-friction.ts   → "clarity_friction"
 *   • GA4 value             → not a trigger; a page carries it when its
 *                             ga4ValueWeight is ABOVE the 1.0 baseline
 *                             (ga4-page-values.ts::ga4ValueWeight returns
 *                             exactly 1.0 for a page with no GA4 mass).
 */
const GSC_DEMAND_SIGNALS: ReadonlySet<string> = new Set([
  "gsc_low_ctr",
  "gsc_striking_distance",
  "gsc_decay",
]);
const CLARITY_FRICTION_SIGNALS: ReadonlySet<string> = new Set([
  "clarity_friction",
]);

/** The GA4 weight is "above baseline" (the page has real value mass)
 *  when it exceeds 1.0. ga4ValueWeight floors at exactly 1.0. A small
 *  epsilon guards float noise. */
const GA4_BASELINE_WEIGHT = 1.0;
const GA4_WEIGHT_EPSILON = 1e-9;

/**
 * Per-target_url COUNT of distinct independent signal classes present
 * across the whole tenant candidate batch. Pure — computed at this seam
 * (the only place the full batch is visible at once) and threaded into
 * the scorer as a scalar so `priority-score.ts` stays I/O-free.
 *
 * Tenant isolation: the batch passed in is already one tenant's
 * candidate set (the loader is tenant-scoped); the GA4 weight map is the
 * same per-tenant map used for the value weight. No cross-tenant read.
 */
export function buildSignalClassCountByUrl(
  triggerCandidates: ReadonlyArray<RecommendationCandidateRow>,
  ga4ValueWeightByUrl?: ReadonlyMap<string, number>,
): Map<string, number> {
  // Accumulate the set of classes per canonicalized URL.
  const classesByUrl = new Map<string, Set<string>>();
  const add = (url: string | null, klass: string): void => {
    if (url == null) return;
    const key = canonicalizeCitationUrl(url) ?? url;
    const set = classesByUrl.get(key) ?? new Set<string>();
    set.add(klass);
    classesByUrl.set(key, set);
  };

  for (const c of triggerCandidates) {
    if (GSC_DEMAND_SIGNALS.has(c.trigger_signal)) add(c.target_url, "gsc_demand");
    else if (CLARITY_FRICTION_SIGNALS.has(c.trigger_signal))
      add(c.target_url, "clarity_friction");
  }

  // GA4-value class: a page counts when its value weight beats baseline,
  // regardless of which trigger fired on it — but only for URLs that
  // already appear in this tenant's candidate batch (the GA4 class only
  // corroborates an existing recommendation; it never invents one).
  if (ga4ValueWeightByUrl != null) {
    for (const c of triggerCandidates) {
      if (c.target_url == null) continue;
      const key = canonicalizeCitationUrl(c.target_url) ?? c.target_url;
      const w = ga4ValueWeightByUrl.get(key);
      if (w != null && w > GA4_BASELINE_WEIGHT + GA4_WEIGHT_EPSILON) {
        add(c.target_url, "ga4_value");
      }
    }
  }

  const out = new Map<string, number>();
  for (const [url, set] of classesByUrl) out.set(url, set.size);
  return out;
}

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
  /** Fusion slice (2026-06-12): bounded GA4 value weight per
   *  CANDIDATE target_url (caller canonicalizes). Optional. */
  ga4ValueWeightByUrl?: ReadonlyMap<string, number>;
  /** Learning-loop slice (#10, 2026-06-22): win-rate-derived priority prior per
   *  action_type, in [-1,+1], computed by the caller from the proof ledger
   *  (computeOutcomePriors). Threaded as a pure map so the scorer does NO I/O.
   *  Absent / no entry ⇒ neutral. */
  outcomePriorByActionType?: ReadonlyMap<string, number>;
  now: Date;
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function selectPromotableCandidates(
  input: SelectPromotableCandidatesInput,
): PromotionResult[] {
  // Fusion corroboration (item #3): one pre-pass over the FULL batch
  // (the only place every candidate is visible) to count the distinct
  // independent signal classes per target_url. Threaded into the scorer
  // as a scalar so priority-score.ts does no I/O.
  const signalClassCountByUrl = buildSignalClassCountByUrl(
    input.triggerCandidates,
    input.ga4ValueWeightByUrl,
  );

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
      upside_clicks_90d: candidate.upside_clicks_90d,
      // Fusion slice (2026-06-12): GA4 page-value weight (neutral
      // when the map is absent/has no entry).
      page_value_weight:
        candidate.target_url != null
          ? input.ga4ValueWeightByUrl?.get(
              canonicalizeCitationUrl(candidate.target_url) ??
                candidate.target_url,
            )
          : undefined,
      // Fusion corroboration slice (item #3, 2026-06-14): the count of
      // distinct independent signal classes this URL carries across the
      // batch. ≥2 ⇒ a bounded additive nudge in the scorer; 0/1 ⇒ no
      // change (the scorer treats absent as 0).
      signal_class_count:
        candidate.target_url != null
          ? signalClassCountByUrl.get(
              canonicalizeCitationUrl(candidate.target_url) ??
                candidate.target_url,
            )
          : undefined,
      // Learning-loop slice (#10, 2026-06-22): how this action_type has
      // performed in past shipped experiments (proof-ledger win rate). Absent
      // map / no entry ⇒ neutral.
      outcome_prior: input.outcomePriorByActionType?.get(candidate.action_type),
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
