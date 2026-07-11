import { describe, it, expect } from "vitest";
import {
  buildMoneyLine,
  buildScoreboard,
  type ScoreboardDay,
  type ScoreboardLedgerRow,
  type ScoreboardRevenueDay,
} from "./scoreboard";

const NOW = new Date("2026-07-01T12:00:00.000Z");

function days(n: number, clicksFn: (i: number) => number, startMs = Date.parse("2026-05-01")): ScoreboardDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(startMs + i * 86400000).toISOString().slice(0, 10),
    clicks: clicksFn(i),
    impressions: clicksFn(i) * 20,
  }));
}

// Wave 3A: ScoreboardLedgerRow is the FULL ledger row now (id + windows + baseline), so the
// scoreboard classifies each change through the canonical lifecycle rule, not a raw verdict.
let ROW_SEQ = 0;
const row = (over: Partial<ScoreboardLedgerRow>): ScoreboardLedgerRow => ({
  id: `r${ROW_SEQ++}`,
  path: "/p", shippedAt: "2026-05-20T05:00:00.000Z", actionType: "edit_meta", verdict: "measuring",
  windows: [], baseline: { impressions: 1000 }, ...over,
});
// A 28-day window closed with enough comparisons + baseline: the only shape that classifies
// canonically as a decided win/loss (deriveMeasurementMaturity mature_result).
const MATURE_WINDOWS = [
  { day: 7, ran: true, controlsUsed: 3 },
  { day: 14, ran: true, controlsUsed: 3 },
  { day: 28, ran: true, controlsUsed: 3 },
];

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
        // A canonically-decided win needs a mature 28-day window (a raw verdict "won" alone
        // is still measuring), so the marker tone comes from the lifecycle rule, not the string.
        row({ shippedAt: `${shipDay}T05:00:00.000Z`, verdict: "won", path: "/q", windows: MATURE_WINDOWS }),
        row({ shippedAt: "2020-01-01T00:00:00.000Z", verdict: "won", path: "/out-of-range", windows: MATURE_WINDOWS }),
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

  it("R17a (brand split): the weekly trend sentence names its lens (every search)", () => {
    const s = buildScoreboard(days(28, () => 10), [], NOW)!;
    expect(s.verdictLine).toContain("clicks from every search");
  });
});

describe("buildMoneyLine (item 3, the honest dollar sentence)", () => {
  const revDay = (over: Partial<ScoreboardRevenueDay>): ScoreboardRevenueDay => ({
    day: "2026-06-30",
    revenueUsd: 10,
    sources: ["unit_economics"],
    ...over,
  });
  const week = (revenue: number, sources: string[]): ScoreboardRevenueDay[] =>
    Array.from({ length: 7 }, (_, i) =>
      revDay({ day: `2026-06-2${i + 1}`, revenueUsd: revenue, sources }),
    );

  it("returns null with no dollars (surface degrades exactly as before)", () => {
    expect(buildMoneyLine([])).toBeNull();
    expect(buildMoneyLine([revDay({ revenueUsd: 0 })])).toBeNull();
  });

  it("labels unit-economics dollars as your rate x real traffic, never as measured", () => {
    const line = buildMoneyLine(week(20, ["unit_economics"]))!;
    expect(line).toContain("$140");
    expect(line).toContain("your rate x real traffic");
    expect(line).toContain("not a measured payout");
    expect(line).toContain("about");
  });

  it("labels ad-network dollars as measured", () => {
    const line = buildMoneyLine(week(20, ["ad_network"]))!;
    expect(line).toContain("$140");
    expect(line).toContain("measured by your ad network");
    expect(line).not.toContain("about");
  });

  it("discloses a mixed basis when both kinds exist in the window", () => {
    const line = buildMoneyLine([
      ...week(10, ["unit_economics"]).slice(0, 4),
      ...week(10, ["ad_network"]).slice(4),
    ])!;
    expect(line).toContain("Part is measured and part is your rate x real traffic");
  });

  it("sums only the last 7 days that have dollars and shows cents under $100", () => {
    const many = [
      revDay({ day: "2026-06-01", revenueUsd: 999 }), // outside the last-7-with-dollars window
      ...week(5.5, ["unit_economics"]),
    ];
    const line = buildMoneyLine(many)!;
    expect(line).toContain("$38.50");
    expect(line).toContain("the last 7 tracked days");
  });

  it("never emits an em or en dash", () => {
    for (const sources of [["unit_economics"], ["ad_network"], ["ad_network", "unit_economics"]]) {
      const line = buildMoneyLine(week(12, sources));
      expect(line).not.toBeNull();
      expect(/[‒–—―]/.test(line!)).toBe(false);
    }
  });
});
