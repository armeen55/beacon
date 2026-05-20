/**
 * Slice 4.5.B.α₁ — trigger predicate `missing-h1` unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import { missingH1 } from "@/domains/recommendation-intelligence/triggers/missing-h1";

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
    h1: "Whole Home Remodel in Palo Alto",
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

describe("missingH1 predicate", () => {
  it("emits zero candidates when h1 is a non-empty string", () => {
    const out = missingH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ h1: "Real heading" }),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single candidate when h1 is null", () => {
    const out = missingH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ h1: null }),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("missing_h1");
    expect(row.action_type).toBe("change_h1");
    expect(row.target_url).toBe("https://example.com/a");
    expect(row.confidence).toBe("high");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.evidence.length).toBeGreaterThanOrEqual(1);
    expect(row.safety_flags).toEqual([]);
  });

  it("emits a single candidate when h1 is empty string", () => {
    const out = missingH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ h1: "" }),
    });
    expect(out).toHaveLength(1);
  });

  it("emits a single candidate when h1 is whitespace-only", () => {
    const out = missingH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ h1: "  \t\n  " }),
    });
    expect(out).toHaveLength(1);
  });

  it("customer_copy passes operator-locked phrasing", () => {
    const out = missingH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ h1: null }),
    });
    expect(out[0]!.customer_copy).toBe(
      "Add a clear H1 so the page anchors its main topic.",
    );
  });

  it("dedupe_key differs from missing-title's key (different action_type)", async () => {
    const { missingTitle } = await import(
      "@/domains/recommendation-intelligence/triggers/missing-title"
    );
    const titleOut = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null }),
    })[0]!;
    const h1Out = missingH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ h1: null }),
    })[0]!;
    expect(titleOut.dedupe_key).not.toBe(h1Out.dedupe_key);
    expect(titleOut.cooldown_key).not.toBe(h1Out.cooldown_key);
  });
});
