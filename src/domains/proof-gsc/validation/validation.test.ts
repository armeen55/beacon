/**
 * Unit tests for the C4 validation pure modules: statistics, matching,
 * classifier gates, floors, injection. Every test is deterministic; no
 * Date.now, no Math.random, no I/O.
 */

import { describe, expect, it } from "vitest";
import { addDays } from "../measure";
import { buildFrozenConfig } from "./frozen-config";
import { blockBootstrapInterval, log1pSafe, permutationP, percentileInterpolated, wilsonInterval } from "./stats";
import { buildSeriesIndex, preStatsFor, windowAgg, pageFamilyOf, normalizePathKey } from "./series";
import { evaluateCandidate, selectMatchedControls } from "./matching";
import { classifyC4, computeLaneStat, judgedLaneOf } from "./classifier";
import { calibrateFloor } from "./floors";
import { injectedDailyClicks, injectedPostAgg } from "./injection";
import type { SnapshotDailyRow, WindowAgg } from "./types";

const START = "2025-01-01";
const END = "2025-06-30";

/** Deterministic synthetic page rows: steady dailyClicks/dailyImpressions
 *  with an optional post-shift after `shiftFrom`. */
function synthRows(args: {
  path: string;
  dailyClicks: number;
  dailyImpressions: number;
  shiftFrom?: string;
  shiftClicksTo?: number;
}): SnapshotDailyRow[] {
  const rows: SnapshotDailyRow[] = [];
  for (let d = START; d <= END; d = addDays(d, 1)) {
    const shifted = args.shiftFrom != null && d >= args.shiftFrom;
    rows.push({
      path: args.path,
      date: d,
      clicks: shifted ? (args.shiftClicksTo ?? args.dailyClicks) : args.dailyClicks,
      impressions: args.dailyImpressions,
      position: 5,
    });
  }
  return rows;
}

function agg(clicks: number, impressions: number, windowDays: number): WindowAgg {
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: 5,
    daysCovered: windowDays,
    windowDays,
  };
}

const config = buildFrozenConfig({ runId: "test-run", version: "c4-test" });
const calibratedFloor = { floor: 0.1, calibrated: true, n: 30, widened: false };

