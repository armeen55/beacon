/**
 * load-ingestion-gaps (R17a / P2 slice 1) - the I/O edge for GSC ingestion-gap
 * classification.
 *
 * DATE SOURCE: gsc_daily_totals (ONE row per tenant+property+day - the
 * ungrouped property truth the sync writes for every day it pulls), so this
 * read is ~1 row per covered day, never the heavy page+query grain. A day the
 * sync pulled but that genuinely had zero traffic is healed by the gap re-pull
 * writing an explicit zero totals marker (see sync-search-analytics.ts), so a
 * quiet day does not re-flag forever.
 *
 * Property pick mirrors readiness.ts: when more than one property has rows
 * (a property-shape change between syncs), classify against the one with the
 * most recent data. Fail-soft: any error -> null (never blocks a render or a
 * sync).
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import {
  buildIngestionGapReport,
  pacificTodayString,
  type IngestionGapReport,
} from "./ingestion-gaps";

/** One row per day: ~3 years of history per property fits comfortably. */
const ROW_BUDGET = 5_000;

export async function loadGscIngestionGapReport(
  tenantId: string,
  opts: { property?: string; now?: Date } = {},
): Promise<IngestionGapReport | null> {
  if (!tenantId) return null;
  const now = opts.now ?? new Date();
  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("gsc_daily_totals")
      .select("property, date")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(ROW_BUDGET);
    if (opts.property) q = q.eq("property", opts.property);
    const { data, error } = await q;
    if (error || !data) return null;
    const rows = (data as Array<{ property?: string; date?: string }>).filter(
      (r) => typeof r.property === "string" && typeof r.date === "string",
    );
    if (rows.length === 0) {
      // Nothing ingested at all - an empty report (no gaps, no history).
      return buildIngestionGapReport([], pacificTodayString(now));
    }
    // Rows arrive date-desc, so the first row's property is the one with the
    // most recent data - the same "most recent wins" pick readiness.ts makes.
    const picked = opts.property ?? rows[0]!.property!;
    const dates = rows.filter((r) => r.property === picked).map((r) => r.date!);
    return buildIngestionGapReport(dates, pacificTodayString(now));
  } catch (e) {
    log.warn("[gsc-ingestion-gaps] read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
