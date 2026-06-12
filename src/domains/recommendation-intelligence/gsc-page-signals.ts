/**
 * Insight Graph slice 1 (2026-06-12) — per-page GSC Search Analytics
 * signal loader. Aggregates the tenant's synced `gsc_daily_rows`
 * (page+query grain, final days only) over the trailing 28-day window
 * into one signal object per page — the pure input the GSC-driven
 * trigger predicates consume (same pattern as the indexability batch
 * loader: this module does the I/O, predicates stay pure).
 *
 * 28-day window: single-day CTR is too noisy for recommendations —
 * the practitioner sources behind the trigger rules all aggregate
 * before applying thresholds (cited in the slice commit).
 *
 * Fail-soft: missing table / no rows / Supabase error → empty Map.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

export type GscQuerySignal = {
  query: string;
  clicks: number;
  impressions: number;
  /** 0–1 fraction (Search Analytics convention). */
  ctr: number;
  /** Impressions-weighted average position (1-based). */
  position: number;
};

export type GscPageSignal = {
  /** Canonicalized page URL (map key, repeated for convenience). */
  page: string;
  clicks28d: number;
  impressions28d: number;
  /** clicks/impressions over the window (0–1). */
  ctr28d: number;
  /** Impressions-weighted average position over the window. */
  position28d: number;
  /** Top queries by impressions (capped). */
  topQueries: GscQuerySignal[];
};

const WINDOW_DAYS = 28;
const TOP_QUERIES_CAP = 8;
/** Bounded read: per-tenant page+query rows over 28 days. */
const MAX_ROWS = 20_000;

export async function loadGscPageSignalsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<Map<string, GscPageSignal>> {
  const out = new Map<string, GscPageSignal>();
  type DailyRow = {
    page: string;
    query: string;
    clicks: number;
    impressions: number;
    position: number;
    date: string;
  };
  let rows: DailyRow[] | null = null;
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("page, query, clicks, impressions, position, date")
      .eq("tenant_id", tenantId)
      .eq("is_final", true)
      .gte("date", since)
      .limit(MAX_ROWS);
    if (error) {
      log.warn("[gsc-page-signals] read failed", {
        tenantId,
        error: error.message,
      });
      return out;
    }
    rows = (data ?? []) as unknown as DailyRow[];
  } catch {
    return out;
  }
  if (rows == null || rows.length === 0) return out;

  // page → query → accumulator
  type QueryAcc = {
    clicks: number;
    impressions: number;
    positionWeighted: number;
  };
  const byPage = new Map<string, Map<string, QueryAcc>>();
  for (const r of rows) {
    const page = canonicalizeCitationUrl(r.page) ?? r.page;
    let queries = byPage.get(page);
    if (!queries) {
      queries = new Map();
      byPage.set(page, queries);
    }
    let acc = queries.get(r.query);
    if (!acc) {
      acc = { clicks: 0, impressions: 0, positionWeighted: 0 };
      queries.set(r.query, acc);
    }
    acc.clicks += r.clicks ?? 0;
    acc.impressions += r.impressions ?? 0;
    acc.positionWeighted += (r.position ?? 0) * (r.impressions ?? 0);
  }

  for (const [page, queries] of byPage) {
    let clicks = 0;
    let impressions = 0;
    let positionWeighted = 0;
    const querySignals: GscQuerySignal[] = [];
    for (const [query, acc] of queries) {
      clicks += acc.clicks;
      impressions += acc.impressions;
      positionWeighted += acc.positionWeighted;
      querySignals.push({
        query,
        clicks: acc.clicks,
        impressions: acc.impressions,
        ctr: acc.impressions > 0 ? acc.clicks / acc.impressions : 0,
        position:
          acc.impressions > 0 ? acc.positionWeighted / acc.impressions : 0,
      });
    }
    querySignals.sort((a, b) => b.impressions - a.impressions);
    out.set(page, {
      page,
      clicks28d: clicks,
      impressions28d: impressions,
      ctr28d: impressions > 0 ? clicks / impressions : 0,
      position28d: impressions > 0 ? positionWeighted / impressions : 0,
      topQueries: querySignals.slice(0, TOP_QUERIES_CAP),
    });
  }
  return out;
}
