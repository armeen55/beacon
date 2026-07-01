import "server-only";

import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

/**
 * gsc-page-queries (2026-06-25) — the LIGHT per-query GSC path (IDEAS #0's
 * highest-value remaining gap). Names the exact queries a specific page ranks
 * for, so a Move can say "you show up for 'persian boy names' (1.2k impressions,
 * position 8)" instead of a generic page-level number.
 *
 * Why this is safe where the heavy per-query RPC times out (#72 class): it reads
 * `gsc_daily_rows` filtered to a SMALL, explicit set of worklist pages
 * (`page IN (...)`) on the `(tenant_id, page, date desc)` index — never a full
 * tenant scan — and hard-caps the row budget. One bounded read covers the whole
 * worklist. Fail-soft → empty map (never throws, never hangs the cockpit).
 */

export type PageQuery = {
  query: string;
  clicks: number;
  impressions: number;
  /** Impression-weighted average position over the window. */
  position: number;
  /** Striking distance: ranks just off the top (pos 4–15) with real demand — the
   *  classic CTR play where a small rank gain captures outsized clicks. */
  strikingDistance: boolean;
};

/** Striking-distance test: ranking on page 1's lower half / page 2 top, with
 *  enough impressions that climbing a few spots is worth real clicks. */
export function isStrikingDistance(position: number, impressions: number): boolean {
  return position >= 4 && position <= 15 && impressions >= 100;
}

/** Aggregated per-query window stats (clicks, impressions, impression-weighted position sum). */
export type QueryAgg = { clicks: number; impressions: number; posW: number };

/**
 * PURE decline computation for one page: compare a recent window's per-query
 * aggregates to the prior window's. A query declines when it had real prior
 * demand (≥`minPriorClicks`) and clicks fell ≥`minDropPct`. Sorted by prior
 * clicks (biggest loss first), capped. Exported so the windowing logic is unit-
 * testable without a live DB.
 */
export function declinesForPage(
  recentQs: Map<string, QueryAgg>,
  priorQs: Map<string, QueryAgg>,
  opts: { minPriorClicks?: number; minDropPct?: number; cap?: number } = {},
): QueryDecline[] {
  const minPriorClicks = opts.minPriorClicks ?? 10;
  const minDropPct = opts.minDropPct ?? 30;
  const cap = opts.cap ?? TOP_PER_PAGE;
  const declines: QueryDecline[] = [];
  for (const [query, p] of priorQs) {
    if (p.clicks < minPriorClicks) continue; // needs real prior demand
    const r = recentQs.get(query) ?? { clicks: 0, impressions: 0, posW: 0 };
    const dropPct = p.clicks > 0 ? Math.round(((p.clicks - r.clicks) / p.clicks) * 100) : 0;
    if (dropPct < minDropPct) continue;
    const recentPosition = r.impressions > 0 ? r.posW / r.impressions : 0;
    const priorPosition = p.impressions > 0 ? p.posW / p.impressions : 0;
    declines.push({
      query,
      recentClicks: r.clicks,
      priorClicks: p.clicks,
      dropPct,
      recentPosition,
      priorPosition,
      positionSlip: recentPosition > 0 && priorPosition > 0 ? recentPosition - priorPosition : 0,
    });
  }
  declines.sort((a, b) => b.priorClicks - a.priorClicks);
  return declines.slice(0, cap);
}

/** A query whose demand is climbing fast (the inverse of QueryDecline). */
export type QueryRise = {
  query: string;
  recentClicks: number;
  priorClicks: number;
  /** % click growth over prior window; 999 sentinel when the query is newly emerging. */
  gainPct: number;
  recentImpressions: number;
  recentPosition: number;
  /** Prior window had ~no demand — a genuinely new query the site started ranking for. */
  isNew: boolean;
};

/**
 * PURE rise computation for one page (mirror of {@link declinesForPage}): a query
 * is RISING when it has real RECENT demand (≥`minRecentClicks`) AND either it's
 * newly emerging (prior ~0) or recent clicks grew ≥`minGainPct` over prior. Sorted
 * by absolute clicks GAINED (biggest mover first), capped. The "catch emerging
 * demand early" signal. Unit-testable without a live DB.
 */
