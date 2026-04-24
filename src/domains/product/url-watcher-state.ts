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

export type UrlWatcherPhase = "idle" | "running" | "success" | "failed";

export type UrlWatcherTrigger = "page-load" | "import" | "cron" | "manual";

export type UrlWatcherStateFile = {
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
export const URL_WATCHER_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Running watcher older than this is assumed crashed/orphaned. */
export const URL_WATCHER_STALE_RUNNING_MS = 10 * 60 * 1000;

function ensureDataDir(): void {
  if (process.env.VERCEL === "1") return;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function statePath(): string {
  return join(DATA_DIR, `${STATE_FILE_NAME}.json`);
}

export function readUrlWatcherState(): UrlWatcherStateFile | null {
  try {
    const p = statePath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as UrlWatcherStateFile;
    if (raw.schemaVersion !== 1) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeUrlWatcherState(state: UrlWatcherStateFile): void {
  ensureDataDir();
  const path = statePath();
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}

/** Milliseconds since the last successful run finished, or `null` if never. */
export function msSinceLastSuccess(state: UrlWatcherStateFile | null): number | null {
  if (!state?.lastSuccessAt) return null;
  return Date.now() - new Date(state.lastSuccessAt).getTime();
}

/** Milliseconds a currently-running watcher has been running, or `null`. */
export function runningAgeMs(state: UrlWatcherStateFile | null): number | null {
  if (!state || state.phase !== "running") return null;
  return Date.now() - new Date(state.updatedAt).getTime();
}

/**
 * Is a watcher currently running and still within the fresh-running window?
 * True → another caller should NOT start a parallel run.
 * False → safe to start a new run (either not running, or stale-running crash).
 */
export function isWatcherRunningAndFresh(state: UrlWatcherStateFile | null): boolean {
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

export function writeRunningState(trigger: UrlWatcherTrigger): void {
  writeUrlWatcherState({
    schemaVersion: 1,
    phase: "running",
    updatedAt: new Date().toISOString(),
    trigger,
    message: "URL watcher refresh in progress",
  });
}

export function writeSuccessState(
  trigger: UrlWatcherTrigger,
  stats: NonNullable<UrlWatcherStateFile["stats"]>,
  startedAt: string,
): void {
  const now = new Date().toISOString();
  writeUrlWatcherState({
    schemaVersion: 1,
    phase: "success",
    updatedAt: now,
    lastRunAt: startedAt,
    lastSuccessAt: now,
    trigger,
    stats,
    message: "URL watcher refresh complete",
  });
}

export function writeFailedState(
  trigger: UrlWatcherTrigger,
  error: string,
  startedAt: string,
): void {
  writeUrlWatcherState({
    schemaVersion: 1,
    phase: "failed",
    updatedAt: new Date().toISOString(),
    lastRunAt: startedAt,
    trigger,
    message: `URL watcher refresh failed: ${error}`,
  });
}
