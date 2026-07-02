import { describe, it, expect } from "vitest";

import {
  compareShadowPortfolio,
  buildShadowCalibrationFeed,
  MIN_COHORT_SIZE,
  MIN_WINDOW_DAYS,
  MIN_ROWS_FOR_CALIBRATION_FEED,
  type SelectedPickDriftRow,
  type ShadowDriftRow,
  type ShadowForecastDriftRow,
} from "@/domains/proof-gsc/shadow-portfolio-drift";

/**
 * Pure-math matrix for the shadow portfolio drift comparison (BEACON_500 item 65). Distinct from
 * portfolio-counterfactual.ts (item 41): this compares the SELECTED (shipped) cohort's already
 * diff-in-diff adjusted lift against the SHADOW (rejected-but-eligible, never shipped) cohort's
 * raw click drift over a matched window - a claim about the picking process, not about any one
 * change's own comparison pages.
 */

function selRow(over: Partial<SelectedPickDriftRow> = {}): SelectedPickDriftRow {
  return { id: "s1", adjustedPct: 0.1, windowDays: 28, ...over };
}
function shadowRow(over: Partial<ShadowDriftRow> = {}): ShadowDriftRow {
  return { id: "d1", rawDelta: 2, scaledBaseline: 100, windowDays: 28, ...over };
}

describe("compareShadowPortfolio - honest minimum", () => {
  it("returns null when the selected cohort is below the minimum", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE - 1 }, (_, i) => selRow({ id: `s${i}` }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}` }));
    expect(compareShadowPortfolio(selected, shadow)).toBeNull();
  });

  it("returns null when the shadow cohort is below the minimum", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}` }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE - 1 }, (_, i) => shadowRow({ id: `d${i}` }));
    expect(compareShadowPortfolio(selected, shadow)).toBeNull();
  });

  it("returns null when BOTH cohorts are empty", () => {
    expect(compareShadowPortfolio([], [])).toBeNull();
  });

  it("returns a result exactly AT the minimum on both sides", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}` }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}` }));
    expect(compareShadowPortfolio(selected, shadow)).not.toBeNull();
  });

  it("honors a custom minCohortSize override", () => {
    const selected = [selRow({ id: "a" }), selRow({ id: "b" })];
    const shadow = [shadowRow({ id: "x" }), shadowRow({ id: "y" })];
    expect(compareShadowPortfolio(selected, shadow, 2)).not.toBeNull();
    expect(compareShadowPortfolio(selected, shadow, 3)).toBeNull();
  });
});

describe("compareShadowPortfolio - window gate", () => {
  it("excludes selected rows whose window is shorter than MIN_WINDOW_DAYS", () => {
    const selected = [
      ...Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}` })),
      selRow({ id: "short", windowDays: 7 }),
    ];
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}` }));
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.selectedN).toBe(MIN_COHORT_SIZE);
  });

  it("excludes shadow rows whose window is shorter than MIN_WINDOW_DAYS", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}` }));
    const shadow = [
      ...Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}` })),
      shadowRow({ id: "short", windowDays: MIN_WINDOW_DAYS - 1 }),
    ];
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.shadowN).toBe(MIN_COHORT_SIZE);
  });

  it("a window exactly AT MIN_WINDOW_DAYS counts", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}`, windowDays: MIN_WINDOW_DAYS }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}`, windowDays: MIN_WINDOW_DAYS }));
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.selectedN).toBe(MIN_COHORT_SIZE);
    expect(r.shadowN).toBe(MIN_COHORT_SIZE);
  });
});

