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
import { claimAutonomousRun, releaseAutonomousRun } from "./autonomous-run-claim";
import { runAutonomousResearchForTenant } from "./autonomous-research";
import { recoverAbandonedPageFactoryForTenant } from "./recover-abandoned-work";
import { replenishReadyQueueForTenant } from "./ready-queue-replenishment";
import { refreshStaleCrawlForCurrentTenant } from "@/domains/scanning/stale-crawl-refresh";
import { runOnVisitEnrichment } from "./on-visit-enrichment";
import {
  readLastWarmReceipt,
  recordWarmRun,
  type WarmRunReceipt,
} from "./warm-receipt-store";

/** Failed/partial research retries on a later navigation. Provider and draft
 * caches make this continuation cheap; a two-hour freeze made a killed Vercel
 * continuation look permanently stuck to the operator. */
export const AUTONOMOUS_RETRY_COOLDOWN_MS = 60_000;
/** Leave enough of the shell's 300-second lifetime to persist a terminal
 * receipt and attempt the deliberately narrow page-factory repair. */
export const AUTONOMOUS_RUN_DEADLINE_MS = 210_000;
const scheduled = new Set<string>();

/** Reasons the deep-backfill continuation returns when there is simply nothing
 *  to do (no backfill started, already finished, or no synced property yet).
 *  These are the healthy no-ops that fire for every tenant that never started a
 *  backfill; they must NOT log a failure. Anything else is a real chunk failure
 *  worth surfacing. */
const BENIGN_BACKFILL_SKIPS = new Set(["not_started", "already_complete", "no_synced_property", "no_cursor"]);

/** Pure once-a-day + retry decision, pinned independently from Next's after(). */
export function shouldRunAutonomousResearch(
  receipt: WarmRunReceipt | null,
  now: Date,
): boolean {
  if (!receipt) return true;
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  if (receipt.date !== today) return true;
  if (receipt.ok) return false;
  const attemptedAt = Date.parse(receipt.ran_at);
  return !Number.isFinite(attemptedAt) || now.getTime() - attemptedAt >= AUTONOMOUS_RETRY_COOLDOWN_MS;
}

export function startedReceipt(tenantId: string, now: Date, prior: WarmRunReceipt | null): WarmRunReceipt {
  return {
    tenant_id: tenantId,
    date: now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    ran_at: now.toISOString(),
    ok: false,
    totalMs: 0,
    trigger: "visit",
    steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
    // Keep the last completed outcome visible while a newer pass runs. The
    // presentation snapshots are still usable; starting research must not make
    // the whole product look empty or unfinished again.
    ...(prior?.summary ? { summary: prior.summary } : {}),
    ...(prior?.pipeline ? { pipeline: prior.pipeline } : {}),
  };
}

export function timedOutReceipt(tenantId: string, now: Date, prior: WarmRunReceipt | null = null): WarmRunReceipt {
  return {
    tenant_id: tenantId,
    date: now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    ran_at: now.toISOString(),
    ok: false,
    totalMs: AUTONOMOUS_RUN_DEADLINE_MS,
    trigger: "visit",
    steps: [{
      name: "autonomous-research",
      ok: false,
      ms: AUTONOMOUS_RUN_DEADLINE_MS,
      note: "This pass reached its safe time limit. I will continue from cached work automatically as you keep using Beacon.",
    }],
    ...(prior?.summary ? { summary: prior.summary } : {}),
    ...(prior?.pipeline ? { pipeline: prior.pipeline } : {}),
  };
}

