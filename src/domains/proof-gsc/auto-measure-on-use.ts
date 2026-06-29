import "server-only";

import { after } from "next/server";

import { log } from "@/lib/logger";
import { autoMeasureDuePass } from "./auto-measure-pass";

/**
 * auto-measure-on-use (2026-06-29) — PASSIVE settle of due proof rows when the operator
 * opens the Results page. The proof→ranking loop is fully wired, but `autoMeasureDuePass`
 * previously ran ONLY from the explicit "Measure now" operator action, so due rows sat
 * un-measured (and learning never activated) unless the operator remembered to click.
 *
 * This schedules the SAME engine via next/after — it runs AFTER the response, so it adds
 * ZERO render latency and never blocks the page. On-demand (operator opens /proof), NOT a
 * cron. Fail-soft. Bounded (autoMeasureDuePass caps records + does GSC reads from already-
 * synced data — no paid calls). The caller gates this to operator mode + only fires when
 * due rows exist, so a customer/anon view never mutates proof data.
 *
 * Idempotence: a per-warm-lambda throttle collapses rapid /proof renders into one pass;
 * autoMeasureDuePass itself is deterministic (re-measuring the same GSC window yields the
 * same verdict), so an occasional duplicate across lambdas is harmless. Mirrors the proven
 * scheduleBriefBackfill pattern.
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
  lastRunAt.set(tenantId, nowMs);
  try {
    after(async () => {
      try {
        const res = await autoMeasureDuePass(tenantId, { maxRecords: PER_RUN_CAP });
        if (res.measured > 0) {
          log.info("[auto-measure-on-use] passive pass ran", {
            tenantId,
            due: res.due,
            measured: res.measured,
            settled: res.settled,
            changed: res.changed,
          });
        }
      } catch (e) {
        log.warn("[auto-measure-on-use] passive pass failed (non-blocking)", {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  } catch {
    // after() is only valid inside a request scope — ignore outside one.
  }
}
