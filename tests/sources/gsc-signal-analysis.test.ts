/**
 * SOURCES — GSC signal analysis (Core 100K lane S merge).
 * Merged from src/domains/gsc/{brand-split, striking-portfolio,
 * back-of-results, fresh-tail, ingestion-gaps, densify-daily-series,
 * anonymized-share}.
 */

import { ANONYMIZED_NOTE_MIN_SHARE, anonymizedQueryShare, anonymizedShareNote } from "@/domains/gsc/anonymized-share";
import { BACK_OF_RESULTS_CAP, BACK_OF_RESULTS_MIN_IMPRESSIONS, BACK_OF_RESULTS_MIN_POSITION, type BackOfResultsInput, buildBackOfResultsRegister, ordinal } from "@/domains/gsc/back-of-results";
import { FRESH_TAIL_MAX_DAYS, FRESH_TAIL_NOTE, buildFreshTailPoints, freshTailWindow } from "@/domains/gsc/fresh-tail";
import { GAP_REPULL_CAP_PER_NIGHT, GSC_FINAL_LAG_DAYS, buildIngestionGapReport, classifyMissingDay, ingestionGapLine, pacificTodayString, selectGapRepullDates } from "@/domains/gsc/ingestion-gaps";
import { densifyDailyClicks } from "@/domains/gsc/densify-daily-series";
import { describe, expect, it } from "vitest";
import { isStrikingDistance as reExported } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type BrandSplitRow, brandTokensFor, brandTokensForConfig, buildScoreboardBrandLens, isBrandQuery } from "@/domains/gsc/brand-split";
import { type StrikingQueryInput, buildStrikingPortfolio, isStrikingDistance } from "@/domains/gsc/striking-portfolio";
import { type TenantCtrCurve, brandTokensFor as reExportedTokens, defaultCtrCurve, isBrandQuery as reExportedIsBrand } from "@/domains/forecast/tenant-ctr-curve";

const BANNED_DASH = /[‒–—―]/;

describe("brandTokensFor (moved from R9, byte-identical behavior)", () => {
  it("multi-word brand yields the full name plus the leading word", () => {
    expect(brandTokensFor("Ritz Builders")).toEqual(["ritz builders", "ritz"]);
  });




  it("tenant-ctr-curve re-exports the SAME functions (one implementation)", () => {
    expect(reExportedTokens).toBe(brandTokensFor);
    expect(reExportedIsBrand).toBe(isBrandQuery);
  });
});

describe("isBrandQuery", () => {
  const tokens = brandTokensFor("Ritz Builders");

  it("matches the full brand and the leading word, case-insensitive", () => {
    expect(isBrandQuery("Ritz Builders reviews", tokens)).toBe(true);
    expect(isBrandQuery("ritz kitchen remodel", tokens)).toBe(true);
  });



  it("no tokens means nothing is brand (never a guess)", () => {
    expect(isBrandQuery("ritz builders", [])).toBe(false);
  });
});

describe("brandTokensForConfig", () => {
  it("adds the domain label and dedupes against the name", () => {
    expect(brandTokensForConfig({ name: "Iranopedia", domain: "https://www.iranopedia.com" })).toEqual([
      "iranopedia",
    ]);
  });


  it("a too-short domain label is skipped (would classify half the language)", () => {
    expect(brandTokensForConfig({ domain: "go.com" })).toEqual([]);
  });

});

