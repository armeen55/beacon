/**
 * Slice 4.5.B.α₂ — trigger predicate `duplicate-title` unit tests.
 *
 * Cross-snapshot aggregation predicate. Normalizes title via
 * trim + lowercase + whitespace-collapse. Groups of size ≥ 2 emit
 * an edit_title candidate per URL past the alphabetical-first
 * canonical anchor.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import { duplicateTitle } from "@/domains/recommendation-intelligence/triggers/duplicate-title";

function makeSnapshot(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-x",
    page_id: "page-x",
    url: "https://example.com/x",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "Default Title",
    meta_description: null,
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

describe("duplicateTitle predicate — group sizing", () => {
  it("emits zero candidates for an empty snapshot array", () => {
    expect(duplicateTitle({ tenantId: "tenant-a", snapshots: [] })).toEqual([]);
  });

  it("emits zero candidates for a single snapshot", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [makeSnapshot({ title: "Whole Home Remodel" })],
    });
    expect(out).toEqual([]);
  });

  it("emits zero candidates when all titles are distinct", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "First" }),
        makeSnapshot({ url: "https://example.com/b", title: "Second" }),
        makeSnapshot({ url: "https://example.com/c", title: "Third" }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("emits ONE candidate when two snapshots share the same title (group of 2)", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "Shared Title" }),
        makeSnapshot({ url: "https://example.com/b", title: "Shared Title" }),
      ],
    });
    expect(out).toHaveLength(1);
    // Canonical anchor = first URL alphabetically (/a). Candidate
    // targets the OTHER URL (/b).
    expect(out[0]!.target_url).toBe("https://example.com/b");
    expect(out[0]!.trigger_signal).toBe("duplicate_title");
    expect(out[0]!.action_type).toBe("edit_title");
    expect(out[0]!.confidence).toBe("high");
  });

  it("emits TWO candidates when three snapshots share the same title (group of 3)", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/c", title: "Shared" }),
        makeSnapshot({ url: "https://example.com/a", title: "Shared" }),
        makeSnapshot({ url: "https://example.com/b", title: "Shared" }),
      ],
    });
    expect(out).toHaveLength(2);
    // Canonical anchor = "/a" (alphabetically first). Candidates target
    // /b and /c (the URLs past the anchor).
    const targets = out.map((r) => r.target_url).sort();
    expect(targets).toEqual([
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });
});

describe("duplicateTitle predicate — normalization", () => {
  it("collapses internal whitespace when grouping", () => {
    // "Whole  Home" (double space) vs "Whole Home" (single space)
    // → both normalize to "whole home" → group of 2 → 1 candidate.
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "Whole  Home" }),
        makeSnapshot({ url: "https://example.com/b", title: "Whole Home" }),
      ],
    });
    expect(out).toHaveLength(1);
  });

  it("case-folds when grouping", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "Whole Home Remodel" }),
        makeSnapshot({ url: "https://example.com/b", title: "whole home remodel" }),
      ],
    });
    expect(out).toHaveLength(1);
  });

  it("trims leading + trailing whitespace when grouping", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "  Whole Home  " }),
        makeSnapshot({ url: "https://example.com/b", title: "Whole Home" }),
      ],
    });
    expect(out).toHaveLength(1);
  });
});

describe("duplicateTitle predicate — null / empty handling", () => {
  it("skips snapshots with null title (missing-title owns those)", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: null }),
        makeSnapshot({ url: "https://example.com/b", title: null }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("skips snapshots with empty-string title", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "" }),
        makeSnapshot({ url: "https://example.com/b", title: "" }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("skips snapshots with whitespace-only title", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "   " }),
        makeSnapshot({ url: "https://example.com/b", title: "\t\n  " }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("groups populated snapshots only — null titles do not contaminate a real group", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "Real" }),
        makeSnapshot({ url: "https://example.com/b", title: null }),
        makeSnapshot({ url: "https://example.com/c", title: "Real" }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.target_url).toBe("https://example.com/c");
  });
});

describe("duplicateTitle predicate — output shape", () => {
  it("deterministic ordering: same input → same output across runs", () => {
    const snapshots = [
      makeSnapshot({ url: "https://example.com/c", title: "Shared" }),
      makeSnapshot({ url: "https://example.com/a", title: "Shared" }),
      makeSnapshot({ url: "https://example.com/b", title: "Shared" }),
    ];
    const a = duplicateTitle({ tenantId: "tenant-a", snapshots });
    const b = duplicateTitle({ tenantId: "tenant-a", snapshots });
    expect(a).toEqual(b);
  });

  it("handles multiple duplicate groups in a single call", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        // Group A — size 2 → 1 candidate
        makeSnapshot({ url: "https://example.com/a1", title: "Title A" }),
        makeSnapshot({ url: "https://example.com/a2", title: "Title A" }),
        // Group B — size 3 → 2 candidates
        makeSnapshot({ url: "https://example.com/b1", title: "Title B" }),
        makeSnapshot({ url: "https://example.com/b2", title: "Title B" }),
        makeSnapshot({ url: "https://example.com/b3", title: "Title B" }),
        // Singleton — no candidate
        makeSnapshot({ url: "https://example.com/c", title: "Unique" }),
      ],
    });
    expect(out).toHaveLength(3); // 1 + 2 + 0
  });

  it("dedupe_key differs across same-action-type-different-URL candidates", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "Shared" }),
        makeSnapshot({ url: "https://example.com/b", title: "Shared" }),
        makeSnapshot({ url: "https://example.com/c", title: "Shared" }),
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.dedupe_key).not.toBe(out[1]!.dedupe_key);
  });

  it("customer copy interpolates the occurrence count correctly", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "Shared" }),
        makeSnapshot({ url: "https://example.com/b", title: "Shared" }),
        makeSnapshot({ url: "https://example.com/c", title: "Shared" }),
      ],
    });
    expect(out[0]!.customer_copy).toBe(
      "This page title is repeated across 3 owned pages. Make each title distinct so AI search platforms can tell the pages apart.",
    );
  });

  it("operator_evidence includes normalized value AND canonical URL", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "  Whole Home  " }),
        makeSnapshot({ url: "https://example.com/b", title: "WHOLE HOME" }),
      ],
    });
    expect(out).toHaveLength(1);
    const evidence = out[0]!.operator_evidence;
    // Normalized form (trim + lowercase + whitespace-collapse).
    expect(evidence).toContain('"whole home"');
    // Canonical = alphabetical-first URL.
    expect(evidence).toContain("canonical=https://example.com/a");
    // Group size.
    expect(evidence).toContain("across 2 snapshots");
  });

  it("(α₂.2) filters technical-asset snapshots BEFORE grouping", () => {
    // Two `.txt` files with identical titles would have formed a
    // duplicate group pre-α₂.2. Now they're filtered before
    // grouping → no candidates.
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/foo.txt",
          title: "Same title",
        }),
        makeSnapshot({
          url: "https://example.com/bar.txt",
          title: "Same title",
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("(α₂.2) mixed asset + HTML pairs do NOT form a duplicate group", () => {
    // The HTML page alone in its group (asset filtered out) → no
    // candidates.
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({
          url: "https://example.com/page.html",
          title: "Shared",
        }),
        makeSnapshot({
          url: "https://example.com/data.json",
          title: "Shared",
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("structured evidence array carries 1 entry with kind=page_snapshot_pair", () => {
    const out = duplicateTitle({
      tenantId: "tenant-a",
      snapshots: [
        makeSnapshot({ url: "https://example.com/a", title: "Shared" }),
        makeSnapshot({ url: "https://example.com/b", title: "Shared" }),
      ],
    });
    expect(out[0]!.evidence).toHaveLength(1);
    expect(out[0]!.evidence[0]!.kind).toBe("page_snapshot_pair");
    expect(out[0]!.evidence[0]!.detail).toContain("2 owned pages");
  });
});
