import "server-only";

import { after } from "next/server";

import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
import { continueDeepBackfillIfStarted } from "@/lib/connectors/gsc/deep-backfill";
import { log } from "@/lib/logger";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { runWithTenant } from "@/lib/tenant-context";
import { warmFreeSurfaces } from "./warm-caches";
import {
  advancePhase,
  claimRun,
  finishRun,
  newOwnerToken,
  type ResearchPhase,
  type ResearchRun,
  type ResearchRunProgress,
} from "../research-run";

/**
 * on-visit-refresh - the Research Run executor (Slice 4, 2026-07-24).
 *
 * Every navigation schedules ONE post-response Research Run for the tenant. The
 * run is durable: claim_research_run leases the (tenant, UTC-day) cycle so
 * exactly one invocation advances it, and the persisted phase + progress let a
 * crash or lambda timeout resume at the phase it left off. There is no scheduler,
 * cron, heartbeat, in-memory dedupe, or job queue - the DATABASE lease is the
 * whole correctness mechanism (a second concurrent claim with a different owner
 * token returns null and exits cheaply).
 *
 * Three phases run in order from the claimed row's current_phase, inside the
 * post-response deadline:
 *   1. refresh_sources     - refresh stale connectors (source-specific staleness
 *                            inside; naturally idempotent).
 *   2. gsc_backfill_chunk  - advance one bounded GSC deep-backfill chunk (its own
 *                            durable cursor makes retries idempotent; a timeout
 *                            leaves the cursor untouched).
 *   3. publish_surface     - rebuild + publish the Today/Changes release, but
 *                            ONLY when phase 1 refreshed ≥1 source, phase 2
 *                            advanced a chunk, or the saved release is genuinely
 *                            stale (evidence-conditioned, never day-gated).
 *
 * CRASH-BOUNDARY HONESTY: every phase side effect is idempotent - the connector
 * refresh is stale-checked, the backfill is cursor-gated, and the surface publish
 * rebuilds from truth. So a crash at ANY of the five boundaries (before a phase /
 * during it / after its side effect / before advancing the cursor / after) resumes
 * on the next visit without a duplicate durable effect: an un-advanced phase simply
 * re-runs, and its idempotent body produces the same result.
 *
 * Deadline reached before a phase ⇒ finishRun 'paused' (durable progress; next
 * visit resumes at current_phase). A phase throw ⇒ record bounded error info and
 * finishRun 'paused' (recoverable) - never 'failed' for a transient error. An
 * owner-guarded advance/finish returning false ⇒ our expired lease was recovered
 * by another instance; abort immediately with no further side effects.
 */

/** Leave enough of the shell's 300-second lifetime to finish the surface build. */
export const RESEARCH_CYCLE_DEADLINE_MS = 210_000;

/** The GSC backfill chunk is hard-bounded so a wedged pull can never strand the
 *  lambda; on a timeout the cursor is left untouched and the next visit resumes. */
const BACKFILL_CHUNK_DEADLINE_MS = 60_000;

/** Reasons the deep-backfill continuation returns when there is simply nothing to
 *  do (no backfill started, already finished, or no synced property yet). These
 *  are healthy no-ops for every tenant that never started a backfill; they must
 *  NOT log a failure. */
const BENIGN_BACKFILL_SKIPS = new Set(["not_started", "already_complete", "no_synced_property", "no_cursor"]);

/** The ordered execution phases (excluding the terminal `done`). */
const PHASE_SEQUENCE: ResearchPhase[] = ["refresh_sources", "gsc_backfill_chunk", "publish_surface"];

/** Injectable phase bodies + clock/deadline so the runner is testable with a
 *  short budget and stub executors; production passes nothing and uses the real
 *  implementations below. */
export type ResearchCycleSteps = {
  refreshSources: (tenantId: string, now: Date) => Promise<number>;
  backfillChunk: (
    tenantId: string,
    now: Date,
    deadlineMs: number,
  ) => Promise<{ ran: boolean; complete?: boolean; daysPulled?: number }>;
  publishSurface: (tenantId: string) => Promise<void>;
  surfaceStale: (tenantId: string, nowMs: number) => Promise<boolean>;
};

export type ResearchCycleOptions = {
  now?: () => Date;
  deadlineMs?: number;
  steps?: Partial<ResearchCycleSteps>;
};