describe("buildScoreboardBrandLens", () => {
  /** 14 ascending reported dates: Jun 1 .. Jun 14. */
  const dates = Array.from({ length: 14 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);
  const tokens = brandTokensFor("Iranopedia");

  const row = (date: string, query: string, clicks: number): BrandSplitRow => ({ date, query, clicks });

  it("splits clicks brand vs non-brand on the scoreboard's own week windows", () => {
    const rows: BrandSplitRow[] = [
      // prior 7 (Jun 1-7): 10 non-brand, 5 brand
      row("2026-06-02", "persian recipes", 10),
      row("2026-06-03", "iranopedia", 5),
      // last 7 (Jun 8-14): 12 non-brand, 7 brand
      row("2026-06-09", "persian boy names", 8),
      row("2026-06-10", "tehran travel guide", 4),
      row("2026-06-12", "iranopedia persian names", 7),
      // outside both windows: ignored
      row("2026-05-20", "persian cats", 99),
    ];
    const lens = buildScoreboardBrandLens({ rows, tokens, reportedDates: dates })!;
    expect(lens.prior7).toEqual({ nonBrandClicks: 10, brandClicks: 5 });
    expect(lens.last7).toEqual({ nonBrandClicks: 12, brandClicks: 7 });
    expect(lens.nonBrandDeltaPct).toBe(20);
    expect(lens.subLine).toContain("Non-brand clicks: 12");
    expect(lens.subLine).toContain("the growth that finds NEW people");
    expect(lens.subLine).toContain("up 20% vs the week before");
    expect(lens.subLine).toContain("Counted from searches where Google shows me the words.");
  });


  it("returns null without brand tokens, under 14 reported days, or with no visible clicks", () => {
    const rows = [row("2026-06-09", "persian recipes", 6)];
    expect(buildScoreboardBrandLens({ rows, tokens: [], reportedDates: dates })).toBeNull();
    expect(buildScoreboardBrandLens({ rows, tokens, reportedDates: dates.slice(0, 10) })).toBeNull();
    expect(buildScoreboardBrandLens({ rows: [], tokens, reportedDates: dates })).toBeNull();
  });

  it("never emits an em or en dash", () => {
    const lens = buildScoreboardBrandLens({
      rows: [row("2026-06-09", "persian recipes", 6), row("2026-06-02", "persian food", 9)],
      tokens,
      reportedDates: dates,
    })!;
    expect(BANNED_DASH.test(lens.subLine)).toBe(false);
  });
});

const BANNED_DASH_c1 = /[‒–—―]/;

describe("isStrikingDistance (moved from gsc-page-queries, byte-identical)", () => {
  it("holds at the position and impression boundaries", () => {
    expect(isStrikingDistance(4, 100)).toBe(true);
    expect(isStrikingDistance(15, 100)).toBe(true);
    expect(isStrikingDistance(3.9, 100)).toBe(false);
    expect(isStrikingDistance(15.1, 100)).toBe(false);
    expect(isStrikingDistance(8, 99)).toBe(false);
    expect(isStrikingDistance(8, 100)).toBe(true);
  });

  it("gsc-page-queries re-exports the SAME function (one implementation)", () => {
    expect(reExported).toBe(isStrikingDistance);
  });
});

const q = (over: Partial<StrikingQueryInput>): StrikingQueryInput => ({
  query: "persian recipes",
  clicks: 10,
  impressions: 500,
  position: 8,
  ...over,
});

describe("buildStrikingPortfolio", () => {
  it("counts distinct striking searches and sums their impressions", () => {
    const portfolio = buildStrikingPortfolio([
      q({ query: "persian recipes", impressions: 3000, position: 8 }),
      q({ query: "tehran travel", impressions: 500, position: 12 }),
      q({ query: "top of page one", impressions: 900, position: 2 }), // not striking
      q({ query: "thin demand", impressions: 50, position: 9 }), // under the floor
    ])!;
    expect(portfolio.queryCount).toBe(2);
    expect(portfolio.totalImpressions).toBe(3500);
    expect(portfolio.headline).toContain("2 searches rank just below the top results");
    expect(portfolio.headline).toContain("shown 3,500 times in the last 90 days");
  });

  it("collapses the same query across pages (summed impressions, weighted position)", () => {
    const portfolio = buildStrikingPortfolio([
      q({ query: "Persian Recipes", impressions: 300, position: 6 }),
      q({ query: "persian recipes", impressions: 300, position: 10 }),
    ])!;
    // One query, 600 impressions, weighted position 8 (still striking).
    expect(portfolio.queryCount).toBe(1);
    expect(portfolio.totalImpressions).toBe(600);
  });

  it("excludes brand searches through the one brand classifier", () => {
    const portfolio = buildStrikingPortfolio(
      [
        q({ query: "iranopedia persian names", impressions: 2000, position: 8 }),
        q({ query: "persian names", impressions: 800, position: 8 }),
      ],
      { brandTokens: brandTokensFor("Iranopedia") },
    )!;
    expect(portfolio.queryCount).toBe(1);
    expect(portfolio.totalImpressions).toBe(800);
  });

  it("returns null when nothing qualifies (surfaces self-hide, never a bare zero)", () => {
    expect(buildStrikingPortfolio([])).toBeNull();
    expect(buildStrikingPortfolio([q({ position: 2 })])).toBeNull();
  });

  it("sizes the push through the CTR curve and forecastRange's capture band", () => {
    // Default curve: expected CTR at position 3 is 0.11. One query, 3,000
    // impressions, 30 clicks: top-3 clicks 330, gap 300 over 90 days ->
    // 100/month -> 25 to 75 through the 25/75 capture band.
    const portfolio = buildStrikingPortfolio(
      [q({ query: "persian recipes", impressions: 3000, clicks: 30, position: 8 })],
      { curve: defaultCtrCurve(new Date("2026-07-01T00:00:00Z")) },
    )!;
    expect(portfolio.extraClicksLowPerMonth).toBe(25);
    expect(portfolio.extraClicksHighPerMonth).toBe(75);
    expect(portfolio.sizingLine).toContain("Reaching the top 3 is usually worth 25 to 75 extra clicks a month");
    expect(portfolio.sizingLine).toContain("typical click rates at each Google position");
  });


  it("no curve means no sizing line, never an invented number", () => {
    const portfolio = buildStrikingPortfolio([q({ impressions: 3000, position: 8 })])!;
    expect(portfolio.sizingLine).toBeNull();
    expect(portfolio.extraClicksLowPerMonth).toBeNull();
  });

  it("never emits an em or en dash", () => {
    const portfolio = buildStrikingPortfolio(
      [q({ impressions: 3000, clicks: 30, position: 8 })],
      { curve: defaultCtrCurve(new Date("2026-07-01T00:00:00Z")) },
    )!;
    expect(BANNED_DASH_c1.test(portfolio.headline)).toBe(false);
    expect(BANNED_DASH_c1.test(portfolio.sizingLine ?? "")).toBe(false);
  });
});

const BANNED_DASH_c2 = /[‒–—―]/;

const row = (over: Partial<BackOfResultsInput>): BackOfResultsInput => ({
  query: "persian saffron",
  clicks: 0,
  impressions: 400,
  position: 42,
  page: "https://example.com/saffron",
  ...over,
});


describe("buildBackOfResultsRegister (deep-rank demand, invisible everywhere else)", () => {
  it("keeps the 30-to-100 band with real demand and builds the honest line", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "persian saffron", impressions: 900, position: 40 }),
    ])!;
    expect(reg.queries).toHaveLength(1);
    const q = reg.queries[0]!;
    expect(q.position).toBe(40);
    expect(q.line).toContain('You rank around 40th for "persian saffron"');
    expect(q.line).toContain("Google showed you 900 times in the last 90 days");
    expect(q.line).toContain("A dedicated page could compete properly.");
  });


  it("honors the position boundaries exactly", () => {
    expect(BACK_OF_RESULTS_MIN_POSITION).toBe(30);
    const atFloor = buildBackOfResultsRegister([row({ query: "at 30", impressions: 900, position: 30 })]);
    expect(atFloor).not.toBeNull();
    const under = buildBackOfResultsRegister([row({ query: "at 29.9", impressions: 900, position: 29.9 })]);
    expect(under).toBeNull();
  });


  it("collapses the same query across pages, summing demand and weighting position", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "Persian Saffron", impressions: 300, position: 35, page: "https://example.com/a" }),
      row({ query: "persian saffron", impressions: 600, position: 45, page: "https://example.com/b" }),
    ])!;
    expect(reg.queries).toHaveLength(1);
    const q = reg.queries[0]!;
    expect(q.impressions).toBe(900);
    // Weighted position: (35*300 + 45*600) / 900 = 41.67 -> rounds to 42.
    expect(q.position).toBe(42);
    // Owner page is the one that took the most impressions.
    expect(q.ownerPage).toBe("https://example.com/b");
  });

  it("excludes brand searches through the one brand classifier", () => {
    const reg = buildBackOfResultsRegister(
      [
        row({ query: "iranopedia saffron", impressions: 900, position: 40 }),
        row({ query: "persian saffron", impressions: 900, position: 40 }),
      ],
      { brandTokens: brandTokensFor("Iranopedia") },
    )!;
    expect(reg.queries.map((q) => q.query)).toEqual(["persian saffron"]);
  });

  it("ranks by demand and caps the section", () => {
    const many = Array.from({ length: BACK_OF_RESULTS_CAP + 5 }, (_, i) =>
      row({ query: `q${i}`, impressions: 300 + i * 10, position: 40 }),
    );
    const reg = buildBackOfResultsRegister(many)!;
    expect(reg.queries).toHaveLength(BACK_OF_RESULTS_CAP);
    // Biggest demand first: q14 (impressions 440) leads.
    expect(reg.queries[0]!.query).toBe(`q${BACK_OF_RESULTS_CAP + 4}`);
    // The cap is honored on the sub-line count too.
    expect(reg.subLine).toContain(`${BACK_OF_RESULTS_CAP} searches`);
  });


  it("keeps ownerPage null when no page carried impressions (never a guess)", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "pageless", impressions: 900, position: 40, page: null }),
    ])!;
    expect(reg.queries[0]!.ownerPage).toBeNull();
  });

  it("is empty-safe: nothing qualifying returns null so the section self-hides", () => {
    expect(buildBackOfResultsRegister([])).toBeNull();
    expect(buildBackOfResultsRegister([row({ query: "", impressions: 900, position: 40 })])).toBeNull();
    expect(buildBackOfResultsRegister([row({ impressions: 0, position: 40 })])).toBeNull();
  });


  it("never emits an em or en dash on any rendered string", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "persian saffron", impressions: 900, position: 40 }),
    ])!;
    expect(BANNED_DASH_c2.test(reg.subLine)).toBe(false);
    for (const q of reg.queries) expect(BANNED_DASH_c2.test(q.line)).toBe(false);
  });
});

