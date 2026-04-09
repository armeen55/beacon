import { describe, it, expect } from "vitest";
import { ATTRIBUTION_CONFIG } from "@/domains/attribution/config";
import {
  EVIDENCE_TIER_BONUS,
  EVIDENCE_TIER_CAP,
} from "@/domains/attribution/compute";

/**
 * Golden baseline — captures current attribution config values as a regression
 * guard. If any of these change, it means scoring behavior changed and the
 * master_execution_plan.md / HANDOFF_VERIFIED_STATE.md baselines must be
 * re-evaluated.
 */

describe("golden config baseline", () => {
  it("factor weights match calibrated values", () => {
    expect(ATTRIBUTION_CONFIG.weights).toEqual({
      platform: 20,
      topic: 25,
      url: 5,
      geo: 15,
      temporal: 20,
      sourceCategory: 15,
    });
  });

  it("strength values match spec", () => {
    expect(ATTRIBUTION_CONFIG.strengthValue).toEqual({
      strong: 1.0,
      partial: 0.5,
      unknown: 0.0,
      none: 0.0,
    });
  });

  it("confidence bands match calibrated values", () => {
    expect(ATTRIBUTION_CONFIG.confidence).toEqual({
      high: 70,
      medium: 45,
      low: 20,
    });
  });

  it("discovery thresholds match spec", () => {
    expect(ATTRIBUTION_CONFIG.discovery).toEqual({
      maxDays: 28,
      minScore: 30,
      topK: 5,
    });
  });

  it("evidence tier bonuses match spec", () => {
    expect(EVIDENCE_TIER_BONUS).toEqual({
      exact: 8,
      probable: 0,
      weak: 0,
      inferred: 0,
    });
  });

  it("evidence tier caps match spec", () => {
    expect(EVIDENCE_TIER_CAP).toEqual({
      exact: 100,
      probable: 85,
      weak: 55,
      inferred: 50,
    });
  });

  it("event detection thresholds match spec", () => {
    expect(ATTRIBUTION_CONFIG.events).toEqual({
      surgeMinRate: 0.25,
      surgePrevMaxRate: 0.15,
      minTotalPossible: 3,
      regainedGapMinDays: 2,
    });
  });

  it("matching thresholds match spec", () => {
    expect(ATTRIBUTION_CONFIG.matching).toEqual({
      topicJaccardPartial: 0.4,
      topicMinWordLength: 2,
      impactWindowFallbackDays: 14,
      temporalDoubleWindowMultiplier: 2,
    });
  });
});
