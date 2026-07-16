/**
 * 2026-05-18 Phase A.2 Step 3d, pure per-row reason derivation.
 *
 * `deriveLifecycleReason({ edit, response, snapshotIndex,
 * lifecycleResult })` returns ONE locked reason code + structured
 * details for the operator diagnostic at
 * `/diagnostics/lifecycle-eligibility`.
 *
 * Pure. No I/O. No mutations. No match-runner calls. No GSC.
 * No LLM. Total: every input combination yields a reason.
 *
 * Decision tree mirrors the operator-locked taxonomy in `./types.ts`.
 * Order matters: earlier branches short-circuit before later ones
 * because the most-actionable / most-specific reason should win.
 *
 * Pinned by:
 *   • `tests/domains/lifecycle-eligibility/derive-reason.test.ts`
 *   • `tests/architecture/lifecycle-eligibility-no-mutation.test.ts`
 *   • `tests/architecture/lifecycle-eligibility-no-customer-surface-import.test.ts`
 */

import "server-only";

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { getTimeToCitationEligibility } from "@/domains/citation-lifecycle/eligibility";
import {
  editLifecycleStatus,
  type RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import type {
  RecommendationResponse,
} from "@/domains/product/recommendation-response-store";

import type { LifecycleEligibilityReason, PerRowEligibility } from "./types";

const NEEDS_NEW_PAGE_SENTINEL = "needs_new_page";

/**
 * Snapshot URL index. Caller pre-builds this from
 * `repo.getPageSnapshots()` to avoid quadratic per-row scans. The
 * `exact` set carries verbatim URLs (no normalization); the
 * `canonical` map keys on the canonicalized form for the
 * trailing-slash / casing / scheme drift detection.
 */
export type SnapshotUrlIndex = {
  /** Set of exact URLs that appear in `page_snapshots` for the
   *  tenant. */
  exact: ReadonlySet<string>;
  /** Map from canonical URL → one of the exact URLs that
   *  canonicalized to it. Used to surface the "snapshot stored as
   *  X but target is Y, canonical-equal" reason. */
  canonicalToExact: ReadonlyMap<string, string>;
};

/**
 * Build the snapshot URL index from a list of `page_snapshots.url`
 * values. Defensive: skips empty / null URLs; lowercases nothing
 * (canonicalize handles that). Caller passes whatever the repo
 * returns; the result is pure data.
 */
export function buildSnapshotUrlIndex(
  snapshotUrls: ReadonlyArray<string | null | undefined>,
): SnapshotUrlIndex {
  const exact = new Set<string>();
  const canonicalToExact = new Map<string, string>();
  for (const u of snapshotUrls) {
    if (u == null || u === "") continue;
    exact.add(u);
    const c = canonicalizeCitationUrl(u);
    if (c != null && !canonicalToExact.has(c)) {
      canonicalToExact.set(c, u);
    }
  }
  return { exact, canonicalToExact };
}

// ─────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────

export type DeriveLifecycleReasonInput = {
  /** The edit row from `recommended_edits`. */
  edit: RecommendedEditRow;
  /** The parent rec's `recommendation_responses` row, if any.
   *  `null` when the operator has never acted on the rec. */
  response: RecommendationResponse | null;
  /** Pre-built snapshot URL index from the tenant's
   *  `page_snapshots`. */
  snapshotIndex: SnapshotUrlIndex;
  /** Lifecycle compute result for the row, if loaded. `null` for
   *  rows that the loader didn't process (e.g., ineligible at the
   *  predicate level, or sentinel target_url). */
  lifecycleResult: LifecycleForEdit | null;
};

// ─────────────────────────────────────────────────────────────────────
// Public function
// ─────────────────────────────────────────────────────────────────────

/**
 * Pure decision tree. Returns one reason + structured details.
 *
 * Branch order (operator-locked):
 *   1. Dismissed at edit level (`implementation_status='dismissed'`)
 *      → final state.
 *   2. Dismissed at response level (response.status='dismissed')
 *      → final state.
 *   3. Wrong-page match (`live_match_kind='wrong_page'`)
 *      → system-blocked.
 *   4. `needs_new_page` sentinel target_url → different family.
 *   5. Missing target_url → data integrity.
 *   6. Missing live_at on eligible-status row → data integrity.
 *   7. Recommended status (no response or response not accepted)
 *      → awaiting_operator_acceptance.
 *   8. Accepted-not-live (no live_at + status not in shipped family)
 *      → system-blocked OR latent-coverage.
 *   9. Live + lifecycle stage: success / waiting / stuck.
 *  10. Fall through → unknown.
 */
export function deriveLifecycleReason(
  input: DeriveLifecycleReasonInput,
): PerRowEligibility {
  const { edit, response, snapshotIndex, lifecycleResult } = input;

  const ttcEligibility = getTimeToCitationEligibility(edit);
  const lifecycle_stage = lifecycleResult?.stage ?? null;
  const days_to_first_citation =
    lifecycleResult?.result.days_to_first_citation ?? null;
  const first_citation_date_iso =
    lifecycleResult?.result.first_citation_date_iso ?? null;

  // Threshold-eligible iff lifecycle compute shows the row in the
  // cited subpopulation AND days_to_first_citation is non-negative.
  // Mirrors `isCitedAndUsable` in compute-tenant-thresholds.ts.
  const citedStages: ReadonlySet<typeof lifecycle_stage> = new Set([
    "cited_fast",
    "cited_typical",
    "cited_late",
    "cited_very_late",
  ]);
  const threshold_eligible =
    lifecycle_stage != null &&
    citedStages.has(lifecycle_stage) &&
    days_to_first_citation != null &&
    days_to_first_citation >= 0;

  const status = editLifecycleStatus(edit);

  // 1. Dismissed at edit level. Final state, operator has acted;
  //    this is a terminal decision, NOT operator inaction. Aggregator
  //    routes `blocked_by: null` into `edits_terminal_or_in_flight`.
  if (status === "dismissed") {
    return baseDecision({
      reason: "dismissed_at_edit_level",
      blocked_by: null,
      detail: edit.not_found_reason
        ? `dismissal reason: ${edit.not_found_reason}`
        : null,
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // 2. Dismissed at response level. Final state, operator has
  //    declined the parent rec; terminal, not operator inaction.
  if (response != null && response.status === "dismissed") {
    return baseDecision({
      reason: "dismissed_at_response_level",
      blocked_by: null,
      detail: `recommendation_responses.status=dismissed for rec ${response.recId}`,
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // 3. Wrong-page match.
  if (status === "wrong_page") {
    return baseDecision({
      reason: "wrong_page",
      blocked_by: "system",
      detail: edit.live_match_kind
        ? `live_match_kind=${edit.live_match_kind}`
        : null,
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // 4. needs_new_page sentinel.
  if (edit.target_url === NEEDS_NEW_PAGE_SENTINEL) {
    return baseDecision({
      reason: "needs_new_page_sentinel",
      blocked_by: null,
      detail: "create-page rec, no observable URL to track",
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // 5. Missing target_url.
  if (edit.target_url == null || edit.target_url === "") {
    return baseDecision({
      reason: "missing_target_url",
      blocked_by: "system",
      detail: "edit row has no target_url, data integrity issue",
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // Pre-compute snapshot coverage signals for the target_url so the
  // downstream branches can reference them.
  const targetUrl = edit.target_url;
  const exactSnapshotPresent = snapshotIndex.exact.has(targetUrl);
  const canonicalTarget = canonicalizeCitationUrl(targetUrl);
  const canonicalSnapshotPresent =
    canonicalTarget != null
      ? snapshotIndex.canonicalToExact.has(canonicalTarget)
      : false;
  const canonicalSnapshotExactUrl =
    canonicalTarget != null
      ? (snapshotIndex.canonicalToExact.get(canonicalTarget) ?? null)
      : null;

  // 6. Missing live_at while status is in the eligible family.
  if (
    (status === "verified_live" ||
      status === "verified_live_modified" ||
      status === "partially_implemented") &&
    edit.live_at == null
  ) {
    return baseDecision({
      reason: "missing_live_at",
      blocked_by: "system",
      detail: `implementation_status=${status} but live_at is NULL`,
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // 7. Recommended status. Operator-blocked.
  if (status === "recommended") {
    // If we can see the response was accepted at the rec level but
    // the edit is still in `recommended`, that's a match-runner
    // reconciliation lag, flag as system-blocked instead of
    // operator-blocked.
    const responseAccepted =
      response != null && response.status === "accepted";
    if (responseAccepted) {
      return baseDecision({
        reason: "accepted_not_live",
        blocked_by: "system",
        detail:
          "rec is response.status=accepted but edit still in recommended, match-runner reconciliation pending",
        ttcEligibility,
        threshold_eligible: false,
        lifecycle_stage,
        days_to_first_citation,
        first_citation_date_iso,
      });
    }
    return baseDecision({
      reason: "awaiting_operator_acceptance",
      blocked_by: "operator",
      detail:
        response == null
          ? "no recommendation_responses row, operator has not opened the rec"
          : `response.status=${response.status}`,
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // 8. Accepted but not live. System-blocked, but distinguish the
  // snapshot-coverage sub-cases for actionable diagnostics.
  if (status === "accepted" && edit.live_at == null) {
    if (!exactSnapshotPresent && !canonicalSnapshotPresent) {
      return baseDecision({
        reason: "no_snapshot_for_target_url",
        blocked_by: "system",
        detail: `no page_snapshots row for ${targetUrl}, daily scan never crawled it`,
        ttcEligibility,
        threshold_eligible: false,
        lifecycle_stage,
        days_to_first_citation,
        first_citation_date_iso,
      });
    }
    if (!exactSnapshotPresent && canonicalSnapshotPresent) {
      return baseDecision({
        reason: "url_canonicalization_mismatch",
        blocked_by: "system",
        detail: `target=${targetUrl} but snapshot stored as ${canonicalSnapshotExactUrl}, canonical-equal but match engine compares exact URLs`,
        ttcEligibility,
        threshold_eligible: false,
        lifecycle_stage,
        days_to_first_citation,
        first_citation_date_iso,
      });
    }
    // Match fields gating, if the action_type implies a required
    // element key and it's missing, surface that explicitly.
    if (
      requiresElementKey(edit.action_type) &&
      (edit.target_element_key == null || edit.target_element_key === "")
    ) {
      return baseDecision({
        reason: "match_fields_missing",
        blocked_by: "system",
        detail: `action_type=${edit.action_type} requires target_element_key but it's missing`,
        ttcEligibility,
        threshold_eligible: false,
        lifecycle_stage,
        days_to_first_citation,
        first_citation_date_iso,
      });
    }
    return baseDecision({
      reason: "accepted_not_live",
      blocked_by: "system",
      detail:
        "accepted; awaiting daily-scan match OR operator Mark Shipped override",
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // 9. Shipped (live_at set). Branch on lifecycle stage.
  if (edit.live_at != null) {
    // Latent coverage gap even for shipped rows.
    if (!exactSnapshotPresent && canonicalSnapshotPresent) {
      // Surface as the canonicalization-mismatch reason. Doesn't
      // block citations (live_at is set, citations can still flow)
      // but it IS a data-quality flag.
      return baseDecision({
        reason: "url_canonicalization_mismatch",
        blocked_by: "system",
        detail: `target=${targetUrl} but snapshot stored as ${canonicalSnapshotExactUrl}, shipped row has canonical-equal but not exact-equal snapshot`,
        ttcEligibility,
        threshold_eligible,
        lifecycle_stage,
        days_to_first_citation,
        first_citation_date_iso,
      });
    }
    if (threshold_eligible) {
      return baseDecision({
        reason: "cited_eligible",
        blocked_by: null,
        detail:
          days_to_first_citation != null
            ? `cited ${days_to_first_citation}d after live; counts toward threshold sample`
            : null,
        ttcEligibility,
        threshold_eligible: true,
        lifecycle_stage,
        days_to_first_citation,
        first_citation_date_iso,
      });
    }
    if (lifecycle_stage === "stuck") {
      return baseDecision({
        reason: "stuck_uncited",
        blocked_by: "system",
        detail:
          "past late_days threshold without citation, see /diagnostics/indexability",
        ttcEligibility,
        threshold_eligible: false,
        lifecycle_stage,
        days_to_first_citation,
        first_citation_date_iso,
      });
    }
    if (lifecycle_stage === "live_not_yet_cited") {
      return baseDecision({
        reason: "verified_live_not_yet_cited",
        blocked_by: null,
        detail: "Beacon is watching for the first citation",
        ttcEligibility,
        threshold_eligible: false,
        lifecycle_stage,
        days_to_first_citation,
        first_citation_date_iso,
      });
    }
    // Shipped + cited but compute didn't classify into a cited band
    // (possible only when lifecycle_result is missing or stage is
    // null). Surface as unknown to flag investigation.
    return baseDecision({
      reason: "unknown",
      blocked_by: "system",
      detail: `shipped but lifecycle_stage=${lifecycle_stage}; compute output incomplete`,
      ttcEligibility,
      threshold_eligible: false,
      lifecycle_stage,
      days_to_first_citation,
      first_citation_date_iso,
    });
  }

  // 10. Fall through.
  return baseDecision({
    reason: "unknown",
    blocked_by: null,
    detail: `status=${status}, live_at=${edit.live_at ?? "null"}, uncategorized`,
    ttcEligibility,
    threshold_eligible: false,
    lifecycle_stage,
    days_to_first_citation,
    first_citation_date_iso,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

type BaseDecisionArgs = {
  reason: LifecycleEligibilityReason;
  blocked_by: "operator" | "system" | null;
  detail: string | null;
  ttcEligibility: ReturnType<typeof getTimeToCitationEligibility>;
  threshold_eligible: boolean;
  lifecycle_stage: PerRowEligibility["lifecycle_stage"];
  days_to_first_citation: number | null;
  first_citation_date_iso: string | null;
};

function baseDecision(args: BaseDecisionArgs): PerRowEligibility {
  return {
    reason: args.reason,
    blocked_by: args.blocked_by,
    detail: args.detail,
    time_to_citation_eligibility_reason: args.ttcEligibility.reason,
    threshold_eligible: args.threshold_eligible,
    lifecycle_stage: args.lifecycle_stage,
    days_to_first_citation: args.days_to_first_citation,
    first_citation_date_iso: args.first_citation_date_iso,
  };
}

/**
 * Action types that require `target_element_key` to be set for the
 * match engine to find them on a page. Action types not in this set
 * either (a) don't need an element key (e.g., create_page recs) or
 * (b) carry the matchable identity in other fields. v1 list covers
 * the typed-text-edit families currently emitted by the
 * recommendation pipeline.
 */
const ELEMENT_KEY_REQUIRED: ReadonlySet<string> = new Set([
  "add_h2_section",
  "add_faq",
  "edit_title",
]);

function requiresElementKey(actionType: string | null | undefined): boolean {
  if (actionType == null) return false;
  return ELEMENT_KEY_REQUIRED.has(actionType);
}

/**
 * Test-only export of internals + the helper.
 */
export const __testing = {
  ELEMENT_KEY_REQUIRED,
  requiresElementKey,
};
