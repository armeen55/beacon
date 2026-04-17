/**
 * Phase 1 — Tests for `deriveSchemaChangelogFields`.
 *
 * The 4 cases the Day 4 guardrail calls out explicitly:
 *   A. types added (only)
 *   B. types removed (only)
 *   C. same types, schema_hash changed (content-edited)
 *   D. schema changed AND visible copy changed (muddy-attribution marker)
 *
 * Plus precedence + no-change edge cases.
 */

import { describe, it, expect } from "vitest";
import { deriveSchemaChangelogFields } from "./derive-schema-fields";
import type { PageSnapshot } from "@/domains/pages/types";

function snap(overrides: Partial<PageSnapshot> & { url: string }): PageSnapshot {
  const base: PageSnapshot = {
    id: "snap-test",
    page_id: "pg-test",
    url: overrides.url,
    canonical_url: overrides.url,
    fetched_at: "2026-04-16T12:00:00Z",
    http_status: 200,
    title: "Test",
    meta_description: "Test",
    h1: "Test",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    internal_links: [],
    word_count: 100,
    robots_meta: "index, follow",
    has_canonical_mismatch: false,
    content_hash: "c-same",
    headings_hash: "h-same",
    faq_hash: "f-same",
    schema_hash: "s-same",
    extraction_certainty: "confirmed",
    faq_schema_block_count: 0,
    table_count: 0,
    tenant_id: "",
    observation_run_id: "obs-test",
  } as PageSnapshot;
  return { ...base, ...overrides };
}

describe("deriveSchemaChangelogFields — case A: types added (only)", () => {
  it("classifies as schema_added when new @types appear", () => {
    const prev = snap({
      url: "https://r.co/locations/palo-alto",
      schema_types: ["FAQPage"],
      schema_hash: "hash-v1",
      content_hash: "content-same",
    });
    const cur = snap({
      url: "https://r.co/locations/palo-alto",
      schema_types: [
        "FAQPage",
        "HomeAndConstructionBusiness",
        "WebPage",
        "BreadcrumbList",
      ],
      schema_hash: "hash-v2",
      content_hash: "content-same",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out).not.toBeNull();
    expect(out!.change_family).toBe("schema_experiment");
    expect(out!.change_type).toBe("schema_added");
    expect(out!.schema_types_added).toEqual([
      "BreadcrumbList",
      "HomeAndConstructionBusiness",
      "WebPage",
    ]);
    expect(out!.schema_types_removed).toEqual([]);
    expect(out!.schema_types_before).toEqual(["FAQPage"]);
    expect(out!.schema_types_after).toEqual([
      "BreadcrumbList",
      "FAQPage",
      "HomeAndConstructionBusiness",
      "WebPage",
    ]);
    expect(out!.schema_hash_before).toBe("hash-v1");
    expect(out!.schema_hash_after).toBe("hash-v2");
    expect(out!.visible_copy_changed).toBe(false);
    expect(out!.page_scope).toBe("single_url");
  });

  it("classifies as schema_added even when some types were also removed (added wins precedence)", () => {
    // Hybrid: added A,B AND removed X. Per plan precedence, `schema_added` wins.
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage", "Article"],
      schema_hash: "h1",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage", "WebPage", "BreadcrumbList"],
      schema_hash: "h2",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_added");
    // But BOTH added and removed arrays are populated for transparency
    expect(out!.schema_types_added).toEqual(["BreadcrumbList", "WebPage"]);
    expect(out!.schema_types_removed).toEqual(["Article"]);
  });
});

describe("deriveSchemaChangelogFields — case B: types removed (only)", () => {
  it("classifies as schema_removed when @types disappeared and none added", () => {
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage", "BreadcrumbList", "WebPage"],
      schema_hash: "h1",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "h2",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_removed");
    expect(out!.schema_types_added).toEqual([]);
    expect(out!.schema_types_removed).toEqual(["BreadcrumbList", "WebPage"]);
    expect(out!.schema_types_before).toEqual([
      "BreadcrumbList",
      "FAQPage",
      "WebPage",
    ]);
    expect(out!.schema_types_after).toEqual(["FAQPage"]);
  });
});

describe("deriveSchemaChangelogFields — case C: same types, schema content edited", () => {
  it("classifies as schema_content_edited when schema_hash changes but types are identical", () => {
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage", "BreadcrumbList"],
      schema_hash: "hash-v1",
      content_hash: "c-same",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage", "BreadcrumbList"],
      schema_hash: "hash-v2",
      content_hash: "c-same",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_content_edited");
    expect(out!.schema_types_added).toEqual([]);
    expect(out!.schema_types_removed).toEqual([]);
    expect(out!.schema_types_before).toEqual([
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(out!.schema_types_after).toEqual([
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(out!.schema_hash_before).toBe("hash-v1");
    expect(out!.schema_hash_after).toBe("hash-v2");
    expect(out!.visible_copy_changed).toBe(false);
  });

  it("does NOT misclassify content_edited as schema_added/removed", () => {
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "h1",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "h2",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_content_edited");
    expect(out!.change_type).not.toBe("schema_added");
    expect(out!.change_type).not.toBe("schema_removed");
  });
});

describe("deriveSchemaChangelogFields — case D: schema changed AND visible copy changed (muddy)", () => {
  it("flags visible_copy_changed=true when content_hash also moved", () => {
    // The attribution-muddying case. Schema experiment mixed with a copy edit.
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "h1",
      content_hash: "content-old",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage", "BreadcrumbList", "WebPage"],
      schema_hash: "h2",
      content_hash: "content-new",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_added");
    expect(out!.visible_copy_changed).toBe(true);
    // The schema delta is still captured — the attributor decides what to do
    // with the muddy signal downstream.
    expect(out!.schema_types_added).toEqual(["BreadcrumbList", "WebPage"]);
  });

  it("visible_copy_changed=true propagates through the content_edited branch too", () => {
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "h1",
      content_hash: "copy-v1",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "h2",
      content_hash: "copy-v2",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_content_edited");
    expect(out!.visible_copy_changed).toBe(true);
  });
});

describe("deriveSchemaChangelogFields — no-op cases", () => {
  it("returns null when prev snapshot is null (no baseline to diff against)", () => {
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage", "BreadcrumbList"],
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: null,
    });
    expect(out).toBeNull();
  });

  it("returns null when nothing changed (types identical, hashes identical)", () => {
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "same",
      content_hash: "same",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "same",
      content_hash: "same",
    });
    expect(
      deriveSchemaChangelogFields({
        currentSnapshot: cur,
        previousSnapshot: prev,
      }),
    ).toBeNull();
  });

  it("returns null when only content_hash changed (no schema signal at all)", () => {
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "same",
      content_hash: "v1",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "same",
      content_hash: "v2",
    });
    // Pure copy edit — not a schema experiment. Helper returns null and the
    // caller leaves the ChangelogEntry unstructured (legacy path handles it).
    expect(
      deriveSchemaChangelogFields({
        currentSnapshot: cur,
        previousSnapshot: prev,
      }),
    ).toBeNull();
  });

  it("treats empty/missing schema_types arrays as equivalent", () => {
    const prev = snap({
      url: "https://r.co/x",
      schema_types: [],
      schema_hash: "h-same",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: [],
      schema_hash: "h-same",
    });
    expect(
      deriveSchemaChangelogFields({
        currentSnapshot: cur,
        previousSnapshot: prev,
      }),
    ).toBeNull();
  });
});

