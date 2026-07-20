import "server-only";

/**
 * Per-PATH daily clicks series for Results rows (FINAL PREMIUM PLAN item 5).
 *
 * The proof ledger stores bare paths ("/cities") while `gsc_daily_page_totals`
 * keys rows by the full GSC page URL, so this resolves paths to their raw GSC
 * page URLs first (one bounded RPC read, one row per page) and then reuses the
 * existing ≤16-page IN() daily-clicks loader. Two bounded reads total, never a
 * full-table daily scan. Fail-soft → empty map (rows just render without the
 * before/after line).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import {
  loadDailyClicksByPagesForTenant,
  type DailyClicks,
} from "@/domains/recommendation-intelligence/gsc-page-queries";

function toPath(url: string): string {
  try {
    const p = new URL(url).pathname || "/";
    return p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p;
  } catch {
    const p = url.startsWith("/") ? url : `/${url}`;
    return p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p;
  }
}

/** Resolve ledger paths -> raw GSC page URLs (highest-clicks variant wins). */
async function resolvePathsToPages(
  tenantId: string,
  paths: string[],
): Promise<Map<string, string>> {
  const wanted = new Map(paths.map((p) => [toPath(p), p] as const));
  const best = new Map<string, { page: string; clicks: number }>();
  try {
    const admin = getSupabaseAdmin();
    const since = new Date(Date.now() - 70 * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await admin.rpc("gsc_page_totals_v1", {
      p_tenant: tenantId,
      p_since: since,
    });
    if (error || !Array.isArray(data)) return new Map();
    for (const r of data as Array<{ page: string; clicks: number | string }>) {
      if (!r.page) continue;
      const path = toPath(r.page);
      const orig = wanted.get(path);
      if (orig == null) continue;
      const clicks = Number(r.clicks) || 0;
      const prev = best.get(orig);
      if (!prev || clicks > prev.clicks) best.set(orig, { page: r.page, clicks });
    }
  } catch (err) {
    log.warn("daily-series: path-to-page resolve read failed; before/after line self-hides", {
      tenant: tenantId,
      store: "gsc_page_totals_v1",
      error: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
  return new Map([...best.entries()].map(([orig, v]) => [orig, v.page]));
}

/**
 * Daily clicks for up to 16 ledger paths over the trailing `days`, keyed by the
 * ORIGINAL ledger path so callers can look up rows directly.
 */
export async function loadDailyClicksByPathsForTenant(
  tenantId: string,
  paths: string[],
  days = 70,
): Promise<Map<string, DailyClicks[]>> {
  const out = new Map<string, DailyClicks[]>();
  const unique = [...new Set(paths.filter(Boolean))].slice(0, 16);
  if (!tenantId || unique.length === 0) return out;
  const pageByPath = await resolvePathsToPages(tenantId, unique);
  if (pageByPath.size === 0) return out;
  const byPage = await loadDailyClicksByPagesForTenant(tenantId, [...pageByPath.values()], days);
  for (const [orig, page] of pageByPath) {
    const series = byPage.get(page);
    if (series && series.length > 0) out.set(orig, series);
  }
  return out;
}
