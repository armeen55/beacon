import "server-only";

/**
 * auto-measure-pass (2026-06-25, Sprint 3 / P11) — the AUTO-MEASURE engine. It
 * re-evaluates applied Moves over time WITHOUT an operator click, reusing the
 * existing measurement orchestrator (measureRecord: GSC 7/14/28-day diff-in-diff
 * + GA4 traffic outcome). NO paid calls (GSC/GA4 are already synced), cache-first,
 * fail-soft per record, bounded per pass. NO publish path touched.
 *
 * `isDueForMeasure` is PURE (the testable core): it lifts measureRecord's own
 * finalized-watermark gate to a pre-check, so a pass only spends a read on a
 * record whose verdict could actually change (a window can transition
 * ran:false → true since the last measure).
 */

import { measureRecord } from "./run-measurement";
import { readLastFinalizedDate } from "./gsc-window";
import { loadShippedChanges, upsertShippedChange, type ShippedChangeRecord } from "./shipped-change-store";
import { isDueForMeasure, outcomeStateOf, type OutcomeState } from "./measure-lifecycle";
import { log } from "@/lib/logger";

export type AutoMeasureOutcome = {
  id: string;
  path: string;
  actionType: string;
  verdictBefore: string;
  verdictAfter: string;
  state: OutcomeState;
  changed: boolean;
};

export type AutoMeasurePassResult = {
  considered: number;
  due: number;
  measured: number;
  changed: number;
  settled: number;
  failed: number;
  outcomes: AutoMeasureOutcome[];
};

/**
 * Re-measure all applied Moves due for a fresh reading. Bounded + fail-soft +
 * cache-first. Returns a full report. NEVER throws.
 */
export async function autoMeasureDuePass(
  tenantId: string,
  opts: { maxRecords?: number; now?: Date } = {},
): Promise<AutoMeasurePassResult> {
  const now = opts.now ?? new Date();
  const max = opts.maxRecords ?? 15;
  const result: AutoMeasurePassResult = {
    considered: 0,
    due: 0,
    measured: 0,
    changed: 0,
    settled: 0,
    failed: 0,
    outcomes: [],
  };

  let records: ShippedChangeRecord[] = [];
  let lastFinal: string | null = null;
  try {
    [records, lastFinal] = await Promise.all([loadShippedChanges(), readLastFinalizedDate(tenantId)]);
  } catch (e) {
    log.warn("[auto-measure] load failed (non-blocking)", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return result;
  }
  result.considered = records.length;

  const due = records.filter((r) => isDueForMeasure(r, lastFinal, now)).slice(0, max);
  result.due = due.length;

  for (const record of due) {
    try {
      const next = await measureRecord(tenantId, record, now, lastFinal);
      await upsertShippedChange(next);
      result.measured += 1;
      const changed = next.verdict !== record.verdict;
      if (changed) result.changed += 1;
      if (next.verdict === "won" || next.verdict === "lost") result.settled += 1;
      result.outcomes.push({
        id: next.id,
        path: next.path,
        actionType: next.actionType,
        verdictBefore: record.verdict,
        verdictAfter: next.verdict,
        state: outcomeStateOf(next, now),
        changed,
      });
    } catch (e) {
      result.failed += 1;
      log.warn("[auto-measure] record failed (non-blocking)", {
        tenantId,
        id: record.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}
