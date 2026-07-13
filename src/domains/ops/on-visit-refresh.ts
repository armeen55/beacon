import "server-only";

import { after } from "next/server";

import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/cron-sync";
import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { runAutonomousResearchForTenant } from "./autonomous-research";
import {
  readLastWarmReceipt,
  recordWarmRun,
  type WarmRunReceipt,
} from "./warm-receipt-store";

/** Failed/started research may retry after this durable cooldown. */
export const AUTONOMOUS_RETRY_COOLDOWN_MS = 2 * 60 * 60_000;
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

function startedReceipt(tenantId: string, now: Date): WarmRunReceipt {
  return {
    tenant_id: tenantId,
    date: now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    ran_at: now.toISOString(),
    ok: false,
    totalMs: 0,
    trigger: "visit",
    steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
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
    const now = new Date();
    const prior = await readLastWarmReceipt(tenantId, "visit");
    if (!shouldRunAutonomousResearch(prior, now)) return;

    // Write before work begins. This is the durable cross-instance throttle and
    // gives the UI an honest running state instead of a mysterious blank.
    await recordWarmRun(startedReceipt(tenantId, now));
    const receipt = await runAutonomousResearchForTenant(tenantId, now);
    await recordWarmRun(receipt);
    log.info("[autonomous] research cycle finished", {
      tenantId,
      connectorsRefreshed: connectorResults.length,
      ok: receipt.ok,
      totalMs: receipt.totalMs,
      summary: receipt.summary,
    });
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
