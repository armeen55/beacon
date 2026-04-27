/**
 * Recommendation Lifecycle OS — Phase 3 (2026-04-27).
 *
 * Reconciliation pre-pass — addresses the Phase 1 best-effort caveat.
 *
 * The Phase 1 `acceptRecommendation` server action calls
 * `markRecommendedEditsAccepted` as best-effort: a failure logs but
 * does not fail the action. That can leave a partial state:
 *   - `recommendation_responses.status === "accepted"` ✓
 *   - N `changelog_entries` with `source_rec_id === rec.stableKey` ✓
 *   - `recommended_edits.implementation_status === "recommended"` (drift)
 *
 * This reconciler pure-computes the set of `recommended_edit.id`s that
 * MUST be flipped to `accepted` because OTHER stores already hold
 * accepted-evidence for the parent rec. Idempotent — running on a
 * fully-consistent set returns `[]`.
 *
 * Pure function. No I/O. No mutation. Caller hands the result to
 * `markRecommendedEditsAccepted` (Phase 1 helper) for the actual
 * write.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import {
  editLifecycleStatus,
  type RecommendedEditRow,
} from "../recommended-edits-persistence";

export type ReconciliationInputs = {
  edits: ReadonlyArray<RecommendedEditRow>;
  responses: ReadonlyArray<RecommendationResponse>;
  changelog: ReadonlyArray<ChangelogEntry>;
};

/**
 * Returns the `id`s of `recommended_edits` rows that should be flipped
 * to `accepted` because either:
 *
 *   (a) `recommendation_responses` has a row with the same `recId` and
 *       `status === "accepted"`, OR
 *   (b) `changelog_entries` has at least one row with
 *       `source_rec_id === edit.rec_id` (same tenant — caller passes
 *       per-tenant slices already, so no tenant filtering needed here).
 *
 * Only rows currently in `"recommended"` (or with no
 * `implementation_status` field — legacy) are considered. Rows already
 * in `accepted` / `verified_live*` / `dismissed` etc. are skipped.
 */
export function computeReconciliationFlips(
  inputs: ReconciliationInputs,
): string[] {
  const acceptedRecIds = new Set<string>();
  for (const r of inputs.responses) {
    if (r.status === "accepted") acceptedRecIds.add(r.recId);
  }
  const changelogRecIds = new Set<string>();
  for (const c of inputs.changelog) {
    if (c.source_rec_id != null && c.source_rec_id !== "") {
      changelogRecIds.add(c.source_rec_id);
    }
  }
  const out: string[] = [];
  for (const edit of inputs.edits) {
    if (editLifecycleStatus(edit) !== "recommended") continue;
    if (acceptedRecIds.has(edit.rec_id) || changelogRecIds.has(edit.rec_id)) {
      out.push(edit.id);
    }
  }
  return out;
}

/**
 * Pure: derive the per-edit "accepted_at" timestamp from the most
 * stable available source. Used by the runner for the 7-day
 * `not_found_after_7d` promotion timer — `recommended_edits.updated_at`
 * is unsuitable because it advances every time the runner writes back.
 *
 * Source priority (most stable first):
 *   1. Earliest `changelog_entries.timestamp` where `source_rec_id`
 *      matches the edit's `rec_id`. Set at Accept time and never
 *      mutated by subsequent runner writes.
 *   2. `recommendation_responses.respondedAt` for the rec_id. Captures
 *      operator intent even if no changelog entry exists yet.
 *   3. `edit.updated_at` as a last resort. Only fires for edits the
 *      reconciler just flipped without either upstream source — should
 *      be rare since the reconciler requires either source to fire.
 */
export function computeAcceptedAtMs(
  edit: RecommendedEditRow,
  responses: ReadonlyArray<RecommendationResponse>,
  changelog: ReadonlyArray<ChangelogEntry>,
): number {
  let earliestChangelog: number | null = null;
  for (const c of changelog) {
    if (c.source_rec_id !== edit.rec_id) continue;
    const t = Date.parse(c.timestamp);
    if (Number.isNaN(t)) continue;
    if (earliestChangelog === null || t < earliestChangelog) {
      earliestChangelog = t;
    }
  }
  if (earliestChangelog !== null) return earliestChangelog;

  for (const r of responses) {
    if (r.recId === edit.rec_id) {
      const t = Date.parse(r.respondedAt);
      if (!Number.isNaN(t)) return t;
    }
  }
  const fallback = Date.parse(edit.updated_at);
  return Number.isNaN(fallback) ? 0 : fallback;
}
