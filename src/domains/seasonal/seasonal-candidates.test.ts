/**
 * seasonal/seasonal-candidates tests (BEACON_500 item 63).
 *
 * Pins: bounding (MAX_SEASONAL_CANDIDATES_PER_NIGHT), the 6-8 week lead-window
 * gate, the eligibility gate, the one-card-per-page-per-night guard, the
 * honesty gate (no known top page -> skip), and the hard no-dash rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findSeasonalCandidates,
  MAX_SEASONAL_CANDIDATES_PER_NIGHT,
  SEASONAL_CANDIDATE_LEAD_MIN_WEEKS,
  SEASONAL_CANDIDATE_LEAD_MAX_WEEKS,
} from "./seasonal-candidates";
import type { PeakCalendarEntry } from "./seasonality";
import type { ExperimentEligibility } from "@/domains/experiments/experiment-eligibility";

const CLEAN: ExperimentEligibility = { eligible: true, reason: "clean" };
const BLOCKED: ExperimentEligibility = { eligible: false, reason: "recent_no_lift" };
const NOW = new Date("2026-07-02T00:00:00Z");

function isoWeeksOut(weeks: number): string {
  return new Date(NOW.getTime() + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

function entry(page: string, over: Partial<PeakCalendarEntry> = {}): PeakCalendarEntry {
  return {
    clusterLabel: "Nowruz Table Setting",
    peakMonths: [3],
    confidence: "one_season",
    prepByDate: isoWeeksOut(1),
    peakStartDate: isoWeeksOut(7),
    expectedImpressions: 4000,
    topPage: page,
    sentence: "Searches climb every March.",
    ...over,
  };
}

function eligAll(pages: string[], verdict: ExperimentEligibility = CLEAN): Map<string, ExperimentEligibility> {
  return new Map(pages.map((p) => [p.replace(/^https?:\/\/[^/]+/, "") || "/", verdict]));
}

describe("findSeasonalCandidates - lead window", () => {
  it("emits a candidate whose peak opens exactly 7 weeks out (inside the 6-8 week window)", () => {
    const cal = [entry("/nowruz", { peakStartDate: isoWeeksOut(7) })];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/nowruz"]), now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]!.page).toBe("/nowruz");
    expect(out[0]!.weeksOut).toBe(7);
  });

  it("is silent when the window opens sooner than SEASONAL_CANDIDATE_LEAD_MIN_WEEKS (already the prep-now hint's job)", () => {
    expect(SEASONAL_CANDIDATE_LEAD_MIN_WEEKS).toBe(6);
    const cal = [entry("/soon", { peakStartDate: isoWeeksOut(3) })];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/soon"]), now: NOW });
    expect(out).toEqual([]);
  });

  it("is silent when the window opens later than SEASONAL_CANDIDATE_LEAD_MAX_WEEKS (not actionable yet)", () => {
    expect(SEASONAL_CANDIDATE_LEAD_MAX_WEEKS).toBe(8);
    const cal = [entry("/far", { peakStartDate: isoWeeksOut(20) })];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/far"]), now: NOW });
    expect(out).toEqual([]);
  });

  it("includes the boundary weeks (exactly 6 and exactly 8 weeks out)", () => {
    const cal = [entry("/six", { peakStartDate: isoWeeksOut(6) }), entry("/eight", { peakStartDate: isoWeeksOut(8) })];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/six", "/eight"]), now: NOW, maxCandidates: 5 });
    expect(out.map((c) => c.page)).toEqual(["/six", "/eight"]);
  });
});

describe("findSeasonalCandidates - bounding", () => {
  it("caps at MAX_SEASONAL_CANDIDATES_PER_NIGHT, calendar order preserved", () => {
    expect(MAX_SEASONAL_CANDIDATES_PER_NIGHT).toBe(2);
    const cal = [entry("/a"), entry("/b"), entry("/c")];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/a", "/b", "/c"]) , now: NOW});
    expect(out.map((c) => c.page)).toEqual(["/a", "/b"]);
  });

  it("respects a maxCandidates override for tests", () => {
    const cal = [entry("/a"), entry("/b"), entry("/c")];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/a", "/b", "/c"]), now: NOW, maxCandidates: 1 });
    expect(out).toHaveLength(1);
  });
});

describe("findSeasonalCandidates - eligibility + dedup guards", () => {
  it("skips an ineligible page (mid-measurement) and takes the next in order", () => {
    const cal = [entry("/blocked"), entry("/clean")];
    const eligibility = new Map<string, ExperimentEligibility>([
      ["/blocked", BLOCKED],
      ["/clean", CLEAN],
    ]);
    const out = findSeasonalCandidates({ calendar: cal, eligibility, now: NOW });
    expect(out.map((c) => c.page)).toEqual(["/clean"]);
  });

  it("skips a page with NO eligibility entry at all (never assumes clean)", () => {
    const out = findSeasonalCandidates({ calendar: [entry("/unknown")], eligibility: new Map(), now: NOW });
    expect(out).toEqual([]);
  });

  it("skips a page that already has a candidate tonight (one card per page)", () => {
    const out = findSeasonalCandidates({
      calendar: [entry("/already")],
      eligibility: eligAll(["/already"]),
      alreadyProposedPaths: new Set(["/already"]),
      now: NOW,
    });
    expect(out).toEqual([]);
  });
});

describe("findSeasonalCandidates - honesty gate", () => {
  it("skips a calendar entry with no known top page (nothing exact to strengthen)", () => {
    const out = findSeasonalCandidates({ calendar: [entry("/x", { topPage: null })], eligibility: eligAll(["/x"]), now: NOW });
    expect(out).toEqual([]);
  });
});

describe("findSeasonalCandidates - seed content + team voice", () => {
  it("carries the cluster label, confidence, peak months, and expected impressions through", () => {
    const cal = [entry("/nowruz", { clusterLabel: "Nowruz Table Setting", confidence: "proven", peakMonths: [3], expectedImpressions: 9000 })];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/nowruz"]), now: NOW });
    expect(out[0]!.clusterLabel).toBe("Nowruz Table Setting");
    expect(out[0]!.confidence).toBe("proven");
    expect(out[0]!.peakMonths).toEqual([3]);
    expect(out[0]!.expectedImpressions).toBe(9000);
  });

  it("names the exact number of weeks out and the six-to-eight-week ship window in whyNow", () => {
    const cal = [entry("/nowruz", { peakStartDate: isoWeeksOut(7) })];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/nowruz"]), now: NOW });
    expect(out[0]!.whyNow).toContain("7 weeks");
    expect(out[0]!.whyNow).toContain("Six to eight weeks out");
  });

  it("speaks honestly about confidence: one_season is hedged, repeated is more confident, proven cites the market check", () => {
    const base = { peakStartDate: isoWeeksOut(7) };
    const oneSeason = findSeasonalCandidates({ calendar: [entry("/a", { ...base, confidence: "one_season" })], eligibility: eligAll(["/a"]), now: NOW })[0]!;
    const repeated = findSeasonalCandidates({ calendar: [entry("/b", { ...base, confidence: "repeated" })], eligibility: eligAll(["/b"]), now: NOW })[0]!;
    const proven = findSeasonalCandidates({ calendar: [entry("/c", { ...base, confidence: "proven" })], eligibility: eligAll(["/c"]), now: NOW })[0]!;
    expect(oneSeason.whyNow).toContain("one year of data");
    expect(repeated.whyNow).toContain("repeated more than once");
    expect(proven.whyNow).toContain("market search data");
  });

  it("never emits an em or en dash in whyNow", () => {
    const cal = [entry("/dash", { peakStartDate: isoWeeksOut(7), confidence: "proven" })];
    const out = findSeasonalCandidates({ calendar: cal, eligibility: eligAll(["/dash"]), now: NOW });
    expect(out[0]!.whyNow).not.toMatch(/[–—]/);
  });
});

describe("dash guard (hard rule)", () => {
  it("the seasonal-candidates module contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "seasonal-candidates.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
