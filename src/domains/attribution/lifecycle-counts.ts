/**
 * Phase 6B.1 (2026-04-28) — shared lifecycle-counts helper.
 *
 * Pre-6B.1 the same logical question — "how many edits are in each
 * lifecycle state?" — was answered by three different code paths:
 *   - /today's `buildTodayLifecycleSummary` (today-data.ts) counted
 *     edits directly.
 *   - /changes' classifier (`lifecycle-classification.ts`) counted
 *     CHANGELOG ROWS joined to edits — undercounted when the
 *     accept-fanout never created changelog rows (e.g. Los Altos:
 *     5 accepted edits, 0 changelog rows → /changes Pending: 0,
 *     /today Pending: 5).
 *   - /layout's Changes badge counted Z-score URL watches via
 *     `getWatchingUrlOutcomes()` — completely unrelated to lifecycle.
 *
 * This module is the single source of truth for lifecycle counts.
 * Both /today and /changes' strip read it; /layout switches to it
 * for the Changes badge. Pure module; no UI imports.
 *
 * Canonical truth model:
 *   `recommended_edits.implementation_status` is THE source of truth
 *   for in-flight lifecycle state. `changelog_entries` is the
 *   chronological/audit log — historically not always populated for
 *   accepted edits (Phase 12 fan-out was partial).
 */

import "server-only";

import { getRepository } from "@/lib/persistence/repositories";
import type {
  ImplementationStatus,
  RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";

export type LifecycleCounts = {
  liveVerified: number;
  pendingImplementation: number;
  needsReview: number;
  notFoundAfter7d: number;
  /** Sum of pendingImplementation + needsReview — convenience for the
   *  Changes left-nav badge ("things you need to act on"). */
  actionableTotal: number;
};

export type LifecycleEditBuckets = {
  /** Edits in `accepted` state with no `live_at` — pending operator implementation. */
  pendingEdits: RecommendedEditRow[];
  /** Edits the matcher returned an ambiguous verdict for. */
  needsReviewEdits: RecommendedEditRow[];
  /** Edits the matcher gave up on after 7 days. */
  notFoundAfter7dEdits: RecommendedEditRow[];
  /** Edits already verified live (any variant). */
  liveVerifiedEdits: RecommendedEditRow[];
};

export type LifecycleCountsResult = {
  counts: LifecycleCounts;
  buckets: LifecycleEditBuckets;
  /** All `recommended_edits` rows the helper read — exposed so callers
   *  who already needed them (e.g. /changes page loader) don't have to
   *  re-fetch. */
  allEdits: RecommendedEditRow[];
};

const NEEDS_REVIEW_STATUSES: ReadonlySet<ImplementationStatus> = new Set([
  "needs_review",
  "partially_implemented",
  "wrong_page",
]);

/**
 * Read recommended_edits for a tenant + bucket by lifecycle state.
 * Non-fatal: returns the empty-shape result if the repo throws so
 * callers (badge counts, stripe rendering) don't 500 the whole page.
 */
export async function loadLifecycleCounts(
  tenantId: string,
): Promise<LifecycleCountsResult> {
  const empty: LifecycleCountsResult = {
    counts: {
      liveVerified: 0,
      pendingImplementation: 0,
      needsReview: 0,
      notFoundAfter7d: 0,
      actionableTotal: 0,
    },
    buckets: {
      pendingEdits: [],
      needsReviewEdits: [],
      notFoundAfter7dEdits: [],
      liveVerifiedEdits: [],
    },
    allEdits: [],
  };
  let edits: RecommendedEditRow[];
  try {
    edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  } catch (err) {
    console.error("[lifecycle-counts] recommended_edits read failed", err);
    return empty;
  }
  return computeLifecycleCounts(edits);
}

/**
 * Pure synchronous bucketer — exported for tests and for callers that
 * already hold a RecommendedEditRow[]. The rule set:
 *   verified_live | verified_live_modified  → liveVerified
 *   accepted (no live_at)                   → pendingImplementation
 *   needs_review | partially_implemented |
 *     wrong_page                            → needsReview
 *   not_found_after_7d                      → notFoundAfter7d
 *   dismissed | recommended | undefined     → not counted
 */
export function computeLifecycleCounts(
  edits: readonly RecommendedEditRow[],
): LifecycleCountsResult {
  const buckets: LifecycleEditBuckets = {
    pendingEdits: [],
    needsReviewEdits: [],
    notFoundAfter7dEdits: [],
    liveVerifiedEdits: [],
  };
  for (const edit of edits) {
    const status = edit.implementation_status;
    if (status === "verified_live" || status === "verified_live_modified") {
      buckets.liveVerifiedEdits.push(edit);
    } else if (status === "accepted") {
      buckets.pendingEdits.push(edit);
    } else if (status && NEEDS_REVIEW_STATUSES.has(status)) {
      buckets.needsReviewEdits.push(edit);
    } else if (status === "not_found_after_7d") {
      buckets.notFoundAfter7dEdits.push(edit);
    }
    // dismissed / recommended / undefined deliberately not bucketed.
  }
  const counts: LifecycleCounts = {
    liveVerified: buckets.liveVerifiedEdits.length,
    pendingImplementation: buckets.pendingEdits.length,
    needsReview: buckets.needsReviewEdits.length,
    notFoundAfter7d: buckets.notFoundAfter7dEdits.length,
    actionableTotal:
      buckets.pendingEdits.length + buckets.needsReviewEdits.length,
  };
  return { counts, buckets, allEdits: [...edits] };
}

/**
 * Detect the generator-placeholder pattern in a `proposed_text`. Used
 * to surface the "needs rewrite" badge on /today queue, /changes
 * Pending rows, and /recommendations specific-edit rows.
 *
 * The deterministic generator emits "Draft answer (operator: rewrite)"
 * for FAQ scaffolds the operator must fill in before shipping.
 */
export function editNeedsRewrite(
  edit: Pick<RecommendedEditRow, "proposed_text">,
): boolean {
  const text = edit.proposed_text ?? "";
  return text.includes("Draft answer (operator: rewrite)");
}
