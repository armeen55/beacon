/**
 * Architecture invariant — Slice 4.5.D.α₀a.3a — promotion
 * respects already-accepted ancestor rows.
 *
 * When a prior `recommendedEdits` row at the same promotion
 * dedupe key has reached one of the 4 accepted-state statuses,
 * the safety gate must suppress new candidates with
 * `suppression_reason: "accepted_ancestor_exists"`.
 *
 * `recommended` ancestor does NOT suppress (operator hasn't
 * acted yet) — negative test.
 */

import { describe, it, expect } from "vitest";

import { applyPromotionSafetyGates } from "@/domains/recommendation-intelligence/safety-gates";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { PromotionEditAnchor } from "@/domains/recommendation-intelligence/dedupe-cooldown";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const TENANT = "tenant-x";
const URL = "https://example.com/already-acted";

function makeCandidate(): RecommendationCandidateRow {
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
    customer_copy: "x",
    operator_evidence: "x",
    dedupe_key: "x",
    cooldown_key: "y",
    created_from_signal_at: "2026-05-19T00:00:00.000Z",
    safety_flags: [],
  };
}

function makeAncestor(
  status: PromotionEditAnchor["implementation_status"],
): PromotionEditAnchor {
  return {
    tenant_id: TENANT,
    action_type: "edit_title",
    target_url: URL,
    target_element_key: null,
    implementation_status: status,
    // Anchor in the distant past so cooldown is NOT the binding
    // suppression; isolates Gate 11.
    updated_at: "2025-01-01T00:00:00.000Z",
    live_at:
      status === "verified_live" || status === "verified_live_modified"
        ? "2025-01-01T00:00:00.000Z"
        : null,
    created_at: "2025-01-01T00:00:00.000Z",
  };
}

const ACCEPTED_STATES = [
  "accepted",
  "verified_live",
  "verified_live_modified",
  "partially_implemented",
] as const;

describe("recommendation-intelligence-promotion-respects-already-accepted", () => {
  it.each(ACCEPTED_STATES)(
    "suppresses promotion when ancestor status is %s",
    (status) => {
      const out = applyPromotionSafetyGates(makeCandidate(), {
        tenantId: TENANT,
        targetPageType: "service",
        recommendedEdits: [makeAncestor(status)],
        recommendationResponses: [],
        prerequisiteResolved: true,
        now: NOW,
      });
      expect(out.eligible).toBe(false);
      expect(out.suppression_reason).toBe("accepted_ancestor_exists");
    },
  );

  it("does NOT suppress when the only ancestor is 'recommended'", () => {
    const out = applyPromotionSafetyGates(makeCandidate(), {
      tenantId: TENANT,
      targetPageType: "service",
      recommendedEdits: [makeAncestor("recommended")],
      recommendationResponses: [],
      prerequisiteResolved: true,
      now: NOW,
    });
    expect(out.eligible).toBe(true);
  });
});
