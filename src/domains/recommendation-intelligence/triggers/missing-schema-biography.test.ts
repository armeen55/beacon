import { describe, it, expect } from "vitest";
import { missingSchema } from "./missing-schema";
import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

/**
 * Item 73 (2026-07-02), biography pages route through the SAME
 * `missing_schema_content` trigger (no parallel trigger). These tests
 * confirm the existing expected-schema diff machinery now catches a
 * biography page missing Person, while leaving non-biography content
 * pages and Article-satisfied biography pages unaffected.
 */

const CONTENT_SITE_CONFIG = {
  name: "Example Site",
  domain: "example.com",
  industry: "reference",
  phone: "",
  contentSiteMode: true,
} as BusinessConfig;

function snap(partial: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/people/jonas-kettering",
    canonical_url: null,
    fetched_at: "2026-07-02T00:00:00.000Z",
    http_status: 200,
    title: null,
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
    word_count: 500,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "h",
    faq_hash: "h",
    schema_hash: "h",
    extraction_certainty: "confirmed",
    body_paragraph_sample: [],
    tenant_id: "tenant-example",
    ...partial,
  } as PageSnapshot;
}

describe("missingSchema, biography Person gap (item 73)", () => {
  it("emits missing_schema_content when a biography page has Article but NOT Person", () => {
    const snapshot = snap({
      title: "Jonas Kettering",
      h1: "Jonas Kettering",
      schema_types: ["Article"],
      body_paragraph_sample: [
        "Jonas Kettering (1904-1978) was a poet known for his court odes.",
      ],
    });
    const rows = missingSchema({
      tenantId: "tenant-example",
      snapshot,
      businessConfig: CONTENT_SITE_CONFIG,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trigger_signal).toBe("missing_schema_content");
    expect(rows[0]!.operator_evidence).toContain("missing_required=[Person]");
    expect(rows[0]!.operator_evidence).toContain("biography");
  });

  it("does NOT fire when the biography page already has BOTH Article and Person", () => {
    const snapshot = snap({
      title: "Jonas Kettering",
      h1: "Jonas Kettering",
      schema_types: ["Article", "Person"],
      body_paragraph_sample: [
        "Jonas Kettering (1904-1978) was a poet known for his court odes.",
      ],
    });
    const rows = missingSchema({
      tenantId: "tenant-example",
      snapshot,
      businessConfig: CONTENT_SITE_CONFIG,
    });
    expect(rows).toHaveLength(0);
  });

  it("a non-biography content page missing Article behaves exactly as before (Article only, no Person requirement)", () => {
    const snapshot = snap({
      title: "How Rice Is Traditionally Cooked",
      h1: "How Rice Is Traditionally Cooked",
      schema_types: [],
      body_paragraph_sample: ["This page explains the traditional method."],
    });
    const rows = missingSchema({
      tenantId: "tenant-example",
      snapshot,
      businessConfig: CONTENT_SITE_CONFIG,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operator_evidence).toContain("missing_required=[Article]");
    expect(rows[0]!.operator_evidence).not.toContain("biography");
  });

  it("a non-biography content page WITH Article already present does not fire", () => {
    const snapshot = snap({
      title: "How Rice Is Traditionally Cooked",
      h1: "How Rice Is Traditionally Cooked",
      schema_types: ["Article"],
      body_paragraph_sample: ["This page explains the traditional method."],
    });
    const rows = missingSchema({
      tenantId: "tenant-example",
      snapshot,
      businessConfig: CONTENT_SITE_CONFIG,
    });
    expect(rows).toHaveLength(0);
  });
});
