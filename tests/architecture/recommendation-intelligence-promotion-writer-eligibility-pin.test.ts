/**
 * Architecture invariant — Slice 4.5.D.α₁a — promotion writer
 * eligibility pin.
 *
 * Pins the 5 defensive null-return conditions in the mapper. The
 * α₀a.3a safety gates already enforce these upstream — these
 * checks are belt-and-suspenders so a future regression elsewhere
 * in the engine cannot leak an unsafe row to the customer queue.
 *
 *   Rejection conditions (mapper returns null):
 *     1. result.eligible === false
 *     2. result.tier === "diagnostic-only"
 *     3. result.tier === "operator-review-only"
 *     4. result.tier === "blocked"
 *     5. result.candidate.target_url === null
 *     6. result.candidate.confidence === "low"
 *     7. result.candidate.safety_flags.length > 0
 *
 * Plus 1 positive case: happy path returns non-null.
 */

import { describe, it, expect } from "vitest";

import { promotionResultToRecommendedEditRow } from "@/domains/recommendation-intelligence/promotion-result-to-edit-row";
import type { PromotionResult } from "@/domains/recommendation-intelligence/promote-to-queue";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const URL = "https://example.com/a";

function makeCandidate(
  partial: Partial<RecommendationCandidateRow> = {},
): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-x",
    trigger_signal: "missing_title",
    action_type: "edit_title",
    generator_kind: "deterministic",
    target_url: URL,
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

function happyResult(): PromotionResult {
  return {
    candidate: makeCandidate(),
    tier: "customer-queue-ready",
    eligible: true,
    suppression_reason: null,
    cooldown_expires_at: null,
    priority_score: 42,
    promotion_dedupe_key: "0123456789abcdef0123456789abcdef01234567",
    promotion_cooldown_key: "fedcba9876543210fedcba9876543210fedcba98",
  };
}

describe("recommendation-intelligence-promotion-writer-eligibility-pin", () => {
  it("(positive) happy path returns a non-null row", () => {
    expect(promotionResultToRecommendedEditRow(happyResult(), NOW)).not.toBeNull();
  });

  it("(reject 1) returns null when result.eligible === false", () => {
    const row = promotionResultToRecommendedEditRow(
      { ...happyResult(), eligible: false, suppression_reason: "in_cooldown" },
      NOW,
    );
    expect(row).toBeNull();
  });

  it.each([
    "diagnostic-only",
    "operator-review-only",
    "blocked",
  ] as const)(
    "(reject 2) returns null when tier is %s",
    (tier) => {
      const row = promotionResultToRecommendedEditRow(
        { ...happyResult(), tier },
        NOW,
      );
      expect(row).toBeNull();
    },
  );

  it("(reject 3) returns null when candidate.target_url is null", () => {
    const row = promotionResultToRecommendedEditRow(
      {
        ...happyResult(),
        candidate: makeCandidate({ target_url: null }),
      },
      NOW,
    );
    expect(row).toBeNull();
  });

  it("(reject 4) returns null when candidate.confidence is 'low'", () => {
    const row = promotionResultToRecommendedEditRow(
      {
        ...happyResult(),
        candidate: makeCandidate({ confidence: "low" }),
      },
      NOW,
    );
    expect(row).toBeNull();
  });

  it("(reject 5) returns null when candidate.safety_flags is non-empty", () => {
    const row = promotionResultToRecommendedEditRow(
      {
        ...happyResult(),
        candidate: makeCandidate({ safety_flags: ["unsupported_claim_risk"] }),
      },
      NOW,
    );
    expect(row).toBeNull();
  });
});
