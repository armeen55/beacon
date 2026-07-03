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

/**
 * The dotted tail for one tenant's scoreboard, given the chart's last
 * REPORTED (final) date. Null = no tail (fail-soft, chart unchanged).
 */
export const loadGscFreshTail = cache(
  async (
    tenantId: string,
    lastReportedDate: string | null,
    now: Date = new Date(),
  ): Promise<FreshTailPoint[] | null> => {
    if (!tenantId || !lastReportedDate) return null;
    const window = freshTailWindow(lastReportedDate, pacificDateString(now));
    if (window == null) return null;

    // Volatile cache first: a warm row within TTL for the SAME final edge.
    let cached: FreshTailCacheRow[] = [];
    try {
      cached = await readStore<FreshTailCacheRow>(GSC_FRESH_TAIL_STORE, []);
      const mine = cached.find((r) => r.tenant_id === tenantId);
      if (
        mine &&
        mine.lastReportedDate === lastReportedDate &&
        Number.isFinite(Date.parse(mine.computedAt)) &&
        now.getTime() - Date.parse(mine.computedAt) < FRESH_TAIL_CACHE_MS
      ) {
        return mine.points.length > 0 ? mine.points : null;
      }
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

      // Best-effort volatile cache write (one row per tenant). An empty
      // result is cached too so a quiet property does not re-query for 3h.
      try {
        const others = cached.filter((r) => r.tenant_id !== tenantId);
        await writeStore<FreshTailCacheRow>(GSC_FRESH_TAIL_STORE, [
          ...others,
          {
            tenant_id: tenantId,
            computedAt: now.toISOString(),
            lastReportedDate,
            points,
          },
        ]);
      } catch {
        /* cache write is best-effort */
      }

      return points.length > 0 ? points : null;
    } catch (e) {
      log.warn("[gsc-fresh-tail] read failed (no tail rendered)", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },
);
