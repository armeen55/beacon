/**
 * 2026-05-20 — Slice 4.5.D.α₁a — promotion-result mapper tests.
 *
 * Pinned coverage:
 *   • happy-path row shape
 *   • source = "deterministic_promotion"
 *   • id format + determinism
 *   • rec_id derives from promotion_cooldown_key.slice(0, 16)
 *   • confidence carries from candidate
 *   • implementation_status = "recommended"
 *   • all live_* fields null
 *   • evidence_hash populated + deterministic
 *   • evidence carries owned_page ref for target URL
 *   • 5 defensive rejections return null (eligible:false · tier ≠
 *     customer-queue-ready · null target_url · low confidence ·
 *     safety_flags non-empty)
 */

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";

import {
  promotionResultToRecommendedEditRow,
  DETERMINISTIC_PROMOTION_SOURCE,
} from "@/domains/recommendation-intelligence/promotion-result-to-edit-row";
import type { PromotionResult } from "@/domains/recommendation-intelligence/promote-to-queue";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const TENANT = "tenant-x";
const URL = "https://example.com/services/custom-homes";

function makeCandidate(
  partial: Partial<RecommendationCandidateRow> = {},
): RecommendationCandidateRow {
  return {
    tenant_id: TENANT,
    trigger_signal: "missing_title",
    action_type: "edit_title",
    generator_kind: "deterministic",
    target_url: URL,
    topic_cluster_label: "metadata",
    evidence: [{ kind: "page_snapshot", ref: "snap-1" }],
    confidence: "high",
    impact_estimate: "high",
    customer_copy: "Update the page title.",
    operator_evidence: "missing_title detected",
    dedupe_key: "abc",
    cooldown_key: "def",
    created_from_signal_at: "2026-05-19T00:00:00.000Z",
    safety_flags: [],
    ...partial,
  };
}

