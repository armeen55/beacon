/**
 * seasonal/archive-rollup (2026-07-02, master plan item 21) - permanent monthly
 * archive of GSC demand.
 *
 * GSC only serves ~16 months of history through the API; gsc_daily_rows syncs
 * daily detail but is bound by that same window going forward. This pass folds
 * gsc_daily_rows into gsc_monthly_archive, one row per (tenant, query, month),
 * so Beacon keeps demand history forever, independent of what Google will
 * still hand back.
 *
 * BOUNDED BY CONSTRUCTION: never one unbounded read. The daily-rows table is
 * read one calendar month at a time, and each month is paged in fixed-size
 * row chunks (PAGE_ROW_BUDGET), exactly the shape that avoided the /today
 * statement-timeout class (17MB/8.7k-row unbounded read) elsewhere in this
 * repo. A month with more rows than the loop can page in MAX_PAGES_PER_MONTH
 * logs loudly and moves on rather than hanging the cron.
 *
 * IDEMPOTENT: each month's aggregate REPLACES that month's rows in a single
 * upsert on the (tenant_id, query, month) primary key, so re-running the
 * rollup for a month it has already archived converges to the same numbers
 * (not a double-count) even if gsc_daily_rows changed underneath (e.g. GSC's
 * own late-finalization corrections).
 *
 * BACKFILL: on first run for a tenant, rolls up every month between the
 * earliest and latest gsc_daily_rows date. On subsequent runs, only the
 * current and prior calendar month are re-rolled (the two months GSC still
 * revises), which keeps the nightly pass cheap and self-healing without
 * re-reading months that will never change again.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

/** Rows per Supabase page read. PostgREST caps a single response at 1000 rows
 *  regardless of the requested range width, so the page size MUST be 1000 (a
 *  wider range silently truncates and the loop would think it hit the last
 *  page early, undercounting every month past the first 1000 rows - this
 *  matches the PAGE_SIZE convention every sibling paged loader in the repo
 *  uses, e.g. gsc-page-signals.ts, clarity-page-signals.ts). */
const PAGE_ROW_BUDGET = 1000;
/** Hard ceiling on pages read per month, per tenant: 200 pages x 1000 rows =
 *  200,000 rows/month, comfortably above a busy tenant's real monthly volume
 *  (Iranopedia runs ~50k rows/month). Defensive, not expected to be hit. */
const MAX_PAGES_PER_MONTH = 200;

export type MonthlyRollupRow = {
  tenant_id: string;
  query: string;
  month: string; // YYYY-MM-01
  impressions: number;
  clicks: number;
  top_page: string | null;
};

/** First day of the month containing `iso` (YYYY-MM-01). */
function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** First day of the month N months after `monthIso` (YYYY-MM-01), wrapping years. */
function addMonths(monthIso: string, n: number): string {
  const [y, m] = monthIso.slice(0, 7).split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Every month (YYYY-MM-01) from `start` through `end`, inclusive. */
export function monthsBetween(startIso: string, endIso: string): string[] {
  const start = monthStart(startIso);
  const end = monthStart(endIso);
  if (start > end) return [];
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 2400) {
    // 200 years of safety margin
    out.push(cur);
    cur = addMonths(cur, 1);
    guard += 1;
  }
  return out;
}

/** The first day AFTER the month (exclusive upper bound for a date range query). */
function monthEndExclusive(monthIso: string): string {
  return addMonths(monthIso, 1);
}

type DailyRow = { query: string | null; page: string | null; clicks: number | null; impressions: number | null };

type MonthAgg = { impressions: number; clicks: number; pages: Map<string, number> };

/**
 * Reads gsc_daily_rows for ONE tenant and ONE calendar month, in bounded
 * pages, and folds it into per-query aggregates. Fail-soft: a page read
 * error stops that month's read (partial data never gets treated as final -
 * caller skips writing on error to avoid archiving an undercount as truth).
 */
async function aggregateOneMonth(
  tenantId: string,
  monthIso: string,
): Promise<{ ok: boolean; byQuery: Map<string, MonthAgg> }> {
  const sb = getSupabaseAdmin();
  const since = monthIso;
  const until = monthEndExclusive(monthIso);
  const byQuery = new Map<string, MonthAgg>();

  for (let page = 0; page < MAX_PAGES_PER_MONTH; page += 1) {
    const from = page * PAGE_ROW_BUDGET;
    const to = from + PAGE_ROW_BUDGET - 1;
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("query, page, clicks, impressions")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .lt("date", until)
      .order("query")
      .range(from, to);
    if (error) {
      log.warn("[seasonal] monthly archive page read failed", { tenantId, month: monthIso, page, error: error.message });
      return { ok: false, byQuery };
    }
    const rows = (data ?? []) as DailyRow[];
    for (const r of rows) {
      const query = (r.query ?? "").trim();
      if (!query) continue;
      let agg = byQuery.get(query);
      if (!agg) {
        agg = { impressions: 0, clicks: 0, pages: new Map() };
        byQuery.set(query, agg);
      }
      const impr = Math.max(0, Number(r.impressions) || 0);
      agg.impressions += impr;
      agg.clicks += Math.max(0, Number(r.clicks) || 0);
      if (r.page) agg.pages.set(r.page, (agg.pages.get(r.page) ?? 0) + impr);
    }
    if (rows.length < PAGE_ROW_BUDGET) break; // last page for this month
    if (page === MAX_PAGES_PER_MONTH - 1) {
      log.warn("[seasonal] monthly archive hit page ceiling, month may be undercounted", { tenantId, month: monthIso });
    }
  }
  return { ok: true, byQuery };
}

