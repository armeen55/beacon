/**
 * Slice 4.5.B.α₀ — trigger predicate `missing-meta` unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import { missingMeta } from "@/domains/recommendation-intelligence/triggers/missing-meta";

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/a",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "A real title",
    meta_description: "A clean meta description",
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

describe("missingMeta predicate", () => {
  it("emits zero candidates when meta is a non-empty string", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: "real meta" }),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single candidate when meta is null", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: null }),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("missing_meta");
    expect(row.action_type).toBe("edit_meta");
    expect(row.target_url).toBe("https://example.com/a");
    expect(row.confidence).toBe("high");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.evidence.length).toBeGreaterThanOrEqual(1);
    expect(row.safety_flags).toEqual([]);
  });

  it("emits a single candidate when meta is empty string", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: "" }),
    });
    expect(out).toHaveLength(1);
  });

  it("emits a single candidate when meta is whitespace-only", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: "   \n  " }),
    });
    expect(out).toHaveLength(1);
  });

  it("customer_copy passes operator-locked phrasing", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: null }),
    });
    expect(out[0]!.customer_copy).toBe(
      "Add a meta description so AI search platforms have a clean snippet to extract.",
    );
  });

  it("dedupe_key and cooldown_key differ from missing-title's keys (different action_type)", async () => {
    const { missingTitle } = await import(
      "@/domains/recommendation-intelligence/triggers/missing-title"
    );
    const titleOut = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null, meta_description: null }),
    })[0]!;
    const metaOut = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null, meta_description: null }),
    })[0]!;
    expect(titleOut.dedupe_key).not.toBe(metaOut.dedupe_key);
    expect(titleOut.cooldown_key).not.toBe(metaOut.cooldown_key);
  });
});
