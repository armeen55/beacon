/**
 * monthly-pulse (2026-07-09 origin; 2026-07-10 P0-A truth fix) - pins for the north-star
 * view model AFTER the non-additive GA4 sitewide-visits number was withdrawn:
 *   - the disputed sitewide-visits totals are NEVER produced (no visits field, no visit copy)
 *   - the honest reconciliation state stands in their place
 *   - a visits goal is NEVER celebrated or graded from clicks
 *   - clicks headline/delta/month-to-date come from the proven GSC series
 *   - Beacon-voice rules hold (no dashes)
 */
import { describe, expect, it } from "vitest";
import {
  buildMonthlyPulse,
  MONTHLY_VISITS_RECONCILIATION_LINE,
  MONTHLY_VISITS_RECONCILED_LINE,
  MONTHLY_VISITS_MISMATCH_LINE,
} from "./monthly-pulse";

// Fixed clock: 2026-07-09 (so June is the last FULL month, July is part).
const NOW = Date.parse("2026-07-09T12:00:00Z");

// The disputed GA4 sitewide-visits totals that USED to headline this card. They must
// never reappear anywhere in the view model - kept here only to assert their absence.
const DISPUTED_VISITS = ["18,740", "32,482", "17,800", "11,370", "12,862", "2,635"];

const GSC = [
  { month: "2026-05-01", clicks: 4100, impressions: 400000 },
  { month: "2026-06-01", clicks: 3004, impressions: 351000 },
  { month: "2026-07-01", clicks: 730, impressions: 90000 },
];

describe("buildMonthlyPulse (P0-A)", () => {
  it("headlines the last FULL month with proven Search Console clicks, not visits", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.headline).toBe("June: 3,004 clicks from Google search.");
  });

  it("shows the honest reconciliation state in place of the withdrawn visits number", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.reconciliationLine).toBe(MONTHLY_VISITS_RECONCILIATION_LINE);
    expect(p.reconciliationLine).toContain("Monthly visits need reconciliation");
    expect(p.reconciliationLine).toContain("Search Console clicks");
  });

  it("ARCHITECTURE PIN: never emits any disputed sitewide-visits total, and months carry no visits field", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    const blob = JSON.stringify(p);
    for (const n of DISPUTED_VISITS) expect(blob).not.toContain(n);
    // The month shape carries clicks only - there is no field that could surface a
    // summed-page-rows visits number.
    for (const m of p.months) {
      expect(m).not.toHaveProperty("visits");
      expect(m).not.toHaveProperty("sessions");
    }
    // No line claims a "N visits" figure (the goal line's "-visits-a-month goal" is copy,
    // not a rendered total, and carries no comma-grouped number).
    for (const line of [p.headline, p.monthToDateLine, p.deltaLine]) {
      if (line) expect(line).not.toMatch(/[\d,]+ visits\b/);
    }
  });

  it("owns the ungradeable goal plainly - never celebrates, never grades from clicks", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.goalLine).toBe(
      "I can't grade your 10,000-visits-a-month goal yet because monthly visits need reconciliation. I will score it as soon as that number is trustworthy.",
    );
    expect(p.goalLine).not.toContain("clears");
  });

  it("PIN: a visits goal is NOT graded from clicks even when clicks exceed the goal number", () => {
    // clicks (3,004 in June) are well above this tiny goal, yet the goal stays ungraded:
    // clicks may never stand in for visits.
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 100, nowMs: NOW });
    expect(p.goalLine).toContain("I can't grade your 100-visits-a-month goal yet");
    expect(p.goalLine).not.toContain("clears");
  });

  it("never invents a goal when none is configured", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, nowMs: NOW });
    expect(p.goalLine).toBeNull();
  });

  it("labels the current part month as 'so far' using clicks so it never reads as a collapse", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.monthToDateLine).toBe("July so far: 730 clicks from Google search.");
  });

  it("delta compares the last two FULL months on clicks (June down 27% from May)", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.deltaLine).toBe("June clicks were down 27% from May.");
  });

  it("returns the trailing 6 months ascending with the current month last (clicks only)", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, nowMs: NOW });
    expect(p.months).toHaveLength(6);
    expect(p.months[0]!.month).toBe("2026-02-01");
    expect(p.months[5]!.month).toBe("2026-07-01");
    expect(p.months[5]!.clicks).toBe(730);
  });

  it("all-empty GSC input self-silences the headline (no bare zero) but still carries the honest line", () => {
    const p = buildMonthlyPulse({ gscMonths: [], nowMs: NOW });
    expect(p.headline).toBeNull();
    expect(p.monthToDateLine).toBeNull();
    expect(p.deltaLine).toBeNull();
    expect(p.reconciliationLine).toBe(MONTHLY_VISITS_RECONCILIATION_LINE);
  });

  it("never emits an em or en dash in any sentence", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 20000, nowMs: NOW });
    for (const s of [p.headline, p.reconciliationLine, p.goalLine, p.monthToDateLine, p.deltaLine]) {
      if (s) expect(s).not.toMatch(/[‒-―]/);
    }
  });

  it("HELD-BACK by default: with no reconciliation, no visits number and the shipped line stand", () => {
    const p = buildMonthlyPulse({ gscMonths: GSC, monthlyVisitGoal: 10000, nowMs: NOW });
    expect(p.reconciliationLine).toBe(MONTHLY_VISITS_RECONCILIATION_LINE);
    expect(p.reconciledVisitsHeadline).toBeNull();
    expect(p.reconciledGoalLine).toBeNull();
    expect(p.reconciledMonthToDateLine).toBeNull();
  });
});

