import "server-only";

import { after } from "next/server";

import { log } from "@/lib/logger";
import { getConnectorInfo } from "@/lib/connector-store";
import { refreshAllConnectedDataNow } from "@/app/(shell)/settings/connectors/actions";
import { readStore, writeStore } from "@/lib/persistence/json-store";

/**
 * on-visit-refresh (operator spec 2026-07-09, I-59) - freshness is guaranteed ON
 * VISIT, never dependent on a cron. A single-operator app is opened by hand, not
 * on a schedule, so the moment the operator lands on Today we check whether the
 * freshest connected read source has gone stale and, if so, fire the EXISTING
 * one-click "refresh everything" action in the background.
 *
 * The whole pass runs via next/after, the same pattern as auto-measure-on-use:
 * it adds ZERO render latency, and on serverless it survives the response (a
 * plain floating promise is frozen the moment the lambda answers, which would
 * silently kill a multi-source refresh in prod while looking fine in dev).
 *
 * A nightly cron may still warm data as a long-term optimization, but the product
 * must never DEPEND on it. This closes that gap. Content publishing is never
 * touched here - this is a READ refresh only (refreshAllConnectedDataNow pulls
 * every connected read source and warms the shared surfaces; Wix is publish-only
 * and excluded there).
 */

/** How old the freshest good sync must be before an on-visit refresh fires. */
export const STALE_AFTER_HOURS = 12;
/** Never fire a second background refresh inside this window (no refresh storm on
 *  rapid revisits). Persisted per tenant in the on-visit-refresh-marker store. */
export const THROTTLE_HOURS = 6;

/** The connected READ sources whose freshness governs an on-visit refresh - the
 *  same set refreshAllConnectedDataNow pulls (Wix is publish-only, excluded). */
const READ_SOURCE_PROVIDERS = [
  "google_gsc",
  "google_ga4",
  "clarity",
  "profound",
] as const;

const MARKER_STORE = "on-visit-refresh-marker";

type OnVisitRefreshMarker = { lastAttemptAt: string };

/**
 * PURE decision: given the freshest good sync across connected read sources, the
 * last auto-refresh attempt, the current time, and how many read sources are
 * connected, should we fire an on-visit refresh now?
 *
 *  - stale + not throttled          -> true
 *  - fresh                          -> false
 *  - stale + attempted recently     -> false (throttled)
 *  - never synced, sources connected -> true (first pull)
 *  - nothing connected              -> false (nothing to refresh)
 */
export function shouldAutoRefresh(
  freshestSyncIso: string | null,
  lastAttemptIso: string | null,
  nowMs: number,
  connectedSourceCount: number,
): boolean {
  // Throttle wins over staleness: never fire a second background refresh inside
  // the throttle window, so rapid revisits can't trigger a refresh storm.
  if (lastAttemptIso != null && lastAttemptIso !== "") {
    const attemptMs = Date.parse(lastAttemptIso);
    if (Number.isFinite(attemptMs) && nowMs - attemptMs < THROTTLE_HOURS * 3_600_000) {
      return false;
    }
  }
  // Nothing connected: there is nothing to pull, so never fire.
  if (connectedSourceCount <= 0) return false;
  // Never synced (or an unreadable stamp): a connected source with no data yet
  // should refresh on the first visit.
  if (freshestSyncIso == null || freshestSyncIso === "") return true;
  const freshestMs = Date.parse(freshestSyncIso);
  if (!Number.isFinite(freshestMs)) return true;
  // Stale when the freshest good sync is older than the staleness limit.
  return nowMs - freshestMs >= STALE_AFTER_HOURS * 3_600_000;
}

/** Read the per-tenant attempt marker, or null on first visit / any store outage. */
async function readMarker(): Promise<OnVisitRefreshMarker | null> {
  const rows = await readStore<OnVisitRefreshMarker>(MARKER_STORE, []).catch(
    () => [] as OnVisitRefreshMarker[],
  );
  const row = rows[0];
  if (!row || typeof row.lastAttemptAt !== "string") return null;
  return row;
}

/** Stamp this attempt. Fail-soft: a write outage just means the next visit is not
 *  throttled, never a thrown render. */
async function writeMarker(marker: OnVisitRefreshMarker): Promise<void> {
  await writeStore<OnVisitRefreshMarker>(MARKER_STORE, [marker]).catch(() => {});
}

/**
 * On-visit entry point (I-59). Schedules the WHOLE pass via after(): read the
 * freshest last_synced_at across the connected read sources (same
 * getConnectorInfo read the Connections cards and the pipeline readings use),
 * consult the throttle marker, and if a refresh is warranted record the attempt
 * then run the existing one-click refresh - all post-response, so the render
 * pays nothing and the refresh survives on serverless. Every error is swallowed
 * with one log.warn; outside a request scope (tests, scripts) this is a no-op.
 */
export function maybeRefreshStaleDataOnVisit(tenantId: string): void {
  try {
    after(async () => {
      try {
        let freshestMs = Number.NEGATIVE_INFINITY;
        let freshestIso: string | null = null;
        let connectedCount = 0;
        for (const provider of READ_SOURCE_PROVIDERS) {
          const info = await getConnectorInfo(provider, tenantId).catch(() => null);
          if (info == null || info.status !== "connected") continue;
          connectedCount += 1;
          const iso = info.last_synced_at;
          if (typeof iso === "string" && iso !== "") {
            const ms = Date.parse(iso);
            if (Number.isFinite(ms) && ms > freshestMs) {
              freshestMs = ms;
              freshestIso = iso;
            }
          }
        }

        const marker = await readMarker();
        const nowMs = Date.now();
        if (!shouldAutoRefresh(freshestIso, marker?.lastAttemptAt ?? null, nowMs, connectedCount)) {
          return;
        }

        // Record the attempt BEFORE the refresh so a slow or failed refresh still
        // throttles the next visit (no refresh storm while one is in flight).
        await writeMarker({ lastAttemptAt: new Date(nowMs).toISOString() });

        // The existing one-click refresh (pulls every connected read source +
        // warms the shared surfaces). Awaited here inside after(), where the
        // platform keeps the lambda alive until it settles.
        await refreshAllConnectedDataNow();
      } catch (e) {
        log.warn("On-visit auto-refresh failed", {
          tenantId,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
      }
    });
  } catch {
    // after() is only valid inside a request scope - a test or script caller
    // simply gets a no-op, same as scheduleAutoMeasure.
  }
}
