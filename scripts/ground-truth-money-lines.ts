/**
 * Ground-truth the lifetime-earnings odometer + portfolio counterfactual (BEACON_500 items 40 +
 * 41) against REAL Iranopedia data. Read-only: calls the exact loaders scoreboard-section.tsx uses
 * (loadProofLedgerCached for the re-measured ledger, buildLifetimeEarningsRows /
 * buildCounterfactualRows for the eligibility gate) and prints the sentences that would render on
 * Today right now. NO paid calls, no writes.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-money-lines.ts
 */

import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
import { buildShockWindows } from "@/domains/proof-gsc/algorithm-weather";
import { buildLifetimeEarningsRows, buildCounterfactualRows } from "@/app/(shell)/scoreboard-section";
import { computeLifetimeEarnings } from "@/domains/proof-gsc/lifetime-earnings";
import { computePortfolioCounterfactual } from "@/domains/proof-gsc/portfolio-counterfactual";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
process.env.BEACON_TENANT_ID = TENANT;

async function main() {
  console.log(`\n=== items 40+41 money-lines ground-truth - tenant=${TENANT} ===\n`);

  const now = new Date();
  const ledger = await loadProofLedgerCached(TENANT);
  console.log(`Ledger rows (re-measured): ${ledger.length}`);
  const byVerdict: Record<string, number> = {};
  for (const r of ledger) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  console.log("Verdict breakdown:", JSON.stringify(byVerdict));

  const changepoints = await loadDetectedChangepoints(TENANT).catch(() => []);
  const shockWindows = buildShockWindows({ dailySeries: [], priorChangepoints: changepoints });
  console.log(`Detected shock windows: ${shockWindows.length}`);

  console.log("\n--- item 40: lifetime earnings odometer ---");
  const earningsRows = buildLifetimeEarningsRows(ledger, now, shockWindows);
  console.log(`Mature/clean/won rows with a ran traffic outcome: ${earningsRows.length}`);
  for (const r of earningsRows) {
    console.log(`  id=${r.id} extraSessionsPerMonth=${r.extraSessionsPerMonth.toFixed(2)} usdPerMonth=${r.usdPerMonth ?? "null"} daysLive=${r.daysLive}`);
  }
  const earnings = computeLifetimeEarnings(earningsRows);
  console.log(earnings ? `SENTENCE: "${earnings.sentence}"` : "SENTENCE: (null - self-hides, zero mature wins)");

  console.log("\n--- item 41: portfolio counterfactual ---");
  const cfRows = buildCounterfactualRows(ledger, now, shockWindows);
  console.log(`Mature/clean rows (won+lost) with a usable percent: ${cfRows.length}`);
  for (const r of cfRows) {
    console.log(`  id=${r.id} treatedDelta=${r.treatedDelta} controlDelta=${r.controlDelta} scaledBaseline=${r.scaledBaseline.toFixed(1)} controlsUsed=${r.controlsUsed}`);
  }
  const cf = computePortfolioCounterfactual(cfRows);
  console.log(cf ? `SENTENCE: "${cf.sentence}"` : `SENTENCE: (null - below the honest minimum of 3 rows, have ${cfRows.length})`);

  console.log("\n=== done ===\n");
}

main().catch((e) => {
  console.error("ground-truth-money-lines failed:", e);
  process.exit(1);
});
