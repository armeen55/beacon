/**
 * monthly-pulse (operator spec 2026-07-09 A-3/B-6) - pins for the north-star view model:
 * last-full-month headline, honest goal progress, part-month labeling, delta math,
 * clicks-only degrade, no invented goal, and Beacon-voice rules (no dashes).
 */
import { describe, expect, it } from "vitest";
import { buildMonthlyPulse } from "./monthly-pulse";

// Fixed clock: 2026-07-09 (so June is the last FULL month, July is part).
const NOW = Date.parse("2026-07-09T12:00:00Z");

const GA4 = [
  { month: "2026-03-01", sessions: 32482 },
  { month: "2026-04-01", sessions: 17800 },
  { month: "2026-05-01", sessions: 11370 },
  { month: "2026-06-01", sessions: 12862 },
  { month: "2026-07-01", sessions: 2635 },
];
const GSC = [
  { month: "2026-05-01", clicks: 4100, impressions: 400000 },
  { month: "2026-06-01", clicks: 3004, impressions: 351000 },
  { month: "2026-07-01", clicks: 730, impressions: 90000 },
];

describe("buildMonthlyPulse", () => {
  it("headlines the last FULL month with visits + clicks, both real numbers", () => {
    const p = buildMonthlyPulse({ ga4Months: GA4, gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.headline).toBe("June: 12,862 visits and 3,004 clicks from Google search.");
  });

  it("goal line celebrates clearing the goal in one sentence", () => {
    const p = buildMonthlyPulse({ ga4Months: GA4, gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.goalLine).toBe("That clears your 10,000-a-month goal.");
  });

  it("goal line owns a miss plainly with the honest percent", () => {
    const p = buildMonthlyPulse({ ga4Months: GA4, gscMonths: GSC, monthlyVisitGoal: 20000, nowMs: NOW });
    expect(p.goalLine).toBe("Your goal is 20,000 visits a month. June reached 64% of it.");
  });

  it("never invents a goal when none is configured", () => {
    const p = buildMonthlyPulse({ ga4Months: GA4, gscMonths: GSC, nowMs: NOW });
    expect(p.goalLine).toBeNull();
  });

  it("labels the current part month as 'so far' so it never reads as a collapse", () => {
    const p = buildMonthlyPulse({ ga4Months: GA4, gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.monthToDateLine).toBe("July so far: 2,635 visits.");
  });

  it("delta compares the last two FULL months (June up 13% on May)", () => {
    const p = buildMonthlyPulse({ ga4Months: GA4, gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.deltaLine).toBe("June was up 13% on May.");
  });

  it("degrades to clicks-only when GA4 is absent (no fake visits, unit named)", () => {
    const p = buildMonthlyPulse({ ga4Months: [], gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.headline).toBe("June: 3,004 clicks from Google search.");
    expect(p.goalLine).toBeNull(); // a visits goal is never graded against clicks
    expect(p.monthToDateLine).toBe("July so far: 730 clicks from Google search.");
  });

  it("returns the trailing 6 months ascending with the current month last", () => {
    const p = buildMonthlyPulse({ ga4Months: GA4, gscMonths: GSC, nowMs: NOW });
    expect(p.months).toHaveLength(6);
    expect(p.months[0]!.month).toBe("2026-02-01");
    expect(p.months[5]!.month).toBe("2026-07-01");
    expect(p.months[5]!.visits).toBe(2635);
  });

  it("all-empty input self-silences (no headline, no lines) instead of zeros", () => {
    const p = buildMonthlyPulse({ ga4Months: [], gscMonths: [], nowMs: NOW });
    expect(p.headline).toBeNull();
    expect(p.goalLine).toBeNull();
    expect(p.monthToDateLine).toBeNull();
    expect(p.deltaLine).toBeNull();
  });

  it("never emits an em or en dash in any sentence", () => {
    const p = buildMonthlyPulse({ ga4Months: GA4, gscMonths: GSC, monthlyVisitGoal: 20000, nowMs: NOW });
    for (const s of [p.headline, p.goalLine, p.monthToDateLine, p.deltaLine]) {
      if (s) expect(s).not.toMatch(/[‒-―]/);
    }
  });
});
