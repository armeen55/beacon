/**
 * family-collapse (2026-07-02, master plan item 53) - week-over-week family
 * collapse detection matrix: a real high-severity collapse, a medium
 * collapse, a rise that must never register as a collapse, a below-floor
 * family that stays silent, short history fail-closed, and the family
 * grouping itself (pageFamilyOf rollup).
 */
import { describe, expect, it } from "vitest";

import {
  detectFamilyCollapses,
  anchorDateOfPages,
  biggestFamilyTarget,
  COLLAPSE_MIN_TYPICAL_CLICKS,
  type PageDailyRow,
} from "./family-collapse";

const DAY_MS = 86_400_000;
const START = "2026-05-01";

function d(offset: number): string {
  return new Date(Date.parse(`${START}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** Build COVERED_WEEKS+1 weeks of daily rows for one page, with a flat
 *  baseline of `dailyClicks` per day, then a final week at `finalWeekTotal`
 *  total clicks (spread evenly across the 7 days). */
function buildSeries(page: string, dailyClicks: number, finalWeekTotal: number, coveredWeeks = 3): PageDailyRow[] {
  const totalDays = (coveredWeeks + 1) * 7;
  const rows: PageDailyRow[] = [];
  for (let i = 0; i < totalDays - 7; i++) {
    rows.push({ date: d(i), page, clicks: dailyClicks });
  }
  const perDay = Math.round(finalWeekTotal / 7);
  for (let i = totalDays - 7; i < totalDays; i++) {
    rows.push({ date: d(i), page, clicks: perDay });
  }
  return rows;
}

describe("detectFamilyCollapses - high severity", () => {
  it("flags a family that lost 70 percent of its typical week as high severity", () => {
    const rows = buildSeries("https://example.com/cheetah/facts", 20, 30); // typical 140/wk -> this week 30
    const out = detectFamilyCollapses(rows);
    expect(out.length).toBe(1);
    expect(out[0]!.family).toBe("cheetah");
    expect(out[0]!.severity).toBe("high");
    expect(out[0]!.dropPct).toBeLessThan(-0.6);
  });

  it("dates the collapse to the first day of the dropped week, not the anchor day", () => {
    const rows = buildSeries("https://example.com/cheetah/facts", 20, 20);
    const anchor = anchorDateOfPages(rows)!;
    const out = detectFamilyCollapses(rows);
    expect(out.length).toBe(1);
    const expectedStart = new Date(Date.parse(`${anchor}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
    expect(out[0]!.collapseDate).toBe(expectedStart);
  });
});

describe("detectFamilyCollapses - medium severity", () => {
  it("flags a 45 percent drop as medium, not high", () => {
    const rows = buildSeries("https://example.com/cheetah/facts", 20, 77); // typical 140 -> 77 = -0.45
    const out = detectFamilyCollapses(rows);
    expect(out.length).toBe(1);
    expect(out[0]!.severity).toBe("medium");
  });

  it("a drop just under the 40 percent floor does not register at all", () => {
    const rows = buildSeries("https://example.com/cheetah/facts", 20, 90); // typical 140 -> 90 = -0.357
    const out = detectFamilyCollapses(rows);
    expect(out).toEqual([]);
  });
});

describe("detectFamilyCollapses - never fires on a rise", () => {
  it("a family that GREW week over week produces no collapse", () => {
    const rows = buildSeries("https://example.com/cheetah/facts", 20, 400); // grew, not dropped
    const out = detectFamilyCollapses(rows);
    expect(out).toEqual([]);
  });

  it("a flat family (no real change) produces no collapse", () => {
    const rows = buildSeries("https://example.com/cheetah/facts", 20, 140);
    const out = detectFamilyCollapses(rows);
    expect(out).toEqual([]);
  });
});

