/**
 * URL watcher state file — mirrors the scan-state.ts convention.
 *
 * Tracks when the URL watcher last refreshed citation history + experiment
 * metrics so `/changes` and `/` page loads know whether to trigger another
 * refresh or serve cached data.
 *
 * Throttle: 6 hours. Rationale — Profound import cadence is daily at best;
 * 6h balances responsiveness vs. cost of re-building 41 citation shards.
 *
 * Phase 4 DEPLOY replaces on-demand triggering with Vercel Cron. This state
 * file stays — cron writes the same schema; page-loads then see fresh state
 * and skip the on-demand trigger.
 */

import "server-only";

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type UrlWatcherPhase = "idle" | "running" | "success" | "failed";

export type UrlWatcherTrigger = "page-load" | "import" | "cron" | "manual";

type UrlWatcherStateFile = {
  schemaVersion: 1;
  phase: UrlWatcherPhase;
  updatedAt: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  trigger?: UrlWatcherTrigger;
  /** Counts from the last completed run (populated on success or failed). */
  stats?: {
    urlsInHistory: number;
    experimentsUpdated: number;
    /** G3 — URL outcomes processed (all terminal-eligible change×URL pairs). */
    outcomesProcessed?: number;
    /** G3 — new outcomes written this run (excludes idempotent no-ops). */
    outcomesRecorded?: number;
    /** G3 — verdict transitions on existing outcomes (upserts). */
    outcomeTransitions?: number;
    /** G4 — pattern brain buckets rebuilt. */
    patternsRebuilt?: number;
    durationMs: number;
  };
  message?: string;
};

const DATA_DIR = join(process.cwd(), ".data");
const STATE_FILE_NAME = "url-watcher-state";

/** 6-hour throttle — mirrors scan-state freshness convention. */
const URL_WATCHER_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Running watcher older than this is assumed crashed/orphaned. */
const URL_WATCHER_STALE_RUNNING_MS = 10 * 60 * 1000;

/**
 * Phase 3.2 (Sprint 3, 2026-04-24) — Vercel in-memory state path.
 *
 * On Vercel the working directory is read-only, so prior logic that wrote
 * `.data/url-watcher-state.json.tmp` crashed with ENOENT on every /changes
 * and / page render. That log-noise was non-fatal (the exception was caught
 * in /changes/page.tsx) but it also meant the watcher pipeline never ran in
 * production — the first `writeRunningState` threw before the pipeline body
 * executed.
 *
 * Phase 3.1 classified this state as cache-only / advisory throttle
 * metadata. Primary watcher outputs (citation history, URL outcomes,
 * pattern brain) are dual-written to Supabase by the pipeline itself and
 * survive state loss. So on Vercel we keep state in module-level memory:
 * warm lambdas throttle correctly, cold-start lambdas run the idempotent
 * pipeline once. No FS writes, no ENOENT.
 */
// audit #19 (2026-06-14): keyed BY TENANT. A single process-global var meant
// a warm Vercel lambda shared one tenant's throttle/running state with every
// other tenant — tenant-A's phase="running" made tenant-B skip its own
// pipeline refresh. The file path is tenant-keyed for the same reason.
const _vercelMemoryByTenant = new Map<string, UrlWatcherStateFile>();

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function ensureDataDir(): void {
  if (isVercel()) return;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function statePath(tenantId: string): string {
  return join(DATA_DIR, `${STATE_FILE_NAME}-${tenantId}.json`);
}

export function readUrlWatcherState(
  tenantId: string,
): UrlWatcherStateFile | null {
  if (isVercel()) {
    return _vercelMemoryByTenant.get(tenantId) ?? null;
  }
  try {
    const p = statePath(tenantId);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as UrlWatcherStateFile;
    if (raw.schemaVersion !== 1) return null;
    return raw;
  } catch (err) {
    console.error("[url-watcher] swallowed error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function writeUrlWatcherState(
  state: UrlWatcherStateFile,
  tenantId: string,
): void {
  if (isVercel()) {
    _vercelMemoryByTenant.set(tenantId, state);
    return;
  }
  ensureDataDir();
  const path = statePath(tenantId);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}

/**
 * Test-only: reset the in-memory Vercel state. Not exported for production
 * callers. Needed because module-level state survives across tests unless
 * explicitly cleared.
 */
function __resetVercelMemoryStateForTests(): void {
  _vercelMemoryByTenant.clear();
}

/** Milliseconds since the last successful run finished, or `null` if never. */
function msSinceLastSuccess(state: UrlWatcherStateFile | null): number | null {
  if (!state?.lastSuccessAt) return null;
  return Date.now() - new Date(state.lastSuccessAt).getTime();
}

/** Milliseconds a currently-running watcher has been running, or `null`. */
function runningAgeMs(state: UrlWatcherStateFile | null): number | null {
  if (!state || state.phase !== "running") return null;
  return Date.now() - new Date(state.updatedAt).getTime();
}

/**
 * Is a watcher currently running and still within the fresh-running window?
 * True → another caller should NOT start a parallel run.
 * False → safe to start a new run (either not running, or stale-running crash).
 */
function isWatcherRunningAndFresh(state: UrlWatcherStateFile | null): boolean {
  const age = runningAgeMs(state);
  if (age === null) return false;
  return age < URL_WATCHER_STALE_RUNNING_MS;
}

/**
 * Should we refresh on this page load?
 * True when:
 *   - no state file yet (first run), OR
 *   - last success was > 6h ago, AND
 *   - no other watcher is currently running fresh.
 */
export function shouldRefreshUrlWatcher(state: UrlWatcherStateFile | null): boolean {
  if (isWatcherRunningAndFresh(state)) return false;
  const sinceSuccess = msSinceLastSuccess(state);
  if (sinceSuccess === null) return true;
  return sinceSuccess >= URL_WATCHER_REFRESH_INTERVAL_MS;
}

export function writeRunningState(
  trigger: UrlWatcherTrigger,
  tenantId: string,
): void {
  writeUrlWatcherState(
    {
      schemaVersion: 1,
      phase: "running",
      updatedAt: new Date().toISOString(),
      trigger,
      message: "URL watcher refresh in progress",
    },
    tenantId,
  );
}

export function writeSuccessState(
  trigger: UrlWatcherTrigger,
  stats: NonNullable<UrlWatcherStateFile["stats"]>,
  startedAt: string,
  tenantId: string,
): void {
  const now = new Date().toISOString();
  writeUrlWatcherState(
    {
      schemaVersion: 1,
      phase: "success",
      updatedAt: now,
      lastRunAt: startedAt,
      lastSuccessAt: now,
      trigger,
      stats,
      message: "URL watcher refresh complete",
    },
    tenantId,
  );
}

export function writeFailedState(
  trigger: UrlWatcherTrigger,
  error: string,
  startedAt: string,
  tenantId: string,
): void {
  writeUrlWatcherState(
    {
      schemaVersion: 1,
      phase: "failed",
      updatedAt: new Date().toISOString(),
      lastRunAt: startedAt,
      trigger,
      message: `URL watcher refresh failed: ${error}`,
    },
    tenantId,
  );
}
