/**
 * 2026-05-18 — Section 8 J2 — GSC token expiry soft-fail handler.
 *
 * Pure function that classifies a Google OAuth access-token's expiry
 * state into a three-value status:
 *
 *   • `fresh`             — token is still within its access window
 *                            (or about to expire within the 60s
 *                            refresh-buffer); caller may use it
 *                            directly without refreshing.
 *   • `stale_under_7d`    — token's `expires_at` is in the past but
 *                            less than 7 days ago; caller should
 *                            attempt the OAuth refresh and proceed
 *                            on success or fall back on failure.
 *   • `stale_over_7d`     — token's `expires_at` is ≥ 7 days in the
 *                            past; caller SHOULD NOT attempt a
 *                            refresh (Google's refresh tokens become
 *                            unreliable after long inactivity per
 *                            their docs + observed behavior). Caller
 *                            should surface the most-recent cached
 *                            data marked stale and prompt the
 *                            operator to reconnect.
 *
 * The 7-day window is the locked Section 8 J2 decision. Tunable
 * post-deploy if operator evidence justifies; the constant is
 * exported for tests + the operator-visible "Last refreshed at X
 * days ago" copy on `/settings/connectors`.
 *
 * Pure: no I/O, no logging, no clock reads. Deterministic on input.
 *
 * Pinned by:
 *   • `tests/lib/connectors/gsc/expiry-handler.test.ts`
 */

import "server-only";

import type { GoogleConnectorToken } from "@/lib/connector-store";

/** Locked expiry classifier output. */
type ExpiryStatus = "fresh" | "stale_under_7d" | "stale_over_7d";

/**
 * Refresh-buffer window. A token within 60s of its `expires_at` is
 * treated as already-expired for refresh purposes so the caller has
 * margin to complete the OAuth round-trip before the access token
 * goes stale mid-request.
 */
const REFRESH_BUFFER_MS = 60_000;

/**
 * Locked Section 8 J2 cutoff — 7 days in milliseconds. Tokens
 * expired beyond this threshold are NOT refreshed; caller surfaces
 * cached data marked stale and prompts reconnect.
 */
const STALE_OVER_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

type EvaluateExpiryArgs = {
  /** The Google connector token (GSC or GBP). */
  token: GoogleConnectorToken;
  /** Current time. Optional — defaults to `new Date()` only when
   *  invoked from a caller that doesn't already have a clock value;
   *  every production call site threads its own `now` for
   *  determinism + tests. */
  now: Date | number;
};

/**
 * Pure classifier. Returns one of three status tokens.
 *
 * Rules:
 *   1. Token has no `expires_at` (e.g., the field was dropped in a
 *      payload migration) → treat as `stale_over_7d` to force
 *      operator reconnect instead of silently using a half-known
 *      token.
 *   2. `nowMs < expires_at - REFRESH_BUFFER_MS` → `fresh`.
 *   3. `expires_at - REFRESH_BUFFER_MS <= nowMs <
 *       expires_at + STALE_OVER_THRESHOLD_MS` → `stale_under_7d`.
 *   4. `nowMs >= expires_at + STALE_OVER_THRESHOLD_MS` →
 *      `stale_over_7d`.
 */
export function evaluateExpiry(args: EvaluateExpiryArgs): ExpiryStatus {
  const { token } = args;
  const nowMs = args.now instanceof Date ? args.now.getTime() : args.now;
  if (typeof token.expires_at !== "number" || !Number.isFinite(token.expires_at)) {
    return "stale_over_7d";
  }
  // Token still valid (within or just before expiry buffer).
  if (nowMs < token.expires_at - REFRESH_BUFFER_MS) {
    return "fresh";
  }
  // Token expired ≥ 7 days ago — refresh is likely to fail. Surface
  // stale cache + prompt reconnect instead of burning a refresh.
  if (nowMs >= token.expires_at + STALE_OVER_THRESHOLD_MS) {
    return "stale_over_7d";
  }
  // Token expired (or within buffer) but ≤ 7 days past — refresh
  // attempt is reasonable.
  return "stale_under_7d";
}

/**
 * Operator-readable "Last refreshed at X days ago" copy. Used by
 * `/settings/connectors` to surface staleness when status is
 * `stale_*`. Pure formatting; no I/O.
 *
 * Mirrors the locked copy from Section 8 J2: "GSC data last
 * refreshed X days ago. Reconnect to refresh."
 */
export function formatLastRefreshedCopy(args: {
  lastSyncedMs: number;
  now: Date | number;
}): string {
  const nowMs = args.now instanceof Date ? args.now.getTime() : args.now;
  const diffMs = Math.max(0, nowMs - args.lastSyncedMs);
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    return "GSC data last refreshed less than a day ago.";
  }
  if (days === 1) {
    return "GSC data last refreshed 1 day ago. Reconnect to refresh.";
  }
  return `GSC data last refreshed ${days} days ago. Reconnect to refresh.`;
}