export function risesForPage(
  recentQs: Map<string, QueryAgg>,
  priorQs: Map<string, QueryAgg>,
  opts: { minRecentClicks?: number; minGainPct?: number; cap?: number } = {},
): QueryRise[] {
  const minRecentClicks = opts.minRecentClicks ?? 5;
  const minGainPct = opts.minGainPct ?? 25;
  const cap = opts.cap ?? TOP_PER_PAGE;
  const rises: QueryRise[] = [];
  for (const [query, r] of recentQs) {
    if (r.clicks < minRecentClicks) continue; // needs real recent demand
    const p = priorQs.get(query) ?? { clicks: 0, impressions: 0, posW: 0 };
    const isNew = p.clicks < 2;
    const gainPct = p.clicks > 0 ? Math.round(((r.clicks - p.clicks) / p.clicks) * 100) : 999;
    if (!isNew && gainPct < minGainPct) continue;
    const recentPosition = r.impressions > 0 ? r.posW / r.impressions : 0;
    rises.push({
      query,
      recentClicks: r.clicks,
      priorClicks: p.clicks,
      gainPct,
      recentImpressions: r.impressions,
      recentPosition,
      isNew,
    });
  }
  rises.sort((a, b) => b.recentClicks - b.priorClicks - (a.recentClicks - a.priorClicks));
  return rises.slice(0, cap);
}

const WINDOW_DAYS = 90;
const ROW_BUDGET = 2000; // hard cap — bounded read, never a full-table scan
const TOP_PER_PAGE = 3;

function sinceDateIso(days: number): string {
  // Pure date math (no Date.now dependency for determinism is unnecessary here;
  // this runs per-request/cron). Compute YYYY-MM-DD `days` ago.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export type QueryDecline = {
  query: string;
  recentClicks: number;
  priorClicks: number;
  /** % clicks dropped vs the prior equal-length window (0–100). */
  dropPct: number;
  recentPosition: number;
  priorPosition: number;
  /** Positions slipped (recent − prior; positive = fell down the SERP). */
  positionSlip: number;
};

/** One bounded `page IN (...)` read for a date window, aggregated by (page,query). */
async function readWindow(
  sb: ReturnType<typeof getSupabaseAdmin>,
  tenantId: string,
  pages: string[],
  fromIso: string,
  toIso: string,
): Promise<Map<string, Map<string, { clicks: number; impressions: number; posW: number }>>> {
  const byPage = new Map<string, Map<string, { clicks: number; impressions: number; posW: number }>>();
  const { data, error } = await sb
    .from("gsc_daily_rows")
    .select("page, query, clicks, impressions, position")
    .eq("tenant_id", tenantId)
    .in("page", pages)
    .gte("date", fromIso)
    .lt("date", toIso)
    .order("impressions", { ascending: false })
    .limit(ROW_BUDGET);
  if (error || !data) return byPage;
  for (const r of data) {
    const page = r.page as string;
    const query = (r.query as string)?.trim();
    if (!page || !query) continue;
    const impr = Number(r.impressions) || 0;
    const perQ = byPage.get(page) ?? new Map();
    const a = perQ.get(query) ?? { clicks: 0, impressions: 0, posW: 0 };
    a.clicks += Number(r.clicks) || 0;
    a.impressions += impr;
    a.posW += (Number(r.position) || 0) * impr;
    perQ.set(query, a);
    byPage.set(page, perQ);
  }
  return byPage;
}

/**
 * Total GSC clicks per page over an explicit [fromIso, toIso) date range. Used by
 * the proof-recovery detector to compare a page's clicks BEFORE vs AFTER a shipped
 * change's date. Bounded + fail-soft → empty Map.
 */
