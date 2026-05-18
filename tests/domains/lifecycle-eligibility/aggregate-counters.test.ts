/**
 * Phase A.2 Step 3d (2026-05-18) — `computeFunnelCounters` unit tests.
 *
 * Pure aggregator exercise across the locked `FunnelCounters` shape.
 * No mocks of repo, lifecycle compute, or match-runner — the fixtures
 * pass shaped inputs directly.
 *
 * Each test pins one or more of the documented reconciliation
 * invariants. The invariants are restated in code at the bottom of
 * this file as a single "reconciliation sweep" suite so a regression
 * lights up loudly.
 */

import { describe, expect, it } from "vitest";

import {
  computeFunnelCounters,
  type ComputeFunnelCountersInput,
} from "@/domains/lifecycle-eligibility/aggregate-counters";
import {
  buildSnapshotUrlIndex,
  deriveLifecycleReason,
} from "@/domains/lifecycle-eligibility/derive-reason";
import type {
  FunnelCounters,
  PerRowEligibility,
} from "@/domains/lifecycle-eligibility/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import type {
  RecommendationResponse,
  RecommendationResponseStatus,
} from "@/domains/product/recommendation-response-store";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";
import { BRAIN_SAMPLE_THRESHOLDS } from "@/domains/recommendations/cross-tenant-brain/thresholds";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

function makeEdit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: over.id ?? "edit-1",
    tenant_id: "tenant-test",
    rec_id: over.rec_id ?? "rec-1",
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
      per_platform_first_citation: {
        chatgpt: "2026-05-02",
        perplexity: null,
      },
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

/**
 * Builds per-row decisions in sync with `edits` (same length, same
 * order). This is the canonical caller contract — the page builds
 * decisions via `deriveLifecycleReason` and passes them in
 * lockstep.
 */
function deriveAll(
  edits: ReadonlyArray<RecommendedEditRow>,
  responses: ReadonlyArray<RecommendationResponse>,
  snapshotUrls: ReadonlyArray<string>,
  lifecycleResults: ReadonlyArray<LifecycleForEdit | null>,
): ReadonlyArray<PerRowEligibility> {
  const responseByRecId = new Map<string, RecommendationResponse>();
  for (const r of responses) responseByRecId.set(r.recId, r);
  const snapshotIndex = buildSnapshotUrlIndex(snapshotUrls);
  return edits.map((edit, i) =>
    deriveLifecycleReason({
      edit,
      response: responseByRecId.get(edit.rec_id) ?? null,
      snapshotIndex,
      lifecycleResult: lifecycleResults[i] ?? null,
    }),
  );
}

function runComputed(opts: {
  edits: ReadonlyArray<RecommendedEditRow>;
  responses?: ReadonlyArray<RecommendationResponse>;
  snapshotUrls?: ReadonlyArray<string>;
  lifecycleResults?: ReadonlyArray<LifecycleForEdit | null>;
}): { counters: FunnelCounters; perRow: ReadonlyArray<PerRowEligibility> } {
  const responses = opts.responses ?? [];
  const snapshotUrls = opts.snapshotUrls ?? [];
  const lifecycleResults =
    opts.lifecycleResults ?? opts.edits.map(() => null as LifecycleForEdit | null);

  const perRow = deriveAll(opts.edits, responses, snapshotUrls, lifecycleResults);

  const input: ComputeFunnelCountersInput = {
    edits: opts.edits,
    responses,
    snapshotIndex: buildSnapshotUrlIndex(snapshotUrls),
    perRowDecisions: perRow,
    lifecycleResults,
  };
  const counters = computeFunnelCounters(input);
  return { counters, perRow };
}

