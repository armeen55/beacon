import "server-only";

/**
 * source-data-date (refresh-reliability wave, 2026-07-11, BUG 3).
 *
 * The newest data date each read source actually has stored, per tenant. The
 * refresh ledger records this AFTER a run so /settings/connectors can say "data
 * through <date>" honestly - and so a source that reports "synced" while its
 * freshest row is weeks old (the Profound silent-partial) is visible.
 *
 * FAIL-SOFT BY CONTRACT: every reader returns null on any error, missing table,
 * or absent Supabase env (local dev / vitest). A latest-date read must never
 * fail the sync it is annotating. One bounded query per source (SELECT date
 * ORDER BY date DESC LIMIT 1 - the same shape as GSC's own readWatermark), so
 * it is cheap and never scans the table.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { RefreshSource } from "@/domains/ops/refresh-runs-store";

/** SELECT the single newest `date` for a tenant from one source table. Null on
 *  any error / no rows / no env. `finalOnly` gates GSC to finalized days (the
 *  same rows readWatermark trusts). */
async function newestDate(
  table: string,
  tenantId: string,
  finalOnly = false,
): Promise<string | null> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return null;
  }
  try {
    let q = admin
      .from(table)
      .select("date")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(1);
    if (finalOnly) q = q.eq("is_final", true);
    const { data, error } = await q;
    if (error != null || !Array.isArray(data) || data.length === 0) return null;
    const d = (data[0] as { date?: unknown }).date;
    return typeof d === "string" ? d.slice(0, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Newest stored data date (YYYY-MM-DD) for one source + tenant, or null when
 * unknown. Profound spreads data across several row kinds; the citation rows are
 * its primary daily feed, so their newest date is the honest "data through".
 */
export async function latestDataDateForSource(
  tenantId: string,
  source: RefreshSource,
): Promise<string | null> {
  switch (source) {
    case "gsc":
      return newestDate("gsc_daily_rows", tenantId, true);
    case "ga4":
      return newestDate("ga4_url_traffic", tenantId);
    case "clarity":
      return newestDate("clarity_daily_url_metrics", tenantId);
    case "profound":
      return newestDate("profound_citation_rows", tenantId);
  }
}
