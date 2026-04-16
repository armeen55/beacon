/**
 * Decomposed event confidence tests — E1.9.
 *
 * Exercises:
 *   - detectionConfidence based on spike shape
 *   - attributionConfidence based on impact-score dominance
 *   - pattern_match stays "none" (no pattern memory in E1)
 *   - buildEventConfidence composes all three
 */

import { describe, it, expect } from "vitest";
import {
  detectionConfidence,
  attributionConfidence,
  buildEventConfidence,
} from "@/domains/visibility-events/confidence";
import type {
  Spike,
  ImpactWeightedClusterAttribution,
} from "@/domains/visibility-events/types";

function makeSpike(overrides: Partial<Spike> = {}): Spike {
  return {
    id: "s1",
    metric: "citations",
    platform: "chatgpt",
    scopeId: "Custom Home Builder Bay Area",
    startDate: "2026-04-13",
    peakDate: "2026-04-14",
    peakValue: 62,
    baseline: 20,
    absoluteDelta: 42,
    relativeRatio: 3.1,
    dayCount: 2,
    isEmerging: false,
    ...overrides,
  };
}

function makeAttribution(
  overrides: Partial<ImpactWeightedClusterAttribution>,
): ImpactWeightedClusterAttribution {
  return {
    cluster: "faq_schema",
    role: "likely_primary_trigger",
    changeCount: 3,
    primaryWindowDays: 3,
    impactScore: 2.5,
    impactBreakdown: {
      changeCount: 3,
      clusterWeight: 1.1,
      proximityWeight: 0.8,
      coverageWeight: 1.0,
    },
    rationale: "test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectionConfidence
// ---------------------------------------------------------------------------

describe("detectionConfidence", () => {
  it("returns strong for sustained ≥2.5x spikes", () => {
    const spike = makeSpike({
      relativeRatio: 3.0,
      dayCount: 3,
      isEmerging: false,
    });
    expect(detectionConfidence(spike)).toBe("strong");
  });

  it("returns moderate for sustained 1.75-2.5x spikes", () => {
    const spike = makeSpike({
      relativeRatio: 2.0,
      dayCount: 2,
      isEmerging: false,
    });
    expect(detectionConfidence(spike)).toBe("moderate");
  });

  it("returns weak for single-day spikes even at high ratios", () => {
    const spike = makeSpike({
      relativeRatio: 5.0,
      dayCount: 1,
      isEmerging: false,
    });
    expect(detectionConfidence(spike)).toBe("weak");
  });

  it("returns weak for emerging signals (zero baseline)", () => {
    const spike = makeSpike({
      relativeRatio: Infinity,
      dayCount: 3,
      isEmerging: true,
    });
    expect(detectionConfidence(spike)).toBe("weak");
  });

  it("returns weak for sub-threshold relative ratios", () => {
    const spike = makeSpike({
      relativeRatio: 1.5,
      dayCount: 3,
      isEmerging: false,
    });
    expect(detectionConfidence(spike)).toBe("weak");
  });
});

// ---------------------------------------------------------------------------
// attributionConfidence
// ---------------------------------------------------------------------------

describe("attributionConfidence", () => {
  it("returns weak for insufficient verdict", () => {
    const tier = attributionConfidence({
      attributions: [],
      verdict: "insufficient",
    });
    expect(tier).toBe("weak");
  });

  it("returns weak for multi_trigger verdict", () => {
    const attributions = [
      makeAttribution({ cluster: "faq_schema", impactScore: 2.0 }),
      makeAttribution({ cluster: "technical_rendering", impactScore: 1.9 }),
    ];
    const tier = attributionConfidence({
      attributions,
      verdict: "multi_trigger",
    });
    expect(tier).toBe("weak");
  });

  it("returns weak for snowball verdict", () => {
    const attributions = [
      makeAttribution({
        cluster: "faq_schema",
        role: "likely_amplifier",
        impactScore: 1.0,
      }),
    ];
    const tier = attributionConfidence({
      attributions,
      verdict: "snowball",
    });
    expect(tier).toBe("weak");
  });

  it("returns strong when primary has no rival clusters", () => {
    const attributions = [
      makeAttribution({ cluster: "faq_schema", impactScore: 2.5 }),
    ];
    const tier = attributionConfidence({
      attributions,
      verdict: "isolated",
    });
    expect(tier).toBe("strong");
  });

  it("returns strong when primary impactScore is ≥2x runner-up", () => {
    const attributions = [
      makeAttribution({
        cluster: "faq_schema",
        role: "likely_primary_trigger",
        impactScore: 4.0,
      }),
      makeAttribution({
        cluster: "technical_rendering",
        role: "weak_contributor",
        impactScore: 1.5,
      }),
    ];
    const tier = attributionConfidence({
      attributions,
      verdict: "isolated",
    });
    expect(tier).toBe("strong");
  });

  it("returns moderate when primary is 1.5-2x runner-up", () => {
    const attributions = [
      makeAttribution({
        cluster: "faq_schema",
        role: "likely_primary_trigger",
        impactScore: 3.0,
      }),
      makeAttribution({
        cluster: "technical_rendering",
        role: "weak_contributor",
        impactScore: 1.8,
      }),
    ];
    const tier = attributionConfidence({
      attributions,
      verdict: "isolated",
    });
    expect(tier).toBe("moderate");
  });

  it("returns weak when primary is within 1.5x of runner-up", () => {
    const attributions = [
      makeAttribution({
        cluster: "faq_schema",
        role: "likely_primary_trigger",
        impactScore: 2.5,
      }),
      makeAttribution({
        cluster: "technical_rendering",
        role: "weak_contributor",
        impactScore: 2.0,
      }),
    ];
    const tier = attributionConfidence({
      attributions,
      verdict: "isolated",
    });
    expect(tier).toBe("weak");
  });
});

// ---------------------------------------------------------------------------
// buildEventConfidence
// ---------------------------------------------------------------------------

describe("buildEventConfidence", () => {
  it("composes detection, attribution, and pattern_match", () => {
    const spike = makeSpike({
      relativeRatio: 3.0,
      dayCount: 3,
      isEmerging: false,
    });
    const attributions = [
      makeAttribution({ cluster: "faq_schema", impactScore: 3.0 }),
    ];
    const confidence = buildEventConfidence({
      spike,
      attributions,
      verdict: "isolated",
    });
    expect(confidence.detection).toBe("strong");
    expect(confidence.attribution).toBe("strong");
    expect(confidence.pattern_match).toBe("none");
  });

  it("allows detection and attribution to disagree", () => {
    // Solid spike shape but ambiguous attribution
    const spike = makeSpike({
      relativeRatio: 3.0,
      dayCount: 3,
      isEmerging: false,
    });
    const attributions = [
      makeAttribution({
        cluster: "faq_schema",
        role: "likely_primary_trigger",
        impactScore: 2.0,
      }),
      makeAttribution({
        cluster: "technical_rendering",
        role: "weak_contributor",
        impactScore: 1.8,
      }),
    ];
    const confidence = buildEventConfidence({
      spike,
      attributions,
      verdict: "isolated",
    });
    // detection is strong because the spike itself is clean
    expect(confidence.detection).toBe("strong");
    // attribution is weak because the clusters are close in impact
    expect(confidence.attribution).toBe("weak");
    // pattern_match is always "none" in E1
    expect(confidence.pattern_match).toBe("none");
  });
});
