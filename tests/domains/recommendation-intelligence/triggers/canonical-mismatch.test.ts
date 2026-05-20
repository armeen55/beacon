/**
 * Slice 4.5.C.α₁ — `canonical-mismatch` trigger predicate unit
 * tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import { canonicalMismatch } from "@/domains/recommendation-intelligence/triggers/canonical-mismatch";

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
    canonical_url: "https://example.com/other",
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
    has_canonical_mismatch: true,
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
  canonicalUrl: string | null = "https://example.com/other",
): OwnedUrlIndexability {
  return {
    url: "https://example.com/services/custom-homes",
    composite_verdict: verdict,
    signals: {
      sitemap_membership: { in_sitemap: true, sitemap_url: null },
      robots_txt: {
        googlebot_allowed: true,
        gptbot_allowed: true,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: true,
      },
      page_snapshot: {
        http_status: 200,
        canonical_url: canonicalUrl,
        has_canonical_mismatch: verdict === "canonical_elsewhere",
        robots_meta: null,
        noindex_detected: false,
        fetched_at: "2026-05-20T00:00:00Z",
        extraction_certainty: "confirmed",
      },
      gsc: null,
    },
    last_computed_at: "2026-05-20T00:00:00Z",
    evidence_freshness_days: 0,
  };
}

describe("canonicalMismatch predicate", () => {
  it("emits zero candidates when verdict is `ok`", () => {
    const out = canonicalMismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ has_canonical_mismatch: false }),
      indexability: makeIndexability("ok"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when verdict is `bad_status_code` (higher-severity wins)", () => {
    const out = canonicalMismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("bad_status_code"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single candidate on a service page when verdict is `canonical_elsewhere`", () => {
    const out = canonicalMismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("canonical_elsewhere"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("canonical_mismatch");
    expect(row.action_type).toBe("fix_canonical");
    expect(row.confidence).toBe("high");
    expect(row.impact_estimate).toBe("high");
    expect(row.customer_copy).toBe(
      "This page's canonical URL points to a different page. Update the canonical tag if this URL is the intended primary.",
    );
    expect(row.evidence[0]!.detail ?? "").toContain("canonical_elsewhere");
    expect(row.evidence[0]!.detail ?? "").toContain(
      "canonical_url=https://example.com/other",
    );
  });

  it("fires on homepage / city / service / project ONLY", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/",
      "https://example.com/locations/palo-alto",
      "https://example.com/services/custom-homes",
      "https://example.com/projects/atherton-modern",
    ];
    for (const url of urls) {
      const out = canonicalMismatch({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("canonical_elsewhere"),
        businessConfig: cfg,
      });
      expect(out, `should fire on ${url}`).toHaveLength(1);
    }
  });

  it("SKIPS hub / utility / other / technical_asset page types", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/locations", // hub
      "https://example.com/available-homes", // hub (universal)
      "https://example.com/privacy-policy", // utility
      "https://example.com/some-random-path", // other
      "https://example.com/llms.txt", // technical_asset
    ];
    for (const url of urls) {
      const out = canonicalMismatch({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("canonical_elsewhere"),
        businessConfig: cfg,
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  it("operator_evidence carries the canonical_url + page_type", () => {
    const out = canonicalMismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/custom-homes",
      }),
      indexability: makeIndexability(
        "canonical_elsewhere",
        "https://example.com/services/different-target",
      ),
      businessConfig: makeConfig(),
    });
    expect(out[0]!.operator_evidence).toContain("page_type=service");
    expect(out[0]!.operator_evidence).toContain(
      "page_snapshot.canonical_url=https://example.com/services/different-target",
    );
  });
});
