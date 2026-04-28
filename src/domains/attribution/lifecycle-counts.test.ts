import { describe, expect, it } from "vitest";

import {
  computeLifecycleCounts,
  editNeedsRewrite,
} from "./lifecycle-counts";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const TENANT = "tenant-ritz-founder";
const REC_ID = "create_cluster_page:geo:Los Altos";

function editStub(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  return {
    id: `${REC_ID}__add_h2_section__h2[new]:abc`,
    tenant_id: TENANT,
    rec_id: REC_ID,
    action_type: "add_h2_section",
    target_url: "https://ritzbuilders.com/locations/los-altos",
    target_element_key: "h2[new]:abc",
    display_label: "H2: test",
    current_text: null,
    proposed_text: "Test heading",
    why: "Test reasoning",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "openai",
    provider_name: "openai",
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-04-25T19:15:18.778Z",
    updated_at: "2026-04-27T09:42:58.574Z",
    implementation_status: "accepted",
    live_at: null,
    not_found_reason: null,
    ...overrides,
  };
}

describe("computeLifecycleCounts", () => {
  it("buckets every status correctly", () => {
    const result = computeLifecycleCounts([
      editStub({ id: "1", implementation_status: "verified_live" }),
      editStub({ id: "2", implementation_status: "verified_live_modified" }),
      editStub({ id: "3", implementation_status: "accepted" }),
      editStub({ id: "4", implementation_status: "accepted" }),
      editStub({ id: "5", implementation_status: "needs_review" }),
      editStub({ id: "6", implementation_status: "partially_implemented" }),
      editStub({ id: "7", implementation_status: "wrong_page" }),
      editStub({ id: "8", implementation_status: "not_found_after_7d" }),
      editStub({ id: "9", implementation_status: "dismissed" }),
      editStub({ id: "10", implementation_status: "recommended" }),
    ]);
    expect(result.counts.liveVerified).toBe(2);
    expect(result.counts.pendingImplementation).toBe(2);
    expect(result.counts.needsReview).toBe(3);
    expect(result.counts.notFoundAfter7d).toBe(1);
    expect(result.counts.actionableTotal).toBe(5); // pending + needs review
  });

  it("dismissed and recommended are NOT counted (production sanity)", () => {
    const result = computeLifecycleCounts([
      editStub({ id: "d1", implementation_status: "dismissed" }),
      editStub({ id: "d2", implementation_status: "dismissed" }),
      editStub({ id: "r1", implementation_status: "recommended" }),
    ]);
    expect(result.counts.liveVerified).toBe(0);
    expect(result.counts.pendingImplementation).toBe(0);
    expect(result.counts.needsReview).toBe(0);
    expect(result.counts.notFoundAfter7d).toBe(0);
    expect(result.counts.actionableTotal).toBe(0);
  });

  it("undefined status is not counted (legacy file rows with no implementation_status field)", () => {
    const result = computeLifecycleCounts([
      editStub({ id: "legacy", implementation_status: undefined }),
    ]);
    expect(result.counts.actionableTotal).toBe(0);
  });

  it("Los Altos production fixture: 5 accepted → pendingImplementation=5", () => {
    const losAltosEdits: RecommendedEditRow[] = [
      editStub({ id: "h2", action_type: "add_h2_section", implementation_status: "accepted" }),
      editStub({ id: "f1", action_type: "add_faq", target_element_key: "faq_question[new]:d1", implementation_status: "accepted" }),
      editStub({ id: "f2", action_type: "add_faq", target_element_key: "faq_question[new]:f2", implementation_status: "accepted" }),
      editStub({ id: "f3", action_type: "add_faq", target_element_key: "faq_question[new]:93", implementation_status: "accepted" }),
      editStub({ id: "f4", action_type: "add_faq", target_element_key: "faq_question[new]:ff", implementation_status: "accepted" }),
    ];
    const result = computeLifecycleCounts(losAltosEdits);
    expect(result.counts.pendingImplementation).toBe(5);
    expect(result.buckets.pendingEdits).toHaveLength(5);
    expect(result.counts.actionableTotal).toBe(5);
  });

  it("returns the original edit rows in their bucket arrays", () => {
    const accepted = editStub({ id: "a", implementation_status: "accepted" });
    const live = editStub({ id: "l", implementation_status: "verified_live" });
    const result = computeLifecycleCounts([accepted, live]);
    expect(result.buckets.pendingEdits).toEqual([accepted]);
    expect(result.buckets.liveVerifiedEdits).toEqual([live]);
  });
});

describe("editNeedsRewrite", () => {
  it("returns true when proposed_text contains the generator placeholder", () => {
    expect(
      editNeedsRewrite({
        proposed_text:
          "Q: Who builds in Los Altos?\n\nA: Draft answer (operator: rewrite). Anchor on: Los Altos.",
      }),
    ).toBe(true);
  });

  it("returns false for clean operator-written FAQ answers", () => {
    expect(
      editNeedsRewrite({
        proposed_text: "Q: Who builds in Los Altos?\n\nA: Hire an architect-led firm.",
      }),
    ).toBe(false);
  });

  it("returns false when proposed_text is null", () => {
    expect(editNeedsRewrite({ proposed_text: null })).toBe(false);
  });

  it("returns false when proposed_text is empty", () => {
    expect(editNeedsRewrite({ proposed_text: "" })).toBe(false);
  });

  it("matches the H2 production fixture: real proposed text → no rewrite needed", () => {
    expect(
      editNeedsRewrite({
        proposed_text:
          "Why teams choose us over De Mattei Construction\nAn architect-led design-build approach keeps design, budget, and construction tightly coordinated.",
      }),
    ).toBe(false);
  });
});
