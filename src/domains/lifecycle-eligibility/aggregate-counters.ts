/**
 * 2026-05-18 Phase A.2 Step 3d — pure funnel-counter aggregator.
 *
 * `computeFunnelCounters({ edits, responses, snapshots,
 * perRowDecisions })` returns the locked `FunnelCounters` shape
 * consumed by `/diagnostics/lifecycle-eligibility`'s header tile.
 *
 * Pure. No I/O. No mutations.
 *
 * Reconciliation invariants (pinned by
 * `tests/domains/lifecycle-eligibility/aggregate-counters.test.ts`):
 *
 *   1. total_edits === count(edits)
 *   2. edits_blocked_by_operator + edits_blocked_by_system
 *        + edits_terminal_or_in_flight === total_edits
 *   3. edits_threshold_eligible ≤ edits_cited_post_ship
 *        ≤ edits_with_live_at
 *   4. unique_target_urls === count distinct edit.target_url
 *        (excluding sentinels + nulls)
 *   5. urls_with_snapshot_coverage + urls_without_snapshot_coverage
 *        === unique_target_urls
 *        (urls_with_canonicalization_mismatch is a sub-set of
 *         urls_without_snapshot_coverage for EXACT-match purposes)
 *
 * Pinned by:
 *   • `tests/architecture/lifecycle-eligibility-no-mutation.test.ts`
 *   • `tests/architecture/lifecycle-eligibility-no-customer-surface-import.test.ts`
 */

import "server-only";

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { BRAIN_SAMPLE_THRESHOLDS } from "@/domains/recommendations/cross-tenant-brain/thresholds";
import {
  editLifecycleStatus,
  type RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";

import type { FunnelCounters, PerRowEligibility } from "./types";
import {
  buildSnapshotUrlIndex,
  type SnapshotUrlIndex,
} from "./derive-reason";

const NEEDS_NEW_PAGE_SENTINEL = "needs_new_page";

const ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  "verified_live",
  "verified_live_modified",
  "partially_implemented",
]);
const CITED_STAGES: ReadonlySet<string> = new Set([
  "cited_fast",
  "cited_typical",
  "cited_late",
  "cited_very_late",
]);

// ─────────────────────────────────────────────────────────────────────
// Public function
// ─────────────────────────────────────────────────────────────────────

export type ComputeFunnelCountersInput = {
  /** All `recommended_edits` rows for the tenant. */
  edits: ReadonlyArray<RecommendedEditRow>;
  /** All `recommendation_responses` rows for the tenant. */
  responses: ReadonlyArray<RecommendationResponse>;
  /** Snapshot URL index (pre-built via `buildSnapshotUrlIndex`).
   *  Caller may also pass the raw URL list; the helper builds the
   *  index defensively if the convenience overload is used. */
  snapshotIndex: SnapshotUrlIndex;
  /** Per-row decisions returned by `deriveLifecycleReason`. MUST
   *  align with `edits` by index — counter math relies on it. */
  perRowDecisions: ReadonlyArray<PerRowEligibility>;
  /** Per-edit lifecycle compute results. May be sparse (null for
   *  rows the loader didn't process); caller passes alongside
   *  perRowDecisions to support the threshold-source + cited-post-
   *  ship counts. */
  lifecycleResults: ReadonlyArray<LifecycleForEdit | null>;
};

/**
 * Convenience overload that accepts raw snapshot URLs and builds
 * the index internally. Useful for callers that don't need the
 * pre-built index for other purposes.
 */
export type ComputeFunnelCountersInputRaw = Omit<
  ComputeFunnelCountersInput,
  "snapshotIndex"
> & {
  snapshotUrls: ReadonlyArray<string | null | undefined>;
};

function isRaw(
  input: ComputeFunnelCountersInput | ComputeFunnelCountersInputRaw,
): input is ComputeFunnelCountersInputRaw {
  return (input as ComputeFunnelCountersInputRaw).snapshotUrls !== undefined;
}

