/**
 * 2026-06-13 — page-basics false-positive guard: isLikelyEmptyShellSnapshot.
 *
 * Pins the deterministic signature of a failed JS-shell capture (a raw-HTML
 * scrape of a client-rendered page: title+h1+meta all empty at HTTP 200) vs.
 * a genuine single-field gap (which must NOT be classified as a shell).
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import { isLikelyEmptyShellSnapshot } from "@/domains/recommendation-intelligence/triggers/empty-shell-snapshot";

function snap(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "s1",
    page_id: "p1",
    url: "https://example.com/a",
    canonical_url: null,
    fetched_at: "2026-06-13T00:00:00Z",
    http_status: 200,
    title: "A title",
    meta_description: "A description",
    h1: "An H1",
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

describe("isLikelyEmptyShellSnapshot", () => {
  it("TRUE when title + h1 + meta are ALL empty/null at HTTP 200 (JS shell)", () => {
    expect(isLikelyEmptyShellSnapshot(snap({ title: null, h1: null, meta_description: null }))).toBe(true);
    expect(isLikelyEmptyShellSnapshot(snap({ title: "", h1: "   ", meta_description: "" }))).toBe(true);
  });

  it("FALSE when only ONE basic is missing (a real gap — trigger should fire)", () => {
    expect(isLikelyEmptyShellSnapshot(snap({ title: null }))).toBe(false); // h1+meta present
    expect(isLikelyEmptyShellSnapshot(snap({ h1: null }))).toBe(false);
    // koobideh-kabob shape: title+h1 present, meta empty → real meta gap.
    expect(isLikelyEmptyShellSnapshot(snap({ meta_description: null }))).toBe(false);
  });

  it("FALSE when all present", () => {
    expect(isLikelyEmptyShellSnapshot(snap())).toBe(false);
  });

  it("FALSE when not HTTP 200 even if all empty (other triggers own non-200)", () => {
    expect(isLikelyEmptyShellSnapshot(snap({ http_status: 404, title: null, h1: null, meta_description: null }))).toBe(false);
    expect(isLikelyEmptyShellSnapshot(snap({ http_status: 500, title: null, h1: null, meta_description: null }))).toBe(false);
  });
});
