import { describe, it, expect } from "vitest";
import {
  computeConfidenceScore,
  computeFactorScores,
  EVIDENCE_TIER_BONUS,
  EVIDENCE_TIER_CAP,
} from "@/domains/attribution/compute";
import { ATTRIBUTION_CONFIG } from "@/domains/attribution/config";
import type { Attribution } from "@/domains/attribution/types";
import type { EvidenceTier } from "@/domains/pages/types";

type Matches = Attribution["matches"];
type Strength = "strong" | "partial" | "none" | "unknown";

const ALL_STRENGTHS: Strength[] = ["strong", "partial", "none", "unknown"];

function makeMatches(fill: Strength): Matches {
  return {
    platform: fill,
    topic: fill,
    url: fill,
    geo: fill,
    temporal: fill,
    sourceCategory: fill,
  };
}

function applyEvidenceTier(score: number, tier: EvidenceTier): number {
  return Math.min(score + EVIDENCE_TIER_BONUS[tier], EVIDENCE_TIER_CAP[tier]);
}

// ---------------------------------------------------------------------------
// 1. Score boundedness: all scores in [0, 100]
// ---------------------------------------------------------------------------

describe("score boundedness", () => {
  it("all-strong produces score in [0, 100]", () => {
    const score = computeConfidenceScore(makeMatches("strong"));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("all-none produces score in [0, 100]", () => {
    const score = computeConfidenceScore(makeMatches("none"));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("all-unknown produces score in [0, 100]", () => {
    const score = computeConfidenceScore(makeMatches("unknown"));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("every single-strength permutation stays in [0, 100]", () => {
    for (const s of ALL_STRENGTHS) {
      const score = computeConfidenceScore(makeMatches(s));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("mixed matches stay in [0, 100]", () => {
    const matches: Matches = {
      platform: "strong",
      topic: "none",
      url: "unknown",
      geo: "partial",
      temporal: "strong",
      sourceCategory: "none",
    };
    const score = computeConfidenceScore(matches);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// 2. Idempotency: same inputs → same output
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("identical inputs produce identical scores", () => {
    const matches = makeMatches("partial");
    const a = computeConfidenceScore(matches);
    const b = computeConfidenceScore(matches);
    expect(a).toBe(b);
  });

  it("factor scores are identical across calls", () => {
    const matches = makeMatches("strong");
    const a = computeFactorScores(matches);
    const b = computeFactorScores(matches);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// 3. Evidence tier caps
// ---------------------------------------------------------------------------

describe("evidence tier caps", () => {
  it("weak evidence caps score at 55", () => {
    const base = computeConfidenceScore(makeMatches("strong"));
    const capped = applyEvidenceTier(base, "weak");
    expect(capped).toBeLessThanOrEqual(55);
  });

  it("probable evidence caps score at 85", () => {
    const base = computeConfidenceScore(makeMatches("strong"));
    const capped = applyEvidenceTier(base, "probable");
    expect(capped).toBeLessThanOrEqual(85);
  });

  it("exact evidence allows up to 100", () => {
    const base = computeConfidenceScore(makeMatches("strong"));
    const capped = applyEvidenceTier(base, "exact");
    expect(capped).toBeLessThanOrEqual(100);
  });

  it("exact evidence adds bonus of 8", () => {
    const base = 50;
    const result = applyEvidenceTier(base, "exact");
    expect(result).toBe(58);
  });

  it("inferred evidence caps at 50", () => {
    const base = computeConfidenceScore(makeMatches("strong"));
    const capped = applyEvidenceTier(base, "inferred");
    expect(capped).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// 4. Zero / empty safety (no NaN / Infinity)
// ---------------------------------------------------------------------------

describe("zero and empty safety", () => {
  it("all-none produces finite number, not NaN", () => {
    const score = computeConfidenceScore(makeMatches("none"));
    expect(Number.isFinite(score)).toBe(true);
    expect(Number.isNaN(score)).toBe(false);
  });

  it("all-unknown produces finite number", () => {
    const score = computeConfidenceScore(makeMatches("unknown"));
    expect(Number.isFinite(score)).toBe(true);
  });

  it("factor scores for all-none are all finite", () => {
    const factors = computeFactorScores(makeMatches("none"));
    for (const v of Object.values(factors)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Weight sum invariant
// ---------------------------------------------------------------------------

describe("weight sum", () => {
  it("all weights sum to exactly 100", () => {
    const weights = ATTRIBUTION_CONFIG.weights;
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("all-strong score equals weight sum × 1.0 = 100", () => {
    const score = computeConfidenceScore(makeMatches("strong"));
    expect(score).toBe(100);
  });

  it("all-partial score equals weight sum × 0.5 = 50", () => {
    const score = computeConfidenceScore(makeMatches("partial"));
    expect(score).toBe(50);
  });
});
