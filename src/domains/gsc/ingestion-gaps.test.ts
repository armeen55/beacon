import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  GAP_REPULL_CAP_PER_NIGHT,
  GSC_FINAL_LAG_DAYS,
  buildIngestionGapReport,
  classifyMissingDay,
  ingestionGapLine,
  pacificTodayString,
  selectGapRepullDates,
} from "./ingestion-gaps";

const BANNED_DASH = /[‒–—―]/;

/** Jun 1 .. Jun 28 (inclusive), minus the given days. */
function juneDates(missing: string[] = []): string[] {
  const out: string[] = [];
  for (let d = 1; d <= 28; d++) {
    const iso = `2026-06-${String(d).padStart(2, "0")}`;
    if (!missing.includes(iso)) out.push(iso);
  }
  return out;
}

describe("buildIngestionGapReport", () => {
  it("classifies holes inside the covered range as gaps and the trailing lag as expected", () => {
    const report = buildIngestionGapReport(juneDates(["2026-06-14", "2026-06-15"]), "2026-07-01");
    expect(report.firstIngestedDate).toBe("2026-06-01");
    expect(report.lastIngestedDate).toBe("2026-06-28");
    expect(report.lastExpectedDate).toBe("2026-06-28");
    expect(report.expectedDayCount).toBe(28);
    expect(report.presentDayCount).toBe(26);
    expect(report.gapDates).toEqual(["2026-06-14", "2026-06-15"]);
    // Jun 29, Jun 30, Jul 1 are inside Google's final lag: expected, not gaps.
    expect(report.finalLagDates).toEqual(["2026-06-29", "2026-06-30", "2026-07-01"]);
  });

  it("a complete range reports zero gaps", () => {
    const report = buildIngestionGapReport(juneDates(), "2026-07-01");
    expect(report.gapDates).toEqual([]);
    expect(report.presentDayCount).toBe(report.expectedDayCount);
  });

  it("no ingested days at all means no history and no gaps (never a fake hole)", () => {
    const report = buildIngestionGapReport([], "2026-07-01");
    expect(report.firstIngestedDate).toBeNull();
    expect(report.expectedDayCount).toBe(0);
    expect(report.gapDates).toEqual([]);
  });

  it("a missing day exactly on the last expected date is a gap, one day later is final lag", () => {
    // Today Jul 1 with a 3-day lag -> last expected day is Jun 28.
    const report = buildIngestionGapReport(juneDates(["2026-06-28"]), "2026-07-01");
    expect(report.gapDates).toEqual(["2026-06-28"]);
    expect(classifyMissingDay("2026-06-28", "2026-06-01", "2026-06-28")).toBe("gap");
    expect(classifyMissingDay("2026-06-29", "2026-06-01", "2026-06-28")).toBe("final_lag");
    expect(classifyMissingDay("2026-05-31", "2026-06-01", "2026-06-28")).toBe("pre_history");
  });

  it("ignores malformed dates instead of classifying garbage", () => {
    const report = buildIngestionGapReport(["not-a-date", "2026-06-27", "2026-06-28"], "2026-07-01");
    expect(report.firstIngestedDate).toBe("2026-06-27");
    expect(report.gapDates).toEqual([]);
  });
});

describe("selectGapRepullDates", () => {
  it("takes the newest gaps first and caps per night", () => {
    const gaps = ["2026-06-01", "2026-06-14", "2026-06-03"];
    expect(selectGapRepullDates(gaps, 2)).toEqual(["2026-06-14", "2026-06-03"]);
    expect(selectGapRepullDates(gaps)).toEqual(["2026-06-14", "2026-06-03", "2026-06-01"]);
  });
});

describe("ingestionGapLine", () => {
  it("is null with no gaps (the card renders exactly as before)", () => {
    expect(ingestionGapLine({ gapDates: [] })).toBeNull();
  });

  it("one missing day names the date", () => {
    expect(ingestionGapLine({ gapDates: ["2026-06-14"] })).toBe(
      "I am missing 1 day of Google data (Jun 14). I will re-pull it tonight.",
    );
  });

  it("a few missing days name the span and promise tonight", () => {
    expect(ingestionGapLine({ gapDates: ["2026-06-14", "2026-06-15"] })).toBe(
      "I am missing 2 days of Google data between Jun 14 and Jun 15. I will re-pull them tonight.",
    );
  });

  it("more than a night's cap says the honest pace", () => {
    const gaps = Array.from({ length: 12 }, (_, i) => `2026-06-${String(i + 2).padStart(2, "0")}`);
    const line = ingestionGapLine(gaps.length > 0 ? { gapDates: gaps } : { gapDates: [] })!;
    expect(line).toContain("I am missing 12 days of Google data between Jun 2 and Jun 13.");
    expect(line).toContain(`over the coming nights, ${GAP_REPULL_CAP_PER_NIGHT} a night`);
  });

  it("never emits an em or en dash", () => {
    for (const gaps of [["2026-06-14"], ["2026-06-14", "2026-06-20"]]) {
      expect(BANNED_DASH.test(ingestionGapLine({ gapDates: gaps })!)).toBe(false);
    }
  });
});

describe("lockstep with the sync engine", () => {
  const SYNC_SOURCE = readFileSync(
    resolve(__dirname, "../../lib/connectors/gsc/sync-search-analytics.ts"),
    "utf8",
  );

  it("GSC_FINAL_LAG_DAYS matches sync-search-analytics FINAL_LAG_DAYS", () => {
    expect(SYNC_SOURCE).toContain(`export const FINAL_LAG_DAYS = ${GSC_FINAL_LAG_DAYS}`);
  });

  it("the nightly sync actually consumes the gap re-pull (v1 266 wiring pin)", () => {
    expect(SYNC_SOURCE).toContain("loadGscIngestionGapReport");
    expect(SYNC_SOURCE).toContain("selectGapRepullDates");
    // A healed zero-traffic day is recorded as pulled truth, never left to
    // re-flag forever (and never interpolated).
    expect(SYNC_SOURCE).toContain("writeZeroTotalsWhenEmpty: true");
  });

  it("pacificTodayString renders ISO order (Search Console dates are Pacific)", () => {
    expect(pacificTodayString(new Date("2026-07-01T12:00:00.000Z"))).toBe("2026-07-01");
  });
});
