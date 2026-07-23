import "server-only";

import { after } from "next/server";

import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
import {
  continueDeepBackfillIfStarted,
  type DeepBackfillChunkResult,
} from "@/lib/connectors/gsc/deep-backfill";
import { log } from "@/lib/logger";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { runWithTenant } from "@/lib/tenant-context";
import { warmFreeSurfaces } from "./warm-caches";
import {
  readLastWarmReceipt,
  recordWarmRun,
  type WarmRunReceipt,
} from "./warm-receipt-store";

/** Leave enough of the shell's 300-second lifetime to finish the surface warm
 *  build and persist a receipt. */
export const ON_VISIT_CYCLE_DEADLINE_MS = 210_000;
const scheduled = new Set<string>();

/** Reasons the deep-backfill continuation returns when there is simply nothing
 *  to do (no backfill started, already finished, or no synced property yet).
 *  These are the healthy no-ops that fire for every tenant that never started a
 *  backfill; they must NOT log a failure. Anything else is a real chunk failure
 *  worth surfacing. */
const BENIGN_BACKFILL_SKIPS = new Set(["not_started", "already_complete", "no_synced_property", "no_cursor"]);

/** Pacific day-key: the receipt date and the once-per-day warm-build guard unit. */
function pacificDayKey(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Injectable clock + deadline so the deadline-bounded steps below are testable
 *  with a short budget; production passes nothing and uses the real values. */
export type PostResponseCycleOptions = {
  now?: () => Date;
  deadlineMs?: number;
};

export async function runPostResponseCycle(
  tenantId: string,
  options: PostResponseCycleOptions = {},
): Promise<void> {
  await runWithTenant(tenantId, () => runOwnedCycle(tenantId, options));
}

/**
 * The minimal on-use maintenance cycle that makes the four surfaces feel
 * autonomous without any scheduler: refresh stale connectors, advance one GSC
 * backfill chunk, then (once per Pacific day) rebuild and publish the shared
 * Today + Changes surface snapshot. Every step is bounded and fail-soft; the
 * per-instance `scheduled` guard in scheduleAutonomousRefreshOnVisit keeps a
 * single navigation from firing more than one cycle at a time.
 */
async function runOwnedCycle(tenantId: string, options: PostResponseCycleOptions = {}): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? ON_VISIT_CYCLE_DEADLINE_MS;

  const connectorResults = await autoRefreshStaleConnectorsForTenant(tenantId).catch((error) => {
    log.warn("[on-visit] connector refresh failed", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  });

  // GSC deep-history backfill continuation. When the operator started a "Load
  // my full Search Console history" backfill, advance exactly ONE more monthly
  // chunk so it finishes during normal use instead of stalling (Beacon has no
  // scheduler). Two tiny reads no-op cheaply for every tenant that never started
  // one. Bounded so a wedged GSC pull can never strand the lambda; on a timeout
  // the cursor is left untouched (the chunk marks progress only on a completed
  // pull), so the next visit resumes the same window.
  const backfillDeadlineMs = Math.min(deadlineMs, 60_000);
  const backfill = await loadWithDeadline(
    continueDeepBackfillIfStarted(tenantId, nowFn()),
    backfillDeadlineMs,
  ).catch((error): { timedOut: false; data: DeepBackfillChunkResult } => {
    log.warn("[on-visit] gsc deep backfill continuation failed", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { timedOut: false, data: { ran: false, reason: "error" } };
  });
  if (backfill.timedOut) {
    log.info("[on-visit] gsc deep backfill hit the cycle deadline; resuming next visit", { tenantId });
  } else if (backfill.data.ran) {
    log.info("[on-visit] gsc deep backfill chunk advanced", {
      tenantId,
      chunkStart: backfill.data.chunkStart,
      chunkEnd: backfill.data.chunkEnd,
      daysPulled: backfill.data.daysPulled,
      complete: backfill.data.complete,
    });
  } else if (!BENIGN_BACKFILL_SKIPS.has(backfill.data.reason)) {
    log.warn("[on-visit] gsc deep backfill chunk did not advance", {
      tenantId,
      reason: backfill.data.reason,
    });
  }

  // Surface/graph warm build, once per Pacific day. This rebuilds the shared
  // demand-graph snapshot and publishes the Today + Changes release, so the
  // first render after fresh data is instant and complete. The ~50s build is
  // gated to once a day per tenant via the visit warm receipt; connector
  // refresh and the backfill chunk above still run every visit.
  const now = nowFn();
  const today = pacificDayKey(now);
  const prior = await readLastWarmReceipt(tenantId, "visit").catch(() => null);
  if (prior?.date === today && prior.ok) return;

  const t0 = Date.now();
  let warmOk = true;
  let note = "rebuilt the Today and Changes snapshot";
  try {
    await warmFreeSurfaces(tenantId);
  } catch (error) {
    warmOk = false;
    note = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    log.warn("[on-visit] surface warm build failed", { tenantId, error: note });
  }
  const receipt: WarmRunReceipt = {
    tenant_id: tenantId,
    date: today,
    ran_at: now.toISOString(),
    ok: warmOk,
    totalMs: Date.now() - t0,
    trigger: "visit",
    steps: [{ name: "surface-warm", ok: warmOk, ms: Date.now() - t0, note }],
  };
  await recordWarmRun(receipt).catch(() => {});
  log.info("[on-visit] cycle finished", {
    tenantId,
    connectorsRefreshed: connectorResults.length,
    warmOk,
  });
}

/**
 * Schedule one unified, post-response freshness + warm cycle from the app
 * shell. Every navigation may call this; the per-instance single-flight guard
 * plus the once-a-day warm receipt prevent refresh storms and repeated builds.
 */
export function scheduleAutonomousRefreshOnVisit(tenantId: string): void {
  if (!tenantId || scheduled.has(tenantId)) return;
  scheduled.add(tenantId);
  try {
    after(async () => {
      try {
        await runPostResponseCycle(tenantId);
      } catch (error) {
        log.warn("[on-visit] cycle failed (non-blocking)", {
          tenantId,
          error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
      } finally {
        scheduled.delete(tenantId);
      }
    });
  } catch {
    scheduled.delete(tenantId);
    // after() is only valid in a request scope. Tests and scripts get a no-op.
  }
}
