/**
 * Slice 4.5.C.α₁ — `robots-blocks-googlebot` trigger predicate
 * unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import { robotsBlocksGooglebot } from "@/domains/recommendation-intelligence/triggers/robots-blocks-googlebot";

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
      sitemap_membership: { in_sitemap: true, sitemap_url: null },
      robots_txt: {
        googlebot_allowed:
          verdict === "blocked_by_robots_for_googlebot" ? false : true,
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

describe("robotsBlocksGooglebot predicate", () => {
  it("emits zero candidates when verdict is `ok`", () => {
    const out = robotsBlocksGooglebot({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("ok"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when verdict is `not_in_sitemap`", () => {
    const out = robotsBlocksGooglebot({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("not_in_sitemap"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when verdict is `blocked_by_robots_for_ai` (not googlebot)", () => {
    const out = robotsBlocksGooglebot({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("blocked_by_robots_for_ai"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single candidate when verdict is `blocked_by_robots_for_googlebot`", () => {
    const out = robotsBlocksGooglebot({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("blocked_by_robots_for_googlebot"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("robots_blocks_googlebot");
    expect(row.action_type).toBe("fix_robots");
    expect(row.confidence).toBe("high");
    expect(row.impact_estimate).toBe("high");
    expect(row.customer_copy).toBe(
      "Your robots.txt blocks this URL. Update the rule so AI search platforms and Googlebot can crawl this page.",
    );
  });

  it("fires on every HTML page type (homepage / city / service / project / hub / utility / other)", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/",
      "https://example.com/locations/palo-alto",
      "https://example.com/services/custom-homes",
      "https://example.com/projects/atherton-modern",
      "https://example.com/locations",
      "https://example.com/privacy-policy",
      "https://example.com/some-random-path",
    ];
    for (const url of urls) {
      const out = robotsBlocksGooglebot({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("blocked_by_robots_for_googlebot"),
        businessConfig: cfg,
      });
      expect(out, `should fire on ${url}`).toHaveLength(1);
    }
  });

  it("SKIPS technical assets (`.txt`, `.xml`, `.json`, etc.)", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/llms.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/data.json",
      "https://example.com/file.pdf",
    ];
    for (const url of urls) {
      const out = robotsBlocksGooglebot({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("blocked_by_robots_for_googlebot"),
        businessConfig: cfg,
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  it("evidence detail references the verdict + googlebot_allowed=false", () => {
    const out = robotsBlocksGooglebot({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("blocked_by_robots_for_googlebot"),
      businessConfig: makeConfig(),
    });
    expect(out[0]!.evidence[0]!.detail ?? "").toContain(
      "blocked_by_robots_for_googlebot",
    );
    expect(out[0]!.evidence[0]!.detail ?? "").toContain("googlebot_allowed=false");
  });
});
