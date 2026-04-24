import { describe, it, expect } from "vitest";

import {
  prioritizeRecommendations,
  type PrioritizedRecommendationTier,
} from "@/domains/recommendations/prioritize";
import type {
  RecommendationCandidate,
  RecommendationPrimaryCompetitor,
} from "@/domains/recommendations/generate";

function mkCandidate(
  overrides: Partial<RecommendationCandidate> & {
    stableKey: string;
    type?: RecommendationCandidate["type"];
  },
): RecommendationCandidate {
  return {
    stableKey: overrides.stableKey,
    type: overrides.type ?? "strengthen_page_copy",
    title: overrides.title ?? `rec ${overrides.stableKey}`,
    description: overrides.description ?? "description",
    affectedPromptIds: overrides.affectedPromptIds ?? ["p1"],
    clusterLabel: overrides.clusterLabel ?? null,
    clusterKind: overrides.clusterKind ?? null,
    severity: overrides.severity ?? "medium",
    effort: overrides.effort ?? "medium",
    evidence: {
      promptCount: 1,
      observationCount: 3,
      categoryBreakdown: { close: 1 },
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 50,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
      ...overrides.evidence,
    },
  };
}

function primaryComp(
  name: string,
  promptsWherePrimary: number,
  totalAffectedPrompts: number,
): RecommendationPrimaryCompetitor {
  return { name, promptsWherePrimary, totalAffectedPrompts };
}

