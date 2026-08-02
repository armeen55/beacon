import "server-only";

/**
 * refresh-runs-store (refresh-reliability wave, 2026-07-11, BUG 3) - the durable
 * source-by-source refresh ledger.
 *
 * EVERY refresh path records here through the ONE `recordRefreshRun` function:
 *   - the nightly cron (cron-sync.ts syncOneTenant),
 *   - the manual "Refresh my data" / per-source "Sync now" (settings actions),
 *   - the on-use auto-refresh (cron-sync.ts autoRefreshStaleConnectorsForTenant).
 *
 * Each call is ONE row per (tenant, source, trigger, run) with an HONEST result
 * (ok / partial / failed), the rows it persisted, the newest source data date
 * after the run, the failure category, and the next scheduled retry. This is
 * what closes the three probe findings: manual/on-use pulls now leave a row, a
 * per-source failure is named instead of hidden behind a run-level ok:true, and
 * a source that wrote 0 rows while claiming success reads as partial ("no new
 * data") rather than a clean success.
 *
 * Mirrors cron-runs-store.ts EXACTLY:
 *   - Service-role admin client; getSupabaseAdmin() throwing (no env, local dev)
 *     routes straight to the file mirror.
 *   - PGRST205 / 42P01 / PGRST204 (table not migrated in yet) also route to the
 *     file mirror, so deploy order (code before migration) can never break the
 *     sync this ledger observes.
 *   - Fail-soft by contract: recordRefreshRun NEVER throws. A ledger write
 *     failure must never fail the sync/refresh it is trying to record.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

const TABLE = "refresh_runs";
const STORE = "refresh-runs";

/** How many rows the file-fallback mirror keeps per tenant (bounded so a
 *  pre-migration window can't grow the file forever). */
const MAX_FILE_ROWS_PER_TENANT = 400;

/** The read sources a refresh can pull. Wix is publish-only (never pulls). */
export type RefreshSource = "gsc" | "ga4" | "clarity";

/** What kicked off the refresh. All three converge on recordRefreshRun. */
export type RefreshTrigger = "cron" | "manual" | "on-use";

/** Honest per-source outcome. `partial` = it claimed success but delivered no
 *  new data; `failed` = it did not sync. */
export type RefreshResult = "ok" | "partial" | "failed";

type RefreshRunInput = {
  tenantId: string;
  source: RefreshSource;
  trigger: RefreshTrigger;
  startedAt: string;
  finishedAt: string;
  result: RefreshResult;
  /** Rows written this run, null when the engine doesn't cheaply report it. */
  rowsPersisted?: number | null;
  /** Newest source data date after the run (YYYY-MM-DD), null when unknown. */
  latestDataDate?: string | null;
  /** Honest reason code when result !== "ok" (e.g. gsc_auth_transient,
   *  no new data, token_expired). */
  failureCategory?: string | null;
  /** When Beacon will retry on its own; null for operator-driven triggers. */
  nextRetryAt?: string | null;
};

export type RefreshRunRow = {
  id: string;
  tenant_id: string;
  source: RefreshSource;
  trigger: RefreshTrigger;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: RefreshResult;
  rows_persisted: number | null;
  latest_data_date: string | null;
  failure_category: string | null;
  next_retry_at: string | null;
  created_at: string;
};

type FileRow = RefreshRunRow;

function isMissingTable(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (
    typeof e.code === "string" &&
    (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204")
  ) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    /schema cache|could not find the table/i.test(e.message)
  );
}

