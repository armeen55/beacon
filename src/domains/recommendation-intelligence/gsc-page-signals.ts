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

/** 90-day rolling window (operator pref 2026-06-13: don't clip to 28 days —
 *  use the fuller history GSC holds, more pages + steadier CTR/position). The
 *  sync backfills up to ~90 days, so this captures it all as it accumulates. */
const WINDOW_DAYS = 90;
const TOP_QUERIES_CAP = 8;
/** Bounded read: per-tenant page+query rows over 28 days. At page+query+day
 *  grain a busy site easily exceeds 20k rows in 28 days; the old 20k cap (with
 *  no ORDER BY) truncated to an arbitrary handful of pages — starving both the
 *  GSC triggers and the card evidence. 80k covers Iranopedia's current ~44k
 *  in-window rows fully so EVERY page aggregates. (Scale follow-up: move to a
 *  Postgres GROUP BY RPC when in-window rows approach this cap.) */
const MAX_ROWS = 80_000;
/** PostgREST response cap — page through in chunks of this size. */
const PAGE_SIZE = 1_000;

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
  // PostgREST caps a single response (~1k rows) regardless of `.limit()`, so a
  // busy 28-day window (Iranopedia: ~44k page+query+day rows) must be PAGED —
  // a bare select truncated to an arbitrary handful of pages, starving the
  // triggers + card evidence. Page through with a stable order until a short
  // page or the safety bound. Keep whatever we've read on a mid-page error.
  const rows: DailyRow[] = [];
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("gsc_daily_rows")
        .select("page, query, clicks, impressions, position, date")
        .eq("tenant_id", tenantId)
        .eq("is_final", true)
        .gte("date", since)
        .order("date")
        .order("page")
        .order("query")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[gsc-page-signals] page read failed", {
          tenantId,
          offset,
          error: error.message,
        });
        break;
      }
      const batch = (data ?? []) as unknown as DailyRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch {
    return out;
  }
  if (rows.length === 0) return out;

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

  // Override per-page totals with the TRUE page-level numbers
  // (dimensions=[page], gsc_daily_page_totals) — these INCLUDE the anonymized
  // low-volume queries GSC hides from the page+query grain above, so CTR +
  // impressions match the GSC UI instead of understating impressions /
  // inflating CTR. topQueries (from page+query) are kept. Pages with totals
  // but no visible queries get an entry with empty topQueries. Soft-fail
  // (keep the page+query totals) when the table is empty / unread (pre-backfill).
  try {
    const sinceTotals = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sbTotals = getSupabaseAdmin();
    const totalsByPage = new Map<
      string,
      { clicks: number; impressions: number; positionWeighted: number }
    >();
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sbTotals
        .from("gsc_daily_page_totals")
        .select("page, clicks, impressions, position, date")
        .eq("tenant_id", tenantId)
        .eq("is_final", true)
        .gte("date", sinceTotals)
        .order("date")
        .order("page")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) break;
      const batch = (data ?? []) as unknown as Array<{
        page: string;
        clicks: number;
        impressions: number;
        position: number;
      }>;
      for (const r of batch) {
        const page = canonicalizeCitationUrl(r.page) ?? r.page;
        let acc = totalsByPage.get(page);
        if (!acc) {
          acc = { clicks: 0, impressions: 0, positionWeighted: 0 };
          totalsByPage.set(page, acc);
        }
        acc.clicks += r.clicks ?? 0;
        acc.impressions += r.impressions ?? 0;
        acc.positionWeighted += (r.position ?? 0) * (r.impressions ?? 0);
      }
      if (batch.length < PAGE_SIZE) break;
    }
    for (const [page, acc] of totalsByPage) {
      const totals = {
        clicks28d: acc.clicks,
        impressions28d: acc.impressions,
        ctr28d: acc.impressions > 0 ? acc.clicks / acc.impressions : 0,
        position28d:
          acc.impressions > 0 ? acc.positionWeighted / acc.impressions : 0,
      };
      const existing = out.get(page);
      out.set(
        page,
        existing
          ? { ...existing, ...totals }
          : { page, ...totals, topQueries: [] },
      );
    }
  } catch {
    /* page-totals unavailable — keep the page+query totals */
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
  // PostgREST caps a single response at ~1k rows regardless of `.limit()`.
  // The old single `.limit(40_000)` read therefore returned an arbitrary,
  // UNORDERED handful of the ~88k+ page+query+day rows a busy site has in
  // the 2×28-day decay window — so the now-vs-prior per-page sums were
  // both incomplete AND non-deterministic, silently corrupting decay
  // detection (a page's clicks split across the window boundary by a
  // truncated subset). Page through with a stable unique order (date,
  // page, query — query ordered though not selected) until a short page
  // or the safety bound, mirroring loadGscPageSignalsForTenant. Decay's
  // window is 2× the page-signals window, so allow a higher bound.
  const DECAY_MAX_ROWS = 160_000;
  try {
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < DECAY_MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("gsc_daily_rows")
        .select("page, clicks, impressions, position, date")
        .eq("tenant_id", tenantId)
        .eq("is_final", true)
        .gte("date", since)
        .order("date")
        .order("page")
        .order("query")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        // Keep whatever we've read so far rather than dropping the page.
        log.warn("[gsc-decay-signals] page read failed", {
          tenantId,
          offset,
          error: error.message,
        });
        break;
      }
      const batch = (data ?? []) as unknown as Row[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
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