export async function loadPageClicksInRange(
  tenantId: string,
  pages: string[],
  fromIso: string,
  toIso: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!tenantId || pages.length === 0) return out;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("page, clicks")
      .eq("tenant_id", tenantId)
      .in("page", pages.slice(0, 50))
      .gte("date", fromIso)
      .lt("date", toIso)
      .limit(ROW_BUDGET);
    if (error || !data) return out;
    for (const r of data) {
      const page = r.page as string;
      if (!page) continue;
      out.set(page, (out.get(page) ?? 0) + (Number(r.clicks) || 0));
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * Per-page daily clicks for a SMALL explicit page set (the worklist), over the
 * trailing `days`, for momentum sparklines. Reads the per-page-per-day
 * `gsc_daily_page_totals` table (already aggregated — NOT the per-query
 * `gsc_daily_rows`, where 16 pages × ~56d × N queries blows the row budget on the
 * first page), filtered `page IN (...)` to ≤16 pages so ~16×56 rows stays well
 * under ROW_BUDGET. Never a full tenant scan. Returns page → ascending daily
 * {date, clicks}. Fail-soft → empty map.
 */
export async function loadDailyClicksByPagesForTenant(
  tenantId: string,
  pages: string[],
  days = 70,
): Promise<Map<string, DailyClicks[]>> {
  const out = new Map<string, DailyClicks[]>();
  if (!tenantId || pages.length === 0) return out;
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(days);
    const { data, error } = await sb
      .from("gsc_daily_page_totals")
      .select("page, date, clicks")
      .eq("tenant_id", tenantId)
      .in("page", pages.slice(0, 16))
      .gte("date", since)
      .limit(ROW_BUDGET);
    if (error || !data) return out;
    // Collapse to a daily total per (page, date) — defensive against any dup rows.
    const byPageDate = new Map<string, Map<string, number>>();
    for (const r of data as Array<{ page: string; date: string; clicks: number | string | null }>) {
      if (!r.page || !r.date) continue;
      const d = r.date.slice(0, 10);
      let dm = byPageDate.get(r.page);
      if (!dm) byPageDate.set(r.page, (dm = new Map()));
      dm.set(d, (dm.get(d) ?? 0) + (Number(r.clicks) || 0));
    }
    for (const [page, dm] of byPageDate) {
      out.set(
        page,
        [...dm.entries()].map(([date, clicks]) => ({ date, clicks })).sort((a, b) => a.date.localeCompare(b.date)),
      );
    }
    return out;
  } catch {
    return out;
  }
}

export type TenantQuery = { query: string; clicks: number; impressions: number };

/**
 * Site-wide top queries (aggregated across ALL pages) for the tenant over the
 * window — used by demand-level scans (e.g. tool-intent detection) where the
 * query can live on any page. Bounded: reads the highest-impression daily rows
 * (ROW_BUDGET cap), aggregates by query, returns the top `limit`. Fail-soft → [].
 */
