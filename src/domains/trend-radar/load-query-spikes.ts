/**
 * trend-radar/load-query-spikes (2026-07-02, master plan item 14) - the BOUNDED
 * per-query daily loader the nightly spike pass runs on.
 *
 * Never a full-table read (the /today 17MB statement-timeout class): it first
 * asks the existing bounded top-queries read (loadTopTenantQueries, ROW_BUDGET
 * capped) which ~200 queries carry the tenant's recent impressions, then pulls
 * ONLY those queries' daily rows in small IN-list chunks with a lean projection
 * (date, query, page, clicks, impressions) and a hard per-chunk row cap.
 *
 * Truncation direction is safe by construction: chunks read date-ASCENDING, so
 * an over-budget chunk drops the NEWEST days, which UNDERCOUNTS this week and
 * can only miss a spike, never fabricate one (and it logs loudly).
 *
 * Fail-soft -> [] (a loader hiccup silences the radar for a night, nothing more).
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { loadTopTenantQueries } from "@/domains/recommendation-intelligence/gsc-page-queries";
import type { QueryDailyRow } from "./query-spikes";

/** How many top-by-impressions queries the radar watches. */
export const SPIKE_TOP_QUERIES = 200;
/** Read window: 5 anchor-aligned weeks (35d) + GSC finalization-lag headroom. */
export const SPIKE_WINDOW_DAYS = 42;
/** Queries per IN-list chunk (keeps each PostgREST URL + row count small). */
const CHUNK_QUERIES = 25;
/** Hard per-chunk row cap: 25 queries x 42 days x ~2 pages stays under it. */
const CHUNK_ROW_BUDGET = 2500;

function sinceDateIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** PURE row mapper: raw Supabase rows -> QueryDailyRow[] (drops unusable rows,
 *  coerces numerics). Exported for the loader-mapping unit test. */
export function normalizeSpikeRows(
  data: Array<{ date?: string | null; query?: string | null; page?: string | null; clicks?: number | string | null; impressions?: number | string | null }>,
): QueryDailyRow[] {
  const out: QueryDailyRow[] = [];
  for (const r of data) {
    const date = (r.date ?? "").slice(0, 10);
    const query = (r.query ?? "").trim();
    if (!date || !query) continue;
    out.push({
      date,
      query,
      page: r.page ?? null,
      clicks: Number(r.clicks) || 0,
      impressions: Number(r.impressions) || 0,
    });
  }
  return out;
}

/**
 * Per-query daily rows for the tenant's top ~200 queries by recent impressions,
 * over the trailing spike window. Bounded (see module header) + fail-soft -> [].
 */
export async function loadQuerySpikeRows(tenantId: string): Promise<QueryDailyRow[]> {
  if (!tenantId) return [];
  try {
    const top = await loadTopTenantQueries(tenantId, { limit: SPIKE_TOP_QUERIES, windowDays: SPIKE_WINDOW_DAYS });
    if (top.length === 0) return [];
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(SPIKE_WINDOW_DAYS);
    const out: QueryDailyRow[] = [];
    for (let i = 0; i < top.length; i += CHUNK_QUERIES) {
      const chunk = top.slice(i, i + CHUNK_QUERIES).map((q) => q.query);
      const { data, error } = await sb
        .from("gsc_daily_rows")
        .select("date, query, page, clicks, impressions")
        .eq("tenant_id", tenantId)
        .in("query", chunk)
        .gte("date", since)
        .order("date", { ascending: true })
        .limit(CHUNK_ROW_BUDGET);
      if (error) {
        log.warn("[trend-radar] spike chunk read failed", { tenantId, error: error.message });
        continue;
      }
      const rows = data ?? [];
      if (rows.length >= CHUNK_ROW_BUDGET) {
        // Ascending order means the tail (newest days) got cut: this week is
        // undercounted for this chunk, so we can miss but never invent a spike.
        log.warn("[trend-radar] spike chunk truncated at row budget", { tenantId, chunkStart: i });
      }
      out.push(...normalizeSpikeRows(rows));
    }
    return out;
  } catch (e) {
    log.warn("[trend-radar] spike load threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
