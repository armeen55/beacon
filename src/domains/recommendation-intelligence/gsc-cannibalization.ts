import "server-only";

/**
 * GSC-native cannibalization loader (2026-06-20).
 *
 * Surfaces queries where 2+ of the tenant's OWN URLs co-rank and split clicks,
 * straight from `gsc_daily_rows` via the `gsc_cannibalization_v1` RPC (no
 * third-party data). Same-query multi-URL competition confuses the engine about
 * the canonical page and bleeds clicks even at strong positions.
 *
 * PURE grouping (`groupCannibalizationRows`) is split from the async loader so
 * the case-shaping logic is unit-testable without a DB. Fail-soft: any RPC /
 * table-missing error returns [] so the surface degrades, never throws. Tenant
 * scoped via the RPC's p_tenant filter.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

export type CannibalCompetingUrl = {
  /** Canonicalized competing page URL. */
  url: string;
  clicks: number;
  impressions: number;
  /** Impressions-weighted average position for this URL on the query. */
  position: number;
};

export type GscCannibalizationCase = {
  query: string;
  /** Competing own-URLs, sorted best (lowest) position first. */
  competingUrls: CannibalCompetingUrl[];
  urlCount: number;
  totalClicks: number;
  totalImpressions: number;
  /** The best-ranking URL = the natural lead/canonical candidate (operator decides). */
  leadUrl: string;
  bestPosition: number;
  /** Combined impressions-weighted position across all competing URLs. */
  weightedPosition: number;
};

/** Raw RPC row shape (pos_weighted = Σ position×impressions per query×url). */
type CannibalRpcRow = {
  query: string;
  url: string;
  clicks: number | string;
  impressions: number | string;
  pos_weighted: number | string;
};

/** Default lookback (recent co-ranking) + min combined impressions to matter. */
const WINDOW_DAYS = 28;
const MIN_COMBINED_IMPRESSIONS = 100;

/** Search-operator queries (e.g. "site:www.iranopedia.com") make Google list
 *  the WHOLE site sequentially #1, #2, #3… which looks exactly like every page
 *  competing for one query — but it is the operator browsing their own site,
 *  NOT cannibalization. Drop these so they never produce a bogus case (e.g. a
 *  homepage "lead" with an empty rank). */
const SEARCH_OPERATOR = /^\s*(?:site|inurl|intitle|allintitle|allinurl|cache|related|link|filetype|ext)\s*:/i;

/** Group flat (query,url) RPC rows into cannibalization cases. PURE. */
export function groupCannibalizationRows(
  rows: ReadonlyArray<CannibalRpcRow>,
): GscCannibalizationCase[] {
  // Merge by (query, canonical url) — canonicalization can collapse two raw
  // URLs to one; sum their metrics so a single page never looks like two.
  const byQuery = new Map<string, Map<string, CannibalCompetingUrl & { posWeighted: number }>>();
  for (const r of rows) {
    if (SEARCH_OPERATOR.test(r.query)) continue;
    const query = r.query;
    const url = canonicalizeCitationUrl(r.url) ?? r.url;
    const clicks = Number(r.clicks) || 0;
    const impressions = Number(r.impressions) || 0;
    const posWeighted = Number(r.pos_weighted) || 0;
    const urls = byQuery.get(query) ?? new Map();
    const cur = urls.get(url);
    if (cur) {
      cur.clicks += clicks;
      cur.impressions += impressions;
      cur.posWeighted += posWeighted;
    } else {
      urls.set(url, { url, clicks, impressions, position: 0, posWeighted });
    }
    byQuery.set(query, urls);
  }

  const cases: GscCannibalizationCase[] = [];
  for (const [query, urlsMap] of byQuery) {
    const competing = [...urlsMap.values()].map((u) => ({
      url: u.url,
      clicks: u.clicks,
      impressions: u.impressions,
      position: u.impressions > 0 ? u.posWeighted / u.impressions : 0,
    }));
    // Canonicalization may have collapsed the row set back to a single page.
    if (competing.length < 2) continue;
    competing.sort((a, b) => a.position - b.position);
    const totalClicks = competing.reduce((s, u) => s + u.clicks, 0);
    const totalImpressions = competing.reduce((s, u) => s + u.impressions, 0);
    const weightedNum = competing.reduce((s, u) => s + u.position * u.impressions, 0);
    cases.push({
      query,
      competingUrls: competing,
      urlCount: competing.length,
      totalClicks,
      totalImpressions,
      leadUrl: competing[0].url,
      bestPosition: competing[0].position,
      weightedPosition: totalImpressions > 0 ? weightedNum / totalImpressions : 0,
    });
  }
  // Worst offenders first (most impressions split across the most pages).
  cases.sort((a, b) => b.totalImpressions - a.totalImpressions);
  return cases;
}

/**
 * Load cannibalization cases for the ambient tenant. Fail-soft → []. The RPC
 * does the server-side GROUP BY so the 80k client-row cap can never truncate.
 */
export async function loadGscCannibalizationForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<GscCannibalizationCase[]> {
  let rows: CannibalRpcRow[] = [];
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.rpc("gsc_cannibalization_v1", {
      p_tenant: tenantId,
      p_since: since,
      p_min_impr: MIN_COMBINED_IMPRESSIONS,
    });
    if (error) {
      log.warn("[gsc-cannibalization] rpc read failed", {
        tenantId,
        error: error.message,
      });
      return [];
    }
    rows = (data ?? []) as unknown as CannibalRpcRow[];
  } catch {
    return [];
  }
  return groupCannibalizationRows(rows);
}