describe("compareShadowPortfolio - exclusion gates", () => {
  it("excludes shadow rows with a zero or negative scaledBaseline", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}` }));
    const shadow = [
      shadowRow({ id: "a", scaledBaseline: 0 }),
      shadowRow({ id: "b", scaledBaseline: -5 }),
      ...Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `ok${i}` })),
    ];
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.shadowN).toBe(MIN_COHORT_SIZE);
  });

  it("excludes non-finite deltas on either side", () => {
    const selected = [
      selRow({ id: "nan", adjustedPct: Number.NaN }),
      ...Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}` })),
    ];
    const shadow = [
      shadowRow({ id: "nan", rawDelta: Number.NaN }),
      ...Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}` })),
    ];
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.selectedN).toBe(MIN_COHORT_SIZE);
    expect(r.shadowN).toBe(MIN_COHORT_SIZE);
  });
});

describe("compareShadowPortfolio - percent math", () => {
  it("selected up, shadow flat: names both directions honestly", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}`, adjustedPct: 0.09 }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}`, rawDelta: 2, scaledBaseline: 100 }));
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.selectedPct).toBeCloseTo(0.09, 5);
    expect(r.shadowPct).toBeCloseTo(0.02, 5);
    expect(r.spreadPct).toBeCloseTo(0.07, 5);
    expect(r.sentence).toMatch(/moved up about 9 percent/);
    expect(r.sentence).toMatch(/moved up about 2 percent/);
  });

  it("shadow cohort also declines: a real loss reads honestly", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}`, adjustedPct: 0.05 }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}`, rawDelta: -8, scaledBaseline: 100 }));
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.shadowPct).toBeCloseTo(-0.08, 5);
    expect(r.sentence).toMatch(/skipped moved down about 8 percent/);
  });

  it("consistency: spreadPct always equals selectedPct minus shadowPct", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}`, adjustedPct: 0.03 * (i + 1) }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}`, rawDelta: i, scaledBaseline: 50 }));
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.spreadPct).toBeCloseTo(r.selectedPct - r.shadowPct, 10);
  });

  it("is deterministic - same inputs, same output every call", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}` }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}` }));
    expect(compareShadowPortfolio(selected, shadow)).toEqual(compareShadowPortfolio(selected, shadow));
  });
});

describe("compareShadowPortfolio - no em/en dashes (hard rule)", () => {
  it("never emits an em or en dash in the sentence", () => {
    const selected = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => selRow({ id: `s${i}`, adjustedPct: 0.09 }));
    const shadow = Array.from({ length: MIN_COHORT_SIZE }, (_, i) => shadowRow({ id: `d${i}`, rawDelta: -3, scaledBaseline: 100 }));
    const r = compareShadowPortfolio(selected, shadow)!;
    expect(r.sentence).not.toMatch(/[–—]/);
  });
});

// ── Calibration feed (item 65 part 4) ──

function forecastRow(over: Partial<ShadowForecastDriftRow> = {}): ShadowForecastDriftRow {
  return { id: "f1", rawDelta: 6, windowDays: 30, forecastLow: 5, forecastHigh: 15, ...over };
}

describe("buildShadowCalibrationFeed - honest minimum", () => {
  it("returns null below MIN_ROWS_FOR_CALIBRATION_FEED", () => {
    const rows = Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED - 1 }, (_, i) => forecastRow({ id: `f${i}` }));
    expect(buildShadowCalibrationFeed(rows)).toBeNull();
  });

  it("returns a result exactly at the minimum", () => {
    const rows = Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) => forecastRow({ id: `f${i}` }));
    expect(buildShadowCalibrationFeed(rows)).not.toBeNull();
  });

  it("returns null on an empty array", () => {
    expect(buildShadowCalibrationFeed([])).toBeNull();
  });
});

describe("buildShadowCalibrationFeed - exclusion gates", () => {
  it("excludes rows shorter than MIN_WINDOW_DAYS", () => {
    const rows = [
      ...Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) => forecastRow({ id: `f${i}` })),
      forecastRow({ id: "short", windowDays: 7 }),
    ];
    const r = buildShadowCalibrationFeed(rows)!;
    expect(r.n).toBe(MIN_ROWS_FOR_CALIBRATION_FEED);
  });

  it("excludes rows with an inverted or negative forecast range", () => {
    const rows = [
      ...Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) => forecastRow({ id: `f${i}` })),
      forecastRow({ id: "inverted", forecastLow: 20, forecastHigh: 5 }),
      forecastRow({ id: "negative", forecastLow: -5, forecastHigh: 10 }),
    ];
    const r = buildShadowCalibrationFeed(rows)!;
    expect(r.n).toBe(MIN_ROWS_FOR_CALIBRATION_FEED);
  });
});

describe("buildShadowCalibrationFeed - math", () => {
  it("computes the actual-per-month from rawDelta prorated over windowDays", () => {
    const rows = Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) => forecastRow({ id: `f${i}`, rawDelta: 30, windowDays: 30 }));
    const feed = buildShadowCalibrationFeed(rows)!;
    expect(feed.avgActualPerMonth).toBeCloseTo(30, 5); // 30 clicks over exactly 30 days = 30/month
  });

  it("computes the average forecast midpoint", () => {
    const rows = Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) => forecastRow({ id: `f${i}`, forecastLow: 10, forecastHigh: 20 }));
    const feed = buildShadowCalibrationFeed(rows)!;
    expect(feed.avgForecastMidpointPerMonth).toBeCloseTo(15, 5);
  });

  it("driftToForecastRatio is actual over forecast midpoint", () => {
    const rows = Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) => forecastRow({ id: `f${i}`, rawDelta: 15, windowDays: 30, forecastLow: 10, forecastHigh: 20 }));
    const feed = buildShadowCalibrationFeed(rows)!;
    expect(feed.driftToForecastRatio).toBeCloseTo(1, 5); // 15 actual vs midpoint 15
  });

  it("driftToForecastRatio is 0 when the forecast midpoint is non-positive (never divides by zero)", () => {
    const rows = Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) => forecastRow({ id: `f${i}`, forecastLow: 0, forecastHigh: 0 }));
    const feed = buildShadowCalibrationFeed(rows)!;
    expect(feed.driftToForecastRatio).toBe(0);
  });

  it("is deterministic - same inputs, same output every call", () => {
    const rows = Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) => forecastRow({ id: `f${i}` }));
    expect(buildShadowCalibrationFeed(rows)).toEqual(buildShadowCalibrationFeed(rows));
  });
});
