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
 *   `computeRefreshDateRange(latestStoredDate, now)`, exported for unit
 *   testing. A watermark, not a rewrite (2026-09-14): a cold start pulls
 *   the full 420 day retention window once; every later sync pulls from
 *   the newest stored date minus 7 days (GA4 restates recent days) to
 *   today, so an hourly sync moves tens of rows, not ~27,000. The revenue
 *   report shares the same window.
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
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { getTenant, websiteOf } from "@/domains/account";
import { runGa4RevenueReport, runGa4UrlTrafficReport } from "./data-api";
import { normalizeGa4PagePathToFullUrl } from "./normalize-page-path";
import type { Ga4FailReason, Ga4RevenueRow, Ga4UrlTrafficRow } from "./types";

const TABLE = "ga4_url_traffic";

/**
 * Max rows per upsert round-trip (2026-07-20 — GA4 persist_failed root cause).
 *
 * The full-window pull is ~27,000 rows for a mature property (420-day window ×
 * hundreds of URLs). Sending that as ONE PostgREST upsert made a single heavy
 * `INSERT … ON CONFLICT DO UPDATE` statement that, under the on-use path's
 * concurrency (three source syncs in parallel + a page-load's read fan-out on a
 * small compute instance), routinely exceeded the Postgres statement timeout —
 * Postgres canceled it ("canceling statement due to statement timeout"), which
 * PostgREST surfaced as an error and we stamped `persist_failed`. Only the idle
 * nightly cron ever squeaked under the limit, so GA4 data went stale the moment
 * crons stopped. Chunking keeps every statement small (sub-second even under
 * load), so no single upsert can trip the timeout. 1,000 balances round-trips
 * (~27 calls) against per-statement cost. Tunable; do not raise past a few
 * thousand without re-checking the timeout margin.
 */
const UPSERT_CHUNK_SIZE = 1000;

/** Pure: split an array into fixed-size chunks (last chunk may be smaller). */
function chunk<T>(rows: ReadonlyArray<T>, size: number): T[][] {
  if (size <= 0) return [rows.slice()];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Cold-start lookback: ~14 months, GA4's standard data-retention max, so the first pull holds the FULL history the property has. Requesting beyond retention simply yields no rows (harmless). */
const COLD_START_LOOKBACK_DAYS = 420;

/** GA4 restates the most recent days as late hits and processing settle, so a watermarked pull re-reads this many days behind the newest stored date. */
const RESTATE_DAYS = 7;

const ONE_DAY_MS = 86_400_000;

/**
 * Persist helper args. All fields required; `tenantId` and
 * `propertyId` thread tenant scope explicitly.
 */
type PersistGa4UrlTrafficArgs = {
  tenantId: string;
  propertyId: string;
  startDate: string;
  endDate: string;
};

/**
 * Failure-reason superset: Data API reasons + persist-side reasons.
 * Mirrors the substrate's discriminator style.
 */
type PersistGa4UrlTrafficFailReason =
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
type PersistGa4UrlTrafficResult =
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
 * The [startDate, endDate] window for one refresh run, from the newest date
 * already stored for the tenant (null on a cold start). Pure; exported for
 * unit testing.
 *
 *   • endDate = today (UTC, YYYY-MM-DD).
 *   • No stored date: [today − 420d, today] (the one full pull).
 *   • Otherwise: [stored − 7d, today], never earlier than today − 420d and
 *     never later than today (a stored date past today, from a clock
 *     oddity, still re-reads today).
 */
export function computeRefreshDateRange(
  latestStoredDate: string | null,
  now: Date,
): { startDate: string; endDate: string } {
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const floorMs = todayUtcMs - COLD_START_LOOKBACK_DAYS * ONE_DAY_MS;
  const storedMs = latestStoredDate ? Date.parse(latestStoredDate.slice(0, 10)) : NaN;
  const startMs = Number.isFinite(storedMs)
    ? Math.min(todayUtcMs, Math.max(floorMs, storedMs - RESTATE_DAYS * ONE_DAY_MS))
    : floorMs;
  return { startDate: isoDateUtc(startMs), endDate: isoDateUtc(todayUtcMs) };
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
  // Canonical Website: the Account row owns the one domain.
  const account = await getTenant(tenantId).catch(() => null);
  const domain = account ? websiteOf(account).domain : "";
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
    for (const r of revenueReport.rows) revByKey.set(`${r.date}\u0000${r.url}`, r);
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
      const rev = revByKey.get(`${row.date}\u0000${row.url}`);
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

  // Chunked upsert (2026-07-20). One giant statement tripped the Postgres
  // statement timeout under the on-use path's concurrency; small batches each
  // finish well inside the limit. Sequential (not parallel) so we never fan a
  // burst of heavy writes at the same small instance we are trying to protect.
  // A batch error stops immediately and reports persist_failed honestly with
  // how many rows had already landed — the next run re-upserts idempotently.
  let rowsUpserted = 0;
  for (const batch of chunk(upsertRows, UPSERT_CHUNK_SIZE)) {
    const { error } = await admin
      .from(TABLE)
      .upsert(batch, { onConflict: "tenant_id,url,date" });

    if (error != null) {
      const message =
        typeof (error as { message?: unknown }).message === "string"
          ? ((error as { message?: string }).message as string)
          : "upsert failed";
      log.warn("[persist-ga4-url-traffic] upsert failed", {
        tenantId,
        rowsAttempted: upsertRows.length,
        rowsUpsertedBeforeFailure: rowsUpserted,
        batchSize: batch.length,
        error: message,
        code: (error as { code?: unknown }).code,
      });
      return {
        ok: false,
        reason: "persist_failed",
        message,
      };
    }
    rowsUpserted += batch.length;
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
    rows_upserted: rowsUpserted,
    startDate,
    endDate,
    ...(report.truncated ? { truncated: true } : {}),
    revenue: revenueStatus,
  };
}