function topPageOf(agg: MonthAgg): string | null {
  let best: string | null = null;
  let bestImpr = -1;
  for (const [page, impr] of agg.pages) {
    if (impr > bestImpr) {
      best = page;
      bestImpr = impr;
    }
  }
  return best;
}

/** Upserts one month's per-query aggregate rows for a tenant. Idempotent on
 *  the (tenant_id, query, month) primary key: re-running replaces the row. */
async function writeMonthRows(tenantId: string, monthIso: string, byQuery: Map<string, MonthAgg>): Promise<number> {
  if (byQuery.size === 0) return 0;
  const sb = getSupabaseAdmin();
  const rows: MonthlyRollupRow[] = [...byQuery.entries()].map(([query, agg]) => ({
    tenant_id: tenantId,
    query,
    month: monthIso,
    impressions: agg.impressions,
    clicks: agg.clicks,
    top_page: topPageOf(agg),
  }));
  // Batch the upsert in chunks so one PostgREST call never carries an
  // unbounded payload (a query-rich month could have thousands of distinct queries).
  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await sb.from("gsc_monthly_archive").upsert(chunk, { onConflict: "tenant_id,query,month" });
    if (error) {
      log.warn("[seasonal] monthly archive upsert failed", { tenantId, month: monthIso, error: error.message });
      continue;
    }
    written += chunk.length;
  }
  return written;
}

/** Earliest and latest gsc_daily_rows dates for a tenant, or null when the
 *  tenant has no synced GSC history yet. A cheap indexed min/max, not a full read. */
async function loadDateSpan(tenantId: string): Promise<{ earliest: string; latest: string } | null> {
  const sb = getSupabaseAdmin();
  const [earliestRes, latestRes] = await Promise.all([
    sb.from("gsc_daily_rows").select("date").eq("tenant_id", tenantId).order("date", { ascending: true }).limit(1),
    sb.from("gsc_daily_rows").select("date").eq("tenant_id", tenantId).order("date", { ascending: false }).limit(1),
  ]);
  const earliest = earliestRes.data?.[0]?.date as string | undefined;
  const latest = latestRes.data?.[0]?.date as string | undefined;
  if (!earliest || !latest) return null;
  return { earliest, latest };
}

/** Which months this tenant has already archived (so a first backfill run
 *  doesn't need to re-roll months it already has, and a normal run knows
 *  whether it has EVER run at all). */
async function loadArchivedMonths(tenantId: string): Promise<Set<string>> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("gsc_monthly_archive").select("month").eq("tenant_id", tenantId).limit(2400);
  if (error || !data) return new Set();
  return new Set(data.map((r) => String(r.month).slice(0, 10)));
}

export type ArchiveRollupResult = {
  ran: boolean;
  monthsRolled: string[];
  rowsWritten: number;
  isBackfill: boolean;
};

/**
 * Rolls up gsc_daily_rows into gsc_monthly_archive for one tenant. Bounded
 * (monthly-chunked reads, paged) and idempotent (upsert on the month PK).
 *
 * First run for a tenant (no archived months yet): backfills every month of
 * history present in gsc_daily_rows. Subsequent runs: only re-rolls the
 * current and prior calendar month (the window GSC still revises); older
 * months are already permanent and never re-read.
 */
export async function runMonthlyArchiveRollup(tenantId: string, now: Date = new Date()): Promise<ArchiveRollupResult> {
  if (!tenantId) return { ran: false, monthsRolled: [], rowsWritten: 0, isBackfill: false };

  const span = await loadDateSpan(tenantId);
  if (!span) return { ran: false, monthsRolled: [], rowsWritten: 0, isBackfill: false };

  const archived = await loadArchivedMonths(tenantId);
  const isBackfill = archived.size === 0;

  const nowMonth = monthStart(now.toISOString().slice(0, 10));
  const priorMonth = addMonths(nowMonth, -1);

  const targetMonths = isBackfill
    ? monthsBetween(span.earliest, span.latest)
    : monthsBetween(priorMonth, nowMonth).filter((m) => m >= monthStart(span.earliest) && m <= monthStart(span.latest));

  let rowsWritten = 0;
  const rolled: string[] = [];
  for (const month of targetMonths) {
    const { ok, byQuery } = await aggregateOneMonth(tenantId, month);
    if (!ok) continue; // never archive a partial read as if it were the truth
    const written = await writeMonthRows(tenantId, month, byQuery);
    rowsWritten += written;
    rolled.push(month);
  }

  return { ran: true, monthsRolled: rolled, rowsWritten, isBackfill };
}
