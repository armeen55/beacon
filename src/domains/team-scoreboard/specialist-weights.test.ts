import { describe, it, expect } from "vitest";
import type { Tally } from "./brier";
import type { BandTally } from "./calibration";
import {
  resolveSpecialistWeight,
  buildSpecialistWeightTable,
  shrinkForBand,
  worstShrinkAcrossBands,
  applyCalibrationShrink,
  MIN_DECIDED,
  MIN_WEIGHT,
  MAX_WEIGHT,
  OVERCONFIDENCE_MARGIN,
  MIN_BAND_SAMPLE_FOR_SHRINK,
  MIN_SHRINK,
  type SpecialistScoreboardCell,
  type ReliabilityWeight,
} from "./specialist-weights";

function tally(over: Partial<Tally> = {}): Tally {
  return { won: 0, flat: 0, lost: 0, n: 0, brier: null, calibrationNote: null, ...over };
}

function band(b: BandTally["band"], n: number, won: number): BandTally {
  return { band: b, n, won, winRatePct: n > 0 ? Math.round((won / n) * 100) : null };
}

const label = (s: string) => (s === "gsc" ? "Search demand" : s === "clarity" ? "Visitor behavior" : s);

describe("resolveSpecialistWeight — MIN_DECIDED gating", () => {
  it("below MIN_DECIDED in both family and overall cells resolves neutral", () => {
    const r = resolveSpecialistWeight("gsc", "answer", { won: 1, lost: 1 }, { won: 1, lost: 0 }, "Search demand");
    expect(r.weight).toBe(1);
    expect(r.basis).toBe("neutral");
    expect(r.tag).toBeNull();
    expect(r.decidedSample).toBe(0);
  });

  it("exactly MIN_DECIDED in the family cell is enough to earn a weight", () => {
    const familyCell = { won: 3, lost: 0 };
    expect(familyCell.won + familyCell.lost).toBe(MIN_DECIDED);
    const r = resolveSpecialistWeight("gsc", "answer", { won: 0, lost: 0 }, familyCell, "Search demand");
    expect(r.basis).toBe("family");
    expect(r.weight).toBeGreaterThan(1);
    expect(r.tag).toContain("Search demand");
    expect(r.tag).toContain("3 of its last 3 winners");
  });

  it("one below MIN_DECIDED in the family cell backs off (does not earn a family weight)", () => {
    const r = resolveSpecialistWeight("gsc", "answer", { won: 0, lost: 0 }, { won: 1, lost: 1 }, "Search demand");
    expect(r.basis).not.toBe("family");
  });
});

describe("resolveSpecialistWeight — backoff to overall", () => {
  it("thin family cell backs off to a proven overall record", () => {
    const overall = { won: 8, lost: 3 }; // 11 decided, clears MIN_DECIDED
    const r = resolveSpecialistWeight("gsc", "answer", overall, { won: 1, lost: 0 }, "Search demand");
    expect(r.basis).toBe("overall");
    expect(r.decidedSample).toBe(11);
    expect(r.won).toBe(8);
    expect(r.tag).toBe("Search demand has called 8 of its last 11 winners overall, so its vote counts a bit more.");
  });

  it("no family cell at all (undefined) also backs off to overall", () => {
    const overall = { won: 2, lost: 6 };
    const r = resolveSpecialistWeight("gsc", "answer", overall, undefined, "Search demand");
    expect(r.basis).toBe("overall");
    expect(r.weight).toBeLessThan(1);
  });

  it("both family and overall thin resolves neutral", () => {
    const r = resolveSpecialistWeight("gsc", "answer", { won: 1, lost: 0 }, { won: 0, lost: 1 }, "Search demand");
    expect(r.basis).toBe("neutral");
    expect(r.weight).toBe(1);
  });
});

