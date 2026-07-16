import "server-only";

import { after } from "next/server";

import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/cron-sync";
import { log } from "@/lib/logger";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { runWithTenant } from "@/lib/tenant-context";
import { runAutonomousResearchForTenant } from "./autonomous-research";
import { recoverAbandonedPageFactoryForTenant } from "./recover-abandoned-work";
import { replenishReadyQueueForTenant } from "./ready-queue-replenishment";
import { refreshStaleCrawlForCurrentTenant } from "@/domains/scanning/stale-crawl-refresh";
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

async function runPostResponseCycle(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, async () => {
    const connectorResults = await autoRefreshStaleConnectorsForTenant(tenantId).catch((error) => {
      log.warn("[autonomous] connector refresh failed", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });
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
    const now = new Date();
    const prior = await readLastWarmReceipt(tenantId, "visit");
    const shouldRunDeepResearch = shouldRunAutonomousResearch(prior, now);
    if (shouldRunDeepResearch) {
      // Write before work begins. This is the durable cross-instance throttle
      // and gives the UI an honest running state instead of a blank.
      await recordWarmRun(startedReceipt(tenantId, now, prior));
      let latestCheckpoint = prior;
      const raced = await loadWithDeadline(
        runAutonomousResearchForTenant(tenantId, now, {}, {
          resume: prior,
          onCheckpoint: async (checkpoint) => {
            latestCheckpoint = checkpoint;
            await recordWarmRun(checkpoint);
          },
        }),
        AUTONOMOUS_RUN_DEADLINE_MS,
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
    const recovery = await recoverAbandonedPageFactoryForTenant(tenantId, new Date()).catch((error) => ({
      status: "failed" as const,
      weekOf: "unknown",
      reason: error instanceof Error ? error.message : String(error),
    }));
    if (recovery.status !== "not_needed") {
      log.info("[autonomous] page factory recovery checked", { tenantId, recovery });
    }
  });
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
