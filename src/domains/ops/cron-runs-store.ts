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

/**
 * A run's lifecycle phase (2026-07-12 invocation-receipt pattern):
 *   - "running":  a row INSERTED the moment a cron route is invoked, before any
 *     work runs. Proves the job was actually reached (not "Vercel never fired
 *     it"). Never counted as a success or a failure by any reader.
 *   - "finished": the same row UPDATED in place at completion (or a one-shot
 *     recordCronRun row). This is the completed outcome readers score.
 * Rows written before this column existed (all written at completion) read as
 * "finished", which is exactly what they are - no backfill needed.
 */
export type CronRunPhase = "running" | "finished";

function mapPhase(v: unknown): CronRunPhase {
  return v === "running" ? "running" : "finished";
}

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
  /** Lifecycle phase. Absent on rows written before the column existed -> read
   *  as "finished" (they were all written at completion). */
  phase: CronRunPhase;
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
    phase: "finished",
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

export type CronRunStorage = "supabase" | "file";

/**
 * Handle returned by beginCronRun and passed to finishCronRun to update the
 * SAME invocation row in place. Carries where the row lives so finish writes
 * back to the store begin wrote to (a Supabase row id, or the file-mirror id).
 */
export type CronRunHandle = {
  storage: CronRunStorage;
  id: string;
  job: string;
  tenantId: string | null;
  startedAt: string;
};

