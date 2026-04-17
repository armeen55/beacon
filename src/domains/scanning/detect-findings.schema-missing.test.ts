/**
 * Phase 1 — Tests for `schema_missing_for_page_type` detector.
 *
 * Covers:
 *   - One assertion per row of the severity ladder
 *   - Does NOT emit when satisfies_all_required
 *   - Emits one finding per missing-requirement page
 *   - Dedupe-friendly id shape (same type+url across scan runs)
 *   - Non-content asset types (sitemap/infrastructure) never emit
 */

import { describe, it, expect } from "vitest";
import { generateFindings } from "./detect-findings";
import type { PageSnapshot } from "@/domains/pages/types";

function snap(
  overrides: Partial<PageSnapshot> & Pick<PageSnapshot, "url">,
): PageSnapshot {
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
    content_hash: "c-test",
    headings_hash: "h-test",
    faq_hash: "f-test",
    schema_hash: "s-test",
    extraction_certainty: "confirmed",
    faq_schema_block_count: 0,
    table_count: 0,
    tenant_id: "",
    observation_run_id: "obs-test",
  } as PageSnapshot;
  return { ...base, ...overrides };
}

describe("generateFindings — schema_missing_for_page_type detector", () => {
  const baseOpts = {
    previousSnapshots: [] as PageSnapshot[],
    currentGuardrails: [],
    previousGuardrails: [],
    changelog: [],
    scanRunId: "obs-test",
  };

  it("emits for city_page with FAQPage only (3 missing required)", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({ url: "https://example.com/locations/palo-alto", schema_types: ["FAQPage"] }),
      ],
    });
    const schemaFindings = findings.filter((f) => f.type === "schema_missing_for_page_type");
    expect(schemaFindings).toHaveLength(1);
    expect(schemaFindings[0].currentState).toContain("BreadcrumbList");
    expect(schemaFindings[0].currentState).toContain("WebPage");
    expect(schemaFindings[0].currentState).toContain("HomeAndConstructionBusiness");
  });

  it("does NOT emit when all required types are present (menlo-park control)", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({
          url: "https://example.com/locations/menlo-park",
          schema_types: [
            "BreadcrumbList",
            "FAQPage",
            "HomeAndConstructionBusiness",
            "WebPage",
          ],
        }),
      ],
    });
    const schemaFindings = findings.filter((f) => f.type === "schema_missing_for_page_type");
    expect(schemaFindings).toHaveLength(0);
  });

  it("does NOT emit for non-content asset types (sitemap, infrastructure)", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({ url: "https://example.com/llms.txt", schema_types: [] }),
        snap({ url: "https://example.com/sitemap.xml", schema_types: [] }),
      ],
    });
    expect(findings.filter((f) => f.type === "schema_missing_for_page_type")).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Severity ladder
  // -----------------------------------------------------------------------

  it("severity = high when homepage has >50 citations and missing schema", () => {
    // norm() strips scheme+host and trailing slash, so homepage URL maps to "".
    const citationsByUrl = new Map([["", 100]]);
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [snap({ url: "https://example.com/", schema_types: [] })],
      citationsByUrl,
      homepageUrl: "https://example.com/",
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.severity).toBe("high");
  });

  it("severity = high when city_page has >50 citations and missing schema", () => {
    const citationsByUrl = new Map([["/locations/palo-alto", 250]]);
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({ url: "https://example.com/locations/palo-alto", schema_types: ["FAQPage"] }),
      ],
      citationsByUrl,
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.severity).toBe("high");
  });

  it("severity = medium when citations <=50 but >= 2 missing types", () => {
    const citationsByUrl = new Map([["/locations/atherton", 30]]);
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({ url: "https://example.com/locations/atherton", schema_types: ["FAQPage"] }),
      ],
      citationsByUrl,
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.severity).toBe("medium");
  });

  it("severity = medium when no citations at all but >= 2 missing", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({ url: "https://example.com/locations/new-city", schema_types: ["FAQPage"] }),
      ],
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.severity).toBe("medium");
  });

  it("severity = low when only 1 missing type", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({
          url: "https://example.com/our-process",
          schema_types: ["FAQPage"], // process_page requires FAQPage + HowTo → missing 1
        }),
      ],
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.severity).toBe("low");
  });

  // -----------------------------------------------------------------------
  // Emitter shape
  // -----------------------------------------------------------------------

  it("finding.summary mentions the asset_type and missing count", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({ url: "https://example.com/locations/palo-alto", schema_types: ["FAQPage"] }),
      ],
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.summary).toContain("city page");
    expect(f?.summary).toMatch(/missing\s+3\s+required/);
    expect(f?.summary).toContain("BreadcrumbList");
  });

  it("finding.suggestedAction lists the missing types + warns against visible-content changes", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({
          url: "https://example.com/explore-projects/my-project",
          schema_types: ["FAQPage"],
        }),
      ],
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.suggestedAction).toContain("Article");
    expect(f?.suggestedAction).toContain("BreadcrumbList");
    expect(f?.suggestedAction).toContain("Do not change visible content");
  });

  it("finding.previousState shows current schema_types, currentState shows missing", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({
          url: "https://example.com/locations/atherton",
          schema_types: ["FAQPage"],
        }),
      ],
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.previousState).toBe("schema_types: [FAQPage]");
    expect(f?.currentState).toMatch(/missing_required:/);
  });

  it("finding.citationCount is threaded through when provided", () => {
    const citationsByUrl = new Map([["/locations/palo-alto", 42]]);
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({ url: "https://example.com/locations/palo-alto", schema_types: ["FAQPage"] }),
      ],
      citationsByUrl,
    });
    const f = findings.find((x) => x.type === "schema_missing_for_page_type");
    expect(f?.citationCount).toBe(42);
  });

  // -----------------------------------------------------------------------
  // Integration: works alongside other finding types without cross-effects
  // -----------------------------------------------------------------------

  it("emits schema-missing findings independent of diff-based findings", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({
          url: "https://example.com/locations/palo-alto",
          schema_types: ["FAQPage"],
          faqs: [
            {
              question: "q",
              answer: "a",
              answer_excerpt: "a",
              source: "visible",
            } as unknown as PageSnapshot["faqs"][number],
          ],
          faq_schema_block_count: 1,
        }),
      ],
    });
    // Should emit schema_missing_for_page_type but NOT faq_without_schema
    // (schema_types includes FAQPage and faq_schema_block_count=1).
    const types = new Set(findings.map((f) => f.type));
    expect(types.has("schema_missing_for_page_type")).toBe(true);
    expect(types.has("faq_without_schema")).toBe(false);
  });

  it("emits one finding per URL (not per missing type)", () => {
    const findings = generateFindings({
      ...baseOpts,
      currentSnapshots: [
        snap({ url: "https://example.com/locations/palo-alto", schema_types: ["FAQPage"] }),
        snap({ url: "https://example.com/locations/atherton", schema_types: ["FAQPage"] }),
      ],
    });
    const schemaFindings = findings.filter((f) => f.type === "schema_missing_for_page_type");
    // 2 URLs, each missing 3 types, but only ONE finding per URL
    expect(schemaFindings).toHaveLength(2);
  });
});
