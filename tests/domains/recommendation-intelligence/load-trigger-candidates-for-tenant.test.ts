/**
 * Slice 4.5.B.α₀ + α₁ + α₂ + α₂.1 + Slice 4.5.C.α₁ —
 * load-trigger-candidates-for-tenant unit tests.
 *
 * Slice 4.5.B.α₂.1 (2026-05-19): mock target swapped from the
 * file boundary `@/domains/pages/snapshot-store::getPageSnapshots`
 * to the repository pattern `@/lib/persistence/repositories::
 * getRepository().forTenant(tenantId).getPageSnapshots()`. The
 * loader now consumes the production-routed Supabase source
 * matching the customer Recommendations pipeline.
 *
 * Slice 4.5.C.α₁ (2026-05-20): the loader now pre-loads the
 * per-tenant indexability batch map via
 * `loadIndexabilityBatchForTenant`. This test mocks that helper
 * directly so the loader's wiring (per-snapshot indexability
 * predicate calls + `indexability_unavailable` soft-fail) can be
 * exercised without re-implementing the substrate-loading layer.
 * The batch helper has its own unit tests.
 *
 * Mocks `getRepository` + `getBusinessConfig()` +
 * `loadIndexabilityBatchForTenant` (the three loader boundaries)
 * and asserts the loader composes the 11 predicates correctly,
 * applies tenant filtering via `.forTenant()`, gates via
 * apply-queue-rules, dedupes, and soft-fails on each throw path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

const _getPageSnapshotsMock = vi.fn<() => Promise<PageSnapshot[] | unknown>>();
const _forTenantSpy = vi.fn<(tenantId: string) => unknown>();
const _getBusinessConfigMock = vi.fn<() => BusinessConfig>();
const _loadIndexabilityBatchMock = vi.fn<
  () => Promise<Map<string, OwnedUrlIndexability>>
>();

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

// Slice 4.5.C.α₁ — mock the batch indexability helper so the
// loader test stays decoupled from the substrate-loading layer.
// The helper's own unit tests cover its substrate-reading
// behavior end-to-end.
vi.mock("@/domains/indexability/batch-load-indexability", () => ({
  loadIndexabilityBatchForTenant: async () => _loadIndexabilityBatchMock(),
}));

/** Build a `OwnedUrlIndexability` shape for fixture seeding. */
function makeIndexability(
  url: string,
  verdict: IndexabilityVerdict,
  overrides: Partial<OwnedUrlIndexability> = {},
): OwnedUrlIndexability {
  return {
    url,
    composite_verdict: verdict,
    signals: {
      sitemap_membership: {
        in_sitemap: verdict === "not_in_sitemap" ? false : true,
        sitemap_url: null,
      },
      robots_txt: {
        googlebot_allowed:
          verdict === "blocked_by_robots_for_googlebot" ? false : true,
        gptbot_allowed: true,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: true,
      },
      page_snapshot: {
        http_status:
          verdict === "bad_status_code"
            ? 404
            : verdict === "unknown"
              ? null
              : 200,
        canonical_url:
          verdict === "canonical_elsewhere"
            ? "https://example.com/other"
            : null,
        has_canonical_mismatch: verdict === "canonical_elsewhere",
        robots_meta: null,
        noindex_detected: false,
        fetched_at: "2026-05-20T00:00:00Z",
        extraction_certainty: "confirmed",
      },
      gsc: null,
    },
    last_computed_at: "2026-05-20T00:00:00Z",
    evidence_freshness_days: 0,
    ...overrides,
  };
}

/** Build an indexability batch map keyed by canonicalized URL
 *  from a list of `(url, verdict)` pairs. */
