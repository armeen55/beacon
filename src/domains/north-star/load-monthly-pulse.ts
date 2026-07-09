/**
 * north-star/load-monthly-pulse (2026-07-09, operator spec A-3/B-6) - the I/O for
 * the monthly north star. GA4 monthly sessions via the ga4_monthly_sessions_v1 RPC
 * (one server-side GROUP BY, never a 55k-row page-through); sitewide monthly GSC
 * clicks summed from the tiny gsc_daily_totals read. Fail-soft everywhere: a
 * missing RPC (PGRST202) or empty source degrades to whatever the other source
 * has; both empty -> null so the card self-hides.
 */
import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildMonthlyPulse, type MonthlyPulse } from "@/domains/north-star/monthly-pulse";

/** First day of the month `monthsBack` calendar months before `now`, as "YYYY-MM-DD" (UTC). */
function sinceMonthIso(now: Date, monthsBack: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

export async function loadMonthlyPulseForTenant(
  tenantId: string,
  monthlyVisitGoal: number | null,
  now: Date = new Date(),
): Promise<MonthlyPulse | null> {
  try {
    const pSince = sinceMonthIso(now, 5);

    let ga4Months: Array<{ month: string; sessions: number }> = [];
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb.rpc("ga4_monthly_sessions_v1", { p_tenant: tenantId, p_since: pSince });
      if (error) {
        log.warn("[north-star] ga4 monthly rpc failed", { tenantId, error: error.message });
      } else if (data) {
        ga4Months = (data as Array<{ month: string; sessions: number | string | null }>).map((r) => ({
          month: String(r.month).slice(0, 10),
          sessions: Number(r.sessions) || 0,
        }));
      }
    } catch (e) {
      log.warn("[north-star] ga4 monthly rpc threw", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const dailyTotals = await loadDailyTotalsForTenant(tenantId, 190);
    const gscByMonth = new Map<string, { clicks: number; impressions: number }>();
    for (const row of dailyTotals) {
      const key = `${row.date.slice(0, 7)}-01`;
      const agg = gscByMonth.get(key) ?? { clicks: 0, impressions: 0 };
      agg.clicks += row.clicks;
      agg.impressions += row.impressions;
      gscByMonth.set(key, agg);
    }
    const gscMonths = [...gscByMonth.entries()]
      .map(([month, agg]) => ({ month, clicks: agg.clicks, impressions: agg.impressions }))
      .sort((a, b) => a.month.localeCompare(b.month));

    if (ga4Months.length === 0 && gscMonths.length === 0) return null;

    return buildMonthlyPulse({ ga4Months, gscMonths, monthlyVisitGoal, nowMs: now.getTime() });
  } catch (e) {
    log.warn("[north-star] load monthly pulse failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
