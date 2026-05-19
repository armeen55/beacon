/**
 * 2026-05-19 — Slice 9.A2α.2 — Mode A outcome attribution
 * (cited-here-traffic-here): pure compute.
 *
 * Implements the Section 6 Mode A scope discipline for GA4 traffic
 * attribution per the locked K-block (Section 9 Decision Lock):
 *   • K4 sample-size guard: ≥ 7 days post-live AND
 *     (≥ 5 sessions OR ≥ 1 qualified call).
 *   • K5 customer copy contract is enforced in 9.A2β; this module
 *     emits a discriminated `ModeAResult` union that the surface
 *     layer renders downstream. NO customer copy is generated here.
 *
 * Scope:
 *   Mode A only — the "this page was cited here AND traffic landed
 *   on this page after live_at" path. Mode B (affected-prompt
 *   uplift) and Mode C (brand-level lift not attributed to this
 *   change) are OUT OF SCOPE; they land in future slices when
 *   their evidence sources exist (Mode B needs GSC query→URL
 *   traffic; Mode C is operator-only by contract).
 *
 * CallRail status:
 *   K2 lock: CallRail deferred indefinitely. The K4 sample-size
 *   guard's "qualified call" branch stays in the source so callers
 *   can light it up when CallRail (or another call-tracking
 *   connector) ships. For 9.A2α.2, callers MUST pass
 *   `qualifiedCallCount = 0`; the K4 OR shortcircuits to the
 *   sessions branch (≥ 5 sessions). The branch is kept in the
 *   source so the K4 contract is honored completely.
 *
 * "No matching traffic rows" decision (operator-locked, documented):
 *   When `matchingRows.length === 0` AFTER URL canonicalization +
 *   post-live_at + non-future filtering, the result is
 *   `ineligible: no_traffic_data` — NOT `still_learning_outcome`.
 *   Rationale: zero GA4 rows for the URL is a categorically
 *   different signal from "rows exist but volume is low." A
 *   missing URL in `ga4_url_traffic` means Beacon either has no
 *   tracking for that page OR no traffic at all has landed —
 *   the operator surface should surface that distinct state so
 *   the operator can act (verify GA4 tracking; verify the page
 *   exists; verify the property selection). Waiting more days
 *   does not resolve `no_traffic_data`; a separate fix does.
 *
 * Pure compute:
 *   - No I/O.
 *   - No logger.
 *   - No clock reads (caller threads `now`).
 *   - No Supabase imports.
 *   - No GA4 Data API client imports.
 *   - No `currentTenantSlug()` / `currentTenantId()` reads.
 *   - No customer copy.
 *   - Deterministic on input.
 *   - Does NOT mutate any field on the input `ga4UrlTrafficRows`
 *     array or any row within it; the local accumulators sum
 *     into fresh primitive variables.
 *
 * Pinned by:
 *   • `tests/architecture/outcome-attribution-mode-a-sample-size-guard.test.ts`
 *     (pins the three K4 constants, the OR branch, purity, and
 *     defense-in-depth K5 forbidden-vocab absence).
 *   • Future 9.A2β invariants will pin the customer-copy variants
 *     that consume this result.
 */

import "server-only";

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { Ga4UrlTrafficRow } from "@/lib/connectors/ga4/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

// ─────────────────────────────────────────────────────────────────────
// Locked K4 thresholds (Section 9 Decision Lock K4)
// ─────────────────────────────────────────────────────────────────────

/** ≥ 7 post-live polling days before Mode A renders eligible. */
export const MODE_A_MIN_DAYS_POST_LIVE = 7;

/** ≥ 5 sessions threshold half of K4's OR-condition. */
export const MODE_A_MIN_SESSIONS = 5;

/** ≥ 1 qualified call threshold half of K4's OR-condition.
 *  CallRail-deferred per K2; callers pass `qualifiedCallCount=0`
 *  in 9.A2α.2. */
export const MODE_A_MIN_QUALIFIED_CALLS = 1;

// ─────────────────────────────────────────────────────────────────────
// Result discriminated union
// ─────────────────────────────────────────────────────────────────────

