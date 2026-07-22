/**
 * seasonal/seasonality tests (2026-07-02, master plan item 21): the peak-window
 * detector matrix (single-peak, bimodal, flat, sparse), confidence labeling,
 * prep-deadline math, and the hard no-dash rule.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  detectSeasonalQueries,
  seasonalSentence,
  computePeakCalendar,
  SEASONAL_MIN_ANNUAL_IMPRESSIONS,
  SEASONAL_MIN_SHARE,
  PREP_LEAD_WEEKS,
  type MonthlyArchiveRow,
  type SeasonalQuery,
} from "@/domains/seasonal/seasonality";

const NOW = new Date("2026-07-02T00:00:00Z");

function row(query: string, month: string, impressions: number, opts: { clicks?: number; topPage?: string } = {}): MonthlyArchiveRow {
  return { query, month: `${month}-01`, impressions, clicks: opts.clicks ?? Math.round(impressions * 0.05), topPage: opts.topPage ?? "/page" };
}

describe("detectSeasonalQueries - single peak month", () => {
  it("flags a query whose one month holds most of the year's impressions", () => {
    // 2025: Jan-Feb-Apr..Dec small, March huge.
    const rows: MonthlyArchiveRow[] = [
      row("nowruz table setting", "2025-01", 50),
      row("nowruz table setting", "2025-02", 80),
      row("nowruz table setting", "2025-03", 4000, { topPage: "/nowruz" }),
      row("nowruz table setting", "2025-04", 60),
      row("nowruz table setting", "2025-05", 40),
    ];
    const out = detectSeasonalQueries(rows, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].query).toBe("nowruz table setting");
    expect(out[0].peakMonths).toContain(3);
    expect(out[0].share).toBeGreaterThanOrEqual(SEASONAL_MIN_SHARE);
    expect(out[0].topPage).toBe("/nowruz");
    expect(out[0].confidence).toBe("one_season");
  });

  it("computes the prep deadline as exactly 6 weeks before the peak month starts", () => {
    const rows: MonthlyArchiveRow[] = [row("q", "2025-03", 5000), row("q", "2025-06", 10)];
    const out = detectSeasonalQueries(rows, NOW);
    expect(out).toHaveLength(1);
    // Next March 1st on/after 2026-07-02 is 2027-03-01 (this year's March already passed).
    expect(out[0].peakStartDate).toBe("2027-03-01");
    const prep = new Date(out[0].prepByDate);
    const peak = new Date(out[0].peakStartDate);
    const weeks = Math.round((peak.getTime() - prep.getTime()) / (7 * 86_400_000));
    expect(weeks).toBe(PREP_LEAD_WEEKS);
  });

  it("picks the next occurrence on/after now when the peak month has not happened yet this year", () => {
    // NOW is July 2026; a peak in October should land THIS year (2026-10-01).
    const rows: MonthlyArchiveRow[] = [row("q", "2025-10", 5000), row("q", "2025-01", 10)];
    const out = detectSeasonalQueries(rows, NOW);
    expect(out[0].peakStartDate).toBe("2026-10-01");
  });
});

describe("detectSeasonalQueries - bimodal (two adjacent months)", () => {
  it("extends to an adjacent month when that improves concentration past the floor", () => {
    const rows: MonthlyArchiveRow[] = [
      row("yalda night gifts", "2025-11", 40),
      row("yalda night gifts", "2025-12", 2200, { topPage: "/yalda" }),
      row("yalda night gifts", "2026-01", 1800, { topPage: "/yalda" }),
      row("yalda night gifts", "2026-02", 30),
    ];
    const out = detectSeasonalQueries(rows, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].peakMonths.sort((a, b) => a - b)).toEqual([1, 12]);
    expect(out[0].share).toBeGreaterThanOrEqual(SEASONAL_MIN_SHARE);
  });

  it("does not extend when neither adjacent month has any impressions (stays single-month)", () => {
    const rows: MonthlyArchiveRow[] = [
      row("chaharshanbe suri", "2025-03", 3000),
      row("chaharshanbe suri", "2025-06", 20),
    ];
    const out = detectSeasonalQueries(rows, NOW);
    expect(out[0].peakMonths).toEqual([3]);
  });
});

describe("detectSeasonalQueries - flat / non-seasonal", () => {
  it("stays silent when impressions spread evenly across the year", () => {
    const rows: MonthlyArchiveRow[] = Array.from({ length: 12 }, (_, i) =>
      row("evergreen recipe", `2025-${String(i + 1).padStart(2, "0")}`, 100),
    );
    const out = detectSeasonalQueries(rows, NOW);
    expect(out).toHaveLength(0);
  });

  it("stays silent below the annual impressions floor even with a sharp peak", () => {
    const rows: MonthlyArchiveRow[] = [
      row("tiny niche term", "2025-03", 150),
      row("tiny niche term", "2025-06", 10),
    ];
    expect(150 + 10).toBeLessThan(SEASONAL_MIN_ANNUAL_IMPRESSIONS);
    const out = detectSeasonalQueries(rows, NOW);
    expect(out).toHaveLength(0);
  });
});

describe("detectSeasonalQueries - sparse data (one year only)", () => {
  it("works with a single year of history and labels confidence honestly", () => {
    const rows: MonthlyArchiveRow[] = [
      row("norouz recipes", "2026-03", 3000),
      row("norouz recipes", "2026-05", 50),
    ];
    const out = detectSeasonalQueries(rows, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe("one_season");
  });

  it("upgrades to repeated confidence when 2+ distinct years fed the peak window", () => {
    const rows: MonthlyArchiveRow[] = [
      row("norouz recipes", "2025-03", 3000),
      row("norouz recipes", "2026-03", 3400),
      row("norouz recipes", "2025-05", 50),
    ];
    const out = detectSeasonalQueries(rows, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe("repeated");
    // Both years' March impressions fold into the same bucket.
    expect(out[0].annualImpressions).toBe(3000 + 3400);
  });

  it("returns [] for empty input", () => {
    expect(detectSeasonalQueries([], NOW)).toEqual([]);
  });

  it("ignores rows with unparseable months or empty queries", () => {
    const rows: MonthlyArchiveRow[] = [
      { query: "", month: "2026-03-01", impressions: 5000, clicks: 100 },
      { query: "q", month: "not-a-date", impressions: 5000, clicks: 100 },
    ];
    expect(detectSeasonalQueries(rows, NOW)).toEqual([]);
  });
});

describe("detectSeasonalQueries - ranking and bounds", () => {
  it("ranks the soonest prep deadline first", () => {
    const rows: MonthlyArchiveRow[] = [
      row("august wave", "2025-08", 3000), // far out from July "now"
      row("august wave", "2025-01", 10),
      row("september wave", "2025-09", 3000),
      row("september wave", "2025-02", 10),
    ];
    const out = detectSeasonalQueries(rows, NOW);
    expect(out.map((o) => o.query)).toEqual(["august wave", "september wave"]);
  });
});

describe("seasonalSentence + dash guard", () => {
  it("speaks plain first-person business copy with a real number and a prep date", () => {
    const s = seasonalSentence({ query: "nowruz table setting", peakMonths: [3], annualImpressions: 41000, prepByDate: "2026-02-15" });
    expect(s).toContain("41,000");
    expect(s).toContain("prep");
    expect(s).toContain("indexed");
  });

  it("emits no em or en dashes in any generated sentence", () => {
    const rows: MonthlyArchiveRow[] = [
      row("nowruz table setting", "2025-03", 4000),
      row("yalda gifts", "2025-12", 2000),
      row("yalda gifts", "2026-01", 1800),
    ];
    for (const s of detectSeasonalQueries(rows, NOW)) {
      expect(s.sentence).not.toMatch(/[–—]/);
    }
  });

  it("keeps every new seasonal module free of em and en dashes (hard rule)", () => {
    const files = [
      "seasonality.ts",
      "seasonal-hints.ts",
      "seasonal-store.ts",
      "archive-rollup.ts",
      "load-monthly-archive.ts",
      "peak-calendar-store.ts",
      "seasonal-candidates.ts",
    ];
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), "src/domains/seasonal", f), "utf8");
      expect(src, `${f} must not contain em or en dashes`).not.toMatch(/[–—]/);
    }
  });

  it("keeps the GSC deep backfill module free of em and en dashes (hard rule)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/connectors/gsc/deep-backfill.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});

describe("computePeakCalendar - proven-confidence matrix (master plan item 63)", () => {
  function seasonalQuery(over: Partial<SeasonalQuery> = {}): SeasonalQuery {
    return {
      query: "nowruz table setting",
      peakMonths: [3],
      share: 0.9,
      annualImpressions: 4000,
      topPage: "/nowruz",
      peakStartDate: "2027-03-01",
      prepByDate: "2027-01-18",
      sentence: "Searches climb every March.",
      confidence: "one_season",
      ...over,
    };
  }

  it("keeps one_season entries as one_season regardless of Labs data (never upgraded past repeated)", () => {
    const out = computePeakCalendar([seasonalQuery({ confidence: "one_season" })]);
    expect(out[0].confidence).toBe("one_season");
  });

  it("keeps repeated as repeated when no Labs history is supplied", () => {
    const out = computePeakCalendar([seasonalQuery({ confidence: "repeated" })]);
    expect(out[0].confidence).toBe("repeated");
  });

  it("upgrades repeated to proven when the Labs curve independently confirms the same peak month across 2+ years", () => {
    const historicalVolume = new Map([
      [
        "nowruz table setting",
        [
          { year: 2024, month: 3, searchVolume: 9000 },
          { year: 2024, month: 6, searchVolume: 200 },
          { year: 2025, month: 3, searchVolume: 9500 },
          { year: 2025, month: 6, searchVolume: 180 },
        ],
      ],
    ]);
    const out = computePeakCalendar([seasonalQuery({ confidence: "repeated", peakMonths: [3] })], historicalVolume);
    expect(out[0].confidence).toBe("proven");
  });

  it("does NOT upgrade when the Labs curve only has ONE year in the window (not independently repeated)", () => {
    const historicalVolume = new Map([
      [
        "nowruz table setting",
        [
          { year: 2025, month: 3, searchVolume: 9000 },
          { year: 2025, month: 6, searchVolume: 200 },
        ],
      ],
    ]);
    const out = computePeakCalendar([seasonalQuery({ confidence: "repeated", peakMonths: [3] })], historicalVolume);
    expect(out[0].confidence).toBe("repeated");
  });

  it("does NOT upgrade when the Labs curve peaks in a DIFFERENT month (disagreement stays honest)", () => {
    const historicalVolume = new Map([
      [
        "nowruz table setting",
        [
          { year: 2024, month: 7, searchVolume: 9000 },
          { year: 2024, month: 3, searchVolume: 200 },
          { year: 2025, month: 7, searchVolume: 9500 },
          { year: 2025, month: 3, searchVolume: 210 },
        ],
      ],
    ]);
    const out = computePeakCalendar([seasonalQuery({ confidence: "repeated", peakMonths: [3] })], historicalVolume);
    expect(out[0].confidence).toBe("repeated");
  });

  it("does NOT upgrade when the Labs curve is too flat to call seasonal on its own", () => {
    const historicalVolume = new Map([
      [
        "nowruz table setting",
        Array.from({ length: 12 }, (_, i) => ({ year: 2025, month: i + 1, searchVolume: 100 })),
      ],
    ]);
    const out = computePeakCalendar([seasonalQuery({ confidence: "repeated", peakMonths: [3] })], historicalVolume);
    expect(out[0].confidence).toBe("repeated");
  });

  it("matches keywords case-insensitively and is unaffected by unrelated cached keywords", () => {
    const historicalVolume = new Map([
      ["NOWRUZ TABLE SETTING".toLowerCase(), [
        { year: 2024, month: 3, searchVolume: 9000 },
        { year: 2025, month: 3, searchVolume: 9500 },
      ]],
      ["unrelated keyword", [{ year: 2025, month: 1, searchVolume: 500 }]],
    ]);
    const out = computePeakCalendar([seasonalQuery({ confidence: "repeated", peakMonths: [3], query: "Nowruz Table Setting" })], historicalVolume);
    expect(out[0].confidence).toBe("proven");
  });

  it("derives clusterLabel from the query text alone, title-cased, never a curated name", () => {
    const out = computePeakCalendar([seasonalQuery({ query: "chaharshanbe suri fire jumping" })]);
    expect(out[0].clusterLabel).toBe("Chaharshanbe Suri Fire Jumping");
  });

  it("carries every other field straight through from the seasonal query", () => {
    const sq = seasonalQuery({ topPage: "/yalda", annualImpressions: 12000 });
    const out = computePeakCalendar([sq]);
    expect(out[0]).toMatchObject({
      peakMonths: sq.peakMonths,
      prepByDate: sq.prepByDate,
      peakStartDate: sq.peakStartDate,
      expectedImpressions: 12000,
      topPage: "/yalda",
      sentence: sq.sentence,
    });
  });

  it("returns [] for empty input", () => {
    expect(computePeakCalendar([])).toEqual([]);
  });
});
