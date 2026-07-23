/**
 * load-brand-split (R17a / P2 slice 1) - the I/O edge for the scoreboard's
 * non-brand lens.
 *
 * Reads ONLY rows that can move the click split: gsc_daily_rows with clicks > 0
 * over the scoreboard's own last-14 REPORTED days (zero-click rows are the vast
 * majority of the query grain and contribute nothing to a click sum, so this
 * read stays small on a busy site). Brand tokens come from the tenant's
 * configured name + domain through the ONE brand classifier.
 *
 * HONESTY: if the read hits its row budget the split could under-count either
 * side, so the lens is DROPPED (null) rather than rendered from a truncated
 * read. Fail-soft everywhere - a broken read never blanks the scoreboard.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getBusinessProfile } from "@/lib/business-config";
import { log } from "@/lib/logger";
import {
  brandTokensForConfig,
  buildScoreboardBrandLens,
  type BrandSplitRow,
  type ScoreboardBrandLens,
} from "./brand-split";

/** Clicked rows only; a large site has a few hundred clicked query rows a day,
 *  so 14 reported days sits far under this. Hitting the budget = drop the lens. */
const ROW_BUDGET = 20_000;

export async function loadScoreboardBrandLens(
  tenantId: string,
  reportedDates: readonly string[],
): Promise<ScoreboardBrandLens | null> {
  if (!tenantId || reportedDates.length < 14) return null;
  let tokens: string[];
  try {
    const cfg = getBusinessProfile(tenantId);
    tokens = brandTokensForConfig({ name: cfg.name, domain: cfg.domain });
  } catch {
    return null;
  }
  if (tokens.length === 0) return null;

  const dates = [...reportedDates].sort();
  const since = dates[dates.length - 14]!;
  const through = dates[dates.length - 1]!;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("date, query, clicks")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .lte("date", through)
      .gt("clicks", 0)
      .order("clicks", { ascending: false })
      .limit(ROW_BUDGET);
    if (error || !data) return null;
    if (data.length >= ROW_BUDGET) {
      // Truncated read -> the split would under-count. Drop the lens, honestly.
      log.warn("[brand-split] clicked-row read hit its budget; lens dropped", {
        tenantId,
        budget: ROW_BUDGET,
      });
      return null;
    }
    const rows: BrandSplitRow[] = (data as Array<{ date: string; query: string; clicks: number | string | null }>).map(
      (r) => ({ date: r.date, query: r.query, clicks: Number(r.clicks) || 0 }),
    );
    return buildScoreboardBrandLens({ rows, tokens, reportedDates: dates });
  } catch (e) {
    log.warn("[brand-split] lens read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