export function computeFunnelCounters(
  input: ComputeFunnelCountersInput | ComputeFunnelCountersInputRaw,
): FunnelCounters {
  const snapshotIndex = isRaw(input)
    ? buildSnapshotUrlIndex(input.snapshotUrls)
    : input.snapshotIndex;

  const { edits, responses, perRowDecisions, lifecycleResults } = input;

  // Index responses by recId for O(1) lookup.
  const responsesByRecId = new Map<string, RecommendationResponse>();
  for (const r of responses) {
    responsesByRecId.set(r.recId, r);
  }

  // ── Funnel stages ────────────────────────────────────────────────
  let edits_recommended = 0;
  let edits_dismissed = 0;
  let edits_accepted_not_live = 0;
  let edits_with_live_at = 0;
  let edits_verified_live = 0;
  let edits_in_accepted_lineage = 0;

  for (const edit of edits) {
    const status = editLifecycleStatus(edit);
    if (status === "recommended") edits_recommended++;
    if (status === "dismissed") edits_dismissed++;
    if (status === "accepted" && edit.live_at == null) {
      edits_accepted_not_live++;
    }
    if (edit.live_at != null) edits_with_live_at++;
    if (ELIGIBLE_STATUSES.has(status)) edits_verified_live++;

    const response = responsesByRecId.get(edit.rec_id);
    if (response != null && response.status === "accepted") {
      edits_in_accepted_lineage++;
    }
  }

  // ── Cited / threshold-eligible (from lifecycle compute) ─────────
  let edits_cited_post_ship = 0;
  let edits_threshold_eligible = 0;

  for (const result of lifecycleResults) {
    if (result == null) continue;
    if (result.stage != null && CITED_STAGES.has(result.stage)) {
      edits_cited_post_ship++;
      const d = result.result.days_to_first_citation;
      if (d != null && d >= 0) {
        edits_threshold_eligible++;
      }
    }
  }

  // ── Response-level rollups ──────────────────────────────────────
  const responses_total = responses.length;
  let responses_accepted = 0;
  let responses_dismissed = 0;
  let responses_deferred = 0;
  for (const r of responses) {
    if (r.status === "accepted") responses_accepted++;
    else if (r.status === "dismissed") responses_dismissed++;
    else if (r.status === "deferred") responses_deferred++;
  }

  // ── Threshold gate ──────────────────────────────────────────────
  const threshold_gate = BRAIN_SAMPLE_THRESHOLDS.threshold_replacement;
  const threshold_source: FunnelCounters["threshold_source"] =
    edits_threshold_eligible >= threshold_gate
      ? "per_tenant"
      : "profound_default";

  // ── URL coverage ────────────────────────────────────────────────
  const uniqueTargetUrls = new Set<string>();
  for (const edit of edits) {
    if (edit.target_url == null) continue;
    if (edit.target_url === NEEDS_NEW_PAGE_SENTINEL) continue;
    if (edit.target_url === "") continue;
    uniqueTargetUrls.add(edit.target_url);
  }
  const unique_target_urls = uniqueTargetUrls.size;

  let urls_with_snapshot_coverage = 0;
  let urls_without_snapshot_coverage = 0;
  let urls_with_canonicalization_mismatch = 0;
  for (const url of uniqueTargetUrls) {
    if (snapshotIndex.exact.has(url)) {
      urls_with_snapshot_coverage++;
    } else {
      urls_without_snapshot_coverage++;
      // Canonical-match sub-detection. We import canonicalizeCitationUrl
      // via the same boundary derive-reason uses.
      // Imported at top of file via derive-reason's SnapshotUrlIndex
      // shape; canonical lookup is keyed on canonical URL.
      // We need to canonicalize the target_url here too.
      const canonical = canonicalizeForCounters(url);
      if (canonical != null && snapshotIndex.canonicalToExact.has(canonical)) {
        urls_with_canonicalization_mismatch++;
      }
    }
  }

  // ── Block classification ────────────────────────────────────────
  let edits_blocked_by_operator = 0;
  let edits_blocked_by_system = 0;
  let edits_terminal_or_in_flight = 0;
  for (const decision of perRowDecisions) {
    if (decision.blocked_by === "operator") edits_blocked_by_operator++;
    else if (decision.blocked_by === "system") edits_blocked_by_system++;
    else edits_terminal_or_in_flight++;
  }

  return {
    // Funnel stages
    total_edits: edits.length,
    edits_recommended,
    edits_dismissed,
    edits_accepted_not_live,
    edits_with_live_at,
    edits_verified_live,
    edits_cited_post_ship,
    edits_threshold_eligible,

    // Rec-level
    responses_total,
    responses_accepted,
    responses_dismissed,
    responses_deferred,
    edits_in_accepted_lineage,

    // Threshold gate
    threshold_gate,
    threshold_source,

    // URL coverage
    unique_target_urls,
    urls_with_snapshot_coverage,
    urls_without_snapshot_coverage,
    urls_with_canonicalization_mismatch,

    // Block classification
    edits_blocked_by_operator,
    edits_blocked_by_system,
    edits_terminal_or_in_flight,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Local canonicalize wrapper. Defers to the centralized
 * `canonicalizeCitationUrl` so the canonical comparison used in
 * counters matches what `derive-reason` and `compute-time-to-
 * citation` use.
 */
function canonicalizeForCounters(url: string): string | null {
  return canonicalizeCitationUrl(url);
}