const BANNED_DASH_c3 = /[‒–—―]/;

describe("freshTailWindow (the settling window the fresh read may cover)", () => {
  it("spans the day after the last reported day through today", () => {
    // Last final day Jun 28, today Jul 1 -> window Jun 29..Jul 1 (3 days).
    expect(freshTailWindow("2026-06-28", "2026-07-01")).toEqual({
      start: "2026-06-29",
      end: "2026-07-01",
    });
  });

  it("is null when there is no reported history yet (nothing to settle against)", () => {
    expect(freshTailWindow(null, "2026-07-01")).toBeNull();
  });


  it("is null when the gap is wider than the lag window (a sync hole, not settling)", () => {
    // FRESH_TAIL_MAX_DAYS = lag + 1 = 4. A 5-day gap is a sync problem.
    expect(FRESH_TAIL_MAX_DAYS).toBe(GSC_FINAL_LAG_DAYS + 1);
    expect(freshTailWindow("2026-06-26", "2026-07-01")).toBeNull(); // 5-day gap
    // Exactly at the cap still renders (4-day gap).
    expect(freshTailWindow("2026-06-27", "2026-07-01")).toEqual({
      start: "2026-06-28",
      end: "2026-07-01",
    });
  });

  it("is null on an unparseable reported date instead of inventing a window", () => {
    expect(freshTailWindow("not-a-date", "2026-07-01")).toBeNull();
  });
});

