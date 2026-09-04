import "server-only";

import { after } from "next/server";

import { log } from "@/lib/logger";

/**
 * auto-measure settlement. THE WHOLE SETTLE, not just the reading: a due proof row is measured, and because a verdict that moved is only true
 * on screen once the Results surface is rebuilt and only reaches ranking once winner memory has re-harvested, both ride the pass itself
 * rather than whichever caller remembered them.
 *
 * WHO CALLS IT. The scheduled Research Run does, once per pass, which is what makes measurement clear itself with nobody in the app: this
 * engine fired ONLY from a Results render, so a verdict waited on somebody opening the page. The render path below stays as a residual
 * accelerator (a visit is a chance, never the trigger), throttled to one pass per ten minutes and scheduled through next/after so it never
 * costs the page a millisecond. Free (Search Console and Analytics are already synced), cache-first, bounded, fail-soft per record.
 */
const lastRunAt = new Map<string, number>();
const MIN_GAP_MS = 10 * 60_000;
const PER_RUN_CAP = 60; // the meter is effectively gone (operator, 2026-08-30): a runaway stop over $0 reads

/** Measure every due row, then make the result VISIBLE and USABLE: the Results surface is rebuilt when a reading
 *  actually landed, so the first view serves fresh truth instead of an old snapshot patched afterwards, and winner
 *  memory re-harvests when a verdict settled. A rebuild or a harvest I could not do never loses the readings already
 *  persisted. Returns how many records were measured. NEVER throws. */
export async function settleDueMeasurements(
  tenantId: string, opts: { maxRecords?: number; now?: Date } = {},
): Promise<number> {
  if (!tenantId) return 0;
  try {
    const { autoMeasureDuePass } = await import("./auto-measure-pass");
    const res = await autoMeasureDuePass(tenantId, { maxRecords: opts.maxRecords ?? PER_RUN_CAP, ...(opts.now ? { now: opts.now } : {}) });
    // THE PASS RECEIPT, and it names the two numbers the operator is owed: how many changes were read, and how many came back from a state
    // where nothing could be compared. A pass that only repaired stuck rows still says so instead of passing silently.
    if (res.measured + res.reopened + res.crawlStamped > 0) {
      log.info("[auto-measure] read how shipped changes are doing", { tenantId, due: res.due, measured: res.measured, revived: res.revived,
        settled: res.settled, changed: res.changed, checksReopened: res.reopened, crawlDatesRead: res.crawlStamped });
    }
    if (res.measured > 0) {
      try {
        const { rebuildResultsSurface } = await import("@/app/(shell)/results/results-ledger-data");
        await rebuildResultsSurface(tenantId);
      } catch (e) {
        log.warn("[auto-measure] results-surface rebuild failed (non-blocking)", { tenantId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (res.settled > 0) {
      try {
        const { harvestWinners } = await import("@/domains/decision/llm/winner-memory");
        await harvestWinners(tenantId);
      } catch (e) {
        log.warn("[auto-measure] winner harvest failed (non-blocking)", { tenantId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return res.measured;
  } catch (e) {
    log.warn("[auto-measure] pass failed (non-blocking)", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

/** THE RESIDUAL ACCELERATOR. The scheduled run is what clears this debt; a visit is one more chance at it, never the
 *  trigger. Fire-and-forget after the response, no-op if throttled or called outside a request scope, never throws. */
export function scheduleAutoMeasure(tenantId: string): void {
  if (!tenantId) return;
  const nowMs = Date.now();
  if (nowMs - (lastRunAt.get(tenantId) ?? 0) < MIN_GAP_MS) return; // collapse rapid renders (one pass per window)
  try {
    after(() => settleDueMeasurements(tenantId));
    lastRunAt.set(tenantId, nowMs);
  } catch {
    // after() is only valid inside a request scope - ignore outside one.
  }
}