export type ModeAResult =
  | {
      kind: "eligible";
      /** Inclusive UTC-day count from `live_at` to `now`. */
      days_since_live: number;
      /** Sessions summed across post-live window for matching URL. */
      post_live_sessions: number;
      /** Engaged sessions summed across post-live window. */
      post_live_engaged_sessions: number;
      /** Conversions summed across post-live window. Operator-side
       *  only — NOT surfaced in K5 customer copy. */
      post_live_conversions: number;
      /** Qualified call count (K2: 0 until CallRail ships). */
      post_live_qualified_calls: number;
      /** Canonical URL used for matching. */
      canonical_target_url: string;
      /** Inclusive UTC-date range the rollup covers. */
      sample_window_start: string;
      sample_window_end: string;
    }
  | {
      kind: "still_learning_outcome";
      reason:
        | "insufficient_days" // < 7 days since live_at
        | "insufficient_volume"; // ≥ 7 days but < 5 sessions AND < 1 call
      days_since_live: number;
      post_live_sessions: number;
      post_live_qualified_calls: number;
      canonical_target_url: string;
      sample_window_start: string;
      sample_window_end: string;
    }
  | {
      kind: "ineligible";
      reason:
        | "no_live_at"
        | "no_target_url"
        | "no_traffic_data";
      canonical_target_url: string | null;
    };

// ─────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimal recommended-edit shape consumed by Mode A. Caller may pass
 * a full `RecommendedEditRow` (the type satisfies this via `Pick`)
 * or a tighter ad-hoc object for tests / future read sites.
 * Additional fields on the caller's object (e.g. `id`, `rec_id`) are
 * IGNORED by Mode A — they are operator-debugging fields only.
 */
export type ComputeModeAArgs = {
  recommendedEdit: Pick<RecommendedEditRow, "target_url" | "live_at">;
  /** Pre-fetched cached `ga4_url_traffic` rows for the tenant. The
   *  read site (operator diagnostic in 9.A2α.3; customer surface
   *  in 9.A2β) is responsible for the Supabase fetch. Mode A is
   *  pure compute over caller-supplied rows. */
  ga4UrlTrafficRows: Ga4UrlTrafficRow[];
  /** Qualified call count for the same post-live window. 9.A2α.2
   *  callers pass 0; CallRail-ready callers light this up when the
   *  9.B connector ships. */
  qualifiedCallCount?: number;
  /** Clock injection — pure tests + deterministic operator-diagnostic
   *  renders. */
  now: Date;
};

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute Mode A outcome attribution for a single recommended edit.
 *
 * Algorithm (locked truth table):
 *   1. Validate `live_at` present + parseable → else `ineligible:
 *      no_live_at`.
 *   2. Validate `target_url` present + not `needs_new_page` sentinel
 *      → else `ineligible: no_target_url`.
 *   3. Canonicalize `target_url` → else `ineligible: no_target_url`.
 *   4. Filter `ga4UrlTrafficRows` by:
 *      • canonical URL match
 *      • `row.date >= live_at_date` (UTC date comparison)
 *      • `row.date <= now_date` (defensive against future-dated rows)
 *   5. If no rows match → `ineligible: no_traffic_data` (see header
 *      comment for the documented decision rationale).
 *   6. Sum `sessions` / `engaged_sessions` / `conversions` across
 *      matching rows.
 *   7. Apply K4 sample-size guard:
 *      • `days_since_live < 7` → `still_learning_outcome:
 *        insufficient_days`.
 *      • `days_since_live >= 7` AND `post_live_sessions < 5` AND
 *        `qualifiedCallCount < 1` → `still_learning_outcome:
 *        insufficient_volume`.
 *      • else → `eligible`.
 *
 * Forward-compat: when CallRail lands, callers pass real
 * `qualifiedCallCount` and step 7's OR branch lights up.
 *
 * Pure function: no I/O, no clock reads, no mutation of input.
 */
