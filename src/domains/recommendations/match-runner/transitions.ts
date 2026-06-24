/**
 * Recommendation Lifecycle OS — Phase 3 (2026-04-27).
 *
 * Pure status-transition function. Decides what (if anything) the
 * runner should write back to a `recommended_edits` row given:
 *   - the row's current `implementation_status`
 *   - a fresh `MatchResult` from the pure match engine
 *   - the row's age in ms since accepted (for the 7-day `not_found_after_7d` rule)
 *   - the current scan snapshot's `fetched_at` + `id` (for `live_at` stamping)
 *
 * Returns either `null` (no-op — runner skips the write) or a
 * `LifecycleUpdate` describing the diff to apply.
 *
 * Forward-only with two intentional bidirectional transitions:
 *   - `verified_live`          ↔ `verified_live_modified`
 *
 * No `verified_live*` row is ever auto-downgraded to `needs_review` /
 * `not_found` etc. — that requires manual operator override.
 *
 * `dismissed` rows are immutable from the runner.
 */

import type {
  ImplementationStatus,
  LiveMatchKind,
  RecommendedEditRow,
} from "../recommended-edits-persistence";
import type { MatchKind, MatchResult } from "../match-engine";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Engine `MatchKind` is a superset of persistence `LiveMatchKind` —
 * the engine's `"none"` and `"unsupported"` kinds are returned only
 * with `outcome: "not_found"`, where the runner does not stamp
 * `live_*` fields. The runner ONLY calls this helper from branches
 * that already verified `match.outcome ∈ {verified_live*, intermediate}`,
 * so `"none"` / `"unsupported"` never reach the persistence layer.
 * Narrowing is just a type-system courtesy to avoid widening
 * `LiveMatchKind` with engine-only values.
 */
function toLiveMatchKind(kind: MatchKind): LiveMatchKind | null {
  switch (kind) {
    case "exact":
    case "modified":
    case "key_only":
    case "text_only":
    case "wrong_page":
    case "structural_partial":
      return kind;
    case "none":
    case "unsupported":
      return null;
  }
}

export type LifecycleUpdate = Partial<
  Pick<
    RecommendedEditRow,
    | "implementation_status"
    | "live_at"
    | "live_snapshot_id"
    | "live_match_confidence"
    | "live_match_kind"
    | "live_element_key"
    // #100 substrate (2026-06-11): live wording at verify time.
    | "live_text"
    | "not_found_reason"
  >
>;

export type ComputeLifecycleUpdateInputs = {
  currentStatus: ImplementationStatus;
  match: MatchResult;
  /**
   * Milliseconds since the edit was accepted (per `computeAcceptedAtMs`).
   *
   * Phase 3.1 (2026-04-27): may be `null` when no stable accept-time
   * source exists (no matching changelog, no accepted recommendation
   * response, no `created_at` on the row). When `null`, the
   * `not_found_after_7d` promotion is SKIPPED — the row stays
   * `accepted` regardless of how long ago the runner first saw it.
   * The caller (runner) emits a structured warning + counter when
   * this happens so the operator can detect drift.
   *
   * `null` does NOT block any other transition — verified_live*,
   * needs_review, wrong_page, partially_implemented promotions all
   * still fire normally because they don't depend on age.
   */
  ageMs: number | null;
  /** ISO of the matching scan snapshot's `fetched_at`. Stamped onto
   *  `live_at` for verified outcomes. May be null when no snapshot
   *  exists for the target URL (engine returned `not_found` for a
   *  reason like that). */
  scanFetchedAt: string | null;
  /** `page_snapshots.id` of the matching snapshot. */
  scanSnapshotId: string | null;
};

/**
 * Returns the diff to apply, or `null` for no-op.
 *
 * Existing `live_*` columns on the row are preserved unless explicitly
 * changed in the returned diff (caller spreads the diff over the row).
 * That's deliberate: a `verified_live` row whose subsequent re-scan
 * produces `not_found` keeps its `live_at` etc. (no-op return).
 */
