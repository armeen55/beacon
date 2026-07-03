import "server-only";

/**
 * push-cooldown (BEACON_500 P12, v1 465, 2026-07-03) - a per-URL cooldown so I
 * never hammer the SAME live page with back-to-back pushes.
 *
 * WHY, given the outbox already dedupes an IDENTICAL change and the daily cap
 * limits total pushes. The outbox short-circuits only a byte-identical re-push
 * (same change_hash). The daily cap counts pushes across the whole SITE, not per
 * page. Neither stops a rapid sequence of DIFFERENT edits to one URL (a title
 * tweak, then a meta tweak two minutes later, then an h1 tweak) - each is a fresh
 * change_hash and each spends one of the daily slots, but the live page gets
 * rewritten three times in a few minutes. That churns the page, muddies proof (a
 * measurement can't attribute movement to one change), and burns the daily quota
 * on one URL. This cooldown adds a per-URL time window: after a successful push to
 * a URL, further pushes to that SAME URL wait out the window with an honest
 * "already pushed /X today, next push allowed in N hours".
 *
 * SAFETY / CONTRACT:
 *   1. PURE decision core (`cooldownDecision`) - no I/O; the caller passes the
 *      most-recent successful push time for the URL. Trivially testable.
 *   2. Reuses the SAME outbox rows the idempotency guard already records (a
 *      successful push writes a terminal `pushed` row per URL+day), so no new
 *      store, no new env, no new write path. The lookup is tenant-scoped and
 *      matches by target_url.
 *   3. BYTE-IDENTICAL OUTSIDE THE WINDOW (pin): when no in-window prior push
 *      exists, `checkUrlCooldown` returns { blocked: false } and the caller
 *      proceeds exactly as today. Only a same-URL push INSIDE the window changes
 *      behavior.
 *   4. This NEVER writes and NEVER touches Wix - it is a read-only advisory gate
 *      that sits alongside the outbox check, never replacing any structural rail
 *      (Ritz hard-block, caps, snapshot, non-destructive) in executePush.
 *   5. Fail-soft: any read error yields { blocked: false } so a store glitch can
 *      never wedge a legitimate push (same posture as checkOutbox).
 *
 * This module is a decision helper. Wiring it into executePush is a separate,
 * opt-in step; on its own it changes nothing (pin 3).
 */

import { listRecentOutbox } from "./publish-outbox";

/** Default cooldown window between pushes to the SAME URL. Six hours lets an
 *  operator run at most a few pushes per URL per day while still spacing them
 *  enough that each change gets its own measurement window before the next. */
export const DEFAULT_URL_COOLDOWN_HOURS = 6;

export type CooldownDecision =
  | { blocked: false }
  | {
      blocked: true;
      /** Whole hours (rounded up, min 1) until the next push is allowed. */
      hoursUntilAllowed: number;
      /** Operator-facing copy (Beacon voice, no dashes). */
      reason: string;
    };

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * PURE cooldown decision. `lastPushMs` is the epoch-ms of the most-recent
 * SUCCESSFUL push to this URL (null when there is none in scope). `nowMs` is the
 * current time. Blocks only while inside the window; byte-identical (returns
 * blocked:false) outside it or when there is no prior push.
 */
export function cooldownDecision(args: {
  url: string;
  lastPushMs: number | null;
  nowMs: number;
  windowHours?: number;
}): CooldownDecision {
  const windowHours = args.windowHours ?? DEFAULT_URL_COOLDOWN_HOURS;
  if (windowHours <= 0) return { blocked: false };
  if (args.lastPushMs == null || !Number.isFinite(args.lastPushMs)) {
    return { blocked: false };
  }
  const windowMs = windowHours * 3_600_000;
  const elapsedMs = args.nowMs - args.lastPushMs;
  // A prior push in the future (clock skew) or already past the window: allow.
  if (elapsedMs < 0 || elapsedMs >= windowMs) return { blocked: false };
  const remainingMs = windowMs - elapsedMs;
  const hoursUntilAllowed = Math.max(1, Math.ceil(remainingMs / 3_600_000));
  return {
    blocked: true,
    hoursUntilAllowed,
    reason:
      `I already published a change to ${args.url} today, so I did not push again this soon. ` +
      `I can push to this page again in about ${hoursUntilAllowed} hour${hoursUntilAllowed === 1 ? "" : "s"}, ` +
      `which gives the first change time to be measured on its own.`,
  };
}

/**
 * Read-side cooldown check for one URL. Finds this tenant's most-recent
 * successful (`pushed`) outbox row for the SAME URL and applies the pure
 * decision. Fail-soft: any read error returns { blocked: false } so a store
 * glitch never blocks a legitimate push.
 */
export async function checkUrlCooldown(args: {
  tenantId: string;
  targetUrl: string;
  now?: Date;
  windowHours?: number;
}): Promise<CooldownDecision> {
  const nowMs = (args.now ?? new Date()).getTime();
  const target = normalizeUrl(args.targetUrl);
  let lastPushMs: number | null = null;
  try {
    // A generous window of recent rows; we filter to same-URL pushed below.
    const rows = await listRecentOutbox(args.tenantId, 200);
    for (const r of rows) {
      if (r.state !== "pushed") continue;
      if (normalizeUrl(r.target_url) !== target) continue;
      const t = Date.parse(r.recorded_at);
      if (!Number.isFinite(t)) continue;
      if (lastPushMs == null || t > lastPushMs) lastPushMs = t;
    }
  } catch {
    return { blocked: false };
  }
  return cooldownDecision({
    url: args.targetUrl,
    lastPushMs,
    nowMs,
    windowHours: args.windowHours,
  });
}
