import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildTodayLeadHeadline, adaptProofRecordForLead } from "./today-lead-headline";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

// Fail-closed calibration quarantine (2026-07-11): the win/loss ledger rows below
// are CALIBRATED so the clauses pin that a calibrated win/loss is still celebrated
// or owned. The dedicated uncalibrated case pins the quarantine (no win boast).
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

const NOW = Date.parse("2026-07-03T18:00:00Z");
const thisWeek = "2026-07-01T00:00:00Z";
const lastMonth = "2026-06-01T00:00:00Z";

describe("buildTodayLeadHeadline", () => {
  it("returns null when nothing to lead with (no win, no next move)", () => {
    const r = buildTodayLeadHeadline({ ledger: [], moverDays: [], nextPick: null, topAlert: null, nowMs: NOW });
    expect(r).toBeNull();
  });

  it("leads with the biggest measured win this week and its monthly click number", () => {
    const r = buildTodayLeadHeadline({
      ledger: [
        { path: "/farsi-numbers", shippedAt: thisWeek, verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, pageLabel: "/farsi-numbers", monthlyClickLift: 40 },
        { path: "/small", shippedAt: thisWeek, verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, pageLabel: "/small", monthlyClickLift: 5 },
      ],
      moverDays: [],
      nextPick: { pageLabel: "/cities", headline: "Tighten the title on /cities" },
      topAlert: null,
      nowMs: NOW,
    });
    expect(r).not.toBeNull();
    expect(r!.winClause).toBe("Your biggest win this week: /farsi-numbers is up about 40 clicks a month.");
    expect(r!.nextClause).toBe("Your next move: Tighten the title on /cities.");
    expect(r!.tone).toBe("good");
    expect(r!.href).toBe("#daily-experiments");
  });

  it("shades a win off an early window as still arriving, not a hard number", () => {
    const r = buildTodayLeadHeadline({
      ledger: [{ path: "/p", shippedAt: thisWeek, verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, pageLabel: "/p", monthlyClickLift: 40, liftFinal: false }],
      moverDays: [],
      nextPick: null,
      topAlert: null,
      nowMs: NOW,
    });
    expect(r!.winClause).toBe("Your biggest win this week: /p is on track for about 40 clicks a month, still arriving.");
    expect(r!.tone).toBe("good");
  });

  it("celebrates a win with no measured number by naming the page, no fabricated figure", () => {
    const r = buildTodayLeadHeadline({
      ledger: [{ path: "/p", shippedAt: thisWeek, verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, pageLabel: "/p", monthlyClickLift: null }],
      moverDays: [],
      nextPick: null,
      topAlert: null,
      nowMs: NOW,
    });
    expect(r!.winClause).toBe("Your biggest win this week: the change on /p won.");
    expect(r!.tone).toBe("good");
  });

  it("falls to the biggest positive weekly click mover when no verdict landed", () => {
    const r = buildTodayLeadHeadline({
      ledger: [],
      moverDays: [
        { date: "2026-07-01", clicks: 100 },
        { date: "2026-07-02", clicks: 155 },
      ],
      nextPick: null,
      topAlert: null,
      nowMs: NOW,
    });
    expect(r!.winClause).toContain("clicks jumped by 55");
    expect(r!.tone).toBe("good");
  });

  it("owns a loss plainly when the only settled result this week did not work", () => {
    const r = buildTodayLeadHeadline({
      ledger: [{ path: "/p", shippedAt: thisWeek, verdict: "lost", calibrationVersion: TEST_CALIBRATED_VERSION, pageLabel: "/p", monthlyClickLift: null }],
      moverDays: [],
      nextPick: null,
      topAlert: null,
      nowMs: NOW,
    });
    expect(r!.winClause).toContain("did not work");
    expect(r!.winClause).toContain("what I learned");
    expect(r!.tone).toBe("bad");
  });

  it("uses the fired alert for the next move when there is no tonight pick", () => {
    const r = buildTodayLeadHeadline({
      ledger: [{ path: "/p", shippedAt: thisWeek, verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, pageLabel: "/p", monthlyClickLift: 12 }],
      moverDays: [],
      nextPick: null,
      topAlert: { title: "3 results ready to review", href: "/results" },
      nowMs: NOW,
    });
    expect(r!.nextClause).toBe("Your next move: 3 results ready to review.");
    expect(r!.href).toBe("/results");
  });

  it("ignores wins shipped outside this week for the biggest-win clause", () => {
    const r = buildTodayLeadHeadline({
      ledger: [{ path: "/old", shippedAt: lastMonth, verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, pageLabel: "/old", monthlyClickLift: 99 }],
      moverDays: [],
      nextPick: { pageLabel: "/x", headline: "Ship the /x title" },
      topAlert: null,
      nowMs: NOW,
    });
    expect(r!.winClause).toBeNull();
    expect(r!.nextClause).toContain("Ship the /x title");
    expect(r!.tone).toBe("neutral");
  });

  it("never emits an em or en dash", () => {
    const r = buildTodayLeadHeadline({
      ledger: [{ path: "/p", shippedAt: thisWeek, verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, pageLabel: "/p", monthlyClickLift: 40 }],
      moverDays: [],
      nextPick: { pageLabel: "/c", headline: "Tighten the title on /c" },
      topAlert: null,
      nowMs: NOW,
    });
    expect(`${r!.winClause}${r!.nextClause}`).not.toMatch(/[‒–—―]/);
  });
});

