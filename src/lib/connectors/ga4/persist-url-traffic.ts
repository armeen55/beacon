import "server-only";

/**
 * 2026-05-19 — Slice 9.A2γ — operator-only GA4 traffic persist
 * helper.
 *
 * Wraps `runGa4UrlTrafficReport` (substrate from 9.A2α.1) with a
 * Supabase upsert into the `ga4_url_traffic` cache table (migration
 * applied 2026-05-19). Operator-substrate only — never imported by
 * customer surfaces.
 *
 * Tenant scope:
 *   • Explicit `tenantId` parameter; no ambient context reads.
 *   • Every upserted row carries `tenant_id = args.tenantId`. The
 *     architecture invariant
 *     `outcome-attribution-refresh-no-customer-surface` keeps this
 *     module operator-only.
 *
 * Fail-soft contract:
 *   Discriminated `PersistGa4UrlTrafficResult` union. NEVER throws
 *   on the documented skip paths (`no_token` / `token_expired` /
 *   `disconnected` / `api_error` / `admin_unavailable` /
 *   `persist_failed` / `invalid_args`). Callers branch on the
 *   discriminator.
 *
 * Date-range helper (pure):
 *   `computeRefreshDateRange(edits, now)` — exported for unit
 *   testing. v1 policy:
 *     • endDate = today (UTC).
 *     • defaultStart = today − 90 days (UTC).
 *     • If verified-live edits have a parseable `live_at` earlier
 *       than defaultStart, expand the window back to min(live_at).
 *     • Hard cap: never earlier than today − 180 days. Protects
 *       against arbitrary historical backfill.
 *     • Conservative first version — tunable post-deploy.
 *
 * 9.A2γ.1 page-path normalization (added 2026-05-19):
 *   GA4's `pagePath` dimension is path-only (`/services/whole-home-
 *   remodel`). Beacon's `recommended_edits.target_url` stores full
 *   URLs (`https://ritzbuilders.com/services/whole-home-remodel`).
 *   The Mode A read model matches via `canonicalizeCitationUrl`
 *   which returns null for path-only inputs (citation-lifecycle's
 *   "full URLs only" contract). Without normalization, every GA4
 *   row gets skipped in Mode A's match loop and produces
 *   `ineligible: no_traffic_data`.
 *
 *   Fix at persist time: before upsert, prefix each path-only row
 *   with `https://{businessConfig.domain}` via
 *   `normalizeGa4PagePathToFullUrl`. Full-URL rows (forward-compat
 *   for any future Data API shape change) pass through unchanged.
 *   Empty / missing domain soft-fails to the path-only value AND
 *   emits a single operator-side warn so the operator can fix
 *   `business-config.domain`. Mode A continues to surface
 *   `no_traffic_data` honestly in that case.
 *
 * Pinned by:
 *   • tests/lib/connectors/ga4/persist-url-traffic.test.ts
 *   • tests/architecture/outcome-attribution-refresh-no-customer-surface.test.ts
 *   • tests/architecture/ga4-url-traffic-stored-as-full-url.test.ts
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { getBusinessConfig } from "@/lib/business-config";
import { runGa4RevenueReport, runGa4UrlTrafficReport } from "./data-api";
import { normalizeGa4PagePathToFullUrl } from "./normalize-page-path";
import type { Ga4FailReason, Ga4RevenueRow, Ga4UrlTrafficRow } from "./types";

const TABLE = "ga4_url_traffic";

/** Default lookback when no edit has an earlier `live_at`. Raised to ~14
 *  months (2026-06-15) — GA4's standard data-retention max — so the unified
 *  dashboard reflects the FULL traffic history the property holds, not just a
 *  recent slice. GA4 returns from the property's data-start; requesting beyond
 *  retention simply yields no rows for those days (harmless). */
const DEFAULT_LOOKBACK_DAYS = 420;

/** Hard cap on history (defensive bound). Matches GA4's ~14-month retention. */
const MAX_LOOKBACK_DAYS = 420;

const ONE_DAY_MS = 86_400_000;

/**
 * Persist helper args. All fields required; `tenantId` and
 * `propertyId` thread tenant scope explicitly.
 */
export type PersistGa4UrlTrafficArgs = {
  tenantId: string;
  propertyId: string;
  startDate: string;
  endDate: string;
};

/**
 * Failure-reason superset: Data API reasons + persist-side reasons.
 * Mirrors the substrate's discriminator style.
 */
export type PersistGa4UrlTrafficFailReason =
  | Ga4FailReason
  | "admin_unavailable"
  | "persist_failed"
  | "invalid_args";

/**
 * Per-run revenue enrichment status (2026-06-26). Revenue is fetched best-effort
 * AFTER traffic; a revenue failure NEVER fails the traffic persist (operator
 * rule). `synced` true means revenue columns + revenue_synced_at were written;
 * false means revenue stayed UNKNOWN (columns omitted, prior values preserved).
 */
