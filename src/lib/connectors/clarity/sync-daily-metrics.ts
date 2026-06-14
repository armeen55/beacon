/**
 * Connect-cards slice (2026-06-12) — nightly Clarity harvester.
 * Clarity exposes only a rolling 1-3 day window (no backfill) and
 * caps the project at 10 requests/DAY — so Beacon pulls ONCE per
 * night (one request = 10% of the budget) and accumulates its own
 * per-URL history in clarity_daily_url_metrics. Rows are stamped
 * with YESTERDAY's date (numOfDays=1 ≈ the trailing 24h).
 *
 * Fail-soft: no token / API error / table missing → skip with a
 * reason; the cron never dies on this step.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

import { fetchClarityUrlMetrics } from "./client";

export type ClaritySyncResult =
  | { synced: false; reason: string }
  | { synced: true; rows_upserted: number };

export async function syncClarityDailyMetricsForTenant(args: {
  tenantId: string;
  now?: Date;
}): Promise<ClaritySyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const metrics = await fetchClarityUrlMetrics({ tenantId });
  if (metrics == null) return { synced: false, reason: "no_token_or_api_error" };
  if (metrics.length === 0) return { synced: true, rows_upserted: 0 };

  const date = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
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
