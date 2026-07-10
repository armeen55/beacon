/**
 * north-star/load-monthly-pulse (2026-07-09 origin; 2026-07-10 P0-A truth fix) - the
 * I/O for the monthly north star.
 *
 * P0-A (2026-07-10): this loader NO LONGER reads a sitewide GA4 visits total. The old
 * path called the ga4_monthly_sessions_v1 RPC, which sums session counts across the
 * per-(url, date) GA4 table - and GA4 sessions are not additive across page paths, so
 * that total was inflated (see the WHY in monthly-pulse.ts and the invalid-for-sitewide
 * warning on migrations/2026-07-09_ga4_monthly_sessions_rpc.sql). That RPC is left in
 * place for Wave 2 to replace with a property-grain rollup; it MUST NOT be reused as a
 * sitewide total, so nothing here calls it.
 *
 * The proven series we read is the property-grain GSC daily totals
 * (loadDailyTotalsForTenant -> gsc_daily_totals, one row per property per day). Summing
 * those across DISTINCT days is additive-safe for clicks, so the monthly GSC series is
 * trustworthy. Fail-soft: no GSC data -> null so the card self-hides (never a bare zero).
 *
 * Wave 2A (2026-07-10): the sitewide VISITS number returns, but ONLY behind a passing,
 * fresh reconciliation. We ask loadReconciledVisitsForTenant (all GA4 Supabase I/O lives
 * in ga4-sitewide-rollup.ts - deliberately NOT here, so this file's source pin against
 * the withdrawn per-(url,date) sum stays intact) and thread the verdict into the view
 * model. No pass -> the shipped hold-back line stays EXACTLY as it was.
 */
import "server-only";

import { log } from "@/lib/logger";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildMonthlyPulse, type MonthlyPulse } from "@/domains/north-star/monthly-pulse";
import { loadReconciledVisitsForTenant } from "@/domains/north-star/ga4-sitewide-rollup";

export async function loadMonthlyPulseForTenant(
  tenantId: string,
  monthlyVisitGoal: number | null,
  now: Date = new Date(),
): Promise<MonthlyPulse | null> {
  try {
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

    if (gscMonths.length === 0) return null;

    // Gate the visits number behind a passing, fresh reconciliation. Fail-soft: any
    // trouble here yields a "none" gate, i.e. the shipped hold-back stays.
    const gate = await loadReconciledVisitsForTenant(tenantId, now);
    const reconciliation =
      gate.status === "pass"
        ? { status: "pass" as const, visitsByMonth: gate.months }
        : gate.status === "mismatch"
          ? { status: "mismatch" as const }
          : null;

    return buildMonthlyPulse({ gscMonths, monthlyVisitGoal, reconciliation, nowMs: now.getTime() });
  } catch (e) {
    log.warn("[north-star] load monthly pulse failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
