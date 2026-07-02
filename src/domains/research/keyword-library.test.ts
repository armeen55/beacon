import { describe, expect, it } from "vitest";

import { mergeKeywordLibrary, type KeywordLibraryRow } from "./keyword-library";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

function demandRow(overrides: Partial<KeywordDemand> = {}): KeywordDemand {
  return {
    keyword: "persian wedding traditions",
    searchVolume: 320,
    cpcUsd: 0.5,
    competition: 0.2,
    competitionLevel: "low",
    monthlySearches: [],
    locationCode: 2840,
    languageCode: "en",
    source: "dataforseo",
    fetchedAt: "2026-06-01T00:00:00.000Z",
    confidence: "high",
    evidenceRef: "test",
    ...overrides,
  };
}

const EMPTY_INPUT = {
  gscQueries: [],
  demand: [],
  difficulty: new Map<string, number | null>(),
  gapKeywords: [],
  serpReadings: new Map(),
  paaByQuery: new Map(),
  spikeQueries: new Set<string>(),
  seasonalQueries: new Set<string>(),
  ownDomain: null,
};

function rowFor(rows: KeywordLibraryRow[], keyword: string): KeywordLibraryRow | undefined {
  return rows.find((r) => r.keyword.toLowerCase() === keyword.toLowerCase());
}

describe("mergeKeywordLibrary — label rule (operator hard correction)", () => {
  it("keeps searchesPerMo (market volume) and timesShownPerMo (GSC impressions) as two distinct numbers", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [{ query: "persian new year", clicks: 12, impressions: 900, position: 4.2, ownerPage: "/nowruz" }],
      demand: [demandRow({ keyword: "persian new year", searchVolume: 2400 })],
    });
    const row = rowFor(lib.rows, "persian new year")!;
    expect(row.searchesPerMo).toBe(2400);
    expect(row.timesShownPerMo).toBe(900);
    expect(row.searchesPerMo).not.toBe(row.timesShownPerMo);
  });

  it("never fabricates a market volume from GSC impressions — stays null when DataForSEO has no data", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [{ query: "chaharshanbe suri 2026", clicks: 3, impressions: 400, position: 8, ownerPage: null }],
    });
    const row = rowFor(lib.rows, "chaharshanbe suri 2026")!;
    expect(row.searchesPerMo).toBeNull();
    expect(row.timesShownPerMo).toBe(400);
  });
});

