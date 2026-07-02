/**
 * Ground-truth winner-memory (BEACON_500 item 30) against REAL Iranopedia data.
 *
 * Read-only report: which mature-won shipped changes would be harvested today,
 * and what the answer_block / title / meta few-shot fragments actually say. NO
 * writes to the real store (calls harvestWinners against a real read, but the
 * write target is the same json-store the app already uses - this mirrors what
 * the auto-measure-on-use hook would do on a real /proof visit). NO paid calls.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-winner-memory.ts
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { deriveMeasurementMaturity } from "@/domains/proof-gsc/measurement-maturity";
import { harvestWinners, loadWinners, buildWinnerFewShots } from "@/domains/llm/winner-memory";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
// loadShippedChanges() reads the AMBIENT tenant (currentTenantId(), env BEACON_TENANT_ID
// outside a request context) - override it here so this probe reads Iranopedia's real
// ledger instead of whatever .env.local's default tenant is.
process.env.BEACON_TENANT_ID = TENANT;

async function main() {
  console.log(`\n=== winner-memory ground-truth - tenant=${TENANT} ===\n`);

  const records = await loadShippedChanges();
  console.log(`Ledger rows loaded: ${records.length}`);

  const byVerdict: Record<string, number> = {};
  for (const r of records) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  console.log("Verdict breakdown:", JSON.stringify(byVerdict));

  const now = new Date();
  const won = records.filter((r) => r.verdict === "won");
  console.log(`\nRecords with verdict="won": ${won.length}`);
  for (const r of won) {
    const maturity = deriveMeasurementMaturity({
      shippedAt: r.shippedAt,
      now,
      latestGscDate: r.measuredAt,
      windows: r.windows.map((w) => ({ day: w.day, ran: w.ran })),
      verdict: r.verdict,
      controlsUsed: r.controlPages.length,
      baselineImpressions: r.baseline?.impressions ?? 0,
      live: r.verifiedLive,
    });
    const hasAfter = !!(r.after && r.after.trim());
    const hasBefore = !!(r.before && r.before.trim());
    console.log(
      `  - ${r.page} (${r.actionType}) maturity=${maturity} after=${hasAfter} before=${hasBefore}` +
        (maturity === "mature_result" ? hasAfter ? "  -> WOULD BE HARVESTED" : "  -> mature+won but NO after text (skipped, honest)" : "  -> not mature yet"),
    );
  }

  console.log("\n--- running harvestWinners (writes to the real winner-memory store) ---");
  const result = await harvestWinners(TENANT, { now });
  console.log(`harvested=${result.harvested} families=${result.families}`);

  const winners = await loadWinners(TENANT);
  console.log(`\nRetained winners for ${TENANT}: ${winners.length}`);
  for (const w of winners) {
    console.log(
      `  [${w.actionFamily}] ${w.page}\n` +
        `    before: ${w.beforeText ?? "(none retained)"}\n` +
        `    after:  ${w.afterText}\n` +
        `    features: ${JSON.stringify(w.features)}  lift: ${w.measuredLift}`,
    );
  }

  console.log("\n--- buildWinnerFewShots fragments ---");
  for (const lever of ["answer", "title", "meta", "title_meta", "h1"] as const) {
    const fragment = await buildWinnerFewShots(TENANT, lever);
    console.log(`\n[${lever}] fragment ${fragment === "" ? "(EMPTY - no winners for this lever)" : ""}`);
    if (fragment) console.log(fragment);
  }
}

main().catch((e) => {
  console.error("ground-truth failed:", e);
  process.exit(1);
});
