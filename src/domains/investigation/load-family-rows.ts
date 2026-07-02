/**
 * investigation/load-family-rows (2026-07-02, master plan item 53) - the
 * BOUNDED loader family-collapse.ts runs on. Same posture as trend-radar's
 * load-query-spikes.ts, adapted to pages: never a full-table scan.
 *
 * Two bounded reads, both in the RAW GSC page-URL form so every downstream
 * join works (ground-truthed 2026-07-02: gsc_daily_page_totals and
 * gsc_daily_rows key pages as https://www.iranopedia.com/... while the
 * canonicalized page-signals map uses https://iranopedia.com/..., so a
 * canonical IN() read silently matches ZERO rows - the daily-series.ts
 * resolver exists for exactly this class of bug):
 *   1. the gsc_page_totals_v1 RPC (the same one proof-gsc/daily-series.ts
 *      uses; one bounded round trip, one row per raw page URL with clicks
 *      over the window) - the page universe to group into families.
 *   2. loadDailyClicksByPagesForTenant (already bounded to <=16 pages, reads
 *      the pre-aggregated gsc_daily_page_totals table) for the actual daily
 *      series of the top pages inside the top families by clicks.
 *
 * A family is only as complete as the pages we sampled into the 16-page cap,
 * so this picks the highest-clicks pages PER top family (not just top pages
 * overall) so a large family isn't starved by one page dominating the cap.
 * Fail-soft -> [] on any error; a loader hiccup silences the detector for a
 * night, nothing more.
 */

import "server-only";

import { log } from "@/lib/logger";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { loadDailyClicksByPagesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { pageFamilyOf } from "@/domains/experiments/daily-experiment-planner";
import type { PageDailyRow } from "./family-collapse";

/** How many distinct families the nightly pass watches (top by clicks). */
export const MAX_FAMILIES = 10;
/** Pages sampled per family (the daily-clicks table read is capped at 16
 *  pages total, so this must be small enough that MAX_FAMILIES * this stays
 *  near the cap). */
export const PAGES_PER_FAMILY = 1;
/** Trailing window for the daily series (5 anchor-aligned weeks + slack). */
export const FAMILY_WINDOW_DAYS = 42;

/** One page's clicks total over the window, in the RAW GSC URL form. */
export type PageClicksRow = { page: string; clicks: number };

/** PURE: group per-page click totals by family, keep the top MAX_FAMILIES
 *  families by total clicks, and pick the top PAGES_PER_FAMILY highest-clicks
 *  pages from each as the family's representative sample. Exported for unit
 *  tests. */
export function pickRepresentativePages(
  rows: ReadonlyArray<PageClicksRow>,
  maxFamilies = MAX_FAMILIES,
  pagesPerFamily = PAGES_PER_FAMILY,
): string[] {
  const byFamily = new Map<string, PageClicksRow[]>();
  for (const r of rows) {
    if (!r.page || r.clicks <= 0) continue;
    const family = pageFamilyOf(r.page);
    const arr = byFamily.get(family) ?? [];
    arr.push(r);
    byFamily.set(family, arr);
  }
  const familyTotals = [...byFamily.entries()]
    .map(([family, pages]) => ({ family, pages, total: pages.reduce((sum, p) => sum + p.clicks, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, maxFamilies);

  const out: string[] = [];
  for (const f of familyTotals) {
    const top = [...f.pages].sort((a, b) => b.clicks - a.clicks).slice(0, pagesPerFamily);
    for (const p of top) out.push(p.page);
  }
  return out;
}

/** The raw-form page universe: one row per GSC page URL with its clicks total
 *  over the window, via the same bounded gsc_page_totals_v1 RPC the proof
 *  daily-series resolver uses. Fail-soft -> []. */
async function loadRawPageTotals(tenantId: string): Promise<PageClicksRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const since = new Date(Date.now() - FAMILY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await getSupabaseAdmin().rpc("gsc_page_totals_v1", {
      p_tenant: tenantId,
      p_since: since,
    });
    if (error || !Array.isArray(data)) return [];
    const out: PageClicksRow[] = [];
    for (const r of data as Array<{ page?: string | null; clicks?: number | string | null }>) {
      if (!r.page) continue;
      out.push({ page: r.page, clicks: Number(r.clicks) || 0 });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Per-page daily clicks rows for the tenant's top families' representative
 * pages, over the trailing family-collapse window, in the raw GSC URL form.
 * Bounded + fail-soft -> [].
 */
export async function loadFamilyDailyRows(tenantId: string): Promise<PageDailyRow[]> {
  if (!tenantId) return [];
  try {
    const totals = await loadRawPageTotals(tenantId);
    if (totals.length === 0) return [];
    const pages = pickRepresentativePages(totals);
    if (pages.length === 0) return [];
    const byPage = await loadDailyClicksByPagesForTenant(tenantId, pages, FAMILY_WINDOW_DAYS);
    const out: PageDailyRow[] = [];
    for (const [page, series] of byPage) {
      for (const point of series) {
        out.push({ date: point.date, page, clicks: point.clicks });
      }
    }
    return out;
  } catch (e) {
    log.warn("[investigation] family row load threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
