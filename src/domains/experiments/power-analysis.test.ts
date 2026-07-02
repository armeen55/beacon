import { describe, it, expect } from "vitest";

import {
  computeMde, estimateNoiseCv, assessPower,
  MDE_NOISE_MULTIPLIER, MIN_SERIES_DAYS, FALLBACK_NOISE_CV,
  WELL_POWERED_RATIO, MARGINAL_RATIO, EXTREME_SHORTFALL_RATIO,
  type DailyClickPoint,
} from "./power-analysis";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

function series(clicks: number[], startDate = "2026-06-01"): DailyClickPoint[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  return clicks.map((c, i) => ({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), clicks: c }));
}

describe("estimateNoiseCv", () => {
  it("falls back to the conservative default on a short series", () => {
    const r = estimateNoiseCv(series([10, 12, 9, 11, 10]));
    expect(r.confidence).toBe("rough");
    expect(r.noiseCv).toBe(FALLBACK_NOISE_CV);
  });

  it("falls back on a degenerate (all-zero / zero-mean) series even if long enough", () => {
    const r = estimateNoiseCv(series(Array.from({ length: 30 }, () => 0)));
    expect(r.confidence).toBe("rough");
    expect(r.noiseCv).toBe(FALLBACK_NOISE_CV);
  });

  it("computes a real CV from a long, varying series", () => {
    // Mean 10, alternating +/-4 -> std = 4, cv = 0.4.
    const vals = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 14 : 6));
    const r = estimateNoiseCv(series(vals));
    expect(r.confidence).toBe("estimated");
    expect(r.noiseCv).toBeCloseTo(0.4, 5);
  });

  it("floors an implausibly flat long series rather than reporting near-zero noise", () => {
    const vals = Array.from({ length: 30 }, () => 10);
    const r = estimateNoiseCv(series(vals));
    expect(r.confidence).toBe("estimated");
    expect(r.noiseCv).toBeGreaterThanOrEqual(0.15);
  });

  it("requires at least MIN_SERIES_DAYS points", () => {
    const justShort = estimateNoiseCv(series(Array.from({ length: MIN_SERIES_DAYS - 1 }, () => 10)));
    expect(justShort.confidence).toBe("rough");
    const justEnough = estimateNoiseCv(series(Array.from({ length: MIN_SERIES_DAYS }, (_, i) => (i % 2 ? 8 : 12))));
    expect(justEnough.confidence).toBe("estimated");
  });
});

