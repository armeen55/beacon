/**
 * Connect-cards slice (2026-06-12) — nightly Clarity harvester.
 * Clarity exposes only a rolling 1-3 day window (no backfill) and
 * caps the project at 10 requests/DAY — so Beacon pulls ONCE per
 * day (one request = 10% of the budget) and accumulates its own
 * per-URL history in clarity_daily_url_metrics. Rows are stamped
 * with YESTERDAY's date (numOfDays=1 ≈ the trailing 24h).
 *
 * Fail-soft: no token / API error / table missing → skip with a
 * reason; the cron never dies on this step. A pull Clarity refused
 * (quota, rejected token, outage) stamps `retry_after` 24 hours out
 * on the token row so the on-use refresh does not spend the rest of
 * the day's ten requests retrying it every cycle (41 failures in one
 * day before 2026-09-14).
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { updateConnectorToken } from "@/lib/connector-store";
import { reportingDay } from "@/lib/reporting-day";
import { log } from "@/lib/logger";

import { fetchClarityUrlMetrics } from "./client";

const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

type ClaritySyncResult =
  | { synced: false; reason: string }
  | { synced: true; rows_upserted: number };

export async function syncClarityDailyMetricsForTenant(args: {
  tenantId: string;
  now?: Date;
}): Promise<ClaritySyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const pulled = await fetchClarityUrlMetrics({ tenantId });
  if (!pulled.ok) {
    if (pulled.reason !== "no_token") {
      await updateConnectorToken(
        "clarity",
        { retry_after: new Date(now.getTime() + RETRY_AFTER_MS).toISOString() },
        tenantId,
      ).catch(() => undefined);
    }
    return { synced: false, reason: pulled.reason };
  }
  const metrics = pulled.metrics;
  if (metrics.length === 0) return { synced: true, rows_upserted: 0 };

  const date = reportingDay(now.getTime() - 86_400_000);
  const rows = metrics.map((m) => ({
    tenant_id: tenantId,
    date,
    url: m.url,
    sessions: m.sessions,
    rage_clicks: m.rageClicks,
    dead_clicks: m.deadClicks,
    excessive_scroll: m.excessiveScroll,
    quickbacks: m.quickbacks,
    script_errors: m.scriptErrors,
    avg_scroll_depth: m.avgScrollDepth,
    engagement_time_seconds: m.engagementTimeSeconds,
    pulled_at: now.toISOString(),
  }));
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("clarity_daily_url_metrics")
      .upsert(rows, { onConflict: "tenant_id,date,url" });
    if (error) {
      log.warn("[clarity-sync] upsert failed", { tenantId, error: error.message });
      // audit #16 (2026-06-14): a failed upsert is NOT a successful sync.
      // synced:true here made a persistence failure look identical to a
      // no-traffic night (the June-3 "ok with zero rows" incident class).
      return { synced: false, reason: "upsert_failed" };
    }
  } catch {
    return { synced: false, reason: "supabase_unavailable" };
  }
  return { synced: true, rows_upserted: rows.length };
}
