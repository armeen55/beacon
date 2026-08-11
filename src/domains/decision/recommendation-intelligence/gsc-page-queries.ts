import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { reportingDay } from "@/lib/reporting-day";

/**
 * gsc-page-queries - the property-level daily Search Console totals the Today scoreboard chart draws. Reads the small, accurate `gsc_daily_totals` table
 * (the ungrouped totals Google reports directly, so nothing is truncated), ascending by date, bounded to a trailing window. Fail-soft to an empty series:
 * a Search Console outage narrows the chart, it never breaks the surface.
 *
 * Everything else this file once held (per-page query scans, tenant-wide query loaders, striking/declining/rising page finders) had no caller left after the
 * demand-graph retirement and was deleted rather than kept warm.
 */

/** The reporting day `days` ago. */
function sinceDateIso(days: number): string {
  return reportingDay(Date.now() - days * 86_400_000);
}

type DailyTotals = { date: string; clicks: number; impressions: number };

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