describe("buildFreshTailPoints (Google's early counts, always labeled settling)", () => {
  const window = { start: "2026-06-29", end: "2026-07-01" };

  it("maps date-keyed rows in the window to ascending settling points", () => {
    const points = buildFreshTailPoints(
      [
        { keys: ["2026-07-01"], clicks: 12 },
        { keys: ["2026-06-29"], clicks: 30 },
        { keys: ["2026-06-30"], clicks: 21 },
      ],
      window,
    );
    expect(points.map((p) => p.date)).toEqual(["2026-06-29", "2026-06-30", "2026-07-01"]);
    expect(points.map((p) => p.clicks)).toEqual([30, 21, 12]);
    // THE INVIOLABLE RULE: every point is marked as an early, non-final count.
    expect(points.every((p) => p.settling === true)).toBe(true);
  });

  it("drops rows outside the window and never invents a missing day as zero", () => {
    const points = buildFreshTailPoints(
      [
        { keys: ["2026-06-28"], clicks: 99 }, // before window
        { keys: ["2026-06-30"], clicks: 21 }, // in window
        { keys: ["2026-07-05"], clicks: 5 }, // after window
      ],
      window,
    );
    // Only the in-window day survives; Jun 29 and Jul 1 are simply absent, not zero.
    expect(points).toEqual([{ date: "2026-06-30", clicks: 21, settling: true }]);
  });

  it("ignores malformed keys and floors negative clicks at zero", () => {
    const points = buildFreshTailPoints(
      [
        { keys: [], clicks: 5 },
        { keys: ["garbage"], clicks: 5 },
        { keys: ["2026-06-30"], clicks: -4 },
      ],
      window,
    );
    expect(points).toEqual([{ date: "2026-06-30", clicks: 0, settling: true }]);
  });

});

