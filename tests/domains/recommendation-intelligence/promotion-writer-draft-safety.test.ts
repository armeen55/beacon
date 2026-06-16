/**
 * SAFETY #273 (2026-06-14) — deterministic-draft public-copy safety gate
 * at the promotion seam.
 *
 * The deterministic promotion pipeline (`enrichPromotionRow` →
 * `persistRecommendedEditsLocal` / `syncRecommendedEdits`) fills
 * customer-approvable `proposed_text` WITHOUT building an evidence packet,
 * so the authoritative `validateSpecificEdit` gate (packet-dependent) never
 * ran on it. `holdUnsafeDraft` (in promotion-writer.ts) now runs the
 * packet-light public-copy subset (`validateDeterministicDraftSafety`) at
 * the seam and ABSTAINS — reverting the draft to a safe "go look at this
 * page" card — when the copy would be unsafe to publish.
 *
 * Pinned coverage:
 *   • KNOWN-UNSAFE deterministic draft (leading self-claim superlative
 *     carried verbatim from the page's own h1 into proposed_text) is NOT
 *     surfaced as publishable: proposed_text + display_label are held back;
 *     the row survives in the queue; a breadcrumb is logged.
 *   • A VALID deterministic draft (clean h1) IS surfaced unchanged.
 *
 * Mirrors the mocking strategy of promotion-writer.test.ts; the only
 * difference is a rich snapshot so enrichment actually composes a draft.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

// ---------------------------------------------------------------------------
// Module mocks — same hoisted-state strategy as promotion-writer.test.ts.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  triggerCandidates: [] as unknown[],
  diagnosticOnly: [] as unknown[],
  recommendedEdits: [] as unknown[],
  recommendationResponses: [] as unknown[],
  pageSnapshots: [] as unknown[],
  persistSpy: undefined as undefined | Mock<(rows: unknown) => void>,
  syncSpy: undefined as
    | undefined
    | Mock<(rows: unknown, tenantId: unknown) => void>,
  logWarnSpy: undefined as undefined | Mock<(...args: unknown[]) => void>,
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
        tenant_id: "tenant-ritz-founder",
        snapshot_count: mockState.pageSnapshots.length,
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
      getPageSnapshots: async (): Promise<PageSnapshot[]> =>
        mockState.pageSnapshots as PageSnapshot[],
      getAllPageSnapshotsForGeneration: async (): Promise<PageSnapshot[]> =>
        mockState.pageSnapshots as PageSnapshot[],
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
    // Force a synchronous neutral config (no Supabase hydrate in test).
    hydrateBusinessConfigFromSupabase: async () => null,
    getBusinessConfig: () => ({
      name: "Test",
      domain: "example.com",
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
    mockState.persistSpy!(rows);
  },
  dropLifecycleLockedRewrites: <T,>(incoming: T) => incoming,
}));

vi.mock("@/lib/persistence/dual-write", () => ({
  syncRecommendedEdits: async (rows: unknown, tenantId: unknown) => {
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

const NOW = new Date("2026-06-14T00:00:00.000Z");
// Ritz tenant has a curated brand-name style + assertions, so brand gates
// are armed. The superlative gate is tenant-agnostic regardless.
const TENANT = "tenant-ritz-founder";
const TARGET_URL = "https://example.com/services/custom-homes";

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
    customer_copy: "Improve this page's title for search and AI.",
    operator_evidence: "missing/weak title",
    dedupe_key: "dk-1",
    cooldown_key: "ck-1",
    created_from_signal_at: "2026-06-13T00:00:00.000Z",
    safety_flags: [],
    ...partial,
  };
}

function makeSnapshot(h1: string | null): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: TARGET_URL,
    canonical_url: TARGET_URL,
    fetched_at: "2026-06-13T00:00:00.000Z",
    http_status: 200,
    title: null, // null title → missing_title trigger fires
    meta_description: "A description.",
    h1,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 5,
    external_link_count: 0,
    word_count: 500,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "h",
    faq_hash: "h",
    schema_hash: "h",
    tenant_id: TENANT,
  };
}

beforeEach(() => {
  mockState.triggerCandidates = [];
  mockState.diagnosticOnly = [];
  mockState.recommendedEdits = [];
  mockState.recommendationResponses = [];
  mockState.pageSnapshots = [];
  mockState.persistSpy!.mockClear();
  mockState.syncSpy!.mockClear();
  mockState.logWarnSpy!.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("promoteEligibleCandidates — deterministic draft safety (#273)", () => {
  it("UNSAFE draft (leading 'Best …' superlative from page h1) is held back: proposed_text/display_label nulled, row survives, breadcrumb logged", async () => {
    // composeTitle uses snap.h1 as the title base → proposed_text would be
    // "Best Custom Home Builders" which trips the leading-superlative gate.
    mockState.pageSnapshots = [makeSnapshot("Best Custom Home Builders")];
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: TARGET_URL,
      }),
    ];

    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: true,
      now: NOW,
    });

    // The row is still promoted (the operator still sees the page/issue) …
    expect(result.promoted_count).toBe(1);
    const row = result.mapped_rows[0]!;
    // … but the UNSAFE draft is abstained — never surfaced as publishable.
    expect(row.proposed_text).toBeNull();
    expect(row.display_label).toBeNull();
    expect(row.current_text).toBeNull();
    expect(row.expected_impact).toBeNull();
    expect(row.measurement_plan).toBeNull();
    // The why (operator copy) is untouched — only the draft is held.
    expect(row.why).toBe("Improve this page's title for search and AI.");

    // A breadcrumb is logged so the operator/dev can see what was held.
    const heldLog = mockState.logWarnSpy!.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("held unsafe deterministic draft"),
    );
    expect(heldLog).toBeDefined();
  });

  it("VALID draft (clean page h1) IS surfaced unchanged with a non-empty proposed_text", async () => {
    mockState.pageSnapshots = [makeSnapshot("Custom Home Builds in Palo Alto")];
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: TARGET_URL,
      }),
    ];

    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: true,
      now: NOW,
    });

    expect(result.promoted_count).toBe(1);
    const row = result.mapped_rows[0]!;
    // The deterministic draft survives — proposed_text + display_label set.
    expect(row.proposed_text).not.toBeNull();
    expect(row.proposed_text!.length).toBeGreaterThan(0);
    expect(row.proposed_text!.startsWith("Custom Home Builds")).toBe(true);
    expect(row.display_label).not.toBeNull();

    // No "held unsafe draft" breadcrumb for the valid path.
    const heldLog = mockState.logWarnSpy!.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("held unsafe deterministic draft"),
    );
    expect(heldLog).toBeUndefined();
  });

  it("gsc_decay::update_intro promotes WITH its grounded refresh directive and survives the safety seam (em dashes allowed for directives)", async () => {
    // The customer-queue-ready fading-page rec previously emitted a null
    // draft. It now carries a directive grounded in the real numbers; because
    // update_intro is a DIRECTIVE action type, its em dashes don't trip the
    // published-prose gate (pre-fix, this draft would have been held/nulled).
    mockState.pageSnapshots = [makeSnapshot("Custom Home Builds in Palo Alto")];
    mockState.triggerCandidates = [
      makeCandidate({
        trigger_signal: "gsc_decay",
        action_type: "update_intro",
        target_url: TARGET_URL,
        topic_cluster_label: "Fading page",
        operator_evidence:
          "signal=gsc_decay; clicks_prior=120; clicks_now=72; position_prior=4.2; position_now=8.9; impressions_now=3400",
      }),
    ];

    const result = await promoteEligibleCandidates({
      tenantId: TENANT,
      dryRun: true,
      now: NOW,
    });

    expect(result.promoted_count).toBe(1);
    const row = result.mapped_rows[0]!;
    expect(row.proposed_text).not.toBeNull();
    expect(row.proposed_text!).toContain("120");
    expect(row.proposed_text!).toContain("72");
    expect(row.proposed_text!).toContain("40%");
    expect(row.display_label).toContain("Refresh");

    // Not held — the directive survived the publish-prose gate.
    const heldLog = mockState.logWarnSpy!.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("held unsafe deterministic draft"),
    );
    expect(heldLog).toBeUndefined();
  });
});
