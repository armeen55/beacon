/**
 * 2026-05-20 — Slice 4.5.D.α₁b — promotion writer integration tests.
 *
 * Pinned coverage:
 *   • empty input → 0 promoted, no persistence calls
 *   • dryRun: true (default) + eligible → mapped rows returned, NO persistence
 *   • dryRun: false + eligible → BOTH persistence helpers called
 *   • diagnostic-only candidate → 0 promoted
 *   • low-confidence customer-queue-ready → 0 promoted
 *   • cap (6 same-URL) → 5 eligible promoted; capped row skipped
 *   • safety-flag candidate → 0 promoted
 *   • idempotency: same input × 2 → same mapped row ids
 *   • local persistence throw → propagates; sync NOT called
 *   • sync throw → sync_warning populated; local rows persisted
 *   • mixed-batch count math
 *   • mapped_rows returned even when dryRun: false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

// ---------------------------------------------------------------------------
// Module mocks — vi.hoisted() lets the factories close over mutable state
// that the test bodies can mutate via these hoisted handles.
//
// Spy types use the explicit `Mock<TFunc>` parameterization (NOT
// `ReturnType<typeof vi.fn>`) because the un-parameterized form
// widens to `Mock<Procedure | Constructable>` which TS won't let us
// call without `new`. The parameterized form pins the call signature
// + keeps `.mockClear()` / `.mock.calls` accessible.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  triggerCandidates: [] as unknown[],
  diagnosticOnly: [] as unknown[],
  recommendedEdits: [] as unknown[],
  recommendationResponses: [] as unknown[],
  persistSpy: undefined as undefined | Mock<(rows: unknown) => void>,
  syncSpy: undefined as
    | undefined
    | Mock<(rows: unknown, tenantId: unknown) => void>,
  logWarnSpy: undefined as undefined | Mock<(...args: unknown[]) => void>,
  persistThrows: false,
  syncThrows: false,
}));
mockState.persistSpy = vi.fn();
mockState.syncSpy = vi.fn();
mockState.logWarnSpy = vi.fn();

vi.mock(
  "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant",
  () => ({
    loadTriggerCandidatesForTenant: vi.fn(async () => ({
      status: "ok" as const,
      candidates: mockState.triggerCandidates,
      diagnostic_only: mockState.diagnosticOnly,
      meta: {
        tenant_id: "tenant-x",
        snapshot_count: 1,
        predicates_run: 15,
        candidate_count: mockState.triggerCandidates.length,
        diagnostic_only_count: mockState.diagnosticOnly.length,
      },
    })),
  }),
);

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (_tenantId: string) => ({
      getPageSnapshots: async (): Promise<PageSnapshot[]> => [],
      getRecommendedEdits: async () => mockState.recommendedEdits,
    }),
  }),
}));

vi.mock("@/domains/product/recommendation-response-store", () => ({
  getRecommendationResponses: async () => mockState.recommendationResponses,
}));

vi.mock("@/lib/business-config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/business-config")>(
    "@/lib/business-config",
  );
  return {
    ...actual,
    getBusinessConfig: () => ({
      name: "Test",
      domain: "test.com",
      industry: "home-builder",
      phone: "",
      address: "",
      yelpBusinessId: "",
      houzzProfileUrl: "",
      angiProfileUrl: "",
      bbbProfileUrl: "",
      industryDirectoryProfileUrl: "",
      locations: ["Palo Alto"],
      services: ["custom home"],
      primaryCompetitors: [],
      keyPages: [],
      locationTerms: [],
      serviceTerms: [],
      directoryDomains: [],
      scanSettings: {
        preferredHour: 7,
        timezone: "UTC",
        scope: "priority" as const,
        enabled: true,
      },
      urlPatterns: {
        city: "/locations/",
        service: "/services/",
        project: "/explore-projects/",
      },
    }),
  };
});

vi.mock("@/domains/recommendations/recommended-edits-persistence", () => ({
  persistRecommendedEditsLocal: async (rows: unknown) => {
    if (mockState.persistThrows) throw new Error("local write failed");
    mockState.persistSpy!(rows);
  },
  // audit #3 follow-up (2026-06-14): the writer now filters via the
  // forward-only guard before persist+sync. These tests have no existing
  // accepted/locked rows, so a pass-through (return all incoming) preserves
  // their behavior. The guard's own logic is covered by
  // forward-only-lifecycle.test.ts.
  dropLifecycleLockedRewrites: <T,>(incoming: T) => incoming,
}));

vi.mock("@/lib/persistence/dual-write", () => ({
  syncRecommendedEdits: async (rows: unknown, tenantId: unknown) => {
    if (mockState.syncThrows) throw new Error("supabase upsert failed");
    mockState.syncSpy!(rows, tenantId);
  },
}));

vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: (...args: unknown[]) => mockState.logWarnSpy!(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import writer AFTER mocks
// ---------------------------------------------------------------------------

import { promoteEligibleCandidates } from "@/domains/recommendation-intelligence/promotion-writer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-05-20T00:00:00.000Z");
const TENANT = "tenant-x";

function makeCandidate(
  partial: Partial<RecommendationCandidateRow> & {
    trigger_signal: string;
    action_type: RecommendationCandidateRow["action_type"];
    target_url: string;
  },
): RecommendationCandidateRow {
  return {
    tenant_id: TENANT,
    generator_kind: "deterministic",
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

beforeEach(() => {
  mockState.triggerCandidates = [];
  mockState.diagnosticOnly = [];
  mockState.recommendedEdits = [];
  mockState.recommendationResponses = [];
  mockState.persistSpy!.mockClear();
  mockState.syncSpy!.mockClear();
  mockState.logWarnSpy!.mockClear();
  mockState.persistThrows = false;
  mockState.syncThrows = false;
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe("promoteEligibleCandidates — empty input", () => {
  it("returns 0 promoted + no persistence calls", async () => {
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(result.dryRun).toBe(false);
    expect(result.candidate_count).toBe(0);
    expect(result.eligible_count).toBe(0);
    expect(result.promoted_count).toBe(0);
    expect(result.mapped_rows).toEqual([]);
    expect(result.sync_warning).toBeNull();
    expect(mockState.persistSpy!).not.toHaveBeenCalled();
    expect(mockState.syncSpy!).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dryRun default = true
// ---------------------------------------------------------------------------

describe("promoteEligibleCandidates — dryRun default + behavior", () => {
  it("(default-safe) dryRun is true when not passed; persistence NOT called even with eligible candidate", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      now: NOW, // no dryRun param → defaults to true
    });
    expect(result.dryRun).toBe(true);
    expect(result.mapped_rows.length).toBe(1);
    expect(result.promoted_count).toBe(1);
    expect(mockState.persistSpy!).not.toHaveBeenCalled();
    expect(mockState.syncSpy!).not.toHaveBeenCalled();
  });

  it("dryRun true (explicit) + eligible candidate → mapped row returned; persistence NOT called", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_meta",
        action_type: "edit_meta",
        target_url: "https://example.com/services/custom-homes",
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: true,
      now: NOW,
    });
    expect(result.dryRun).toBe(true);
    expect(result.mapped_rows.length).toBe(1);
    expect(mockState.persistSpy!).not.toHaveBeenCalled();
    expect(mockState.syncSpy!).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dryRun false — happy path
// ---------------------------------------------------------------------------

describe("promoteEligibleCandidates — live write (dryRun: false)", () => {
  it("eligible candidate → BOTH persistRecommendedEditsLocal AND syncRecommendedEdits called", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(result.dryRun).toBe(false);
    expect(result.promoted_count).toBe(1);
    expect(mockState.persistSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.syncSpy!).toHaveBeenCalledTimes(1);
    // Both spies receive the same mapped_rows array.
    const persistArg = mockState.persistSpy!.mock.calls[0]![0] as Array<{
      id: string;
    }>;
    const syncArg = mockState.syncSpy!.mock.calls[0]![0] as Array<{ id: string }>;
    const syncTenant = mockState.syncSpy!.mock.calls[0]![1] as string;
    expect(persistArg).toHaveLength(1);
    expect(syncArg).toHaveLength(1);
    expect(syncTenant).toBe(TENANT);
    expect(persistArg[0]!.id).toBe(syncArg[0]!.id);
  });

  it("mapped_rows returned even when dryRun: false (caller visibility)", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(result.mapped_rows.length).toBe(1);
    expect(result.mapped_rows[0]!.source).toBe("deterministic_promotion");
  });
});

// ---------------------------------------------------------------------------
// Suppression / banned-promotion guarantees
// ---------------------------------------------------------------------------

describe("promoteEligibleCandidates — suppression guarantees", () => {
  it("diagnostic-only candidate (missing_schema) → 0 promoted; persistence NOT called", async () => {
    mockState.diagnosticOnly = [
      makeCandidate({
        trigger_signal: "missing_schema",
        action_type: "add_schema",
        target_url: "https://example.com/services/custom-homes",
        confidence: "low",
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(result.promoted_count).toBe(0);
    expect(result.mapped_rows).toEqual([]);
    expect(mockState.persistSpy!).not.toHaveBeenCalled();
    expect(mockState.syncSpy!).not.toHaveBeenCalled();
  });

  it("low-confidence customer-queue-ready candidate → 0 promoted", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
        confidence: "low",
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(result.promoted_count).toBe(0);
    expect(mockState.persistSpy!).not.toHaveBeenCalled();
  });

  it("safety-flag candidate → 0 promoted", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
        safety_flags: ["unsupported_claim_risk"],
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(result.promoted_count).toBe(0);
    expect(mockState.persistSpy!).not.toHaveBeenCalled();
  });

  it("6 same-URL candidates → 5 promoted, 1 capped row skipped", async () => {
    const url = "https://example.com/services/six-signals";
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "missing_meta",
        action_type: "edit_meta",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "missing_h1",
        action_type: "change_h1",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "sitemap_missing",
        action_type: "fix_sitemap",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "robots_blocks_googlebot",
        action_type: "fix_robots",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "bad_http_status",
        action_type: "fix_status_code",
        target_url: url,
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(result.promoted_count).toBe(5);
    expect(result.mapped_rows.length).toBe(5);
    // 1 capped row was NOT mapped (selectPromotableCandidates flipped it
    // to eligible: false with max_rows_per_page).
    expect(mockState.persistSpy!).toHaveBeenCalledWith(expect.arrayContaining([]));
    expect(mockState.persistSpy!.mock.calls[0]![0]).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("promoteEligibleCandidates — idempotency", () => {
  it("same input × 2 → same mapped row ids (deterministic rec_id from α₁a)", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
      }),
    ];
    const a = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    const b = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(a.mapped_rows.length).toBe(1);
    expect(b.mapped_rows.length).toBe(1);
    expect(a.mapped_rows[0]!.id).toBe(b.mapped_rows[0]!.id);
    expect(a.mapped_rows[0]!.rec_id).toBe(b.mapped_rows[0]!.rec_id);
    // Both calls invoked persistence; upsert dedupe lives in the
    // helpers + unique index (not the writer).
    expect(mockState.persistSpy!).toHaveBeenCalledTimes(2);
    expect(mockState.syncSpy!).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("promoteEligibleCandidates — error handling", () => {
  it("persistRecommendedEditsLocal throws → writer propagates (fail loud); sync NOT called", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
      }),
    ];
    mockState.persistThrows = true;
    await expect(
      promoteEligibleCandidates({
        tenantId: TENANT,
        dryRun: false,
        now: NOW,
      }),
    ).rejects.toThrow("local write failed");
    expect(mockState.syncSpy!).not.toHaveBeenCalled();
  });

  it("syncRecommendedEdits throws → writer returns success with sync_warning; local rows persisted", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
      }),
    ];
    mockState.syncThrows = true;
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    expect(result.dryRun).toBe(false);
    expect(result.promoted_count).toBe(1);
    expect(result.sync_warning).toBe("supabase upsert failed");
    expect(mockState.persistSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.logWarnSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.logWarnSpy!.mock.calls[0]![0]).toContain(
      "[promoteEligibleCandidates] dual-write failed",
    );
  });
});

// ---------------------------------------------------------------------------
// Count math
// ---------------------------------------------------------------------------

describe("promoteEligibleCandidates — count math", () => {
  it("mixed batch (1 eligible + 1 diagnostic-only) → counts add up correctly", async () => {
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: "https://example.com/services/custom-homes",
      }),
    ];
    mockState.diagnosticOnly = [
      makeCandidate({
        trigger_signal: "missing_schema",
        action_type: "add_schema",
        target_url: "https://example.com/services/another",
        confidence: "low",
      }),
    ];
    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: false,
      now: NOW,
    });
    // candidate_count = main + diagnostic_only
    expect(result.candidate_count).toBe(2);
    // eligible_count = 1 (only the missing_title is eligible)
    expect(result.eligible_count).toBe(1);
    // promoted_count = 1 (mapper accepted the eligible row)
    expect(result.promoted_count).toBe(1);
    // skipped_count = eligible - promoted = 0
    expect(result.skipped_count).toBe(0);
    expect(result.mapped_rows.length).toBe(1);
  });
});