export async function loadTopTenantQueries(
  tenantId: string,
  opts: { limit?: number; windowDays?: number } = {},
): Promise<TenantQuery[]> {
  if (!tenantId) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 300, 1000));
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(opts.windowDays ?? WINDOW_DAYS);
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("query, clicks, impressions")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .order("impressions", { ascending: false })
      .limit(ROW_BUDGET);
    if (error || !data) return [];
    const byQuery = new Map<string, { clicks: number; impressions: number }>();
    for (const r of data) {
      const query = (r.query as string)?.trim();
      if (!query) continue;
      const a = byQuery.get(query) ?? { clicks: 0, impressions: 0 };
      a.clicks += Number(r.clicks) || 0;
      a.impressions += Number(r.impressions) || 0;
      byQuery.set(query, a);
    }
    return [...byQuery.entries()]
      .map(([query, a]) => ({ query, clicks: a.clicks, impressions: a.impressions }))
      .sort((x, y) => y.impressions - x.impressions)
      .slice(0, limit);
  } catch (e) {
    log.warn("[gsc-page-queries] top-tenant-queries threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Tool-intent queries: gsc_daily_rows whose QUERY contains an interactive-asset
 * word (converter/calculator/generator/quiz/…). DB-filtered (ILIKE OR) so the
 * long-tail tool queries surface regardless of impression rank — a plain
 * top-impression scan misses them. Aggregated by query, fail-soft → [].
 */
export async function loadToolIntentQueries(
  tenantId: string,
  opts: { windowDays?: number } = {},
): Promise<TenantQuery[]> {
  if (!tenantId) return [];
  // Stems (ILIKE %stem%) covering the generic tool vocabulary in tool-intent.ts.
  const stems = [
    "convert", "calculat", "generat", "quiz", "check", "estimat",
    "template", "worksheet", "planner", "checklist", "tool", "widget",
    "validator", "lookup",
  ];
  const orFilter = stems.map((s) => `query.ilike.%${s}%`).join(",");
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(opts.windowDays ?? WINDOW_DAYS);
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("query, clicks, impressions")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .or(orFilter)
      .order("impressions", { ascending: false })
      .limit(ROW_BUDGET);
    if (error || !data) {
      if (error) log.warn("[gsc-page-queries] tool-intent read failed", { tenantId, error: error.message });
      return [];
    }
    const byQuery = new Map<string, { clicks: number; impressions: number }>();
    for (const r of data) {
      const query = (r.query as string)?.trim();
      if (!query) continue;
      const a = byQuery.get(query) ?? { clicks: 0, impressions: 0 };
      a.clicks += Number(r.clicks) || 0;
      a.impressions += Number(r.impressions) || 0;
      byQuery.set(query, a);
    }
    return [...byQuery.entries()]
      .map(([query, a]) => ({ query, clicks: a.clicks, impressions: a.impressions }))
      .sort((x, y) => y.impressions - x.impressions);
  } catch (e) {
    log.warn("[gsc-page-queries] tool-intent threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Question-shaped queries the tenant appears for — the AEO answer-block target set.
 * Reaches the long tail via a DB ILIKE `.or()` on question stems (GSC top-by-clicks
 * reads miss these because question queries often have impressions but ~0 clicks —
 * exactly the answer-block gap). Bounded + fail-soft → []. The pure scorer decides
 * which are real opportunities. Per-query window aggregate keyed by query.
 */
export const loadQuestionQueries = cache(loadQuestionQueriesImpl);
async function loadQuestionQueriesImpl(
  tenantId: string,
  opts: { windowDays?: number } = {},
): Promise<TenantQuery[]> {
  if (!tenantId) return [];
  // Leading question words + the literal "?" — ILIKE the start where possible.
  const stems = ["how ", "what ", "why ", "who ", "when ", "where ", "which ", "is ", "are ", "does ", "can "];
  const orFilter = [...stems.map((s) => `query.ilike.${s}%`), "query.ilike.%?%"].join(",");
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(opts.windowDays ?? WINDOW_DAYS);
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("query, clicks, impressions")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .or(orFilter)
      .order("impressions", { ascending: false })
      .limit(ROW_BUDGET);
    if (error || !data) {
      if (error) log.warn("[gsc-page-queries] question-query read failed", { tenantId, error: error.message });
      return [];
    }
    const byQuery = new Map<string, { clicks: number; impressions: number }>();
    for (const r of data) {
      const query = (r.query as string)?.trim();
      if (!query) continue;
      const a = byQuery.get(query) ?? { clicks: 0, impressions: 0 };
      a.clicks += Number(r.clicks) || 0;
      a.impressions += Number(r.impressions) || 0;
      byQuery.set(query, a);
    }
    return [...byQuery.entries()]
      .map(([query, a]) => ({ query, clicks: a.clicks, impressions: a.impressions }))
      .sort((x, y) => y.impressions - x.impressions);
  } catch (e) {
    log.warn("[gsc-page-queries] question-query threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

export type DecliningPage = { page: string; topDecline: QueryDecline };
export type StrikingPage = { page: string; topQuery: PageQuery };
export type DailyClicks = { date: string; clicks: number };

/**
 * Property-level per-day clicks from the tiny, accurate `gsc_daily_totals` table
 * (ungrouped totals GSC reports directly — no truncation), ascending by date over
 * the trailing `days`. Used by the macro traffic-trend lens. Fail-soft → [].
 */
export async function loadDailyClicksForTenant(
  tenantId: string,
  days = 56,
): Promise<DailyClicks[]> {
  if (!tenantId) return [];
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(days);
    const { data, error } = await sb
      .from("gsc_daily_totals")
      .select("date, clicks")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .order("date", { ascending: true });
    if (error || !data) return [];
    return (data as Array<{ date: string; clicks: number | string | null }>)
      .map((r) => ({ date: r.date, clicks: Number(r.clicks) || 0 }))
      .filter((r) => Boolean(r.date));
  } catch {
    return [];
  }
}

export type DailyTotals = { date: string; clicks: number; impressions: number };

/**
 * Property-level per-day clicks AND impressions from `gsc_daily_totals`, ascending by
 * date over the trailing `days`. Powers the Today scoreboard chart. Fail-soft -> [].
 */
export async function loadDailyTotalsForTenant(
  tenantId: string,
  days = 84,
): Promise<DailyTotals[]> {
  if (!tenantId) return [];
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(days);
    const { data, error } = await sb
      .from("gsc_daily_totals")
      .select("date, clicks, impressions")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .order("date", { ascending: true });
    if (error || !data) return [];
    return (data as Array<{ date: string; clicks: number | string | null; impressions: number | string | null }>)
      .map((r) => ({ date: r.date, clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0 }))
      .filter((r) => Boolean(r.date));
  } catch {
    return [];
  }
}

export type PageWithQueries = { page: string; queries: PageQuery[] };

/**
 * The tenant's top pages by impressions (server-aggregated RPC) WITH their per-page
 * queries (positions + clicks + impressions) — the substrate for any per-query
 * site-wide lens (e.g. CTR-gap detection). Bounded (top N pages) + fail-soft → [].
 */
export const loadTopPagesWithQueriesForTenant = cache(loadTopPagesWithQueriesForTenantImpl);
async function loadTopPagesWithQueriesForTenantImpl(
  tenantId: string,
  opts: { topPages?: number } = {},
): Promise<PageWithQueries[]> {
  if (!tenantId) return [];
  const topN = Math.max(1, Math.min(opts.topPages ?? 25, 25));
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(WINDOW_DAYS);
    const { data, error } = await sb
      .rpc("gsc_page_totals_v1", { p_tenant: tenantId, p_since: since })
      .order("impressions", { ascending: false })
      .limit(topN);
    if (error || !data) return [];
    const pages = (data as Array<{ page?: string }>).map((r) => r.page).filter((p): p is string => Boolean(p));
    if (pages.length === 0) return [];
    const queryMap = await loadTopQueriesForPages(tenantId, pages);
    const out: PageWithQueries[] = [];
    for (const [page, queries] of queryMap) out.push({ page, queries });
    return out;
  } catch (e) {
    log.warn("[gsc-page-queries] top-pages-with-queries threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Site-wide STRIKING-DISTANCE opportunities (symmetric to declining pages): the
 * tenant's top pages by impressions (server-aggregated RPC) that have a query
 * ranking position 4–15 with real demand — quick CTR wins, even on pages the
 * demand graph never queued. Bounded (top N pages) + fail-soft → []. Returns each
 * page's best striking-distance query (highest impressions).
 */
export const loadTopStrikingPagesForTenant = cache(loadTopStrikingPagesForTenantImpl);
async function loadTopStrikingPagesForTenantImpl(
  tenantId: string,
  opts: { topPages?: number } = {},
): Promise<StrikingPage[]> {
  if (!tenantId) return [];
  const topN = Math.max(1, Math.min(opts.topPages ?? 25, 25));
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(WINDOW_DAYS);
    const { data, error } = await sb
      .rpc("gsc_page_totals_v1", { p_tenant: tenantId, p_since: since })
      .order("impressions", { ascending: false })
      .limit(topN);
    if (error || !data) return [];
    const pages = (data as Array<{ page?: string }>).map((r) => r.page).filter((p): p is string => Boolean(p));
    if (pages.length === 0) return [];
    const queryMap = await loadTopQueriesForPages(tenantId, pages);
    const out: StrikingPage[] = [];
    for (const [page, queries] of queryMap) {
      const best = queries.filter((q) => q.strikingDistance).sort((a, b) => b.impressions - a.impressions)[0];
      if (best) out.push({ page, topQuery: best });
    }
    out.sort((a, b) => b.topQuery.impressions - a.topQuery.impressions);
    return out;
  } catch (e) {
    log.warn("[gsc-page-queries] top-striking threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Site-wide declining pages (not just the worklist): pull the tenant's TOP pages
 * by impressions via the server-aggregated `gsc_page_totals_v1` RPC (no client
 * truncation), then run the bounded two-window decline scan on just those. So a
 * page actively losing clicks surfaces even when the demand graph never queued it.
 * Bounded (top N pages) + fail-soft → []. Returns each page's worst decline.
 */
export const loadTopDecliningPagesForTenant = cache(loadTopDecliningPagesForTenantImpl);
async function loadTopDecliningPagesForTenantImpl(
  tenantId: string,
  opts: { topPages?: number; windowDays?: number } = {},
): Promise<DecliningPage[]> {
  if (!tenantId) return [];
  const topN = Math.max(1, Math.min(opts.topPages ?? 25, 25));
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso((opts.windowDays ?? WINDOW_DAYS) * 2);
    const { data, error } = await sb
      .rpc("gsc_page_totals_v1", { p_tenant: tenantId, p_since: since })
      .order("impressions", { ascending: false })
      .limit(topN);
    if (error || !data) {
      if (error) log.warn("[gsc-page-queries] top-pages rpc failed", { tenantId, error: error.message });
      return [];
    }
    const pages = (data as Array<{ page?: string }>).map((r) => r.page).filter((p): p is string => Boolean(p));
    if (pages.length === 0) return [];
    const declineMap = await loadQueryDeclinesForPages(tenantId, pages, { windowDays: opts.windowDays });
    const out: DecliningPage[] = [];
    for (const [page, declines] of declineMap) {
      const worst = declines[0];
      if (worst) out.push({ page, topDecline: worst });
    }
    // Biggest prior-clicks loss first.
    out.sort((a, b) => b.topDecline.priorClicks - a.topDecline.priorClicks);
    return out;
  } catch (e) {
    log.warn("[gsc-page-queries] top-declining threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Per-page DECLINING queries — recent 28d vs the prior 28d, via TWO separate
 * bounded windowed reads (each its own capped `page IN (...)` read) so truncation
 * can never mix windows and produce a wrong "you're losing X" claim. A query is
 * declining when it had real prior demand (≥10 clicks) and recent clicks fell
 * ≥30%. Fail-soft → empty map. The honest "what you're losing" signal.
 */
export async function loadQueryDeclinesForPages(
  tenantId: string,
  pageUrls: string[],
  opts: { windowDays?: number } = {},
): Promise<Map<string, QueryDecline[]>> {
  const out = new Map<string, QueryDecline[]>();
  const pages = [...new Set(pageUrls.filter(Boolean))].slice(0, 25);
  if (!tenantId || pages.length === 0) return out;
  const w = opts.windowDays ?? 28;
  try {
    const sb = getSupabaseAdmin();
    const recentFrom = sinceDateIso(w);
    const priorFrom = sinceDateIso(w * 2);
    const [recent, prior] = await Promise.all([
      readWindow(sb, tenantId, pages, recentFrom, sinceDateIso(0)),
      readWindow(sb, tenantId, pages, priorFrom, recentFrom),
    ]);
    for (const [page, priorQs] of prior) {
      const declines = declinesForPage(recent.get(page) ?? new Map(), priorQs);
      if (declines.length > 0) out.set(page, declines);
    }
    return out;
  } catch (e) {
    log.warn("[gsc-page-queries] declines threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return out;
  }
}

export type RisingQuery = QueryRise & { page: string };

/**
 * RISING queries for ONE explicit page (the Workbench drill-down companion to the
 * site-wide loader). Two bounded windowed reads on just this page → `risesForPage`.
 * Fail-soft → []. Lets the per-page workspace show emerging demand in context.
 */
export async function loadRisingQueriesForPage(
  tenantId: string,
  pageUrl: string,
  opts: { windowDays?: number } = {},
): Promise<QueryRise[]> {
  if (!tenantId || !pageUrl) return [];
  const w = opts.windowDays ?? 28;
  try {
    const sb = getSupabaseAdmin();
    const recentFrom = sinceDateIso(w);
    const [recent, prior] = await Promise.all([
      readWindow(sb, tenantId, [pageUrl], recentFrom, sinceDateIso(0)),
      readWindow(sb, tenantId, [pageUrl], sinceDateIso(w * 2), recentFrom),
    ]);
    return risesForPage(recent.get(pageUrl) ?? new Map(), prior.get(pageUrl) ?? new Map(), { cap: 5 });
  } catch (e) {
    log.warn("[gsc-page-queries] page-rising threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/**
 * Site-wide RISING queries — the inverse of {@link loadTopDecliningPagesForTenant}.
 * Pulls the tenant's top pages by impressions, runs the same two-window per-query
 * scan, and surfaces the queries gaining clicks fastest (emerging demand to capture
 * before competitors lock it in), flattened across pages and ranked by clicks
 * gained. Bounded + fail-soft → [].
 */
export const loadTopRisingQueriesForTenant = cache(loadTopRisingQueriesForTenantImpl);
async function loadTopRisingQueriesForTenantImpl(
  tenantId: string,
  opts: { topPages?: number; windowDays?: number; cap?: number } = {},
): Promise<RisingQuery[]> {
  if (!tenantId) return [];
  const topN = Math.max(1, Math.min(opts.topPages ?? 25, 25));
  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso((opts.windowDays ?? 28) * 2);
    const { data, error } = await sb
      .rpc("gsc_page_totals_v1", { p_tenant: tenantId, p_since: since })
      .order("impressions", { ascending: false })
      .limit(topN);
    if (error || !data) {
      if (error) log.warn("[gsc-page-queries] rising rpc failed", { tenantId, error: error.message });
      return [];
    }
    const pages = (data as Array<{ page?: string }>).map((r) => r.page).filter((p): p is string => Boolean(p));
    if (pages.length === 0) return [];
    const w = opts.windowDays ?? 28;
    const recentFrom = sinceDateIso(w);
    const [recent, prior] = await Promise.all([
      readWindow(sb, tenantId, pages, recentFrom, sinceDateIso(0)),
      readWindow(sb, tenantId, pages, sinceDateIso(w * 2), recentFrom),
    ]);
    const out: RisingQuery[] = [];
    for (const [page, recentQs] of recent) {
      for (const rise of risesForPage(recentQs, prior.get(page) ?? new Map())) {
        out.push({ ...rise, page });
      }
    }
    out.sort((a, b) => b.recentClicks - b.priorClicks - (a.recentClicks - a.priorClicks));
    return out.slice(0, opts.cap ?? 12);
  } catch (e) {
    log.warn("[gsc-page-queries] top-rising threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/**
 * Top queries per page for a bounded set of worklist pages.
 * @returns Map keyed by the EXACT page URL passed in → its top queries.
 */
export async function loadTopQueriesForPages(
  tenantId: string,
  pageUrls: string[],
  opts: { windowDays?: number } = {},
): Promise<Map<string, PageQuery[]>> {
  const out = new Map<string, PageQuery[]>();
  const pages = [...new Set(pageUrls.filter(Boolean))].slice(0, 25); // bound the IN-list
  if (!tenantId || pages.length === 0) return out;

  try {
    const sb = getSupabaseAdmin();
    const since = sinceDateIso(opts.windowDays ?? WINDOW_DAYS);
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("page, query, clicks, impressions, position")
      .eq("tenant_id", tenantId)
      .in("page", pages)
      .gte("date", since)
      .order("impressions", { ascending: false })
      .limit(ROW_BUDGET);
    if (error || !data) {
      if (error) log.warn("[gsc-page-queries] read failed", { tenantId, error: error.message });
      return out;
    }

    // Aggregate by (page, query): sum clicks/impressions, impression-weighted position.
    type Agg = { clicks: number; impressions: number; posWeighted: number };
    const byPage = new Map<string, Map<string, Agg>>();
    for (const r of data) {
      const page = r.page as string;
      const query = (r.query as string)?.trim();
      if (!page || !query) continue;
      const impr = Number(r.impressions) || 0;
      const perQuery = byPage.get(page) ?? new Map<string, Agg>();
      const a = perQuery.get(query) ?? { clicks: 0, impressions: 0, posWeighted: 0 };
      a.clicks += Number(r.clicks) || 0;
      a.impressions += impr;
      a.posWeighted += (Number(r.position) || 0) * impr;
      perQuery.set(query, a);
      byPage.set(page, perQuery);
    }

    for (const [page, perQuery] of byPage) {
      const ranked: PageQuery[] = [...perQuery.entries()]
        .map(([query, a]) => {
          const position = a.impressions > 0 ? a.posWeighted / a.impressions : 0;
          return {
            query,
            clicks: a.clicks,
            impressions: a.impressions,
            position,
            strikingDistance: isStrikingDistance(position, a.impressions),
          };
        })
        .filter((q) => q.impressions > 0)
        .sort((x, y) => y.impressions - x.impressions)
        .slice(0, TOP_PER_PAGE);
      if (ranked.length > 0) out.set(page, ranked);
    }
    return out;
  } catch (e) {
    log.warn("[gsc-page-queries] threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return out;
  }
}
