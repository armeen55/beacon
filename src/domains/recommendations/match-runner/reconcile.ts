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
 * `not_found_after_7d` promotion timer.
 *
 * Returns `null` when no stable source exists. The runner MUST treat
 * `null` as "skip the 7-day promotion AND emit a structured warning"
 * (Phase 3.1 contract — see `runLifecycleMatchAgainstScan`).
 *
 * Source priority — Phase 3.1 (2026-04-27) tightened from Phase 3:
 *
 *   1. EXACT matching `changelog_entries.timestamp`. Match requires:
 *        - `c.tenant_id === edit.tenant_id` (defensive — repo already
 *          filters per-tenant, but explicit guard hardens the contract)
 *        - `c.source_rec_id === edit.rec_id`
 *        - `c.action_type === edit.action_type`
 *        - if `edit.target_element_key !== null`, then
 *          `c.target_element_key === edit.target_element_key`
 *      A multi-edit fan-out produces N changelog rows, one per
 *      `(action_type, target_element_key)` tuple — picking the row
 *      with the matching tuple keeps the timestamp accurate per leg.
 *      Ties broken by earliest timestamp.
 *
 *   2. `recommendation_responses.respondedAt` where:
 *        - `r.recId === edit.rec_id`
 *        - `r.status === "accepted"`
 *      Captures operator intent when the changelog is missing or out
 *      of sync.
 *
 *   3. `edit.created_at` as a final fallback. **NEVER `updated_at`**
 *      — the runner mutates `updated_at` on every write-back, so
 *      using it as an age source would reset the 7-day clock on
 *      every scan and effectively disable the promotion.
 *
 *   4. None → `null`. Caller skips the 7-day promotion entirely;
 *      the row stays in its current state until a real accept-event
 *      surfaces in one of the three sources above.
 *
 * Pure. No I/O. No mutation. Idempotent.
 */
export function computeAcceptedAtMs(
  edit: RecommendedEditRow,
  responses: ReadonlyArray<RecommendationResponse>,
  changelog: ReadonlyArray<ChangelogEntry>,
): number | null {
  // ── Source 1: EXACT changelog match ─────────────────────────────────
  let earliestChangelog: number | null = null;
  for (const c of changelog) {
    if (c.tenant_id !== edit.tenant_id) continue;
    if (c.source_rec_id !== edit.rec_id) continue;
    if (c.action_type !== edit.action_type) continue;
    if (edit.target_element_key !== null) {
      if (c.target_element_key !== edit.target_element_key) continue;
    }
    const t = Date.parse(c.timestamp);
    if (Number.isNaN(t)) continue;
    if (earliestChangelog === null || t < earliestChangelog) {
      earliestChangelog = t;
    }
  }
  if (earliestChangelog !== null) return earliestChangelog;

  // ── Source 2: recommendation_responses.respondedAt ──────────────────
  for (const r of responses) {
    if (r.recId !== edit.rec_id) continue;
    if (r.status !== "accepted") continue;
    const t = Date.parse(r.respondedAt);
    if (!Number.isNaN(t)) return t;
  }

  // ── Source 3: edit.created_at — IMMUTABLE fallback ──────────────────
  // Phase 3.1: NEVER use updated_at. The runner mutates updated_at
  // on every write-back; using it as an age source would reset the
  // 7-day clock on every scan.
  if (edit.created_at && edit.created_at.length > 0) {
    const t = Date.parse(edit.created_at);
    if (!Number.isNaN(t)) return t;
  }

  // ── Source 4: nothing stable — caller handles ───────────────────────
  return null;
}
