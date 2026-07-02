/**
 * cron-streak (BEACON_500 item 84, 2026-07-03) - consecutive-failure streaks
 * per (tenant, provider), derived FROM the cron_runs ledger's per_source
 * results (item 85's substrate) rather than a parallel counter bolted onto
 * connector-store.ts. One source of truth: the ledger already records every
 * night's per-source outcome, so a streak is just "how many of the most
 * recent nights in a row failed for this (tenant, provider)" - pure
 * arithmetic over already-persisted data, no new counter to keep in sync.
 *
 * PURE. No I/O. Consumes `CronRunRow[]` (already loaded by the caller via
 * cron-runs-store.ts's listRecentCronRuns) - keeps this module trivially
 * testable and reusable from both the nightly trigger predicate and the
 * settings health panel.
 */

import type { CronRunRow, CronRunSourceResult } from "./cron-runs-store";

export type ProviderStreak = {
  tenantId: string;
  provider: string;
  /** Consecutive most-recent nights this (tenant, provider) failed. 0 means
   *  the most recent night for this pair succeeded (or there is no history). */
  consecutiveFailures: number;
  /** ISO timestamp of the most recent run this pair appeared in. */
  lastRunAt: string | null;
  /** The most recent failure's detail string, for the fix-card copy. */
  lastFailureDetail: string | null;
};

/**
 * Fold a job's runs (newest first, as returned by listRecentCronRuns) into
 * one streak per (tenant, provider) seen in per_source. A (tenant, provider)
 * pair that doesn't appear in a given run (e.g. it wasn't connected that
 * night) is treated as a GAP, not a failure or a success - gaps do not
 * extend or reset a streak; only counted nights matter. Once the pair
 * either succeeds or drops out of history entirely, the count stops there.
 */
export function deriveProviderStreaks(runs: ReadonlyArray<CronRunRow>): ProviderStreak[] {
  // Newest-first is the ledger's own read order; guard against a caller
  // passing unsorted input by sorting defensively.
  const sorted = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at));

  const byPair = new Map<string, CronRunSourceResult[]>(); // key -> chronological (newest first) results
  const lastRunAt = new Map<string, string>();

  for (const run of sorted) {
    for (const src of run.per_source) {
      const key = `${src.tenantId ?? "fleet"}::${src.provider}`;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key)!.push(src);
      if (!lastRunAt.has(key)) lastRunAt.set(key, run.started_at);
    }
  }

  const out: ProviderStreak[] = [];
  for (const [key, results] of byPair) {
    const [tenantId, provider] = splitKey(key);
    let streak = 0;
    let lastFailureDetail: string | null = null;
    for (const r of results) {
      if (r.ok) break;
      streak += 1;
      if (lastFailureDetail == null) lastFailureDetail = r.detail;
    }
    out.push({
      tenantId,
      provider,
      consecutiveFailures: streak,
      lastRunAt: lastRunAt.get(key) ?? null,
      lastFailureDetail,
    });
  }
  return out.sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
}

function splitKey(key: string): [string, string] {
  const idx = key.indexOf("::");
  return [key.slice(0, idx), key.slice(idx + 2)];
}

/** The streak length that files a fix card (item 84: "at 3 straight failed
 *  nights"). */
export const FAILURE_STREAK_ALERT_THRESHOLD = 3;

export function streaksAtOrAboveThreshold(
  streaks: ReadonlyArray<ProviderStreak>,
  threshold = FAILURE_STREAK_ALERT_THRESHOLD,
): ProviderStreak[] {
  return streaks.filter((s) => s.consecutiveFailures >= threshold);
}
