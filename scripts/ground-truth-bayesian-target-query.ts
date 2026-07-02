/**
 * Ground-truth read (master plan items 67 + 68) against REAL Iranopedia data.
 * Read-only report: does NOT write anything - it loads the real proof ledger,
 * finds the /famous-iranian-singers shipped-change record, re-runs
 * measureRecord (the exact production path) and reports the real
 * bayesianRead (item 67) and targetQueryRead (item 68) it computes, plus the
 * headline sentence a real operator would see on /proof. No paid calls
 * (rank re-check is disabled via allowRankRecheck=false).
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-bayesian-target-query.ts
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { measureRecord } from "@/domains/proof-gsc/run-measurement";
import { pickProofMetric } from "@/domains/proof-gsc/measure";
import { selectHeadlineSentence } from "@/domains/proof-gsc/bayesian-read";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
process.env.BEACON_TENANT_ID = TENANT;

async function main() {
  console.log(`\n=== bayesian-read + target-query-read ground-truth - tenant=${TENANT} ===\n`);

  const records = await loadShippedChanges();
  console.log(`Ledger rows loaded: ${records.length}`);

  const target = records.find(
    (r) => r.path === "/famous-iranian-singers" || r.path.includes("famous-iranian-singers"),
  );
  if (!target) {
    console.log("No shipped-change record found for /famous-iranian-singers in this tenant's ledger.");
    console.log("Paths present:", records.map((r) => r.path).slice(0, 30));
    return;
  }

  console.log(`Found record: ${target.id} (${target.actionType}) shipped ${target.shippedAt}`);
  console.log(`Target queries on record: ${JSON.stringify(target.targetQueries)}`);
  console.log(`Control pages: ${JSON.stringify(target.controlPages)}`);
  console.log(`Metric judged: ${pickProofMetric(target.actionType)}`);

  const now = new Date();
  const result = await measureRecord(TENANT, target, now, undefined, new Set(), false);

  console.log(`\n--- Stored verdict (UNCHANGED by items 67/68) ---`);
  console.log(`verdict=${result.verdict} confidence=${result.confidence}`);
  console.log(`windows ran: ${result.windows.filter((w) => w.ran).map((w) => w.day).join(", ") || "(none yet)"}`);

  console.log(`\n--- Item 67: bayesianRead ---`);
  if (!result.bayesianRead) {
    console.log("null (position-judged change, or no window has run yet)");
  } else {
    const b = result.bayesianRead;
    console.log(`pWin=${b.pWin}  ci90=[${b.ci90Low}, ${b.ci90High}]  expectedMonthlyLift=${b.expectedMonthlyLift}  smallSample=${b.smallSample}`);
    console.log(`sentence: "${b.sentence}"`);
  }

  console.log(`\n--- Item 68: targetQueryRead ---`);
  if (!result.targetQueryRead || result.targetQueryRead.length === 0) {
    console.log("[] (no target queries, no window has run yet, or every query's data was too thin)");
  } else {
    for (const tq of result.targetQueryRead) {
      console.log(`query="${tq.query}" ctrDelta=${tq.ctrDelta} positionDelta=${tq.positionDelta} controlsUsed=${tq.controlsUsed}`);
      console.log(`  treatedPre=${JSON.stringify(tq.treatedPre)}`);
      console.log(`  treatedPost=${JSON.stringify(tq.treatedPost)}`);
      console.log(`  sentence: "${tq.sentence}"`);
    }
  }

  console.log(`\n--- Results row headline (item 67 upgrade gate) ---`);
  const basis = result.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
  const floorSentence = basis
    ? `(floor-derived sentence; basis day ${basis.day}, adjustedLift=${basis.adjustedLift})`
    : "(measuring, no window closed yet)";
  const headline = selectHeadlineSentence(result.verdict, result.bayesianRead, floorSentence);
  console.log(`Upgraded to Bayesian wording? ${headline !== floorSentence}`);
  console.log(`Rendered headline: "${headline}"`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ground-truth-bayesian-target-query failed:", e);
    process.exit(1);
  });