function buildIndexabilityMap(
  entries: Array<[string, IndexabilityVerdict]>,
): Map<string, OwnedUrlIndexability> {
  const map = new Map<string, OwnedUrlIndexability>();
  for (const [url, verdict] of entries) {
    const canonical = canonicalizeCitationUrl(url);
    if (canonical == null) continue;
    map.set(canonical, makeIndexability(canonical, verdict));
  }
  return map;
}

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
  // Defensive: keep the demand-graph engine source (BEACON_DEMAND_GRAPH_RECS,
  // off by default) disabled so these predicate-pipeline isolation tests hold
  // even if the flag is set in the runner's env. The engine has its own coverage
  // (to-candidate-rows.test.ts).
  delete process.env.BEACON_DEMAND_GRAPH_RECS;
  _getPageSnapshotsMock.mockReset();
  _forTenantSpy.mockReset();
  _getBusinessConfigMock.mockReset();
  _getBusinessConfigMock.mockReturnValue(makeConfig());
  _loadIndexabilityBatchMock.mockReset();
  // Default: empty indexability map — none of the 4 Tier-1
  // predicates fire unless a test sets the mock explicitly.
  _loadIndexabilityBatchMock.mockResolvedValue(
    new Map<string, OwnedUrlIndexability>(),
  );
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
    expect(result.meta.predicates_run).toBe(37);
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

  it("(4.5.E.α₁a) loader invokes weak-h2; routes the emitted rewrite_h2 candidate to diagnostic_only (confidence: low)", async () => {
    // City detail page with a weak H2 (no location-term overlap).
    // Predicate emits at confidence: "low" → applyQueueRules routes
    // it to diagnostic_only, never to candidates.
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        locations: ["Palo Alto"],
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/locations/palo-alto",
        h1: "Palo Alto Custom Home",
        h2_list: ["Why Choose Us", "Our Process"],
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const inCandidates = result.candidates.filter(
      (r) => r.trigger_signal === "weak_h2",
    );
    const inDiagnostic = result.diagnostic_only.filter(
      (r) => r.trigger_signal === "weak_h2",
    );
    expect(inCandidates).toEqual([]);
    expect(inDiagnostic).toHaveLength(1);
    expect(inDiagnostic[0]!.action_type).toBe("rewrite_h2");
    expect(inDiagnostic[0]!.confidence).toBe("low");
    expect(inDiagnostic[0]!.generator_kind).toBe("llm_assisted");
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

  it("reports predicates_run=37 in meta on the ok path (P10 entity + author pack: +entity_link_gap, +author_byline_gap, +brand_presence_gap; P20: +spelling_demand_move; RANK-4: +ai_crawler_skip; RANK-5: +service_area_page; RANK-7: +link_gap)", async () => {
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a" }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.meta.predicates_run).toBe(37);
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
    // Night-shift #44 (2026-06-11): a second forTenant call loads the
    // sitemap reconciliation (stale-content lastmod map). BEACON 500 item 79
    // (2026-07-02): a third forTenant call loads the sov-weekly native-poll
    // observations inside loadSovWeeklyForTenant. R18 / N23 (2026-07-03): a
    // fourth forTenant call loads the internal-authority link graph
    // (getPageSnapshotLinkGraphs) inside buildInternalPageRankForTenant. All
    // calls must carry the explicit tenantId.
    expect(_forTenantSpy).toHaveBeenCalledTimes(4);
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

  // ── Slice 4.5.C.α₁ — Tier-1 indexability predicate wiring ─────────────

  it("(4.5.C.α₁) emits a sitemap_missing candidate when the batch map reports `not_in_sitemap`", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    _loadIndexabilityBatchMock.mockResolvedValue(
      buildIndexabilityMap([
        ["https://example.com/services/custom-homes", "not_in_sitemap"],
      ]),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("ok");
    const rows = result.candidates.filter(
      (r) => r.trigger_signal === "sitemap_missing",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("fix_sitemap");
  });

  it("(4.5.C.α₁) emits a robots_blocks_googlebot candidate when verdict is `blocked_by_robots_for_googlebot`", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    _loadIndexabilityBatchMock.mockResolvedValue(
      buildIndexabilityMap([
        [
          "https://example.com/services/custom-homes",
          "blocked_by_robots_for_googlebot",
        ],
      ]),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const rows = result.candidates.filter(
      (r) => r.trigger_signal === "robots_blocks_googlebot",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("fix_robots");
  });

  it("(4.5.C.α₁) emits a bad_http_status candidate when verdict is `bad_status_code`", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    _loadIndexabilityBatchMock.mockResolvedValue(
      buildIndexabilityMap([
        ["https://example.com/services/custom-homes", "bad_status_code"],
      ]),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const rows = result.candidates.filter(
      (r) => r.trigger_signal === "bad_http_status",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("fix_status_code");
  });

  it("(4.5.C.α₁) emits a canonical_mismatch candidate on a service page when verdict is `canonical_elsewhere`", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    _loadIndexabilityBatchMock.mockResolvedValue(
      buildIndexabilityMap([
        ["https://example.com/services/custom-homes", "canonical_elsewhere"],
      ]),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const rows = result.candidates.filter(
      (r) => r.trigger_signal === "canonical_mismatch",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("fix_canonical");
  });

  it("(4.5.C.α₁) soft-fails to status=indexability_unavailable when batch load throws; 7 α-family predicates STILL run", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
        title: null, // would fire missing_title
      }),
    ]);
    _loadIndexabilityBatchMock.mockRejectedValue(
      new Error("substrate read failed"),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("indexability_unavailable");
    // The 4 Tier-1 indexability predicates skip silently.
    const tier1Signals = new Set([
      "sitemap_missing",
      "robots_blocks_googlebot",
      "bad_http_status",
      "canonical_mismatch",
    ]);
    expect(
      result.candidates.filter((r) => tier1Signals.has(r.trigger_signal)),
    ).toEqual([]);
    // The α-family `missing_title` predicate STILL runs.
    const missingTitleRows = result.candidates.filter(
      (r) => r.trigger_signal === "missing_title",
    );
    expect(missingTitleRows).toHaveLength(1);
  });

  it("(4.5.C.α₁) Tier-1 predicates do NOT fire when the snapshot URL has no batch-map entry", async () => {
    // Indexability map keyed on a DIFFERENT URL — the
    // canonicalizer-keyed lookup misses, so the Tier-1
    // predicates skip silently. No status flip; this is the
    // "snapshot scanned but no indexability available" path.
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    _loadIndexabilityBatchMock.mockResolvedValue(
      buildIndexabilityMap([
        ["https://example.com/services/other-target", "not_in_sitemap"],
      ]),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("ok");
    const tier1Signals = new Set([
      "sitemap_missing",
      "robots_blocks_googlebot",
      "bad_http_status",
      "canonical_mismatch",
    ]);
    expect(
      result.candidates.filter((r) => tier1Signals.has(r.trigger_signal)),
    ).toEqual([]);
  });

  // ── Slice 4.5.C.α₂ — Tier-2 sensitive predicate wiring ────────────────

  it("(4.5.C.α₂) emits a `noindex_on_indexable_page` candidate routed to diagnostic_only (NOT candidates)", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    _loadIndexabilityBatchMock.mockResolvedValue(
      buildIndexabilityMap([
        ["https://example.com/services/custom-homes", "noindex_meta"],
      ]),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("ok");
    // Low-confidence row goes to diagnostic_only, NOT candidates.
    expect(
      result.candidates.filter(
        (r) => r.trigger_signal === "noindex_on_indexable_page",
      ),
    ).toEqual([]);
    const diag = result.diagnostic_only.filter(
      (r) => r.trigger_signal === "noindex_on_indexable_page",
    );
    expect(diag).toHaveLength(1);
    expect(diag[0]!.action_type).toBe("fix_noindex");
    expect(diag[0]!.confidence).toBe("low");
  });

  it("(4.5.C.α₂) emits a `robots_blocks_ai_bots` candidate routed to diagnostic_only", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    _loadIndexabilityBatchMock.mockResolvedValue(
      buildIndexabilityMap([
        ["https://example.com/services/custom-homes", "blocked_by_robots_for_ai"],
      ]),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("ok");
    expect(
      result.candidates.filter(
        (r) => r.trigger_signal === "robots_blocks_ai_bots",
      ),
    ).toEqual([]);
    const diag = result.diagnostic_only.filter(
      (r) => r.trigger_signal === "robots_blocks_ai_bots",
    );
    expect(diag).toHaveLength(1);
    expect(diag[0]!.action_type).toBe("fix_robots");
    expect(diag[0]!.confidence).toBe("low");
  });

  it("(4.5.C.α₂) Tier-2 predicates skip silently when batch load throws (indexability_unavailable covers them)", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    _loadIndexabilityBatchMock.mockRejectedValue(
      new Error("substrate read failed"),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.status).toBe("indexability_unavailable");
    const tier2Signals = new Set([
      "noindex_on_indexable_page",
      "robots_blocks_ai_bots",
    ]);
    expect(
      result.candidates.filter((r) => tier2Signals.has(r.trigger_signal)),
    ).toEqual([]);
    expect(
      result.diagnostic_only.filter((r) => tier2Signals.has(r.trigger_signal)),
    ).toEqual([]);
  });

  it("(4.5.C.α₂) meta.diagnostic_only_count reflects the diagnostic-only bucket size", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
    ]);
    // Mock both Tier-2 verdicts in sequence (different URLs would
    // emit both, but a single URL emits only one verdict due to
    // computeIndexability precedence). Use noindex_meta here.
    _loadIndexabilityBatchMock.mockResolvedValue(
      buildIndexabilityMap([
        ["https://example.com/services/custom-homes", "noindex_meta"],
      ]),
    );
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    expect(result.meta.diagnostic_only_count).toBe(
      result.diagnostic_only.length,
    );
    expect(result.meta.diagnostic_only_count).toBeGreaterThanOrEqual(1);
  });

  // ── Slice 4.5.C.α₃a — orphan-page cross-snapshot predicate wiring ─────

  it("(4.5.C.α₃a) emits an orphan_page candidate in MAIN candidates section (not diagnostic_only) for a service page with 0 inbound", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      // Homepage links elsewhere but NOT to the service page.
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/",
        internal_links: [
          { href: "/about-us", anchor_text: "About" },
          { href: "/locations/palo-alto", anchor_text: "Palo Alto" },
        ],
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/locations/palo-alto",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/about-us",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const orphanRows = result.candidates.filter(
      (r) => r.trigger_signal === "orphan_page",
    );
    // Service page has 0 inbound → orphan candidate present.
    expect(
      orphanRows.some(
        (r) => r.target_url === "https://example.com/services/custom-homes",
      ),
    ).toBe(true);
    // Confirm the row is medium-confidence and lives in main
    // candidates section (NOT diagnostic_only).
    const serviceRow = orphanRows.find(
      (r) => r.target_url === "https://example.com/services/custom-homes",
    )!;
    expect(serviceRow.confidence).toBe("medium");
    expect(serviceRow.action_type).toBe("add_internal_link");
    expect(
      result.diagnostic_only.some((r) => r.trigger_signal === "orphan_page"),
    ).toBe(false);
  });

  it("(4.5.C.α₃a) orphan_page runs ONCE across all snapshots (cross-snapshot aggregation, not per-snapshot)", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    // 3 snapshots, 2 with internal_links arrays. Net: snapshot
    // /a has 0 inbound (orphan), /b has 1 inbound (from /a),
    // /c has 1 inbound (from /a).
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/",
        internal_links: [
          { href: "/services/b-service", anchor_text: "B" },
          { href: "/locations/c-city", anchor_text: "C" },
        ],
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/b-service",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/locations/c-city",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const orphanRows = result.candidates.filter(
      (r) => r.trigger_signal === "orphan_page",
    );
    // The homepage has 0 inbound; service + city have 1 inbound
    // each. The aggregation MUST run once and respect global
    // counts — running per-snapshot would re-aggregate each
    // pass and produce wrong counts. Homepage is on the allow-
    // list → 1 orphan candidate for the homepage.
    expect(orphanRows.map((r) => r.target_url).sort()).toEqual([
      "https://example.com/",
    ]);
  });

  it("(4.5.C.α₃a) global emptiness guard — when NO snapshot has internal_links, orphan_page emits ZERO candidates", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    // 4 snapshots, none with internal_links populated.
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({ tenant_id: "tenant-a", url: "https://example.com/" }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/locations/palo-alto",
      }),
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/projects/atherton-modern",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const orphanRows = [
      ...result.candidates.filter((r) => r.trigger_signal === "orphan_page"),
      ...result.diagnostic_only.filter(
        (r) => r.trigger_signal === "orphan_page",
      ),
    ];
    expect(orphanRows).toEqual([]);
  });

  // ── Slice 4.5.C.α₃b — missing-schema predicate wiring ─────────────────

  it("(4.5.C.α₃b) emits missing_schema candidate routed to diagnostic_only (NOT main candidates) for a service page with empty schema_types", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
        // Default makeSnapshot doesn't set schema_types; loader-test
        // fixture's default IS already [] (verified). Explicit
        // empty here for documentation clarity.
        schema_types: [],
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    // Main candidates section: NO missing_schema row.
    expect(
      result.candidates.filter((r) => r.trigger_signal === "missing_schema"),
    ).toEqual([]);
    // Diagnostic-only bucket: exactly 1 missing_schema row.
    const diag = result.diagnostic_only.filter(
      (r) => r.trigger_signal === "missing_schema",
    );
    expect(diag).toHaveLength(1);
    expect(diag[0]!.action_type).toBe("add_schema");
    expect(diag[0]!.confidence).toBe("low");
    expect(diag[0]!.impact_estimate).toBe("medium");
  });

  it("(4.5.C.α₃b) missing_schema does NOT fire when extraction_certainty is `uncertain`", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
        schema_types: [],
        extraction_certainty: "uncertain",
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const allMissingSchema = [
      ...result.candidates.filter((r) => r.trigger_signal === "missing_schema"),
      ...result.diagnostic_only.filter(
        (r) => r.trigger_signal === "missing_schema",
      ),
    ];
    expect(allMissingSchema).toEqual([]);
  });

  // ── P10 — entity + author (E-E-A-T) pack wiring ───────────────────────

  it("(P10) emits a brand_presence_gap add_schema candidate for a homepage with no Organization schema", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({ name: "Acme", domain: "example.com" }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/",
        schema_types: [],
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({ tenantId: "tenant-a" });
    const brand = result.candidates.filter(
      (r) => r.trigger_signal === "brand_presence_gap",
    );
    expect(brand).toHaveLength(1);
    expect(brand[0]!.action_type).toBe("add_schema");
    expect(brand[0]!.target_url).toBe("https://example.com/");
    expect(brand[0]!.confidence).toBe("medium");
  });

  it("(P10) brand_presence_gap SELF-HIDES when the homepage carries Organization schema with a linked profile", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({ name: "Acme", domain: "example.com" }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/",
        schema_types: ["Organization"],
        schema_entity_names: ["Acme", "https://twitter.com/acme"],
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({ tenantId: "tenant-a" });
    expect(
      result.candidates.filter((r) => r.trigger_signal === "brand_presence_gap"),
    ).toEqual([]);
  });

  it("(P10) emits an author_byline_gap directive for a guide-shaped content page with no author", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({ name: "Acme", domain: "example.com", contentSiteMode: true }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/how-nowruz-is-celebrated",
        title: "How Nowruz Is Celebrated",
        h1: "How Nowruz Is Celebrated",
        body_paragraph_sample: [
          "Nowruz is the Persian new year celebrated across many countries for centuries.",
        ],
        schema_types: [],
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({ tenantId: "tenant-a" });
    const author = result.candidates.filter(
      (r) => r.trigger_signal === "author_byline_gap",
    );
    expect(author).toHaveLength(1);
    expect(author[0]!.action_type).toBe("add_answer_block");
    expect(author[0]!.target_url).toBe(
      "https://example.com/how-nowruz-is-celebrated",
    );
  });

  it("(P10) author_byline_gap does NOT fire when the page already carries Person schema", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({ name: "Acme", domain: "example.com", contentSiteMode: true }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/how-nowruz-is-celebrated",
        title: "How Nowruz Is Celebrated",
        h1: "How Nowruz Is Celebrated",
        schema_types: ["Article", "Person"],
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({ tenantId: "tenant-a" });
    expect(
      result.candidates.filter((r) => r.trigger_signal === "author_byline_gap"),
    ).toEqual([]);
  });

  it("(4.5.C.α₃b) missing_schema does NOT fire when all required types are present", async () => {
    _getBusinessConfigMock.mockReturnValue(
      makeConfig({
        urlPatterns: { city: "/locations/", service: "/services/" },
      }),
    );
    _getPageSnapshotsMock.mockResolvedValue([
      makeSnapshot({
        tenant_id: "tenant-a",
        url: "https://example.com/services/custom-homes",
        // service_page required: FAQPage + BreadcrumbList + [Service|Offer]
        schema_types: ["FAQPage", "BreadcrumbList", "Service"],
      }),
    ]);
    const { loadTriggerCandidatesForTenant } = await import(
      "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
    );
    const result = await loadTriggerCandidatesForTenant({
      tenantId: "tenant-a",
    });
    const allMissingSchema = [
      ...result.candidates.filter((r) => r.trigger_signal === "missing_schema"),
      ...result.diagnostic_only.filter(
        (r) => r.trigger_signal === "missing_schema",
      ),
    ];
    expect(allMissingSchema).toEqual([]);
  });
});
