/**
 * fix_schema slice (2026-06-12) — `invalid-schema` trigger predicate
 * unit tests. The predicate consumes the scanner's own per-page
 * validator output (PageSnapshot.schema_validation_warnings) and emits
 * `fix_schema` repair candidates at medium confidence.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import {
  actionableSchemaWarnings,
  invalidSchema,
} from "@/domains/recommendation-intelligence/triggers/invalid-schema";

function makeConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    name: "Test",
    domain: "test.com",
    industry: "encyclopedia",
    phone: "",
    address: "",
    yelpBusinessId: "",
    houzzProfileUrl: "",
    angiProfileUrl: "",
    bbbProfileUrl: "",
    industryDirectoryProfileUrl: "",
    locations: [],
    services: [],
    primaryCompetitors: [],
    keyPages: [],
    locationTerms: [],
    serviceTerms: [],
    directoryDomains: [],
    scanSettings: {
      preferredHour: 7,
      timezone: "UTC",
      scope: "priority",
      enabled: true,
    },
    urlPatterns: { city: "/locations/", service: "/services/", project: "/projects/" },
    contentSiteMode: true,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/product-page/iran-country-map",
    canonical_url: null,
    fetched_at: "2026-06-12T04:00:00Z",
    http_status: 200,
    title: "Iran Country Map",
    meta_description: "A map.",
    h1: "Iran Country Map",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: ["Product"],
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
    extraction_certainty: "confirmed",
    schema_validation_warnings: [
      "schema_warning:Product: Product missing offers block — price/availability rich results won't fire.",
    ],
    ...overrides,
  };
}

describe("actionableSchemaWarnings", () => {
  it("keeps critical + warning lines, drops info lines and unknown shapes", () => {
    expect(
      actionableSchemaWarnings([
        "schema_critical:FAQPage: Missing mainEntity.",
        "schema_warning:Product: Product missing offers block.",
        "schema_info:LocalBusiness: missing telephone.",
        "something_else_entirely",
      ]),
    ).toEqual([
      "schema_critical:FAQPage: Missing mainEntity.",
      "schema_warning:Product: Product missing offers block.",
    ]);
  });

  it("handles null / undefined / empty", () => {
    expect(actionableSchemaWarnings(null)).toEqual([]);
    expect(actionableSchemaWarnings(undefined)).toEqual([]);
    expect(actionableSchemaWarnings([])).toEqual([]);
  });
});

describe("invalidSchema predicate", () => {
  it("emits a fix_schema candidate at MEDIUM confidence on a page with warning-level validator output", () => {
    const out = invalidSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.trigger_signal).toBe("invalid_schema");
    expect(out[0]!.action_type).toBe("fix_schema");
    expect(out[0]!.confidence).toBe("medium");
    expect(out[0]!.impact_estimate).toBe("medium"); // warnings only
    expect(out[0]!.safety_flags).toEqual([]);
    expect(out[0]!.operator_evidence).toContain("Product missing offers block");
  });

  it("impact escalates to HIGH when any schema_critical line is present", () => {
    const out = invalidSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        schema_validation_warnings: [
          "schema_critical:FAQPage: Missing mainEntity.",
          "schema_warning:Product: Product missing offers block.",
        ],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.impact_estimate).toBe("high");
  });

  it("does NOT emit when only schema_info lines exist", () => {
    const out = invalidSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        schema_validation_warnings: [
          "schema_info:LocalBusiness: missing telephone — useful for 'call now' surfaces.",
        ],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toEqual([]);
  });

  it("does NOT emit when warnings are absent (clean page)", () => {
    const out = invalidSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ schema_validation_warnings: undefined }),
      businessConfig: makeConfig(),
    });
    expect(out).toEqual([]);
  });

  it("does NOT emit when extraction certainty is uncertain", () => {
    const out = invalidSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ extraction_certainty: "uncertain" }),
      businessConfig: makeConfig(),
    });
    expect(out).toEqual([]);
  });
});
