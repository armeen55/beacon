/**
 * Slice 4.5.C.α₃b — `missing-schema` Tier-2 sensitive per-snapshot
 * trigger predicate unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import { missingSchema } from "@/domains/recommendation-intelligence/triggers/missing-schema";

function makeConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    name: "Test",
    domain: "test.com",
    industry: "home-builder",
    phone: "",
    address: "",
    yelpBusinessId: "",
    houzzProfileUrl: "",
    angiProfileUrl: "",
    bbbProfileUrl: "",
    industryDirectoryProfileUrl: "",
    locations: ["Palo Alto"],
    services: ["custom home"],
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
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/services/custom-homes",
    canonical_url: null,
    fetched_at: "2026-05-20T00:00:00Z",
    http_status: 200,
    title: "A title",
    meta_description: "A meta",
    h1: "An h1",
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
    extraction_certainty: "confirmed",
    ...overrides,
  };
}

describe("missingSchema predicate", () => {
  // ── Positive emission per allowed page type ─────────────────────────

  it("emits a low-confidence candidate on a service page with empty schema_types", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ schema_types: [] }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("missing_schema");
    expect(row.action_type).toBe("add_schema");
    expect(row.confidence).toBe("low");
    expect(row.impact_estimate).toBe("medium");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.safety_flags).toEqual([]);
    expect(row.evidence[0]!.detail ?? "").toContain("asset_type=service_page");
    expect(row.evidence[0]!.detail ?? "").toContain("missing_required=");
  });

  it("emits on homepage with empty schema_types (FAQPage + LocalBusiness-family required)", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/",
        schema_types: [],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence[0]!.detail ?? "").toContain("asset_type=homepage");
  });

  it("emits on city page (city_page asset type) with empty schema_types", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        schema_types: [],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence[0]!.detail ?? "").toContain("asset_type=city_page");
  });

  it("emits on project page with empty schema_types", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/projects/atherton-modern",
        schema_types: [],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence[0]!.detail ?? "").toContain("asset_type=project_page");
  });

  it("emits on hub page with empty schema_types (BreadcrumbList + CollectionPage/ItemList required)", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations",
        schema_types: [],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence[0]!.detail ?? "").toContain("asset_type=hub_page");
  });

  // ── Negative emission ───────────────────────────────────────────────

  it("does NOT emit when all required schema types are present on a service page", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        // service_page required: FAQPage, BreadcrumbList, [Service | Offer]
        schema_types: ["FAQPage", "BreadcrumbList", "Service"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toEqual([]);
  });

  // ── oneOf semantics ─────────────────────────────────────────────────

  it("(oneOf) satisfies the [Service | Offer] requirement when EITHER is present", () => {
    // service_page requires FAQPage + BreadcrumbList + [Service | Offer].
    // With Offer present (alt of Service), no emission.
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        schema_types: ["FAQPage", "BreadcrumbList", "Offer"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toEqual([]);
  });

  it("(oneOf) EMITS when NONE of [Service | Offer] alternatives are present", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        // FAQPage + BreadcrumbList present, but neither Service nor Offer.
        schema_types: ["FAQPage", "BreadcrumbList"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    // Evidence MUST surface the (one of) representation from diffSchemaCoverage.
    expect(out[0]!.evidence[0]!.detail ?? "").toContain("(one of) Service | Offer");
  });

  it("(oneOf) homepage LocalBusiness alternatives — Organization counts as one-of", () => {
    // homepage requires FAQPage + [LocalBusiness | HomeAndConstructionBusiness |
    // ProfessionalService | Organization]. With Organization + FAQPage, satisfied.
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/",
        schema_types: ["FAQPage", "Organization"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toEqual([]);
  });

  // ── Safety guard: extraction_certainty ──────────────────────────────

  it("(safety guard) SKIPS when extraction_certainty is `uncertain`", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        extraction_certainty: "uncertain",
        schema_types: [],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toEqual([]);
  });

  // ── Page-type allowlist ─────────────────────────────────────────────

  it("SKIPS utility / other / technical_asset page types", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/privacy-policy", // utility
      "https://example.com/about-us", // utility
      "https://example.com/some-random-path", // other
      "https://example.com/llms.txt", // technical_asset
      "https://example.com/sitemap.xml", // technical_asset
    ];
    for (const url of urls) {
      const out = missingSchema({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url, schema_types: [] }),
        businessConfig: cfg,
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  // ── Recommended schema is evidence-only, not emit gate ─────────────

  it("does NOT emit when ONLY recommended schema is missing (required satisfied)", () => {
    // service_page required: FAQPage + BreadcrumbList + [Service|Offer].
    // Recommended: HowTo. With required satisfied but HowTo missing, no emit.
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        schema_types: ["FAQPage", "BreadcrumbList", "Service"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toEqual([]);
  });

  it("missing_recommended appears in operator_evidence (informational only)", () => {
    // service_page with required satisfied via Service, but HowTo (recommended)
    // missing. Required satisfied → no emit. So we use a fixture where required
    // IS missing AND recommended is also missing to verify the operator_evidence
    // surfaces missing_recommended.
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        schema_types: ["FAQPage"], // Missing BreadcrumbList + [Service|Offer]; HowTo also missing.
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.operator_evidence).toContain("missing_recommended=[HowTo]");
  });

  // ── Customer copy phrasing ──────────────────────────────────────────

  it("customer_copy uses the operator-locked phrasing", () => {
    const out = missingSchema({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ schema_types: [] }),
      businessConfig: makeConfig(),
    });
    expect(out[0]!.customer_copy).toBe(
      "Add structured data so AI search platforms can extract this page's purpose more reliably.",
    );
  });

  // ── Determinism ─────────────────────────────────────────────────────

  it("dedupe_key + cooldown_key are non-empty deterministic strings", () => {
    const inputs = {
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ schema_types: [] }),
      businessConfig: makeConfig(),
    } as const;
    const a = missingSchema(inputs);
    const b = missingSchema(inputs);
    expect(a[0]!.dedupe_key.length).toBeGreaterThan(0);
    expect(a[0]!.cooldown_key.length).toBeGreaterThan(0);
    expect(a[0]!.dedupe_key).toBe(b[0]!.dedupe_key);
  });
});
