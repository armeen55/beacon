/**
 * 2026-06-10 — vertical-agnostic page-shape layer (P0 wall 5).
 * Pins: structural-only feature extraction, the cross-tenant aggregate
 * (counts + rates only — privacy-safe by construction), the per-side
 * page minimum before a lift is claimed, and the plain-English insight
 * formatter (strongest qualifying lift, checkable counts).
 */

import { describe, it, expect } from "vitest";

import {
  extractPageShape,
  aggregatePageShapePatterns,
  formatNetworkInsight,
  PAGE_SHAPE_MIN_PAGES_PER_SIDE,
  type PageShapeInput,
} from "@/domains/recommendations/cross-tenant-brain/page-shape";
import type { PageSnapshot } from "@/domains/pages/types";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "s",
    page_id: "p",
    url: "https://x.com/a",
    canonical_url: null,
    fetched_at: "2026-06-10T00:00:00Z",
    http_status: 200,
    title: "T",
    meta_description: null,
    h1: "H",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 500,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "x",
    faq_hash: "x",
    schema_hash: "x",
    tenant_id: "t",
    ...over,
  };
}

function input(
  features: Partial<Record<string, boolean>>,
  cited: boolean,
  tenantBucket = 0,
): PageShapeInput {
  return {
    features: {
      faq_block: false,
      table: false,
      schema_markup: false,
      long_form: false,
      rich_headings: false,
      ...features,
    },
    cited,
    tenantBucket,
  } as PageShapeInput;
}

describe("extractPageShape — structural only", () => {
  it("detects each feature from snapshot structure", () => {
    const f = extractPageShape(
      snap({
        faqs: [{ question: "q", answer_excerpt: "a", source: "jsonld" }],
        table_count: 2,
        schema_types: ["FAQPage"],
        word_count: 1500,
        h2_list: ["a", "b", "c"],
        h3_count: 2,
      }),
    );
    expect(f).toEqual({
      faq_block: true,
      table: true,
      schema_markup: true,
      long_form: true,
      rich_headings: true,
    });
  });

  it("a bare thin page has no features", () => {
    const f = extractPageShape(snap());
    expect(Object.values(f).every((v) => v === false)).toBe(true);
  });

  it("output carries ONLY booleans — no text, urls, or tenant ids", () => {
    const f = extractPageShape(snap({ title: "SECRET", url: "https://secret.com/x" }));
    expect(Object.values(f).every((v) => typeof v === "boolean")).toBe(true);
    expect(JSON.stringify(f)).not.toContain("SECRET");
    expect(JSON.stringify(f)).not.toContain("secret.com");
  });
});

describe("aggregatePageShapePatterns", () => {
  it("computes cited rates per side and the lift when both sides qualify", () => {
    const inputs: PageShapeInput[] = [
      // 10 FAQ pages, 6 cited (60%) — spread across 2 tenants (buckets 0/1)
      ...Array.from({ length: 10 }, (_, i) => input({ faq_block: true }, i < 6, i % 2)),
      // 10 non-FAQ pages, 2 cited (20%) — also spread across 2 tenants
      ...Array.from({ length: 10 }, (_, i) => input({}, i < 2, i % 2)),
    ];
    const p = aggregatePageShapePatterns(inputs).find((x) => x.feature === "faq_block")!;
    expect(p.withPages).toBe(10);
    expect(p.citedRateWith).toBeCloseTo(0.6);
    expect(p.citedRateWithout).toBeCloseTo(0.2);
    expect(p.lift).toBeCloseTo(3);
  });

  it("claims NO lift under the per-side page minimum", () => {
    const inputs: PageShapeInput[] = [
      ...Array.from({ length: PAGE_SHAPE_MIN_PAGES_PER_SIDE - 1 }, () =>
        input({ table: true }, true),
      ),
      ...Array.from({ length: 20 }, () => input({}, false)),
    ];
    const p = aggregatePageShapePatterns(inputs).find((x) => x.feature === "table")!;
    expect(p.lift).toBeNull();
  });

  it("claims NO lift when the without-side never gets cited (no meaningful ratio)", () => {
    const inputs: PageShapeInput[] = [
      ...Array.from({ length: 12 }, () => input({ long_form: true }, true)),
      ...Array.from({ length: 12 }, () => input({}, false)),
    ];
    const p = aggregatePageShapePatterns(inputs).find((x) => x.feature === "long_form")!;
    expect(p.lift).toBeNull();
  });
});

describe("formatNetworkInsight", () => {
  it("renders the strongest qualifying lift in plain English with checkable counts", () => {
    const inputs: PageShapeInput[] = [
      ...Array.from({ length: 10 }, (_, i) => input({ faq_block: true }, i < 6, i % 2)),
      ...Array.from({ length: 10 }, (_, i) => input({}, i < 2, i % 2)),
    ];
    const line = formatNetworkInsight(aggregatePageShapePatterns(inputs));
    expect(line).toContain("question-and-answer section");
    expect(line).toContain("3.0×");
    expect(line).toContain("20 pages compared");
  });

  it("returns null when nothing clears the lift bar", () => {
    const inputs: PageShapeInput[] = [
      ...Array.from({ length: 10 }, (_, i) => input({ faq_block: true }, i < 3, i % 2)),
      ...Array.from({ length: 10 }, (_, i) => input({}, i < 3, i % 2)),
    ];
    expect(formatNetworkInsight(aggregatePageShapePatterns(inputs))).toBeNull();
  });
});

describe("aggregatePageShapePatterns — distinct-tenant gate (wave-5 #4)", () => {
  it("suppresses lift when ALL pages come from a SINGLE tenant", () => {
    // A strong 3x pattern (60% vs 20%) with ample pages per side — but every
    // page is tenant bucket 0. A cross-tenant claim must NOT be made from one
    // tenant's pages, so lift stays null.
    const inputs: PageShapeInput[] = [
      ...Array.from({ length: 10 }, (_, i) => input({ faq_block: true }, i < 6, 0)),
      ...Array.from({ length: 10 }, (_, i) => input({}, i < 2, 0)),
    ];
    const p = aggregatePageShapePatterns(inputs).find(
      (x) => x.feature === "faq_block",
    )!;
    // Counts/rates still compute (privacy-safe), but the LIFT is gated.
    expect(p.withPages).toBe(10);
    expect(p.citedRateWith).toBeCloseTo(0.6);
    expect(p.lift).toBeNull();
  });
});
