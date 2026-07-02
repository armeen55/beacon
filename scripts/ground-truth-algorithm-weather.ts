/**
 * Ground-truth algorithm-weather guard (master plan item 32) against REAL
 * Iranopedia data. Read-only report: does NOT write to algorithm-weather-shocks
 * (unlike the nightly cron step) - it only runs the pure detector over the
 * real daily totals and reports what it finds, plus which current proof
 * verdicts would carry the caveat / lose learning eligibility. No paid calls.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-algorithm-weather.ts
 */

import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { detectChangepoints } from "@/domains/proof-gsc/changepoint";
import { buildShockWindows, overlappingShock } from "@/domains/proof-gsc/algorithm-weather";
import { deriveMeasurementMaturity, measurementWindowOf, buildMeasurementPresentation, detectMeasurementOverlaps } from "@/domains/proof-gsc/measurement-maturity";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
process.env.BEACON_TENANT_ID = TENANT;

async function main() {
  console.log(`\n=== algorithm-weather ground-truth - tenant=${TENANT} ===\n`);

  const totals = await loadDailyTotalsForTenant(TENANT, 90);
  console.log(`Daily totals rows loaded (last 90d): ${totals.length}`);
  if (totals.length > 0) {
    console.log(`  span: ${totals[0]!.date} .. ${totals[totals.length - 1]!.date}`);
  }

  const clicksChangepoints = detectChangepoints(totals.map((d) => ({ date: d.date, value: d.clicks })));
  const impressionsChangepoints = detectChangepoints(totals.map((d) => ({ date: d.date, value: d.impressions })));

  console.log(`\nCUSUM changepoints on CLICKS: ${clicksChangepoints.length}`);
  for (const c of clicksChangepoints) {
    console.log(`  - ${c.date} direction=${c.direction} magnitude=${c.magnitude}`);
  }
  console.log(`\nCUSUM changepoints on IMPRESSIONS: ${impressionsChangepoints.length}`);
  for (const c of impressionsChangepoints) {
    console.log(`  - ${c.date} direction=${c.direction} magnitude=${c.magnitude}`);
  }

  const shockWindows = buildShockWindows({
    dailySeries: [],
    priorChangepoints: [...clicksChangepoints, ...impressionsChangepoints],
  });
  console.log(`\nTotal shock windows (confirmed Google updates + detected): ${shockWindows.length}`);
  for (const s of shockWindows) {
    console.log(`  - [${s.kind}] ${s.start} .. ${s.end}  "${s.label}"`);
  }

  console.log("\n--- checking real proof ledger verdicts against these shock windows ---");
  const records = await loadShippedChanges();
  console.log(`Ledger rows loaded: ${records.length}`);
  if (records.length === 0) {
    console.log("No shipped-change records for this tenant - nothing to check.");
    return;
  }

  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  let quarantinedCount = 0;
  for (const r of records) {
    const basisWin = (r.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
    const maturity = deriveMeasurementMaturity({
      shippedAt: r.shippedAt,
      now,
      latestGscDate: r.measuredAt,
      windows: (r.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
      verdict: r.verdict,
      controlsUsed: basisWin?.controlsUsed ?? 0,
      baselineImpressions: r.baseline?.impressions ?? 0,
      overlap: overlaps.get(r.id) ?? null,
      live: true,
    });
    const window = measurementWindowOf(r.shippedAt, r.windows ?? []);
    const hit = window ? overlappingShock(window.start, window.end, shockWindows) : null;
    if (hit) {
      quarantinedCount += 1;
      const pres = buildMeasurementPresentation({
        shippedAt: r.shippedAt,
        now,
        latestGscDate: r.measuredAt,
        windows: (r.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
        verdict: r.verdict,
        controlsUsed: basisWin?.controlsUsed ?? 0,
        baselineImpressions: r.baseline?.impressions ?? 0,
        overlap: overlaps.get(r.id) ?? null,
        live: true,
        shockWindows,
      });
      console.log(
        `  QUARANTINED: ${r.path} (${r.actionType}) shipped ${r.shippedAt.slice(0, 10)}, window ${window!.start}..${window!.end}, ` +
          `stored verdict=${r.verdict}, maturity=${maturity}, overlapped [${hit.kind}] "${hit.label}"`,
      );
      console.log(`     caveat: ${pres.weatherCaveat}`);
    }
  }
  console.log(`\nTotal verdicts that would carry the weather caveat: ${quarantinedCount} / ${records.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ground-truth-algorithm-weather failed:", e);
    process.exit(1);
  });