describe("resolveSpecialistWeight — clamp band", () => {
  it("a perfect record clamps at MAX_WEIGHT, never exceeds it", () => {
    const r = resolveSpecialistWeight("gsc", "answer", { won: 0, lost: 0 }, { won: 20, lost: 0 }, "Search demand");
    expect(r.weight).toBe(MAX_WEIGHT);
  });

  it("a total-loss record clamps at MIN_WEIGHT, never goes below it", () => {
    const r = resolveSpecialistWeight("gsc", "answer", { won: 0, lost: 0 }, { won: 0, lost: 20 }, "Search demand");
    expect(r.weight).toBe(MIN_WEIGHT);
  });

  it("a 50/50 record resolves to weight 1 (neither boosted nor cut)", () => {
    const r = resolveSpecialistWeight("gsc", "answer", { won: 0, lost: 0 }, { won: 5, lost: 5 }, "Search demand");
    expect(r.weight).toBe(1);
    expect(r.basis).toBe("family"); // still "earned" a resolution, just a neutral-valued one
  });

  it("weight never leaves [MIN_WEIGHT, MAX_WEIGHT] across a range of win rates", () => {
    for (let won = 0; won <= 20; won++) {
      const r = resolveSpecialistWeight("gsc", "answer", { won: 0, lost: 0 }, { won, lost: 20 - won }, "Search demand");
      expect(r.weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
      expect(r.weight).toBeLessThanOrEqual(MAX_WEIGHT);
    }
  });
});

describe("calibration shrink — shrinkForBand", () => {
  it("no shrink below MIN_BAND_SAMPLE_FOR_SHRINK observations", () => {
    const b = band("90+", MIN_BAND_SAMPLE_FOR_SHRINK - 1, 1); // 20% win rate at 90+ stated - would shrink if sampled enough
    expect(shrinkForBand(b)).toBe(1);
  });

  it("no shrink when overshoot is within OVERCONFIDENCE_MARGIN", () => {
    // stated 90, win rate 80 -> overshoot = 90 - 80 - 15 = -5 <= 0
    const b = band("90+", 10, 8);
    expect(shrinkForBand(b)).toBe(1);
  });

  it("shrinks when overshoot exceeds the margin, enough samples", () => {
    // stated 90, win rate 50 -> overshoot = 90 - 50 - 15 = 25 -> shrink = 1 - 25/100 = 0.75, floored at MIN_SHRINK
    const b = band("90+", 10, 5);
    const s = shrinkForBand(b);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThanOrEqual(MIN_SHRINK);
  });

  it("shrink is floored at MIN_SHRINK for extreme overconfidence", () => {
    // stated 90, win rate 0 -> overshoot = 90 - 0 - 15 = 75 -> raw 1 - 0.75 = 0.25, floored
    const b = band("90+", 10, 0);
    expect(shrinkForBand(b)).toBe(MIN_SHRINK);
  });

  it("null winRatePct (n=0 despite band shape) never shrinks", () => {
    const b: BandTally = { band: "80-90", n: 0, won: 0, winRatePct: null };
    expect(shrinkForBand(b)).toBe(1);
  });
});

describe("calibration shrink — worstShrinkAcrossBands", () => {
  it("no bands -> no shrink", () => {
    expect(worstShrinkAcrossBands(undefined)).toBe(1);
    expect(worstShrinkAcrossBands([])).toBe(1);
  });

  it("picks the single worst (smallest) shrink across bands", () => {
    const bands = [band("70-80", 10, 7), band("90+", 10, 3)]; // second band far more overconfident
    const worst = worstShrinkAcrossBands(bands);
    expect(worst).toBe(shrinkForBand(bands[1]!));
    expect(worst).toBeLessThan(shrinkForBand(bands[0]!) === 1 ? 1.001 : 1); // sanity: strictly worse or equal
  });
});

describe("applyCalibrationShrink", () => {
  it("leaves a neutral resolution untouched", () => {
    const neutral: ReliabilityWeight = {
      specialist: "gsc",
      family: "answer",
      weight: 1,
      basis: "neutral",
      decidedSample: 0,
      won: 0,
      lost: 0,
      shrinkApplied: null,
      tag: null,
    };
    const bands = [band("90+", 10, 0)]; // would shrink hard if applied
    const out = applyCalibrationShrink(neutral, bands, "Search demand");
    expect(out).toEqual(neutral);
  });

  it("shrinks an earned weight and re-clamps, replacing the tag", () => {
    const earned: ReliabilityWeight = {
      specialist: "gsc",
      family: "answer",
      weight: MAX_WEIGHT, // maxed out from a good win rate
      basis: "family",
      decidedSample: 10,
      won: 9,
      lost: 1,
      shrinkApplied: null,
      tag: "Search demand has called 9 of its last 10 winners here, so its vote counts a bit more.",
    };
    const bands = [band("90+", 10, 0)]; // chronic overconfidence -> heavy shrink
    const out = applyCalibrationShrink(earned, bands, "Search demand");
    expect(out.weight).toBeLessThan(MAX_WEIGHT);
    expect(out.weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
    expect(out.shrinkApplied).not.toBeNull();
    expect(out.tag).toContain("more confidence than its picks earned");
  });

  it("no-op when no band is chronically overconfident", () => {
    const earned: ReliabilityWeight = {
      specialist: "gsc",
      family: "answer",
      weight: 1.1,
      basis: "family",
      decidedSample: 10,
      won: 8,
      lost: 2,
      shrinkApplied: null,
      tag: "some tag",
    };
    const bands = [band("70-80", 10, 8)]; // well calibrated
    const out = applyCalibrationShrink(earned, bands, "Search demand");
    expect(out).toEqual(earned);
  });
});

describe("buildSpecialistWeightTable", () => {
  it("empty cells array resolves every lookup to neutral (cold-start / byte-identical guarantee)", () => {
    const table = buildSpecialistWeightTable([], label);
    expect(table.get("gsc", "answer")).toEqual({
      specialist: "gsc",
      family: "answer",
      weight: 1,
      basis: "neutral",
      decidedSample: 0,
      won: 0,
      lost: 0,
      shrinkApplied: null,
      tag: null,
    });
  });

  it("resolves a real cell's family weight and folds in calibration shrink", () => {
    const cells: SpecialistScoreboardCell[] = [
      {
        specialist: "gsc",
        overall: tally({ won: 8, lost: 3, n: 11 }),
        byFamily: { answer: tally({ won: 8, lost: 3, n: 11 }) },
        calibrationBands: [band("90+", 10, 4)], // stated 90, realized 40 -> heavy overconfidence
      },
    ];
    const table = buildSpecialistWeightTable(cells, label);
    const r = table.get("gsc", "answer");
    expect(r.basis).toBe("family");
    expect(r.shrinkApplied).not.toBeNull();
    expect(r.weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
    expect(r.weight).toBeLessThanOrEqual(MAX_WEIGHT);
  });

  it("an unknown specialist (never in the scoreboard) resolves neutral", () => {
    const cells: SpecialistScoreboardCell[] = [
      { specialist: "gsc", overall: tally({ won: 8, lost: 3, n: 11 }), byFamily: {} },
    ];
    const table = buildSpecialistWeightTable(cells, label);
    expect(table.get("clarity", "answer").basis).toBe("neutral");
  });

  it("a family never seen for a known specialist backs off to its overall record", () => {
    const cells: SpecialistScoreboardCell[] = [
      { specialist: "gsc", overall: tally({ won: 9, lost: 1, n: 10 }), byFamily: { title: tally({ won: 9, lost: 1, n: 10 }) } },
    ];
    const table = buildSpecialistWeightTable(cells, label);
    const r = table.get("gsc", "answer"); // "answer" family cell doesn't exist for gsc
    expect(r.basis).toBe("overall");
    expect(r.weight).toBeGreaterThan(1);
  });
});
