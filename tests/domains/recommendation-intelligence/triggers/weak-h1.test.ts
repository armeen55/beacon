/**
 * Slice 4.5.B.α₁ — trigger predicate `weak-h1` unit tests.
 *
 * Page-type-gated. Fires only on city + service pages when H1
 * lacks the corresponding modifier dimension. Skips homepage,
 * project, other page types entirely. Skips when the relevant
 * business-config dimension is empty.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import { weakH1 } from "@/domains/recommendation-intelligence/triggers/weak-h1";

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/locations/palo-alto",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "Real title",
    meta_description: "Real meta",
    h1: "Palo Alto Custom Home",
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

function makeConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    name: "Ritz Builders",
    domain: "ritzbuilders.com",
    industry: "home-builder",
    phone: "",
    address: "",
    yelpBusinessId: "",
    houzzProfileUrl: "",
    angiProfileUrl: "",
    bbbProfileUrl: "",
    industryDirectoryProfileUrl: "",
    locations: ["Palo Alto", "Menlo Park"],
    services: ["custom home", "remodel"],
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
    urlPatterns: {
      city: "/locations/",
      service: "/services/",
      project: "/projects/",
    },
    ...overrides,
  };
}

describe("weakH1 predicate — city page type", () => {
  it("fires when city h1 lacks any location term", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h1: "Welcome to Our Building Services",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.trigger_signal).toBe("weak_h1");
    expect(out[0]!.action_type).toBe("change_h1");
    expect(out[0]!.confidence).toBe("medium");
    expect(out[0]!.operator_evidence).toContain("page_type=city");
    expect(out[0]!.operator_evidence).toContain("missing_dimension=location");
  });

  it("suppresses when city h1 contains a location term (case-insensitive)", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h1: "Custom Home Builder in palo alto",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("suppresses when locations dimension is empty (graceful degradation)", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h1: "Welcome to Our Building Services",
      }),
      businessConfig: makeConfig({ locations: [], locationTerms: [] }),
    });
    expect(out).toHaveLength(0);
  });

  it("uses locationTerms fallback when present (mirrors getLocationRegex)", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h1: "Welcome to atherton excellence",
      }),
      businessConfig: makeConfig({
        locations: ["Palo Alto"],
        locationTerms: ["Atherton", "Menlo Park"],
      }),
    });
    expect(out).toHaveLength(0); // "atherton" matches locationTerms[0]
  });
});

describe("weakH1 predicate — service page type", () => {
  it("fires when service h1 lacks any service term", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/whole-home",
        h1: "Welcome to Excellence",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.operator_evidence).toContain("page_type=service");
    expect(out[0]!.operator_evidence).toContain("missing_dimension=service");
  });

  it("suppresses when service h1 contains a service term", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/whole-home",
        h1: "Custom Home Construction Excellence",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("suppresses when services dimension is empty", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/whole-home",
        h1: "Welcome",
      }),
      businessConfig: makeConfig({ services: [], serviceTerms: [] }),
    });
    expect(out).toHaveLength(0);
  });
});

describe("weakH1 predicate — page-type gate", () => {
  it("skips homepage entirely", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/",
        h1: "Welcome",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips project pages", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/projects/atherton-modern",
        h1: "Project Showcase",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips other / about / contact / FAQ pages", () => {
    const urls = [
      "https://example.com/about",
      "https://example.com/contact",
      "https://example.com/faq",
      "https://example.com/blog/some-post",
    ];
    for (const url of urls) {
      const out = weakH1({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url, h1: "Generic heading" }),
        businessConfig: makeConfig(),
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  it("uses urlPatterns.city / .service for primary classification", () => {
    // Override urlPatterns so /loc/* (not /locations/*) is the city
    // path; ensure the override is respected.
    const cfg = makeConfig({
      urlPatterns: { city: "/loc/", service: "/svc/" },
    });
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/loc/palo-alto",
        h1: "Welcome",
      }),
      businessConfig: cfg,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.operator_evidence).toContain("page_type=city");
  });
});

describe("weakH1 predicate — α₂.2 hub + technical-asset skip", () => {
  it("(α₂.2) SKIPS city hub (urlPatterns.city prefix without detail slug)", () => {
    // Pre-α₂.2 the inline `classifyForGate` used substring
    // includes(), so `/locations` matched `urlPatterns.city:
    // "/locations/"` and false-positive'd as a city page. With the
    // shared page-classifier, segment-bounded matching correctly
    // classifies `/locations` (no detail slug) as "hub" → skip.
    for (const url of [
      "https://example.com/locations",
      "https://example.com/locations/",
    ]) {
      const out = weakH1({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({
          url,
          h1: "Welcome to Excellence",
        }),
        businessConfig: makeConfig(),
      });
      expect(out, `should skip city hub ${url}`).toHaveLength(0);
    }
  });

  it("(α₂.2) SKIPS service hub (urlPatterns.service prefix without detail slug)", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services",
        h1: "Welcome",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("(α₂.2) SKIPS technical assets", () => {
    for (const url of [
      "https://example.com/llms.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/image.jpg",
    ]) {
      const out = weakH1({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url, h1: "Welcome" }),
        businessConfig: makeConfig(),
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  it("(α₂.2) SKIPS utility pages (privacy / about / contact / faq / etc.)", () => {
    for (const url of [
      "https://example.com/privacy-policy",
      "https://example.com/about-us",
      "https://example.com/contact-us",
      "https://example.com/faq",
    ]) {
      const out = weakH1({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url, h1: "Welcome" }),
        businessConfig: makeConfig(),
      });
      expect(out, `should skip utility ${url}`).toHaveLength(0);
    }
  });
});

describe("weakH1 predicate — defensive behavior", () => {
  it("emits zero candidates when h1 is null (missing-h1 owns this case)", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h1: null,
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("emits zero candidates when h1 is whitespace-only", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h1: "   ",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("customer_copy passes operator-locked phrasing", () => {
    const out = weakH1({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h1: "Welcome",
      }),
      businessConfig: makeConfig(),
    });
    expect(out[0]!.customer_copy).toBe(
      "Strengthen the H1 to include the right service or location so AI search platforms can anchor the page intent.",
    );
  });
});