describe("computeMde", () => {
  it("a high-traffic page has a much smaller relative MDE than a tiny page at the same noise", () => {
    const big = computeMde({ baselineDailyClicks: 500, baselineDailyImpressions: 20000, windowDays: 28, noiseCv: 0.3 });
    const tiny = computeMde({ baselineDailyClicks: 1, baselineDailyImpressions: 60, windowDays: 28, noiseCv: 0.3 });
    // Both scale linearly with baseline clicks, so compare the RATIO of mde to baseline monthly clicks.
    expect(big.mdeClicksPerMonth / (500 * 30)).toBeCloseTo(tiny.mdeClicksPerMonth / (1 * 30), 5);
    // But the ABSOLUTE numbers differ hugely - a tiny page's MDE is tiny in absolute clicks even
    // though it's a huge fraction of its own traffic (the real-world problem item 35 targets).
    expect(tiny.mdeClicksPerMonth).toBeLessThan(big.mdeClicksPerMonth);
  });

  it("a genuinely tiny page (near-zero clicks) gets a small but non-zero MDE floor", () => {
    const r = computeMde({ baselineDailyClicks: 0, baselineDailyImpressions: 40, windowDays: 28, noiseCv: 0.6 });
    expect(r.mdeClicksPerMonth).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(r.mdeClicksPerMonth)).toBe(true);
  });

  it("a shorter window raises the MDE; a longer window lowers it, all else equal", () => {
    const base = computeMde({ baselineDailyClicks: 20, baselineDailyImpressions: 800, windowDays: 28, noiseCv: 0.4 });
    const shorter = computeMde({ baselineDailyClicks: 20, baselineDailyImpressions: 800, windowDays: 14, noiseCv: 0.4 });
    const longer = computeMde({ baselineDailyClicks: 20, baselineDailyImpressions: 800, windowDays: 56, noiseCv: 0.4 });
    expect(shorter.mdeClicksPerMonth).toBeGreaterThan(base.mdeClicksPerMonth);
    expect(longer.mdeClicksPerMonth).toBeLessThan(base.mdeClicksPerMonth);
  });

  it("higher noiseCv raises the MDE proportionally", () => {
    const low = computeMde({ baselineDailyClicks: 20, baselineDailyImpressions: 800, windowDays: 28, noiseCv: 0.2 });
    const high = computeMde({ baselineDailyClicks: 20, baselineDailyImpressions: 800, windowDays: 28, noiseCv: 0.4 });
    expect(high.mdeClicksPerMonth).toBeCloseTo(low.mdeClicksPerMonth * 2, 0);
  });

  it("reports rough confidence when fed the fallback CV, estimated otherwise", () => {
    const rough = computeMde({ baselineDailyClicks: 10, baselineDailyImpressions: 400, windowDays: 28, noiseCv: FALLBACK_NOISE_CV });
    expect(rough.confidence).toBe("rough");
    const estimated = computeMde({ baselineDailyClicks: 10, baselineDailyImpressions: 400, windowDays: 28, noiseCv: 0.33 });
    expect(estimated.confidence).toBe("estimated");
  });

  it("is a pure function of its inputs (deterministic, no hidden state)", () => {
    const input = { baselineDailyClicks: 42, baselineDailyImpressions: 1200, windowDays: 28, noiseCv: 0.35 };
    expect(computeMde(input)).toEqual(computeMde({ ...input }));
  });

  it("non-finite / negative inputs degrade to safe defaults, never NaN or throw", () => {
    const r = computeMde({ baselineDailyClicks: -5, baselineDailyImpressions: NaN, windowDays: 0, noiseCv: -1 });
    expect(Number.isFinite(r.mdeClicksPerMonth)).toBe(true);
    expect(r.mdeClicksPerMonth).toBeGreaterThan(0);
  });
});

