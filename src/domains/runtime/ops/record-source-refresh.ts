import "server-only";

/**
 * record-source-refresh (refresh-reliability wave, 2026-07-11, BUG 3).
 *
 * The ONE call the cron, manual, and on-use refresh paths all use to write a
 * source's outcome into the refresh ledger. It classifies the engine's return
 * value honestly (ok / partial / failed), reads the newest stored data date so
 * the connectors strip can say "data through <date>", and stamps the next
 * scheduled retry. FAIL-SOFT: it never throws (recordRefreshRun absorbs write
 * errors; the latest-date read is fail-soft to null), so recording a refresh can
 * never change the refresh's own outcome.
 */

import {
  recordRefreshRun,
  classifyRefreshOutcome,
  type RefreshSource,
  type RefreshTrigger,
} from "@/domains/runtime/ops/refresh-runs-store";
import { latestDataDateForSource } from "@/domains/runtime/ops/source-data-date";

/** The nightly cron retries on its own; operator-driven triggers do not. ~24h
 *  ahead is honest for "I try again every night" without coupling to the exact
 *  Vercel schedule hour. */
function nextRetryFor(trigger: RefreshTrigger, now: Date): string | null {
  if (trigger !== "cron") return null;
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export async function recordSourceRefresh(args: {
  tenantId: string;
  source: RefreshSource;
  trigger: RefreshTrigger;
  startedAt: string;
  /** The sync engine's return value. For a thrown engine, pass
   *  `{ synced: false, reason }` so it classifies as failed. */
  value: unknown;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  const { result, rowsPersisted, failureCategory } = classifyRefreshOutcome(
    args.source,
    args.value,
  );
  // Only read the data-date on a sync that reached the source (ok/partial); a
  // hard failure never advanced it, so skip the query.
  const latestDataDate =
    result === "failed" ? null : await latestDataDateForSource(args.tenantId, args.source);

  await recordRefreshRun({
    tenantId: args.tenantId,
    source: args.source,
    trigger: args.trigger,
    startedAt: args.startedAt,
    finishedAt: now.toISOString(),
    result,
    rowsPersisted,
    latestDataDate,
    failureCategory,
    nextRetryAt: nextRetryFor(args.trigger, now),
  });
}
