import "server-only";

/**
 * deadman-view (BEACON_500 T0c, 2026-07-03) - loads what the pure deadman
 * classifier (deadman.ts) needs and returns the composed verdict. Reads are
 * bounded and fail-soft: 8 small indexed cron_runs reads (one per scheduled
 * job, request-memoized via react cache) plus the latest two site probes.
 * Callers on Today additionally deadline-bound this via load-with-deadline.
 */

import { cache } from "react";

import { CRON_SCHEDULE_MAP } from "./cron-schedule-map";
import { listRecentCronRuns } from "./cron-runs-store";
import { listRecentSiteProbes } from "./site-uptime-store";
import { assessDeadman, summarizeJobReceipts, type DeadmanVerdict } from "./deadman";

/** Runs per job to scan: enough history to anchor "when the ledger began"
 *  for the never-ran grace state (2 weeks of nightly receipts). */
const RUNS_PER_JOB = 14;

export const loadDeadmanVerdict = cache(
  async (tenantId: string): Promise<DeadmanVerdict> => {
    const now = new Date();
    const latestRunByJob = new Map<string, string | null>();
    const diedMidRunByJob = new Map<string, string | null>();
    let ledgerBeganAt: string | null = null;

    await Promise.all(
      CRON_SCHEDULE_MAP.map(async (entry) => {
        const runs = await listRecentCronRuns(entry.job, RUNS_PER_JOB).catch(() => []);
        // A "started" receipt is never scored as a run; summarizeJobReceipts
        // splits the newest row into a real last-run (finished or in-flight) vs
        // an abandoned died-mid-run receipt.
        const s = summarizeJobReceipts(runs, now);
        latestRunByJob.set(entry.job, s.lastRunStartedAt);
        diedMidRunByJob.set(entry.job, s.diedMidRunStartedAt);
        if (s.oldestStartedAt && (ledgerBeganAt == null || s.oldestStartedAt < ledgerBeganAt)) {
          ledgerBeganAt = s.oldestStartedAt;
        }
      }),
    );

    const probes = await listRecentSiteProbes(tenantId, 2).catch(() => []);

    return assessDeadman({
      latestRunByJob,
      diedMidRunByJob,
      ledgerBeganAt,
      probes: probes.map((p) => ({ checkedAt: p.checked_at, ok: p.ok, status: p.status })),
      now,
    });
  },
);
