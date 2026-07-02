import "server-only";

/**
 * cron-runs-store (BEACON_500 item 85, 2026-07-03) - durable ledger for every
 * nightly job run. `syncAllConnectedForActiveTenants` (cron-sync.ts) and the
 * measure-due runner compute rich per-run results that used to only hit
 * log.info and vanish once Vercel rotated the function logs. This store
 * gives them one row per run in `cron_runs` (migrations/2026-07-03_cron_runs.sql)
 * so the health panel on /settings/connectors, and item 84's failure-streak +
 * token-expiry escalation, have something durable to read.
 *
 * Mirrors shipped-change-store.ts / outreach-store.ts EXACTLY:
 *   - Service-role admin client; `getSupabaseAdmin()` throwing (no env, e.g.
 *     local dev) routes straight to the file mirror.
 *   - PGRST205 / 42P01 / PGRST204 (table or column not migrated in yet) also
 *     routes to the file mirror - so deploy order (code merges before the
 *     migration is applied) can never break the sync this ledger watches.
 *   - Fail-soft by contract: `recordCronRun` NEVER throws. A ledger write
 *     failure must never fail the sync/measure run it is trying to observe.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

const TABLE = "cron_runs";
const STORE = "cron-runs";

/** How many runs per job the file-fallback mirror keeps (bounded so a
 *  pre-migration window on a busy nightly cron can't grow the file forever). */
const MAX_FILE_ROWS_PER_JOB = 200;

export type CronRunSourceResult = {
  tenantId: string | null;
  provider: string;
  ok: boolean;
  detail: string;
};

export type CronRunInput = {
  /** Stable job identifier, e.g. "sync-connectors", "measure-due". */
  job: string;
  /** Null for a fleet-level row (the common case - one cron invocation fans
   *  out across every active tenant and this row IS the whole run). */
  tenantId?: string | null;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  perSource: ReadonlyArray<CronRunSourceResult>;
  notes?: Record<string, unknown>;
};

export type CronRunRow = {
  id: string;
  tenant_id: string | null;
  job: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  ok: boolean;
  per_source: CronRunSourceResult[];
  notes: Record<string, unknown>;
  created_at: string;
};

type FileRow = CronRunRow;

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

/** PURE: fold a run's inputs into the persisted row shape (testable without I/O). */
export function buildCronRunRow(input: CronRunInput, id: string, now: Date = new Date()): CronRunRow {
  return {
    id,
    tenant_id: input.tenantId ?? null,
    job: input.job,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    duration_ms: durationMs(input.startedAt, input.finishedAt),
    ok: input.ok,
    per_source: [...input.perSource],
    notes: input.notes ?? {},
    created_at: now.toISOString(),
  };
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
    const sameJob = rows.filter((r) => r.job === row.job);
    const others = rows.filter((r) => r.job !== row.job);
    const nextForJob = [...sameJob, row]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, MAX_FILE_ROWS_PER_JOB);
    await writeStore(STORE, [...others, ...nextForJob]);
  } catch (e) {
    // The file mirror is itself a fallback - if IT fails too, log and move on.
    // recordCronRun's caller must never see this throw.
    log.warn("[cron-runs-store] file mirror write failed", {
      job: row.job,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Record one job run. FAIL-SOFT BY CONTRACT: never throws. A ledger write
 * failure (bad env, missing table pre-migration, a Supabase outage) must
 * never fail the sync/measure run it is trying to observe - the caller
 * wraps nothing; this function absorbs every error itself.
 */
export async function recordCronRun(input: CronRunInput): Promise<void> {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${input.job}-${input.startedAt}-${Math.random().toString(36).slice(2)}`;
  const row = buildCronRunRow(input, id);

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
      job: row.job,
      started_at: row.started_at,
      finished_at: row.finished_at,
      duration_ms: row.duration_ms,
      ok: row.ok,
      per_source: row.per_source,
      notes: row.notes,
    });
    if (error != null) {
      if (isMissingTable(error)) {
        console.warn(
          `[cron-runs-store] table not migrated yet, falling back to file (apply migrations/2026-07-03_cron_runs.sql): ${
            (error as { code?: string }).code ?? "?"
          } ${(error as { message?: string }).message ?? String(error)}`,
        );
        await writeFileRow(row);
        return;
      }
      log.warn("[cron-runs-store] insert failed", {
        job: row.job,
        error: error.message ?? String(error),
      });
      // Best-effort: still mirror to the file so the run isn't lost entirely.
      await writeFileRow(row);
      return;
    }
  } catch (e) {
    log.warn("[cron-runs-store] insert threw", {
      job: row.job,
      error: e instanceof Error ? e.message : String(e),
    });
    await writeFileRow(row);
  }
}

/** Most recent runs for a job, newest first. Fail-soft -> []. Reads Supabase
 *  first (durable source of truth); falls back to the file mirror when the
 *  table isn't migrated in yet or there's no Supabase env. */
export async function listRecentCronRuns(job: string, limit = 30): Promise<CronRunRow[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return sortAndLimit(await readFile(), job, limit);
  }

  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("*")
      .eq("job", job)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error != null) {
      if (isMissingTable(error)) return sortAndLimit(await readFile(), job, limit);
      log.warn("[cron-runs-store] list failed", { job, error: error.message ?? String(error) });
      return [];
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      tenant_id: (r.tenant_id as string | null) ?? null,
      job: String(r.job),
      started_at: String(r.started_at),
      finished_at: String(r.finished_at),
      duration_ms: Number(r.duration_ms ?? 0),
      ok: r.ok === true,
      per_source: Array.isArray(r.per_source) ? (r.per_source as CronRunSourceResult[]) : [],
      notes: (r.notes as Record<string, unknown>) ?? {},
      created_at: String(r.created_at ?? r.started_at),
    }));
  } catch (e) {
    log.warn("[cron-runs-store] list threw", { job, error: e instanceof Error ? e.message : String(e) });
    return sortAndLimit(await readFile(), job, limit);
  }
}

function sortAndLimit(rows: FileRow[], job: string, limit: number): CronRunRow[] {
  return rows
    .filter((r) => r.job === job)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, limit);
}

/** Every distinct job name the ledger has ever recorded (Supabase first,
 *  file fallback). Used by the health panel to render one section per job
 *  without hardcoding the job list twice. Fail-soft -> []. */
export async function listKnownJobs(): Promise<string[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    const rows = await readFile();
    return Array.from(new Set(rows.map((r) => r.job)));
  }
  try {
    const { data, error } = await admin.from(TABLE).select("job").limit(1000);
    if (error != null) {
      if (isMissingTable(error)) {
        const rows = await readFile();
        return Array.from(new Set(rows.map((r) => r.job)));
      }
      return [];
    }
    return Array.from(new Set(((data ?? []) as Array<{ job: string }>).map((r) => r.job)));
  } catch {
    return [];
  }
}

export const __testing = { isMissingTable, durationMs };
