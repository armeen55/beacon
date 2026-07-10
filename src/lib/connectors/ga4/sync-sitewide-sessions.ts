import "server-only";

/**
 * GA4 sitewide sessions sync (2026-07-10, Wave 2A).
 *
 * Pulls GA4's OWN per-day sitewide session count (a date-only report) and upserts
 * one row per (tenant, property, day) into `ga4_daily_totals`. This is the TRUE
 * sitewide series that REPLACES the false "sum ga4_url_traffic" number Wave 1
 * withdrew.
 *
 * Contract (mirrors sync-ai-referrals.ts):
 *   - DORMANT-UNTIL-KEY: no token -> { synced:false, reason:"no_token" };
 *     token without a property -> { synced:false, reason:"no_property" }.
 *   - ISOLATED from the per-page traffic sync: a SEPARATE report request and its
 *     own cron step, so a sitewide failure never slows or breaks the per-page
 *     sync (and vice versa).
 *   - Fail-soft: report/persist failures return { synced:false, reason }; NEVER
 *     throws on documented paths. The cron logs one line and continues.
 *   - Idempotent: the persist upserts on (tenant_id, property_id, date), so a
 *     re-run of a night can never inflate a day.
 *   - Bounded window: `days` back from today (default 420, GA4's ~14-month
 *     retention ceiling), so the full available history rolls up while quota
 *     stays bounded.
 *
 * Pinned by tests/lib/connectors/ga4/sync-sitewide-sessions.test.ts.
 */

import { getGoogleConnectorToken } from "@/lib/connector-store";

import { persistGa4SitewideDailyTotals } from "./persist-sitewide-sessions";

const DEFAULT_DAYS = 420;
const MAX_DAYS = 420;
const ONE_DAY_MS = 86_400_000;

export type Ga4SitewideSyncResult =
  | { synced: false; reason: string }
  | {
      synced: true;
      property: string;
      rows_fetched: number;
      rows_upserted: number;
      propertyTimezone: string | null;
      /** true when the underlying report was a PARTIAL (paginated/capped) pull. */
      truncated?: boolean;
    };

/** Compute the inclusive [startDate, endDate] window: `days` back from today
 *  UTC, capped at MAX_DAYS. Pure; exported for tests. */
export function computeSitewideDateRange(
  days: number,
  now: Date,
): { startDate: string; endDate: string } {
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const boundedDays = Math.min(Math.max(Math.trunc(days), 1), MAX_DAYS);
  return {
    startDate: new Date(todayUtcMs - boundedDays * ONE_DAY_MS).toISOString().slice(0, 10),
    endDate: new Date(todayUtcMs).toISOString().slice(0, 10),
  };
}

export async function syncGa4SitewideSessionsForTenant(args: {
  tenantId: string;
  days?: number;
  now?: Date;
}): Promise<Ga4SitewideSyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) return { synced: false, reason: "no_token" };
  const propertyId = token.ga4_property_id;
  if (propertyId == null || propertyId === "") return { synced: false, reason: "no_property" };

  const { startDate, endDate } = computeSitewideDateRange(args.days ?? DEFAULT_DAYS, now);
  const result = await persistGa4SitewideDailyTotals({
    tenantId,
    propertyId,
    startDate,
    endDate,
    now,
  });
  if (!result.ok) return { synced: false, reason: result.reason };

  return {
    synced: true,
    property: propertyId,
    rows_fetched: result.rows_fetched,
    rows_upserted: result.rows_upserted,
    propertyTimezone: result.propertyTimezone,
    ...(result.truncated ? { truncated: true } : {}),
  };
}

/** Test-only export of internals. */
export const __testing = { DEFAULT_DAYS, MAX_DAYS };
