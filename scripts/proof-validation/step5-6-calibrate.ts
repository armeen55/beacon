/**
 * Steps 5 and 6: calibrate C4 floors on the CALIBRATION set only, with LOO
 * stability widening, then report the calibration-set FPR for the candidate
 * (labeled "calibration, not evidence" per protocol L1). The evaluation set
 * is not touched.
 *
 * Floors are calibrated per (metric lane, window, tier) on the UNION of the
 * random-page and shadow-selection calibration units, so the floor covers
 * both sampling regimes; the per-selection FPR is still reported separately.
 */

import { calibrateFloor } from "@/domains/proof-gsc/validation/floors";
import { classifyUnit, unitStatOnly } from "@/domains/proof-gsc/validation/unit-runner";
import { permutationP, wilsonInterval } from "@/domains/proof-gsc/validation/stats";
import type { C4Floors, C4Lane, FloorsByTier, TrafficTier } from "@/domains/proof-gsc/validation/types";
import { TRAFFIC_TIERS } from "@/domains/proof-gsc/measure";
import { RUN_ID, loadFrozenConfig, loadSnapshotIndex, loadUnits, stepOutputPath, writeJson } from "./lib";

type JudgedStat = {
  unitId: string;
  selection: string;
  lane: C4Lane;
  windowDays: number;
  tier: TrafficTier;
  family: string;
  shipDate: string;
  shockOverlap: boolean;
  stat: number;
  p: number;
};

async function main(): Promise<void> {
  const { index } = loadSnapshotIndex();
  const { config } = loadFrozenConfig();
  const step3 = loadUnits();
  const calibUnits = step3.units.filter((u) => u.set === "calibration");
  const nullPool = step3.poolPaths.calibration;

  const judged: JudgedStat[] = [];
  const abstained: Array<{ unitId: string; lane: C4Lane; reason: string }> = [];
  let done = 0;
  for (const unit of calibUnits) {
    for (const lane of config.lanes) {
      const c = classifyUnit({ index, unit, lane, config, nullPoolPaths: nullPool });
      const stat = unitStatOnly(c, config);
      if (stat == null || c.nullStats.length < config.permutation.minNullStats) {
        abstained.push({
          unitId: unit.id,
          lane,
          reason: c.read.abstention ?? (c.nullStats.length < config.permutation.minNullStats ? "thin_null" : "no_stat"),
        });
        continue;
      }
      judged.push({
        unitId: unit.id,
        selection: unit.selection,
        lane,
        windowDays: unit.windowDays,
        tier: unit.tier,
        family: unit.family,
        shipDate: unit.shipDate,
        shockOverlap: unit.shockOverlap,
        stat,
        p: permutationP(stat, c.nullStats),
      });
    }
    done += 1;
    if (done % 50 === 0) console.log(`  ... classified ${done}/${calibUnits.length} calibration units`);
  }

  // Step 5: floors per (lane, window, tier) with LOO widening.
  const floors: C4Floors = { clicks: {}, ctr: {} };
  const floorDetails: Array<Record<string, unknown>> = [];
  for (const lane of config.lanes) {
    for (const w of config.windows) {
      const byTier = {} as FloorsByTier;
      for (const tier of TRAFFIC_TIERS) {
        const cell = judged.filter((j) => j.lane === lane && j.windowDays === w && j.tier === tier);
        const entry = calibrateFloor({ stats: cell.map((j) => j.stat), minFloor: config.minFloors[lane] });
        byTier[tier] = entry;
        floorDetails.push({ lane, windowDays: w, tier, ...entry });
      }
      floors[lane][String(w)] = byTier;
    }
  }

  // Step 6: calibration FPR under the calibrated floors (candidate) and
  // under the raw minimum floors (reference variant). Denominator = judged
  // units; abstentions reported separately.
  const decide = (j: JudgedStat, floor: number, calibrated: boolean) =>
    calibrated && Math.abs(j.stat) >= floor && j.p <= config.permutation.alpha;
  const cellFpr = (rows: JudgedStat[], floorOf: (j: JudgedStat) => { floor: number; calibrated: boolean }) => {
    const n = rows.length;
    const hits = rows.filter((j) => {
      const f = floorOf(j);
      return decide(j, f.floor, f.calibrated);
    }).length;
    return { n, hits, fpr: n > 0 ? hits / n : null, wilson95: wilsonInterval(hits, n) };
  };
  const calibratedFloorOf = (j: JudgedStat) => {
    const e = floors[j.lane][String(j.windowDays)]![j.tier];
    return { floor: e.floor, calibrated: e.calibrated };
  };
  const minFloorOf = (j: JudgedStat) => ({ floor: config.minFloors[j.lane], calibrated: true });

  const report: Record<string, unknown> = {};
  for (const selection of ["random", "shadow"]) {
    for (const lane of config.lanes) {
      for (const w of config.windows) {
        const rows = judged.filter((j) => j.selection === selection && j.lane === lane && j.windowDays === w);
        const key = `${selection}:${lane}:${w}`;
        report[key] = {
          calibratedFloors: cellFpr(rows, calibratedFloorOf),
          minFloorsReferenceVariant: cellFpr(rows, minFloorOf),
          byTier: Object.fromEntries(
            TRAFFIC_TIERS.map((tier) => [
              tier,
              cellFpr(rows.filter((j) => j.tier === tier), calibratedFloorOf),
            ]),
          ),
          excludingShockOverlap: cellFpr(rows.filter((j) => !j.shockOverlap), calibratedFloorOf),
        };
      }
    }
  }

  writeJson(stepOutputPath("step5-floors"), {
    runId: RUN_ID,
    label: "calibrated floors, CALIBRATION SET ONLY, LOO widened (protocol step 5)",
    floors,
    floorDetails,
    judgedCount: judged.length,
    abstainedCount: abstained.length,
    abstentionReasons: abstained.reduce<Record<string, number>>((acc, a) => {
      acc[a.reason] = (acc[a.reason] ?? 0) + 1;
      return acc;
    }, {}),
  });
  writeJson(stepOutputPath("step6-calibration-fpr"), {
    runId: RUN_ID,
    label: "CALIBRATION, NOT EVIDENCE (rules were selected on this data; protocol L1 voids these as certification)",
    report,
    judged,
  });
  console.log(`[step5/6] judged ${judged.length} unit-lanes, abstained ${abstained.length}`);
  for (const d of floorDetails) {
    console.log(
      `  floor ${d.lane}/${d.windowDays}d/${d.tier}: ${(d.floor as number).toFixed(5)} calibrated=${d.calibrated} n=${d.n} widened=${d.widened}`,
    );
  }
}

main().catch((e) => {
  console.error("[step5/6] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
