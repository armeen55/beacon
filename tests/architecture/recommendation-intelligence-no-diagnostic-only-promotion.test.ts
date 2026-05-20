/**
 * Architecture invariant — Slice 4.5.D.α₀a.3a — diagnostic-only
 * pairs MUST NEVER promote.
 *
 * Parametric over every locked diagnostic-only pair in the live
 * `PROMOTION_ELIGIBILITY_TABLE`. Each fed through
 * `applyPromotionSafetyGates` returns `eligible: false` with
 * `suppression_reason: "diagnostic_only_tier"`.
 */

import { describe, it, expect } from "vitest";

import { applyPromotionSafetyGates } from "@/domains/recommendation-intelligence/safety-gates";
import { PROMOTION_ELIGIBILITY_TABLE } from "@/domains/recommendation-intelligence/promotion-eligibility";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { ActionType } from "@/domains/recommendations/action-types";

const NOW = new Date("2026-05-20T00:00:00.000Z");

function diagnosticOnlyPairs(): Array<[string, ActionType]> {
  const out: Array<[string, ActionType]> = [];
  for (const [key, tier] of PROMOTION_ELIGIBILITY_TABLE.entries()) {
    if (tier !== "diagnostic-only") continue;
    const [signal, action] = key.split("::");
    out.push([signal!, action as ActionType]);
  }
  return out;
}

function makeCandidate(
  signal: string,
  actionType: ActionType,
): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-x",
    trigger_signal: signal,
    action_type: actionType,
    generator_kind: "deterministic",
    target_url: "https://example.com/a",
    topic_cluster_label: "metadata",
    evidence: [{ kind: "page_snapshot", ref: "snap-1" }],
    confidence: "high", // intentionally high — we test the tier gate
    impact_estimate: "medium",
    customer_copy: "diagnostic fixture",
    operator_evidence: "diagnostic fixture",
    dedupe_key: "x",
    cooldown_key: "y",
    created_from_signal_at: "2026-05-19T00:00:00.000Z",
    safety_flags: [],
  };
}

describe("recommendation-intelligence-no-diagnostic-only-promotion", () => {
  it("the live table has at least one diagnostic-only pair", () => {
    expect(diagnosticOnlyPairs().length).toBeGreaterThanOrEqual(1);
  });

  it.each(diagnosticOnlyPairs())(
    "diagnostic-only pair %s::%s never promotes",
    (signal, actionType) => {
      const out = applyPromotionSafetyGates(
        makeCandidate(signal, actionType),
        {
          tenantId: "tenant-x",
          targetPageType: "service",
          recommendedEdits: [],
          recommendationResponses: [],
          prerequisiteResolved: true,
          now: NOW,
        },
      );
      expect(out.eligible).toBe(false);
      expect(out.tier).toBe("diagnostic-only");
      expect(out.suppression_reason).toBe("diagnostic_only_tier");
    },
  );
});
