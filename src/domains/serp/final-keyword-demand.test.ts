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
    });
    expect(runVolume).not.toHaveBeenCalled();
    expect(result.status).toBe("already_fresh");
  });
});
