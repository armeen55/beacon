/**
 * 2026-05-20 — Slice 4.5.D.α₀a.3a — safety-gates unit tests.
 *
 * Locked behavioral coverage (operator-listed):
 *   happy path · 3 tier suppressions · low confidence · safety
 *   flags · no evidence · content-edit missing target_url ·
 *   content-edit missing page type · content-edit skip page
 *   types · fix_* page-type bypass · in cooldown +
 *   cooldown_expires_at · 4 accepted-ancestor statuses · stale
 *   signal · prerequisite unresolved.
 */

import { describe, it, expect } from "vitest";

import { applyPromotionSafetyGates } from "@/domains/recommendation-intelligence/safety-gates";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { PromotionEditAnchor } from "@/domains/recommendation-intelligence/dedupe-cooldown";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const TENANT = "tenant-x";
const URL = "https://example.com/a";

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
    dedupe_key: "deadbeef",
    cooldown_key: "feedface",
    created_from_signal_at: "2026-05-19T00:00:00.000Z",
    safety_flags: [],
    ...partial,
  };
}

function baseCtx(
  partial: Partial<Parameters<typeof applyPromotionSafetyGates>[1]> = {},
): Parameters<typeof applyPromotionSafetyGates>[1] {
  return {
    tenantId: TENANT,
    targetPageType: "service",
    recommendedEdits: [],
    recommendationResponses: [],
    prerequisiteResolved: true,
    now: NOW,
    ...partial,
  };
}

function makeAncestor(
  partial: Partial<PromotionEditAnchor> = {},
): PromotionEditAnchor {
  return {
    tenant_id: TENANT,
    action_type: "edit_title",
    target_url: URL,
    target_element_key: null,
    implementation_status: "accepted",
    // Anchor in the distant past so the cooldown gate is NOT the
    // binding suppression; isolates Gate 11.
    updated_at: "2025-01-01T00:00:00.000Z",
    live_at: null,
    created_at: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("applyPromotionSafetyGates — happy path", () => {
  it("eligible for high-confidence customer-queue-ready row on service page", () => {
    const out = applyPromotionSafetyGates(makeCandidate(), baseCtx());
    expect(out.eligible).toBe(true);
    expect(out.tier).toBe("customer-queue-ready");
    expect(out.suppression_reason).toBeNull();
    expect(out.cooldown_expires_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier gates (1–3)
// ---------------------------------------------------------------------------

describe("applyPromotionSafetyGates — tier ladder", () => {
  it("diagnostic-only (missing_schema → add_schema) suppresses with diagnostic_only_tier", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({
        trigger_signal: "missing_schema",
        action_type: "add_schema",
      }),
      baseCtx(),
    );
    expect(out.eligible).toBe(false);
    expect(out.tier).toBe("diagnostic-only");
    expect(out.suppression_reason).toBe("diagnostic_only_tier");
  });

  it("operator-review-only (orphan_page) ALSO suppresses with diagnostic_only_tier (U4)", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({
        trigger_signal: "orphan_page",
        action_type: "add_internal_link",
        confidence: "medium",
      }),
      baseCtx(),
    );
    expect(out.eligible).toBe(false);
    expect(out.tier).toBe("operator-review-only");
    expect(out.suppression_reason).toBe("diagnostic_only_tier");
  });

  it("blocked tier (unknown signal) suppresses with blocked_tier", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({ trigger_signal: "unknown_signal_xyz" }),
      baseCtx(),
    );
    expect(out.tier).toBe("blocked");
    expect(out.suppression_reason).toBe("blocked_tier");
  });
});

// ---------------------------------------------------------------------------
// Gates 4–6
// ---------------------------------------------------------------------------

describe("applyPromotionSafetyGates — confidence / safety / evidence", () => {
  it("low_confidence suppresses even on customer-queue-ready pair", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({ confidence: "low" }),
      baseCtx(),
    );
    expect(out.suppression_reason).toBe("low_confidence");
  });

  it("safety_flags_set suppresses", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({ safety_flags: ["unsupported_claim_risk"] }),
      baseCtx(),
    );
    expect(out.suppression_reason).toBe("safety_flags_set");
  });

  it("no_evidence suppresses", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({ evidence: [] }),
      baseCtx(),
    );
    expect(out.suppression_reason).toBe("no_evidence");
  });
});

// ---------------------------------------------------------------------------
// Gates 7–9 (content-edit + fix_* bypass)
// ---------------------------------------------------------------------------

