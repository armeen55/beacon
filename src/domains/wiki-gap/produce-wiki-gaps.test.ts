import { describe, it, expect, vi } from "vitest";
import { produceWikiGaps, MAX_ARTICLES_PER_RUN, type ProduceWikiGapsDeps } from "./produce-wiki-gaps";
import type { WikiCitationHit } from "./find-wiki-citations";
import type { WikipediaArticleFacts } from "./wikipedia-client";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

const keywordDemand = (over: Partial<KeywordDemand> = {}): KeywordDemand => ({
  keyword: "placeholder",
  searchVolume: 0,
  cpcUsd: null,
  competition: null,
  competitionLevel: null,
  monthlySearches: [],
  locationCode: 2840,
  languageCode: "en",
  source: "dataforseo",
  fetchedAt: "2026-07-01T00:00:00Z",
  confidence: "high",
  evidenceRef: "test-fixture",
  ...over,
});

const hit = (n: number): WikiCitationHit => ({
  articleTitle: `Topic_${n}`,
  queryText: `topic ${n} question`,
  source: "native_observation",
  observedAt: "2026-06-01T00:00:00Z",
});

const thinStaleFacts: WikipediaArticleFacts = {
  title: "x",
  exists: true,
  words: 180,
  sections: 2,
  lastRevisionAt: "2019-01-01T00:00:00Z",
};

const goodFacts: WikipediaArticleFacts = {
  title: "x",
  exists: true,
  words: 5000,
  sections: 15,
  lastRevisionAt: "2026-06-01T00:00:00Z",
};

function deps(over: Partial<ProduceWikiGapsDeps> = {}): Partial<ProduceWikiGapsDeps> {
  return {
    now: () => new Date("2026-07-02T00:00:00Z"),
    findCitations: async () => [hit(1), hit(2)],
    fetchFacts: vi.fn(async () => thinStaleFacts),
    loadKeywordDemand: async () => [],
    writeResults: vi.fn(async () => {}),
    ...over,
  };
}

describe("produceWikiGaps - bounded batch", () => {
  it("checks every found citation up to the 20-article ceiling", async () => {
    const many = Array.from({ length: 30 }, (_, i) => hit(i));
    const d = deps({ findCitations: async () => many });
    const r = await produceWikiGaps("tenant-x", d);
    expect(r.status).toBe("ok");
    expect(r.articlesFound).toBe(30);
    expect(r.articlesChecked).toBe(MAX_ARTICLES_PER_RUN);
    expect(r.gaps).toHaveLength(MAX_ARTICLES_PER_RUN);
  });

  it("no citations found -> honest no_citations receipt, nothing persisted", async () => {
    const d = deps({ findCitations: async () => [] });
    const r = await produceWikiGaps("tenant-x", d);
    expect(r.status).toBe("no_citations");
    expect(r.gaps).toEqual([]);
    expect(d.writeResults).not.toHaveBeenCalled();
    expect(r.message.toLowerCase()).toContain("did not find");
  });

  it("scores + persists real gaps, receipt names the free API with $0 spend", async () => {
    const d = deps();
    const r = await produceWikiGaps("tenant-x", d);
    expect(r.status).toBe("ok");
    expect(r.beatable).toBeGreaterThan(0);
    expect(d.writeResults).toHaveBeenCalledTimes(1);
    expect(r.message).toContain("$0");
    expect(r.message).toContain("Wikipedia");
  });

  it("sorts gaps by score descending", async () => {
    const facts: Record<string, WikipediaArticleFacts> = {
      Topic_1: thinStaleFacts, // high score
      Topic_2: goodFacts, // low score
    };
    const d = deps({
      findCitations: async () => [hit(2), hit(1)], // deliberately out of score order
      fetchFacts: vi.fn(async (title: string) => facts[title] ?? goodFacts),
    });
    const r = await produceWikiGaps("tenant-x", d);
    expect(r.gaps[0].articleTitle).toBe("Topic_1");
    expect(r.gaps[0].score).toBeGreaterThanOrEqual(r.gaps[1].score);
  });

  it("citation-mining failure degrades to no_citations, never throws", async () => {
    const d = deps({
      findCitations: async () => {
        throw new Error("boom");
      },
    });
    const r = await produceWikiGaps("tenant-x", d);
    expect(r.status).toBe("no_citations");
  });

  it("persist failure does not crash the run - results still returned", async () => {
    const d = deps({
      writeResults: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const r = await produceWikiGaps("tenant-x", d);
    expect(r.status).toBe("ok");
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it("attaches demand from the cached keyword store when tokens overlap the query text", async () => {
    const d = deps({
      findCitations: async () => [{ articleTitle: "Persian_Cheetah", queryText: "persian cheetah facts", source: "native_observation", observedAt: null }],
      fetchFacts: vi.fn(async () => thinStaleFacts),
      loadKeywordDemand: async () => [keywordDemand({ keyword: "persian cheetah facts", searchVolume: 800 })],
    });
    const r = await produceWikiGaps("tenant-x", d);
    expect(r.gaps[0].demand).toBe(800);
  });

  it("receipts never contain em or en dashes (hard rule)", async () => {
    const d = deps();
    const r = await produceWikiGaps("tenant-x", d);
    expect(r.message).not.toMatch(/[–—]/);
    const empty = await produceWikiGaps("tenant-x", deps({ findCitations: async () => [] }));
    expect(empty.message).not.toMatch(/[–—]/);
    for (const g of r.gaps) expect(g.evidenceSentence).not.toMatch(/[–—]/);
  });
});
