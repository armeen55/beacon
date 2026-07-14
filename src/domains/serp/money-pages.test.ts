import { describe, it, expect } from "vitest";
import { aggregateMoneyPages, pickTeardownTargets } from "./money-pages";
import { winnability, type KeywordGapRow } from "./keyword-gaps";

const row = (over: Partial<KeywordGapRow> = {}): KeywordGapRow => ({
  keyword: "persian wedding sofreh",
  volume: 1900,
  competitorDomain: "supplehomes.com",
  competitorRank: 3,
  ownRank: null,
  cpcUsd: 0.4,
  source: "ranked_keywords",
  rankingUrl: "https://supplehomes.com/sofreh-guide",
  ...over,
});

describe("aggregateMoneyPages - traffic-weighted rollup", () => {
  it("skips rows without a ranking URL (never fabricates one)", () => {
    const pages = aggregateMoneyPages([row({ rankingUrl: null }), row({ rankingUrl: undefined })]);
    expect(pages).toEqual([]);
  });

  it("skips junk rows: empty keyword, out-of-range rank", () => {
    const pages = aggregateMoneyPages([
      row({ keyword: "" }),
      row({ competitorRank: 0 }),
      row({ competitorRank: 140 }),
    ]);
    expect(pages).toEqual([]);
  });

  it("sums volume x winnability(rank) across every keyword ranking to one URL", () => {
    const pages = aggregateMoneyPages([
      row({ keyword: "persian wedding sofreh", volume: 1900, competitorRank: 3 }),
      row({ keyword: "sofreh aghd meaning", volume: 500, competitorRank: 10 }),
    ]);
    expect(pages).toHaveLength(1);
    const expectedWeight = Math.round(1900 * winnability(3) + 500 * winnability(10));
    expect(pages[0].trafficWeight).toBe(expectedWeight);
    expect(pages[0].keywordCount).toBe(2);
  });

  it("keeps the better rank when the same keyword appears twice for one URL (both endpoints)", () => {
    const pages = aggregateMoneyPages([
      row({ keyword: "sofreh aghd", competitorRank: 15, volume: 800, source: "ranked_keywords" }),
      row({ keyword: "sofreh aghd", competitorRank: 4, volume: 800, source: "domain_intersection" }),
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].topKeywords).toHaveLength(1);
    expect(pages[0].topKeywords[0].rank).toBe(4); // the better (lower) rank wins
  });

  it("groups distinct URLs separately even on the same domain", () => {
    const pages = aggregateMoneyPages([
      row({ rankingUrl: "https://supplehomes.com/a", volume: 5000, competitorRank: 2 }),
      row({ rankingUrl: "https://supplehomes.com/b", keyword: "other kw", volume: 100, competitorRank: 40 }),
    ]);
    expect(pages.map((p) => p.url)).toEqual(["https://supplehomes.com/a", "https://supplehomes.com/b"]);
    // sorted by traffic weight, highest first
    expect(pages[0].trafficWeight).toBeGreaterThan(pages[1].trafficWeight);
  });

  it("bounds output to top N money pages PER competitor domain", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ rankingUrl: `https://supplehomes.com/page-${i}`, keyword: `topic ${i}`, volume: 100 + i, competitorRank: 5 }),
    );
    const pages = aggregateMoneyPages(rows, 20);
    expect(pages).toHaveLength(20);
    // highest-volume pages kept (weight scales with volume at a fixed rank)
    expect(pages[0].url).toBe("https://supplehomes.com/page-29");
  });

  it("caps per-domain independently: a second competitor is not crowded out by the first", () => {
    const a = Array.from({ length: 25 }, (_, i) => row({ rankingUrl: `https://a-comp.com/${i}`, keyword: `a topic ${i}`, competitorDomain: "a-comp.com", volume: 900, competitorRank: 2 }));
    const b = [row({ rankingUrl: "https://b-comp.com/x", keyword: "b topic", competitorDomain: "b-comp.com", volume: 50, competitorRank: 8 })];
    const pages = aggregateMoneyPages([...a, ...b], 20);
    expect(pages.filter((p) => p.competitorDomain === "a-comp.com")).toHaveLength(20);
    expect(pages.filter((p) => p.competitorDomain === "b-comp.com")).toHaveLength(1);
  });

  it("caps promoted topKeywords per page at 50, highest-weight first", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row({ keyword: `kw ${i}`, volume: 100 * (i + 1), competitorRank: 3 }),
    );
    const pages = aggregateMoneyPages(rows);
    expect(pages[0].topKeywords).toHaveLength(50);
    expect(pages[0].topKeywords[0].keyword).toBe("kw 59"); // highest volume -> highest weight
  });

  it("keywordCount only counts keywords with a real volume (never guessed)", () => {
    const pages = aggregateMoneyPages([
      row({ keyword: "kw a", volume: 100 }),
      row({ keyword: "kw b", volume: null }),
    ]);
    expect(pages[0].keywordCount).toBe(1);
  });
});

describe("pickTeardownTargets - bounded teardown selection", () => {
  it("takes the top N (default 5) money pages, already traffic-weight ordered", () => {
    const pages = aggregateMoneyPages(
      Array.from({ length: 10 }, (_, i) =>
        row({ rankingUrl: `https://supplehomes.com/p${i}`, keyword: `kw ${i}`, volume: 100 * (i + 1), competitorRank: 3 }),
      ),
    );
    const targets = pickTeardownTargets(pages);
    expect(targets).toHaveLength(5);
    expect(targets[0].url).toBe("https://supplehomes.com/p9");
  });

  it("handles an empty list and a limit of 0", () => {
    expect(pickTeardownTargets([])).toEqual([]);
    const pages = aggregateMoneyPages([row()]);
    expect(pickTeardownTargets(pages, 0)).toEqual([]);
  });
});
