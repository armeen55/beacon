import { describe, expect, it, vi } from "vitest";

import { completeFinalKeywordDemandForTenant, planFinalKeywordQueries } from "./final-keyword-demand";

describe("planFinalKeywordQueries", () => {
  it("prioritizes new AI gaps, dedupes exactly, and excludes fresh cached demand", () => {
    const plan = planFinalKeywordQueries({
      gapQueries: ["Persian Tea", "Sofreh Aghd"],
      stealQueries: ["persian tea", "Iranian Wedding"],
      graphQueries: ["Nowruz Guide"],
      cachedQueries: new Set(["sofreh aghd"]),
      maxQueries: 3,
    });
    expect(plan.candidates).toEqual(["persian tea", "sofreh aghd", "iranian wedding"]);
    expect(plan.missing).toEqual(["persian tea", "iranian wedding"]);
  });
});

describe("completeFinalKeywordDemandForTenant", () => {
  const cachedRelated = async () => ({
    status: "cache_hit" as const,
    plan: { endpoint: "related", cacheKey: "related", estCostUsd: 0.14 },
    rows: [],
    costUsd: 0,
    detail: "cache_hit",
  });

  it("runs one existing guarded volume batch only for missing candidate queries", async () => {
    const runVolume = vi.fn(async (queries: string[]) => ({
      status: "ok" as const,
      plan: {} as never,
      keywords: queries.map((keyword, index) => ({ keyword, searchVolume: index === 0 ? 900 : null })),
      costUsd: 0.075,
      detail: "ok",
    }));
    const result = await completeFinalKeywordDemandForTenant("tenant-iranopedia", {}, {
      loadGapQueries: async () => ["persian tea", "sofreh aghd"],
      loadStealQueries: async () => ["iranian wedding"],
      loadGraphQueries: async () => ["nowruz guide"],
      loadCached: async () => [{ keyword: "sofreh aghd" }] as never,
      runVolume: runVolume as never,
      runRelated: cachedRelated,
    });
    expect(runVolume).toHaveBeenCalledOnce();
    expect(runVolume.mock.calls[0]![0]).toEqual(["persian tea", "iranian wedding", "nowruz guide"]);
    expect(result).toMatchObject({ status: "ok", candidates: 4, missing: 3, checked: 3, withVolume: 1, costUsd: 0.075 });
  });

  it("makes no provider call when every candidate is already fresh", async () => {
    const runVolume = vi.fn();
    const result = await completeFinalKeywordDemandForTenant("tenant-iranopedia", {}, {
      loadGapQueries: async () => ["persian tea"],
      loadStealQueries: async () => [],
      loadGraphQueries: async () => [],
      loadCached: async () => [{ keyword: "persian tea" }] as never,
      runVolume: runVolume as never,
      runRelated: cachedRelated,
    });
    expect(runVolume).not.toHaveBeenCalled();
    expect(result.status).toBe("already_fresh");
  });

  it("researches the top topic seeds independently of competitor pages", async () => {
    const runRelated = vi.fn(async (seed: string) => ({
      status: "ok" as const,
      plan: { endpoint: "related", cacheKey: seed, estCostUsd: 0.14 },
      rows: Array.from({ length: 1000 }, (_, i) => ({
        keyword: `${seed} ${i}`,
        volume: i,
        cpcUsd: null,
        difficulty: null,
        monthlySearches: [],
      })),
      costUsd: 0.14,
      detail: "1000 rows",
    }));
    const result = await completeFinalKeywordDemandForTenant("tenant-iranopedia", {}, {
      loadGapQueries: async () => ["persian wedding", "nowruz activities"],
      loadStealQueries: async () => [],
      loadGraphQueries: async () => [],
      loadCached: async () => [{ keyword: "persian wedding" }, { keyword: "nowruz activities" }] as never,
      runVolume: vi.fn() as never,
      runRelated,
    });
    expect(runRelated).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "already_fresh", topicSeedsChecked: 2, relatedKeywordsChecked: 2000, costUsd: 0.28 });
  });
});
