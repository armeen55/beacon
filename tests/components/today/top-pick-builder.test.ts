import { describe, it, expect } from "vitest";
import { buildTopPickSummary } from "@/components/today/top-pick-builder";
import type { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import type {
  PageIntentResolution,
  ResolvedRecommendationCandidate,
} from "@/domains/recommendations/resolved-types";

type PrioritizedRec = ReturnType<typeof prioritizeRecommendations>["queue"][number];

function mkPrioritizedRec(
  overrides: Partial<PrioritizedRec> &
    Pick<ResolvedRecommendationCandidate, "stableKey"> & {
      resolution?: PageIntentResolution | null;
    },
): PrioritizedRec {
  const baseResolution: PageIntentResolution = {
    action: "create_new_page",
    motive: "capture_absent_cluster",
    targetUrl: "needs_new_page",
    confidence: "low",
    confidenceReason: "",
    tier: "deterministic_only",
    reasoning: "nothing yet",
    cannibalization: null,
    evidenceRefs: [],
  };
  const resolution: PageIntentResolution | undefined =
    overrides.resolution === null
      ? undefined
      : overrides.resolution ?? baseResolution;
  return {
    stableKey: overrides.stableKey,
    type: overrides.type ?? "create_cluster_page",
    title:
      overrides.title ?? "Create a Shield: Luxury Home Builder Bay Area page",
    description: overrides.description ?? "desc",
    affectedPromptIds: overrides.affectedPromptIds ?? ["p1"],
    clusterLabel:
      overrides.clusterLabel ?? "Shield: Luxury Home Builder Bay Area",
    clusterKind: overrides.clusterKind ?? "topic",
    severity: overrides.severity ?? "high",
    effort: overrides.effort ?? "medium",
    evidence: overrides.evidence ?? {
      promptCount: 3,
      observationCount: 9,
      categoryBreakdown: { absent: 3 },
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 50,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    score: overrides.score ?? 5,
    tier: overrides.tier ?? "now",
    rank: overrides.rank ?? 1,
    reasoning: overrides.reasoning ?? "Medium severity; 3 affected prompts.",
    resolution,
  };
}

describe("buildTopPickSummary — Shield: prefix never leaks", () => {
  it("strips Shield: from cluster label when building create-page title", () => {
    const rec = mkPrioritizedRec({ stableKey: "k1" });
    const s = buildTopPickSummary(rec);
    expect(s.title).not.toMatch(/Shield:/i);
    expect(s.title).toBe("Create a Luxury Home Builder Bay Area page");
  });

  it("uses resolved URL when action is strengthen_existing_page", () => {
    const rec = mkPrioritizedRec({
      stableKey: "k2",
      clusterLabel: "Palo Alto",
      clusterKind: "geo",
      resolution: {
        action: "strengthen_existing_page",
        motive: "improve_close_prompt",
        targetUrl: "https://ritzbuilders.com/locations/palo-alto",
        confidence: "high",
        confidenceReason: "cited in 3 of 5",
        tier: "observation",
        reasoning: "AI already cites this page",
        cannibalization: null,
        evidenceRefs: [],
      },
    });
    const s = buildTopPickSummary(rec);
    expect(s.action).toBe("strengthen_existing_page");
    expect(s.resolvedUrl).toBe("https://ritzbuilders.com/locations/palo-alto");
    expect(s.title).toContain("/locations/palo-alto");
    expect(s.title).toContain("Strengthen");
    expect(s.title).not.toMatch(/Shield:/);
  });

  it("uses adjudicator operatorTitle verbatim when present", () => {
    const rec = mkPrioritizedRec({
      stableKey: "k3",
      resolution: {
        action: "strengthen_existing_page",
        motive: "counter_competitor",
        targetUrl: "https://ritzbuilders.com/luxury-home-builder-bay-area",
        confidence: "medium",
        confidenceReason: "",
        tier: "adjudicated",
        reasoning: "foo",
        cannibalization: null,
        evidenceRefs: [],
        operatorTitle:
          "Strengthen /luxury-home-builder-bay-area to counter Kasten Builders",
      },
    });
    const s = buildTopPickSummary(rec);
    expect(s.title).toBe(
      "Strengthen /luxury-home-builder-bay-area to counter Kasten Builders",
    );
    expect(s.action).toBe("strengthen_existing_page");
  });

  it("builds a Review title when action is needs_review", () => {
    const rec = mkPrioritizedRec({
      stableKey: "k4",
      clusterLabel: "Whole Home Remodel",
      clusterKind: "topic",
      resolution: {
        action: "needs_review",
        motive: "capture_absent_cluster",
        targetUrl: "needs_new_page",
        confidence: "low",
        confidenceReason: "",
        tier: "deterministic_only",
        reasoning: "review",
        cannibalization: null,
        evidenceRefs: [],
      },
    });
    const s = buildTopPickSummary(rec);
    expect(s.title).toContain("Review");
    expect(s.resolvedUrl).toBeNull();
  });

  it("never surfaces the raw generator title", () => {
    const rec = mkPrioritizedRec({
      stableKey: "k5",
      title: "Create a Shield: Internal: X page",
    });
    const s = buildTopPickSummary(rec);
    expect(s.title).not.toBe(rec.title);
    expect(s.title).not.toMatch(/Shield:|Internal:/);
  });
});
