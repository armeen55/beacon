import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

// Mock only the I/O boundaries; keep the opportunity engine + the re-rank wiring real.
vi.mock("@/domains/serp/dataforseo-keywords", () => ({ readAllCachedKeywordDemand: vi.fn() }));
vi.mock("@/domains/demand-graph/load-graph", () => ({ loadDemandGraphForTenantCached: vi.fn() }));
vi.mock("@/domains/learning/load-experiment-outcomes", () => ({ loadExperimentOutcomes: vi.fn(async () => []) }));
vi.mock("@/domains/learning/experiment-prior", () => ({
  computeDimPriors: vi.fn(() => new Map()),
  resolvePrior: vi.fn(() => ({ multiplier: 1, tag: null })),
  canonicalMoveType: vi.fn((a: string) => a),
}));

import { loadDemandOpportunities } from "./load-demand-opportunities";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { computeDimPriors, resolvePrior } from "@/domains/learning/experiment-prior";

function kw(keyword: string, searchVolume: number | null, extra: Partial<KeywordDemand> = {}): KeywordDemand {
  return {
    keyword,
    searchVolume,
    cpcUsd: 0,
    competition: 0,
    competitionLevel: "low",
    monthlySearches: [],
    locationCode: 2840,
    languageCode: "en",
    source: "dataforseo",
    fetchedAt: "2026-06-25T00:00:00Z",
    confidence: searchVolume == null ? "low" : "high",
    evidenceRef: `kw:${keyword}`,
    ...extra,
  };
}

const graph = (pages: string[], topics: string[]) => ({
  graph: {
    pageNodes: pages.map((url) => ({ url, isOwned: true })),
    moves: topics.map((label) => ({ label })),
  },
});

beforeEach(() => {
  vi.mocked(computeDimPriors).mockReturnValue(new Map());
  vi.mocked(resolvePrior).mockReturnValue({ multiplier: 1, tag: null } as ReturnType<typeof resolvePrior>);
  vi.mocked(loadDemandGraphForTenantCached).mockResolvedValue(
    graph(["https://x.com/persian-flag"], ["iran flag", "persian food", "persian numbers"]) as never,
  );
});

