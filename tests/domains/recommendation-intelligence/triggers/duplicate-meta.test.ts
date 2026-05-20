/**
 * Slice 4.5.B.α₂ — trigger predicate `duplicate-meta` unit tests.
 *
 * Cross-snapshot aggregation predicate. Symmetric shape to
 * `duplicate-title` over `meta_description`.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import { duplicateMeta } from "@/domains/recommendation-intelligence/triggers/duplicate-meta";

function makeSnapshot(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-x",
    page_id: "page-x",
    url: "https://example.com/x",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: null,
    meta_description: "Default meta description",
    h1: null,
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

describe("duplicateMeta predicate — group sizing", () => {
  it("emits zero candidates for an empty snapshot array", () => {
    expect(duplicateMeta({ tenantId: "tenant-a", snapshots: [] })).toEqual([]);
  });

  it("emits zero candidates for a single snapshot", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ meta_description: "A real meta description." }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("emits zero candidates when all metas are distinct", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "First meta.",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "Second meta.",
        }),
        makeSnapshot({
          url: "https://example.com/c",
          meta_description: "Third meta.",
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("emits ONE candidate when two snapshots share the same meta (group of 2)", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "Shared meta description.",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "Shared meta description.",
        }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.target_url).toBe("https://example.com/b");
    expect(out[0]!.trigger_signal).toBe("duplicate_meta");
    expect(out[0]!.action_type).toBe("edit_meta");
    expect(out[0]!.confidence).toBe("high");
  });

  it("emits TWO candidates when three snapshots share the same meta (group of 3)", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/c",
          meta_description: "Shared meta.",
        }),
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "Shared meta.",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "Shared meta.",
        }),
      ],
    });
    expect(out).toHaveLength(2);
    const targets = out.map((r) => r.target_url).sort();
    expect(targets).toEqual([
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });
});

describe("duplicateMeta predicate — normalization", () => {
  it("collapses internal whitespace when grouping", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "Welcome  to  Beacon",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "Welcome to Beacon",
        }),
      ],
    });
    expect(out).toHaveLength(1);
  });

  it("case-folds when grouping", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "Welcome to Beacon",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "WELCOME TO BEACON",
        }),
      ],
    });
    expect(out).toHaveLength(1);
  });

  it("trims leading + trailing whitespace when grouping", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "   Welcome to Beacon   ",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "Welcome to Beacon",
        }),
      ],
    });
    expect(out).toHaveLength(1);
  });
});

describe("duplicateMeta predicate — null / empty handling", () => {
  it("skips snapshots with null meta (missing-meta owns those)", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", meta_description: null }),
        makeSnapshot({ url: "https://example.com/b", meta_description: null }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("skips snapshots with empty-string meta", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", meta_description: "" }),
        makeSnapshot({ url: "https://example.com/b", meta_description: "" }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("skips snapshots with whitespace-only meta", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "   ",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "\t\n  ",
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("groups populated snapshots only — null metas do not contaminate a real group", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "Real meta",
        }),
        makeSnapshot({ url: "https://example.com/b", meta_description: null }),
        makeSnapshot({
          url: "https://example.com/c",
          meta_description: "Real meta",
        }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.target_url).toBe("https://example.com/c");
  });
});

describe("duplicateMeta predicate — output shape", () => {
  it("deterministic ordering: same input → same output across runs", () => {
    const snapshots = [
      makeSnapshot({
        url: "https://example.com/c",
        meta_description: "Shared",
      }),
      makeSnapshot({
        url: "https://example.com/a",
        meta_description: "Shared",
      }),
      makeSnapshot({
        url: "https://example.com/b",
        meta_description: "Shared",
      }),
    ];
    const a = duplicateMeta({ tenantId: "tenant-a", snapshots });
    const b = duplicateMeta({ tenantId: "tenant-a", snapshots });
    expect(a).toEqual(b);
  });

  it("handles multiple duplicate groups in a single call", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a1",
          meta_description: "Meta A",
        }),
        makeSnapshot({
          url: "https://example.com/a2",
          meta_description: "Meta A",
        }),
        makeSnapshot({
          url: "https://example.com/b1",
          meta_description: "Meta B",
        }),
        makeSnapshot({
          url: "https://example.com/b2",
          meta_description: "Meta B",
        }),
        makeSnapshot({
          url: "https://example.com/b3",
          meta_description: "Meta B",
        }),
        makeSnapshot({
          url: "https://example.com/c",
          meta_description: "Unique",
        }),
      ],
    });
    expect(out).toHaveLength(3); // 1 + 2 + 0
  });

  it("dedupe_key differs across same-action-type-different-URL candidates", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "Shared",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "Shared",
        }),
        makeSnapshot({
          url: "https://example.com/c",
          meta_description: "Shared",
        }),
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.dedupe_key).not.toBe(out[1]!.dedupe_key);
  });

  it("customer copy interpolates the occurrence count correctly", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "Shared",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "Shared",
        }),
        makeSnapshot({
          url: "https://example.com/c",
          meta_description: "Shared",
        }),
      ],
    });
    expect(out[0]!.customer_copy).toBe(
      "This meta description is repeated across 3 owned pages. Tailor each description so AI search platforms see distinct snippets.",
    );
  });

  it("operator_evidence includes normalized value AND canonical URL", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "  Welcome  to  Beacon  ",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "WELCOME TO BEACON",
        }),
      ],
    });
    expect(out).toHaveLength(1);
    const evidence = out[0]!.operator_evidence;
    expect(evidence).toContain('"welcome to beacon"');
    expect(evidence).toContain("canonical=https://example.com/a");
    expect(evidence).toContain("across 2 snapshots");
  });

  it("(α₂.2) filters technical-asset snapshots BEFORE grouping", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/foo.txt",
          meta_description: "Same meta",
        }),
        makeSnapshot({
          url: "https://example.com/bar.txt",
          meta_description: "Same meta",
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("(α₂.2) mixed asset + HTML pairs do NOT form a duplicate group", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/page.html",
          meta_description: "Shared",
        }),
        makeSnapshot({
          url: "https://example.com/data.json",
          meta_description: "Shared",
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("structured evidence array carries 1 entry with kind=page_snapshot_pair", () => {
    const out = duplicateMeta({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/a",
          meta_description: "Shared",
        }),
        makeSnapshot({
          url: "https://example.com/b",
          meta_description: "Shared",
        }),
      ],
    });
    expect(out[0]!.evidence).toHaveLength(1);
    expect(out[0]!.evidence[0]!.kind).toBe("page_snapshot_pair");
    expect(out[0]!.evidence[0]!.detail).toContain("2 owned pages");
  });
});
