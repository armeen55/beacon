import { describe, expect, it } from "vitest";
import { buildWeeklyRecap, shippedInLastDays, weeklyRecapSentence } from "./weekly-recap";

const NOW = Date.parse("2026-07-02T00:00:00Z");
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
      { shippedAt: daysAgo(1), verdict: "won", path: "/finglish" },
      { shippedAt: daysAgo(2), verdict: "measuring", path: "/a" },
      { shippedAt: daysAgo(3), verdict: "inconclusive", path: "/b" },
      { shippedAt: daysAgo(10), verdict: "won", path: "/old" },
    ];
    const r = buildWeeklyRecap(rows, NOW);
    expect(r).toMatchObject({ shipped: 3, won: 1, noLift: 1, stillMeasuring: 1 });
    expect(r.wonPaths).toEqual(["/finglish"]);
  });

  it("writes one plain sentence, and stays silent when nothing shipped", () => {
    const s = weeklyRecapSentence({ shipped: 6, won: 1, wonPaths: ["/finglish"], noLift: 2, stillMeasuring: 3 });
    expect(s).toBe("Last 7 days: 6 changes shipped, 1 win (/finglish), 2 with no clear lift, 3 still measuring.");
    expect(weeklyRecapSentence({ shipped: 0, won: 0, wonPaths: [], noLift: 0, stillMeasuring: 0 })).toBeNull();
  });
});
