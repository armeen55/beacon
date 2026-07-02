import { describe, expect, it } from "vitest";
import {
  buildPickExpectations,
  forecastRange,
  clampCorrectionFactor,
  CORRECTION_FACTOR_MIN,
  CORRECTION_FACTOR_MAX,
} from "./pick-expectations";

describe("pick-expectations (items 31/34/35)", () => {
  it("forecasts a friendly monthly range from the 90d opportunity", () => {
    // 240 clicks/90d -> 80/mo -> 25%..75% = 20..60
    expect(forecastRange(240)).toEqual({ low: 20, high: 60 });
  });

  it("suppresses a forecast too small to mean anything", () => {
    expect(forecastRange(6)).toBeNull();
    expect(forecastRange(0)).toBeNull();
    expect(forecastRange(NaN)).toBeNull();
  });

  it("writes the three lines for a meta pick", () => {
    const x = buildPickExpectations({ lever: "meta", ctrOpportunityClicks: 240, effortMinutes: 1 });
    expect(x.forecast).toContain("roughly 20 to 60 extra clicks a month");
    expect(x.forecast).toContain("not a promise");
    expect(x.changeOurMind).toContain("If clicks do not move by the 14-day read");
    expect(x.changeOurMind).toContain("a direct answer at the top of the page");
    expect(x.effort).toBe("about 1 minute in your site editor");
  });

  it("omits the forecast but keeps the exit plan on tiny opportunities", () => {
    const x = buildPickExpectations({ lever: "title", ctrOpportunityClicks: 2, effortMinutes: 3 });
    expect(x.forecast).toBeUndefined();
    expect(x.changeOurMind).toContain("a sharper description");
    expect(x.effort).toBe("about 3 minutes in your site editor");
  });
});

describe("pick-expectations - numeric forecast persistence (item 28)", () => {
  it("carries forecastLow/forecastHigh/forecastMetric numerically alongside the prose", () => {
    const x = buildPickExpectations({ lever: "meta", ctrOpportunityClicks: 240, effortMinutes: 1 });
    expect(x.forecastLow).toBe(20);
    expect(x.forecastHigh).toBe(60);
    expect(x.forecastMetric).toBe("clicks_per_month");
  });

  it("omits the numeric fields exactly when the prose forecast is absent", () => {
    const x = buildPickExpectations({ lever: "title", ctrOpportunityClicks: 2, effortMinutes: 3 });
    expect(x.forecastLow).toBeUndefined();
    expect(x.forecastHigh).toBeUndefined();
    expect(x.forecastMetric).toBeUndefined();
  });

  it("old PickExpectations shapes without the numeric fields still satisfy the type (additive)", () => {
    const legacy: import("./pick-expectations").PickExpectations = {
      forecast: "roughly 10 to 20 extra clicks a month",
      changeOurMind: "we roll it back",
      effort: "about 2 minutes",
    };
    expect(legacy.forecastLow).toBeUndefined();
  });
});

describe("pick-expectations - bias-correction factor (item 27)", () => {
  it("defaults to no correction (factor 1.0) and matches the uncorrected range", () => {
    const x = buildPickExpectations({ lever: "meta", ctrOpportunityClicks: 240, effortMinutes: 1 });
    expect(x.forecastLow).toBe(20);
    expect(x.forecastHigh).toBe(60);
    expect(x.forecast).not.toContain("adjusted for our track record here");
  });

  it("shrinks the range when the correction factor is below 1 (forecasts ran hot)", () => {
    const uncorrected = forecastRange(240)!;
    const corrected = forecastRange(240, 0.9)!;
    expect(corrected.low).toBeLessThanOrEqual(uncorrected.low);
    expect(corrected.high).toBeLessThanOrEqual(uncorrected.high);
  });

  it("grows the range when the correction factor is above 1 (forecasts ran cold)", () => {
    const uncorrected = forecastRange(240)!;
    const corrected = forecastRange(240, 1.2)!;
    expect(corrected.low).toBeGreaterThanOrEqual(uncorrected.low);
    expect(corrected.high).toBeGreaterThanOrEqual(uncorrected.high);
  });

  it("names the correction in the prose only when it actually moved the range", () => {
    const x = buildPickExpectations({ lever: "meta", ctrOpportunityClicks: 240, effortMinutes: 1, correctionFactor: 0.85 });
    expect(x.forecast).toContain("adjusted for our track record here");
  });

  it("clamps an extreme correction factor to [0.7, 1.3]", () => {
    expect(clampCorrectionFactor(0.1)).toBe(CORRECTION_FACTOR_MIN);
    expect(clampCorrectionFactor(5)).toBe(CORRECTION_FACTOR_MAX);
    expect(clampCorrectionFactor(NaN)).toBe(1);
  });

  it("fails soft to no correction when correctionFactor is omitted entirely", () => {
    const x = buildPickExpectations({ lever: "meta", ctrOpportunityClicks: 240, effortMinutes: 1 });
    expect(x.forecastLow).toBe(20);
    expect(x.forecastHigh).toBe(60);
  });

  it("never emits an em or en dash in the forecast prose, corrected or not (dash guard)", () => {
    const plain = buildPickExpectations({ lever: "meta", ctrOpportunityClicks: 240, effortMinutes: 1 });
    const corrected = buildPickExpectations({ lever: "meta", ctrOpportunityClicks: 240, effortMinutes: 1, correctionFactor: 0.85 });
    for (const x of [plain, corrected]) {
      expect(x.forecast ?? "").not.toMatch(/[–—]/);
      expect(x.changeOurMind).not.toMatch(/[–—]/);
      expect(x.effort).not.toMatch(/[–—]/);
    }
  });
});
