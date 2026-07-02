/**
 * seasonal/family-demand-profile tests (BEACON_500 item 69).
 *
 * Pins: annual window detection grouped by family (via topPage), weekly
 * window detection grouped by family (via page), the share+floor honesty
 * gates, the MIN_WEEKS_FOR_WEEKLY_PROFILE floor, and the hard no-dash rule.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildFamilyDemandProfiles,
  familyHasInflection,
  FAMILY_SEASONAL_MIN_SHARE,
  FAMILY_SEASONAL_MIN_IMPRESSIONS,
  MIN_WEEKS_FOR_WEEKLY_PROFILE,
  type FamilyMonthlyRow,
  type FamilyDailyRow,
} from "./family-demand-profile";

function monthRow(query: string, month: string, impressions: number, topPage: string): FamilyMonthlyRow {
  return { query, month: `${month}-01`, impressions, clicks: Math.round(impressions * 0.05), topPage };
}

function dailyRow(page: string, date: string, impressions: number): FamilyDailyRow {
  return { page, date, impressions, clicks: Math.round(impressions * 0.05) };
}

describe("buildFamilyDemandProfiles - annual (from monthly archive)", () => {
  it("groups by page family (first path segment) via topPage, not by raw query", () => {
    const monthlyRows: FamilyMonthlyRow[] = [
      monthRow("query a", "2025-03", 3000, "/cheetah/species"),
      monthRow("query b", "2025-03", 2000, "/cheetah/habitat"),
      monthRow("query a", "2025-01", 40, "/cheetah/species"),
      monthRow("query b", "2025-06", 30, "/cheetah/habitat"),
    ];
    const out = buildFamilyDemandProfiles({ monthlyRows, dailyRows: [] });
    expect(out).toHaveLength(1);
    expect(out[0]!.pageFamily).toBe("cheetah");
    expect(out[0]!.annual[0]!.months).toContain(3);
    expect(out[0]!.annual[0]!.share).toBeGreaterThanOrEqual(FAMILY_SEASONAL_MIN_SHARE);
  });

  it("stays silent below the impressions floor", () => {
    const monthlyRows: FamilyMonthlyRow[] = [
      monthRow("q", "2025-03", 50, "/tiny/page"),
      monthRow("q", "2025-01", 5, "/tiny/page"),
    ];
    expect(FAMILY_SEASONAL_MIN_IMPRESSIONS).toBeGreaterThan(50 + 5);
    const out = buildFamilyDemandProfiles({ monthlyRows, dailyRows: [] });
    expect(out).toEqual([]);
  });

  it("stays silent when demand is flat across the year (never fabricates a peak)", () => {
    const monthlyRows: FamilyMonthlyRow[] = Array.from({ length: 12 }, (_, i) =>
      monthRow("q", `2025-${String(i + 1).padStart(2, "0")}`, 100, "/flat/page"),
    );
    const out = buildFamilyDemandProfiles({ monthlyRows, dailyRows: [] });
    expect(out).toEqual([]);
  });

  it("labels confidence 'repeated' only when 2+ distinct years fed the peak window", () => {
    const monthlyRows: FamilyMonthlyRow[] = [
      monthRow("q", "2024-03", 3000, "/repeat/page"),
      monthRow("q", "2025-03", 3200, "/repeat/page"),
      monthRow("q", "2025-06", 40, "/repeat/page"),
    ];
    const out = buildFamilyDemandProfiles({ monthlyRows, dailyRows: [] });
    expect(out[0]!.annual[0]!.confidence).toBe("repeated");
    expect(out[0]!.yearsOfHistory).toBe(2);
  });

  it("rows with no topPage cannot be attributed to a family and are skipped", () => {
    const monthlyRows: FamilyMonthlyRow[] = [
      { query: "q", month: "2025-03-01", impressions: 5000, clicks: 100, topPage: null },
    ];
    const out = buildFamilyDemandProfiles({ monthlyRows, dailyRows: [] });
    expect(out).toEqual([]);
  });
});

describe("buildFamilyDemandProfiles - weekly (from daily page rows)", () => {
  it("requires at least MIN_WEEKS_FOR_WEEKLY_PROFILE distinct weeks before naming a window", () => {
    expect(MIN_WEEKS_FOR_WEEKLY_PROFILE).toBe(4);
    // Only 2 distinct weeks of data - too thin to trust, even if concentrated.
    const dailyRows: FamilyDailyRow[] = [
      dailyRow("/flags/iran", "2026-06-01", 500),
      dailyRow("/flags/iran", "2026-06-02", 500),
      dailyRow("/flags/iran", "2026-06-08", 10),
    ];
    const out = buildFamilyDemandProfiles({ monthlyRows: [], dailyRows });
    expect(out).toEqual([]);
  });

  it("detects a weekly rhythm once enough distinct weeks of data exist", () => {
    // 6 distinct ISO weeks; week containing 2026-06-01 (W23) carries almost all impressions.
    const dailyRows: FamilyDailyRow[] = [
      dailyRow("/flags/iran", "2026-06-01", 2000), // week 23
      dailyRow("/flags/iran", "2026-05-25", 20), // week 22
      dailyRow("/flags/iran", "2026-05-18", 20), // week 21
      dailyRow("/flags/iran", "2026-05-11", 20), // week 20
      dailyRow("/flags/iran", "2026-05-04", 20), // week 19
      dailyRow("/flags/iran", "2026-04-27", 20), // week 18
    ];
    const out = buildFamilyDemandProfiles({ monthlyRows: [], dailyRows });
    expect(out).toHaveLength(1);
    expect(out[0]!.pageFamily).toBe("flags");
    expect(out[0]!.weekly).toHaveLength(1);
    expect(out[0]!.weeksOfHistory).toBeGreaterThanOrEqual(MIN_WEEKS_FOR_WEEKLY_PROFILE);
  });

  it("groups daily rows by page family, not by raw page path", () => {
    const dailyRows: FamilyDailyRow[] = [
      dailyRow("/animals/cheetah", "2026-06-01", 1000),
      dailyRow("/animals/lion", "2026-06-01", 800),
      dailyRow("/animals/cheetah", "2026-05-25", 10),
      dailyRow("/animals/lion", "2026-05-18", 10),
      dailyRow("/animals/cheetah", "2026-05-11", 10),
      dailyRow("/animals/lion", "2026-05-04", 10),
    ];
    const out = buildFamilyDemandProfiles({ monthlyRows: [], dailyRows });
    expect(out).toHaveLength(1);
    expect(out[0]!.pageFamily).toBe("animals");
  });
});

describe("familyHasInflection", () => {
  it("is false for undefined/null/empty profiles", () => {
    expect(familyHasInflection(undefined)).toBe(false);
    expect(familyHasInflection(null)).toBe(false);
    expect(familyHasInflection({ pageFamily: "x", weeksOfHistory: 0, yearsOfHistory: 0, weekly: [], annual: [], samplePages: [] })).toBe(false);
  });

  it("is true when either annual or weekly has a window", () => {
    expect(
      familyHasInflection({
        pageFamily: "x",
        weeksOfHistory: 0,
        yearsOfHistory: 1,
        weekly: [],
        annual: [{ months: [3], share: 0.8, annualImpressions: 3000, confidence: "one_season" }],
        samplePages: [],
      }),
    ).toBe(true);
  });
});

describe("dash guard (hard rule)", () => {
  it("the family-demand-profile module contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "family-demand-profile.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