export function computeLifecycleUpdate(
  inputs: ComputeLifecycleUpdateInputs,
): LifecycleUpdate | null {
  const { currentStatus, match, ageMs, scanFetchedAt, scanSnapshotId } = inputs;

  // Terminal states: never auto-mutate.
  if (currentStatus === "dismissed") return null;
  if (currentStatus === "recommended") {
    // Reconciler is expected to flip these to `accepted` BEFORE the
    // matcher runs. If we still see `recommended` here it means there
    // is no upstream accepted-evidence — refuse to act.
    return null;
  }

  const matchOutcome = match.outcome;

  // ── Live outcomes (verified_live / verified_live_modified) ──────────
  // These always promote (or laterally update) — they're the highest
  // possible state. The bidirectional VL ↔ VLM rule lives here.
  if (matchOutcome === "verified_live") {
    if (currentStatus === "verified_live") {
      // Already at the highest state; check if `live_*` fields need
      // re-stamping (e.g. snapshot id changed). To keep idempotency
      // tight, only update if the snapshot id actually differs.
      return null;
    }
    return {
      implementation_status: "verified_live",
      live_at: scanFetchedAt,
      live_snapshot_id: scanSnapshotId,
      live_match_confidence: match.confidence,
      live_match_kind: toLiveMatchKind(match.kind),
      live_element_key: match.matchedElementKey ?? null,
      // #100 substrate (2026-06-11): keep the live wording uniformly.
      live_text: match.matchedElementText ?? null,
      not_found_reason: null,
    };
  }

  if (matchOutcome === "verified_live_modified") {
    // Allow lateral VL → VLM (text drift detected).
    if (currentStatus === "verified_live_modified") return null;
    return {
      implementation_status: "verified_live_modified",
      live_at: scanFetchedAt,
      live_snapshot_id: scanSnapshotId,
      live_match_confidence: match.confidence,
      live_match_kind: toLiveMatchKind(match.kind),
      live_element_key: match.matchedElementKey ?? null,
      // #100 substrate (2026-06-11): the operator's FINAL wording —
      // the proposed→final delta the learning loop consumes.
      live_text: match.matchedElementText ?? null,
      not_found_reason: null,
    };
  }

  // ── Intermediate outcomes (needs_review / wrong_page / partial) ────
  // Forward-only: only update if currentStatus is at or below
  // `accepted` priority. Never downgrade verified_live*.
  if (
    matchOutcome === "needs_review" ||
    matchOutcome === "wrong_page" ||
    matchOutcome === "partially_implemented"
  ) {
    if (
      currentStatus === "verified_live" ||
      currentStatus === "verified_live_modified" ||
      // audit-wave3 #11: a pushed rec must not be downgraded to needs_review by a
      // scan ambiguity — the operator already shipped it; verify-live (not a
      // crawl mismatch) decides its fate.
      currentStatus === "pushed"
    ) {
      return null;
    }
    if (currentStatus === matchOutcome) return null; // already there
    // accepted | needs_review | wrong_page | partially_implemented |
    // not_found_after_7d → matchOutcome
    return {
      implementation_status: matchOutcome,
      live_match_confidence: match.confidence,
      live_match_kind: toLiveMatchKind(match.kind),
      live_element_key: match.matchedElementKey ?? null,
      not_found_reason: match.reason ?? null,
    };
  }

  // ── not_found — special handling ────────────────────────────────────
  // Only `accepted` can transition out via the 7-day rule. Other
  // states are sticky (not_found doesn't downgrade verified_live*,
  // doesn't pull needs_review / wrong_page / partial back to accepted,
  // doesn't reset not_found_after_7d).
  if (matchOutcome === "not_found") {
    if (currentStatus === "accepted") {
      // Phase 3.1: ageMs === null means no stable accept-time source.
      // Skip the 7-day promotion entirely — the runner has emitted a
      // structured warning so the drift is observable. Stay accepted
      // until the next scan (which may pick up a stable source if the
      // operator has since materialized one).
      if (ageMs === null) return null;
      if (ageMs >= SEVEN_DAYS_MS) {
        return {
          implementation_status: "not_found_after_7d",
          not_found_reason:
            match.reason ?? "no matching element after 7-day window",
        };
      }
      return null; // stay accepted; will retry next scan
    }
    return null;
  }

  // Exhaustiveness — match.outcome union should be fully covered above.
  const _exhaustive: never = matchOutcome as never;
  void _exhaustive;
  return null;
}