describe("FRESH_TAIL_NOTE (the one honest label the chart shows)", () => {
  it("names the early count and the settling period, dash-clean, no lab words", () => {
    expect(FRESH_TAIL_NOTE).toContain("early count");
    expect(FRESH_TAIL_NOTE).toContain("3 days");
    expect(BANNED_DASH_c3.test(FRESH_TAIL_NOTE)).toBe(false);
    expect(FRESH_TAIL_NOTE).not.toMatch(/dataState|SERP|final|impressions/i);
  });
});

describe("THE INVIOLABLE RULE: the loader never touches the final daily tables", () => {
  const LOADER_SOURCE = readFileSync(resolve(__dirname, "../../src/domains/gsc/load-fresh-tail.ts"), "utf8");

  it("load-fresh-tail.ts never references gsc_daily_rows / gsc_daily_totals or an is_final flag", () => {
    expect(LOADER_SOURCE).not.toMatch(/gsc_daily_rows/);
    expect(LOADER_SOURCE).not.toMatch(/gsc_daily_totals/);
    expect(LOADER_SOURCE).not.toMatch(/is_final/);
  });

  it("its only persistence write is the volatile fresh-tail cache store", () => {
    // Every writeStore CALL SITE (not the import) targets the fresh-tail store,
    // never a daily one. `writeStore<` / `writeStore(` distinguishes a call
    // from the `import { ..., writeStore }` line.
    const writes = LOADER_SOURCE.match(/writeStore[<(][^;]*;/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w).toContain("GSC_FRESH_TAIL_STORE");
    }
  });

  it("the fresh pull reads Google's EARLY numbers (dataState all), not final", () => {
    expect(LOADER_SOURCE).toContain('dataState: "all"');
  });
});

