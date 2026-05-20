/**
 * Architecture invariant — Slice 4.5.D.α₀a.3a — promotion
 * requires evidence.
 *
 * Empty evidence yields `suppression_reason: "no_evidence"`.
 * Promotion-time guarantee: the customer-facing recommendation
 * surface can always show "why" we suggested this edit.
 */

import { describe, it, expect } from "vitest";

import { applyPromotionSafetyGates } from "@/domains/recommendation-intelligence/safety-gates";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

const NOW = new Date("2026-05-20T00:00:00.000Z");

function makeCandidate(
  partial: Partial<RecommendationCandidateRow> = {},
): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-x",
    trigger_signal: "missing_title",
    action_type: "edit_title",
    generator_kind: "deterministic",
    target_url: "https://example.com/a",
    topic_cluster_label: "metadata",
    evidence: [{ kind: "page_snapshot", ref: "snap-1" }],
    confidence: "high",
    impact_estimate: "high",
    customer_copy: "x",
    operator_evidence: "x",
    dedupe_key: "x",
    cooldown_key: "y",
    created_from_signal_at: "2026-05-19T00:00:00.000Z",
    safety_flags: [],
    ...partial,
  };
}

describe("recommendation-intelligence-no-promotion-without-evidence", () => {
  it("empty evidence yields no_evidence suppression", () => {
    const out = applyPromotionSafetyGates(makeCandidate({ evidence: [] }), {
      tenantId: "tenant-x",
      targetPageType: "service",
      recommendedEdits: [],
      recommendationResponses: [],
      prerequisiteResolved: true,
      now: NOW,
    });
    expect(out.eligible).toBe(false);
    expect(out.suppression_reason).toBe("no_evidence");
  });

  it("non-empty evidence proceeds past the evidence gate", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({
        evidence: [{ kind: "page_snapshot", ref: "snap-1" }],
      }),
      {
        tenantId: "tenant-x",
        targetPageType: "service",
        recommendedEdits: [],
        recommendationResponses: [],
        prerequisiteResolved: true,
        now: NOW,
      },
    );
    expect(out.eligible).toBe(true);
  });
});
