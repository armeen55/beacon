/**
 * pooled-verdict-groups (2026-07-02, master plan item 34) - PURE assembly: joins ledger rows
 * (shipped_change_proof) back to the daily-experiment plan pick that shipped them, groups same-
 * plan same-lever batches, and hands each qualifying group's measured pages the inputs
 * poolBatchLifts needs. No I/O here - callers pass the already-loaded ledger + plans (mirrors
 * forecast-calibration.ts's posture: pure aggregation, the store/runner does the I/O).
 *
 * The join key: execution.items[pickId].proofId === ledger row id (the SAME link
 * findForecastedPickForProofId (forecast-calibration.ts, item 28) already uses to score a single
 * pick's forecast). Grouping key is (planId, actionFamily) - actionFamilyOf (experiment-
 * eligibility.ts) is the SAME family classifier the contamination/eligibility guard uses, so
 * "same lever" here means the same thing it means everywhere else in the experiment system
 * (title and title_meta collide, meta and title_meta collide, etc. are NOT collapsed together
 * here - only an EXACT family match groups, which is the conservative/honest choice: pooling
 * title-only changes with title+meta changes would blur what actually shipped).
 */

import { actionFamilyOf, type ExperimentFamily } from "@/domains/experiments/experiment-eligibility";
import type { DailyExperimentPlanRecord } from "@/domains/experiments/daily-plan-types";
import type { ShippedChangeRecord } from "./shipped-change-store";
import { MIN_PAGES_TO_POOL } from "./pooled-verdict";

/** One ledger row resolved back to the plan pick that shipped it. */
export type PlanLinkedLedgerRow = {
  record: ShippedChangeRecord;
  planId: string;
  planDate: string;
  pickId: string;
  actionFamily: ExperimentFamily;
};

/**
 * Resolve every ledger row that can be traced to a plan pick via execution.items[pickId].proofId.
 * A row with no matching plan/pick (manual ship, legacy record, or a plan outside the lookback
 * window the caller supplied) is honestly excluded - pooling only ever considers batches Beacon
 * itself planned and shipped as a group, never a coincidental pile of unrelated manual edits.
 */
export function linkLedgerRowsToPlans(
  records: ShippedChangeRecord[],
  plans: DailyExperimentPlanRecord[],
): PlanLinkedLedgerRow[] {
  // proofId -> {planId, planDate, pickId} for every item across every plan (built once, not per
  // ledger row, so this stays linear in plans+items rather than quadratic).
  const byProofId = new Map<string, { planId: string; planDate: string; pickId: string }>();
  for (const plan of plans) {
    const items = plan.execution?.items ?? {};
    for (const [pickId, item] of Object.entries(items)) {
      if (!item.proofId) continue;
      // First plan wins if a proofId were ever (incorrectly) duplicated - stable, deterministic.
      if (!byProofId.has(item.proofId)) {
        byProofId.set(item.proofId, { planId: plan.id, planDate: plan.date, pickId });
      }
    }
  }

  const out: PlanLinkedLedgerRow[] = [];
  for (const record of records) {
    const link = byProofId.get(record.id);
    if (!link) continue;
    out.push({
      record,
      planId: link.planId,
      planDate: link.planDate,
      pickId: link.pickId,
      actionFamily: actionFamilyOf(record.actionType),
    });
  }
  return out;
}

/** A row counts as MEASURED for pooling purposes once at least one of its windows has actually
 *  run (a real diff-in-diff read exists) - it does not need to have reached a final settled
 *  won/lost verdict; pooling exists precisely to extract signal from individually-inconclusive
 *  reads, so requiring a settled per-page verdict first would defeat the purpose. */
function hasMeasuredWindow(record: ShippedChangeRecord): boolean {
  return (record.windows ?? []).some((w) => w.ran);
}

export type BatchGroup = {
  planId: string;
  planDate: string;
  actionFamily: ExperimentFamily;
  /** Every plan-linked row in this (planId, actionFamily) group, including any not yet measured
   *  (so a caller can report "n of m pages have a read yet" honestly). */
  allRows: PlanLinkedLedgerRow[];
  /** The subset with at least one window that has run - what actually feeds the pool. */
  measuredRows: PlanLinkedLedgerRow[];
};

/**
 * Group plan-linked ledger rows by (planId, actionFamily) and keep only groups whose MEASURED
 * subset is >= MIN_PAGES_TO_POOL (the pooling floor poolBatchLifts itself also enforces - checked
 * here too so a caller can cheaply filter "which batches qualify today" without invoking the
 * estimator on batches that would just refuse).
 */
export function groupLedgerRowsByPlanAndLever(
  records: ShippedChangeRecord[],
  plans: DailyExperimentPlanRecord[],
): BatchGroup[] {
  const linked = linkLedgerRowsToPlans(records, plans);
  const byKey = new Map<string, BatchGroup>();
  for (const row of linked) {
    const key = `${row.planId}::${row.actionFamily}`;
    let group = byKey.get(key);
    if (!group) {
      group = { planId: row.planId, planDate: row.planDate, actionFamily: row.actionFamily, allRows: [], measuredRows: [] };
      byKey.set(key, group);
    }
    group.allRows.push(row);
    if (hasMeasuredWindow(row.record)) group.measuredRows.push(row);
  }
  return [...byKey.values()]
    .filter((g) => g.measuredRows.length >= MIN_PAGES_TO_POOL)
    .sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : a.planId.localeCompare(b.planId)));
}
