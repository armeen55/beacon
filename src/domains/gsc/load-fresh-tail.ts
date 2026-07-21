/**
 * load-fresh-tail (R17b / P2 slice 2, v1 item 264) - the I/O edge for the
 * scoreboard's dotted "still settling" tail.
 *
 * OPT-IN render-time read: ONE searchanalytics.query call (dimensions
 * ["date"], dataState "all") covering only the final-lag days the chart's
 * final lane excludes. Sits behind a tiny volatile presentation cache (the
 * "gsc-fresh-tail" json-store, TTL 3 hours, Supabase-mirrored so hosted
 * lambdas share it) so a busy Today page never hammers the API.
 *
 * THE INVIOLABLE RULE (pinned by fresh-tail.test.ts scanning this file):
 * fresh numbers are NEVER written into the final daily tables. This module
 * must not reference the daily row/totals tables or any final flag; its only
 * write is the volatile cache row, which carries settling points exclusively.
 *
 * Fail-soft everywhere: no token / no property / a failed pull / an empty
 * window returns null and the chart renders exactly as before (no tail).
 */

import "server-only";

import { cache } from "react";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import {
  gscSearchAnalyticsQuery,
  resolveGscAccessToken,
} from "@/lib/connectors/gsc/search-analytics";
import { pacificDateString, resolveProperty } from "@/lib/connectors/gsc/sync-search-analytics";
import {
  buildFreshTailPoints,
  freshTailWindow,
  type FreshTailPoint,
} from "./fresh-tail";

export const GSC_FRESH_TAIL_STORE = "gsc-fresh-tail";

/** Reuse a cached tail for this long; fresh counts move slowly within a day. */
export const FRESH_TAIL_CACHE_MS = 3 * 60 * 60 * 1000;

type FreshTailCacheRow = {
  tenant_id: string;
  computedAt: string;
  /** The final-lane date the tail was computed against; a newer reported day
   *  invalidates the cached window. */
  lastReportedDate: string;
  points: FreshTailPoint[];
};

/** W2-B (2026-07-10) - the served tail plus how old the cached window is, so a
 *  render can serve the last cached tail with an HONEST freshness label instead of
 *  paying a live GSC query on its critical path. */
export type FreshTailCached = {
  points: FreshTailPoint[];
  /** ISO timestamp the cached window was computed; null when the cache is empty. */
  computedAt: string | null;
  /** True when the cached row is older than the 3h TTL (a refresh is worth scheduling). */
  stale: boolean;
};

/**
 * W2-B (2026-07-10) - CACHE-ONLY read for the render path. NEVER issues a live GSC
 * query and NEVER writes; it only serves the volatile-cache row for the SAME final
 * edge (serving a stale row too, SWR-style, flagged so the caller can schedule a
 * background refresh). This is what moved the one live searchanalytics.query call
 * OFF the scoreboard's render critical path. Null when there is no usable cached
 * window yet (first-ever view: the after() refresh below warms it for next time).
 */
export const readGscFreshTailCached = cache(
  async (
    tenantId: string,
    lastReportedDate: string | null,
    now: Date = new Date(),
  ): Promise<FreshTailCached | null> => {
    if (!tenantId || !lastReportedDate) return null;
    if (freshTailWindow(lastReportedDate, pacificDateString(now)) == null) return null;
    try {
      const cached = await readStore<FreshTailCacheRow>(GSC_FRESH_TAIL_STORE, []);
      const mine = cached.find((r) => r.tenant_id === tenantId);
      if (!mine || mine.lastReportedDate !== lastReportedDate) return null;
      const computedMs = Date.parse(mine.computedAt);
      const stale = !Number.isFinite(computedMs) || now.getTime() - computedMs >= FRESH_TAIL_CACHE_MS;
      if (mine.points.length === 0) {
        // A cached empty result is a real "no tail here" answer; report its age so
        // a stale empty still schedules a refresh, but render nothing.
        return { points: [], computedAt: mine.computedAt ?? null, stale };
      }
      return { points: mine.points, computedAt: mine.computedAt ?? null, stale };
    } catch {
      return null;
    }
  },
);

/**
 * W2-B (2026-07-10) - the LIVE refresh, for a background after() (never a render).
 * Issues the ONE bounded searchanalytics.query for the settling window and writes
 * the volatile cache row (an empty result is cached too, so a quiet property does
 * not re-query for 3h). Fail-soft: returns the fresh points or null; the previous
 * cache row stays in place on any failure.
 */
export async function refreshGscFreshTail(
  tenantId: string,
  lastReportedDate: string | null,
  now: Date = new Date(),
): Promise<FreshTailPoint[] | null> {
  if (!tenantId || !lastReportedDate) return null;
  const window = freshTailWindow(lastReportedDate, pacificDateString(now));
  if (window == null) return null;
  let cached: FreshTailCacheRow[] = [];
  try {
    cached = await readStore<FreshTailCacheRow>(GSC_FRESH_TAIL_STORE, []);
  } catch {
    cached = [];
  }
  try {
    const accessToken = await resolveGscAccessToken(tenantId, now);
    if (accessToken == null) return null;
    const property = await resolveProperty(tenantId, accessToken);
    if (property == null) return null;
    // ONE bounded request: per-day totals for the settling window only.
    const rows = await gscSearchAnalyticsQuery({
      accessToken,
      siteUrl: property,
      startDate: window.start,
      endDate: window.end,
      dimensions: ["date"],
      dataState: "all",
    });
    if (rows == null) return null;
    const points = buildFreshTailPoints(rows, window);
    try {
      const others = cached.filter((r) => r.tenant_id !== tenantId);
      await writeStore<FreshTailCacheRow>(GSC_FRESH_TAIL_STORE, [
        ...others,
        { tenant_id: tenantId, computedAt: now.toISOString(), lastReportedDate, points },
      ]);
    } catch {
      /* cache write is best-effort */
    }
    return points.length > 0 ? points : null;
  } catch (e) {
    log.warn("[gsc-fresh-tail] live refresh failed (previous cache kept)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
