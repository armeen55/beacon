/**
 * 2026-05-13 Phase A.1 Step 5 — citation-lifecycle stage derivation.
 *
 * Pure function that classifies a row into one of 6 lifecycle stages
 * per Section 2 Decision Lock D9. Final pure foundation module of
 * Phase A.1 — consumes the output of `compute-time-to-citation.ts`
 * (a structural subset of its fields) and reads the locked borrowed
 * defaults from `thresholds.ts`. No I/O, no caching, no UI strings.
 *
 * The 6 stages (D9 lock):
 *   • `live_not_yet_cited` — page is live, no citation observed yet,
 *     still inside Beacon's late-day window. "Beacon is watching."
 *   • `cited_fast`         — first citation within `fast_days` (6).
 *   • `cited_typical`      — first citation within `median_days` (18).
 *   • `cited_late`         — first citation within `late_days` (37).
 *   • `cited_very_late`    — first citation arrived but past the
 *     late_days threshold. "Late, but in rotation."
 *   • `stuck`              — past the late_days window with no
 *     citation. "Likely discoverability issue."
 *
 * Returns `null` when the input doesn't carry enough information to
 * classify — specifically when the row is ineligible for the metric
 * (`days_since_live === null`), OR when the input is internally
 * inconsistent (`first_citation_date_iso` set but
 * `days_to_first_citation` null). Distinct from `stuck`: `stuck`
 * means "we measured and the page is past the late window with no
 * citation"; `null` means "we couldn't measure".
 *
 * IMPORTANT — enum values are data-attribute strings, NOT customer
 * copy. The Today tile + Changes detail Act 3 carry their own
 * hard-coded copy that maps each stage to operator-friendly English
 * (Section 2.10 / 2.11 work). This module never produces user-facing
 * text.
 */

import { T2C_THRESHOLDS } from "./thresholds";

export type LifecycleStage =
  | "live_not_yet_cited"
  | "cited_fast"
  | "cited_typical"
  | "cited_late"
  | "cited_very_late"
  | "stuck";

/**
 * Structural input. Mirrors the relevant subset of
 * `TimeToCitationResult` so callers can pass the compute result
 * directly without an adapter, or hand-construct an object for
 * tests / future consumers.
 */
export type LifecycleStageInput = {
  first_citation_date_iso: string | null;
  days_to_first_citation: number | null;
  days_since_live: number | null;
};

/**
 * Decision tree:
 *
 *   1. `days_since_live === null` → null (ineligible / not computable).
 *
 *   2. First-citation branch (`first_citation_date_iso !== null`):
 *      2a. `days_to_first_citation === null` → null (fail-closed on
 *          inconsistent input — should never happen if the compute
 *          layer produced the values).
 *      2b. Map by threshold:
 *          • `<= T2C_THRESHOLDS.fast_days` (6)   → `cited_fast`
 *          • `<= T2C_THRESHOLDS.median_days` (18) → `cited_typical`
 *          • `<= T2C_THRESHOLDS.late_days` (37)   → `cited_late`
 *          • otherwise                            → `cited_very_late`
 *
 *      Negative `days_to_first_citation` (which compute-time-to-citation
 *      clamps to 0 with `was_cited_before_live: true`, but a future
 *      caller could pass directly) is consistent with `<= fast_days`
 *      and maps to `cited_fast`. Documented behavior; pinned by test.
 *
 *   3. No-citation branch:
 *      3a. `days_since_live <= T2C_THRESHOLDS.late_days` → `live_not_yet_cited`.
 *      3b. otherwise → `stuck`.
 *
 *      `days_to_first_citation` is ignored on this branch even if it
 *      happens to be non-null. Inconsistent inputs (no first-citation
 *      date but non-null days-to-first-citation) take the no-citation
 *      path; the test pins this explicitly.
 */
export function deriveLifecycleStage(
  input: LifecycleStageInput,
): LifecycleStage | null {
  const { first_citation_date_iso, days_to_first_citation, days_since_live } =
    input;

  // 1. Ineligible / not-computable.
  if (days_since_live === null) return null;

  // 2. First-citation branch.
  if (first_citation_date_iso !== null) {
    // 2a. Fail closed on inconsistent input.
    if (days_to_first_citation === null) return null;

    // 2b. Threshold mapping. `<=` semantics chosen so the band
    //     numbers in customer copy ("typically within 18 days") read
    //     inclusive.
    if (days_to_first_citation <= T2C_THRESHOLDS.fast_days) {
      return "cited_fast";
    }
    if (days_to_first_citation <= T2C_THRESHOLDS.median_days) {
      return "cited_typical";
    }
    if (days_to_first_citation <= T2C_THRESHOLDS.late_days) {
      return "cited_late";
    }
    return "cited_very_late";
  }

  // 3. No-citation branch. Ignores `days_to_first_citation` even if
  //    the caller passed a non-null value (defensive against
  //    inconsistent inputs).
  if (days_since_live <= T2C_THRESHOLDS.late_days) {
    return "live_not_yet_cited";
  }
  return "stuck";
}