describe("loadDemandOpportunities", () => {
  it("surfaces cached demand as ranked opportunities (flows into the cockpit)", async () => {
    vi.mocked(readAllCachedKeywordDemand).mockResolvedValue([kw("iran flag", 135000), kw("persian food", 8100)]);
    const r = await loadDemandOpportunities("t", { limit: 12 });
    expect(r.cached).toBe(true);
    expect(r.keywordsConsidered).toBe(2);
    expect(r.opportunities.length).toBeGreaterThan(0);
    expect(r.opportunities[0].primaryKeyword).toBe("iran flag"); // highest demand leads
  });

  it("an existing strong page match yields an improve action, never a duplicate create_page", async () => {
    vi.mocked(readAllCachedKeywordDemand).mockResolvedValue([kw("persian flag", 50000)]);
    const r = await loadDemandOpportunities("t");
    const o = r.opportunities.find((x) => x.primaryKeyword === "persian flag");
    expect(o).toBeDefined();
    expect(o!.matchStrength).toBe("strong");
    expect(o!.action).not.toBe("create_page");
  });

  it("weak evidence (no volume) does not rank", async () => {
    vi.mocked(readAllCachedKeywordDemand).mockResolvedValue([kw("persian numbers", null)]);
    const r = await loadDemandOpportunities("t");
    expect(r.opportunities.find((x) => x.primaryKeyword === "persian numbers")).toBeUndefined();
  });

  it("commerce intent with no page stays a concept-only product with a risk", async () => {
    vi.mocked(loadDemandGraphForTenantCached).mockResolvedValue(graph([], ["iran world cup jersey"]) as never);
    vi.mocked(readAllCachedKeywordDemand).mockResolvedValue([kw("iran world cup jersey buy", 4800)]);
    const r = await loadDemandOpportunities("t");
    const o = r.opportunities.find((x) => x.action === "create_product");
    expect(o).toBeDefined();
    expect(o!.parentType).toBe("commerce_move");
    expect(o!.risk).toBeTruthy();
  });

  it("fail-soft: no cached demand → empty + cached:false (honest, no crash)", async () => {
    vi.mocked(readAllCachedKeywordDemand).mockResolvedValue([]);
    const r = await loadDemandOpportunities("t");
    expect(r).toEqual({ opportunities: [], trends: [], products: [], cached: false, keywordsConsidered: 0 });
  });

  it("4F: trend + product opportunities flow through the loader alongside demand", async () => {
    const rising = Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1, volume: 100 + i * 90 }));
    vi.mocked(loadDemandGraphForTenantCached).mockResolvedValue(
      graph([], ["persian rugs", "nowruz gifts"]) as never,
    );
    vi.mocked(readAllCachedKeywordDemand).mockResolvedValue([
      kw("persian rugs", 3000, { monthlySearches: rising }), // rising trend
      kw("nowruz gifts", 1200, { monthlySearches: rising }), // commerce + rising
    ]);
    const r = await loadDemandOpportunities("t", { currentMonth: 6 });
    expect(r.cached).toBe(true);
    expect(r.trends.length).toBeGreaterThan(0); // rising trend surfaced
    expect(r.trends.some((t) => t.trend === "rising")).toBe(true);
    const product = r.products.find((p) => p.keyword === "nowruz gifts");
    expect(product).toBeDefined();
    expect(product!.conceptOnly).toBe(true); // no inventory → concept-only
  });

  it("fail-soft: a missing graph still returns opportunities (no relevance gate)", async () => {
    vi.mocked(loadDemandGraphForTenantCached).mockRejectedValue(new Error("no graph"));
    vi.mocked(readAllCachedKeywordDemand).mockResolvedValue([kw("anything at all", 9000)]);
    const r = await loadDemandOpportunities("t");
    expect(r.cached).toBe(true);
    expect(r.opportunities.length).toBeGreaterThan(0);
  });

  it("Sprint-3 outcome prior INFLUENCES order but does not DOMINATE raw demand", async () => {
    // alpha strong-matches its owned page → update_title_meta (proven winner); beta +
    // mega share no tokens with any page → create_page (neutral/loser). Distinct token
    // sets so only alpha matches. Demand: alpha 1000 < beta 1100 << mega 100k.
    vi.mocked(loadDemandGraphForTenantCached).mockResolvedValue(
      graph(["https://x.com/persian-history"], ["persian history", "saffron benefits", "nowruz traditions"]) as never,
    );
    vi.mocked(readAllCachedKeywordDemand).mockResolvedValue([
      kw("persian history", 1000),
      kw("saffron benefits", 1100),
      kw("nowruz traditions", 100000),
    ]);
    vi.mocked(computeDimPriors).mockReturnValue(new Map([["k", 1]]) as never); // non-empty → priors active
    vi.mocked(resolvePrior).mockImplementation(((dim: { actionType: string }) =>
      dim.actionType === "update_title_meta" || dim.actionType === "content_refresh"
        ? { multiplier: 1.15, tag: "won 4/5 similar" } // alpha's improve action is a proven winner
        : { multiplier: 0.85, tag: null }) as never);

    const r = await loadDemandOpportunities("t");
    const names = r.opportunities.map((o) => o.primaryKeyword);
    // DOMINANCE: 100k demand × 0.85 still beats everything — priors can't override real demand.
    expect(names[0]).toBe("nowruz traditions");
    // INFLUENCE: the proven-winner (1000) outranks the higher-demand-but-neutral (1100).
    expect(names.indexOf("persian history")).toBeLessThan(names.indexOf("saffron benefits"));
    expect(r.opportunities.some((o) => o.learnedTag === "won 4/5 similar")).toBe(true);
  });
});