describe("applyPromotionSafetyGates — content-edit family + fix_* bypass", () => {
  it("content-edit missing target_url suppresses", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({ target_url: null }),
      baseCtx(),
    );
    expect(out.suppression_reason).toBe("missing_target_url");
  });

  it("content-edit missing targetPageType suppresses", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate(),
      baseCtx({ targetPageType: null }),
    );
    expect(out.suppression_reason).toBe("missing_target_page_type");
  });

  it.each(["utility", "technical_asset", "other"] as const)(
    "content-edit on page type %s suppresses with skip_page_type",
    (pageType) => {
      const out = applyPromotionSafetyGates(
        makeCandidate(),
        baseCtx({ targetPageType: pageType }),
      );
      expect(out.eligible).toBe(false);
      expect(out.suppression_reason).toBe("skip_page_type");
    },
  );

  it("fix_* family BYPASSES page-type skip (operators may repair utility URLs)", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({
        trigger_signal: "sitemap_missing",
        action_type: "fix_sitemap",
      }),
      baseCtx({ targetPageType: "utility" }),
    );
    expect(out.eligible).toBe(true);
  });

  // Pivot 2026-06-13 — first-party Google Search demand overrides the
  // classifier's AMBIGUOUS "other" verdict (a page Google ranks for
  // queries is a real content page), so a demand-driven title rewrite
  // reaches the queue even when contentSiteMode was never configured.
  it.each(["gsc_low_ctr", "gsc_striking_distance"] as const)(
    "GSC demand signal %s on 'other' is NOT skipped (demand overrides ambiguous classification)",
    (signal) => {
      const out = applyPromotionSafetyGates(
        makeCandidate({ trigger_signal: signal, action_type: "edit_title" }),
        baseCtx({ targetPageType: "other" }),
      );
      expect(out.eligible).toBe(true);
      expect(out.suppression_reason).toBeNull();
    },
  );

  // The override is SURGICAL: it relaxes ONLY the ambiguous "other"
  // bucket, never the positive utility / technical_asset verdicts.
  it.each(["utility", "technical_asset"] as const)(
    "GSC demand signal STILL hard-skipped on positive verdict %s",
    (pageType) => {
      const out = applyPromotionSafetyGates(
        makeCandidate({
          trigger_signal: "gsc_low_ctr",
          action_type: "edit_title",
        }),
        baseCtx({ targetPageType: pageType }),
      );
      expect(out.eligible).toBe(false);
      expect(out.suppression_reason).toBe("skip_page_type");
    },
  );
});

// ---------------------------------------------------------------------------
// Gate 10 — cooldown (with cooldown_expires_at carry-through)
// ---------------------------------------------------------------------------

describe("applyPromotionSafetyGates — cooldown integration", () => {
  it("recent dismissed edit triggers in_cooldown + carries cooldown_expires_at", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate(),
      baseCtx({
        recommendedEdits: [
          makeAncestor({
            implementation_status: "dismissed",
            updated_at: "2026-05-15T00:00:00.000Z", // 5d ago; 90d window
          }),
        ],
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.suppression_reason).toBe("in_cooldown");
    expect(out.cooldown_expires_at).not.toBeNull();
    // 2026-05-15 + 90d = 2026-08-13
    expect(out.cooldown_expires_at).toBe("2026-08-13T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Gate 11 — accepted ancestor
// ---------------------------------------------------------------------------

describe("applyPromotionSafetyGates — accepted ancestor", () => {
  it.each([
    "accepted",
    "verified_live",
    "verified_live_modified",
    "partially_implemented",
  ] as const)("suppresses when ancestor status is %s", (status) => {
    const out = applyPromotionSafetyGates(
      makeCandidate(),
      baseCtx({
        recommendedEdits: [
          makeAncestor({
            implementation_status: status,
            live_at:
              status === "verified_live" || status === "verified_live_modified"
                ? "2025-01-01T00:00:00.000Z"
                : null,
          }),
        ],
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.suppression_reason).toBe("accepted_ancestor_exists");
  });

  it("ancestor with status 'recommended' does NOT suppress (operator hasn't acted)", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate(),
      baseCtx({
        recommendedEdits: [
          makeAncestor({ implementation_status: "recommended" }),
        ],
      }),
    );
    expect(out.eligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gates 12–13 — signal_stale + prerequisite_unresolved
// ---------------------------------------------------------------------------

describe("applyPromotionSafetyGates — signal staleness + prerequisites", () => {
  it("signal_stale fires when created_from_signal_at > 90 days old", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({ created_from_signal_at: "2026-01-01T00:00:00.000Z" }),
      baseCtx(),
    );
    expect(out.suppression_reason).toBe("signal_stale");
  });

  it("signal_stale fires for malformed created_from_signal_at", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate({ created_from_signal_at: "not-a-date" }),
      baseCtx(),
    );
    expect(out.suppression_reason).toBe("signal_stale");
  });

  it("prerequisite_unresolved suppresses when ctx.prerequisiteResolved=false", () => {
    const out = applyPromotionSafetyGates(
      makeCandidate(),
      baseCtx({ prerequisiteResolved: false }),
    );
    expect(out.suppression_reason).toBe("prerequisite_unresolved");
  });
});