describe("stats", () => {
  it("wilson interval brackets the point estimate and respects bounds", () => {
    const iv = wilsonInterval(0, 40);
    expect(iv.lower).toBe(0);
    expect(iv.upper).toBeGreaterThan(0.08);
    expect(iv.upper).toBeLessThan(0.1);
    const iv2 = wilsonInterval(2, 40);
    expect(iv2.lower).toBeGreaterThan(0.01);
    expect(iv2.upper).toBeGreaterThan(0.16);
    expect(iv2.upper).toBeLessThan(0.17);
  });

  it("permutationP uses the add-one correction and both tails", () => {
    expect(permutationP(5, [1, -6, 2, -2])).toBeCloseTo(2 / 5);
    expect(permutationP(10, [1, 2, 3])).toBeCloseTo(1 / 4);
  });

  it("block bootstrap is reproducible under the same seed and resamples blocks", () => {
    const units = [
      { block: "a", hit: true },
      { block: "a", hit: true },
      { block: "b", hit: false },
      { block: "c", hit: false },
    ];
    const one = blockBootstrapInterval({ units, seedString: "seed1", resamples: 500 });
    const two = blockBootstrapInterval({ units, seedString: "seed1", resamples: 500 });
    expect(one).toEqual(two);
    expect(one.lower).toBeGreaterThanOrEqual(0);
    expect(one.upper).toBeLessThanOrEqual(1);
    expect(one.lower).toBeLessThanOrEqual(one.upper);
    // Block resampling must reflect the clustered hits: with half the units
    // in one all-hit block, the upper bound sits far above the naive rate.
    expect(one.upper).toBeGreaterThanOrEqual(0.5);
  });

  it("percentileInterpolated is exact at known ranks", () => {
    expect(percentileInterpolated([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentileInterpolated([], 0.95)).toBe(0);
  });
});

describe("series", () => {
  it("window aggregates read exact prefix sums and honest coverage", () => {
    const idx = buildSeriesIndex(synthRows({ path: "/a", dailyClicks: 3, dailyImpressions: 50 }), START, END);
    const w = windowAgg(idx, "/a", "2025-02-01", "2025-03-01");
    expect(w.clicks).toBe(3 * 28);
    expect(w.impressions).toBe(50 * 28);
    expect(w.daysCovered).toBe(28);
    const partial = windowAgg(idx, "/a", "2024-12-25", "2025-01-03");
    expect(partial.daysCovered).toBe(2);
  });

  it("normalizes URLs and paths to one key and classifies families", () => {
    expect(normalizePathKey("https://www.iranopedia.com/iran-animals/red-fox/")).toBe("/iran-animals/red-fox");
    expect(normalizePathKey("/cities")).toBe("/cities");
    expect(pageFamilyOf("/iran-animals/red-fox")).toBe("iran-animals");
    expect(pageFamilyOf("/cities")).toBe("top-level");
    expect(pageFamilyOf("/")).toBe("homepage");
  });
});

describe("matching", () => {
  it("selects on pre-treatment data ONLY: post-window changes cannot alter the selection", () => {
    const ship = "2025-04-01";
    const treated = synthRows({ path: "/t", dailyClicks: 5, dailyImpressions: 100 });
    const candQuietPost = synthRows({ path: "/c", dailyClicks: 5, dailyImpressions: 100 });
    const candCrashPost = synthRows({ path: "/c", dailyClicks: 5, dailyImpressions: 100, shiftFrom: ship, shiftClicksTo: 0 });
    const other = synthRows({ path: "/d", dailyClicks: 5, dailyImpressions: 100 });
    const pick = (candRows: SnapshotDailyRow[]) => {
      const idx = buildSeriesIndex([...treated, ...candRows, ...other], START, END);
      return selectMatchedControls({
        treated: preStatsFor(idx, "/t", ship, 28),
        candidates: [preStatsFor(idx, "/c", ship, 28), preStatsFor(idx, "/d", ship, 28)],
        bands: config.matching,
        minControls: 2,
        maxControls: 3,
        alternateCount: 2,
        salt: "test",
      });
    };
    const a = pick(candQuietPost);
    const b = pick(candCrashPost);
    expect(a).toEqual(b);
    expect(a.controls).toContain("/c");
    expect(a.insufficient).toBe(false);
  });

  it("excludes scale, trend, and variance mismatches with reasons", () => {
    const treated = { path: "/t", clicksPerDay: 4, slope: 0, stdDaily: 2, impressions: 1000, daysCovered: 28 };
    expect(evaluateCandidate(treated, { path: "/big", clicksPerDay: 40, slope: 0, stdDaily: 2, impressions: 9000, daysCovered: 28 }, config.matching).reason).toBe("scale_mismatch");
    expect(evaluateCandidate(treated, { path: "/trend", clicksPerDay: 4, slope: 1.5, stdDaily: 2, impressions: 1000, daysCovered: 28 }, config.matching).reason).toBe("trend_mismatch");
    expect(evaluateCandidate(treated, { path: "/wild", clicksPerDay: 4, slope: 0, stdDaily: 30, impressions: 1000, daysCovered: 28 }, config.matching).reason).toBe("variance_mismatch");
    expect(evaluateCandidate(treated, { path: "/thin", clicksPerDay: 4, slope: 0, stdDaily: 2, impressions: 100, daysCovered: 28 }, config.matching).reason).toBe("below_baseline_impressions");
  });

  it("abstains (insufficient) instead of admitting fallback controls, and respects the reuse cap", () => {
    const treated = { path: "/t", clicksPerDay: 4, slope: 0, stdDaily: 2, impressions: 1000, daysCovered: 28 };
    const bad = { path: "/bad", clicksPerDay: 400, slope: 0, stdDaily: 2, impressions: 90000, daysCovered: 28 };
    const res = selectMatchedControls({
      treated, candidates: [bad], bands: config.matching, minControls: 2, maxControls: 3, alternateCount: 2, salt: "s",
    });
    expect(res.insufficient).toBe(true);
    expect(res.controls).toHaveLength(0);
    const good = (p: string) => ({ path: p, clicksPerDay: 4, slope: 0, stdDaily: 2, impressions: 1000, daysCovered: 28 });
    const usage = new Map<string, number>([["/u1", 5]]);
    const capped = selectMatchedControls({
      treated, candidates: [good("/u1"), good("/u2"), good("/u3")], bands: config.matching,
      minControls: 2, maxControls: 3, alternateCount: 0, usage, reuseCap: 5, salt: "s",
    });
    expect(capped.controls).not.toContain("/u1");
    expect(usage.get("/u2")).toBe(1);
  });
});

describe("classifier", () => {
  const controls = [
    { pre: agg(84, 1400, 28), post: agg(84, 1400, 28) },
    { pre: agg(84, 1400, 28), post: agg(84, 1400, 28) },
  ];
  const base = {
    lane: "clicks" as const,
    treatedPre: agg(84, 1400, 28),
    treatedPost: agg(84, 1400, 28),
    controls,
    controlsInsufficient: false,
    historyComplete: true,
    floorEntry: calibratedFloor,
    nullStats: Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01)),
    config,
  };

  it("clicks statistic is monotone in post clicks (transform monotonicity)", () => {
    expect(log1pSafe(5)).toBeGreaterThan(log1pSafe(4));
    const lo = computeLaneStat({ lane: "clicks", treatedPre: agg(84, 1400, 28), treatedPost: agg(90, 1400, 28), controls, minControls: 2 });
    const hi = computeLaneStat({ lane: "clicks", treatedPre: agg(84, 1400, 28), treatedPost: agg(140, 1400, 28), controls, minControls: 2 });
    if (!lo.ok || !hi.ok) throw new Error("expected stats");
    expect(hi.stat).toBeGreaterThan(lo.stat);
  });

  it("fires every abstention trigger with its own reason", () => {
    expect(classifyC4({ ...base, historyComplete: false }).abstention).toBe("insufficient_history");
    expect(classifyC4({ ...base, treatedPre: agg(10, 150, 28) }).abstention).toBe("insufficient_baseline");
    expect(classifyC4({ ...base, controlsInsufficient: true }).abstention).toBe("no_clean_controls");
    expect(classifyC4({ ...base, lane: "ctr", treatedPost: agg(0, 0, 28) }).abstention).toBe("missing_rate_data");
    expect(classifyC4({ ...base, nullStats: [0.1, 0.2] }).abstention).toBe("thin_null");
  });

  it("gates the VERDICT on the permutation null, not confidence (C6)", () => {
    const bigLift = { ...base, treatedPost: agg(200, 1400, 28) };
    const noisyNull = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 2 : -2));
    const gated = classifyC4({ ...bigLift, nullStats: noisyNull });
    expect(gated.verdict).toBe("no_clear_effect");
    const quiet = classifyC4(bigLift);
    expect(quiet.verdict).toBe("won");
  });

  it("never upgrades: impressions gains cannot create a won (C8) and an uncalibrated tier renders no_clear_effect only (C3)", () => {
    // Flat clicks, impressions exploding: the C4 read has no impressions
    // input at all, so the verdict stays no_clear_effect.
    const flatClicksHugeImpressions = classifyC4({
      ...base,
      treatedPre: agg(84, 1400, 28),
      treatedPost: agg(84, 140000, 28),
    });
    expect(flatClicksHugeImpressions.verdict).toBe("no_clear_effect");
    const uncalibrated = classifyC4({
      ...base,
      treatedPost: agg(500, 1400, 28),
      floorEntry: { floor: 0.1, calibrated: false, n: 3, widened: false },
    });
    expect(uncalibrated.verdict).toBe("no_clear_effect");
  });

  it("decides won and lost symmetrically once floor and gate pass", () => {
    const won = classifyC4({ ...base, treatedPost: agg(200, 1400, 28) });
    const lost = classifyC4({ ...base, treatedPost: agg(20, 1400, 28) });
    expect(won.verdict).toBe("won");
    expect(lost.verdict).toBe("lost");
  });

  it("CTR lane treats zero-impression control windows as missing, abstaining below minControls (L4)", () => {
    const read = classifyC4({
      ...base,
      lane: "ctr",
      controls: [
        { pre: agg(84, 1400, 28), post: agg(84, 1400, 28) },
        { pre: agg(84, 1400, 28), post: agg(0, 0, 28) },
      ],
    });
    expect(read.abstention).toBe("missing_rate_data");
  });

  it("maps position lever actions to the clicks lane (C5)", () => {
    expect(judgedLaneOf("internal_link")).toBe("clicks");
    expect(judgedLaneOf("edit_title")).toBe("ctr");
    expect(judgedLaneOf("section_add")).toBe("clicks");
  });
});

