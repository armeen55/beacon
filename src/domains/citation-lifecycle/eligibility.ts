/**
 * 2026-05-13 Phase A.1 Step 2 — citation-lifecycle eligibility predicate.
 *
 * Pure, total predicate deciding whether a `recommended_edits` row
 * participates in the time-to-citation metric. Foundational for
 * `compute-time-to-citation.ts` (Step 4) — only eligible rows have a
 * defined "days since live" value.
 *
 * LOCKED BEHAVIOR (Section 2 Decision Lock D1 / D2):
 *   • Eligible statuses: `verified_live` · `verified_live_modified` ·
 *     `partially_implemented`.
 *   • `partially_implemented` is eligible AND carries `is_partial_live: true`
 *     so downstream consumers can soften copy ("partially live, cited Nd
 *     after the visible portion went live").
 *   • `wrong_page` matches do NOT count for time-to-citation — the URL
 *     the match engine found is not the URL the edit targets.
 *   • `recommended` · `accepted` · `needs_review` · `dismissed` ·
 *     `not_found_after_7d` are excluded; none represent a successful
 *     ship.
 *   • `live_at` must be non-null (the metric is anchored to it).
 *   • `target_url` must be non-null and not the create-page sentinel
 *     `"needs_new_page"` (no URL ⇒ no citation to look for).
 *   • Unknown/missing status fails closed via `editLifecycleStatus`
 *     defaulting to `"recommended"` → `excluded_status`.
 *
 * Defensive input shape: `target_url` is typed `string` (non-nullable)
 * on `RecommendedEditRow`, but this predicate accepts `string | null |
 * undefined` so a future schema relaxation can't silently turn the
 * predicate into a false-positive emitter.
 *
 * Output is a small record (not a bare boolean) so downstream
 * diagnostics + tests can branch on the disqualification reason
 * without re-running the predicate.
 */

import {
  editLifecycleStatus,
  type ImplementationStatus,
  type RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";

/**
 * Stable enum of why an edit row is or isn't eligible. The set is
 * exhaustive over the locked rules; downstream tests and diagnostics
 * pattern-match on these values, so adding a new reason is a
 * versioned change.
 */
export type TimeToCitationEligibilityReason =
  | "eligible_verified_live"
  | "eligible_verified_live_modified"
  | "eligible_partial_live"
  | "missing_live_at"
  | "missing_target_url"
  | "needs_new_page"
  | "excluded_wrong_page"
  | "excluded_status";

/**
 * Structural input. Accepts the relevant subset of
 * `RecommendedEditRow` with `target_url` widened to nullable for
 * defense-in-depth. Callers pass full rows; the predicate ignores the
 * rest of the shape.
 */
export type TimeToCitationEligibilityInput = {
  implementation_status?: ImplementationStatus;
  live_at?: string | null;
  target_url?: string | null;
};

/**
 * Pure decision record returned by `getTimeToCitationEligibility`.
 * `is_partial_live` is meaningful only when `eligible` is true; for
 * ineligible rows it's `false` (no claim about partiality of a row
 * that hasn't shipped).
 */
export type TimeToCitationEligibility = {
  eligible: boolean;
  is_partial_live: boolean;
  reason: TimeToCitationEligibilityReason;
};

/**
 * The set of statuses that, all other gates passing, count as
 * eligible. `partially_implemented` is included per D1 with the
 * `is_partial_live` flag below.
 */
const ELIGIBLE_STATUSES: ReadonlySet<ImplementationStatus> = new Set([
  "verified_live",
  "verified_live_modified",
  "partially_implemented",
]);

/**
 * Sentinel `target_url` value emitted by create-page recommendations.
 * No physical URL exists yet, so no citation can be observed against
 * it — the metric is intentionally undefined here.
 *
 * Source of truth lives in `mapSpecificEditToRow` /
 * `RecommendedEditRow.target_url` semantics in the persistence
 * module; this constant mirrors it for self-documenting eligibility
 * code.
 */
const NEEDS_NEW_PAGE_SENTINEL = "needs_new_page";

/**
 * Full decision record. Use this when you need the disqualification
 * reason; use `isEligibleForTimeToCitation` when you only need a
 * boolean.
 *
 * Decision order:
 *   1. `wrong_page` short-circuits (even with `live_at` set, the URL
 *      the match engine found isn't the URL we're measuring).
 *   2. Non-eligible status family ⇒ `excluded_status`.
 *   3. Missing `live_at` ⇒ `missing_live_at` (we have no anchor).
 *   4. Missing `target_url` ⇒ `missing_target_url`.
 *   5. Create-page sentinel ⇒ `needs_new_page`.
 *   6. Otherwise eligible; reason is the status-specific variant and
 *      `is_partial_live` is true iff the status is
 *      `partially_implemented`.
 */
export function getTimeToCitationEligibility(
  row: TimeToCitationEligibilityInput,
): TimeToCitationEligibility {
  // Normalize undefined → "recommended" via the canonical helper. Keeps
  // legacy-file rows (which predate the implementation_status column)
  // failing closed instead of silently becoming eligible.
  const status = editLifecycleStatus(row);

  if (status === "wrong_page") {
    return {
      eligible: false,
      is_partial_live: false,
      reason: "excluded_wrong_page",
    };
  }

  if (!ELIGIBLE_STATUSES.has(status)) {
    return {
      eligible: false,
      is_partial_live: false,
      reason: "excluded_status",
    };
  }

  if (row.live_at == null) {
    return {
      eligible: false,
      is_partial_live: false,
      reason: "missing_live_at",
    };
  }

  if (row.target_url == null) {
    return {
      eligible: false,
      is_partial_live: false,
      reason: "missing_target_url",
    };
  }

  if (row.target_url === NEEDS_NEW_PAGE_SENTINEL) {
    return {
      eligible: false,
      is_partial_live: false,
      reason: "needs_new_page",
    };
  }

  if (status === "partially_implemented") {
    return {
      eligible: true,
      is_partial_live: true,
      reason: "eligible_partial_live",
    };
  }

  if (status === "verified_live_modified") {
    return {
      eligible: true,
      is_partial_live: false,
      reason: "eligible_verified_live_modified",
    };
  }

  // status === "verified_live" (the only remaining case in
  // ELIGIBLE_STATUSES after the two branches above). Explicit assignment
  // keeps the function total without a default branch that could
  // silently absorb a future status addition.
  return {
    eligible: true,
    is_partial_live: false,
    reason: "eligible_verified_live",
  };
}

/**
 * Boolean convenience wrapper. Equivalent to
 * `getTimeToCitationEligibility(row).eligible`. Use the full record
 * version when you need the disqualification reason.
 */
export function isEligibleForTimeToCitation(
  row: TimeToCitationEligibilityInput,
): boolean {
  return getTimeToCitationEligibility(row).eligible;
}

/**
 * Re-export the row type for downstream Phase A.1 modules that need
 * to import the persistence row + this predicate together.
 */
export type { RecommendedEditRow };