export type Ga4RevenuePersistStatus = {
  synced: boolean;
  /** fail reason when synced=false (e.g. "revenue_unavailable", "api_error"). */
  reason?: string;
  /** count of upserted rows that carried > 0 revenue (purchase or total). */
  rows_with_revenue: number;
  /** property reporting currency, when known. */
  currency: string | null;
  /** true when the revenue report itself was a partial (paginated) pull. */
  truncated?: boolean;
};

/** Discriminated result; callers branch on `ok`. */
export type PersistGa4UrlTrafficResult =
  | {
      ok: true;
      rows_fetched: number;
      rows_upserted: number;
      startDate: string;
      endDate: string;
      /** audit-3 #7: true when runReport hit GA4_MAX_PAGES or a later page
       *  failed — the stored rows are a PARTIAL day. Threaded up so the sync +
       *  cron can flag it instead of silently treating partial as complete. */
      truncated?: boolean;
      /** 2026-06-26: revenue enrichment outcome (best-effort; never gates ok). */
      revenue?: Ga4RevenuePersistStatus;
    }
  | {
      ok: false;
      reason: PersistGa4UrlTrafficFailReason;
      status?: number;
      message?: string;
    };

/**
 * Compute the [startDate, endDate] window for a refresh run. Pure
 * helper; exported for unit testing.
 *
 *   • endDate = today (UTC, YYYY-MM-DD).
 *   • Default window: [today − 90d, today].
 *   • If any edit's `live_at` is earlier than today − 90d AND
 *     within today − 180d, expand startDate to min(live_at).
 *   • Hard cap: startDate ≥ today − 180d.
 */
export function computeRefreshDateRange(
  edits: ReadonlyArray<{ live_at?: string | null }>,
  now: Date,
): { startDate: string; endDate: string } {
  const todayUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const endDate = isoDateUtc(todayUtcMs);

  const defaultStartMs = todayUtcMs - DEFAULT_LOOKBACK_DAYS * ONE_DAY_MS;
  const maxStartMs = todayUtcMs - MAX_LOOKBACK_DAYS * ONE_DAY_MS;

  let minLiveAtMs: number | null = null;
  for (const e of edits) {
    if (e.live_at == null || e.live_at === "") continue;
    const t = Date.parse(e.live_at);
    if (!Number.isFinite(t)) continue;
    if (minLiveAtMs == null || t < minLiveAtMs) minLiveAtMs = t;
  }

  // Default to the 90-day window. Only expand back if we have a real
  // earlier live_at.
  let startMs = defaultStartMs;
  if (minLiveAtMs != null && minLiveAtMs < startMs) {
    startMs = minLiveAtMs;
  }

  // Hard floor at MAX_LOOKBACK_DAYS — clamp aggressively-old live_at
  // values to the cap rather than expanding the window arbitrarily.
  if (startMs < maxStartMs) startMs = maxStartMs;

  return { startDate: isoDateUtc(startMs), endDate };
}

function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Operator-only GA4 traffic refresh + upsert. Fetches via
 * `runGa4UrlTrafficReport`, narrows the response, and upserts into
 * the `ga4_url_traffic` cache table on conflict
 * `(tenant_id, url, date)`.
 *
 * Never throws on documented skip paths. Logs a single bounded
 * `log.warn` line on `admin_unavailable` or `persist_failed` for
 * operator triage; the Data API substrate already logs its own
 * non-2xx failures.
 */
