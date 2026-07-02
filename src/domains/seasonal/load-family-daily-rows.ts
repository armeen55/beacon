/**
 * seasonal/load-family-daily-rows (BEACON_500 item 69) - the bounded read the
 * weekly half of the family demand profile runs on.
 *
 * gsc_daily_page_totals holds Beacon/GSC's own retention window (short - a few
 * months, not the permanent monthly archive), one row per (tenant, page,
 * date). Read once per tenant, in 1000-row pages (PostgREST's per-response
 * cap), and folded into FamilyDailyRow[] for family-demand-profile.ts.
 *
 * Fail-soft -> [] (a loader hiccup silences the weekly profile for a pass;
 * the annual half from the permanent archive is untouched).
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import type { FamilyDailyRow } from "./family-demand-profile";

/** Hard cap on daily rows read per tenant per pass - generous headroom above
 *  gsc_daily_page_totals's real short retention window (ground-truthed at
 *  ~9k rows for a busy tenant over ~2 months). */
export const FAMILY_DAILY_ROW_BUDGET = 60_000;
/** PostgREST caps a single response at 1000 rows regardless of .limit(), so
 *  reading past 1000 rows REQUIRES paging with .range() (same fix as
 *  archive-rollup.ts / load-monthly-archive.ts). */
const PAGE_SIZE = 1000;

type RawRow = {
  page?: string | null;
  date?: string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
};

/** PURE row mapper - exported for the loader-mapping unit test. */
export function normalizeFamilyDailyRows(data: RawRow[]): FamilyDailyRow[] {
  const out: FamilyDailyRow[] = [];
  for (const r of data) {
    const page = (r.page ?? "").trim();
    const date = (r.date ?? "").slice(0, 10);
    if (!page || !date) continue;
    out.push({
      page,
      date,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
    });
  }
  return out;
}

/** Every gsc_daily_page_totals row for a tenant, up to the row budget, paged
 *  in 1000-row chunks. Bounded + fail-soft -> []. */
export async function loadFamilyDailyRows(tenantId: string): Promise<FamilyDailyRow[]> {
  if (!tenantId) return [];
  try {
    const sb = getSupabaseAdmin();
    const out: RawRow[] = [];
    for (let from = 0; from < FAMILY_DAILY_ROW_BUDGET; from += PAGE_SIZE) {
      const { data, error } = await sb
        .from("gsc_daily_page_totals")
        .select("page, date, impressions, clicks")
        .eq("tenant_id", tenantId)
        .order("date")
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        log.warn("[seasonal] family daily rows read failed", { tenantId, from, error: error.message });
        break;
      }
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break; // last page
      if (from + PAGE_SIZE >= FAMILY_DAILY_ROW_BUDGET) {
        log.warn("[seasonal] family daily rows read hit row budget", { tenantId });
      }
    }
    return normalizeFamilyDailyRows(out);
  } catch (e) {
    log.warn("[seasonal] family daily rows load threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
