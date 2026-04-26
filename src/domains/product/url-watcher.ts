/**
 * URL Watcher — on-demand orchestrator.
 *
 * Called from every `/changes` and `/` (Today) page load. When the last
 * successful refresh is > 6h old, re-runs the full pipeline:
 *
 *   1. Rebuild URL citation history (owned URL × date × platform series)
 *   2. Persist the rebuilt history to `.data/url-daily-citations.json`
 *   3. Run `runExperimentCitationSync` so active experiments get fresh
 *      `latestCitations` / `latestMentions` / `latestVisibility`
 *   4. [G3/G4, later]: record URL outcomes + rebuild edit-type × asset-type
 *      pattern brain.
 *
 * Throttle state lives in `.data/url-watcher-state.json` (see
 * `url-watcher-state.ts`). Mirrors the `scan-state.ts` convention.
 *
 * Phase 4 DEPLOY replaces the page-load trigger with Vercel Cron hitting
 * `/api/cron/url-watcher` — same state file, same pipeline.
 */

import "server-only";

import { log } from "@/lib/logger";
import {
  buildUrlCitationHistory,
  persistUrlCitationHistory,
  type UrlCitationHistory,
} from "./url-citation-history";
// Phase 4 (2026-04-19): experiment-citation-sync removed. URL-level outcomes
// are materialized directly from observation history; no separate experiment
// record to refresh.
import {
  readUrlWatcherState,
  shouldRefreshUrlWatcher,
  writeRunningState,
  writeSuccessState,
  writeFailedState,
  type UrlWatcherTrigger,
} from "./url-watcher-state";
import { getChangelogEntries } from "@/lib/seed-data.server";
import {
  materializeUrlOutcomes,
  urlChangeOutcomes,
} from "@/domains/attribution/url-change-outcome";
import { materializeUrlChangePatterns } from "@/domains/learning/change-patterns";

export type UrlWatcherRunResult = {
  ran: boolean;
  reason?: "throttled" | "already-running" | "completed" | "failed";
  stats?: {
    urlsInHistory: number;
    experimentsUpdated: number;
    outcomesProcessed: number;
    outcomesRecorded: number;
    outcomeTransitions: number;
    patternsRebuilt: number;
    durationMs: number;
  };
  error?: string;
};

/**
 * Public entry point. Safe to call on every page load — idempotent, self-
 * throttling, never throws (always returns a result describing what happened).
 *
 * If the last successful run was within the refresh interval, returns
 * `{ ran: false, reason: "throttled" }` without touching anything.
 * If another caller has a fresh running-state, returns `{ ran: false,
 * reason: "already-running" }` to avoid a concurrent run.
 */
export async function maybeRefreshUrlWatcher(
  trigger: UrlWatcherTrigger = "page-load",
): Promise<UrlWatcherRunResult> {
  const state = readUrlWatcherState();
  if (!shouldRefreshUrlWatcher(state)) {
    const reason = state?.phase === "running" ? "already-running" : "throttled";
    return { ran: false, reason };
  }

  return runUrlWatcher(trigger);
}

/**
 * Force-run the pipeline. Exposed for manual refresh actions + future cron
 * endpoint. Callers outside of `maybeRefreshUrlWatcher` are responsible for
 * their own concurrency story (or accept the risk — the pipeline is
 * idempotent and the state file is the arbiter).
 */
export async function runUrlWatcher(
  trigger: UrlWatcherTrigger,
): Promise<UrlWatcherRunResult> {
  const startedAtISO = new Date().toISOString();
  const t0 = Date.now();
  log.info("URL watcher run started", { trigger });
  writeRunningState(trigger);

  try {
    // 1. Rebuild URL citation history from existing citation shards (owned only).
    const history: UrlCitationHistory = buildUrlCitationHistory({ ownedOnly: true });

    // 2. Persist to disk + Supabase (dual-write when enabled).
    await persistUrlCitationHistory(history);

    // 3. (Phase 4) Experiment citation sync removed \u2014 URL-level outcomes are
    //    materialized from observation history directly below.
    const syncResult = { updated: 0, total: 0 };

    // 4. Record per-URL outcomes so the pattern brain has memory to eat.
    // Idempotent — re-running updates existing records in place via
    // (change_id, url) upsert; no duplicates.
    const outcomesResult = await materializeUrlOutcomes({
      changes: await getChangelogEntries(),
      history,
      asOfDate: history.date_range.last ?? undefined,
    });

    // 5. Rebuild the URL-level pattern brain from the updated outcome store.
    // Groups by (edit_type_token × asset_type) so G5 can look up
    // "how fast do similar changes typically land?" by pattern.
    const urlPatterns = await materializeUrlChangePatterns(urlChangeOutcomes);

    const durationMs = Date.now() - t0;
    const stats = {
      urlsInHistory: history.distinct_urls,
      experimentsUpdated: syncResult.updated,
      outcomesProcessed: outcomesResult.processed,
      outcomesRecorded: outcomesResult.recorded,
      outcomeTransitions: outcomesResult.transitions,
      patternsRebuilt: urlPatterns.length,
      durationMs,
    };

    writeSuccessState(trigger, stats, startedAtISO);
    log.info("URL watcher run completed", { trigger, ...stats });

    return { ran: true, reason: "completed", stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeFailedState(trigger, message, startedAtISO);
    log.error("URL watcher run failed", {
      trigger,
      error: message,
      durationMs: Date.now() - t0,
    });
    return { ran: true, reason: "failed", error: message };
  }
}
