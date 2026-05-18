/**
 * Phase A.2 Step 3d (2026-05-18) — `deriveLifecycleReason` unit tests.
 *
 * Pure function exercise across the 15-value reason taxonomy.
 * No mocks of repo, lifecycle compute, or match-runner — the
 * fixtures pass shaped inputs directly.
 */

import { describe, expect, it } from "vitest";

import {
  buildSnapshotUrlIndex,
  deriveLifecycleReason,
  __testing as deriveTesting,
  type SnapshotUrlIndex,
} from "@/domains/lifecycle-eligibility/derive-reason";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import type {
  RecommendationResponse,
  RecommendationResponseStatus,
} from "@/domains/product/recommendation-response-store";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

function makeEdit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "tenant-test",
    rec_id: "rec-1",
    action_type: "add_h2_section",
    target_url: "https://example.com/services/x",
    target_element_key: "h2[new]:abc",
    display_label: null,
    current_text: null,
    proposed_text: "Some H2 text",
    why: "why",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "specific-edit" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
    ...over,
  } as RecommendedEditRow;
}

function makeResponse(
  recId: string,
  status: RecommendationResponseStatus,
): RecommendationResponse {
  return {
    recId,
    status,
    respondedAt: "2026-05-01T00:00:00.000Z",
    deferUntil: null,
    targetPageUrl: null,
    patternId: null,
  };
}

function makeLifecycle(
  over: Partial<LifecycleForEdit["result"]> & {
    stage?: LifecycleForEdit["stage"];
  } = {},
): LifecycleForEdit {
  return {
    available: true,
    stage: over.stage ?? "cited_fast",
    copy: null,
    result: {
      eligible: true,
      eligibility_reason: "eligible_verified_live",
      first_citation_date_iso: over.first_citation_date_iso ?? "2026-05-02",
      days_to_first_citation: over.days_to_first_citation ?? 1,
      days_since_live: over.days_since_live ?? 2,
      per_platform_first_citation: { chatgpt: "2026-05-02", perplexity: null },
      is_partial_live: false,
      was_cited_before_live: false,
    } as LifecycleForEdit["result"],
    threshold_decision: {
      source: "profound_default",
      thresholds: T2C_THRESHOLDS,
      sample_size: 0,
      excluded_count: 0,
      percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
    },
  };
}

function emptyIndex(): SnapshotUrlIndex {
  return buildSnapshotUrlIndex([]);
}

function indexWith(urls: string[]): SnapshotUrlIndex {
  return buildSnapshotUrlIndex(urls);
}

// ─────────────────────────────────────────────────────────────────────
// Taxonomy coverage
// ─────────────────────────────────────────────────────────────────────

