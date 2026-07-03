import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeWeekdayAdjustedLift, type DailyClickPoint } from "./weekday-baseline";
import { addDays } from "./measure";

/**
 * weekday-baseline.test.ts (P4 R10a, v1 item 285) - pins the weekday-aligned
 * comparison: median-per-weekday expectation vs the raw daily-mean number,
 * the 20 percent prefer-adjusted threshold, the honest weekend-vs-generic
 * sentence split, and the coverage guards (never a fake zero for a day the
 * read did not cover or GSC has not finalized).
 *
 * Calendar anchor: 2026-05-31 is a Sunday (and ship minus 28 = 2026-05-03 is
 * also a Sunday), so a 7-day window always holds exactly one Saturday and one
 * Sunday - the divergence in these fixtures comes from median-vs-mean
 * robustness, which is exactly what the aligned mode buys on full weeks.
 */

const SHIP = "2026-05-31"; // Sunday
const BASELINE_START = addDays(SHIP, -28); // 2026-05-03, Sunday

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function seriesBetween(
  start: string,
  days: number,
  clicksFor: (date: string, weekday: number) => number,
): DailyClickPoint[] {
  const out: DailyClickPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    out.push({ date, clicks: clicksFor(date, weekdayOf(date)) });
  }
  return out;
}

const base = {
  shipDate: SHIP,
  windowDays: 7,
  preWindowDays: 28,
  knownFrom: "2026-05-01",
  lastFinalizedDate: "2026-06-10",
};

describe("computeWeekdayAdjustedLift", () => {
  it("one baseline spike day skews the raw mean; the weekday medians read the flat page honestly", () => {
    // Baseline: flat 10/day except one 290-click viral day. Post week: flat 12/day.
    const series = [
      ...seriesBetween(BASELINE_START, 28, (date) => (date === "2026-05-12" ? 290 : 10)),
      ...seriesBetween(SHIP, 7, () => 12),
    ];
    const read = computeWeekdayAdjustedLift({ ...base, series });
    expect(read).not.toBeNull();
    // Raw: 84 post clicks minus (560/28)*7 = 140 expected -> -56 ("fell").
    expect(read!.rawLift).toBe(-56);
    // Aligned: every weekday median is 10 -> 7 * (12 - 10) = +14 ("grew").
    expect(read!.weekdayAdjustedLift).toBe(14);
    expect(read!.preferAdjusted).toBe(true);
    // No weekend pattern here (all medians 10) -> the generic unusual-days reason.
    expect(read!.sentence).toContain("A few unusual days skew the plain average");
    expect(read!.sentence).toContain("+14 clicks over 7 days, not -56");
  });

  it("a real weekend pattern names weekends in the sentence", () => {
    // Weekends 30, weekdays 10, plus one 200-click Saturday spike in the baseline.
    const weekendClicks = (date: string, wd: number): number =>
      date === "2026-05-09" ? 200 : wd === 0 || wd === 6 ? 30 : 10;
    const series = [
      ...seriesBetween(BASELINE_START, 28, weekendClicks),
      ...seriesBetween(SHIP, 7, (_d, wd) => (wd === 0 || wd === 6 ? 30 : 10)),
    ];
    const read = computeWeekdayAdjustedLift({ ...base, series });
    expect(read).not.toBeNull();
    // Aligned expectation matches the post week exactly -> 0 lift; the raw
    // mean (inflated by the spike Saturday) reads a fake loss.
    expect(read!.weekdayAdjustedLift).toBe(0);
    expect(read!.rawLift).toBeLessThan(-40);
    expect(read!.preferAdjusted).toBe(true);
    expect(read!.sentence).toContain(
      "Weekends behave differently on this site, so I compare like with like.",
    );
  });

  it("agreeing numbers do not prefer the adjusted figure and carry no sentence", () => {
    const series = [
      ...seriesBetween(BASELINE_START, 28, () => 10),
      ...seriesBetween(SHIP, 7, () => 11),
    ];
    const read = computeWeekdayAdjustedLift({ ...base, series });
    expect(read).not.toBeNull();
    expect(read!.rawLift).toBe(7);
    expect(read!.weekdayAdjustedLift).toBe(7);
    expect(read!.preferAdjusted).toBe(false);
    expect(read!.sentence).toBeNull();
  });

  it("a missing date inside covered, finalized ranges is an honest zero", () => {
    // Baseline series omits 2026-05-05 entirely (no GSC row = no impressions).
    const series = [
      ...seriesBetween(BASELINE_START, 28, () => 10).filter((p) => p.date !== "2026-05-05"),
      ...seriesBetween(SHIP, 7, () => 10),
    ];
    const read = computeWeekdayAdjustedLift({ ...base, series });
    expect(read).not.toBeNull();
    // Raw expectation drops by 10/28*7 = 2.5 -> rawLift +2.5 off the missing day.
    expect(read!.rawLift).toBe(2.5);
  });

  it("returns null when the series read does not cover the whole baseline window", () => {
    const series = [
      ...seriesBetween(BASELINE_START, 28, () => 10),
      ...seriesBetween(SHIP, 7, () => 12),
    ];
    const read = computeWeekdayAdjustedLift({ ...base, series, knownFrom: "2026-05-10" });
    expect(read).toBeNull();
  });

  it("returns null when GSC has not finalized the whole post window (days past the watermark are unknown, not zero)", () => {
    const series = [
      ...seriesBetween(BASELINE_START, 28, () => 10),
      ...seriesBetween(SHIP, 7, () => 12),
    ];
    const read = computeWeekdayAdjustedLift({
      ...base,
      series,
      lastFinalizedDate: addDays(SHIP, 3),
    });
    expect(read).toBeNull();
  });

  it("returns null with no finalized watermark at all", () => {
    const series = seriesBetween(BASELINE_START, 35, () => 10);
    expect(computeWeekdayAdjustedLift({ ...base, series, lastFinalizedDate: null })).toBeNull();
  });
});

describe("copy guard - dash-clean, no em or en dashes in source", () => {
  it("weekday-baseline.ts contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "weekday-baseline.ts"), "utf8");
    expect(src.includes("\u2014")).toBe(false);
    expect(src.includes("\u2013")).toBe(false);
  });
});
