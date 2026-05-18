/**
 * 2026-05-18 Phase A.2 Step 3d — operator-only lifecycle eligibility
 * diagnostic type contracts.
 *
 * Pure type-only module. Defines the per-row reason taxonomy + the
 * funnel-aggregate counter shape consumed by
 * `/diagnostics/lifecycle-eligibility`.
 *
 * Operator-substrate only. NO customer copy lives in this domain —
 * the reason enum values + counter field names are operator
 * vocabulary deliberately (data attributes, table columns, filter
 * chips). The page that consumes these types is gated by
 * `isOperatorModeServer()`.
 *
 * Pinned by:
 *   • `tests/architecture/lifecycle-eligibility-no-customer-surface-import.test.ts`
 *   • `tests/architecture/lifecycle-eligibility-no-mutation.test.ts`
 */

import "server-only";

import type { LifecycleStage } from "@/domains/citation-lifecycle/lifecycle-stage";
import type { TimeToCitationEligibilityReason } from "@/domains/citation-lifecycle/eligibility";

// ─────────────────────────────────────────────────────────────────────
// Reason taxonomy (15 values — operator vocabulary only)
// ─────────────────────────────────────────────────────────────────────

/**
 * Per-row lifecycle eligibility reason. Single string-enum the
 * operator can filter by on the diagnostic page. Designed to
 * distinguish OPERATOR-blocked rows ("you haven't accepted this
 * yet") from SYSTEM-blocked rows ("scan hasn't matched this") so
 * the operator immediately sees where the funnel is stuck.
 *
 * The ordering below is the locked severity / funnel position;
 * downstream consumers sort by this enum to put the most-actionable
 * rows first.
 */
export type LifecycleEligibilityReason =
  /** Operator-blocked: row is in `recommended` status and the parent
   *  rec has no `recommendation_responses` row OR the response is
   *  not `accepted`. Operator must click Accept in /recommendations. */
  | "awaiting_operator_acceptance"
  /** Operator-blocked: `recommendation_responses.status='dismissed'`
   *  for the parent rec. The operator already declined. Final state. */
  | "dismissed_at_response_level"
  /** Operator-blocked: edit-level dismissal — `implementation_status=
   *  'dismissed'`, usually with a `not_found_reason` set during
   *  per-edit cleanup. Final state. */
  | "dismissed_at_edit_level"
  /** System-blocked: edit is `accepted` but no `live_at` yet. Either
   *  waiting for the daily-scan match-runner to detect on-page
   *  presence OR operator hasn't used "Mark shipped" override. */
  | "accepted_not_live"
  /** Mid-funnel: shipped but not yet cited. Beacon is watching. */
  | "verified_live_not_yet_cited"
  /** Discoverability concern: shipped, past `late_days`, never cited.
   *  See `/diagnostics/indexability` for the per-URL verdict. */
  | "stuck_uncited"
  /** SUCCESS: shipped AND cited within `late_days`. Counts toward the
   *  threshold-replacement sample. */
  | "cited_eligible"
  /** Data integrity issue: status says shipped but `live_at IS NULL`.
   *  Should be rare — investigate. */
  | "missing_live_at"
  /** Data integrity issue: shipped status but `target_url IS NULL`. */
  | "missing_target_url"
  /** Different lifecycle family: `target_url='needs_new_page'`
   *  sentinel for create-page recs — no observable URL to track. */
  | "needs_new_page_sentinel"
  /** System anomaly: match engine matched a different URL than
   *  intended (`live_match_kind='wrong_page'`). */
  | "wrong_page"
  /** Latent coverage gap: no `page_snapshots` row whose URL matches
   *  `target_url`. Would block matching when accepted. */
  | "no_snapshot_for_target_url"
  /** Latent canonicalization mismatch: a snapshot exists with
   *  canonical-equal URL but not exact-equal (e.g., homepage
   *  `https://ritzbuilders.com/` target vs `https://ritzbuilders.com`
   *  snapshot). Would block exact-match. */
  | "url_canonicalization_mismatch"
  /** Latent shape gap: accepted-but-not-live row missing match
   *  fields the action_type requires (e.g., `target_element_key`). */
  | "match_fields_missing"
  /** Fall-through. Should be empty in production. Investigate. */
  | "unknown";

// ─────────────────────────────────────────────────────────────────────
// Per-row eligibility decision
// ─────────────────────────────────────────────────────────────────────

/**
 * Decision record returned by `deriveLifecycleReason`. The `reason`
 * is the primary signal; `details` carries operator-readable
 * structured fields for the table row.
 */
export type PerRowEligibility = {
  reason: LifecycleEligibilityReason;
  /**
   * Whether the row is operator-blocked (operator action would
   * unblock it) vs system-blocked (Beacon/data action would unblock
   * it). `null` for terminal states (e.g., `cited_eligible`,
   * `dismissed_at_*`).
   */
  blocked_by: "operator" | "system" | null;
  /**
   * Optional human-readable detail string — operator vocabulary,
   * never customer-facing. E.g., "snapshot stored as
   * `https://ritzbuilders.com` (no trailing slash) but target is
   * `https://ritzbuilders.com/`."
   */
  detail: string | null;
  /**
   * Time-to-citation eligibility result for the row. Always populated
   * (the upstream predicate is total).
   */
  time_to_citation_eligibility_reason: TimeToCitationEligibilityReason;
  /**
   * Whether the row passes the threshold-replacement sample gate
   * (`isCitedAndUsable` in `compute-tenant-thresholds.ts`). Only true
   * when `reason === "cited_eligible"`. The diagnostic exposes both
   * the funnel reason AND this boolean for accurate counter math.
   */
  threshold_eligible: boolean;
  /**
   * Bucketed lifecycle stage when available. Null for rows that
   * never reached eligible-for-time-to-citation.
   */
  lifecycle_stage: LifecycleStage | null;
  /** Days from `live_at` to first citation. Null when uncited. */
  days_to_first_citation: number | null;
  /** ISO date of first citation. Null when uncited. */
  first_citation_date_iso: string | null;
};

