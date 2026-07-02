import { describe, it, expect } from "vitest";
import {
  computeKeywordGaps,
  gapEvidenceSentence,
  pickGapCompetitorDomains,
  winnability,
  type KeywordGapRow,
} from "./keyword-gaps";

const row = (over: Partial<KeywordGapRow> = {}): KeywordGapRow => ({
  keyword: "persian wedding sofreh",
  volume: 1900,
  competitorDomain: "supplehomes.com",
  competitorRank: 3,
  ownRank: null,
  cpcUsd: 0.4,
  source: "ranked_keywords",
  ...over,
});

describe("computeKeywordGaps - the 'already ranks' join", () => {
  it("drops keywords the tenant already ranks <= 10 for (GSC position)", () => {
    const gaps = computeKeywordGaps({
      rows: [row({ keyword: "iran flag meaning" }), row({ keyword: "persian new year" })],
      ownedQueries: [
        { query: "Iran Flag  Meaning", position: 6.4 }, // normalization must match
        { query: "persian new year", position: 14.2 },
      ],
    });
    expect(gaps.map((g) => g.keyword)).toEqual(["persian new year"]);
    // the surviving gap carries the honest GSC rank
    expect(gaps[0].ownRank).toBe(14);
  });

  it("drops rows the intersection endpoint says the tenant ranks top 10 for", () => {
    const gaps = computeKeywordGaps({
      rows: [row({ ownRank: 8 }), row({ keyword: "chaharshanbe suri", ownRank: 31 })],
    });
    expect(gaps.map((g) => g.keyword)).toEqual(["chaharshanbe suri"]);
    expect(gaps[0].ownRank).toBe(31);
  });
});

describe("computeKeywordGaps - filters", () => {
  it("drops competitor-brand and own-brand keywords (not winnable gaps)", () => {
    const gaps = computeKeywordGaps({
      rows: [
        row({ keyword: "supplehomes reviews" }), // competitor brand
        row({ keyword: "iranopedia persian names" }), // own brand
        row({ keyword: "persian boy names" }),
      ],
      ownDomain: "iranopedia.com",
    });
    expect(gaps.map((g) => g.keyword)).toEqual(["persian boy names"]);
  });

  it("drops junk fragments and out-of-range ranks", () => {
    const gaps = computeKeywordGaps({
      rows: [row({ keyword: "ab" }), row({ competitorRank: 0 }), row({ competitorRank: 140 })],
    });
    expect(gaps).toEqual([]);
  });
});

describe("computeKeywordGaps - dedupe + ranking", () => {
  it("dedupes across competitors: best rank represents the gap, others named in alsoWonBy", () => {
    const gaps = computeKeywordGaps({
      rows: [
        row({ competitorDomain: "surfiran.com", competitorRank: 9, volume: null }),
        row({ competitorDomain: "supplehomes.com", competitorRank: 2 }),
      ],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].competitorDomain).toBe("supplehomes.com");
    expect(gaps[0].competitorRank).toBe(2);
    expect(gaps[0].alsoWonBy).toEqual(["surfiran.com"]);
    expect(gaps[0].volume).toBe(1900); // known volume survives the merge
  });

  it("ranks by volume x winnability (a rank-3 hold beats a rank-18 hold at equal volume)", () => {
    const gaps = computeKeywordGaps({
      rows: [
        row({ keyword: "persian poetry books", competitorRank: 18, volume: 5000 }),
        row({ keyword: "persian calligraphy art", competitorRank: 2, volume: 5000 }),
        row({ keyword: "nowruz table", competitorRank: 2, volume: 40 }),
      ],
    });
    expect(gaps.map((g) => g.keyword)).toEqual([
      "persian calligraphy art",
      "persian poetry books",
      "nowruz table",
    ]);
    expect(gaps[0].score).toBe(5000);
    expect(gaps[1].score).toBe(Math.round(5000 * winnability(18)));
  });

  it("caps the output", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ keyword: `unique topic ${i + 10}`, volume: 100 + i }));
    expect(computeKeywordGaps({ rows, max: 5 })).toHaveLength(5);
  });
});

describe("gap evidence - named, honest, dash-clean", () => {
  it("names the competitor, the rank, and the real volume", () => {
    const gaps = computeKeywordGaps({ rows: [row()] });
    expect(gaps[0].evidence).toBe(
      'supplehomes.com ranks 3 on Google for "persian wedding sofreh" and people search it about 1,900 times a month. You do not show up for it yet.',
    );
  });

  it("is honest when volume is unknown and when the tenant ranks below 10", () => {
    const s = gapEvidenceSentence({
      keyword: "qanat system",
      volume: null,
      competitorDomain: "surfiran.com",
      competitorRank: 7,
      ownRank: 24,
    });
    expect(s).toContain("does not report a monthly search number");
    expect(s).toContain("You sit at 24 today");
  });

  it("NEVER contains an em or en dash (hard rule)", () => {
    const gaps = computeKeywordGaps({
      rows: [row(), row({ keyword: "no volume topic", volume: null, ownRank: 15 })],
    });
    for (const g of gaps) expect(/[–—]/.test(g.evidence)).toBe(false);
  });
});

describe("pickGapCompetitorDomains", () => {
  const move = (urls: string[]) => ({ competitorUrls: urls });

  it("picks the most-cited real competitors, skipping noise/reference/own domains", () => {
    const picked = pickGapCompetitorDomains(
      [
        move(["https://supplehomes.com/a", "https://en.wikipedia.org/wiki/x", "https://www.iranopedia.com/b"]),
        move(["https://supplehomes.com/c", "https://surfiran.com/d", "https://reddit.com/r/iran"]),
        move(["https://surfiran.com/e", "https://tasteatlas.com/f", "https://tappersia.com/g"]),
        move(["https://supplehomes.com/h"]),
      ],
      "iranopedia.com",
    );
    expect(picked).toEqual(["supplehomes.com", "surfiran.com", "tappersia.com"]);
  });

  it("bounds the list and handles empty evidence", () => {
    expect(pickGapCompetitorDomains([], "iranopedia.com")).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => move([`https://comp${i}.com/page`]));
    expect(pickGapCompetitorDomains(many, "iranopedia.com", 3)).toHaveLength(3);
  });
});
