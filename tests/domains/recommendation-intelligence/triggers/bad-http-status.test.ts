/**
 * Slice 4.5.C.α₁ — `bad-http-status` trigger predicate unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import { badHttpStatus } from "@/domains/recommendation-intelligence/triggers/bad-http-status";

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
    http_status: 404,
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
  httpStatus: number | null = null,
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
        http_status: httpStatus,
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
  };
}

describe("badHttpStatus predicate", () => {
  it("emits zero candidates when verdict is `ok`", () => {
    const out = badHttpStatus({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("ok", 200),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when verdict is `not_in_sitemap`", () => {
    const out = badHttpStatus({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("not_in_sitemap"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single candidate on 404 status", () => {
    const out = badHttpStatus({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("bad_status_code", 404),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("bad_http_status");
    expect(row.action_type).toBe("fix_status_code");
    expect(row.confidence).toBe("high");
    expect(row.impact_estimate).toBe("high");
    expect(row.customer_copy).toBe(
      "This URL returns an error or redirect. Restore a clean 200 response so AI search platforms can index this page.",
    );
    expect(row.evidence[0]!.detail ?? "").toContain("http_status=404");
    expect(row.operator_evidence).toContain("redirect=false");
  });

  it("emits a single candidate on 500 status", () => {
    const out = badHttpStatus({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("bad_status_code", 500),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence[0]!.detail ?? "").toContain("http_status=500");
  });

  it("emits a single candidate on 301 redirect (redirect=true in operator_evidence)", () => {
    const out = badHttpStatus({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("bad_status_code", 301),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.operator_evidence).toContain("redirect=true");
  });

  it("emits a single candidate on 302/307/308 redirects", () => {
    for (const code of [302, 307, 308]) {
      const out = badHttpStatus({
        tenantId: "tenant-a",
        snapshot: makeSnapshot(),
        indexability: makeIndexability("bad_status_code", code),
        businessConfig: makeConfig(),
      });
      expect(out, `code=${code}`).toHaveLength(1);
      expect(out[0]!.operator_evidence).toContain("redirect=true");
    }
  });

  it("fires on every HTML page type", () => {
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
      const out = badHttpStatus({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("bad_status_code", 404),
        businessConfig: cfg,
      });
      expect(out, `should fire on ${url}`).toHaveLength(1);
    }
  });

  it("SKIPS technical assets", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/llms.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/image.png",
    ];
    for (const url of urls) {
      const out = badHttpStatus({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("bad_status_code", 404),
        businessConfig: cfg,
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });
});
