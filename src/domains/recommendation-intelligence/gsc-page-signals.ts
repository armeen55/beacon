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

// ── Decay slice (2026-06-12) — split-window decay signals ────────────

export type GscDecaySignal = {
  page: string;
  /** Trailing 28-day window. */
  clicksNow: number;
  positionNow: number;
  impressionsNow: number;
  /** The 28 days before that. */
  clicksPrior: number;
  positionPrior: number;
  impressionsPrior: number;
};

const DECAY_WINDOW_DAYS = 28;

/**
 * Two consecutive 28-day windows per page (56 days total), for the
 * decay/refresh rule (Animalz "two or more signals crossing
 * simultaneously"; Ahrefs "declining pages" opportunity class —
 * sources in the slice commit). Positions are impressions-weighted.
 * Fail-soft: empty Map.
 */
export async function loadGscDecaySignalsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<Map<string, GscDecaySignal>> {
  const out = new Map<string, GscDecaySignal>();
  type Row = {
    page: string;
    clicks: number;
    impressions: number;
    position: number;
    date: string;
  };
  let rows: Row[] = [];
  const splitMs = now.getTime() - DECAY_WINDOW_DAYS * 86_400_000;
  const split = new Date(splitMs).toISOString().slice(0, 10);
  const since = new Date(splitMs - DECAY_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("page, clicks, impressions, position, date")
      .eq("tenant_id", tenantId)
      .eq("is_final", true)
      .gte("date", since)
      .limit(40_000);
    if (error) return out;
    rows = (data ?? []) as unknown as Row[];
  } catch {
    return out;
  }
  if (rows.length === 0) return out;

  type Acc = {
    clicks: number;
    impressions: number;
    positionWeighted: number;
  };
  const nowAcc = new Map<string, Acc>();
  const priorAcc = new Map<string, Acc>();
  for (const r of rows) {
    const page = canonicalizeCitationUrl(r.page) ?? r.page;
    const bucket = r.date >= split ? nowAcc : priorAcc;
    let acc = bucket.get(page);
    if (!acc) {
      acc = { clicks: 0, impressions: 0, positionWeighted: 0 };
      bucket.set(page, acc);
    }
    acc.clicks += r.clicks ?? 0;
    acc.impressions += r.impressions ?? 0;
    acc.positionWeighted += (r.position ?? 0) * (r.impressions ?? 0);
  }
  const pages = new Set([...nowAcc.keys(), ...priorAcc.keys()]);
  for (const page of pages) {
    const n = nowAcc.get(page);
    const p = priorAcc.get(page);
    out.set(page, {
      page,
      clicksNow: n?.clicks ?? 0,
      impressionsNow: n?.impressions ?? 0,
      positionNow:
        n != null && n.impressions > 0 ? n.positionWeighted / n.impressions : 0,
      clicksPrior: p?.clicks ?? 0,
      impressionsPrior: p?.impressions ?? 0,
      positionPrior:
        p != null && p.impressions > 0 ? p.positionWeighted / p.impressions : 0,
    });
  }
  return out;
}