function newId(job: string, startedAt: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${job}-${startedAt}-${Math.random().toString(36).slice(2)}`;
}

function runningFileRow(handle: CronRunHandle, notes: Record<string, unknown>): FileRow {
  return {
    id: handle.id,
    tenant_id: handle.tenantId,
    job: handle.job,
    started_at: handle.startedAt,
    finished_at: handle.startedAt, // placeholder until finish overwrites it
    duration_ms: 0,
    ok: false,
    per_source: [],
    notes,
    created_at: new Date().toISOString(),
    phase: "running",
  };
}

/**
 * INSERT a "started" receipt the MOMENT a cron route is invoked, before any
 * work runs. This is what lets a reader tell "Vercel never fired this job"
 * (no row at all) apart from "the job was invoked but died mid-run" (a running
 * row that never became finished). Returns a handle finishCronRun updates in
 * place at completion. FAIL-SOFT BY CONTRACT: never throws - a receipt-write
 * failure must never block the run it observes. A missing table OR a missing
 * `phase` column (pre-migration) routes to the file mirror, exactly like
 * recordCronRun, so deploy order (code before migration) can never break the
 * crons this ledger watches.
 */
export async function beginCronRun(input: {
  job: string;
  tenantId?: string | null;
  startedAt?: string;
  notes?: Record<string, unknown>;
}): Promise<CronRunHandle> {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const tenantId = input.tenantId ?? null;
  const notes = input.notes ?? {};
  const fileId = newId(input.job, startedAt);
  const fileHandle: CronRunHandle = {
    storage: "file",
    id: fileId,
    job: input.job,
    tenantId,
    startedAt,
  };

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await writeFileRow(runningFileRow(fileHandle, notes)); // no Supabase env -> file only
    return fileHandle;
  }

  try {
    const { data, error } = await admin
      .from(TABLE)
      .insert({
        tenant_id: tenantId,
        job: input.job,
        started_at: startedAt,
        finished_at: startedAt, // placeholder; finishCronRun overwrites it
        duration_ms: 0,
        ok: false,
        per_source: [],
        notes,
        phase: "running",
      })
      .select("id")
      .single();
    if (error != null) {
      if (isMissingTable(error)) {
        // Table or the phase column is not migrated in yet: record the started
        // receipt in the file mirror so deploy order can never lose it.
        await writeFileRow(runningFileRow(fileHandle, notes));
        return fileHandle;
      }
      log.warn("[cron-runs-store] begin insert failed", {
        job: input.job,
        error: error.message ?? String(error),
      });
      await writeFileRow(runningFileRow(fileHandle, notes));
      return fileHandle;
    }
    const dbId =
      data != null && typeof data === "object" && "id" in data
        ? String((data as { id: unknown }).id)
        : fileId;
    return { storage: "supabase", id: dbId, job: input.job, tenantId, startedAt };
  } catch (e) {
    log.warn("[cron-runs-store] begin insert threw", {
      job: input.job,
      error: e instanceof Error ? e.message : String(e),
    });
    await writeFileRow(runningFileRow(fileHandle, notes));
    return fileHandle;
  }
}

type FinishPatch = {
  finished_at: string;
  duration_ms: number;
  ok: boolean;
  per_source: CronRunSourceResult[];
  notes: Record<string, unknown>;
  phase: CronRunPhase;
};

/**
 * UPDATE the started receipt in place at completion (ok, duration, per_source,
 * notes, phase -> "finished"). FAIL-SOFT BY CONTRACT: never throws. On a
 * Supabase update error the finished outcome is still mirrored to the file so
 * the run is never lost.
 */
export async function finishCronRun(
  handle: CronRunHandle,
  result: {
    ok: boolean;
    perSource: ReadonlyArray<CronRunSourceResult>;
    notes?: Record<string, unknown>;
    finishedAt?: string;
  },
): Promise<void> {
  const finishedAt = result.finishedAt ?? new Date().toISOString();
  const patch: FinishPatch = {
    finished_at: finishedAt,
    duration_ms: durationMs(handle.startedAt, finishedAt),
    ok: result.ok,
    per_source: [...result.perSource],
    notes: result.notes ?? {},
    phase: "finished",
  };

  if (handle.storage === "file") {
    await finishFileRow(handle, patch);
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await finishFileRow(handle, patch); // env vanished mid-run -> mirror
    return;
  }
  try {
    const { error } = await admin.from(TABLE).update(patch).eq("id", handle.id);
    if (error != null) {
      if (!isMissingTable(error)) {
        log.warn("[cron-runs-store] finish update failed", {
          job: handle.job,
          error: error.message ?? String(error),
        });
      }
      await finishFileRow(handle, patch); // best-effort mirror so the run isn't lost
      return;
    }
  } catch (e) {
    log.warn("[cron-runs-store] finish update threw", {
      job: handle.job,
      error: e instanceof Error ? e.message : String(e),
    });
    await finishFileRow(handle, patch);
  }
}

/** Update the file-mirror started row in place (or append a finished row when
 *  begin never reached the mirror). Fail-soft: never throws. */
async function finishFileRow(handle: CronRunHandle, patch: FinishPatch): Promise<void> {
  try {
    const rows = await readFile();
    const idx = rows.findIndex((r) => r.id === handle.id && r.job === handle.job);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx]!, ...patch };
    } else {
      rows.push({
        id: handle.id,
        tenant_id: handle.tenantId,
        job: handle.job,
        started_at: handle.startedAt,
        created_at: new Date().toISOString(),
        ...patch,
      });
    }
    // Same per-job bound writeFileRow applies (newest first, capped).
    const byJob = new Map<string, FileRow[]>();
    for (const r of rows) {
      if (!byJob.has(r.job)) byJob.set(r.job, []);
      byJob.get(r.job)!.push(r);
    }
    const out: FileRow[] = [];
    for (const list of byJob.values()) {
      out.push(
        ...list
          .sort((a, b) => b.started_at.localeCompare(a.started_at))
          .slice(0, MAX_FILE_ROWS_PER_JOB),
      );
    }
    await writeStore(STORE, out);
  } catch (e) {
    log.warn("[cron-runs-store] file mirror finish failed", {
      job: handle.job,
      error: e instanceof Error ? e.message : String(e),
    });
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
      phase: mapPhase(r.phase),
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
    .slice(0, limit)
    // Older mirror rows predate the phase field; normalize so every reader can
    // rely on it being present (missing -> "finished", they were completed runs).
    .map((r) => ({ ...r, phase: mapPhase(r.phase) }));
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
