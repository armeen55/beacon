/**
 * Ground-truth the Sprint 3 learning loop on REAL Iranopedia data (2026-06-25).
 *
 * Read-only: auto-measures applied Moves from already-synced GSC/GA4 (NO paid
 * calls, NO publish), then shows what the outcome-prior learned + how it tilts
 * the top moves. Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/run-learning-loop.ts
 */

import { autoMeasureDuePass } from "@/domains/proof-gsc/auto-measure-pass";
import { loadExperimentOutcomes } from "@/domains/learning/load-experiment-outcomes";
import { computeDimPriors } from "@/domains/learning/experiment-prior";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";

async function main() {
  console.log(`\n=== Learning loop ground-truth · tenant=${TENANT} ===\n`);

  console.log("1) AUTO-MEASURE applied Moves (GSC/GA4 already-synced, $0):");
  const pass = await autoMeasureDuePass(TENANT, { maxRecords: 15 });
  console.log(
    `   considered=${pass.considered} due=${pass.due} measured=${pass.measured} changed=${pass.changed} settled=${pass.settled} failed=${pass.failed}`,
  );
  for (const o of pass.outcomes.slice(0, 12)) {
    console.log(`   - ${o.state.padEnd(11)} ${o.verdictBefore}→${o.verdictAfter}  ${o.actionType}  ${o.path}`);
  }

  console.log("\n2) OUTCOME PRIORS learned from the proof ledger:");
  const outcomes = await loadExperimentOutcomes(TENANT);
  const settled = outcomes.filter((o) => o.verdict === "won" || o.verdict === "lost").length;
  console.log(`   ${outcomes.length} ledger records · ${settled} settled (won/lost)`);
  const priors = computeDimPriors(outcomes);
  if (priors.size === 0) {
    console.log("   → no dimension has >= 3 settled outcomes yet → NEUTRAL (no fake learning). Honest.");
  } else {
    for (const p of priors.values()) {
      console.log(`   → ${p.key}: ${p.won}W/${p.lost}L → ×${p.multiplier.toFixed(3)}`);
    }
  }

  console.log("\n3) TOP MOVES with the learned tilt applied:");
  const { graph } = await loadDemandGraphForTenantCached(TENANT);
  for (const m of graph.moves.slice(0, 8)) {
    const lp = m.learnedPrior;
    const tilt = lp && lp.multiplier !== 1 ? ` [×${lp.multiplier.toFixed(3)} — ${lp.tag}]` : "";
    console.log(`   ${String(m.score).padStart(6)}  ${m.gap.padEnd(13)} "${m.label}"${tilt}`);
  }
}

main().catch((e) => {
  console.error("learning-loop ground-truth failed:", e);
  process.exit(1);
});
