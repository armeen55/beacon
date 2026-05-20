/**
 * Slice 4.5.B.α₀ + α₁ + α₂ + α₂.1 — load-trigger-candidates-for-
 * tenant unit tests.
 *
 * Slice 4.5.B.α₂.1 (2026-05-19): mock target swapped from the
 * file boundary `@/domains/pages/snapshot-store::getPageSnapshots`
 * to the repository pattern `@/lib/persistence/repositories::
 * getRepository().forTenant(tenantId).getPageSnapshots()`. The
 * loader now consumes the production-routed Supabase source
 * matching the customer Recommendations pipeline.
 *
 * Mocks `getRepository` + `getBusinessConfig()` (the two loader
 * boundaries) and asserts the loader composes the 7 predicates
 * correctly, applies tenant filtering via `.forTenant()`, gates
 * via apply-queue-rules, dedupes, and soft-fails on throw.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

const _getPageSnapshotsMock = vi.fn<() => Promise<PageSnapshot[] | unknown>>();
const _forTenantSpy = vi.fn<(tenantId: string) => unknown>();
const _getBusinessConfigMock = vi.fn<() => BusinessConfig>();

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (tenantId: string) => {
      _forTenantSpy(tenantId);
      return {
        getPageSnapshots: async () => {
          // Mirror the production repository's `.forTenant()`
          // tenant-scoping: the underlying mock can return mixed-
          // tenant fixtures and this wrapper filters them so the
          // loader sees only the tenant-a slice (matching the
          // Supabase backend's `.eq("tenant_id", id)` behavior).
          const all = await _getPageSnapshotsMock();
          if (!Array.isArray(all)) return all;
          return (all as PageSnapshot[]).filter(
            (s) => s != null && s.tenant_id === tenantId,
          );
        },
      };
    },
  }),
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
  _forTenantSpy.mockReset();
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
    expect(result.meta.predicates_run).toBe(7);
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
    // for the same trigger signal — second is dropped. Use DISTINCT
    // meta values across the pair so α₂'s `duplicate-meta` doesn't
    // false-positive (the test's intent is missing-title dedupe by
    // URL, not cross-snapshot duplicates).
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        title: null,
        meta_description: "unique meta one",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        title: null,
        meta_description: "unique meta two",
      }),
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
    // α₂.2 requires the snapshot URL to classify as homepage /
    // city / service for title_h1_mismatch to fire. Use a city
    // detail URL here (matches the default mock-config
    // urlPatterns.city `/locations/`).
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/locations/palo-alto",
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

  it("reports predicates_run=7 in meta on the ok path (post-α₂)", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a" }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.meta.predicates_run).toBe(7);
  });

  // ── α₂ extensions ────────────────────────────────────────────────────

  it("emits duplicate_title candidates when 2+ tenant snapshots share a title", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        title: "Shared Title",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/b",
        title: "Shared Title",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const dupTitleRows = result.candidates.filter(
      (r) => r.trigger_signal === "duplicate_title",
    );
    expect(dupTitleRows).toHaveLength(1);
    expect(dupTitleRows[0]!.action_type).toBe("edit_title");
    expect(dupTitleRows[0]!.target_url).toBe("https://example.com/b");
  });

  it("emits duplicate_meta candidates when 2+ tenant snapshots share a meta", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        meta_description: "Shared meta description.",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/b",
        meta_description: "Shared meta description.",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const dupMetaRows = result.candidates.filter(
      (r) => r.trigger_signal === "duplicate_meta",
    );
    expect(dupMetaRows).toHaveLength(1);
    expect(dupMetaRows[0]!.action_type).toBe("edit_meta");
    expect(dupMetaRows[0]!.target_url).toBe("https://example.com/b");
  });

  it("cross-snapshot predicates aggregate ONCE across the full list (not per-snapshot)", async () => {
    // 3 snapshots, all sharing the same title.
    // Cross-snapshot predicate emits N-1 = 2 candidates total.
    // If wired per-snapshot, the predicate would re-aggregate
    // 3 times and emit duplicates that dedupe couldn't fully
    // collapse. Verify exactly 2 duplicate_title rows.
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        title: "Shared",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/b",
        title: "Shared",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/c",
        title: "Shared",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const dupTitleRows = result.candidates.filter(
      (r) => r.trigger_signal === "duplicate_title",
    );
    expect(dupTitleRows).toHaveLength(2);
  });

  it("null-title snapshots in a duplicate-shaped fixture do NOT false-positive duplicate_title", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        title: null,
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/b",
        title: null,
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const dupTitleRows = result.candidates.filter(
      (r) => r.trigger_signal === "duplicate_title",
    );
    expect(dupTitleRows).toEqual([]);
    // BUT missing_title fires on each null-title snapshot.
    const missingTitleRows = result.candidates.filter(
      (r) => r.trigger_signal === "missing_title",
    );
    expect(missingTitleRows).toHaveLength(2);
  });

  it("cross-tenant snapshots with same title do NOT cross-contaminate (loader filters first)", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://a.example.com/x",
        title: "Shared",
      }),
      makeSnapshot({
        tenant_id: "tenant-b",
        url: "https://b.example.com/x",
        title: "Shared",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const resultA = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    // Only 1 tenant-a snapshot in the list → no duplicate group.
    const dupRows = resultA.candidates.filter(
      (r) => r.trigger_signal === "duplicate_title",
    );
    expect(dupRows).toEqual([]);
  });

  it("(α₂.1) routes snapshot reads through getRepository().forTenant(tenantId)", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a" }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    await loadTriggerCandidatesForTenant({ tenantId: "tenant-a" });
    expect(_forTenantSpy).toHaveBeenCalledTimes(1);
    expect(_forTenantSpy).toHaveBeenCalledWith("tenant-a");
  });

  it("emits BOTH duplicate_title AND duplicate_meta when both fields are duplicated", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/a",
        title: "Shared Title",
        meta_description: "Shared Meta",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/b",
        title: "Shared Title",
        meta_description: "Shared Meta",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    // Filter to the duplicate signals only — α₁'s
    // `title-h1-mismatch` may also fire on this fixture (the
    // "Shared Title" tokens don't align with the default
    // "Good h1" tokens), but its emission isn't what this test
    // is verifying.
    const dupeSignals = result.candidates
      .map((r) => r.trigger_signal)
      .filter(
        (s) => s === "duplicate_title" || s === "duplicate_meta",
      )
      .sort();
    expect(dupeSignals).toEqual(["duplicate_meta", "duplicate_title"]);
  });

  // ── α₂.2 page-classifier end-to-end behavior ───────────────────────

  it("(α₂.2) `/llms.txt` snapshot produces ZERO candidates across all 7 predicates", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/llms.txt",
        title: null,
        meta_description: null,
        h1: null,
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.candidates).toEqual([]);
    expect(result.meta.snapshot_count).toBe(1); // snapshot present
  });

  it("(α₂.2) utility-page snapshot does NOT fire title_h1_mismatch", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/privacy-policy",
        // Mismatched title + h1 — would have fired pre-α₂.2.
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
    const mismatchRows = result.candidates.filter(
      (r) => r.trigger_signal === "title_h1_mismatch",
    );
    expect(mismatchRows).toEqual([]);
  });

  it("(α₂.2) city hub `/locations` does NOT fire weak_h1", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        locations: ["Palo Alto"],
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/locations",
        h1: "Our Locations Hub", // lacks "Palo Alto" — would have fired pre-α₂.2.
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
    expect(weakH1Rows).toEqual([]);
  });

  it("(α₂.2) project page does NOT fire title_h1_mismatch", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/projects/atherton-modern",
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
    const mismatchRows = result.candidates.filter(
      (r) => r.trigger_signal === "title_h1_mismatch",
    );
    expect(mismatchRows).toEqual([]);
  });

  it("(α₂.2) homepage with mismatched title + h1 STILL fires title_h1_mismatch (allowlist preserved)", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/",
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
    const mismatchRows = result.candidates.filter(
      (r) => r.trigger_signal === "title_h1_mismatch",
    );
    // Paired emission: edit_title + change_h1.
    expect(mismatchRows).toHaveLength(2);
  });
});