// ─────────────────────────────────────────────────────────────────────
// Zero / boundary
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — zero inputs", () => {
  it("empty edits + empty responses returns all-zero counters", () => {
    const { counters } = runComputed({ edits: [] });
    expect(counters.total_edits).toBe(0);
    expect(counters.edits_recommended).toBe(0);
    expect(counters.edits_dismissed).toBe(0);
    expect(counters.edits_accepted_not_live).toBe(0);
    expect(counters.edits_with_live_at).toBe(0);
    expect(counters.edits_verified_live).toBe(0);
    expect(counters.edits_cited_post_ship).toBe(0);
    expect(counters.edits_threshold_eligible).toBe(0);
    expect(counters.responses_total).toBe(0);
    expect(counters.responses_accepted).toBe(0);
    expect(counters.responses_dismissed).toBe(0);
    expect(counters.responses_deferred).toBe(0);
    expect(counters.edits_in_accepted_lineage).toBe(0);
    expect(counters.unique_target_urls).toBe(0);
    expect(counters.urls_with_snapshot_coverage).toBe(0);
    expect(counters.urls_without_snapshot_coverage).toBe(0);
    expect(counters.urls_with_canonicalization_mismatch).toBe(0);
    expect(counters.edits_blocked_by_operator).toBe(0);
    expect(counters.edits_blocked_by_system).toBe(0);
    expect(counters.edits_terminal_or_in_flight).toBe(0);
  });

  it("threshold_gate is the locked BRAIN_SAMPLE_THRESHOLDS constant (20)", () => {
    const { counters } = runComputed({ edits: [] });
    expect(counters.threshold_gate).toBe(
      BRAIN_SAMPLE_THRESHOLDS.threshold_replacement,
    );
    expect(counters.threshold_gate).toBe(20);
  });

  it("threshold_source defaults to 'profound_default' with empty sample", () => {
    const { counters } = runComputed({ edits: [] });
    expect(counters.threshold_source).toBe("profound_default");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-counter accuracy
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — funnel-stage counters", () => {
  it("edits_recommended counts implementation_status='recommended' rows", () => {
    const { counters } = runComputed({
      edits: [
        makeEdit({ id: "a", rec_id: "rec-a", implementation_status: "recommended" }),
        makeEdit({ id: "b", rec_id: "rec-b", implementation_status: "recommended" }),
        makeEdit({ id: "c", rec_id: "rec-c", implementation_status: "dismissed" }),
      ],
    });
    expect(counters.edits_recommended).toBe(2);
    expect(counters.total_edits).toBe(3);
  });

  it("edits_dismissed counts edit-level dismissed rows", () => {
    const { counters } = runComputed({
      edits: [
        makeEdit({ id: "a", rec_id: "rec-a", implementation_status: "dismissed" }),
        makeEdit({ id: "b", rec_id: "rec-b", implementation_status: "dismissed" }),
        makeEdit({ id: "c", rec_id: "rec-c", implementation_status: "recommended" }),
      ],
    });
    expect(counters.edits_dismissed).toBe(2);
  });

  it("edits_accepted_not_live counts accepted rows with null live_at", () => {
    const { counters } = runComputed({
      edits: [
        makeEdit({
          id: "a",
          rec_id: "rec-a",
          implementation_status: "accepted",
          live_at: null,
        }),
        makeEdit({
          id: "b",
          rec_id: "rec-b",
          implementation_status: "accepted",
          live_at: "2026-05-01T00:00:00.000Z",
        }),
      ],
    });
    expect(counters.edits_accepted_not_live).toBe(1);
    expect(counters.edits_with_live_at).toBe(1);
  });

  it("edits_with_live_at counts every row with non-null live_at regardless of status", () => {
    const { counters } = runComputed({
      edits: [
        makeEdit({
          id: "a",
          rec_id: "rec-a",
          implementation_status: "verified_live",
          live_at: "2026-05-01T00:00:00.000Z",
        }),
        makeEdit({
          id: "b",
          rec_id: "rec-b",
          implementation_status: "verified_live_modified",
          live_at: "2026-05-01T00:00:00.000Z",
        }),
        makeEdit({
          id: "c",
          rec_id: "rec-c",
          implementation_status: "partially_implemented",
          live_at: "2026-05-01T00:00:00.000Z",
        }),
        makeEdit({
          id: "d",
          rec_id: "rec-d",
          implementation_status: "recommended",
          live_at: null,
        }),
      ],
    });
    expect(counters.edits_with_live_at).toBe(3);
  });

  it("edits_verified_live counts the verified-live family", () => {
    const { counters } = runComputed({
      edits: [
        makeEdit({
          id: "a",
          rec_id: "rec-a",
          implementation_status: "verified_live",
          live_at: "2026-05-01T00:00:00.000Z",
        }),
        makeEdit({
          id: "b",
          rec_id: "rec-b",
          implementation_status: "verified_live_modified",
          live_at: "2026-05-01T00:00:00.000Z",
        }),
        makeEdit({
          id: "c",
          rec_id: "rec-c",
          implementation_status: "partially_implemented",
          live_at: "2026-05-01T00:00:00.000Z",
        }),
        makeEdit({
          id: "d",
          rec_id: "rec-d",
          implementation_status: "accepted",
          live_at: "2026-05-01T00:00:00.000Z",
        }),
      ],
    });
    expect(counters.edits_verified_live).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cited + threshold-eligible
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — cited + threshold-eligible", () => {
  it("edits_cited_post_ship counts CITED_STAGES (fast/typical/late/very_late)", () => {
    const edits = [
      makeEdit({
        id: "a",
        rec_id: "rec-a",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      makeEdit({
        id: "b",
        rec_id: "rec-b",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      makeEdit({
        id: "c",
        rec_id: "rec-c",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      makeEdit({
        id: "d",
        rec_id: "rec-d",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      makeEdit({
        id: "e",
        rec_id: "rec-e",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
    ];
    const lifecycles = [
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
      makeLifecycle({ stage: "cited_typical", days_to_first_citation: 9 }),
      makeLifecycle({ stage: "cited_late", days_to_first_citation: 25 }),
      makeLifecycle({ stage: "cited_very_late", days_to_first_citation: 60 }),
      makeLifecycle({
        stage: "live_not_yet_cited",
        days_to_first_citation: null,
        first_citation_date_iso: null,
      }),
    ];
    const { counters } = runComputed({
      edits,
      snapshotUrls: ["https://example.com/services/x"],
      lifecycleResults: lifecycles,
    });
    expect(counters.edits_cited_post_ship).toBe(4);
    expect(counters.edits_threshold_eligible).toBe(4);
  });

  it("edits_threshold_eligible excludes rows with days_to_first_citation < 0", () => {
    const edits = [
      makeEdit({
        id: "a",
        rec_id: "rec-a",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      makeEdit({
        id: "b",
        rec_id: "rec-b",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
    ];
    const lifecycles = [
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
      // was_cited_before_live → days_to_first_citation may be negative
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: -2 }),
    ];
    const { counters } = runComputed({
      edits,
      snapshotUrls: ["https://example.com/services/x"],
      lifecycleResults: lifecycles,
    });
    expect(counters.edits_cited_post_ship).toBe(2);
    expect(counters.edits_threshold_eligible).toBe(1);
  });

  it("null lifecycle results contribute zero to cited counters", () => {
    const edits = [
      makeEdit({ id: "a", rec_id: "rec-a", implementation_status: "recommended" }),
      makeEdit({ id: "b", rec_id: "rec-b", implementation_status: "recommended" }),
    ];
    const { counters } = runComputed({
      edits,
      lifecycleResults: [null, null],
    });
    expect(counters.edits_cited_post_ship).toBe(0);
    expect(counters.edits_threshold_eligible).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Threshold gate flip
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — threshold gate flip", () => {
  function makeCitedEdit(i: number, days: number): RecommendedEditRow {
    return makeEdit({
      id: `edit-${i}`,
      rec_id: `rec-${i}`,
      implementation_status: "verified_live",
      live_at: "2026-05-01T00:00:00.000Z",
      target_url: `https://example.com/page-${i}`,
    });
  }
  function makeCitedLifecycle(): LifecycleForEdit {
    return makeLifecycle({ stage: "cited_fast", days_to_first_citation: 2 });
  }

  it("returns 'profound_default' below threshold_gate", () => {
    const N = BRAIN_SAMPLE_THRESHOLDS.threshold_replacement - 1; // 19
    const edits = Array.from({ length: N }, (_, i) => makeCitedEdit(i, 2));
    const lifecycles = Array.from({ length: N }, () => makeCitedLifecycle());
    const snapshotUrls = edits.map((e) => e.target_url as string);
    const { counters } = runComputed({
      edits,
      snapshotUrls,
      lifecycleResults: lifecycles,
    });
    expect(counters.edits_threshold_eligible).toBe(19);
    expect(counters.threshold_source).toBe("profound_default");
  });

  it("flips to 'per_tenant' AT threshold_gate", () => {
    const N = BRAIN_SAMPLE_THRESHOLDS.threshold_replacement; // 20
    const edits = Array.from({ length: N }, (_, i) => makeCitedEdit(i, 2));
    const lifecycles = Array.from({ length: N }, () => makeCitedLifecycle());
    const snapshotUrls = edits.map((e) => e.target_url as string);
    const { counters } = runComputed({
      edits,
      snapshotUrls,
      lifecycleResults: lifecycles,
    });
    expect(counters.edits_threshold_eligible).toBe(20);
    expect(counters.threshold_source).toBe("per_tenant");
  });

  it("stays 'per_tenant' above threshold_gate", () => {
    const N = BRAIN_SAMPLE_THRESHOLDS.threshold_replacement + 5; // 25
    const edits = Array.from({ length: N }, (_, i) => makeCitedEdit(i, 2));
    const lifecycles = Array.from({ length: N }, () => makeCitedLifecycle());
    const snapshotUrls = edits.map((e) => e.target_url as string);
    const { counters } = runComputed({
      edits,
      snapshotUrls,
      lifecycleResults: lifecycles,
    });
    expect(counters.edits_threshold_eligible).toBe(25);
    expect(counters.threshold_source).toBe("per_tenant");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Response rollups
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — response rollups", () => {
  it("counts responses by status", () => {
    const edits = [
      makeEdit({ id: "a", rec_id: "rec-a" }),
      makeEdit({ id: "b", rec_id: "rec-b" }),
      makeEdit({ id: "c", rec_id: "rec-c" }),
    ];
    const responses: ReadonlyArray<RecommendationResponse> = [
      makeResponse("rec-a", "accepted"),
      makeResponse("rec-b", "dismissed"),
      makeResponse("rec-c", "deferred"),
    ];
    const { counters } = runComputed({ edits, responses });
    expect(counters.responses_total).toBe(3);
    expect(counters.responses_accepted).toBe(1);
    expect(counters.responses_dismissed).toBe(1);
    expect(counters.responses_deferred).toBe(1);
  });

  it("edits_in_accepted_lineage counts edits whose parent rec has an 'accepted' response", () => {
    const edits = [
      // rec-a is accepted → both edits in lineage
      makeEdit({ id: "a1", rec_id: "rec-a" }),
      makeEdit({ id: "a2", rec_id: "rec-a" }),
      // rec-b is dismissed → 0
      makeEdit({ id: "b1", rec_id: "rec-b" }),
      // rec-c is deferred → 0
      makeEdit({ id: "c1", rec_id: "rec-c" }),
      // rec-d has no response → 0
      makeEdit({ id: "d1", rec_id: "rec-d" }),
    ];
    const responses: ReadonlyArray<RecommendationResponse> = [
      makeResponse("rec-a", "accepted"),
      makeResponse("rec-b", "dismissed"),
      makeResponse("rec-c", "deferred"),
    ];
    const { counters } = runComputed({ edits, responses });
    expect(counters.edits_in_accepted_lineage).toBe(2);
  });

  it("edits_in_accepted_lineage independent of edit's implementation_status", () => {
    const edits = [
      // Even if the edit is still in 'recommended' status, an accepted
      // response means the lineage is accepted (the operator clicked
      // Accept; match-runner just hasn't caught up).
      makeEdit({ id: "a", rec_id: "rec-a", implementation_status: "recommended" }),
      makeEdit({ id: "b", rec_id: "rec-b", implementation_status: "dismissed" }),
    ];
    const responses: ReadonlyArray<RecommendationResponse> = [
      makeResponse("rec-a", "accepted"),
      makeResponse("rec-b", "accepted"),
    ];
    const { counters } = runComputed({ edits, responses });
    expect(counters.edits_in_accepted_lineage).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// URL coverage
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — URL coverage", () => {
  it("unique_target_urls counts distinct URLs and excludes sentinel/null/empty", () => {
    const edits = [
      makeEdit({ id: "a", rec_id: "rec-a", target_url: "https://example.com/a" }),
      makeEdit({ id: "b", rec_id: "rec-b", target_url: "https://example.com/a" }), // dupe
      makeEdit({ id: "c", rec_id: "rec-c", target_url: "https://example.com/b" }),
      makeEdit({ id: "d", rec_id: "rec-d", target_url: "needs_new_page" }), // sentinel
      makeEdit({ id: "e", rec_id: "rec-e", target_url: "" }), // empty
      makeEdit({
        id: "f",
        rec_id: "rec-f",
        target_url: null as unknown as string,
      }), // null
    ];
    const { counters } = runComputed({
      edits,
      snapshotUrls: ["https://example.com/a"],
    });
    expect(counters.unique_target_urls).toBe(2);
  });

  it("urls_with_snapshot_coverage counts exact-match URLs", () => {
    const edits = [
      makeEdit({ id: "a", rec_id: "rec-a", target_url: "https://example.com/a" }),
      makeEdit({ id: "b", rec_id: "rec-b", target_url: "https://example.com/b" }),
    ];
    const { counters } = runComputed({
      edits,
      snapshotUrls: ["https://example.com/a"],
    });
    expect(counters.urls_with_snapshot_coverage).toBe(1);
    expect(counters.urls_without_snapshot_coverage).toBe(1);
    expect(counters.urls_with_canonicalization_mismatch).toBe(0);
  });

  it("urls_with_canonicalization_mismatch detects trailing-slash class", () => {
    const edits = [
      // target has trailing slash; snapshot stored without
      makeEdit({ id: "a", rec_id: "rec-a", target_url: "https://example.com/" }),
    ];
    const { counters } = runComputed({
      edits,
      snapshotUrls: ["https://example.com"],
    });
    expect(counters.urls_with_snapshot_coverage).toBe(0);
    expect(counters.urls_without_snapshot_coverage).toBe(1);
    expect(counters.urls_with_canonicalization_mismatch).toBe(1);
  });

  it("canonicalization mismatch is a sub-set of urls_without_snapshot_coverage", () => {
    const edits = [
      // exact match → coverage++, NOT mismatch
      makeEdit({ id: "a", rec_id: "rec-a", target_url: "https://example.com/a" }),
      // canonical-only match → not coverage, IS mismatch
      makeEdit({ id: "b", rec_id: "rec-b", target_url: "https://example.com/" }),
      // no snapshot at all → not coverage, NOT mismatch
      makeEdit({ id: "c", rec_id: "rec-c", target_url: "https://example.com/c" }),
    ];
    const { counters } = runComputed({
      edits,
      snapshotUrls: ["https://example.com/a", "https://example.com"],
    });
    expect(counters.unique_target_urls).toBe(3);
    expect(counters.urls_with_snapshot_coverage).toBe(1);
    expect(counters.urls_without_snapshot_coverage).toBe(2);
    expect(counters.urls_with_canonicalization_mismatch).toBe(1);
    // Invariant: with + without === total
    expect(
      counters.urls_with_snapshot_coverage +
        counters.urls_without_snapshot_coverage,
    ).toBe(counters.unique_target_urls);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Block classification
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — block classification", () => {
  it("counts operator-blocked + system-blocked + terminal_or_in_flight from perRowDecisions (dismissed = terminal, not operator)", () => {
    // Build a mixed fixture where each block class is exercised at
    // least once. The derive-reason layer is the source of truth for
    // blocked_by values; aggregator just tallies.
    //
    // CRITICAL CORRECTION (2026-05-18 patch): dismissed_at_edit_level
    // AND dismissed_at_response_level are TERMINAL — the operator
    // has acted; they are NOT operator inaction. blocked_by:null
    // routes them into edits_terminal_or_in_flight.
    const edits = [
      // operator-blocked: awaiting_operator_acceptance
      makeEdit({ id: "op1", rec_id: "rec-op1", implementation_status: "recommended" }),
      // terminal: dismissed_at_response_level (operator declined the rec)
      makeEdit({ id: "term2", rec_id: "rec-term2", implementation_status: "recommended" }),
      // terminal: dismissed_at_edit_level (operator dismissed the specific edit)
      makeEdit({ id: "term3", rec_id: "rec-term3", implementation_status: "dismissed" }),
      // system-blocked: accepted_not_live (response accepted, edit recommended)
      makeEdit({ id: "sys1", rec_id: "rec-sys1", implementation_status: "recommended" }),
      // terminal/in-flight: cited_eligible (null blocked_by)
      makeEdit({
        id: "term1",
        rec_id: "rec-term1",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
        target_url: "https://example.com/cited",
      }),
    ];
    const responses: ReadonlyArray<RecommendationResponse> = [
      makeResponse("rec-term2", "dismissed"),
      makeResponse("rec-sys1", "accepted"),
      makeResponse("rec-term1", "accepted"),
    ];
    const lifecycles: ReadonlyArray<LifecycleForEdit | null> = [
      null,
      null,
      null,
      null,
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
    ];
    const { counters, perRow } = runComputed({
      edits,
      responses,
      snapshotUrls: ["https://example.com/cited"],
      lifecycleResults: lifecycles,
    });
    expect(perRow.map((r) => r.blocked_by)).toEqual([
      "operator", // awaiting_operator_acceptance
      null, // dismissed_at_response_level — terminal
      null, // dismissed_at_edit_level — terminal
      "system", // accepted_not_live
      null, // cited_eligible — terminal
    ]);
    expect(counters.edits_blocked_by_operator).toBe(1);
    expect(counters.edits_blocked_by_system).toBe(1);
    expect(counters.edits_terminal_or_in_flight).toBe(3);
    // Reconciliation sanity check.
    expect(
      counters.edits_blocked_by_operator +
        counters.edits_blocked_by_system +
        counters.edits_terminal_or_in_flight,
    ).toBe(counters.total_edits);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Convenience overload
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — convenience overload", () => {
  it("accepts raw snapshotUrls and builds the index internally", () => {
    const edits = [
      makeEdit({ id: "a", rec_id: "rec-a", target_url: "https://example.com/a" }),
    ];
    const perRowDecisions = deriveAll(
      edits,
      [],
      ["https://example.com/a"],
      [null],
    );
    const counters = computeFunnelCounters({
      edits,
      responses: [],
      snapshotUrls: ["https://example.com/a"],
      perRowDecisions,
      lifecycleResults: [null],
    });
    expect(counters.urls_with_snapshot_coverage).toBe(1);
    expect(counters.unique_target_urls).toBe(1);
  });

  it("raw overload matches the snapshotIndex overload on identical inputs", () => {
    const edits = [
      makeEdit({ id: "a", rec_id: "rec-a", target_url: "https://example.com/a" }),
      makeEdit({ id: "b", rec_id: "rec-b", target_url: "https://example.com/" }),
    ];
    const snapshotUrls = ["https://example.com/a", "https://example.com"];
    const perRowDecisions = deriveAll(edits, [], snapshotUrls, [null, null]);

    const viaRaw = computeFunnelCounters({
      edits,
      responses: [],
      snapshotUrls,
      perRowDecisions,
      lifecycleResults: [null, null],
    });
    const viaIndex = computeFunnelCounters({
      edits,
      responses: [],
      snapshotIndex: buildSnapshotUrlIndex(snapshotUrls),
      perRowDecisions,
      lifecycleResults: [null, null],
    });
    expect(viaRaw).toEqual(viaIndex);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Reconciliation sweep — pins the 5 documented invariants
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — reconciliation invariants", () => {
  /**
   * Ritz-shaped fixture: 28 edits, mix of operator-blocked +
   * system-blocked + 1 cited. Used to exercise every counter at once
   * against the documented reconciliation rules.
   */
  function ritzShapedFixture(): {
    edits: ReadonlyArray<RecommendedEditRow>;
    responses: ReadonlyArray<RecommendationResponse>;
    snapshotUrls: ReadonlyArray<string>;
    lifecycleResults: ReadonlyArray<LifecycleForEdit | null>;
  } {
    const edits: RecommendedEditRow[] = [];
    const lifecycleResults: Array<LifecycleForEdit | null> = [];

    // 20 awaiting_operator_acceptance (operator-blocked)
    for (let i = 0; i < 20; i++) {
      edits.push(
        makeEdit({
          id: `op-${i}`,
          rec_id: `rec-op-${i}`,
          implementation_status: "recommended",
          target_url: `https://example.com/op/${i}`,
        }),
      );
      lifecycleResults.push(null);
    }
    // 7 dismissed_at_edit_level (operator-blocked)
    for (let i = 0; i < 7; i++) {
      edits.push(
        makeEdit({
          id: `dis-${i}`,
          rec_id: `rec-dis-${i}`,
          implementation_status: "dismissed",
          target_url: `https://example.com/dis/${i}`,
          not_found_reason: "invalid_placeholder_pre_w3",
        }),
      );
      lifecycleResults.push(null);
    }
    // 1 cited_eligible (terminal)
    edits.push(
      makeEdit({
        id: "cited-1",
        rec_id: "rec-cited-1",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
        target_url: "https://example.com/cited/1",
        live_match_kind: "exact",
      }),
    );
    lifecycleResults.push(
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
    );

    const responses: RecommendationResponse[] = [
      makeResponse("rec-cited-1", "accepted"),
    ];

    const snapshotUrls = [
      ...edits
        .map((e) => e.target_url)
        .filter(
          (u): u is string =>
            u != null && u !== "" && u !== "needs_new_page",
        ),
    ];

    return { edits, responses, snapshotUrls, lifecycleResults };
  }

  it("INV-1: total_edits === count(edits)", () => {
    const fixture = ritzShapedFixture();
    const { counters } = runComputed(fixture);
    expect(counters.total_edits).toBe(fixture.edits.length);
    expect(counters.total_edits).toBe(28);
  });

  it("INV-2: edits_blocked_by_operator + edits_blocked_by_system + edits_terminal_or_in_flight === total_edits", () => {
    const fixture = ritzShapedFixture();
    const { counters } = runComputed(fixture);
    expect(
      counters.edits_blocked_by_operator +
        counters.edits_blocked_by_system +
        counters.edits_terminal_or_in_flight,
    ).toBe(counters.total_edits);
  });

  it("INV-3: edits_threshold_eligible ≤ edits_cited_post_ship ≤ edits_with_live_at", () => {
    const fixture = ritzShapedFixture();
    const { counters } = runComputed(fixture);
    expect(counters.edits_threshold_eligible).toBeLessThanOrEqual(
      counters.edits_cited_post_ship,
    );
    expect(counters.edits_cited_post_ship).toBeLessThanOrEqual(
      counters.edits_with_live_at,
    );
  });

  it("INV-4: unique_target_urls equals count of distinct non-sentinel/non-null target_url values", () => {
    const fixture = ritzShapedFixture();
    const { counters } = runComputed(fixture);
    // 20 op + 7 dismissed + 1 cited URLs = 28 distinct, none sentinel/null/empty
    expect(counters.unique_target_urls).toBe(28);
  });

  it("INV-5: urls_with_snapshot_coverage + urls_without_snapshot_coverage === unique_target_urls", () => {
    const fixture = ritzShapedFixture();
    const { counters } = runComputed(fixture);
    expect(
      counters.urls_with_snapshot_coverage +
        counters.urls_without_snapshot_coverage,
    ).toBe(counters.unique_target_urls);
  });

  it("INV-5b: urls_with_canonicalization_mismatch ≤ urls_without_snapshot_coverage", () => {
    // Mismatch is a sub-set of "no exact match" — never exceeds it.
    const edits = [
      makeEdit({ id: "a", rec_id: "rec-a", target_url: "https://example.com/" }),
      makeEdit({ id: "b", rec_id: "rec-b", target_url: "https://example.com/b" }),
    ];
    const { counters } = runComputed({
      edits,
      snapshotUrls: ["https://example.com"],
    });
    expect(counters.urls_with_canonicalization_mismatch).toBeLessThanOrEqual(
      counters.urls_without_snapshot_coverage,
    );
  });

  it("INV-6: every counter is non-negative", () => {
    const fixture = ritzShapedFixture();
    const { counters } = runComputed(fixture);
    for (const [, v] of Object.entries(counters)) {
      if (typeof v === "number") {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sanity: Ritz-shaped scenario produces the locked "1 of 28" story
// ─────────────────────────────────────────────────────────────────────

describe("computeFunnelCounters — Ritz-shaped end-to-end story", () => {
  it("20 awaiting + 7 dismissed + 1 cited produces operator-readable funnel", () => {
    const edits: RecommendedEditRow[] = [];
    const lifecycles: Array<LifecycleForEdit | null> = [];

    for (let i = 0; i < 20; i++) {
      edits.push(
        makeEdit({
          id: `op-${i}`,
          rec_id: `rec-op-${i}`,
          implementation_status: "recommended",
          target_url: `https://example.com/op/${i}`,
        }),
      );
      lifecycles.push(null);
    }
    for (let i = 0; i < 7; i++) {
      edits.push(
        makeEdit({
          id: `dis-${i}`,
          rec_id: `rec-dis-${i}`,
          implementation_status: "dismissed",
          target_url: `https://example.com/dis/${i}`,
          not_found_reason: "invalid_placeholder_pre_w3",
        }),
      );
      lifecycles.push(null);
    }
    edits.push(
      makeEdit({
        id: "cited-1",
        rec_id: "rec-cited-1",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
        target_url: "https://example.com/cited/1",
        live_match_kind: "exact",
      }),
    );
    lifecycles.push(
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
    );

    const responses: RecommendationResponse[] = [
      makeResponse("rec-cited-1", "accepted"),
    ];
    const snapshotUrls = edits
      .map((e) => e.target_url)
      .filter((u): u is string => u != null && u !== "");

    const { counters } = runComputed({
      edits,
      responses,
      snapshotUrls,
      lifecycleResults: lifecycles,
    });

    expect(counters.total_edits).toBe(28);
    expect(counters.edits_recommended).toBe(20);
    expect(counters.edits_dismissed).toBe(7);
    expect(counters.edits_with_live_at).toBe(1);
    expect(counters.edits_verified_live).toBe(1);
    expect(counters.edits_cited_post_ship).toBe(1);
    expect(counters.edits_threshold_eligible).toBe(1);

    // 20 awaiting_operator_acceptance = operator-blocked (not yet acted)
    expect(counters.edits_blocked_by_operator).toBe(20);
    // 0 system-blocked in this fixture
    expect(counters.edits_blocked_by_system).toBe(0);
    // 7 dismissed_at_edit_level + 1 cited_eligible = 8 terminal/in-flight
    // (dismissed = operator HAS acted; terminal decision)
    expect(counters.edits_terminal_or_in_flight).toBe(8);
    // Reconciliation sanity check.
    expect(
      counters.edits_blocked_by_operator +
        counters.edits_blocked_by_system +
        counters.edits_terminal_or_in_flight,
    ).toBe(counters.total_edits);

    // Threshold gate not crossed
    expect(counters.threshold_source).toBe("profound_default");

    // Only 1 rec accepted; 0 dismissed/deferred at the rec level
    // (the 7 edit-level dismissals don't have parent responses in this fixture)
    expect(counters.responses_total).toBe(1);
    expect(counters.responses_accepted).toBe(1);
    expect(counters.edits_in_accepted_lineage).toBe(1);
  });
});
