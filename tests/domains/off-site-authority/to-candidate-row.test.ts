/**
 * Slice 4.5.F (2026-05-21) — adapter unit tests for
 * `offSiteCandidateToCandidateRow`. Pure mapper from Section 7's
 * `OffSiteCandidateAction` → Section 4.5's
 * `RecommendationCandidateRow`. Pinned by `recommendation-
 * intelligence-offsite-contract`.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { offSiteCandidateToCandidateRow } from "@/domains/off-site-authority/to-candidate-row";
import type { OffSiteCandidateAction } from "@/domains/off-site-authority/recommendation-rules";
import type { ActionType } from "@/domains/recommendations/action-types";

const CTX = {
  tenant_id: "tenant-x",
  generated_at: "2026-05-21T00:00:00.000Z",
};

function makeAction(
  overrides: Partial<OffSiteCandidateAction> = {},
): OffSiteCandidateAction {
  return {
    id: "gbp:claim_gbp",
    actionType: "claim_gbp",
    channel: "gbp",
    title: "Claim your Google Business Profile",
    rationale: "Beacon did not find a confirmed GBP for this tenant.",
    confidence: "high",
    source_note: "channel state: missing",
    manual_only: true,
    policy_risk: false,
    ...overrides,
  };
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

describe("offSiteCandidateToCandidateRow", () => {
  it("is pure / deterministic — same input → same output bytes", () => {
    const a = makeAction();
    const r1 = offSiteCandidateToCandidateRow(a, CTX);
    const r2 = offSiteCandidateToCandidateRow(a, CTX);
    expect(r1).toStrictEqual(r2);
  });

  it("generator_kind is the LITERAL `human_task`", () => {
    const r = offSiteCandidateToCandidateRow(makeAction(), CTX);
    expect(r.generator_kind).toBe("human_task");
  });

  it("target_url is the LITERAL null (off-site has no owned-page URL)", () => {
    const r = offSiteCandidateToCandidateRow(makeAction(), CTX);
    expect(r.target_url).toBeNull();
  });

  it("action_type is carried through unchanged from input", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({ actionType: "request_gbp_reviews" }),
      CTX,
    );
    expect(r.action_type).toBe("request_gbp_reviews");
  });

  it("customer_copy equals action.title exactly", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({ title: "Optimize your Houzz profile" }),
      CTX,
    );
    expect(r.customer_copy).toBe("Optimize your Houzz profile");
  });

  it("operator_evidence includes action.rationale AND action.source_note", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({
        rationale: "Reviews below tenant average",
        source_note: "channel state: weak",
      }),
      CTX,
    );
    expect(r.operator_evidence).toContain("Reviews below tenant average");
    expect(r.operator_evidence).toContain("channel state: weak");
  });

  it("dedupe_key matches the locked formula", () => {
    const a = makeAction({ actionType: "claim_gbp", id: "gbp:claim_gbp" });
    const r = offSiteCandidateToCandidateRow(a, CTX);
    const expected = sha1(`${CTX.tenant_id}::claim_gbp::off_site::gbp:claim_gbp`);
    expect(r.dedupe_key).toBe(expected);
  });

  it("cooldown_key matches the locked formula AND differs from dedupe", () => {
    const a = makeAction({ actionType: "claim_gbp", id: "gbp:claim_gbp" });
    const r = offSiteCandidateToCandidateRow(a, CTX);
    const expectedCooldown = sha1(`${CTX.tenant_id}::claim_gbp::off_site`);
    expect(r.cooldown_key).toBe(expectedCooldown);
    expect(r.cooldown_key).not.toBe(r.dedupe_key);
  });

  it("policy_risk: true → safety_flags includes `unsupported_claim_risk`", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({ policy_risk: true }),
      CTX,
    );
    expect(r.safety_flags).toEqual(["unsupported_claim_risk"]);
  });

  it("policy_risk: false → safety_flags is empty", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({ policy_risk: false }),
      CTX,
    );
    expect(r.safety_flags).toEqual([]);
  });

  it.each<[ActionType, "high" | "medium" | "low"]>([
    ["claim_gbp", "medium"],
    ["optimize_gbp_profile", "medium"],
    ["claim_or_optimize_houzz", "medium"],
    ["claim_or_optimize_yelp", "medium"],
    ["submit_to_industry_directory", "medium"],
    ["request_gbp_reviews", "low"],
    ["pursue_local_pr", "low"],
  ])(
    "impact_estimate for %s is locked to %s",
    (actionType, expected) => {
      const r = offSiteCandidateToCandidateRow(
        makeAction({ actionType }),
        CTX,
      );
      expect(r.impact_estimate).toBe(expected);
    },
  );

  it("trigger_signal namespace is `off_site:${channel}`", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({ channel: "houzz" }),
      CTX,
    );
    expect(r.trigger_signal).toBe("off_site:houzz");
  });

  it("topic_cluster_label uses the off-site namespace", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({ channel: "yelp" }),
      CTX,
    );
    expect(r.topic_cluster_label).toBe("off-site:yelp");
  });

  it("evidence reuses the existing `business_config` evidence kind with action.id as ref", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({ id: "houzz:claim_or_optimize_houzz" }),
      CTX,
    );
    expect(r.evidence).toEqual([
      { kind: "business_config", ref: "houzz:claim_or_optimize_houzz" },
    ]);
  });

  it("created_from_signal_at equals ctx.generated_at", () => {
    const r = offSiteCandidateToCandidateRow(makeAction(), CTX);
    expect(r.created_from_signal_at).toBe(CTX.generated_at);
  });

  it("tenant_id equals ctx.tenant_id (not derived from action)", () => {
    const r = offSiteCandidateToCandidateRow(makeAction(), {
      tenant_id: "tenant-other",
      generated_at: CTX.generated_at,
    });
    expect(r.tenant_id).toBe("tenant-other");
  });

  it("confidence is carried through unchanged", () => {
    const r = offSiteCandidateToCandidateRow(
      makeAction({ confidence: "low" }),
      CTX,
    );
    expect(r.confidence).toBe("low");
  });
});
