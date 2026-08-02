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
  NATIVE_REGIME_START,
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
import { currentTenantId } from "@/lib/tenant-context";
import {
  materializeUrlOutcomes,
} from "@/domains/measurement/attribution/url-change-outcome";
// The learning/change-patterns module (URL-level pattern brain) was removed; its rebuild step is
// dropped below (patternsRebuilt reports 0), the rest of the URL-outcome pass is unaffected.

type UrlWatcherRunResult = {
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
  // audit #19 (2026-06-14): per-tenant throttle/running state.
  const tenantId = await currentTenantId();
  const state = readUrlWatcherState(tenantId);
  if (!shouldRefreshUrlWatcher(state)) {
    const reason = state?.phase === "running" ? "already-running" : "throttled";
    return { ran: false, reason };
  }

  return runUrlWatcher(trigger, tenantId);
}

/**
 * Force-run the pipeline. Exposed for manual refresh actions + future cron
 * endpoint. Callers outside of `maybeRefreshUrlWatcher` are responsible for
 * their own concurrency story (or accept the risk — the pipeline is
 * idempotent and the state file is the arbiter).
 */
async function runUrlWatcher(
  trigger: UrlWatcherTrigger,
  tenantId?: string,
): Promise<UrlWatcherRunResult> {
  // audit #19 (2026-06-14): resolve the tenant if a caller invoked this
  // directly (maybeRefreshUrlWatcher passes it). State is per-tenant.
  const resolvedTenantId = tenantId ?? (await currentTenantId());
  const startedAtISO = new Date().toISOString();
  const t0 = Date.now();
  log.info("URL watcher run started", { trigger, tenantId: resolvedTenantId });
  writeRunningState(trigger, resolvedTenantId);

  try {
    // 1. Rebuild URL citation history from existing citation shards (owned only).
    //    sinceDate = NATIVE_REGIME_START windows OUT the pre-cutover benchmark
    //    cold-store, which is GLOBAL (founder/Ritz-relative is_owned, no tenant
    //    dimension). Without it a non-founder tenant (e.g. Iranopedia) PERSISTS
    //    Ritz's owned benchmark citations into its OWN url-daily-citations store
    //    — a cross-tenant leak. The /changes render path already windows the
    //    same way; this makes the persist path consistent. Forward measurement
    //    relies on the tenant-scoped native/Profound data, not this band.
    const history: UrlCitationHistory = await buildUrlCitationHistory({
      ownedOnly: true,
      sinceDate: NATIVE_REGIME_START,
    });

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

    // 5. (removed) The URL-level pattern brain (learning/change-patterns) was deleted; the
    //    per-URL outcome store above is still written, but the pattern rebuild no longer runs.
    const patternsRebuilt = 0;

    const durationMs = Date.now() - t0;
    const stats = {
      urlsInHistory: history.distinct_urls,
      experimentsUpdated: syncResult.updated,
      outcomesProcessed: outcomesResult.processed,
      outcomesRecorded: outcomesResult.recorded,
      outcomeTransitions: outcomesResult.transitions,
      patternsRebuilt,
      durationMs,
    };

    writeSuccessState(trigger, stats, startedAtISO, resolvedTenantId);
    log.info("URL watcher run completed", { trigger, ...stats });

    return { ran: true, reason: "completed", stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeFailedState(trigger, message, startedAtISO, resolvedTenantId);
    log.error("URL watcher run failed", {
      trigger,
      error: message,
      durationMs: Date.now() - t0,
    });
    return { ran: true, reason: "failed", error: message };
  }
}
