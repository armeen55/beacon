/**
 * serp-steal-lane.test.ts (DREAM SITE V1, item D3, 2026-07-02).
 *
 * Pins: (1) the pure beaten-keyword selection floors (position 4-20, real
 * impressions, sort by impressions), (2) stored-SERP preference over any
 * live pull, (3) the live-pull cap honestly marking overflow "unavailable",
 * (4) the steal-brief builder's honest structure-gap + teardown-status
 * logic, (5) dash-clean copy. `runSerpQuery` is never really called here -
 * always injected/mocked, so this file can never spend a real dollar.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  selectBeatenKeywords,
  buildStealBrief,
  resolveSerpTop5ForKeywords,
  stealBriefDraftKey,
  parseStealBrief,
  type BeatenKeywordAgg,
  type BeatenKeyword,
  type SerpTop5Result,
} from "./serp-steal-lane";
import type { CompetitorPageAudit } from "@/domains/demand-graph/competitor-page-audit";

describe("selectBeatenKeywords", () => {
  function agg(over: Partial<BeatenKeywordAgg> = {}): BeatenKeywordAgg {
    return { clicks: 10, impressions: 1000, posWeighted: 8000, page: "https://example.com/page", ...over };
  }

  it("selects a query ranking 4-20 with real impressions", () => {
    const byQuery = new Map([["persian rugs", agg({ posWeighted: 8000, impressions: 1000 })]]); // position 8
    const out = selectBeatenKeywords(byQuery);
    expect(out).toHaveLength(1);
    expect(out[0].query).toBe("persian rugs");
    expect(out[0].position).toBe(8);
  });

  it("excludes a query ranking better than position 4 (nothing to steal)", () => {
    const byQuery = new Map([["already winning", agg({ posWeighted: 2000, impressions: 1000 })]]); // position 2
    expect(selectBeatenKeywords(byQuery)).toHaveLength(0);
  });

  it("excludes a query ranking worse than position 20 (too far to be a real steal target)", () => {
    const byQuery = new Map([["far gone", agg({ posWeighted: 25000, impressions: 1000 })]]); // position 25
    expect(selectBeatenKeywords(byQuery)).toHaveLength(0);
  });

  it("excludes a query below the impressions floor even if position qualifies", () => {
    const byQuery = new Map([["tiny demand", agg({ posWeighted: 800, impressions: 100 })]]); // position 8, 100 impr
    expect(selectBeatenKeywords(byQuery)).toHaveLength(0);
  });

  it("respects a custom impressions floor and position band", () => {
    const byQuery = new Map([["custom", agg({ posWeighted: 1500, impressions: 300 })]]); // position 5
    expect(selectBeatenKeywords(byQuery, { minImpressions: 200 })).toHaveLength(1);
    expect(selectBeatenKeywords(byQuery, { minImpressions: 500 })).toHaveLength(0);
  });

  it("sorts by impressions descending and respects the cap", () => {
    const byQuery = new Map([
      ["small", agg({ posWeighted: 8 * 600, impressions: 600 })],
      ["big", agg({ posWeighted: 8 * 5000, impressions: 5000 })],
      ["medium", agg({ posWeighted: 8 * 1200, impressions: 1200 })],
    ]);
    const out = selectBeatenKeywords(byQuery, { cap: 2 });
    expect(out.map((k) => k.query)).toEqual(["big", "medium"]);
  });

  it("names the highest-clicks page as the query's owner", () => {
    const byQuery = new Map([["multi page", agg({ page: "https://example.com/winner", impressions: 900, posWeighted: 7200 })]]);
    const out = selectBeatenKeywords(byQuery);
    expect(out[0].page).toBe("https://example.com/winner");
  });
});

describe("resolveSerpTop5ForKeywords", () => {
  it("prefers a stored SERP row over any live pull", async () => {
    const stored: SerpTop5Result = {
      query: "persian rugs",
      source: "stored_history",
      items: [{ rank: 1, domain: "rivalrugs.com", url: "https://rivalrugs.com/persian" }],
      capturedAt: "2026-06-20T00:00:00.000Z",
    };
    const runLive = vi.fn();
    const { results, livePullsUsed, liveCostUsd } = await resolveSerpTop5ForKeywords(
      "tenant-x",
      ["persian rugs"],
      {},
      { readStored: async () => stored, runLive },
    );
    expect(results).toEqual([stored]);
    expect(runLive).not.toHaveBeenCalled();
    expect(livePullsUsed).toBe(0);
    expect(liveCostUsd).toBe(0);
  });

  it("falls back to a live pull only when no stored row exists, and records real cost", async () => {
    const runLive = vi.fn(async () => ({
      status: "ok" as const,
      plan: { endpoint: "x", query: "no stored serp", locationCode: 2840, languageCode: "en", estCostUsd: 0.003 },
      snapshot: {
        query: "no stored serp",
        results: [{ rank: 1, url: "https://rival.com/a", title: "t", domain: "rival.com" }],
        features: [],
        source: "dataforseo" as const,
        fetchedAt: "2026-07-02T00:00:00.000Z",
      },
      costUsd: 0.003,
      detail: "1 results",
    }));
    const { results, livePullsUsed, liveCostUsd } = await resolveSerpTop5ForKeywords(
      "tenant-x",
      ["no stored serp"],
      { maxLiveSerpPulls: 5 },
      { readStored: async () => null, runLive: runLive as never },
    );
    expect(runLive).toHaveBeenCalledTimes(1);
    expect(results[0].source).toBe("live_pull");
    expect(results[0].items).toEqual([{ rank: 1, domain: "rival.com", url: "https://rival.com/a" }]);
    expect(livePullsUsed).toBe(1);
    expect(liveCostUsd).toBe(0.003);
  });

  it("caps live pulls per run and honestly marks overflow unavailable", async () => {
    const runLive = vi.fn(async () => ({
      status: "ok" as const,
      plan: { endpoint: "x", query: "q", locationCode: 2840, languageCode: "en", estCostUsd: 0.003 },
      snapshot: { query: "q", results: [], features: [], source: "dataforseo" as const, fetchedAt: "now" },
      costUsd: 0.003,
      detail: "0 results",
    }));
    const { results, livePullsUsed } = await resolveSerpTop5ForKeywords(
      "tenant-x",
      ["k1", "k2", "k3"],
      { maxLiveSerpPulls: 1 },
      { readStored: async () => null, runLive: runLive as never },
    );
    expect(livePullsUsed).toBe(1);
    expect(runLive).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.source)).toEqual(["live_pull", "unavailable", "unavailable"]);
  });

  it("a non-ok live result (dry_run/capped/disabled) is marked unavailable, never fabricated", async () => {
    const runLive = vi.fn(async () => ({
      status: "dry_run" as const,
      plan: { endpoint: "x", query: "q", locationCode: 2840, languageCode: "en", estCostUsd: 0.003 },
      snapshot: null,
      costUsd: 0,
      detail: "dry-run",
    }));
    const { results, liveCostUsd } = await resolveSerpTop5ForKeywords(
      "tenant-x",
      ["q"],
      {},
      { readStored: async () => null, runLive: runLive as never },
    );
    expect(results[0]).toEqual({ query: "q", source: "unavailable", items: [], capturedAt: null });
    expect(liveCostUsd).toBe(0);
  });
});

describe("buildStealBrief", () => {
  const keyword: BeatenKeyword = {
    query: "persian rug cleaning",
    page: "https://iranopedia.com/rugs/cleaning",
    clicks: 12,
    impressions: 1400,
    position: 7.4,
  };
  const serp: SerpTop5Result = {
    query: "persian rug cleaning",
    source: "stored_history",
    items: [{ rank: 1, domain: "rivalrugs.com", url: "https://rivalrugs.com/cleaning-guide" }],
    capturedAt: "2026-06-25T00:00:00.000Z",
  };

  function facts(over: Partial<CompetitorPageAudit["facts"]> = {}): NonNullable<CompetitorPageAudit["facts"]> {
    return {
      canonicalUrl: null,
      title: "Persian Rug Cleaning and Repair Guide",
      metaDescription: null,
      h1: "Persian Rug Cleaning and Repair",
      h2Count: 6,
      h3Count: 2,
      outline: [],
      schemaTypes: ["FAQPage"],
      hasFaq: true,
      faqQuestionCount: 4,
      faqQuestions: [],
      hasAnswerBlock: true,
      wordCount: 1800,
      sectionCount: 6,
      internalLinkCount: 10,
      externalLinkCount: 2,
      imageCount: 6,
      hasToolOrCalculator: false,
      freshnessDate: "2026-05-01",
      ogTitle: null,
      ogType: null,
      topTerms: ["rug", "cleaning", "repair", "persian", "wool"],
      ...over,
    } as NonNullable<CompetitorPageAudit["facts"]>;
  }

  it("builds a torn-down brief with structure gaps our page's own tokens do not cover", () => {
    const brief = buildStealBrief({
      keyword,
      serp,
      competitorUrl: "https://rivalrugs.com/cleaning-guide",
      audit: { fetchStatus: "ok", facts: facts() },
      ourPageTopicTokens: ["persian", "rug", "cleaning"],
    });
    expect(brief.teardownStatus).toBe("torn_down");
    expect(brief.competitorDomain).toBe("rivalrugs.com");
    expect(brief.structureGaps).toContain("repair");
    expect(brief.editPointer?.reason).toContain("repair");
    expect(brief.whatWins).not.toBeNull();
    expect(brief.summary).toContain("persian rug cleaning");
    expect(brief.summary).toContain("rivalrugs.com");
  });

  it("never emits an em or en dash in the summary", () => {
    const brief = buildStealBrief({
      keyword,
      serp,
      competitorUrl: "https://rivalrugs.com/cleaning-guide",
      audit: { fetchStatus: "ok", facts: facts() },
      ourPageTopicTokens: [],
    });
    expect(brief.summary).not.toMatch(/[–—]/);
  });

  it("ground-truth regression: strips a pure-number token and the competitor's own brand from structure gaps", () => {
    // Found live against babynama.com's real title "Persian Girl Names - 519+
    // Names with Meanings | Babynama" - "519" and "babynama" both leaked into
    // structureGaps before this fix (2026-07-02 ground-truth run).
    const brief = buildStealBrief({
      keyword: { ...keyword, query: "persian girl names" },
      serp,
      competitorUrl: "https://babynama.com/baby-names/persian-girl-names/",
      audit: {
        fetchStatus: "ok",
        facts: facts({
          title: "Persian Girl Names - 519+ Names with Meanings | Babynama",
          h1: "519+ Persian Girl Names with Meanings",
          topTerms: ["persian", "arabic", "turkish", "names", "name", "urdu", "like", "girl", "meanings", "bengali"],
        }),
      },
      ourPageTopicTokens: ["persian", "girl", "names"],
    });
    expect(brief.structureGaps).not.toContain("519");
    expect(brief.structureGaps).not.toContain("babynama");
    expect(brief.structureGaps).toContain("meaning");
  });

  it("marks blocked when the competitor page could not be read", () => {
    const brief = buildStealBrief({
      keyword,
      serp,
      competitorUrl: "https://rivalrugs.com/cleaning-guide",
      audit: { fetchStatus: "blocked_robots", facts: null },
      ourPageTopicTokens: [],
    });
    expect(brief.teardownStatus).toBe("blocked");
    expect(brief.whatWins).toBeNull();
    expect(brief.editPointer).toBeNull();
    expect(brief.summary).toContain("blocks crawlers");
  });

  it("marks not_read honestly when no competitor URL was resolvable", () => {
    const brief = buildStealBrief({
      keyword,
      serp: { ...serp, source: "unavailable", items: [] },
      competitorUrl: null,
      audit: null,
      ourPageTopicTokens: [],
    });
    expect(brief.teardownStatus).toBe("not_read");
    expect(brief.competitorUrl).toBeNull();
    expect(brief.summary).toContain("have not read");
  });

  it("never copies competitor text verbatim into the brief (structure/facts only)", () => {
    const brief = buildStealBrief({
      keyword,
      serp,
      competitorUrl: "https://rivalrugs.com/cleaning-guide",
      audit: { fetchStatus: "ok", facts: facts({ title: "EXACT COMPETITOR SENTENCE THEY WROTE" }) },
      ourPageTopicTokens: [],
    });
    expect(brief.summary).not.toContain("EXACT COMPETITOR SENTENCE THEY WROTE");
    expect(JSON.stringify(brief.structureGaps)).not.toContain("EXACT COMPETITOR SENTENCE");
  });
});

describe("stealBriefDraftKey / parseStealBrief", () => {
  it("produces a stable, lowercased, trimmed key", () => {
    expect(stealBriefDraftKey("  Persian Rugs  ")).toBe("steal:persian rugs");
    expect(stealBriefDraftKey("persian rugs")).toBe(stealBriefDraftKey("Persian Rugs"));
  });

  it("round-trips a serialized brief and rejects unrelated JSON", () => {
    const content = JSON.stringify({ __kind: "steal_brief", keyword: "persian rugs", ourPage: null });
    const parsed = parseStealBrief(content);
    expect(parsed?.keyword).toBe("persian rugs");
    expect(parseStealBrief(JSON.stringify({ foo: "bar" }))).toBeNull();
    expect(parseStealBrief(null)).toBeNull();
    expect(parseStealBrief("not json")).toBeNull();
  });
});
