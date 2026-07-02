import { describe, expect, it } from "vitest";
import {
  rankRefreshCandidates,
  buildRefreshSentence,
  MIN_PRIOR_CLICKS_PER_QUARTER,
  MIN_CLICKS_DROP_FRACTION,
  type QuarterlyPageDelta,
} from "./decay-queue";

function row(page: string, prior: { clicks: number; impressions: number; position: number }, current: { clicks: number; impressions: number; position: number }): QuarterlyPageDelta {
  return { page, prior: { page, ...prior }, current: { page, ...current } };
}

describe("rankRefreshCandidates", () => {
  it("queues a page that lost real clicks quarter over quarter", () => {
    const rows = [row("/persian-cats", { clicks: 480, impressions: 9000, position: 4.2 }, { clicks: 300, impressions: 7000, position: 6.1 })];
    const ranked = rankRefreshCandidates(rows);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.page).toBe("/persian-cats");
    expect(ranked[0]!.clicksLostQuarter).toBe(180);
    expect(ranked[0]!.clicksLostPerMonth).toBeCloseTo(60, 5);
    expect(ranked[0]!.positionDrift).toBeCloseTo(1.9, 5);
  });

  it("floors out tiny pages below MIN_PRIOR_CLICKS_PER_QUARTER even with a big percentage drop", () => {
    const rows = [row("/tiny-page", { clicks: 40, impressions: 500, position: 8 }, { clicks: 5, impressions: 100, position: 15 })];
    expect(MIN_PRIOR_CLICKS_PER_QUARTER).toBeGreaterThan(40);
    expect(rankRefreshCandidates(rows)).toEqual([]);
  });

  it("does not queue a page whose drop is below MIN_CLICKS_DROP_FRACTION (noise, not a fade)", () => {
    const rows = [row("/steady-page", { clicks: 500, impressions: 9000, position: 4 }, { clicks: 480, impressions: 8800, position: 4.1 })];
    const dropFraction = (500 - 480) / 500;
    expect(dropFraction).toBeLessThan(MIN_CLICKS_DROP_FRACTION);
    expect(rankRefreshCandidates(rows)).toEqual([]);
  });

  it("does not queue a page that grew clicks", () => {
    const rows = [row("/growing-page", { clicks: 500, impressions: 9000, position: 4 }, { clicks: 700, impressions: 12000, position: 3 })];
    expect(rankRefreshCandidates(rows)).toEqual([]);
  });

  it("does not queue a page with zero prior clicks (no division by zero, no crash)", () => {
    const rows = [row("/new-page", { clicks: 0, impressions: 0, position: 0 }, { clicks: 0, impressions: 0, position: 0 })];
    expect(rankRefreshCandidates(rows)).toEqual([]);
  });

  it("ranks worst-lost-clicks-first, not worst-percentage-first", () => {
    const rows = [
      // Loses fewer absolute clicks (120) but a bigger percentage (60%).
      row("/small-fast-fade", { clicks: 200, impressions: 3000, position: 5 }, { clicks: 80, impressions: 1500, position: 8 }),
      // Loses more absolute clicks (300) at a smaller percentage (30%).
      row("/big-slow-fade", { clicks: 1000, impressions: 15000, position: 3 }, { clicks: 700, impressions: 12000, position: 4 }),
    ];
    const ranked = rankRefreshCandidates(rows);
    expect(ranked.map((r) => r.page)).toEqual(["/big-slow-fade", "/small-fast-fade"]);
  });

  it("handles a page with unknown positions (0) without a bogus positionDrift", () => {
    const rows = [row("/no-position-data", { clicks: 300, impressions: 5000, position: 0 }, { clicks: 150, impressions: 2000, position: 0 })];
    const ranked = rankRefreshCandidates(rows);
    expect(ranked[0]!.positionDrift).toBe(0);
  });

  it("respects an explicit limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row(`/page-${i}`, { clicks: 1000 - i, impressions: 15000, position: 3 }, { clicks: 500 - i, impressions: 8000, position: 5 }),
    );
    const ranked = rankRefreshCandidates(rows, { limit: 2 });
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.page).toBe("/page-0");
    expect(ranked[1]!.page).toBe("/page-1");
  });

  it("respects custom floor overrides", () => {
    const rows = [row("/mid-page", { clicks: 60, impressions: 1200, position: 5 }, { clicks: 30, impressions: 600, position: 7 })];
    expect(rankRefreshCandidates(rows)).toEqual([]); // below default floor
    const ranked = rankRefreshCandidates(rows, { minPriorClicks: 50 });
    expect(ranked).toHaveLength(1);
  });

  it("never emits an em or en dash in the sentence, and reports per-month numbers honestly", () => {
    const sentence = buildRefreshSentence({ priorClicks: 480, clicksLostPerMonth: 60, positionDrift: 2.5 });
    expect(sentence).not.toMatch(/[–—]/);
    // 480 clicks per QUARTER = 160 a month - the sentence must never present the quarter
    // total as a monthly figure.
    expect(sentence).toContain("160 clicks a month");
    expect(sentence).not.toContain("480");
    expect(sentence).toContain("60");
  });

  it("sentence omits the position line when drift is under 2 spots", () => {
    const sentence = buildRefreshSentence({ priorClicks: 480, clicksLostPerMonth: 60, positionDrift: 0.5 });
    expect(sentence).not.toContain("slipped");
  });
});
