import { describe, it, expect } from "vitest";
import { buildScoreboard, type ScoreboardDay, type ScoreboardLedgerRow } from "./scoreboard";

const NOW = new Date("2026-07-01T12:00:00.000Z");

function days(n: number, clicksFn: (i: number) => number, startMs = Date.parse("2026-05-01")): ScoreboardDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(startMs + i * 86400000).toISOString().slice(0, 10),
    clicks: clicksFn(i),
    impressions: clicksFn(i) * 20,
  }));
}

const row = (over: Partial<ScoreboardLedgerRow>): ScoreboardLedgerRow => ({
  path: "/p", shippedAt: "2026-05-20T05:00:00.000Z", actionType: "edit_meta", verdict: "measuring", ...over,
});

describe("buildScoreboard", () => {
  it("returns null with under 14 days of history (never fakes a trend)", () => {
    expect(buildScoreboard(days(10, () => 5), [], NOW)).toBeNull();
  });

  it("computes last-7 vs prior-7 delta from REPORTED days, not calendar now", () => {
    // 28 days: first 21 at 10 clicks/day, last 7 at 20 clicks/day -> +100%
    const d = days(28, (i) => (i < 21 ? 10 : 20));
    const s = buildScoreboard(d, [], NOW)!;
    expect(s.last7Clicks).toBe(140);
    expect(s.deltaPct).toBe(100);
    expect(s.reportedThrough).toBe(d[27]!.date);
    expect(s.verdictLine).toContain("140 clicks");
    expect(s.verdictLine).toContain("up 100%");
  });

  it("rolling average is null before day 7 and correct after", () => {
    const s = buildScoreboard(days(20, () => 7), [], NOW)!;
    expect(s.rolling[5]).toBeNull();
    expect(s.rolling[6]).toBe(7);
    expect(s.rolling[19]).toBe(7);
  });

  it("groups ship markers by day with tone precedence won > measuring > flat", () => {
    const d = days(28, () => 10);
    const shipDay = d[20]!.date;
    const s = buildScoreboard(
      d,
      [
        row({ shippedAt: `${shipDay}T04:00:00.000Z`, verdict: "measuring" }),
        row({ shippedAt: `${shipDay}T05:00:00.000Z`, verdict: "won", path: "/q" }),
        row({ shippedAt: "2020-01-01T00:00:00.000Z", verdict: "won", path: "/out-of-range" }),
      ],
      NOW,
    )!;
    expect(s.markers).toHaveLength(1);
    expect(s.markers[0]!.date).toBe(shipDay);
    expect(s.markers[0]!.count).toBe(2);
    expect(s.markers[0]!.tone).toBe("won");
  });

  it("names the soonest FUTURE checkpoint across 7/14/28 windows", () => {
    const d = days(28, () => 10, Date.parse("2026-06-01"));
    // shipped Jun 26: 7d checkpoint Jul 3 is the soonest future read from Jul 1.
    const s = buildScoreboard(d, [row({ shippedAt: "2026-06-26T05:00:00.000Z" })], NOW)!;
    expect(s.measuringCount).toBe(1);
    expect(s.nextVerdictDate).toBe("2026-07-03");
    expect(s.verdictLine).toContain("1 change measuring");
  });

  it("never emits an em or en dash", () => {
    const s = buildScoreboard(days(28, (i) => i), [row({})], NOW)!;
    expect(/[–—]/.test(s.verdictLine)).toBe(false);
    for (const m of s.markers) expect(/[–—]/.test(m.label)).toBe(false);
  });
});
