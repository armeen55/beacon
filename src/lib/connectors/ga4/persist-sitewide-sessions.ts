import "server-only";

/**
 * GA4 sitewide daily-totals persist helper (2026-07-10, Wave 2A).
 *
 * Wraps `runGa4SitewideSessionsReport` (date-dimension-only report) and upserts
 * ONE row per (tenant, property, day) into `ga4_daily_totals`. This is the TRUE
 * sitewide series: GA4's own per-day session count for the whole property, stored
 * at a grain where summing across DISTINCT days is additive-safe. "visits" == GA4
 * sessions (see data-api.ts + the migration).
 *
 * ISOLATED from the per-page traffic persist by contract: a separate report
 * request, a separate table, its own fail-soft union. A failure here can never
 * touch the per-page traffic table and vice versa.
 *
 * FAILS CLOSED on property mismatch: the persist re-reads the tenant's configured
 * `ga4_property_id` and refuses to write if it does not match the property the
 * report was run against - a stale/wrong property can never poison the rollup.
 *
 * Idempotent UPSERT on (tenant_id, property_id, date): overlapping or repeated
 * syncs overwrite the same key, so they can never inflate a day's sessions.
 *
 * Fail-soft: discriminated union, NEVER throws on documented paths. A missing
 * table (PGRST205/42P01, before the architect applies the migration) surfaces as
 * `persist_failed` and is logged once; it never crashes a caller.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getGoogleConnectorToken } from "@/lib/connector-store";
import { log } from "@/lib/logger";

import { runGa4SitewideSessionsReport } from "./data-api";
import type { Ga4FailReason, Ga4SitewideDailyRow } from "./types";

const TABLE = "ga4_daily_totals";

export type PersistGa4SitewideArgs = {
  tenantId: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  now?: Date;
};

export type PersistGa4SitewideFailReason =
  | Ga4FailReason
  | "admin_unavailable"
  | "persist_failed"
  | "invalid_args"
  | "property_mismatch";

export type PersistGa4SitewideResult =
  | {
      ok: true;
      rows_fetched: number;
      rows_upserted: number;
      startDate: string;
      endDate: string;
      /** The property's reporting timezone GA4 bucketed these dates in; null if absent. */
      propertyTimezone: string | null;
      /** true when the underlying report was a PARTIAL (paginated/capped) pull. */
      truncated?: boolean;
    }
  | {
      ok: false;
      reason: PersistGa4SitewideFailReason;
      status?: number;
      message?: string;
    };

export async function persistGa4SitewideDailyTotals(
  args: PersistGa4SitewideArgs,
): Promise<PersistGa4SitewideResult> {
  const { tenantId, propertyId, startDate, endDate } = args;
  if (!tenantId) return { ok: false, reason: "invalid_args", message: "missing tenantId" };
  if (!propertyId) return { ok: false, reason: "invalid_args", message: "missing propertyId" };
  if (!startDate || !endDate) return { ok: false, reason: "invalid_args", message: "missing date range" };

  // FAIL CLOSED on property mismatch: the row we are about to write is keyed by
  // property_id, so a report run against a property other than the tenant's
  // configured one must NEVER be persisted (it would create a phantom property's
  // rollup). Re-read the token here rather than trusting the caller.
  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) return { ok: false, reason: "no_token" };
  const configuredProperty = token.ga4_property_id;
  if (configuredProperty == null || configuredProperty === "") {
    return { ok: false, reason: "no_token", message: "no property configured" };
  }
  if (configuredProperty !== propertyId) {
    log.warn("[persist-ga4-sitewide] property mismatch; refusing to persist", {
      tenantId,
      configuredProperty,
      requestedProperty: propertyId,
    });
    return { ok: false, reason: "property_mismatch", message: "configured property != report property" };
  }

  const report = await runGa4SitewideSessionsReport({ tenantId, propertyId, startDate, endDate });
  if (!report.ok) {
    return {
      ok: false,
      reason: report.reason,
      ...(report.status != null ? { status: report.status } : {}),
      ...(report.message != null ? { message: report.message } : {}),
    };
  }

  const rowsFetched = report.rows.length;
  const truncated = report.truncated === true;
  if (rowsFetched === 0) {
    // Honest no-op: the report ran and returned no days in the window. Never a
    // fabricated zero row - absence stays absence so the card holds back.
    return {
      ok: true,
      rows_fetched: 0,
      rows_upserted: 0,
      startDate,
      endDate,
      propertyTimezone: report.propertyTimezone,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    log.warn("[persist-ga4-sitewide] Supabase admin unavailable", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: "admin_unavailable", message: "supabase admin unavailable" };
  }

  const nowIso = (args.now ?? new Date()).toISOString();
  const upsertRows = report.rows.map((row: Ga4SitewideDailyRow) => ({
    tenant_id: tenantId,
    property_id: propertyId,
    date: row.date,
    sessions: row.sessions,
    engaged_sessions: row.engaged_sessions,
    property_timezone: report.propertyTimezone,
    truncated,
    source_run_at: nowIso,
    synced_at: nowIso,
    updated_at: nowIso,
  }));

  const { error } = await admin
    .from(TABLE)
    .upsert(upsertRows, { onConflict: "tenant_id,property_id,date" });
  if (error != null) {
    const message =
      typeof (error as { message?: unknown }).message === "string"
        ? ((error as { message?: string }).message as string)
        : "upsert failed";
    log.warn("[persist-ga4-sitewide] upsert failed", {
      tenantId,
      rowsAttempted: upsertRows.length,
      error: message,
      code: (error as { code?: unknown }).code,
    });
    return { ok: false, reason: "persist_failed", message };
  }

  return {
    ok: true,
    rows_fetched: rowsFetched,
    rows_upserted: upsertRows.length,
    startDate,
    endDate,
    propertyTimezone: report.propertyTimezone,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Test-only export of internals. */
export const __testing = { TABLE };
