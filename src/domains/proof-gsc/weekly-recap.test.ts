import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildWeeklyRecap, shippedInLastDays, shippedToday, stillDoubleCheckingCount, weeklyRecapSentence } from "./weekly-recap";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "./verdict-calibration-test-support";

// Fail-closed calibration quarantine (2026-07-11): the recap "won" rows are marked
// CALIBRATED so the regression pins that a calibrated win still reads as a win; the
// uncalibrated case pins that an uncalibrated win reads as still measuring.
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

// Noon UTC on 2026-07-02 = still 2026-07-02 in Pacific (UTC-7 in July), well clear of the
// midnight boundary so the fixture isn't flaky against the Pacific day-key computation.
const NOW = Date.parse("2026-07-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("weekly-recap (items 7+8)", () => {
  it("counts the 14-day streak, ignoring older and unparseable rows", () => {
    const rows = [
      { shippedAt: daysAgo(1) }, { shippedAt: daysAgo(13) },
      { shippedAt: daysAgo(20) }, { shippedAt: "garbage" },
    ];
    expect(shippedInLastDays(rows, NOW)).toBe(2);
  });

  it("builds the recap from last week's rows only", () => {
    const rows = [
      { shippedAt: daysAgo(1), verdict: "won", path: "/finglish", calibrationVersion: TEST_CALIBRATED_VERSION },
      { shippedAt: daysAgo(2), verdict: "measuring", path: "/a" },
      { shippedAt: daysAgo(3), verdict: "inconclusive", path: "/b" },
      { shippedAt: daysAgo(10), verdict: "won", path: "/old", calibrationVersion: TEST_CALIBRATED_VERSION },
    ];
    const r = buildWeeklyRecap(rows, NOW);
    expect(r).toMatchObject({ shipped: 3, won: 1, noLift: 1, stillMeasuring: 1 });
    expect(r.wonPaths).toEqual(["/finglish"]);
  });

  it("fail-closed quarantine: an UNCALIBRATED won reads as still measuring, never a recap win", () => {
    const rows = [
      { shippedAt: daysAgo(1), verdict: "won", path: "/finglish", calibrationVersion: null },
      { shippedAt: daysAgo(2), verdict: "lost", path: "/a", calibrationVersion: null },
    ];
    const r = buildWeeklyRecap(rows, NOW);
    expect(r).toMatchObject({ shipped: 2, won: 0, stillMeasuring: 2 });
    expect(r.wonPaths).toEqual([]);
  });

  it("writes one plain sentence, and stays silent when nothing shipped", () => {
    const s = weeklyRecapSentence({ shipped: 6, won: 1, wonPaths: ["/finglish"], noLift: 2, stillMeasuring: 3 });
    expect(s).toBe("Last 7 days: 6 changes shipped, 1 win (/finglish), 2 with no clear lift, 3 still measuring.");
    expect(weeklyRecapSentence({ shipped: 0, won: 0, wonPaths: [], noLift: 0, stillMeasuring: 0 })).toBeNull();
  });
});

describe("shippedToday (D6 daily counter)", () => {
  it("counts only rows shipped on today's Pacific calendar date", () => {
    const rows = [
      { shippedAt: new Date(NOW).toISOString() }, // today
      { shippedAt: daysAgo(1) }, // yesterday
      { shippedAt: daysAgo(0.001) }, // still today (a few seconds ago)
    ];
    expect(shippedToday(rows, NOW)).toBe(2);
  });

  it("is 0 on a fresh day with nothing shipped yet", () => {
    expect(shippedToday([{ shippedAt: daysAgo(1) }, { shippedAt: daysAgo(2) }], NOW)).toBe(0);
  });

  it("ignores unparseable timestamps", () => {
    expect(shippedToday([{ shippedAt: "garbage" }], NOW)).toBe(0);
  });
});

describe("stillDoubleCheckingCount (D6 daily counter)", () => {
  it("counts today's ships still measuring, not settled ones", () => {
    const rows = [
      { shippedAt: new Date(NOW).toISOString(), verdict: "measuring" },
      { shippedAt: new Date(NOW).toISOString(), verdict: "won" },
      { shippedAt: new Date(NOW).toISOString(), verdict: "measuring" },
      { shippedAt: daysAgo(1), verdict: "measuring" }, // not today
    ];
    expect(stillDoubleCheckingCount(rows, NOW)).toBe(2);
  });

  it("is 0 when nothing shipped today", () => {
    expect(stillDoubleCheckingCount([{ shippedAt: daysAgo(1), verdict: "measuring" }], NOW)).toBe(0);
  });
});