describe("detectFamilyCollapses - absolute floor", () => {
  it("a tiny family (typical below the click floor) never registers even at 100 percent drop", () => {
    const rows = buildSeries("https://example.com/tiny/page", 1, 0); // typical 7/wk, well under the floor
    const out = detectFamilyCollapses(rows);
    expect(out).toEqual([]);
  });

  it("COLLAPSE_MIN_TYPICAL_CLICKS is a real positive floor (sanity)", () => {
    expect(COLLAPSE_MIN_TYPICAL_CLICKS).toBeGreaterThan(0);
  });
});

describe("detectFamilyCollapses - fail-closed on short history", () => {
  it("fewer than the minimum covered trailing weeks stays silent", () => {
    const rows = buildSeries("https://example.com/cheetah/facts", 20, 10, 1); // only 1 covered week
    const out = detectFamilyCollapses(rows);
    expect(out).toEqual([]);
  });

  it("empty input returns an empty array, never throws", () => {
    expect(detectFamilyCollapses([])).toEqual([]);
  });

  it("rows with unparseable dates are dropped rather than crashing the detector", () => {
    const good = buildSeries("https://example.com/cheetah/facts", 20, 30);
    const bad: PageDailyRow[] = [{ date: "not-a-date", page: "https://example.com/cheetah/facts", clicks: 999 }];
    const out = detectFamilyCollapses([...good, ...bad]);
    expect(out.length).toBe(1);
  });
});

describe("detectFamilyCollapses - family grouping", () => {
  it("rolls up multiple pages under the same first path segment into one family", () => {
    const a = buildSeries("https://example.com/cheetah/facts", 15, 20);
    const b = buildSeries("https://example.com/cheetah/habitat", 15, 20);
    const out = detectFamilyCollapses([...a, ...b]);
    expect(out.length).toBe(1);
    expect(out[0]!.family).toBe("cheetah");
    expect(out[0]!.pages.sort()).toEqual(["https://example.com/cheetah/facts", "https://example.com/cheetah/habitat"].sort());
    // Combined typical week is 2x a single page's, so total clicks reflect both.
    expect(out[0]!.typicalWeekClicks).toBeGreaterThan(200);
  });

  it("keeps unrelated families independent (one collapsing, one healthy)", () => {
    const collapsing = buildSeries("https://example.com/cheetah/facts", 20, 20);
    const healthy = buildSeries("https://example.com/lions/facts", 20, 140);
    const out = detectFamilyCollapses([...collapsing, ...healthy]);
    expect(out.length).toBe(1);
    expect(out[0]!.family).toBe("cheetah");
  });

  it("a root-level page (no second path segment) is its own family", () => {
    const rows = buildSeries("https://example.com/about", 20, 20);
    const out = detectFamilyCollapses(rows);
    expect(out.length).toBe(1);
    expect(out[0]!.family).toBe("about");
  });
});

describe("anchorDateOfPages", () => {
  it("returns the newest date present, or null for an empty/invalid list", () => {
    const rows: PageDailyRow[] = [
      { date: "2026-05-01", page: "p", clicks: 1 },
      { date: "2026-05-15", page: "p", clicks: 1 },
      { date: "2026-05-08", page: "p", clicks: 1 },
    ];
    expect(anchorDateOfPages(rows)).toBe("2026-05-15");
    expect(anchorDateOfPages([])).toBeNull();
  });
});

describe("biggestFamilyTarget - the sitewide-changepoint target", () => {
  it("picks the family with the most total clicks even when nothing is collapsing", () => {
    const big = buildSeries("https://example.com/persian-names/boys", 50, 350); // flat, no collapse
    const small = buildSeries("https://example.com/cheetah/facts", 5, 35);
    const target = biggestFamilyTarget([...big, ...small]);
    expect(target?.family).toBe("persian-names");
    expect(target?.pages).toContain("https://example.com/persian-names/boys");
    expect(target?.typicalWeekClicks).toBeGreaterThan(0);
  });

  it("returns null when there are no usable rows", () => {
    expect(biggestFamilyTarget([])).toBeNull();
    expect(biggestFamilyTarget([{ date: "junk", page: "p", clicks: 1 }])).toBeNull();
  });
});
