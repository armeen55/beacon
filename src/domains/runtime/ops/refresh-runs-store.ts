import "server-only";

/**
 * refresh-runs-store (refresh-reliability wave, 2026-07-11, BUG 3) - the durable
 * source-by-source refresh ledger.
 *
 * EVERY refresh path records here through the ONE `recordRefreshRun` function: the nightly cron (cron-sync syncOneTenant), the
 * manual "Refresh my data" and per-source "Sync now" (settings actions), and the on-use auto-refresh
 * (autoRefreshStaleConnectorsForTenant). Each call is ONE row per (tenant, source, trigger, run) with an HONEST result (ok, partial
 * or failed), the rows it persisted, the newest source data date after the run, the failure category and the next scheduled retry.
 * That is what closed three probe findings at once: manual and on-use pulls leave a row, a per-source failure is named instead of
 * hidden behind a run-level ok:true, and a source that wrote zero rows while claiming success reads as partial ("no new data").
 *
 * Writes use the canonical service-role database client. Fail-soft by contract: recordRefreshRun NEVER throws;
 * a ledger failure is reported without claiming persistence or failing the source refresh it observes.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

const TABLE = "refresh_runs";

/** The read sources a refresh can pull. */
export type RefreshSource = "gsc" | "ga4" | "clarity";

/** What kicked off the refresh. All three converge on recordRefreshRun. */
export type RefreshTrigger = "cron" | "manual" | "on-use";

/** Honest per-source outcome. `partial` = usable rows with incomplete coverage;
 *  `failed` = it did not sync. */
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
  if (source === "ga4" && typeof value === "object" && value !== null &&
      "reason" in value && (value as { reason?: unknown }).reason === "partial_report") {
    return { result: "partial", rowsPersisted: rowsPersistedOf(source, value), failureCategory: "partial_report" };
  }
  if (source === "ga4" && typeof value === "object" && value !== null &&
      "reason" in value && (value as { reason?: unknown }).reason === "partial_report_held") {
    return { result: "partial", rowsPersisted: null, failureCategory: "partial_report_held" };
  }
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
 *  auth escalation - with the nightly cron disabled, on-use is the only path
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
 * before the streak, else the oldest failing run - for "not synced since <date>"
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
  } catch (e) {
    log.warn("[refresh-runs-store] database unavailable", { tenantId: row.tenant_id, source: row.source, error: e instanceof Error ? e.message : String(e) });
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
      log.warn("[refresh-runs-store] insert failed", {
        tenantId: row.tenant_id,
        source: row.source,
        error: error.message ?? String(error),
      });
      return;
    }
  } catch (e) {
    log.warn("[refresh-runs-store] insert threw", {
      tenantId: row.tenant_id,
      source: row.source,
      error: e instanceof Error ? e.message : String(e),
    });
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

/** Most recent SQL refresh rows for a tenant; strict callers refuse unavailable history. */
export async function listRecentRefreshRuns(
  tenantId: string,
  opts: { source?: RefreshSource; limit?: number; strict?: boolean } = {},
): Promise<RefreshRunRow[]> {
  const limit = opts.limit ?? 50;
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    if (opts.strict) throw new Error("refresh history unavailable");
    return [];
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
    if (error != null || !Array.isArray(data) || data.some(row => !row || typeof row !== "object" || Array.isArray(row) || row.tenant_id !== tenantId || !((typeof row.id === "string" && row.id.trim()) || (typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0)))) {
      if (opts.strict) throw new Error("refresh history unavailable");
      log.warn("[refresh-runs-store] list failed", {
        tenantId,
        error: error?.message ?? "malformed refresh history",
      });
      return [];
    }
    return (data as Array<Record<string, unknown>>).map(mapRow);
  } catch (e) {
    if (opts.strict) throw e;
    log.warn("[refresh-runs-store] list threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
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
