/**
 * Slice 4.5.B.α₀ — load-trigger-candidates-for-tenant unit tests.
 *
 * Mocks `getPageSnapshots()` (the file-backed boundary) and asserts
 * the loader composes predicates correctly, applies tenant filtering,
 * gates via apply-queue-rules, dedupes, and soft-fails on throw.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";

const _getPageSnapshotsMock = vi.fn<() => Promise<PageSnapshot[] | unknown>>();

vi.mock("@/domains/pages/snapshot-store", () => ({
  getPageSnapshots: () => _getPageSnapshotsMock(),
}));

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
    expect(result.meta.predicates_run).toBe(2);
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
});