const defaultSteps: ResearchCycleSteps = {
  async refreshSources(tenantId, now) {
    const results = await autoRefreshStaleConnectorsForTenant(tenantId, now).catch((error) => {
      log.warn("[research-run] connector refresh failed", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });
    return results.length;
  },
  async backfillChunk(tenantId, now, deadlineMs) {
    const raced = await loadWithDeadline(continueDeepBackfillIfStarted(tenantId, now), deadlineMs).catch((error) => {
      log.warn("[research-run] gsc deep backfill continuation failed", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { timedOut: false as const, data: { ran: false as const, reason: "error" } };
    });
    if (raced.timedOut) {
      log.info("[research-run] gsc deep backfill hit the phase deadline; resuming next visit", { tenantId });
      return { ran: false };
    }
    const result = raced.data;
    if (result.ran) {
      log.info("[research-run] gsc deep backfill chunk advanced", {
        tenantId,
        daysPulled: result.daysPulled,
        complete: result.complete,
      });
      return { ran: true, complete: result.complete, daysPulled: result.daysPulled };
    }
    if (!BENIGN_BACKFILL_SKIPS.has(result.reason)) {
      log.warn("[research-run] gsc deep backfill chunk did not advance", { tenantId, reason: result.reason });
    }
    return { ran: false };
  },
  async publishSurface(tenantId) {
    await warmFreeSurfaces(tenantId);
  },
  async surfaceStale(tenantId, nowMs) {
    const { readCustomerSurface, isCustomerSurfaceStale } = await import("@/app/(shell)/surface-release");
    const surface = await readCustomerSurface(tenantId).catch(() => null);
    if (surface == null) return true; // no saved release yet → genuinely needs a first publish
    return isCustomerSurfaceStale(surface.computedAt, nowMs);
  },
};

/** Run one phase's body, returning the merged progress. Throws propagate to the
 *  cycle loop, which records the error and pauses (recoverable). */
async function runPhase(
  phase: ResearchPhase,
  tenantId: string,
  now: Date,
  progress: ResearchRunProgress,
  steps: ResearchCycleSteps,
): Promise<ResearchRunProgress> {
  if (phase === "refresh_sources") {
    const sourcesRefreshed = await steps.refreshSources(tenantId, now);
    return { ...progress, sourcesRefreshed };
  }
  if (phase === "gsc_backfill_chunk") {
    const backfill = await steps.backfillChunk(tenantId, now, BACKFILL_CHUNK_DEADLINE_MS);
    return { ...progress, backfill };
  }
  // publish_surface - evidence-conditioned, never day-gated, never every visit.
  const shouldPublish =
    (progress.sourcesRefreshed ?? 0) >= 1 ||
    progress.backfill?.ran === true ||
    (await steps.surfaceStale(tenantId, now.getTime()));
  if (shouldPublish) await steps.publishSurface(tenantId);
  return { ...progress, surfacePublished: shouldPublish };
}

/** The next phase after `phase` in the sequence, or `done`. */
function nextPhase(phase: ResearchPhase): ResearchPhase {
  const i = PHASE_SEQUENCE.indexOf(phase);
  return i < 0 || i + 1 >= PHASE_SEQUENCE.length ? "done" : PHASE_SEQUENCE[i + 1]!;
}

/**
 * Execute the claimed run from its current_phase to done, or pause durably. The
 * DATABASE lease we hold (via ownerToken) is renewed on every advance; if an
 * advance/finish reports our lease was lost, we abort immediately.
 */
async function driveRun(
  run: ResearchRun,
  ownerToken: string,
  nowFn: () => Date,
  deadline: number,
  steps: ResearchCycleSteps,
): Promise<void> {
  const tenantId = run.tenant_id;
  let progress: ResearchRunProgress = run.progress ?? {};
  let phase = run.current_phase;

  while (phase !== "done") {
    if (nowFn().getTime() >= deadline) {
      // Out of time before this phase; leave durable progress and resume next visit.
      await finishRun(tenantId, run.id, ownerToken, "paused");
      return;
    }
    try {
      progress = await runPhase(phase, tenantId, nowFn(), progress, steps);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      log.warn("[research-run] phase threw; pausing (recoverable)", { tenantId, phase, error: message });
      await finishRun(tenantId, run.id, ownerToken, "paused", { phase, message, at: nowFn().toISOString() });
      return;
    }
    const next = nextPhase(phase);
    const held = await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress });
    if (!held) return; // our lease was recovered by another instance - abort, no side effects
    phase = next;
  }

  await finishRun(tenantId, run.id, ownerToken, "completed");
}

/**
 * Claim (or resume) today's Research Run for the tenant and drive it. A lost
 * claim (null) means another instance holds today's cycle, or it already
 * completed - do nothing.
 */
export async function runResearchCycle(tenantId: string, options: ResearchCycleOptions = {}): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? RESEARCH_CYCLE_DEADLINE_MS;
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const deadline = nowFn().getTime() + deadlineMs;

  await runWithTenant(tenantId, async () => {
    const ownerToken = newOwnerToken();
    const run = await claimRun(tenantId, ownerToken, nowFn());
    if (run == null) {
      log.debug("[research-run] no claim (held elsewhere or complete today)", { tenantId });
      return;
    }
    await driveRun(run, ownerToken, nowFn, deadline, steps);
  });
}

/**
 * Schedule one post-response Research Run from the app shell. Every navigation
 * may call this; the DATABASE lease (not any in-memory guard) prevents two
 * instances from both advancing the cycle. after() is only valid in a request
 * scope, so tests and scripts get a safe no-op.
 */
export function ensureResearchRunOnVisit(tenantId: string): void {
  if (!tenantId) return;
  try {
    after(async () => {
      try {
        await runResearchCycle(tenantId);
      } catch (error) {
        log.warn("[research-run] cycle failed (non-blocking)", {
          tenantId,
          error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
      }
    });
  } catch {
    // after() outside a request scope - no-op.
  }
}