describe("deriveLifecycleReason — 15-value taxonomy", () => {
  it("dismissed_at_edit_level: implementation_status=dismissed — terminal (blocked_by null)", () => {
    // Dismissed = operator has acted. Final state, NOT operator
    // inaction. Aggregator routes blocked_by:null into
    // edits_terminal_or_in_flight.
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "dismissed",
        not_found_reason: "invalid_placeholder_pre_w3",
      }),
      response: null,
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("dismissed_at_edit_level");
    expect(out.blocked_by).toBeNull();
    expect(out.detail).toContain("invalid_placeholder_pre_w3");
    expect(out.threshold_eligible).toBe(false);
  });

  it("dismissed_at_response_level: response.status='dismissed' overrides recommended-status edit — terminal (blocked_by null)", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({ implementation_status: "recommended" }),
      response: makeResponse("rec-1", "dismissed"),
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("dismissed_at_response_level");
    expect(out.blocked_by).toBeNull();
  });

  it("wrong_page: live_match_kind='wrong_page'", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "wrong_page",
        live_at: "2026-05-01T00:00:00.000Z",
        live_match_kind: "wrong_page",
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("wrong_page");
    expect(out.blocked_by).toBe("system");
  });

  it("needs_new_page_sentinel: target_url='needs_new_page'", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({ target_url: "needs_new_page" }),
      response: null,
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("needs_new_page_sentinel");
    expect(out.blocked_by).toBeNull();
  });

  it("missing_target_url: empty target_url", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({ target_url: "" }),
      response: null,
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("missing_target_url");
    expect(out.blocked_by).toBe("system");
  });

  it("missing_live_at: verified_live status but live_at null", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "verified_live",
        live_at: null,
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com/services/x"]),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("missing_live_at");
    expect(out.blocked_by).toBe("system");
  });

  it("awaiting_operator_acceptance: recommended status, no response", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({ implementation_status: "recommended" }),
      response: null,
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("awaiting_operator_acceptance");
    expect(out.blocked_by).toBe("operator");
    expect(out.detail).toContain("no recommendation_responses row");
  });

  it("awaiting_operator_acceptance: recommended status + response.status='deferred'", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({ implementation_status: "recommended" }),
      response: makeResponse("rec-1", "deferred"),
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("awaiting_operator_acceptance");
    expect(out.blocked_by).toBe("operator");
  });

  it("accepted_not_live (response-accepted, edit still recommended): match-runner reconciliation lag", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({ implementation_status: "recommended" }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("accepted_not_live");
    expect(out.blocked_by).toBe("system");
    expect(out.detail).toContain("reconciliation pending");
  });

  it("no_snapshot_for_target_url: accepted status but no snapshot for URL", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "accepted",
        target_url: "https://example.com/never-scanned",
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com/other"]),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("no_snapshot_for_target_url");
    expect(out.blocked_by).toBe("system");
  });

  it("url_canonicalization_mismatch: target has trailing slash but snapshot does not", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "accepted",
        target_url: "https://example.com/",
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com"]),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("url_canonicalization_mismatch");
    expect(out.blocked_by).toBe("system");
    expect(out.detail).toContain("https://example.com");
  });

  it("match_fields_missing: accepted add_h2_section without target_element_key", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "accepted",
        action_type: "add_h2_section",
        target_element_key: null,
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com/services/x"]),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("match_fields_missing");
    expect(out.blocked_by).toBe("system");
  });

  it("accepted_not_live (generic fallback): accepted + snapshot exists + element key set", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "accepted",
        target_element_key: "h2[new]:abc",
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com/services/x"]),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("accepted_not_live");
    expect(out.blocked_by).toBe("system");
    expect(out.detail).toContain("awaiting daily-scan match");
  });

  it("cited_eligible: shipped + cited within window", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
        live_match_kind: "exact",
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com/services/x"]),
      lifecycleResult: makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
    });
    expect(out.reason).toBe("cited_eligible");
    expect(out.blocked_by).toBeNull();
    expect(out.threshold_eligible).toBe(true);
    expect(out.detail).toContain("counts toward threshold sample");
  });

  it("verified_live_not_yet_cited: shipped, lifecycle stage='live_not_yet_cited'", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com/services/x"]),
      lifecycleResult: makeLifecycle({
        stage: "live_not_yet_cited",
        days_to_first_citation: null,
        first_citation_date_iso: null,
      }),
    });
    expect(out.reason).toBe("verified_live_not_yet_cited");
    expect(out.blocked_by).toBeNull();
    expect(out.threshold_eligible).toBe(false);
  });

  it("stuck_uncited: shipped, stuck stage", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "verified_live",
        live_at: "2026-04-01T00:00:00.000Z",
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com/services/x"]),
      lifecycleResult: makeLifecycle({
        stage: "stuck",
        days_to_first_citation: null,
        first_citation_date_iso: null,
      }),
    });
    expect(out.reason).toBe("stuck_uncited");
    expect(out.blocked_by).toBe("system");
  });

  it("url_canonicalization_mismatch on shipped row: shipped + canonical-equal but not exact", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
        target_url: "https://example.com/",
      }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: indexWith(["https://example.com"]),
      lifecycleResult: makeLifecycle(),
    });
    expect(out.reason).toBe("url_canonicalization_mismatch");
    expect(out.blocked_by).toBe("system");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Branch precedence (later branches don't override earlier)
// ─────────────────────────────────────────────────────────────────────

describe("deriveLifecycleReason — branch precedence", () => {
  it("dismissed at edit level beats response-level dismissal", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({ implementation_status: "dismissed" }),
      response: makeResponse("rec-1", "dismissed"),
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("dismissed_at_edit_level");
  });

  it("dismissed_at_edit_level wins even when response was accepted", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({ implementation_status: "dismissed" }),
      response: makeResponse("rec-1", "accepted"),
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("dismissed_at_edit_level");
  });

  it("needs_new_page_sentinel wins before missing-target / missing-snapshot branches", () => {
    const out = deriveLifecycleReason({
      edit: makeEdit({
        implementation_status: "recommended",
        target_url: "needs_new_page",
      }),
      response: null,
      snapshotIndex: emptyIndex(),
      lifecycleResult: null,
    });
    expect(out.reason).toBe("needs_new_page_sentinel");
  });
});

// ─────────────────────────────────────────────────────────────────────
// SnapshotUrlIndex helper
// ─────────────────────────────────────────────────────────────────────

describe("buildSnapshotUrlIndex", () => {
  it("exact set excludes null/empty entries", () => {
    const idx = buildSnapshotUrlIndex([
      "https://example.com/a",
      null,
      "",
      undefined,
      "https://example.com/b",
    ]);
    expect(idx.exact.size).toBe(2);
    expect(idx.exact.has("https://example.com/a")).toBe(true);
    expect(idx.exact.has("https://example.com/b")).toBe(true);
  });

  it("canonical map maps canonical → first-seen exact URL", () => {
    const idx = buildSnapshotUrlIndex([
      "https://example.com",
      "https://example.com/",
    ]);
    // Both canonicalize to the same value; canonical map stores
    // first-seen exact URL.
    expect(idx.exact.size).toBe(2);
    expect(idx.canonicalToExact.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Element-key requirement helper
// ─────────────────────────────────────────────────────────────────────

describe("requiresElementKey", () => {
  it("includes add_h2_section + add_faq + edit_title", () => {
    expect(deriveTesting.requiresElementKey("add_h2_section")).toBe(true);
    expect(deriveTesting.requiresElementKey("add_faq")).toBe(true);
    expect(deriveTesting.requiresElementKey("edit_title")).toBe(true);
  });

  it("excludes unknown action types", () => {
    expect(deriveTesting.requiresElementKey("create_page")).toBe(false);
    expect(deriveTesting.requiresElementKey(null)).toBe(false);
    expect(deriveTesting.requiresElementKey(undefined)).toBe(false);
  });
});
