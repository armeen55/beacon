/**
 * Fix 1 (2026-04-21) — snapshot-diff tests for the three new field diffs:
 * h2_changed, h3_changed, schema_entity_names_changed.
 *
 * These booleans feed the detect-findings emit layer for the corresponding
 * finding types. Order-sensitive for h2/h3 (sequence carries editorial
 * meaning); set-based for schema entity names.
 */

import { describe, it, expect } from "vitest";
import { diffSnapshots } from "@/domains/pages/snapshot-diff";
import type { PageSnapshot } from "@/domains/pages/types";

function snap(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "p-1",
    url: "https://site.example/target",
    canonical_url: null,
    fetched_at: "2026-04-21T00:00:00Z",
    http_status: 200,
    title: "T",
    meta_description: null,
    h1: "H1",
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
    content_hash: "c",
    headings_hash: "h",
    faq_hash: "f",
    schema_hash: "s",
    extraction_certainty: "confirmed",
    faq_schema_block_count: 0,
    table_count: 0,
    tenant_id: "",
    ...overrides,
  };
}

describe("diffSnapshots — h2_changed", () => {
  it("true when an h2 text changes", () => {
    const prev = snap({ h2_list: ["About Us", "Neighborhoods"] });
    const curr = snap({ h2_list: ["About Us", "Neighborhoods We Serve"] });
    const d = diffSnapshots(curr, prev);
    expect(d.h2_changed).toBe(true);
  });

  it("true when an h2 is added", () => {
    const prev = snap({ h2_list: ["About Us"] });
    const curr = snap({ h2_list: ["About Us", "Contact"] });
    expect(diffSnapshots(curr, prev).h2_changed).toBe(true);
  });

  it("true when order changes (order-sensitive)", () => {
    const prev = snap({ h2_list: ["A", "B", "C"] });
    const curr = snap({ h2_list: ["C", "B", "A"] });
    expect(diffSnapshots(curr, prev).h2_changed).toBe(true);
  });

  it("false when identical", () => {
    const prev = snap({ h2_list: ["A", "B"] });
    const curr = snap({ h2_list: ["A", "B"] });
    expect(diffSnapshots(curr, prev).h2_changed).toBe(false);
  });

  it("false when both empty", () => {
    expect(diffSnapshots(snap(), snap()).h2_changed).toBe(false);
  });

  it("handles undefined (pre-A+B1 snapshots) gracefully", () => {
    const prev: PageSnapshot = { ...snap(), h2_list: undefined as unknown as string[] };
    const curr = snap({ h2_list: ["New H2"] });
    expect(diffSnapshots(curr, prev).h2_changed).toBe(true);
  });
});

describe("diffSnapshots — h3_changed", () => {
  it("true when h3_list differs", () => {
    const prev = snap({ h3_list: ["Phase 1"] });
    const curr = snap({ h3_list: ["Phase 1", "Phase 2"] });
    expect(diffSnapshots(curr, prev).h3_changed).toBe(true);
  });

  it("false when identical", () => {
    const prev = snap({ h3_list: ["A", "B"] });
    const curr = snap({ h3_list: ["A", "B"] });
    expect(diffSnapshots(curr, prev).h3_changed).toBe(false);
  });

  it("false when both absent", () => {
    expect(diffSnapshots(snap(), snap()).h3_changed).toBe(false);
  });

  it("true when previously absent, now populated", () => {
    const prev = snap();
    const curr = snap({ h3_list: ["X"] });
    expect(diffSnapshots(curr, prev).h3_changed).toBe(true);
  });
});

describe("diffSnapshots — schema_entity_names_changed", () => {
  it("true when a Service.name is added", () => {
    const prev = snap({ schema_entity_names: ["Whole-Home Remodel"] });
    const curr = snap({
      schema_entity_names: ["Whole-Home Remodel", "Teardown & Rebuild"],
    });
    expect(diffSnapshots(curr, prev).schema_entity_names_changed).toBe(true);
  });

  it("false when same set (order doesn't matter)", () => {
    const prev = snap({ schema_entity_names: ["A", "B", "C"] });
    const curr = snap({ schema_entity_names: ["C", "A", "B"] });
    expect(diffSnapshots(curr, prev).schema_entity_names_changed).toBe(false);
  });

  it("true when an entity name is renamed", () => {
    const prev = snap({ schema_entity_names: ["Old Service Name"] });
    const curr = snap({ schema_entity_names: ["New Service Name"] });
    expect(diffSnapshots(curr, prev).schema_entity_names_changed).toBe(true);
  });

  it("false when both absent", () => {
    expect(diffSnapshots(snap(), snap()).schema_entity_names_changed).toBe(false);
  });
});

describe("diffSnapshots — changed flag includes new booleans", () => {
  it("changed=true when only h2 changes", () => {
    const prev = snap({ h2_list: ["A"] });
    const curr = snap({ h2_list: ["B"] });
    const d = diffSnapshots(curr, prev);
    expect(d.changed).toBe(true);
    expect(d.h2_changed).toBe(true);
  });

  it("changed=true when only h3 changes", () => {
    const prev = snap({ h3_list: ["A"] });
    const curr = snap({ h3_list: ["A", "B"] });
    const d = diffSnapshots(curr, prev);
    expect(d.changed).toBe(true);
    expect(d.h3_changed).toBe(true);
  });

  it("changed=true when only schema entity names change", () => {
    const prev = snap({ schema_entity_names: [] });
    const curr = snap({ schema_entity_names: ["X"] });
    const d = diffSnapshots(curr, prev);
    expect(d.changed).toBe(true);
    expect(d.schema_entity_names_changed).toBe(true);
  });

  it("summary names the specific fields that changed", () => {
    const prev = snap({ h2_list: ["A"], h3_list: ["X"] });
    const curr = snap({ h2_list: ["B"], h3_list: ["Y"] });
    const d = diffSnapshots(curr, prev);
    expect(d.summary).toContain("H2");
    expect(d.summary).toContain("H3");
  });
});

describe("diffSnapshots — FAQ direction evidence", () => {
  const faq = (question: string) => ({
    question,
    answer_excerpt: "Answer",
    source: "html_section" as const,
  });

  it("persists the exact previous FAQ count so guardrails can tell added from lost", () => {
    const previous = snap({ faqs: [faq("One"), faq("Two"), faq("Three")] });
    const current = snap({ faqs: [faq("One")] });
    const diff = diffSnapshots(current, previous);
    expect(diff.faq_count_changed).toBe(true);
    expect(diff.previous_faq_count).toBe(3);
  });
});
