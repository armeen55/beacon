/**
 * Architecture invariant — Slice 4.5.D.α₀a.3a — confidence: "low"
 * never reaches the customer queue, even on a customer-queue-
 * ready (trigger, action) pair.
 *
 * Defense-in-depth: no current customer-queue-ready emitter
 * produces "low", but the gate stays the canonical enforcement
 * point so a future low-confidence flip on a ready pair is
 * caught.
 */

import { describe, it, expect } from "vitest";

import { applyPromotionSafetyGates } from "@/domains/recommendation-intelligence/safety-gates";
import { listCustomerQueueReadyPairs } from "@/domains/recommendation-intelligence/promotion-eligibility";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { ActionType } from "@/domains/recommendations/action-types";

const NOW = new Date("2026-05-20T00:00:00.000Z");

function makeLow(
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
    confidence: "low",
    impact_estimate: "medium",
    customer_copy: "low fixture",
    operator_evidence: "low-confidence customer-queue-ready fixture",
    dedupe_key: "x",
    cooldown_key: "y",
    created_from_signal_at: "2026-05-19T00:00:00.000Z",
    safety_flags: [],
  };
}

describe("recommendation-intelligence-confidence-low-stays-diagnostic", () => {
  it.each(listCustomerQueueReadyPairs())(
    "customer-queue-ready pair %s at confidence: low → low_confidence",
    (pairKey) => {
      const [signal, actionType] = pairKey.split("::") as [string, ActionType];
      const out = applyPromotionSafetyGates(makeLow(signal, actionType), {
        tenantId: "tenant-x",
        targetPageType: "service",
        recommendedEdits: [],
        recommendationResponses: [],
        prerequisiteResolved: true,
        now: NOW,
      });
      expect(out.eligible).toBe(false);
      expect(out.suppression_reason).toBe("low_confidence");
    },
  );
});