describe("floors", () => {
  it("takes max(minFloor, p95) and marks small tiers uncalibrated", () => {
    const tiny = calibrateFloor({ stats: [0.01, 0.02], minFloor: 0.05 });
    expect(tiny.calibrated).toBe(false);
    expect(tiny.floor).toBe(0.05);
    const stats = Array.from({ length: 40 }, (_, i) => 0.001 * (i + 1));
    const entry = calibrateFloor({ stats, minFloor: 0.005 });
    expect(entry.calibrated).toBe(true);
    expect(entry.floor).toBeGreaterThan(0.03);
  });

  it("LOO widening raises an unstable floor to the LOO max", () => {
    // One extreme unit sits right at the p95 rank: dropping it (or a quiet
    // unit) moves the floor far more than 20 percent, so it must widen to
    // the LOO max.
    const stats = [...Array.from({ length: 19 }, () => 0.01), 10];
    const entry = calibrateFloor({ stats, minFloor: 0.001 });
    const stable = calibrateFloor({ stats: Array.from({ length: 25 }, () => 0.01), minFloor: 0.001 });
    expect(entry.widened).toBe(true);
    expect(entry.floor).toBeGreaterThanOrEqual(stable.floor);
    expect(stable.widened).toBe(false);
  });
});

describe("injection", () => {
  it("scales daily clicks multiplicatively, clamped to [0, impressions]", () => {
    const clicks = [10, 0, 3];
    const impressions = [12, 0, 3];
    const up = injectedDailyClicks({ clicks, impressions, delta: 0.5, variant: "instant" });
    expect(up).toEqual([12, 0, 3]); // 15 clamps to 12 impressions, 4.5 rounds to 5 clamps to 3
    const down = injectedDailyClicks({ clicks, impressions, delta: -0.5, variant: "instant" });
    expect(down).toEqual([5, 0, 2]);
  });

  it("tapered variant ramps over the first 7 days", () => {
    const clicks = Array.from({ length: 14 }, () => 100);
    const impressions = Array.from({ length: 14 }, () => 10000);
    const tapered = injectedDailyClicks({ clicks, impressions, delta: 0.7, variant: "tapered" });
    expect(tapered[0]).toBe(110); // 100 * (1 + 0.7 * 1/7)
    expect(tapered[6]).toBe(170);
    expect(tapered[13]).toBe(170);
    const aggRead = injectedPostAgg({ clicks, impressions, delta: 0.7, variant: "instant", windowDays: 14 });
    expect(aggRead.clicks).toBe(170 * 14);
    expect(aggRead.impressions).toBe(140000);
  });
});