describe("mergeKeywordLibrary — dedupe + merge across sources", () => {
  it("collapses one keyword string from multiple sources into ONE row, case/whitespace-insensitive", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [{ query: "  Persian Wedding Traditions ", clicks: 5, impressions: 100, position: 6, ownerPage: "/weddings" }],
      demand: [demandRow({ keyword: "persian wedding traditions" })],
      difficulty: new Map([["persian wedding traditions", 42]]),
    });
    expect(lib.total).toBe(1);
    const row = lib.rows[0];
    expect(row.timesShownPerMo).toBe(100);
    expect(row.searchesPerMo).toBe(320);
    expect(row.difficulty).toBe(42);
    expect(row.sources.sort()).toEqual(["dataforseo_demand", "dataforseo_difficulty", "gsc"].sort());
  });

  it("tags the owner page and its dossier href from GSC's best-impression page", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [{ query: "sofreh aghd meaning", clicks: 20, impressions: 500, position: 3, ownerPage: "/weddings/sofreh-aghd" }],
    });
    const row = rowFor(lib.rows, "sofreh aghd meaning")!;
    expect(row.ownerPage).toBe("/weddings/sofreh-aghd");
    expect(row.ownerPageHref).toBe("/page/weddings/sofreh-aghd");
  });

  it("merges competitor owners from the keyword-gap store without duplicates", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gapKeywords: [
        { keyword: "farsi boy names", volume: 1800, competitorDomain: "babynames.com", ownRank: 14 },
        { keyword: "farsi boy names", volume: 1800, competitorDomain: "babynames.com", ownRank: 14 },
        { keyword: "farsi boy names", volume: 1800, competitorDomain: "nameberry.com", ownRank: 14 },
      ],
    });
    const row = rowFor(lib.rows, "farsi boy names")!;
    expect(row.competitorOwners).toEqual(["babynames.com", "nameberry.com"]);
    expect(row.searchesPerMo).toBe(1800);
    expect(row.yourPosition).toBe(14);
  });

  it("merges SERP-history competitor domains excluding the tenant's own domain", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      ownDomain: "iranopedia.com",
      serpReadings: new Map([
        [
          "iranian new year traditions",
          {
            capturedAt: "2026-06-30T00:00:00.000Z",
            ownRank: 5,
            topDomains: [{ domain: "wikipedia.org" }, { domain: "iranopedia.com" }, { domain: "britannica.com" }],
          },
        ],
      ]),
    });
    const row = rowFor(lib.rows, "iranian new year traditions")!;
    expect(row.competitorOwners).toEqual(["wikipedia.org", "britannica.com"]);
    expect(row.yourPosition).toBe(5);
    expect(row.sources).toContain("serp_history");
  });

  it("attaches related questions from People Also Ask history", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      paaByQuery: new Map([["what is nowruz", [{ question: "When is Nowruz celebrated?" }, { question: "What foods are eaten at Nowruz?" }]]]),
    });
    const row = rowFor(lib.rows, "what is nowruz")!;
    expect(row.relatedQuestions).toEqual(["When is Nowruz celebrated?", "What foods are eaten at Nowruz?"]);
  });

  it("tags trend as spike only for queries the trend radar actually flagged this week", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [
        { query: "yalda night", clicks: 40, impressions: 3000, position: 2, ownerPage: "/yalda" },
        { query: "generic query", clicks: 1, impressions: 50, position: 20, ownerPage: null },
      ],
      spikeQueries: new Set(["yalda night"]),
    });
    expect(rowFor(lib.rows, "yalda night")!.trend).toBe("spike");
    expect(rowFor(lib.rows, "generic query")!.trend).toBeNull();
  });

  it("tags trend as seasonal for a recurring-peak query with no spike this week", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [{ query: "nowruz gift ideas", clicks: 10, impressions: 800, position: 6, ownerPage: "/nowruz-gifts" }],
      seasonalQueries: new Set(["nowruz gift ideas"]),
    });
    expect(rowFor(lib.rows, "nowruz gift ideas")!.trend).toBe("seasonal");
  });

  it("prefers spike over seasonal when a query is both this week", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [{ query: "yalda gifts", clicks: 5, impressions: 200, position: 9, ownerPage: null }],
      seasonalQueries: new Set(["yalda gifts"]),
      spikeQueries: new Set(["yalda gifts"]),
    });
    expect(rowFor(lib.rows, "yalda gifts")!.trend).toBe("spike");
  });

  it("creates a row for a spiking or seasonal query even with no GSC/demand history at all", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      spikeQueries: new Set(["brand new spiking term"]),
      seasonalQueries: new Set(["brand new seasonal term"]),
    });
    expect(rowFor(lib.rows, "brand new spiking term")!.trend).toBe("spike");
    expect(rowFor(lib.rows, "brand new seasonal term")!.trend).toBe("seasonal");
    expect(lib.total).toBe(2);
  });
});

describe("mergeKeywordLibrary — coverage stats + sort order", () => {
  it("counts volumeCoverage as only rows with a real (non-null) searchesPerMo", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [
        { query: "known volume kw", clicks: 1, impressions: 10, position: 5, ownerPage: null },
        { query: "unknown volume kw", clicks: 1, impressions: 10, position: 5, ownerPage: null },
      ],
      demand: [demandRow({ keyword: "known volume kw", searchVolume: 500 })],
    });
    expect(lib.total).toBe(2);
    expect(lib.volumeCoverage).toBe(1);
  });

  it("sorts rows by GSC impressions first (real observed demand), then market volume as the tiebreak", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [
        { query: "low impressions", clicks: 1, impressions: 20, position: 5, ownerPage: null },
        { query: "high impressions", clicks: 1, impressions: 500, position: 5, ownerPage: null },
      ],
      demand: [demandRow({ keyword: "volume only kw", searchVolume: 9000 })],
    });
    // A keyword with zero GSC impressions sorts after any keyword with real impressions,
    // even a small one — impressions reflect this tenant's own observed demand.
    expect(lib.rows.map((r) => r.keyword)).toEqual(["high impressions", "low impressions", "volume only kw"]);
  });

  it("reports zero rows and zero coverage for a fully empty tenant", () => {
    const lib = mergeKeywordLibrary(EMPTY_INPUT);
    expect(lib.total).toBe(0);
    expect(lib.volumeCoverage).toBe(0);
    expect(lib.rows).toEqual([]);
  });

  it("tracks per-source counts in bySource", () => {
    const lib = mergeKeywordLibrary({
      ...EMPTY_INPUT,
      gscQueries: [{ query: "kw one", clicks: 1, impressions: 10, position: 5, ownerPage: null }],
      demand: [demandRow({ keyword: "kw one", searchVolume: 100 }), demandRow({ keyword: "kw two", searchVolume: 200 })],
    });
    expect(lib.bySource.gsc).toBe(1);
    expect(lib.bySource.dataforseo_demand).toBe(2);
  });
});