describe("prioritizeRecommendations", () => {
  it("routes watch_winning_cluster to watchlist, everything else to queue", () => {
    const candidates = [
      mkCandidate({ stableKey: "a", type: "create_cluster_page" }),
      mkCandidate({ stableKey: "b", type: "target_competitors" }),
      mkCandidate({ stableKey: "w1", type: "watch_winning_cluster" }),
      mkCandidate({ stableKey: "w2", type: "watch_winning_cluster" }),
    ];
    const { queue, watchlist } = prioritizeRecommendations(candidates);
    expect(queue.map((q) => q.stableKey).sort()).toEqual(["a", "b"]);
    expect(watchlist.map((w) => w.stableKey).sort()).toEqual(["w1", "w2"]);
  });

  it("higher severity outranks lower severity", () => {
    const candidates = [
      mkCandidate({ stableKey: "low", severity: "low" }),
      mkCandidate({ stableKey: "high", severity: "high" }),
      mkCandidate({ stableKey: "med", severity: "medium" }),
    ];
    const { queue } = prioritizeRecommendations(candidates);
    expect(queue.map((q) => q.stableKey)).toEqual(["high", "med", "low"]);
    expect(queue[0].rank).toBe(1);
  });

  it("competitor-primary majority adds +3 — beats a same-severity rec without it", () => {
    const withPrimary = mkCandidate({
      stableKey: "with-primary",
      severity: "medium",
      evidence: {
        promptCount: 3,
        observationCount: 9,
        categoryBreakdown: { outranked: 3 },
        dominantCompetitors: ["Bay Builders"],
        descriptorsNearBrand: [],
        maxSignalStrength: 50,
        primaryCompetitors: [primaryComp("Bay Builders", 2, 3)],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const without = mkCandidate({
      stableKey: "without",
      severity: "medium",
      evidence: {
        promptCount: 3,
        observationCount: 9,
        categoryBreakdown: { outranked: 3 },
        dominantCompetitors: ["Bay Builders"],
        descriptorsNearBrand: [],
        maxSignalStrength: 50,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const { queue } = prioritizeRecommendations([without, withPrimary]);
    expect(queue[0].stableKey).toBe("with-primary");
    expect(queue[0].reasoning).toContain("Bay Builders is primary on 2 of 3");
  });

  it("fragmented prompts add +2 (less than competitor-primary's +3)", () => {
    const fragmented = mkCandidate({
      stableKey: "fragmented",
      severity: "medium",
      evidence: {
        promptCount: 2,
        observationCount: 10,
        categoryBreakdown: { outranked: 2 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 50,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 2,
      },
    });
    const primary = mkCandidate({
      stableKey: "primary",
      severity: "medium",
      evidence: {
        promptCount: 2,
        observationCount: 10,
        categoryBreakdown: { outranked: 2 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 50,
        primaryCompetitors: [primaryComp("CompA", 2, 2)],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const { queue } = prioritizeRecommendations([fragmented, primary]);
    expect(queue[0].stableKey).toBe("primary");
    expect(queue[1].stableKey).toBe("fragmented");
    expect(queue[1].reasoning).toContain("fragmented");
  });

  it("cluster-size bonus caps at +5", () => {
    const small = mkCandidate({
      stableKey: "small",
      type: "create_cluster_page",
      severity: "medium",
      affectedPromptIds: Array.from({ length: 3 }, (_, i) => `p${i}`),
      evidence: {
        promptCount: 3,
        observationCount: 9,
        categoryBreakdown: { outranked: 3 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 50,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const huge = mkCandidate({
      stableKey: "huge",
      type: "create_cluster_page",
      severity: "medium",
      affectedPromptIds: Array.from({ length: 20 }, (_, i) => `p${i}`),
      evidence: {
        promptCount: 20,
        observationCount: 60,
        categoryBreakdown: { outranked: 20 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 50,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const { queue } = prioritizeRecommendations([small, huge]);
    // huge should still beat small (more prompts → more bonus)
    expect(queue[0].stableKey).toBe("huge");
    // huge's score = 2 (med sev) + 5 (cap) - 1 (med effort) = 6;
    // small's = 2 (med sev) + 2 (cluster) - 1 (med effort) = 3.
    expect(queue[0].score).toBe(6);
    expect(queue[1].score).toBe(3);
  });

  it("low-effort recs outrank high-effort recs at equal score", () => {
    const low = mkCandidate({
      stableKey: "low-eff",
      severity: "medium",
      effort: "low",
    });
    const high = mkCandidate({
      stableKey: "high-eff",
      severity: "high",
      effort: "high",
    });
    // low: 2 (med) - 0 (low) = 2
    // high: 3 (high) - 2 (high) = 1
    const { queue } = prioritizeRecommendations([high, low]);
    expect(queue[0].stableKey).toBe("low-eff");
  });

  it("tier assignment: first 5 = now, next 5 = this_week, rest = later", () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      mkCandidate({
        stableKey: `r${String(i).padStart(2, "0")}`,
        severity: "medium",
        // Descending signal strength so sort is deterministic.
        evidence: {
          promptCount: 1,
          observationCount: 3,
          categoryBreakdown: { close: 1 },
          dominantCompetitors: [],
          descriptorsNearBrand: [],
          maxSignalStrength: 100 - i,
          primaryCompetitors: [],
          brandPrimaryPromptCount: 0,
          fragmentedPromptCount: 0,
        },
      }),
    );
    const { queue } = prioritizeRecommendations(candidates);
    const tiers = queue.map((q) => q.tier);
    expect(tiers.slice(0, 5).every((t) => t === "now")).toBe(true);
    expect(tiers.slice(5, 10).every((t) => t === "this_week")).toBe(true);
    expect(tiers.slice(10).every((t) => t === "later")).toBe(true);
    expect(queue.map((q) => q.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("empty candidates → empty queue and watchlist", () => {
    const { queue, watchlist } = prioritizeRecommendations([]);
    expect(queue).toEqual([]);
    expect(watchlist).toEqual([]);
  });

  it("all-watch input → empty queue, full watchlist", () => {
    const candidates = [
      mkCandidate({ stableKey: "w1", type: "watch_winning_cluster" }),
      mkCandidate({ stableKey: "w2", type: "watch_winning_cluster" }),
    ];
    const { queue, watchlist } = prioritizeRecommendations(candidates);
    expect(queue).toEqual([]);
    expect(watchlist).toHaveLength(2);
  });

  it("ordering is stable across re-runs with the same input", () => {
    const candidates = [
      mkCandidate({ stableKey: "a", severity: "medium" }),
      mkCandidate({ stableKey: "b", severity: "medium" }),
      mkCandidate({ stableKey: "c", severity: "medium" }),
    ];
    const r1 = prioritizeRecommendations(candidates);
    const r2 = prioritizeRecommendations(candidates);
    expect(r1.queue.map((q) => q.stableKey)).toEqual(
      r2.queue.map((q) => q.stableKey),
    );
  });

  it("reasoning string always leads with severity label", () => {
    const candidates = [
      mkCandidate({ stableKey: "hi", severity: "high" }),
      mkCandidate({ stableKey: "med", severity: "medium" }),
      mkCandidate({ stableKey: "lo", severity: "low" }),
    ];
    const { queue } = prioritizeRecommendations(candidates);
    expect(queue.find((q) => q.stableKey === "hi")?.reasoning).toMatch(
      /^High severity/,
    );
    expect(queue.find((q) => q.stableKey === "med")?.reasoning).toMatch(
      /^Medium severity/,
    );
    expect(queue.find((q) => q.stableKey === "lo")?.reasoning).toMatch(
      /^Low severity/,
    );
  });

  it("recent-signal bonus fires when maxSignalStrength ≥ 60", () => {
    const strong = mkCandidate({
      stableKey: "strong",
      severity: "medium",
      evidence: {
        promptCount: 1,
        observationCount: 5,
        categoryBreakdown: { close: 1 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 80,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const weak = mkCandidate({
      stableKey: "weak",
      severity: "medium",
      evidence: {
        promptCount: 1,
        observationCount: 5,
        categoryBreakdown: { close: 1 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 40,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    const { queue } = prioritizeRecommendations([weak, strong]);
    expect(queue[0].stableKey).toBe("strong");
    // strong: 2 (med) + 1 (signal) - 1 (med effort) = 2
    expect(queue[0].score).toBe(2);
    // weak:   2 (med) + 0 (signal) - 1 (med effort) = 1
    expect(queue[1].score).toBe(1);
  });
});

describe("PrioritizedRecommendationTier", () => {
  it("type allows now / this_week / later", () => {
    const tiers: PrioritizedRecommendationTier[] = ["now", "this_week", "later"];
    expect(tiers).toHaveLength(3);
  });
});
