/**
 * Ground-truth the empirical-capture band (BEACON_500 item 64) against REAL Iranopedia data.
 * Read-only: reads the exact calibration ledger pick-expectations/build-today-preview consume
 * (loadCalibrationRecords), reports the real per-family distribution derived from it, and then
 * (since Iranopedia has zero mature calibration history right now) walks a FIXTURE-driven example
 * of what the empirical prose would look like once real history exists. No paid calls, no writes.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-empirical-capture.ts
 */

import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import {
  summarizeForecastCalibration,
  captureDistributionFromCalibrationRecords,
  captureObservationsFromCalibrationRecords,
} from "@/domains/experiments/forecast-calibration";
import { blendCaptureBand, MIN_SAMPLES, FULL_EMPIRICAL_SAMPLES } from "@/domains/experiments/empirical-capture";
import { buildPickExpectations, forecastRange } from "@/domains/experiments/pick-expectations";
import type { CalibrationRecord } from "@/domains/experiments/forecast-calibration-store";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
process.env.BEACON_TENANT_ID = TENANT;

async function main() {
  console.log(`\n=== item 64 empirical-capture ground-truth - tenant=${TENANT} ===\n`);

  console.log("--- part 1: REAL Iranopedia calibration ledger ---");
  const records = await loadCalibrationRecords(TENANT);
  console.log(`Calibration records: ${records.length}`);
  const withGap = records.filter((r) => r.gapClicksPerMonth != null && r.gapClicksPerMonth > 0);
  console.log(`Records carrying the item-64 gapClicksPerMonth field: ${withGap.length}`);

  const summary = summarizeForecastCalibration(records);
  console.log(`Portfolio correctionFactor (item 27): ${summary.correctionFactor}`);

  const observations = captureObservationsFromCalibrationRecords(records);
  console.log(`CaptureObservations derivable right now: ${observations.length}`);
  const distribution = captureDistributionFromCalibrationRecords(records);
  console.log(`Families with any mature history: ${distribution.size}`);

  // The honest identity check: with 0 mature outcomes, every family MUST resolve to the untouched
  // static 25/75 band - the whole point of the blend gate. Prove it against the real families this
  // tenant's picks actually use.
  const REAL_FAMILIES = ["edit_page", "answer_block", "internal_links", "create_page", "add_schema"];
  console.log("\nResolved band per real actionFamily (expect static 25/75, isEmpirical=false, while history is thin):");
  for (const fam of REAL_FAMILIES) {
    const band = blendCaptureBand(distribution.get(fam));
    console.log(`  ${fam}: low=${band.low} high=${band.high} n=${band.n} isEmpirical=${band.isEmpirical}`);
  }

  // buildPickExpectations end-to-end with whatever this tenant's REAL state produces - should read
  // exactly like the pre-item-64 sentence while history is thin/absent.
  const realBand = blendCaptureBand(distribution.get("edit_page"));
  const real = buildPickExpectations({
    lever: "title",
    ctrOpportunityClicks: 240,
    effortMinutes: 2,
    correctionFactor: summary.correctionFactor,
    captureBand: { low: realBand.low, high: realBand.high, n: realBand.n, isEmpirical: realBand.isEmpirical },
  });
  console.log(`\nREAL forecast sentence right now (title lever, 240-click 90d opportunity):\n  "${real.forecast}"`);

  console.log("\n--- part 2: FIXTURE-driven example of the empirical prose once history exists ---");
  // Simulate 9 settled title-lever picks (the master-plan's own example: "our last 9 title tests"),
  // each landing a modest 15-40% capture of its targeted gap, on decent-impression pages so
  // shrinkage barely pulls them - exactly the overpromise-correcting scenario item 64 targets.
  const fixtureRecords: CalibrationRecord[] = Array.from({ length: 9 }, (_, i) => {
    const gap = 100; // a clean, round targeted monthly gap for readability
    const captureFrac = 0.15 + (i % 5) * 0.0625; // spread 0.15..0.40
    return {
      pickId: `fixture-${i}`,
      tenantId: TENANT,
      proofId: `fixture-proof-${i}`,
      page: `https://example.com/page-${i}`,
      lever: "title",
      forecastLow: 20,
      forecastHigh: 60,
      actual: gap * captureFrac,
      outcome: "below",
      at: "2026-06-15T00:00:00Z",
      gapClicksPerMonth: gap,
      windowImpressions: 6000, // decent traffic -> shrinkage keeps most of the real signal
    };
  });
  const fixtureDist = captureDistributionFromCalibrationRecords(fixtureRecords);
  const fixtureBand = blendCaptureBand(fixtureDist.get("edit_page")); // canonicalMoveType("title") -> "edit_page"
  console.log(`Fixture band for "edit_page" (title lever's family): low=${fixtureBand.low.toFixed(3)} high=${fixtureBand.high.toFixed(3)} n=${fixtureBand.n} isEmpirical=${fixtureBand.isEmpirical} isFullyEmpirical=${fixtureBand.isFullyEmpirical}`);
  console.log(`(MIN_SAMPLES=${MIN_SAMPLES}, FULL_EMPIRICAL_SAMPLES=${FULL_EMPIRICAL_SAMPLES} - 9 samples sits in the linear blend zone)`);

  const fixturePick = buildPickExpectations({
    lever: "title",
    ctrOpportunityClicks: 240, // -> 80 clicks/mo opportunity, same as the static-band example
    effortMinutes: 2,
    captureBand: { low: fixtureBand.low, high: fixtureBand.high, n: fixtureBand.n, isEmpirical: fixtureBand.isEmpirical },
  });
  console.log(`\nFIXTURE forecast sentence (title lever, 240-click 90d opportunity, 9 settled tests behind it):\n  "${fixturePick.forecast}"`);

  console.log("\nFor comparison, the pre-item-64 static-band sentence for the exact same opportunity:");
  const staticOnly = forecastRange(240);
  console.log(`  static range: ${JSON.stringify(staticOnly)}`);

  console.log("\n=== done ===\n");
}

main().catch((e) => {
  console.error("ground-truth-empirical-capture failed:", e);
  process.exit(1);
});