function makeResult(partial: Partial<PromotionResult> = {}): PromotionResult {
  return {
    candidate: makeCandidate(),
    tier: "customer-queue-ready",
    eligible: true,
    suppression_reason: null,
    cooldown_expires_at: null,
    priority_score: 42,
    promotion_dedupe_key: "0123456789abcdef0123456789abcdef01234567",
    promotion_cooldown_key: "fedcba9876543210fedcba9876543210fedcba98",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Happy path + row shape
// ---------------------------------------------------------------------------

describe("promotionResultToRecommendedEditRow — happy path", () => {
  it("returns a valid row for a customer-queue-ready eligible result", () => {
    const row = promotionResultToRecommendedEditRow(makeResult(), NOW);
    expect(row).not.toBeNull();
    expect(row!.tenant_id).toBe(TENANT);
    expect(row!.action_type).toBe("edit_title");
    expect(row!.target_url).toBe(URL);
    expect(row!.target_element_key).toBeNull();
    expect(row!.display_label).toBeNull();
    expect(row!.current_text).toBeNull();
    expect(row!.proposed_text).toBeNull();
    expect(row!.why).toBe("Update the page title.");
    expect(row!.expected_impact).toBeNull();
    expect(row!.difficulty).toBe("low");
    expect(row!.measurement_plan).toBeNull();
    expect(row!.risks).toEqual([]);
    expect(row!.provider_name).toBeNull();
    expect(row!.model).toBeNull();
    expect(row!.cost_usd).toBe(0);
    expect(row!.created_at).toBe(NOW_ISO);
    expect(row!.updated_at).toBe(NOW_ISO);
  });

  it("source field is the operator-locked 'deterministic_promotion' constant", () => {
    const row = promotionResultToRecommendedEditRow(makeResult(), NOW);
    expect(row!.source).toBe("deterministic_promotion");
    expect(row!.source).toBe(DETERMINISTIC_PROMOTION_SOURCE);
  });

  it("implementation_status is 'recommended' on initial write", () => {
    const row = promotionResultToRecommendedEditRow(makeResult(), NOW);
    expect(row!.implementation_status).toBe("recommended");
  });

  it("all live_* fields are null on initial write", () => {
    const row = promotionResultToRecommendedEditRow(makeResult(), NOW);
    expect(row!.live_at).toBeNull();
    expect(row!.live_snapshot_id).toBeNull();
    expect(row!.live_match_confidence).toBeNull();
    expect(row!.live_match_kind).toBeNull();
    expect(row!.live_element_key).toBeNull();
    expect(row!.not_found_reason).toBeNull();
  });

  it("confidence carries from candidate", () => {
    const high = promotionResultToRecommendedEditRow(
      makeResult({ candidate: makeCandidate({ confidence: "high" }) }),
      NOW,
    );
    const medium = promotionResultToRecommendedEditRow(
      makeResult({ candidate: makeCandidate({ confidence: "medium" }) }),
      NOW,
    );
    expect(high!.confidence).toBe("high");
    expect(medium!.confidence).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// id + rec_id + evidence_hash
// ---------------------------------------------------------------------------

describe("promotionResultToRecommendedEditRow — id + rec_id + evidence_hash", () => {
  it("rec_id derives from promotion_cooldown_key.slice(0, 16)", () => {
    const row = promotionResultToRecommendedEditRow(makeResult(), NOW);
    expect(row!.rec_id).toBe("promotion-fedcba9876543210");
  });

  it("id format is `promotion-{16hex}__{action_type}__null`", () => {
    const row = promotionResultToRecommendedEditRow(makeResult(), NOW);
    expect(row!.id).toBe("promotion-fedcba9876543210__edit_title__null");
    expect(row!.id).toMatch(/^promotion-[0-9a-f]{16}__[a-z_]+__null$/);
  });

  it("id + rec_id are deterministic for same input (idempotency primitive)", () => {
    const a = promotionResultToRecommendedEditRow(makeResult(), NOW);
    const b = promotionResultToRecommendedEditRow(makeResult(), NOW);
    expect(a!.id).toBe(b!.id);
    expect(a!.rec_id).toBe(b!.rec_id);
  });

  it("evidence_hash matches sha1(dedupe::cooldown::priority)", () => {
    const result = makeResult();
    const row = promotionResultToRecommendedEditRow(result, NOW);
    const expected = createHash("sha1")
      .update(
        `${result.promotion_dedupe_key}::${result.promotion_cooldown_key}::${result.priority_score}`,
      )
      .digest("hex");
    expect(row!.evidence_hash).toBe(expected);
    expect(row!.evidence_hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("evidence carries an owned_page ref for the target URL", () => {
    const row = promotionResultToRecommendedEditRow(makeResult(), NOW);
    expect(row!.evidence).toEqual([{ type: "owned_page", url: URL }]);
  });
});

// ---------------------------------------------------------------------------
// 5 defensive rejection conditions
// ---------------------------------------------------------------------------

describe("promotionResultToRecommendedEditRow — defensive rejections", () => {
  it("returns null when eligible is false", () => {
    const row = promotionResultToRecommendedEditRow(
      makeResult({ eligible: false, suppression_reason: "in_cooldown" }),
      NOW,
    );
    expect(row).toBeNull();
  });

  it("returns null when tier is 'diagnostic-only'", () => {
    const row = promotionResultToRecommendedEditRow(
      makeResult({
        tier: "diagnostic-only",
        // tier mismatch with eligible should not occur in practice
        // but mapper must defend.
        eligible: true,
      }),
      NOW,
    );
    expect(row).toBeNull();
  });

  it("returns null when tier is 'operator-review-only'", () => {
    const row = promotionResultToRecommendedEditRow(
      makeResult({
        tier: "operator-review-only",
        eligible: true,
      }),
      NOW,
    );
    expect(row).toBeNull();
  });

  it("returns null when tier is 'blocked'", () => {
    const row = promotionResultToRecommendedEditRow(
      makeResult({
        tier: "blocked",
        eligible: true,
      }),
      NOW,
    );
    expect(row).toBeNull();
  });

  it("returns null when candidate.target_url is null", () => {
    const row = promotionResultToRecommendedEditRow(
      makeResult({
        candidate: makeCandidate({ target_url: null }),
      }),
      NOW,
    );
    expect(row).toBeNull();
  });

  it("returns null when candidate.confidence is 'low'", () => {
    const row = promotionResultToRecommendedEditRow(
      makeResult({
        candidate: makeCandidate({ confidence: "low" }),
      }),
      NOW,
    );
    expect(row).toBeNull();
  });

  it("returns null when candidate.safety_flags is non-empty", () => {
    const row = promotionResultToRecommendedEditRow(
      makeResult({
        candidate: makeCandidate({
          safety_flags: ["unsupported_claim_risk"],
        }),
      }),
      NOW,
    );
    expect(row).toBeNull();
  });
});