const BANNED_DASH_c4 = /[‒–—―]/;

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

  it("one missing day names the date", () => {
    expect(ingestionGapLine({ gapDates: ["2026-06-14"] })).toBe(
      "I am missing 1 day of Google data (Jun 14). I will re-pull it automatically while you use Beacon.",
    );
  });

  it("a few missing days name the span and promise tonight", () => {
    expect(ingestionGapLine({ gapDates: ["2026-06-14", "2026-06-15"] })).toBe(
      "I am missing 2 days of Google data between Jun 14 and Jun 15. I will re-pull them automatically while you use Beacon.",
    );
  });

  it("more than a night's cap says the honest pace", () => {
    const gaps = Array.from({ length: 12 }, (_, i) => `2026-06-${String(i + 2).padStart(2, "0")}`);
    const line = ingestionGapLine(gaps.length > 0 ? { gapDates: gaps } : { gapDates: [] })!;
    expect(line).toContain("I am missing 12 days of Google data between Jun 2 and Jun 13.");
    expect(line).toContain(`up to ${GAP_REPULL_CAP_PER_NIGHT} missing days each time background upkeep runs`);
  });

  it("never emits an em or en dash", () => {
    for (const gaps of [["2026-06-14"], ["2026-06-14", "2026-06-20"]]) {
      expect(BANNED_DASH_c4.test(ingestionGapLine({ gapDates: gaps })!)).toBe(false);
    }
  });
});

describe("lockstep with the sync engine", () => {
  const SYNC_SOURCE = readFileSync(
    resolve(__dirname, "../../src/lib/connectors/gsc/sync-search-analytics.ts"),
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

describe("densifyDailyClicks", () => {
  it("fills internal missing GSC dates with zero and sorts the series", () => {
    expect(densifyDailyClicks([
      { date: "2026-07-03", clicks: 3 },
      { date: "2026-07-01", clicks: 1 },
    ])).toEqual([
      { date: "2026-07-01", clicks: 1 },
      { date: "2026-07-02", clicks: 0 },
      { date: "2026-07-03", clicks: 3 },
    ]);
  });

  it("combines duplicate dates without inventing edge dates", () => {
    expect(densifyDailyClicks([
      { date: "2026-07-01", clicks: 1 },
      { date: "2026-07-01", clicks: 2 },
    ])).toEqual([{ date: "2026-07-01", clicks: 3 }]);
  });
});

const BANNED_DASH_c6 = /[‒–—―]/;

describe("anonymizedQueryShare", () => {
  it("is (total minus visible) over total", () => {
    expect(anonymizedQueryShare(1000, 600)).toBeCloseTo(0.4);
    expect(anonymizedQueryShare(1000, 1000)).toBe(0);
  });

  it("clamps to [0, 1] when canonicalization makes visible exceed total", () => {
    expect(anonymizedQueryShare(1000, 1200)).toBe(0);
    expect(anonymizedQueryShare(1000, 0)).toBe(1);
  });

  it("is null when either input is unknown (never a guess)", () => {
    expect(anonymizedQueryShare(0, 500)).toBeNull();
    expect(anonymizedQueryShare(null, 500)).toBeNull();
    expect(anonymizedQueryShare(1000, null)).toBeNull();
    expect(anonymizedQueryShare(1000, undefined)).toBeNull();
    expect(anonymizedQueryShare(1000, -5)).toBeNull();
    expect(anonymizedQueryShare(Number.NaN, 500)).toBeNull();
  });
});

describe("anonymizedShareNote", () => {
  it("stays silent under the threshold (a small hidden slice is normal)", () => {
    expect(anonymizedShareNote(null)).toBeNull();
    expect(anonymizedShareNote(0)).toBeNull();
    expect(anonymizedShareNote(ANONYMIZED_NOTE_MIN_SHARE - 0.01)).toBeNull();
  });

  it("speaks plainly at each magnitude", () => {
    expect(anonymizedShareNote(0.3)).toContain("About a third");
    expect(anonymizedShareNote(0.5)).toContain("About half");
    expect(anonymizedShareNote(0.7)).toContain("Most");
    expect(anonymizedShareNote(0.9)).toContain("Almost all");
  });

  it("says what is hidden and what the visible numbers cover", () => {
    const note = anonymizedShareNote(0.35)!;
    expect(note).toBe(
      "About a third of this page's Google traffic comes from searches Google keeps private. The numbers below cover what Google shows me.",
    );
  });

  it("never emits an em or en dash", () => {
    for (const share of [0.3, 0.5, 0.7, 0.95]) {
      expect(BANNED_DASH_c6.test(anonymizedShareNote(share)!)).toBe(false);
    }
  });
});