describe("buildMonthlyPulse (Wave 2A - reconciliation gate)", () => {
  const VISITS = [
    { month: "2026-06-01", visits: 12540, partial: false },
    { month: "2026-07-01", visits: 3120, partial: true },
  ];

  it("PASS: shows a reconciled visits headline + so-far line, and grades the goal from VISITS not clicks", () => {
    const p = buildMonthlyPulse({
      gscMonths: GSC,
      monthlyVisitGoal: 10000,
      nowMs: NOW,
      reconciliation: { status: "pass", visitsByMonth: VISITS },
    });
    expect(p.reconciliationLine).toBe(MONTHLY_VISITS_RECONCILED_LINE);
    expect(p.reconciledVisitsHeadline).toBe("June: 12,540 visits, reconciled against Analytics.");
    expect(p.reconciledMonthToDateLine).toBe("July so far: 3,120 visits.");
    // 12,540 visits clears the 10,000 goal - graded from reconciled VISITS (12,540),
    // never from the 3,004 June clicks.
    expect(p.reconciledGoalLine).toBe("June cleared your 10,000-visits-a-month goal with 12,540 visits.");
    expect(p.reconciledGoalLine).toContain("12,540 visits");
    // The ungradeable clicks-context goal line is dropped once we can grade from visits.
    expect(p.goalLine).toBeNull();
  });

  it("PASS below goal: reports progress toward the goal from visits", () => {
    const p = buildMonthlyPulse({
      gscMonths: GSC,
      monthlyVisitGoal: 20000,
      nowMs: NOW,
      reconciliation: { status: "pass", visitsByMonth: VISITS },
    });
    expect(p.reconciledGoalLine).toBe("June reached 12,540 of your 20,000-visits-a-month goal.");
  });

  it("MISMATCH: swaps in the honest alert, shows NO visits number, keeps the goal ungraded", () => {
    const p = buildMonthlyPulse({
      gscMonths: GSC,
      monthlyVisitGoal: 10000,
      nowMs: NOW,
      reconciliation: { status: "mismatch" },
    });
    expect(p.reconciliationLine).toBe(MONTHLY_VISITS_MISMATCH_LINE);
    expect(p.reconciliationLine).toContain("does not add up yet");
    expect(p.reconciledVisitsHeadline).toBeNull();
    expect(p.reconciledGoalLine).toBeNull();
    // Goal stays ungradeable because no trustworthy visits number is shown.
    expect(p.goalLine).toContain("I can't grade your 10,000-visits-a-month goal yet");
  });

  it("PASS lines never emit an em or en dash", () => {
    const p = buildMonthlyPulse({
      gscMonths: GSC,
      monthlyVisitGoal: 10000,
      nowMs: NOW,
      reconciliation: { status: "pass", visitsByMonth: VISITS },
    });
    for (const s of [p.reconciledVisitsHeadline, p.reconciledGoalLine, p.reconciledMonthToDateLine, p.reconciliationLine]) {
      if (s) expect(s).not.toMatch(/[‒-―]/);
    }
  });
});
