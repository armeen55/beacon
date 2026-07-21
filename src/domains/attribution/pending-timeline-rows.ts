/**
 * pending-timeline-rows (folded 2026-07-21, repository diet) - the merged live
 * slice of the former lifecycle-counts.ts + synthesize-pending-changelog.ts
 * (both Phase 6B.1, 2026-04-28). Sole consumer: the /results timeline
 * (src/app/(shell)/changes/results-timeline.tsx), which needs two things:
 *
 *   1. Bucket recommended_edits by lifecycle state (computeLifecycleCounts) so
 *      pending / needs-review edits can be surfaced even when the accept
 *      fan-out never wrote a changelog row (the Los Altos bug: 5 accepted
 *      edits, 0 changelog rows, /changes Pending showed 0).
 *   2. Synthesize ChangelogEntry-shaped rows for those edits at render time
 *      (buildSyntheticChangelogRows) so the classifier buckets them as
 *      pending_implementation. No data write; synthetic rows exist only in the
 *      request render path, with deterministic ids so React keys stay stable.
 *
 * NOTE: the SHARED one-count-rule lifecycle classifier every surface's badge
 * counts read is src/domains/changes/lifecycle-counts.ts, a different module.
 * The async repo-reading loader and the deprecated buildSyntheticPendingRows
 * alias that used to live here were deleted as dead. Pure module, no I/O.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type {
  ImplementationStatus,
  RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";

export type LifecycleCounts = {
  liveVerified: number;
  pendingImplementation: number;
  needsReview: number;
  notFoundAfter7d: number;
  /** Sum of pendingImplementation + needsReview. */
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
  /** All rows passed in — exposed so callers don't have to re-fetch. */
  allEdits: RecommendedEditRow[];
};

const NEEDS_REVIEW_STATUSES: ReadonlySet<ImplementationStatus> = new Set([
  "needs_review",
  "partially_implemented",
  "wrong_page",
]);

/**
 * Pure synchronous bucketer. The rule set:
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
 * Detect the generator-placeholder pattern in a `proposed_text` — the
 * deterministic generator emits "Draft answer (operator: rewrite)" for FAQ
 * scaffolds the operator must fill in before shipping.
 */
export function editNeedsRewrite(
  edit: Pick<RecommendedEditRow, "proposed_text">,
): boolean {
  const text = edit.proposed_text ?? "";
  return text.includes("Draft answer (operator: rewrite)");
}

/** The internal sentinel `source_system` value used by synthetic pending rows
 *  (not a persisted value). Exposed so callers/tests can identify them. */
export const LIFECYCLE_PENDING_SOURCE_SYSTEM = "lifecycle_pending";

/**
 * Synthesize a ChangelogEntry from a pending `recommended_edits` row. The
 * output is shaped exactly like a real changelog entry — same fields, same
 * nullability — so downstream consumers (classifier, renderer) treat it
 * indistinguishably. `id` = the edit's deterministic id, so two render passes
 * produce the same synthetic row and React keys stay stable.
 */
export function synthesizePendingChangelog(
  edit: RecommendedEditRow,
): ChangelogEntry {
  const description = (() => {
    if (edit.proposed_text && edit.proposed_text.trim().length > 0) {
      return edit.proposed_text.trim().slice(0, 240);
    }
    return edit.action_type;
  })();
  const assetName = edit.display_label ?? edit.action_type;
  return {
    id: edit.id,
    timestamp: edit.updated_at,
    signal_type: "content",
    asset_type: "service_page",
    url: edit.target_url ?? null,
    asset_name: assetName,
    change_description: description,
    topic_targeted: edit.rec_id,
    city_targeted: null,
    hypothesis: edit.why?.slice(0, 240) ?? null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: edit.created_at,
    updated_at: edit.updated_at,
    source_system: LIFECYCLE_PENDING_SOURCE_SYSTEM,
    archived: false,
    source_rec_id: edit.rec_id,
    action_type: edit.action_type,
    target_element_key: edit.target_element_key ?? undefined,
    live_at: null,
    tenant_id: edit.tenant_id,
  };
}

/**
 * Given the full set of real changelog entries + a set of edits to synthesize
 * for, return only the synthetic rows for edits that don't already have a
 * matching changelog entry (by deterministic id, with the canonical join
 * triple as a fallback). Idempotent: re-running with the same inputs produces
 * the same output (same `id`s). Verified-live edits should NOT be passed in —
 * they always have a real changelog row by construction.
 */
export function buildSyntheticChangelogRows(input: {
  changelogEntries: readonly ChangelogEntry[];
  editsToSynthesize: readonly RecommendedEditRow[];
}): ChangelogEntry[] {
  const seenIds = new Set(input.changelogEntries.map((c) => c.id));
  const seenJoinKeys = new Set(
    input.changelogEntries
      .map((c) => {
        if (c.source_rec_id && c.action_type && c.target_element_key) {
          return `${c.source_rec_id}__${c.action_type}__${c.target_element_key}`;
        }
        return null;
      })
      .filter((k): k is string => k !== null),
  );
  const synthetic: ChangelogEntry[] = [];
  for (const edit of input.editsToSynthesize) {
    if (seenIds.has(edit.id)) continue;
    const joinKey =
      edit.target_element_key !== null
        ? `${edit.rec_id}__${edit.action_type}__${edit.target_element_key}`
        : null;
    if (joinKey && seenJoinKeys.has(joinKey)) continue;
    synthetic.push(synthesizePendingChangelog(edit));
  }
  return synthetic;
}
