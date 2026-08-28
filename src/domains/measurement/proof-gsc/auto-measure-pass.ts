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

import { measureRecord, openChangePaths } from "./measure-pass";
import { contaminatedPaths, contaminationFor } from "./contamination";
import { readLastFinalizedDate } from "./gsc-window";
import { invalidateResultsSurfaceSafe, loadShippedChangesForTenant, upsertShippedChange, type ShippedChangeRecord } from "./shipped-change-store";
import { isDueForMeasure, outcomeStateOf, type OutcomeState } from "./measure-lifecycle";
import { log } from "@/lib/logger";

type AutoMeasureOutcome = {
  id: string;
  path: string;
  actionType: string;
  verdictBefore: string;
  verdictAfter: string;
  state: OutcomeState;
  changed: boolean;
};

type AutoMeasurePassResult = {
  considered: number;
  due: number;
  measured: number;
  changed: number;
  settled: number;
  failed: number;
  outcomes: AutoMeasureOutcome[];
};

/**
 * THE shared measure loop (2026-07-20 consolidation). Both due-row passes — the
 * on-use/action pass (autoMeasureDuePass below) and the cron pass
 * (auto-measure.ts measureDueForTenant) — used to carry byte-identical copies of
 * this loop; the cron file's own comment admitted it was "mirroring
 * auto-measure.ts's cron pass". This is the one copy.
 *
 * It iterates a PRE-FILTERED, pre-ordered due batch, spends the bounded live-SERP
 * rank-recheck budget (MAX_RANK_RECHECKS_PER_PASS) across the WHOLE batch, measures
 * each record with the exact same engine (measureRecord), and persists via the
 * injected writer. The two callers still differ ONLY in what they legitimately
 * must (data source + due gate, control exclusion, recrawl-inspection budget,
 * result shape, settled accounting), so those stay in the callers and flow in as
 * `ctx`; the measurement semantics live here and stay identical for both.
 *
 *   - `persist` returns { ok:false } to count a record as failed WITHOUT throwing
 *     (matches the cron path's upsert-error branch, which incremented errors and
 *     continued). A throw from persist or measureRecord counts the record failed too.
 *   - `onMeasured` fires once per successfully persisted record so each caller keeps
 *     its own settled/changed/outcome accounting.
 *   - `onError` fires once per failed record (the cron path passes none = silent
 *     errors++; the on-use pass logs). Never rethrows.
 */
type MeasureDueContext = {
  now: Date;
  lastFinal: string | null;
  /** THE ONE POLICY. Given the record being measured, the pages that cannot stand behind it over
   *  ITS window. This pass used to hand measureRecord nothing at all, so a scheduled reading was
   *  taken against pages the operator was in the middle of changing. */
  excludeControls: (record: ShippedChangeRecord) => ReadonlySet<string>;
  /** Persist one freshly measured record. Return { ok:false } to count a failure
   *  without throwing. */
  persist: (measured: ShippedChangeRecord) => Promise<{ ok: boolean }>;
  onMeasured?: (before: ShippedChangeRecord, after: ShippedChangeRecord) => void;
  onError?: (record: ShippedChangeRecord, error: unknown) => void;
};

async function measureDueRecords(
  tenantId: string,
  due: ReadonlyArray<ShippedChangeRecord>,
  ctx: MeasureDueContext,
): Promise<{ measured: number; failed: number }> {
  let measured = 0;
  let failed = 0;
  for (const record of due) {
    try {
      const next = await measureRecord(tenantId, record, ctx.now, ctx.lastFinal, ctx.excludeControls(record));
      const { ok } = await ctx.persist(next);
      if (!ok) {
        failed += 1;
        continue;
      }
      measured += 1;
      ctx.onMeasured?.(record, next);
    } catch (e) {
      failed += 1;
      ctx.onError?.(record, e);
    }
  }
  return { measured, failed };
}

/**
 * Re-measure all applied Moves due for a fresh reading. Bounded + fail-soft +
 * cache-first. Returns a full report. NEVER throws.
 */
export async function autoMeasureDuePass(
  tenantId: string,
  opts: { maxRecords?: number; now?: Date; allowPaidRankRecheck?: boolean } = {},
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
    [records, lastFinal] = await Promise.all([loadShippedChangesForTenant(tenantId), readLastFinalizedDate(tenantId)]);
  } catch (e) {
    log.warn("[auto-measure] load failed (non-blocking)", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return result;
  }
  result.considered = records.length;

  const due = records.filter((r) => isDueForMeasure(r, lastFinal, now)).slice(0, max);
  result.due = due.length;

  // The comparison policy is read ONCE for the whole pass and applied per record; the rich
  // per-record accounting (changed / settled / outcomes) rides onMeasured.
  const open = await openChangePaths(tenantId);
  const { measured, failed } = await measureDueRecords(tenantId, due, {
    now,
    lastFinal,
    excludeControls: (record) => contaminatedPaths(contaminationFor(records, open, now, record)),
    persist: async (next) => {
      await upsertShippedChange(next, undefined, { invalidate: false }); // the loop invalidates once, below
      return { ok: true };
    },
    onMeasured: (record, next) => {
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
    },
    onError: (record, e) => {
      log.warn("[auto-measure] record failed (non-blocking)", {
        tenantId,
        id: record.id,
        error: e instanceof Error ? e.message : String(e),
      });
    },
  });
  result.measured = measured;
  result.failed = failed;
  if (measured > 0) await invalidateResultsSurfaceSafe(); // once for the whole pass, never once per record
  return result;
}