/** Pacific day-key, the (tenant_id, day_key) claim unit and the receipt date. */
function pacificDayKey(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** The pipeline object gains a pipelineAdvancedAt stamp - the last time its
 * completedStages actually GREW. The status header uses this (not ran_at, which
 * startedReceipt rewrites on every visit, and not updatedAt, which the research
 * pass bumps on every checkpoint including a failing stage) to tell a live,
 * advancing pipeline apart from one that keeps dying at the same stage. Kept off
 * the shared WarmRunReceipt type so this fix stays inside its own files. */
type PipelineWithAdvance = NonNullable<WarmRunReceipt["pipeline"]> & { pipelineAdvancedAt?: string };

/** Stamp pipelineAdvancedAt on a fresh checkpoint. Set to now when the pipeline is
 * first seen or its completedStages grow (or a stage count that went DOWN / a new
 * day, i.e. a restart); otherwise carry the prior stamp forward untouched so a
 * stalled pipeline's clock keeps running. */
export function withPipelineAdvance(
  checkpoint: WarmRunReceipt,
  prior: WarmRunReceipt | null,
  now: Date,
): WarmRunReceipt {
  if (!checkpoint.pipeline) return checkpoint;
  const priorPipeline = prior?.pipeline as PipelineWithAdvance | undefined;
  // Only compare against a prior pipeline from the SAME day: a receipt carried
  // over from a previous day is a restart, not a continuation, so it must not
  // freeze the new pipeline's clock to yesterday.
  const sameContext = priorPipeline != null && prior?.date === checkpoint.date;
  const priorCount = sameContext ? priorPipeline.completedStages.length : -1;
  const priorAdvancedAt = sameContext ? priorPipeline.pipelineAdvancedAt : undefined;
  const grew = checkpoint.pipeline.completedStages.length > priorCount;
  const pipelineAdvancedAt = grew || !priorAdvancedAt ? now.toISOString() : priorAdvancedAt;
  const pipeline: PipelineWithAdvance = { ...checkpoint.pipeline, pipelineAdvancedAt };
  return { ...checkpoint, pipeline };
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
  const nowFn = options.now ?? (() => new Date());
  await runWithTenant(tenantId, async () => {
    // Cross-instance atomic claim FIRST, before any connector/crawl refresh or
    // the research decision. This is the durable throttle the per-process Set and
    // the read-then-write receipt check could never be: two concurrent requests
    // on different Vercel instances used to both pass the check and both run the
    // paid pipeline. Exactly one instance wins the day's cycle here.
    const dayKey = pacificDayKey(nowFn());
    const claim = await claimAutonomousRun(tenantId, dayKey);
    if (claim === "already-claimed") {
      // Another instance owns today's cycle right now. Exit quietly, write
      // nothing - the owner is (or already did) the work.
      log.info("[autonomous] skipped: another instance owns today's cycle", { tenantId, dayKey });
      return;
    }
    if (claim === "unavailable") {
      // Supabase is not configured / not reachable / the table is not migrated
      // yet. Proceed best-effort on the in-memory Set + daily receipt alone; do
      // not block the product on DB health. One honest log line.
      log.warn("[autonomous] cross-instance lock unavailable, running best-effort", { tenantId, dayKey });
    }
    try {
      await runOwnedCycle(tenantId, options);
    } finally {
      // The claim is a LOCK, not the daily idempotency record (the warm receipt
      // is). Release it whatever the outcome so later same-day visits keep doing
      // maintenance and a failed pass can retry after its cooldown; a successful
      // pass is blocked from rerunning by shouldRunAutonomousResearch, not this
      // row. Only release what THIS instance actually claimed.
      if (claim === "claimed") await releaseAutonomousRun(tenantId, dayKey);
    }
  });
}

async function runOwnedCycle(tenantId: string, options: PostResponseCycleOptions = {}): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? AUTONOMOUS_RUN_DEADLINE_MS;
  {
    const connectorResults = await autoRefreshStaleConnectorsForTenant(tenantId).catch((error) => {
      log.warn("[autonomous] connector refresh failed", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

    // GSC deep-history backfill continuation. When the operator started a "Load
    // my full Search Console history" backfill, advance exactly ONE more monthly
    // chunk so it finishes during normal use instead of stalling until they click
    // "Continue loading history" again (Beacon has no scheduler, so the nightly
    // cron path that used to advance this never runs). Two tiny reads no-op
    // cheaply for every tenant that never started one. Bounded by the same
    // continuation deadline as the research pass below so a wedged GSC pull can
    // never strand the lambda; on a timeout the chunk's cursor is left untouched
    // (the chunk marks progress only on a completed pull), so the next visit
    // resumes the same window. Fail-soft and isolated like the steps beside it: a
    // backfill failure must never break the rest of the cycle.
    //
    // Capped separately from the research pass below. Both steps used to share
    // the full deadlineMs (210s), which put a 420s worst case inside a 300s
    // lambda. The backfill chunk only needs to pull one bounded window, so it
    // gets a much smaller budget; Math.min keeps injected test deadlines (for
    // example 10ms) in effect.
    const backfillDeadlineMs = Math.min(deadlineMs, 60_000);
    const backfill = await loadWithDeadline(
      continueDeepBackfillIfStarted(tenantId, nowFn()),
      backfillDeadlineMs,
    ).catch((error): { timedOut: false; data: DeepBackfillChunkResult } => {
      log.warn("[autonomous] gsc deep backfill continuation failed", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { timedOut: false, data: { ran: false, reason: "error" } };
    });
    if (backfill.timedOut) {
      log.info("[autonomous] gsc deep backfill hit the cycle deadline; resuming next visit", { tenantId });
    } else if (backfill.data.ran) {
      log.info("[autonomous] gsc deep backfill chunk advanced", {
        tenantId,
        chunkStart: backfill.data.chunkStart,
        chunkEnd: backfill.data.chunkEnd,
        daysPulled: backfill.data.daysPulled,
        complete: backfill.data.complete,
      });
    } else if (!BENIGN_BACKFILL_SKIPS.has(backfill.data.reason)) {
      // A started backfill's chunk did not advance for a real reason (auth /
      // quota / network). The cursor is durably untouched so the same window
      // retries next visit, but a REPEATED failure would otherwise be invisible:
      // no cursor move means gsc_backfill_progress.updated_at stays put, which is
      // exactly the durable stall the operator status now reads (isBackfillStalled).
      // Surface it here too so a wedged backfill is observable, not silent.
      log.warn("[autonomous] gsc deep backfill chunk did not advance", {
        tenantId,
        reason: backfill.data.reason,
      });
    }

    const crawlRefresh = await refreshStaleCrawlForCurrentTenant(tenantId).catch((error) => {
      log.warn("[autonomous] stale crawl refresh failed", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (crawlRefresh?.ran) {
      log.info("[autonomous] owned-site crawl advanced", { tenantId, ...crawlRefresh });
    }
    const now = nowFn();
    const prior = await readLastWarmReceipt(tenantId, "visit");
    const shouldRunDeepResearch = shouldRunAutonomousResearch(prior, now);
    if (shouldRunDeepResearch) {
      // $0 deterministic enrichment spine (trend radar, seasonal, refresh queue,
      // algorithm weather, pooled/aa calibration, pipeline watchdog, forensic
      // investigation, etc.) - the per-tenant nightly phases of the deleted
      // cron-sync, re-homed onto the on-use cycle. Runs once per day (this daily
      // branch), AFTER the connector auto-refresh above pulled tonight's data and
      // BEFORE the paid research below, so the LIVE Today/Changes/Results surfaces
      // that read these stores stop showing frozen data even if research later
      // times out. Bounded + fail-soft; a failure never touches the research pass.
      const enrichment = await runOnVisitEnrichment(tenantId, { now: nowFn }).catch((error) => {
        log.warn("[autonomous] on-visit enrichment failed (non-blocking)", {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (enrichment && (enrichment.failed.length > 0 || enrichment.skippedPastDeadline.length > 0)) {
        log.info("[autonomous] on-visit enrichment finished", {
          tenantId,
          ran: enrichment.ran.length,
          failed: enrichment.failed,
          skippedPastDeadline: enrichment.skippedPastDeadline,
        });
      }
      // Write before work begins. This is the durable cross-instance throttle
      // and gives the UI an honest running state instead of a blank.
      await recordWarmRun(startedReceipt(tenantId, now, prior));
      let latestCheckpoint = prior;
      const raced = await loadWithDeadline(
        runAutonomousResearchForTenant(tenantId, now, {}, {
          resume: prior,
          onCheckpoint: async (checkpoint) => {
            // Stamp the progress clock (initialize on first sight, bump only on
            // real stage growth) before persisting, comparing against the last
            // checkpoint this cycle wrote.
            const stamped = withPipelineAdvance(checkpoint, latestCheckpoint, now);
            latestCheckpoint = stamped;
            await recordWarmRun(stamped);
          },
        }),
        deadlineMs,
      );
      const receipt = raced.timedOut ? timedOutReceipt(tenantId, now, latestCheckpoint) : raced.data;
      // A hard continuation limit must never leave the durable status on
      // "running". A partial receipt permits the next navigation to continue
      // through the producers' own caches after a short cooldown.
      await recordWarmRun(receipt);
      log.info("[autonomous] research cycle finished", {
        tenantId,
        connectorsRefreshed: connectorResults.length,
        ok: receipt.ok,
        timedOut: raced.timedOut,
        totalMs: receipt.totalMs,
        summary: receipt.summary,
      });
    } else {
      // A successful daily brain pass suppresses expensive research, not queue
      // maintenance. Normal navigation still restores missing ready capacity.
      const refill = await replenishReadyQueueForTenant(tenantId).catch((error) => {
        log.warn("[autonomous] ready queue refill failed", {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (refill && !refill.skipped) {
        log.info("[autonomous] ready queue replenished", { tenantId, ...refill });
      }
    }

    // This used to run first and could spend the whole continuation lifetime
    // drafting five pages, preventing the primary research brain from ever
    // replacing its "running" receipt. Recovery is now one brief, no full-page
    // walker, and runs only after the main brain has a terminal receipt.
    const recovery = await recoverAbandonedPageFactoryForTenant(tenantId, nowFn()).catch((error) => ({
      status: "failed" as const,
      weekOf: "unknown",
      reason: error instanceof Error ? error.message : String(error),
    }));
    if (recovery.status !== "not_needed") {
      log.info("[autonomous] page factory recovery checked", { tenantId, recovery });
    }
  }
}

/**
 * Schedule one unified, post-response freshness + research cycle from the app
 * shell. Every navigation may call this; per-instance single-flight plus the
 * durable daily receipt prevent refresh storms and repeated paid work.
 */
export function scheduleAutonomousRefreshOnVisit(tenantId: string): void {
  if (!tenantId || scheduled.has(tenantId)) return;
  scheduled.add(tenantId);
  try {
    after(async () => {
      try {
        await runPostResponseCycle(tenantId);
      } catch (error) {
          log.warn("[autonomous] on-visit cycle failed (non-blocking)", {
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
