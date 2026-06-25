import "server-only";

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
};

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
        .map(([query, a]) => ({
          query,
          clicks: a.clicks,
          impressions: a.impressions,
          position: a.impressions > 0 ? a.posWeighted / a.impressions : 0,
        }))
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