// ─────────────────────────────────────────────────────────────────────
// Funnel aggregate counters
// ─────────────────────────────────────────────────────────────────────

/**
 * Top-of-page funnel counter strip. All counters are derived from
 * the same input arrays so the math reconciles. The diagnostic page
 * renders these in a header tile and pins them via data attributes
 * for testability.
 *
 * Reconciliation invariants (pinned by
 * `tests/domains/lifecycle-eligibility/aggregate-counters.test.ts`):
 *
 *   total_edits === edits_recommended + edits_dismissed
 *                 + edits_with_live_at + edits_accepted_not_live
 *                 + edits_in_other_terminal_status
 *
 *   edits_threshold_eligible <= edits_cited_post_ship
 *                            <= edits_with_live_at
 *                            <= edits_in_accepted_lineage
 *
 *   edits_blocked_by_operator + edits_blocked_by_system + edits_terminal
 *     === total_edits
 */
export type FunnelCounters = {
  // ── Funnel stages (left-to-right narrative) ─────────────────
  /** Total suggested edits (all `recommended_edits` rows). */
  total_edits: number;
  /** Edits in `recommended` status (operator hasn't acted on the
   *  parent rec yet, OR rec is in some pending state). */
  edits_recommended: number;
  /** Edits in `dismissed` status (edit-level dismissal with
   *  `not_found_reason`). */
  edits_dismissed: number;
  /** Edits in `accepted` status but NO `live_at` (waiting for scan
   *  match OR operator Mark Shipped). */
  edits_accepted_not_live: number;
  /** Edits with `live_at IS NOT NULL` (shipped + visible to scan). */
  edits_with_live_at: number;
  /** Edits whose `implementation_status` is in the verified-live
   *  family (`verified_live` | `verified_live_modified` |
   *  `partially_implemented`). */
  edits_verified_live: number;
  /** Edits whose lifecycle stage is one of `cited_fast` /
   *  `cited_typical` / `cited_late` / `cited_very_late`. */
  edits_cited_post_ship: number;
  /** Edits passing the `isCitedAndUsable` threshold-replacement
   *  predicate. Equal to `edits_cited_post_ship` minus any rows
   *  with `days_to_first_citation < 0`. */
  edits_threshold_eligible: number;

  // ── Rec-level (recommendation_responses) ────────────────────────
  /** Distinct `recommendation_responses` rows for the tenant. */
  responses_total: number;
  /** Responses with `status='accepted'`. */
  responses_accepted: number;
  /** Responses with `status='dismissed'`. */
  responses_dismissed: number;
  /** Responses with `status='deferred'`. */
  responses_deferred: number;
  /** Edits whose parent rec has an `accepted` response (regardless
   *  of the edit's current `implementation_status`). */
  edits_in_accepted_lineage: number;

  // ── Threshold gate progress ──────────────────────────────────────
  /** Locked sample-size gate constant (20). Source-of-truth in
   *  `BRAIN_SAMPLE_THRESHOLDS.threshold_replacement`. */
  threshold_gate: number;
  /** Current decision source — `profound_default` until the gate is
   *  crossed, then `per_tenant`. */
  threshold_source: "profound_default" | "per_tenant";

  // ── URL coverage / matchability ──────────────────────────────────
  /** Distinct `target_url` values across all edits. */
  unique_target_urls: number;
  /** Count of `target_url`s with at least one page_snapshot row
   *  (exact match on URL). */
  urls_with_snapshot_coverage: number;
  /** Count of `target_url`s with NO page_snapshot row at all
   *  (neither exact nor canonical-match). Pure coverage gap. */
  urls_without_snapshot_coverage: number;
  /** Count of `target_url`s where no exact-match snapshot exists
   *  BUT a canonical-equal snapshot does. The homepage trailing-
   *  slash case. */
  urls_with_canonicalization_mismatch: number;

  // ── Block-classification totals ─────────────────────────────────
  /** Edits blocked by operator inaction (awaiting_operator_acceptance
   *  + dismissed_at_response_level cases). */
  edits_blocked_by_operator: number;
  /** Edits blocked by scan/match/data issues (no_snapshot,
   *  url_canonicalization_mismatch, match_fields_missing,
   *  missing_live_at, missing_target_url, wrong_page,
   *  accepted_not_live, stuck_uncited). */
  edits_blocked_by_system: number;
  /** Edits in a terminal state (cited_eligible OR dismissed_at_edit_level
   *  OR verified_live_not_yet_cited counted as "in flight" → see note).
   *  We collapse "in-flight" + "terminal" into one bucket called
   *  "neither operator-blocked nor system-blocked" for counter
   *  reconciliation: `terminal = total - operator_blocked - system_blocked`. */
  edits_terminal_or_in_flight: number;
};
