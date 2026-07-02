/**
 * seasonal/load-monthly-archive (2026-07-02, master plan item 21) - the
 * bounded read the nightly seasonality pass runs on.
 *
 * gsc_monthly_archive is already a compact rollup (one row per query per
 * month, not per day), but the read is still capped so a query-rich tenant's
 * archive can never become an unbounded read as it grows year over year.
 *
 * Fail-soft -> [] (a loader hiccup silences the seasonality pass for a night,
 * nothing more; the permanent archive itself is untouched).
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import type { MonthlyArchiveRow } from "./seasonality";

/** Hard cap on archive rows read per tenant per pass. */
export const MONTHLY_ARCHIVE_ROW_BUDGET = 20_000;
/** Rows per Supabase page. PostgREST caps a single response at 1000 rows
 *  regardless of the requested .limit(), so reading past 1000 rows REQUIRES
 *  paging with .range() (see the same fix in archive-rollup.ts's
 *  PAGE_ROW_BUDGET; ground-truthed live against tenant-iranopedia, whose
 *  archive already exceeds 1000 rows). */
const PAGE_SIZE = 1000;

type RawRow = {
  query?: string | null;
  month?: string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  top_page?: string | null;
};

/** PURE row mapper: raw Supabase rows -> MonthlyArchiveRow[] (drops unusable
 *  rows, coerces numerics). Exported for the loader-mapping unit test. */
export function normalizeMonthlyArchiveRows(data: RawRow[]): MonthlyArchiveRow[] {
  const out: MonthlyArchiveRow[] = [];
  for (const r of data) {
    const month = (r.month ?? "").slice(0, 10);
    const query = (r.query ?? "").trim();
    if (!month || !query) continue;
    out.push({
      query,
      month,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      topPage: r.top_page ?? null,
    });
  }
  return out;
}

/** Every gsc_monthly_archive row for a tenant, up to the row budget, paged in
 *  1000-row chunks (see PAGE_SIZE). Bounded (see module header) + fail-soft -> []. */
export async function loadMonthlyArchiveRows(tenantId: string): Promise<MonthlyArchiveRow[]> {
  if (!tenantId) return [];
  try {
    const sb = getSupabaseAdmin();
    const out: RawRow[] = [];
    for (let from = 0; from < MONTHLY_ARCHIVE_ROW_BUDGET; from += PAGE_SIZE) {
      const { data, error } = await sb
        .from("gsc_monthly_archive")
        .select("query, month, impressions, clicks, top_page")
        .eq("tenant_id", tenantId)
        .order("query")
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        log.warn("[seasonal] monthly archive read failed", { tenantId, from, error: error.message });
        break;
      }
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break; // last page
      if (from + PAGE_SIZE >= MONTHLY_ARCHIVE_ROW_BUDGET) {
        log.warn("[seasonal] monthly archive read hit row budget", { tenantId });
      }
    }
    return normalizeMonthlyArchiveRows(out);
  } catch (e) {
    log.warn("[seasonal] monthly archive load threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