describe("adaptProofRecordForLead", () => {
  it("rolls the latest closed window's adjustedLift to a monthly rate", () => {
    const row = adaptProofRecordForLead({
      path: "/p",
      shippedAt: thisWeek,
      verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION,
      windows: [
        { day: 7, ran: true, adjustedLift: 3.5 },
        { day: 28, ran: true, adjustedLift: 40 }, // 40 over 28d -> ~43/mo
        { day: 14, ran: true, adjustedLift: 20 },
      ],
    });
    expect(row.monthlyClickLift).toBe(Math.round((40 * 30) / 28));
    expect(row.verdict).toBe("won");
    expect(row.liftFinal).toBe(true); // 28-day basis closed -> final
  });

  it("marks the lift as not final when only an early window has closed", () => {
    const row = adaptProofRecordForLead({
      path: "/p",
      shippedAt: thisWeek,
      verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION,
      windows: [{ day: 7, ran: true, adjustedLift: 10 }],
    });
    expect(row.monthlyClickLift).toBe(Math.round((10 * 30) / 7));
    expect(row.liftFinal).toBe(false);
  });

  it("returns a null lift when no window has closed (still collecting)", () => {
    const row = adaptProofRecordForLead({
      path: "/p",
      shippedAt: thisWeek,
      verdict: "measuring",
      windows: [{ day: 7, ran: false, adjustedLift: 0 }],
    });
    expect(row.monthlyClickLift).toBeNull();
  });

  it("returns a null lift for a negative window (no false win number)", () => {
    const row = adaptProofRecordForLead({
      path: "/p",
      shippedAt: thisWeek,
      verdict: "lost", calibrationVersion: TEST_CALIBRATED_VERSION,
      windows: [{ day: 28, ran: true, adjustedLift: -30 }],
    });
    expect(row.monthlyClickLift).toBeNull();
  });
});

describe("buildTodayLeadHeadline - fail-closed calibration quarantine (2026-07-11)", () => {
  it("does NOT boast an UNCALIBRATED win - the win clause self-hides (falls through to next move)", () => {
    const r = buildTodayLeadHeadline({
      ledger: [{ path: "/p", shippedAt: thisWeek, verdict: "won", calibrationVersion: null, pageLabel: "/p", monthlyClickLift: 40 }],
      moverDays: [],
      nextPick: { pageLabel: "/c", headline: "Tighten the title on /c" },
      topAlert: null,
      nowMs: NOW,
    });
    expect(r!.winClause).toBeNull();
    expect(r!.tone).toBe("neutral");
    expect(r!.nextClause).toContain("Tighten the title on /c");
  });

  it("does NOT own an UNCALIBRATED loss as a loss - no false 'did not work' claim", () => {
    const r = buildTodayLeadHeadline({
      ledger: [{ path: "/p", shippedAt: thisWeek, verdict: "lost", calibrationVersion: null, pageLabel: "/p", monthlyClickLift: null }],
      moverDays: [],
      nextPick: null,
      topAlert: null,
      nowMs: NOW,
    });
    expect(r).toBeNull(); // no win, no loss claim, no next move -> the hero self-hides
  });
});
