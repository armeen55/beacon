/**
 * Slice 4.5.B.α₀ — trigger predicate `missing-title` unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import { missingTitle } from "@/domains/recommendation-intelligence/triggers/missing-title";

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/a",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "Whole Home Remodel in Palo Alto",
    meta_description: "A clean description",
    h1: "Whole Home Remodel",
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

describe("missingTitle predicate", () => {
  it("emits zero candidates when title is a non-empty string", () => {
    const out = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: "A real title" }),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single candidate when title is null", () => {
    const out = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null }),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("missing_title");
    expect(row.action_type).toBe("edit_title");
    expect(row.target_url).toBe("https://example.com/a");
    expect(row.confidence).toBe("high");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.evidence.length).toBeGreaterThanOrEqual(1);
    expect(row.safety_flags).toEqual([]);
    expect(row.tenant_id).toBe("tenant-a");
  });

  it("emits a single candidate when title is empty string", () => {
    const out = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: "" }),
    });
    expect(out).toHaveLength(1);
  });

  it("emits a single candidate when title is whitespace-only", () => {
    const out = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: "   \t\n   " }),
    });
    expect(out).toHaveLength(1);
  });

  it("customer_copy passes operator-locked phrasing", () => {
    const out = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null }),
    });
    expect(out[0]!.customer_copy).toBe(
      "Add a clear page title so AI search platforms can surface this page accurately.",
    );
  });

  it("dedupe_key + cooldown_key are deterministic over identical inputs", () => {
    const a = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null }),
    })[0]!;
    const b = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null }),
    })[0]!;
    expect(a.dedupe_key).toBe(b.dedupe_key);
    expect(a.cooldown_key).toBe(b.cooldown_key);
  });

  it("dedupe_key differs across URLs", () => {
    const a = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null, url: "https://example.com/a" }),
    })[0]!;
    const b = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null, url: "https://example.com/b" }),
    })[0]!;
    expect(a.dedupe_key).not.toBe(b.dedupe_key);
  });

  it("created_from_signal_at mirrors snapshot.fetched_at", () => {
    const out = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: null,
        fetched_at: "2026-05-18T22:00:00Z",
      }),
    });
    expect(out[0]!.created_from_signal_at).toBe("2026-05-18T22:00:00Z");
  });
});
