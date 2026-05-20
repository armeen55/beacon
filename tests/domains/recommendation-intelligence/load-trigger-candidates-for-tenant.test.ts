/**
 * Slice 4.5.B.α₀ + α₁ — load-trigger-candidates-for-tenant unit
 * tests.
 *
 * Mocks `getPageSnapshots()` + `getBusinessConfig()` (the two
 * loader boundaries) and asserts the loader composes the 5
 * predicates correctly, applies tenant filtering, gates via
 * apply-queue-rules, dedupes, and soft-fails on throw.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

const _getPageSnapshotsMock = vi.fn<() => Promise<PageSnapshot[] | unknown>>();
const _getBusinessConfigMock = vi.fn<() => BusinessConfig>();

vi.mock("@/domains/pages/snapshot-store", () => ({
  getPageSnapshots: () => _getPageSnapshotsMock(),
}));

vi.mock("@/lib/business-config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/business-config")>(
    "@/lib/business-config",
  );
  return {
    ...actual,
    getBusinessConfig: () => _getBusinessConfigMock(),
  };
});

function makeConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
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
    locations: [],
    services: [],
    primaryCompetitors: [],
    keyPages: [],
    locationTerms: [],
    serviceTerms: [],
    directoryDomains: [],
    scanSettings: {
      preferredHour: 7,
      timezone: "UTC",
      scope: "priority",
      enabled: true,
    },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-x",
    page_id: "page-x",
    url: "https://example.com/x",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "Good title",
    meta_description: "Good meta",
    h1: "Good h1",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 100,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "y",
    faq_hash: "z",
    schema_hash: "w",
    tenant_id: "tenant-a",
    ...overrides,
  };
}

beforeEach(() => {
  _getPageSnapshotsMock.mockReset();
  _getBusinessConfigMock.mockReset();
  _getBusinessConfigMock.mockReturnValue(makeConfig());
});

describe("loadTriggerCandidatesForTenant", () => {
  it("returns status=ok with empty candidates when no snapshots match the tenant", async () => {
    _getPageSnapshotsMock.mockResolvedValue([]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("ok");
    expect(result.candidates).toEqual([]);
    expect(result.diagnostic_only).toEqual([]);
    expect(result.meta.snapshot_count).toBe(0);
    expect(result.meta.predicates_run).toBe(5);
  });

  it("filters snapshots by tenant_id", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a", url: "https://a.example.com/" }),
      makeSnapshot({ tenant_id: "tenant-b", url: "https://b.example.com/" }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("ok");
    expect(result.meta.snapshot_count).toBe(1);
    expect(result.candidates).toEqual([]); // no missing fields → no candidates
  });

  it("emits a missing_title candidate when title is null", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a", title: null }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.trigger_signal).toBe("missing_title");
  });

  it("emits a missing_meta candidate when meta is null", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a", meta_description: null }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.trigger_signal).toBe("missing_meta");
  });

  it("emits BOTH a missing_title and a missing_meta candidate when both fields are null", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        title: null,
        meta_description: null,
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.candidates).toHaveLength(2);
    const signals = result.candidates.map((c) => c.trigger_signal).sort();
    expect(signals).toEqual(["missing_meta", "missing_title"]);
  });

  it("dedupes candidates with the same dedupe_key across snapshots", async () => {
    // Two snapshots with the same URL produce identical dedupe_keys
    // for the same trigger signal — second is dropped.
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        title: null,
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        title: null,
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.candidates).toHaveLength(1);
  });

  it("soft-fails to status=snapshots_unavailable when the store throws", async () => {
    _getPageSnapshotsMock.mockRejectedValue(new Error("disk read failed"));
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("snapshots_unavailable");
    expect(result.candidates).toEqual([]);
    expect(result.diagnostic_only).toEqual([]);
    expect(result.meta.snapshot_count).toBe(0);
  });

  it("soft-fails when the store returns a non-array", async () => {
    _getPageSnapshotsMock.mockResolvedValue(null as unknown as PageSnapshot[]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("ok");
    expect(result.meta.snapshot_count).toBe(0);
  });

  // ── α₁ extensions ────────────────────────────────────────────────────

  it("emits a missing_h1 candidate when h1 is null", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a", h1: null }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.trigger_signal).toBe("missing_h1");
    expect(result.candidates[0]!.action_type).toBe("change_h1");
  });

  it("emits a weak_h1 candidate on a city page when h1 lacks any location term", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        locations: ["Palo Alto", "Menlo Park"],
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/locations/palo-alto",
        h1: "Welcome to Excellence",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const weakH1Rows = result.candidates.filter(
      (r) => r.trigger_signal === "weak_h1",
    );
    expect(weakH1Rows).toHaveLength(1);
    expect(weakH1Rows[0]!.confidence).toBe("medium");
  });

  it("emits PAIRED edit_title + change_h1 candidates when title and h1 mismatch (Jaccard < 0.3)", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/x",
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const pairedRows = result.candidates.filter(
      (r) => r.trigger_signal === "title_h1_mismatch",
    );
    expect(pairedRows).toHaveLength(2);
    const actionTypes = pairedRows.map((r) => r.action_type).sort();
    expect(actionTypes).toEqual(["change_h1", "edit_title"]);
  });

  it("soft-fails to status=config_unavailable when getBusinessConfig throws", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a" }),
    ]);
    _getBusinessConfigMock.mockImplementation(() => {
      throw new Error("config resolution failed");
    });
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("config_unavailable");
    expect(result.candidates).toEqual([]);
    expect(result.diagnostic_only).toEqual([]);
    // snapshot_count is preserved (snapshots loaded successfully
    // before config resolution failed)
    expect(result.meta.snapshot_count).toBe(1);
  });

  it("reports predicates_run=5 in meta on the ok path", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a" }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.meta.predicates_run).toBe(5);
  });
});
