/**
 * seasonal/seasonal-inflection tests (BEACON_500 item 69).
 *
 * Pins: the core bug this item exists to catch (a measurement window that
 * spans a family's own peak window gets flagged), silence when the profile
 * has no detected windows, silence when the window sits entirely outside any
 * peak, both annual and weekly matches, and the hard no-dash rule.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { computeSeasonalInflection } from "./seasonal-inflection";
import type { FamilyDemandProfile } from "./family-demand-profile";

function profile(over: Partial<FamilyDemandProfile> = {}): FamilyDemandProfile {
  return {
    pageFamily: "cheetah",
    weeksOfHistory: 6,
    yearsOfHistory: 1,
    weekly: [],
    annual: [],
    samplePages: ["/cheetah/page"],
    ...over,
  };
}

describe("computeSeasonalInflection - no signal", () => {
  it("returns no-flag when the profile is null/undefined", () => {
    const out = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-03-01", windowEnd: "2026-03-08", profile: null });
    expect(out.measuredAcrossSeasonalInflection).toBe(false);
    expect(out.caveat).toBeNull();
  });

  it("returns no-flag when the profile has no annual or weekly windows", () => {
    const out = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-03-01", windowEnd: "2026-03-08", profile: profile() });
    expect(out.measuredAcrossSeasonalInflection).toBe(false);
  });

  it("returns no-flag when the window sits entirely outside the annual peak", () => {
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "one_season" }] });
    // Window in July, peak is March - no overlap.
    const out = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-07-01", windowEnd: "2026-07-08", profile: p });
    expect(out.measuredAcrossSeasonalInflection).toBe(false);
  });
});

describe("computeSeasonalInflection - the core bug this item catches", () => {
  it("flags a window that overlaps the family's own annual peak month", () => {
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "repeated" }] });
    // A 28-day window starting inside March.
    const out = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-03-10", windowEnd: "2026-04-07", profile: p });
    expect(out.measuredAcrossSeasonalInflection).toBe(true);
    expect(out.matchedAnnual).toBe(true);
    expect(out.caveat).toBeTruthy();
    expect(out.caveat).toMatch(/March/);
  });

  it("flags a window that STARTS before the peak but overlaps into it (the fake-win trap)", () => {
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "one_season" }] });
    // Shipped Feb 20, 28-day window runs into March.
    const out = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-02-20", windowEnd: "2026-03-20", profile: p });
    expect(out.measuredAcrossSeasonalInflection).toBe(true);
  });

  it("flags a window that overlaps a two-month annual peak", () => {
    const p = profile({ annual: [{ months: [11, 12], share: 0.75, annualImpressions: 9000, confidence: "repeated" }] });
    const out = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-12-01", windowEnd: "2026-12-29", profile: p });
    expect(out.measuredAcrossSeasonalInflection).toBe(true);
    expect(out.caveat).toMatch(/November and December/);
  });

  it("flags a window that overlaps a detected weekly rhythm", () => {
    const p = profile({ weekly: [{ weeks: [23], share: 0.7, observedImpressions: 2000 }] });
    // 2026-06-01 falls in ISO week 23.
    const out = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-05-28", windowEnd: "2026-06-04", profile: p });
    expect(out.measuredAcrossSeasonalInflection).toBe(true);
    expect(out.matchedWeekly).toBe(true);
  });

  it("uses lower-confidence wording for a one_season match vs a repeated match", () => {
    const oneSeason = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "one_season" }] });
    const repeated = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "repeated" }] });
    const a = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-03-10", windowEnd: "2026-03-17", profile: oneSeason });
    const b = computeSeasonalInflection({ pageFamily: "cheetah", windowStart: "2026-03-10", windowEnd: "2026-03-17", profile: repeated });
    expect(a.caveat).toMatch(/showed up once/);
    expect(b.caveat).toMatch(/repeats every year/);
  });
});

describe("dash guard (hard rule)", () => {
  it("the seasonal-inflection module contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "seasonal-inflection.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
