/** Ground-truth probe (item 53): run the forensic-investigation pipeline over
 *  REAL tenant data, report-only (no store writes unless --persist).
 *
 *  Answers: (1) do any families collapse right now, (2) did the item-32
 *  changepoint detector see the known June 2-5 sitewide clicks drop, (3) would
 *  an investigation trigger fire, and (4) what would the real diagnosis card
 *  say (live polite fetch of max 3 pages + cached SERP + push ledger + weather).
 *
 *  Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *       npx tsx --require ./scripts/mock-server-only.cjs scripts/_investigation-probe.ts */
import { loadFamilyDailyRows } from "@/domains/investigation/load-family-rows";
import { detectFamilyCollapses, biggestFamilyTarget } from "@/domains/investigation/family-collapse";
import { selectTriggers, runInvestigationForTenant } from "@/domains/investigation/run-investigation";
import {
  collectIndexabilityEvidence,
  collectSerpEvidence,
  collectRecentChangeEvidence,
  collectWeatherEvidence,
} from "@/domains/investigation/collect-evidence";
import { rankCauses } from "@/domains/investigation/rank-causes";
import { readAlgorithmWeatherSummary } from "@/domains/proof-gsc/algorithm-weather-store";
import { detectChangepoints } from "@/domains/proof-gsc/changepoint";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");
  const now = new Date();

  // 1. Sitewide changepoints: fresh detection over the real 90d daily totals
  //    (what the nightly item-32 pass computes) + whatever the store has.
  const totals = await loadDailyTotalsForTenant(tenantId, 90);
  const freshClicksCps = detectChangepoints(totals.map((d) => ({ date: d.date, value: d.clicks })));
  const stored = await readAlgorithmWeatherSummary(tenantId, now);
  console.log("=== sitewide changepoints ===");
  console.log("daily totals days:", totals.length, totals.length > 0 ? `(${totals[0]!.date} .. ${totals[totals.length - 1]!.date})` : "");
  console.log("fresh clicks changepoints:", JSON.stringify(freshClicksCps));
  console.log("stored weather row:", stored ? JSON.stringify({ computed_at: stored.computed_at, clicks: stored.clicksChangepoints, impressions: stored.impressionsChangepoints }) : "none");

  // 2. Family-level collapses over the real bounded family rows.
  const t0 = Date.now();
  const rows = await loadFamilyDailyRows(tenantId);
  const collapses = detectFamilyCollapses(rows);
  const biggest = biggestFamilyTarget(rows);
  console.log("\n=== family collapse detection ===");
  console.log("family rows:", rows.length, "load ms:", Date.now() - t0);
  const families = new Set(rows.map((r) => r.page)).size;
  console.log("distinct pages sampled:", families);
  console.log("collapses:", JSON.stringify(collapses, null, 2));
  console.log("biggest family target:", biggest ? `${biggest.family} (${biggest.typicalWeekClicks} clicks/wk, ${biggest.pages.length} pages)` : "none");

  // 3. The trigger decision, exactly as the nightly runner would make it
  //    (stored changepoints preferred; fall back to fresh for reporting).
  const cps = stored?.clicksChangepoints?.length ? stored.clicksChangepoints : freshClicksCps;
  const triggers = selectTriggers({ collapses, sitewideChangepoints: cps, biggestFamily: biggest });
  console.log("\n=== triggers ===");
  console.log(JSON.stringify(triggers, null, 2));

  // 4. For each trigger, the REAL evidence + diagnosis (live fetch <= 3 pages).
  for (const trigger of triggers) {
    const target =
      trigger.source === "family_collapse"
        ? { family: trigger.collapse.family, pages: trigger.collapse.pages, collapseDate: trigger.collapse.collapseDate, dropPct: trigger.collapse.dropPct }
        : trigger.family
          ? { family: trigger.family.family, pages: trigger.family.pages, collapseDate: trigger.changepoint.date, dropPct: null }
          : null;
    if (!target) continue;
    console.log(`\n=== investigating ${target.family} (collapse ${target.collapseDate}) ===`);
    const [indexability, serp, recentChanges, weather] = await Promise.all([
      collectIndexabilityEvidence(target.pages, now),
      collectSerpEvidence(tenantId, target.pages, target.collapseDate, now),
      collectRecentChangeEvidence(tenantId, target.pages, target.collapseDate),
      collectWeatherEvidence(tenantId, target.collapseDate),
    ]);
    console.log("indexability findings:", JSON.stringify(indexability, null, 2));
    console.log("serp findings:", JSON.stringify(serp));
    console.log("recent changes:", JSON.stringify(recentChanges));
    console.log("weather findings:", JSON.stringify(weather));
    const diagnosis = rankCauses({
      familyLabel: target.family,
      collapseDate: target.collapseDate,
      clicksDropPct: target.dropPct,
      indexability,
      serp,
      recentChanges,
      weather,
    });
    console.log("\n--- THE DIAGNOSIS CARD ---");
    console.log("headline:", diagnosis.headline);
    for (const c of diagnosis.causes) {
      console.log(`cause [${c.confidence}] ${c.kind}: ${c.sentence}${c.actionSentence ? ` -> ${c.actionSentence}` : ""}`);
    }
  }

  if (triggers.length === 0) {
    console.log("\nNo investigation would fire tonight (no high-severity collapse, no high-magnitude down changepoint).");
  }

  // 5. Optional: run the actual runner end to end (persists!).
  if (process.argv.includes("--persist")) {
    const result = await runInvestigationForTenant(tenantId, now);
    console.log("\nrunner result (persisted):", JSON.stringify(result));
  }
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
