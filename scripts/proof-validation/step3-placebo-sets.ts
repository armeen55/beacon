/**
 * Step 3: build the placebo sets (protocol 2.3). Stratified page-hash split
 * disjoint in pages AND calendar, staggered week-aligned pseudo ship dates,
 * control reuse cap, shock-window flags, plus the shadow-selection lane
 * (C9/L3). Persists the unit lists; the EVALUATION list is sealed with its
 * hash in the freeze log.
 */

import { buildShockWindows } from "@/domains/proof-gsc/algorithm-weather";
import { normalizePathKey } from "@/domains/proof-gsc/validation/series";
import {
  buildPool,
  buildRandomUnits,
  buildShadowUnits,
  splitPool,
  CALIBRATION_SHIP_DATES,
  EVALUATION_SHIP_DATES,
} from "@/domains/proof-gsc/validation/placebo-design";
import type { PlaceboUnit } from "@/domains/proof-gsc/validation/types";
import {
  RUN_ID,
  appendFreezeLog,
  loadFrozenConfig,
  loadLedgerRows,
  loadSnapshotIndex,
  loadTotals,
  sha256OfFile,
  stepOutputPath,
  writeJson,
} from "./lib";

async function main(): Promise<void> {
  const { index } = loadSnapshotIndex();
  const { config, sha256: configHash } = loadFrozenConfig();
  const ledger = loadLedgerRows();
  const totals = loadTotals();

  const exclude = new Set<string>();
  for (const r of ledger) {
    exclude.add(normalizePathKey(r.page));
    for (const cp of r.control_pages ?? []) exclude.add(normalizePathKey(cp));
  }
  const pool = buildPool({ index, excludePaths: exclude, minBaselineImpressions: config.minBaselineImpressions });
  const { calibration, evaluation } = splitPool(pool);

  // Shock windows from the snapshot's own daily totals (clicks and
  // impressions CUSUM, merged with the confirmed Google update list).
  const shocks = [
    ...buildShockWindows({ dailySeries: totals.map((t) => ({ date: t.date, value: t.clicks })) }),
    ...buildShockWindows({ dailySeries: totals.map((t) => ({ date: t.date, value: t.impressions })) }).filter(
      (s) => s.kind === "suspected",
    ),
  ];
  const dedupedShocks = [...new Map(shocks.map((s) => [s.id, s])).values()];

  const designs = [
    { set: "calibration" as const, pages: calibration, shipDates: CALIBRATION_SHIP_DATES },
    { set: "evaluation" as const, pages: evaluation, shipDates: EVALUATION_SHIP_DATES },
  ];
  const allUnits: PlaceboUnit[] = [];
  const meta: Record<string, unknown> = {};
  for (const d of designs) {
    for (const windowDays of config.windows) {
      const rand = buildRandomUnits({
        index,
        setPages: d.pages,
        design: { set: d.set, shipDates: d.shipDates },
        windowDays,
        config,
        shocks: dedupedShocks,
      });
      const shadow = buildShadowUnits({
        index,
        unitPagePaths: rand.unitPagePaths,
        pagesByPath: new Map(d.pages.map((p) => [p.path, p])),
        design: { set: d.set, shipDates: d.shipDates },
        windowDays,
        donorPaths: rand.donorPaths,
        config,
        shocks: dedupedShocks,
      });
      allUnits.push(...rand.units, ...shadow);
      meta[`${d.set}:${windowDays}`] = {
        unitPages: rand.unitPagePaths.length,
        donors: rand.donorPaths.length,
        randomUnits: rand.units.length,
        randomMatched: rand.units.filter((u) => !u.controlsInsufficient).length,
        shadowUnits: shadow.length,
        shadowMatched: shadow.filter((u) => !u.controlsInsufficient).length,
      };
    }
  }

  const out = {
    runId: RUN_ID,
    configSha256: configHash,
    shipDates: { calibration: CALIBRATION_SHIP_DATES, evaluation: EVALUATION_SHIP_DATES },
    shocks: dedupedShocks,
    meta,
    poolPaths: {
      calibration: calibration.map((p) => p.path),
      evaluation: evaluation.map((p) => p.path),
    },
    units: allUnits,
  };
  const path = stepOutputPath("step3-units");
  writeJson(path, out);
  const hash = sha256OfFile(path);
  appendFreezeLog({
    step: "step3",
    at: new Date().toISOString(),
    file: path,
    sha256: hash,
    note: `placebo sets sealed: ${allUnits.length} units (${allUnits.filter((u) => u.set === "evaluation").length} evaluation, sealed until step 8)`,
  });
  console.log(`[step3] units ${allUnits.length}, shocks ${dedupedShocks.length}`);
  for (const [k, v] of Object.entries(meta)) console.log(`  ${k} ${JSON.stringify(v)}`);
  console.log(`  sealed sha256 ${hash}`);
}

main().catch((e) => {
  console.error("[step3] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
