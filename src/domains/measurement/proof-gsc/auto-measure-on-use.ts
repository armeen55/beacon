import "server-only";

import { after } from "next/server";

import { log } from "@/lib/logger";

/**
 * auto-measure-on-use (CORE 100K) - PASSIVE settle of due proof rows when the
 * operator opens Results. Schedules the measure pass via next/after so it runs
 * AFTER the response (zero render latency, never blocks the page). On-demand, not
 * a cron. Fail-soft. Bounded. A settlement tail re-harvests winner-memory and the
 * team scoreboard so a fresh won/lost verdict reaches ranking on the next render.
 */
const lastRunAt = new Map<string, number>();
const MIN_GAP_MS = 10 * 60_000;
const PER_RUN_CAP = 15;

/** Fire-and-forget a due-row measurement pass after the response. No-op if throttled or
 *  called outside a request scope. NEVER throws (fail-soft for the render path). */
export function scheduleAutoMeasure(tenantId: string): void {
  if (!tenantId) return;
  const nowMs = Date.now();
  const last = lastRunAt.get(tenantId) ?? 0;
  if (nowMs - last < MIN_GAP_MS) return; // collapse rapid renders (one pass per window)
  try {
    after(async () => {
      try {
        const { autoMeasureDuePass } = await import("./auto-measure-pass");
        const res = await autoMeasureDuePass(tenantId, { maxRecords: PER_RUN_CAP });
        if (res.measured > 0) {
          log.info("[auto-measure-on-use] passive pass ran", {
            tenantId,
            due: res.due,
            measured: res.measured,
            settled: res.settled,
            changed: res.changed,
          });
          try {
            const { rebuildResultsSurface } = await import("@/app/(shell)/results/results-ledger-data");
            await rebuildResultsSurface(tenantId);
          } catch (e) {
            log.warn("[auto-measure-on-use] results-surface rebuild failed (non-blocking)", {
              tenantId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (res.settled > 0) {
          try {
            const { harvestWinners } = await import("@/domains/decision/llm/winner-memory");
            await harvestWinners(tenantId);
          } catch (e) {
            log.warn("[auto-measure-on-use] winner harvest failed (non-blocking)", {
              tenantId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } catch (e) {
        log.warn("[auto-measure-on-use] passive pass failed (non-blocking)", {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
    lastRunAt.set(tenantId, nowMs);
  } catch {
    // after() is only valid inside a request scope - ignore outside one.
  }
}
