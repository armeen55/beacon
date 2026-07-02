/**
 * Ground-truth pooled-verdict pooling (master plan item 34) against REAL Iranopedia data.
 * Read-only report: does NOT write to the pooled-verdicts store (unlike the nightly cron step) -
 * it only groups the real ledger + real plans and reports which (plan, lever) batches qualify for
 * pooling today, and what the pooled verdict says. No paid calls.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-pooled-verdict.ts
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { listPlans } from "@/domains/experiments/daily-experiment-plan-store";
import { groupLedgerRowsByPlanAndLever } from "@/domains/proof-gsc/pooled-verdict-groups";
import { poolBatchLifts, estimateDailyLiftVariance, type PerPageLift } from "@/domains/proof-gsc/pooled-verdict";
import { loadDailyClicksByPathsForTenant } from "@/domains/proof-gsc/daily-series";
import { PROOF_BASELINE_WINDOW_DAYS } from "@/domains/proof-gsc/measure";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { ProofWindowResult } from "@/domains/proof-gsc/measure";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
process.env.BEACON_TENANT_ID = TENANT;

function basisWindowOf(record: ShippedChangeRecord): ProofWindowResult | null {
  const ran = (record.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day);
  return ran[0] ?? null;
}
function percentLiftOf(record: ShippedChangeRecord, basis: ProofWindowResult): number | null {
  const baselineClicks = record.baseline?.clicks ?? 0;
  const scaledBaseline = baselineClicks * (basis.day / PROOF_BASELINE_WINDOW_DAYS);
  if (scaledBaseline <= 0) return null;
  return (basis.adjustedLift / scaledBaseline) * 100;
}

async function main() {
  console.log(`\n=== pooled-verdict ground-truth - tenant=${TENANT} ===\n`);

  const [records, plans] = await Promise.all([loadShippedChanges(), listPlans(TENANT, 60)]);
  console.log(`Ledger rows loaded: ${records.length}`);
  console.log(`Plans loaded (lookback 60): ${plans.length}`);
  for (const p of plans) {
    const itemCount = Object.keys(p.execution?.items ?? {}).length;
    console.log(`  - plan ${p.id} date=${p.date} status=${p.status} selected=${p.selected.length} executionItems=${itemCount}`);
  }

  const groups = groupLedgerRowsByPlanAndLever(records, plans);
  console.log(`\nBatches with >= 3 measured pages under one (plan, lever): ${groups.length}`);
  if (groups.length === 0) {
    console.log("No real batch qualifies for pooling today - report the honest truth: not enough");
    console.log("measured pages yet under any single (planId, actionFamily) group.");
    // Still show what almost-qualified, for the record.
    const linkedOnly = groupLedgerRowsByPlanAndLever(records, plans);
    console.log(`(groupLedgerRowsByPlanAndLever already filters to qualifying only: ${linkedOnly.length})`);
    return;
  }

  const allPaths = [...new Set(groups.flatMap((g) => g.measuredRows.map((r) => r.record.path)))];
  const dailySeries = await loadDailyClicksByPathsForTenant(TENANT, allPaths, 90);

  for (const group of groups) {
    console.log(`\n--- plan ${group.planId} (${group.planDate}) x lever "${group.actionFamily}" ---`);
    console.log(`  allRows=${group.allRows.length} measuredRows=${group.measuredRows.length}`);
    const perPage: PerPageLift[] = [];
    for (const row of group.measuredRows) {
      const basis = basisWindowOf(row.record);
      if (!basis) continue;
      const pct = percentLiftOf(row.record, basis);
      if (pct == null) continue;
      const shipDate = row.record.shippedAt.slice(0, 10);
      const series = dailySeries.get(row.record.path) ?? [];
      const preShip = series.filter((d) => d.date < shipDate).map((d) => d.clicks);
      const variance = estimateDailyLiftVariance(preShip, basis.day);
      perPage.push({ page: row.record.path, adjustedLiftPct: pct, variance });
      console.log(`    ${row.record.path}: basisDay=${basis.day} adjustedLift=${basis.adjustedLift} pct=${pct.toFixed(2)}% variance=${variance.toFixed(3)} preShipDailyPoints=${preShip.length}`);
    }
    if (perPage.length < 3) {
      console.log(`  SKIPPED: only ${perPage.length} pages had a derivable percent lift (need >= 3).`);
      continue;
    }
    const result = poolBatchLifts(perPage);
    console.log(`  POOLED: n=${result.n} pooledLiftPct=${result.pooledLiftPct} standardError=${result.standardError} zScore=${result.zScore} permutationP=${result.permutationP} verdict=${result.verdict}`);
    console.log(`  SENTENCE: ${result.sentence}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ground-truth-pooled-verdict failed:", e);
    process.exit(1);
  });