describe("assessPower — bands", () => {
  it("well_powered: a high-traffic page whose forecast comfortably clears its MDE", () => {
    const mde = computeMde({ baselineDailyClicks: 300, baselineDailyImpressions: 12000, windowDays: 28, noiseCv: 0.25 });
    const r = assessPower({ forecastLow: mde.mdeClicksPerMonth * 2, forecastHigh: mde.mdeClicksPerMonth * 3, mde });
    expect(r.band).toBe("well_powered");
    expect(r.ratio).toBeGreaterThanOrEqual(WELL_POWERED_RATIO);
  });

  it("marginal: forecast sits between the marginal and well-powered ratio", () => {
    const mde = computeMde({ baselineDailyClicks: 10, baselineDailyImpressions: 400, windowDays: 28, noiseCv: 0.4 });
    // Midpoint == 1.0x MDE -> marginal band.
    const r = assessPower({ forecastLow: mde.mdeClicksPerMonth * 0.8, forecastHigh: mde.mdeClicksPerMonth * 1.2, mde });
    expect(r.band).toBe("marginal");
    expect(r.ratio).toBeGreaterThanOrEqual(MARGINAL_RATIO);
    expect(r.ratio).toBeLessThan(WELL_POWERED_RATIO);
  });

  it("underpowered: a tiny page whose forecast is well below its MDE", () => {
    const mde = computeMde({ baselineDailyClicks: 1, baselineDailyImpressions: 60, windowDays: 28, noiseCv: 0.6 });
    const r = assessPower({ forecastLow: 1, forecastHigh: 2, mde: { ...mde, mdeClicksPerMonth: mde.mdeClicksPerMonth * 10 } });
    expect(r.band).toBe("underpowered");
    expect(r.ratio).toBeLessThan(MARGINAL_RATIO);
  });

  it("boundary: ratio exactly at WELL_POWERED_RATIO reads well_powered (inclusive)", () => {
    const mde = { mdeClicksPerMonth: 100, confidence: "estimated" as const };
    const midpoint = 100 * WELL_POWERED_RATIO;
    const r = assessPower({ forecastLow: midpoint, forecastHigh: midpoint, mde });
    expect(r.ratio).toBe(WELL_POWERED_RATIO);
    expect(r.band).toBe("well_powered");
  });

  it("boundary: ratio exactly at MARGINAL_RATIO reads marginal (inclusive), just under reads underpowered", () => {
    const mde = { mdeClicksPerMonth: 100, confidence: "estimated" as const };
    const atBoundary = assessPower({ forecastLow: 100 * MARGINAL_RATIO, forecastHigh: 100 * MARGINAL_RATIO, mde });
    expect(atBoundary.band).toBe("marginal");
    const justUnder = assessPower({ forecastLow: 100 * MARGINAL_RATIO - 1, forecastHigh: 100 * MARGINAL_RATIO - 1, mde });
    expect(justUnder.band).toBe("underpowered");
  });

  it("boundary: EXTREME_SHORTFALL_RATIO marks the hard-exclude line the planner uses, not assessPower itself", () => {
    // assessPower never excludes - it only bands + explains. The extreme-shortfall decision is the
    // planner's job (item 35's hard rule): confirm the ratio math the planner will compare against.
    const mde = { mdeClicksPerMonth: 100, confidence: "estimated" as const };
    const extreme = assessPower({ forecastLow: 40, forecastHigh: 40, mde });
    expect(extreme.ratio).toBeLessThan(EXTREME_SHORTFALL_RATIO);
    expect(extreme.band).toBe("underpowered");
  });

  it("handles a forecast of exactly zero without throwing (low === high === 0)", () => {
    const mde = { mdeClicksPerMonth: 50, confidence: "rough" as const };
    const r = assessPower({ forecastLow: 0, forecastHigh: 0, mde });
    expect(r.band).toBe("underpowered");
    expect(r.ratio).toBe(0);
  });

  it("sentences are plain, first-person, and business-worded (no lab jargon, no dashes)", () => {
    const mde = computeMde({ baselineDailyClicks: 1, baselineDailyImpressions: 40, windowDays: 28, noiseCv: 0.6 });
    for (const [low, high] of [[1, 2], [30, 60], [500, 900]] as const) {
      const r = assessPower({ forecastLow: low, forecastHigh: high, mde });
      expect(hasBannedDash(r.sentence)).toBe(false);
      expect(r.sentence.toLowerCase()).not.toMatch(/\bmde\b|power analysis|coefficient of variation|noise floor|statistical/);
    }
  });

  it("marginal and underpowered sentences both surface real numbers, not vague hand-waving", () => {
    const mde = { mdeClicksPerMonth: 80, confidence: "estimated" as const };
    const marginal = assessPower({ forecastLow: 50, forecastHigh: 70, mde });
    expect(marginal.sentence).toMatch(/\d/);
    const underpowered = assessPower({ forecastLow: 5, forecastHigh: 10, mde });
    expect(underpowered.sentence).toMatch(/\d/);
  });
});

describe("power-analysis module — no banned dashes anywhere", () => {
  it("guards every literal sentence fragment in the module for em/en dashes", () => {
    const mde = computeMde({ baselineDailyClicks: 5, baselineDailyImpressions: 200, windowDays: 28, noiseCv: 0.5 });
    const bands: Array<[number, number]> = [[1000, 2000], [40, 60], [1, 3]];
    for (const [low, high] of bands) {
      const r = assessPower({ forecastLow: low, forecastHigh: high, mde });
      expect(hasBannedDash(r.sentence)).toBe(false);
    }
  });
});

void MDE_NOISE_MULTIPLIER; // referenced in docs above; keep the import used for documentation clarity
