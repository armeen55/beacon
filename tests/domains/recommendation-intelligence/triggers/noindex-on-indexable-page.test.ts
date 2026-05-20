/**
 * Slice 4.5.C.α₂ — `noindex-on-indexable-page` Tier-2 sensitive
 * trigger predicate unit tests.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import { noindexOnIndexablePage } from "@/domains/recommendation-intelligence/triggers/noindex-on-indexable-page";

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
    robots_meta: "noindex",
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
  overrides: {
    extraction_certainty?: "confirmed" | "uncertain" | null;
    has_canonical_mismatch?: boolean | null;
    robots_meta?: string | null;
  } = {},
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
        canonical_url: null,
        has_canonical_mismatch: overrides.has_canonical_mismatch ?? false,
        robots_meta:
          overrides.robots_meta === undefined ? "noindex" : overrides.robots_meta,
        noindex_detected: verdict === "noindex_meta",
        fetched_at: "2026-05-20T00:00:00Z",
        extraction_certainty: overrides.extraction_certainty ?? "confirmed",
      },
      gsc: null,
    },
    last_computed_at: "2026-05-20T00:00:00Z",
    evidence_freshness_days: 0,
  };
}

describe("noindexOnIndexablePage predicate", () => {
  it("emits zero candidates when verdict is `ok`", () => {
    const out = noindexOnIndexablePage({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ robots_meta: null }),
      indexability: makeIndexability("ok", { robots_meta: null }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when verdict is `bad_status_code` (higher-severity wins)", () => {
    const out = noindexOnIndexablePage({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("bad_status_code"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single low-confidence candidate on a service page when verdict is `noindex_meta`", () => {
    const out = noindexOnIndexablePage({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("noindex_meta"),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("noindex_on_indexable_page");
    expect(row.action_type).toBe("fix_noindex");
    expect(row.confidence).toBe("low");
    expect(row.impact_estimate).toBe("high");
    expect(row.customer_copy).toBe(
      "This page sets a noindex meta tag. Remove it if this page should be discoverable in AI search.",
    );
    expect(row.evidence[0]!.detail ?? "").toContain("composite_verdict=noindex_meta");
    expect(row.evidence[0]!.detail ?? "").toContain("noindex_detected=true");
    expect(row.evidence[0]!.detail ?? "").toContain("page_type=service");
    expect(row.safety_flags).toEqual([]);
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
      const out = noindexOnIndexablePage({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("noindex_meta"),
        businessConfig: cfg,
      });
      expect(out, `should fire on ${url}`).toHaveLength(1);
    }
  });

  it("SKIPS hub / utility / other / technical_asset", () => {
    const cfg = makeConfig();
    const urls = [
      "https://example.com/locations", // hub
      "https://example.com/available-homes", // hub (universal)
      "https://example.com/privacy-policy", // utility
      "https://example.com/some-random-path", // other
      "https://example.com/llms.txt", // technical_asset
      "https://example.com/sitemap.xml", // technical_asset
    ];
    for (const url of urls) {
      const out = noindexOnIndexablePage({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url }),
        indexability: makeIndexability("noindex_meta"),
        businessConfig: cfg,
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  it("(safety guard) SKIPS when extraction_certainty is `uncertain`", () => {
    const out = noindexOnIndexablePage({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("noindex_meta", {
        extraction_certainty: "uncertain",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("(safety guard) SKIPS when has_canonical_mismatch is true (paginated/duplicate signature)", () => {
    const out = noindexOnIndexablePage({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ has_canonical_mismatch: true }),
      indexability: makeIndexability("noindex_meta", {
        has_canonical_mismatch: true,
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("evidence detail surfaces robots_meta + extraction_certainty + has_canonical_mismatch + page_type", () => {
    const out = noindexOnIndexablePage({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ robots_meta: "noindex, nofollow" }),
      indexability: makeIndexability("noindex_meta", {
        robots_meta: "noindex, nofollow",
        extraction_certainty: "confirmed",
        has_canonical_mismatch: false,
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    const detail = out[0]!.evidence[0]!.detail ?? "";
    expect(detail).toContain("robots_meta=noindex, nofollow");
    expect(detail).toContain("extraction_certainty=confirmed");
    expect(detail).toContain("has_canonical_mismatch=false");
    expect(detail).toContain("page_type=service");
  });

  it("operator_evidence carries fetched_at + page_type", () => {
    const out = noindexOnIndexablePage({
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("noindex_meta"),
      businessConfig: makeConfig(),
    });
    expect(out[0]!.operator_evidence).toContain("page_type=service");
    expect(out[0]!.operator_evidence).toContain("fetched_at=2026-05-20T00:00:00Z");
  });

  it("dedupe_key + cooldown_key are non-empty deterministic strings", () => {
    const inputs = {
      tenantId: "tenant-a",
      snapshot: makeSnapshot(),
      indexability: makeIndexability("noindex_meta"),
      businessConfig: makeConfig(),
    } as const;
    const a = noindexOnIndexablePage(inputs);
    const b = noindexOnIndexablePage(inputs);
    expect(a[0]!.dedupe_key.length).toBeGreaterThan(0);
    expect(a[0]!.cooldown_key.length).toBeGreaterThan(0);
    expect(a[0]!.dedupe_key).toBe(b[0]!.dedupe_key);
  });
});