function durationMs(startedAt: string, finishedAt: string): number {
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

/** PURE: fold a run's inputs into the persisted row shape (testable, no I/O). */
function buildRefreshRunRow(
  input: RefreshRunInput,
  id: string,
  now: Date = new Date(),
): RefreshRunRow {
  return {
    id,
    tenant_id: input.tenantId,
    source: input.source,
    trigger: input.trigger,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    duration_ms: durationMs(input.startedAt, input.finishedAt),
    result: input.result,
    rows_persisted: input.rowsPersisted ?? null,
    latest_data_date: input.latestDataDate ?? null,
    failure_category: input.failureCategory ?? null,
    next_retry_at: input.nextRetryAt ?? null,
    created_at: now.toISOString(),
  };
}

/**
 * PURE: classify one sync engine's return value into the honest ledger result.
 *
 * Every read-sync engine returns `{ synced: false, reason } | { synced: true,
 * ...counts }`. A not-synced result is `failed` with the engine's reason as the
 * failure category. A synced result is `ok`. GSC/GA4/Clarity incremental pulls
 * legitimately write 0 rows on a quiet night (nothing new past the watermark),
 * so a 0-row success stays `ok` - the honest staleness signal is
 * `latest_data_date`, recorded separately. (`partial` remains a valid result
 * for historical ledger rows.)
 */
export function classifyRefreshOutcome(
  source: RefreshSource,
  value: unknown,
): { result: RefreshResult; rowsPersisted: number | null; failureCategory: string | null } {
  const synced =
    typeof value === "object" &&
    value !== null &&
    "synced" in value &&
    (value as { synced?: unknown }).synced === true;

  if (!synced) {
    const reason =
      typeof value === "object" &&
      value !== null &&
      "reason" in value &&
      typeof (value as { reason?: unknown }).reason === "string"
        ? (value as { reason: string }).reason
        : "sync reported not-synced";
    return { result: "failed", rowsPersisted: null, failureCategory: reason };
  }

  const rows = rowsPersistedOf(source, value);
  return { result: "ok", rowsPersisted: rows, failureCategory: null };
}

/** Pull the rows-written count from an engine's success value. GSC/GA4/Clarity
 *  all expose `rows_upserted`. */
function rowsPersistedOf(_source: RefreshSource, value: unknown): number | null {
  const v = value as Record<string, unknown>;
  return typeof v.rows_upserted === "number" ? (v.rows_upserted as number) : null;
}

/** How many consecutive FAILED runs for one source escalate the connector card
 *  from the gentle "I will try again on my own" to a needs-attention state
 *  (2026-07-20). Counts ANY trigger (cron/manual/on-use), unlike the cron-only
 *  auth escalation — with the nightly cron disabled, on-use is the only path
 *  left, so a cron-only streak can never fire. 3 strikes = a durable failure,
 *  not a one-off blip. */
const SYNC_FAILURE_ESCALATION_MIN_STREAK = 3;

/**
 * PURE: given a source's PRIOR refresh rows (any trigger, NEWEST FIRST) and the
 * outcome of the run that just finished, decide whether the consecutive
 * same-source failure streak has reached the escalation threshold.
 *
 * The just-finished run is passed separately because the caller evaluates this
 * BEFORE its own ledger row is written (the on-use path records the row after
 * the sync returns). Counts that run plus the leading run of prior FAILED rows;
 * any `ok`/`partial` prior run breaks the streak (the source reached data, so
 * it is not silently broken). `since` is the started_at of the last good run
 * before the streak, else the oldest failing run — for "not synced since <date>"
 * copy. Returns `daysStale` from that `since` for "not synced in N days" copy.
 */
export function deriveSyncFailureEscalation(
  priorRowsNewestFirst: ReadonlyArray<Pick<RefreshRunRow, "started_at" | "result">>,
  justFinished: { result: RefreshResult; startedAt: string },
  now: Date = new Date(),
  opts: { minStreak?: number } = {},
): { escalate: boolean; since: string | null; streak: number; daysStale: number } {
  const minStreak = opts.minStreak ?? SYNC_FAILURE_ESCALATION_MIN_STREAK;
  if (justFinished.result !== "failed") {
    return { escalate: false, since: null, streak: 0, daysStale: 0 };
  }

  let streak = 1; // the run that just failed
  let i = 0;
  while (i < priorRowsNewestFirst.length && priorRowsNewestFirst[i]!.result === "failed") {
    streak += 1;
    i += 1;
  }

  const lastGood = priorRowsNewestFirst[i]; // first non-failed after the streak
  const oldestFailing = i > 0 ? priorRowsNewestFirst[i - 1]!.started_at : justFinished.startedAt;
  const since = lastGood != null ? lastGood.started_at : oldestFailing;

  const sinceMs = Date.parse(since);
  const daysStale = Number.isFinite(sinceMs)
    ? Math.max(0, Math.floor((now.getTime() - sinceMs) / (24 * 60 * 60 * 1000)))
    : 0;

  return { escalate: streak >= minStreak, since, streak, daysStale };
}

async function readFile(): Promise<FileRow[]> {
  try {
    return (await readStore<FileRow>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

async function writeFileRow(row: FileRow): Promise<void> {
  try {
    const rows = await readFile();
    const sameTenant = rows.filter((r) => r.tenant_id === row.tenant_id);
    const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
    const nextForTenant = [...sameTenant, row]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, MAX_FILE_ROWS_PER_TENANT);
    await writeStore(STORE, [...others, ...nextForTenant]);
  } catch (e) {
    log.warn("[refresh-runs-store] file mirror write failed", {
      tenantId: row.tenant_id,
      source: row.source,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Record one source refresh. FAIL-SOFT BY CONTRACT: never throws. A ledger
 * write failure (bad env, missing table pre-migration, a Supabase outage) must
 * never fail the sync/refresh it is observing - this function absorbs every
 * error itself.
 */
export async function recordRefreshRun(input: RefreshRunInput): Promise<void> {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${input.tenantId}-${input.source}-${input.startedAt}-${Math.random().toString(36).slice(2)}`;
  const row = buildRefreshRunRow(input, id);

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await writeFileRow(row); // no Supabase env (e.g. local dev) -> file only
    return;
  }

  try {
    const { error } = await admin.from(TABLE).insert({
      tenant_id: row.tenant_id,
      source: row.source,
      trigger: row.trigger,
      started_at: row.started_at,
      finished_at: row.finished_at,
      duration_ms: row.duration_ms,
      result: row.result,
      rows_persisted: row.rows_persisted,
      latest_data_date: row.latest_data_date,
      failure_category: row.failure_category,
      next_retry_at: row.next_retry_at,
    });
    if (error != null) {
      if (isMissingTable(error)) {
        console.warn(
          `[refresh-runs-store] table not migrated yet, falling back to file (apply migrations/2026-07-11_refresh_runs.sql): ${
            (error as { code?: string }).code ?? "?"
          } ${(error as { message?: string }).message ?? String(error)}`,
        );
        await writeFileRow(row);
        return;
      }
      log.warn("[refresh-runs-store] insert failed", {
        tenantId: row.tenant_id,
        source: row.source,
        error: error.message ?? String(error),
      });
      await writeFileRow(row);
      return;
    }
  } catch (e) {
    log.warn("[refresh-runs-store] insert threw", {
      tenantId: row.tenant_id,
      source: row.source,
      error: e instanceof Error ? e.message : String(e),
    });
    await writeFileRow(row);
  }
}

function mapRow(r: Record<string, unknown>): RefreshRunRow {
  return {
    id: String(r.id),
    tenant_id: String(r.tenant_id),
    source: r.source as RefreshSource,
    trigger: r.trigger as RefreshTrigger,
    started_at: String(r.started_at),
    finished_at: String(r.finished_at),
    duration_ms: Number(r.duration_ms ?? 0),
    result: r.result as RefreshResult,
    rows_persisted: r.rows_persisted == null ? null : Number(r.rows_persisted),
    latest_data_date: (r.latest_data_date as string | null) ?? null,
    failure_category: (r.failure_category as string | null) ?? null,
    next_retry_at: (r.next_retry_at as string | null) ?? null,
    created_at: String(r.created_at ?? r.started_at),
  };
}

/** Most recent refresh rows for a tenant (optionally one source), newest first.
 *  Fail-soft -> []. Supabase first, file mirror fallback. */
export async function listRecentRefreshRuns(
  tenantId: string,
  opts: { source?: RefreshSource; limit?: number } = {},
): Promise<RefreshRunRow[]> {
  const limit = opts.limit ?? 50;
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return filterFileRows(await readFile(), tenantId, opts.source, limit);
  }
  try {
    let q = admin
      .from(TABLE)
      .select("*")
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (opts.source != null) q = q.eq("source", opts.source);
    const { data, error } = await q;
    if (error != null) {
      if (isMissingTable(error)) {
        return filterFileRows(await readFile(), tenantId, opts.source, limit);
      }
      log.warn("[refresh-runs-store] list failed", {
        tenantId,
        error: error.message ?? String(error),
      });
      return [];
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapRow);
  } catch (e) {
    log.warn("[refresh-runs-store] list threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return filterFileRows(await readFile(), tenantId, opts.source, limit);
  }
}

function filterFileRows(
  rows: FileRow[],
  tenantId: string,
  source: RefreshSource | undefined,
  limit: number,
): RefreshRunRow[] {
  return rows
    .filter((r) => r.tenant_id === tenantId && (source == null || r.source === source))
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, limit);
}

/** The latest row per source for one tenant - what the /settings/connectors
 *  per-source strip reads ("last pulled / data through / result"). Fail-soft. */
export async function latestRefreshBySource(
  tenantId: string,
): Promise<Partial<Record<RefreshSource, RefreshRunRow>>> {
  const rows = await listRecentRefreshRuns(tenantId, { limit: 200 });
  const out: Partial<Record<RefreshSource, RefreshRunRow>> = {};
  for (const r of rows) {
    // rows are newest-first, so the first seen per source is the latest.
    if (out[r.source] == null) out[r.source] = r;
  }
  return out;
}

export const __testing = { isMissingTable, durationMs, rowsPersistedOf };