export async function persistGa4UrlTraffic(
  args: PersistGa4UrlTrafficArgs,
): Promise<PersistGa4UrlTrafficResult> {
  const { tenantId, propertyId, startDate, endDate } = args;
  if (!tenantId) {
    return { ok: false, reason: "invalid_args", message: "missing tenantId" };
  }
  if (!propertyId) {
    return { ok: false, reason: "invalid_args", message: "missing propertyId" };
  }
  if (!startDate || !endDate) {
    return {
      ok: false,
      reason: "invalid_args",
      message: "missing date range",
    };
  }

  const report = await runGa4UrlTrafficReport({
    tenantId,
    propertyId,
    startDate,
    endDate,
  });
  if (!report.ok) {
    return {
      ok: false,
      reason: report.reason,
      ...(report.status != null ? { status: report.status } : {}),
      ...(report.message != null ? { message: report.message } : {}),
    };
  }

  const rowsFetched = report.rows.length;
  if (rowsFetched === 0) {
    return {
      ok: true,
      rows_fetched: 0,
      rows_upserted: 0,
      startDate,
      endDate,
      ...(report.truncated ? { truncated: true } : {}),
    };
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    log.warn("[persist-ga4-url-traffic] Supabase admin unavailable", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      ok: false,
      reason: "admin_unavailable",
      message: "supabase admin unavailable",
    };
  }

  // 9.A2γ.1 — resolve GA4 `pagePath` to a full URL using the tenant's
  // business-config domain. Empty/missing domain soft-fails to the
  // path-only value AND emits a single operator-side warn so the
  // operator can fix the config; Mode A continues to surface
  // `no_traffic_data` honestly in that case.
  const businessConfig = getBusinessConfig(tenantId);
  const domain = businessConfig.domain ?? "";
  if (domain.trim() === "" && report.rows.length > 0) {
    log.warn(
      "[persist-ga4-url-traffic] business-config.domain empty; GA4 path-only rows will store unprefixed (Mode A will surface no_traffic_data until fixed)",
      {
        tenantId,
        rowsAffected: report.rows.length,
      },
    );
  }

  const nowIso = new Date().toISOString();

  // ── Revenue enrichment (2026-06-26) — BEST-EFFORT, after traffic. A revenue
  // failure must NEVER fail the traffic persist. Keyed by RAW (date, pagePath)
  // to match the traffic rows before URL normalization. When the revenue call
  // succeeds, EVERY traffic row gets revenue columns + revenue_synced_at (a page
  // with no revenue row = an OBSERVED 0, since the property tracks revenue). When
  // it fails, the revenue columns are OMITTED entirely so the upsert can't wipe
  // a prior run's revenue (PostgREST only updates columns present in the payload).
  const revenueReport = await runGa4RevenueReport({ tenantId, propertyId, startDate, endDate });
  let revenueStatus: Ga4RevenuePersistStatus;
  let revByKey: Map<string, Ga4RevenueRow> | null = null;
  if (revenueReport.ok) {
    revByKey = new Map<string, Ga4RevenueRow>();
    for (const r of revenueReport.rows) revByKey.set(`${r.date} ${r.url}`, r);
    revenueStatus = {
      synced: true,
      rows_with_revenue: 0, // filled below as rows are built
      currency: revenueReport.currency,
      ...(revenueReport.truncated ? { truncated: true } : {}),
    };
  } else {
    revenueStatus = { synced: false, reason: revenueReport.reason, rows_with_revenue: 0, currency: null };
  }

  let rowsWithRevenue = 0;
  const upsertRows = report.rows.map((row: Ga4UrlTrafficRow) => {
    const base: Record<string, unknown> = {
      tenant_id: tenantId,
      url: normalizeGa4PagePathToFullUrl({ pagePath: row.url, domain }),
      date: row.date,
      sessions: row.sessions,
      engaged_sessions: row.engaged_sessions,
      conversions: row.conversions,
      last_synced_at: nowIso,
      raw: row,
      updated_at: nowIso,
    };
    if (revByKey != null) {
      const rev = revByKey.get(`${row.date} ${row.url}`);
      // Revenue call succeeded → this page's revenue is KNOWN. Absent from the
      // revenue rows = no purchases that day = OBSERVED 0 (not unknown).
      const total = rev?.totalRevenue ?? 0;
      const purchase = rev?.purchaseRevenue ?? 0;
      const txns = rev?.transactions ?? 0;
      if (purchase > 0 || total > 0) rowsWithRevenue += 1;
      base.total_revenue = total;
      base.purchase_revenue = purchase;
      base.transactions = txns;
      base.revenue_currency = revenueStatus.currency;
      base.revenue_source =
        rev?.purchaseRevenue != null
          ? "ga4_purchase_revenue"
          : rev?.totalRevenue != null
            ? "ga4_total_revenue"
            : null;
      base.revenue_synced_at = nowIso;
    }
    return base;
  });
  revenueStatus.rows_with_revenue = rowsWithRevenue;

  const { error } = await admin
    .from(TABLE)
    .upsert(upsertRows, { onConflict: "tenant_id,url,date" });

  if (error != null) {
    const message =
      typeof (error as { message?: unknown }).message === "string"
        ? ((error as { message?: string }).message as string)
        : "upsert failed";
    log.warn("[persist-ga4-url-traffic] upsert failed", {
      tenantId,
      rowsAttempted: upsertRows.length,
      error: message,
      code: (error as { code?: unknown }).code,
    });
    return {
      ok: false,
      reason: "persist_failed",
      message,
    };
  }

  // Honest operator signal: revenue fetch worked but the property reported NO
  // revenue anywhere in the window → likely no ecommerce configured.
  if (revenueStatus.synced && rowsWithRevenue === 0) {
    log.warn("[persist-ga4-url-traffic] GA4 property reported no revenue in window (no ecommerce?)", {
      tenantId,
      property: propertyId,
    });
  }

  return {
    ok: true,
    rows_fetched: rowsFetched,
    rows_upserted: upsertRows.length,
    startDate,
    endDate,
    ...(report.truncated ? { truncated: true } : {}),
    revenue: revenueStatus,
  };
}

/** Test-only export of internals. */
export const __testing = {
  TABLE,
  DEFAULT_LOOKBACK_DAYS,
  MAX_LOOKBACK_DAYS,
};