describe("deriveSchemaChangelogFields — tonight's 3 pages", () => {
  // Operator deploys the exact blocks from tonight's prompt. These tests
  // assert that the derived fields match what the ChangelogEntry should
  // carry for each of the 3 tonight experiments to flow through attribution
  // cleanly later.

  it("/locations/palo-alto — HomeAndConstructionBusiness + WebPage + BreadcrumbList added", () => {
    const prev = snap({
      url: "https://ritzbuilders.com/locations/palo-alto",
      schema_types: ["FAQPage"],
      schema_hash: "palo-v1",
      content_hash: "palo-content-v1",
    });
    const cur = snap({
      url: "https://ritzbuilders.com/locations/palo-alto",
      schema_types: [
        "FAQPage",
        "HomeAndConstructionBusiness",
        "WebPage",
        "BreadcrumbList",
      ],
      schema_hash: "palo-v2",
      // Visible copy unchanged per tonight's prompt rule.
      content_hash: "palo-content-v1",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_added");
    expect(out!.schema_types_added).toEqual([
      "BreadcrumbList",
      "HomeAndConstructionBusiness",
      "WebPage",
    ]);
    expect(out!.visible_copy_changed).toBe(false);
    expect(out!.page_scope).toBe("single_url");
  });

  it("/our-process — HowTo added", () => {
    const prev = snap({
      url: "https://ritzbuilders.com/our-process",
      schema_types: ["FAQPage"],
      schema_hash: "proc-v1",
      content_hash: "proc-content-v1",
    });
    const cur = snap({
      url: "https://ritzbuilders.com/our-process",
      schema_types: ["FAQPage", "HowTo"],
      schema_hash: "proc-v2",
      content_hash: "proc-content-v1",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_added");
    expect(out!.schema_types_added).toEqual(["HowTo"]);
    expect(out!.visible_copy_changed).toBe(false);
  });

  it("/explore-projects/riverside-way — Article + BreadcrumbList added", () => {
    const prev = snap({
      url: "https://ritzbuilders.com/explore-projects/riverside-way",
      schema_types: ["FAQPage"],
      schema_hash: "rw-v1",
      content_hash: "rw-content-v1",
    });
    const cur = snap({
      url: "https://ritzbuilders.com/explore-projects/riverside-way",
      schema_types: ["FAQPage", "Article", "BreadcrumbList"],
      schema_hash: "rw-v2",
      content_hash: "rw-content-v1",
    });
    const out = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(out!.change_type).toBe("schema_added");
    expect(out!.schema_types_added).toEqual(["Article", "BreadcrumbList"]);
    expect(out!.visible_copy_changed).toBe(false);
  });
});