export function computeModeATrafficAttribution(
  args: ComputeModeAArgs,
): ModeAResult {
  const { recommendedEdit, ga4UrlTrafficRows, now } = args;
  const qualifiedCallCount = args.qualifiedCallCount ?? 0;

  // Step 1: validate live_at.
  const liveAt = recommendedEdit.live_at ?? null;
  if (liveAt == null || liveAt === "") {
    return {
      kind: "ineligible",
      reason: "no_live_at",
      canonical_target_url: null,
    };
  }

  // Step 2: validate target_url + sentinel check.
  const targetUrl = recommendedEdit.target_url ?? null;
  if (targetUrl == null || targetUrl === "" || targetUrl === "needs_new_page") {
    return {
      kind: "ineligible",
      reason: "no_target_url",
      canonical_target_url: null,
    };
  }

  // Step 3: canonicalize.
  const canonicalTargetUrl = canonicalizeCitationUrl(targetUrl);
  if (canonicalTargetUrl == null || canonicalTargetUrl === "") {
    return {
      kind: "ineligible",
      reason: "no_target_url",
      canonical_target_url: null,
    };
  }

  // Validate live_at is parseable; else treat as no_live_at.
  const liveAtMs = Date.parse(liveAt);
  if (!Number.isFinite(liveAtMs)) {
    return {
      kind: "ineligible",
      reason: "no_live_at",
      canonical_target_url: canonicalTargetUrl,
    };
  }

  const liveAtDate = isoDateUTC(new Date(liveAtMs));
  const nowDate = isoDateUTC(now);

  // Step 4: filter rows. Pure — no mutation of `ga4UrlTrafficRows`.
  // The local array `matchingRows` holds references to the original
  // row objects; we read from them but never mutate. The aggregation
  // in step 6 uses local primitive accumulators.
  const matchingRows: Ga4UrlTrafficRow[] = [];
  for (const row of ga4UrlTrafficRows) {
    if (row == null || typeof row !== "object") continue;
    const rowCanonical = canonicalizeCitationUrl(row.url);
    if (rowCanonical !== canonicalTargetUrl) continue;
    if (row.date < liveAtDate) continue;
    if (row.date > nowDate) continue;
    matchingRows.push(row);
  }

  // Step 5: no matching rows → ineligible.
  if (matchingRows.length === 0) {
    return {
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: canonicalTargetUrl,
    };
  }

  // Step 6: aggregate. Local accumulators only; rows untouched.
  let postLiveSessions = 0;
  let postLiveEngaged = 0;
  let postLiveConversions = 0;
  for (const row of matchingRows) {
    postLiveSessions += row.sessions;
    postLiveEngaged += row.engaged_sessions;
    postLiveConversions += row.conversions;
  }

  // Days since live (UTC-day count; inclusive).
  const daysSinceLive = Math.max(
    0,
    Math.floor((now.getTime() - liveAtMs) / (24 * 60 * 60 * 1000)),
  );

  // Step 7: K4 sample-size guard.
  if (daysSinceLive < MODE_A_MIN_DAYS_POST_LIVE) {
    return {
      kind: "still_learning_outcome",
      reason: "insufficient_days",
      days_since_live: daysSinceLive,
      post_live_sessions: postLiveSessions,
      post_live_qualified_calls: qualifiedCallCount,
      canonical_target_url: canonicalTargetUrl,
      sample_window_start: liveAtDate,
      sample_window_end: nowDate,
    };
  }
  const sessionsThresholdMet = postLiveSessions >= MODE_A_MIN_SESSIONS;
  const callsThresholdMet = qualifiedCallCount >= MODE_A_MIN_QUALIFIED_CALLS;
  if (!sessionsThresholdMet && !callsThresholdMet) {
    return {
      kind: "still_learning_outcome",
      reason: "insufficient_volume",
      days_since_live: daysSinceLive,
      post_live_sessions: postLiveSessions,
      post_live_qualified_calls: qualifiedCallCount,
      canonical_target_url: canonicalTargetUrl,
      sample_window_start: liveAtDate,
      sample_window_end: nowDate,
    };
  }

  return {
    kind: "eligible",
    days_since_live: daysSinceLive,
    post_live_sessions: postLiveSessions,
    post_live_engaged_sessions: postLiveEngaged,
    post_live_conversions: postLiveConversions,
    post_live_qualified_calls: qualifiedCallCount,
    canonical_target_url: canonicalTargetUrl,
    sample_window_start: liveAtDate,
    sample_window_end: nowDate,
  };
}

/** Return a `YYYY-MM-DD` UTC date string from a Date instance. */
function isoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Test-only export of internals. */
export const __testing = {
  MODE_A_MIN_DAYS_POST_LIVE,
  MODE_A_MIN_SESSIONS,
  MODE_A_MIN_QUALIFIED_CALLS,
  isoDateUTC,
};
