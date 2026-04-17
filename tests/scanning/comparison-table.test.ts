/**
 * Phase B — Comparison table detection and recommendation tests.
 *
 * Tests that:
 * 1. Table detection counts meaningful tables (≥2 rows)
 * 2. Comparison rec only fires for city/service/homepage pages
 * 3. Pages WITH tables don't get false-positive recs
 * 4. Project/about pages don't get comparison recs
 */

import { describe, it, expect } from "vitest";
import { extractPageSnapshot } from "@/domains/pages/extractor";

// ---------------------------------------------------------------------------
// Table detection tests (extractor)
// ---------------------------------------------------------------------------

const BASE_URL = "https://example.com/test";

function htmlWithTable(rows: number): string {
  const trs = Array.from({ length: rows }, (_, i) =>
    `<tr><td>Cell ${i}</td><td>Value ${i}</td></tr>`,
  ).join("\n");
  return `<html><head>
    <title>Test</title>
    <meta name="description" content="Test">
    <link rel="canonical" href="${BASE_URL}">
  </head><body>
    <h1>Test Page</h1>
    <p>${"Content padding. ".repeat(20)}</p>
    <table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${trs}</tbody></table>
  </body></html>`;
}

function htmlNoTable(): string {
  return `<html><head>
    <title>Test</title>
    <meta name="description" content="Test">
    <link rel="canonical" href="${BASE_URL}">
  </head><body>
    <h1>Test Page</h1>
    <p>${"Content padding. ".repeat(20)}</p>
  </body></html>`;
}

function htmlWithDecorativeTable(): string {
  // Single-row table — layout/decorative, should not count
  return `<html><head>
    <title>Test</title>
    <meta name="description" content="Test">
    <link rel="canonical" href="${BASE_URL}">
  </head><body>
    <h1>Test Page</h1>
    <p>${"Content padding. ".repeat(20)}</p>
    <table><tr><td>Just one row</td></tr></table>
  </body></html>`;
}

describe("table detection in extractor", () => {
  it("counts meaningful tables with ≥2 rows", () => {
    const snap = extractPageSnapshot(htmlWithTable(5), BASE_URL, "pg-1");
    expect(snap.table_count).toBe(1);
  });

  it("returns 0 when no tables exist", () => {
    const snap = extractPageSnapshot(htmlNoTable(), BASE_URL, "pg-1");
    expect(snap.table_count).toBe(0);
  });

  it("does not count decorative single-row tables", () => {
    const snap = extractPageSnapshot(htmlWithDecorativeTable(), BASE_URL, "pg-1");
    expect(snap.table_count).toBe(0);
  });

  it("counts multiple tables separately", () => {
    const html = `<html><head>
      <title>Test</title>
      <meta name="description" content="Test">
      <link rel="canonical" href="${BASE_URL}">
    </head><body>
      <h1>Test Page</h1>
      <p>${"Content padding. ".repeat(20)}</p>
      <table><tr><td>A</td></tr><tr><td>B</td></tr></table>
      <table><tr><td>C</td></tr><tr><td>D</td></tr><tr><td>E</td></tr></table>
    </body></html>`;
    const snap = extractPageSnapshot(html, BASE_URL, "pg-1");
    expect(snap.table_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Recommendation gating tests (via computeRecommendations)
// ---------------------------------------------------------------------------

import { computeRecommendations } from "@/domains/product/recommendation-engine";
import type { PageSnapshot } from "@/domains/pages/types";

function makeMinimalSnapshot(url: string, overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url,
    h2_list: [],
    faqs: [],
    schema_types: [],
    table_count: 0,
    extraction_certainty: "confident",
    ...overrides,
  } as unknown as PageSnapshot;
}

describe("comparison table recommendation gating", () => {
  it("generates comparison rec for city page without table", () => {
    const snap = makeMinimalSnapshot("https://example.com/locations/atherton", {
      page_id: "pg-city",
      table_count: 0,
    });
    const citMap = new Map([
      ["https://example.com/locations/atherton", 100],
    ]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    const compRecs = recs.filter((r) => r.actionClass === "comparison_table");
    expect(compRecs.length).toBe(1);
    expect(compRecs[0].headline).toContain("comparison table");
    expect(compRecs[0].priority).toBeGreaterThanOrEqual(750);
  });

  it("does NOT generate comparison rec for city page WITH table", () => {
    const snap = makeMinimalSnapshot("https://example.com/locations/atherton", {
      page_id: "pg-city-table",
      table_count: 2,
    });
    const citMap = new Map([
      ["https://example.com/locations/atherton", 100],
    ]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    const compRecs = recs.filter((r) => r.actionClass === "comparison_table");
    expect(compRecs.length).toBe(0);
  });

  it("does NOT generate comparison rec for project page", () => {
    const snap = makeMinimalSnapshot("https://example.com/explore-projects/riverside", {
      page_id: "pg-project",
      table_count: 0,
    });
    const citMap = new Map([
      ["https://example.com/explore-projects/riverside", 50],
    ]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    const compRecs = recs.filter((r) => r.actionClass === "comparison_table");
    expect(compRecs.length).toBe(0);
  });

  it("does NOT generate comparison rec for about page", () => {
    const snap = makeMinimalSnapshot("https://example.com/about-us", {
      page_id: "pg-about",
      table_count: 0,
    });
    const citMap = new Map([
      ["https://example.com/about-us", 30],
    ]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    const compRecs = recs.filter((r) => r.actionClass === "comparison_table");
    expect(compRecs.length).toBe(0);
  });

  it("does NOT generate comparison rec for low-citation page", () => {
    const snap = makeMinimalSnapshot("https://example.com/locations/test-city", {
      page_id: "pg-low",
      table_count: 0,
    });
    const citMap = new Map([
      ["https://example.com/locations/test-city", 2], // Below threshold of 5
    ]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    const compRecs = recs.filter((r) => r.actionClass === "comparison_table");
    expect(compRecs.length).toBe(0);
  });

  it("generates comparison rec for service page without table", () => {
    const snap = makeMinimalSnapshot("https://example.com/services/kitchen-remodel", {
      page_id: "pg-service",
      table_count: 0,
    });
    const citMap = new Map([
      ["https://example.com/services/kitchen-remodel", 50],
    ]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    const compRecs = recs.filter((r) => r.actionClass === "comparison_table");
    expect(compRecs.length).toBe(1);
  });
});
