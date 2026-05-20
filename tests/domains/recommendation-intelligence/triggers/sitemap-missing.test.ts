/**
 * Slice 4.5.C.α₁ — `sitemap-missing` trigger predicate unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import { sitemapMissing } from "@/domains/recommendation-intelligence/triggers/sitemap-missing";

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
    urlPatterns: { city: "/locations/", service: "/services/" },
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
    ...overrides,
  };
}

function makeIndexability(
  verdict: IndexabilityVerdict,
  overrides: Partial<OwnedUrlIndexability> = {},
): OwnedUrlIndexability {
  return {
    url: "https://example.com/services/custom-homes",
    composite_verdict: verdict,
    signals: {
      sitemap_membership: { in_sitemap: false, sitemap_url: null },
      robots_txt: {
        googlebot_allowed: true,
        gptbot_allowed: true,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: true,
      },
      page_snapshot: {
        http_status: 200,
        canonical_url: null,
        has_canonical_mismatch: false,
        robots_meta: null,
        noindex_detected: false,
        fetched_at: "2026-05-20T00:00:00Z",
        extraction_certainty: "confirmed",
      },
      gsc: null,
    },
    last_computed_at: "2026-05-20T00:00:00Z",
    evidence_freshness_days: 0,
    ...overrides,
  };
}

describe("sitemapMissing predicate", () => {
  it("emits zero candidates when verdict is `ok`", () => {
    const out = sitemapMissing({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("ok"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when verdict is `unknown`", () => {
    const out = sitemapMissing({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("unknown"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when verdict is `bad_status_code` (higher-severity wins)", () => {
    const out = sitemapMissing({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("bad_status_code"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single candidate on a service page when verdict is `not_in_sitemap`", () => {
    const out = sitemapMissing({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/custom-homes",
      }),
      indexability: makeIndexability("not_in_sitemap"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("sitemap_missing");
    expect(row.action_type).toBe("fix_sitemap");
    expect(row.target_url).toBe("https://example.com/services/custom-homes");
    expect(row.confidence).toBe("high");
    expect(row.impact_estimate).toBe("medium");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.evidence.length).toBeGreaterThanOrEqual(1);
    expect(row.evidence[0]!.kind).toBe("page_snapshot");
    expect(row.evidence[0]!.detail ?? "").toContain("not_in_sitemap");
    expect(row.safety_flags).toEqual([]);
  });

  it("customer_copy uses the operator-locked phrasing", () => {
    const out = sitemapMissing({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("not_in_sitemap"),
      businessConfig: makeConfig(),
    });
    expect(out[0]!.customer_copy).toBe(
      "This URL is missing from your sitemap.xml. Add it and resubmit so AI search platforms can discover it.",
    );
  });

  it("fires on homepage / city / service / project / hub page types", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/",
      "https://example.com/locations/palo-alto",
      "https://example.com/services/custom-homes",
      "https://example.com/projects/atherton-modern",
      "https://example.com/locations", // hub
    ];
    for (const url of urls) {
      const out = sitemapMissing({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("not_in_sitemap"),
        businessConfig: cfg,
      });
      expect(out, `should fire on ${url}`).toHaveLength(1);
    }
  });

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
      const out = sitemapMissing({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("not_in_sitemap"),
        businessConfig: cfg,
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  it("operator_evidence carries the page_type for triage", () => {
    const out = sitemapMissing({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/custom-homes",
      }),
      indexability: makeIndexability("not_in_sitemap"),
      businessConfig: makeConfig(),
    });
    expect(out[0]!.operator_evidence).toContain("page_type=service");
    expect(out[0]!.operator_evidence).toContain("canonical_verdict=not_in_sitemap");
  });

  it("dedupe_key + cooldown_key are non-empty deterministic strings", () => {
    const out = sitemapMissing({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("not_in_sitemap"),
      businessConfig: makeConfig(),
    });
    expect(out[0]!.dedupe_key.length).toBeGreaterThan(0);
    expect(out[0]!.cooldown_key.length).toBeGreaterThan(0);
    // Same input → same keys (determinism).
    const again = sitemapMissing({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("not_in_sitemap"),
      businessConfig: makeConfig(),
    });
    expect(again[0]!.dedupe_key).toBe(out[0]!.dedupe_key);
  });
});
