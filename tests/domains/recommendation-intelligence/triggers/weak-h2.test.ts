/**
 * Slice 4.5.E.α₁a (2026-05-21) — trigger predicate `weak-h2`
 * unit tests.
 *
 * Mirrors weak-h1 behavior with two intentional deltas:
 *   • Emits `action_type: "rewrite_h2"` (requires proposed text;
 *     LLM gateway drafts in α₁b).
 *   • Emits `generator_kind: "llm_assisted"` (NOT deterministic).
 *
 * Page-type-gated to city / service detail pages. Skips homepage,
 * project, hub, utility, other. Per-page emission (one candidate
 * regardless of how many H2s are weak on the page).
 *
 * No LLM call in this predicate — it is the pure detection layer.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import { weakH2 } from "@/domains/recommendation-intelligence/triggers/weak-h2";
import { rewriteH2Copy } from "@/domains/recommendation-intelligence/customer-copy-templates";

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/locations/palo-alto",
    canonical_url: null,
    fetched_at: "2026-05-21T00:00:00Z",
    http_status: 200,
    title: "Real title",
    meta_description: "Real meta",
    h1: "Palo Alto Custom Home",
    h2_list: ["Palo Alto Project Process"], // contains location term by default
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

// ─────────────────────────────────────────────────────────────
// Page-type gating
// ─────────────────────────────────────────────────────────────

describe("weakH2 — page-type gating", () => {
  it("fires on city page when at least one H2 lacks any location term", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h2_list: ["Why Choose Us", "Our Services"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.target_url).toBe(
      "https://example.com/locations/palo-alto",
    );
  });

  it("fires on service page when at least one H2 lacks any service term", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/custom-homes",
        h2_list: ["Welcome", "Why Choose Us"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
  });

  it("skips homepage", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/",
        h2_list: ["Anything"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips project pages", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/projects/atherton-build",
        h2_list: ["Anything"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips hub URLs (e.g. /locations index)", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations",
        h2_list: ["Anything"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Modifier-overlap detection
// ─────────────────────────────────────────────────────────────

describe("weakH2 — modifier overlap", () => {
  it("city page with H2 containing a location term → skips", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h2_list: ["Palo Alto Building Process"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("service page with H2 containing a service term → skips", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/custom-homes",
        h2_list: ["Custom Home Process"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("city page with mixed H2s — some weak, some strong — fires (per-page emission)", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h2_list: [
          "Palo Alto Process", // strong (contains location)
          "Why Choose Us", // weak (no location)
          "Menlo Park Reviews", // strong (contains location)
        ],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    // Operator evidence carries ONLY the weak H2 (index 1).
    expect(out[0]!.operator_evidence).toContain('h2[1]="Why Choose Us"');
    expect(out[0]!.operator_evidence).not.toContain("h2[0]=");
    expect(out[0]!.operator_evidence).not.toContain("h2[2]=");
    expect(out[0]!.operator_evidence).toContain("weak_h2_count=1");
  });

  it("multiple weak H2s on one page → exactly ONE candidate emitted", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h2_list: ["Why Choose Us", "Our Services", "Get in Touch"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.operator_evidence).toContain("weak_h2_count=3");
    expect(out[0]!.operator_evidence).toContain('h2[0]="Why Choose Us"');
    expect(out[0]!.operator_evidence).toContain('h2[1]="Our Services"');
    expect(out[0]!.operator_evidence).toContain('h2[2]="Get in Touch"');
  });
});

// ─────────────────────────────────────────────────────────────
// Skip conditions
// ─────────────────────────────────────────────────────────────

describe("weakH2 — skip conditions", () => {
  it("skips when h2_list is empty", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h2_list: [],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips when extraction_certainty is 'uncertain'", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h2_list: ["Why Choose Us"],
        extraction_certainty: "uncertain",
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips non-HTML assets (e.g. /sitemap.xml)", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/sitemap.xml",
        h2_list: ["Anything"],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips when only H2 entries are null/blank", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h2_list: ["", "   ", ""],
      }),
      businessConfig: makeConfig(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips when business-config has no location terms (city page)", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h2_list: ["Why Choose Us"],
      }),
      businessConfig: makeConfig({
        locations: [],
        locationTerms: [],
      }),
    });
    expect(out).toHaveLength(0);
  });

  it("skips when business-config has no service terms (service page)", () => {
    const out = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/custom-homes",
        h2_list: ["Welcome"],
      }),
      businessConfig: makeConfig({
        services: [],
        serviceTerms: [],
      }),
    });
    expect(out).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Candidate row shape pins
// ─────────────────────────────────────────────────────────────

describe("weakH2 — candidate row shape", () => {
  const baseSnapshot = makeSnapshot({
    url: "https://example.com/locations/palo-alto",
    h2_list: ["Why Choose Us"],
  });
  const out = weakH2({
    tenantId: "tenant-a",
    snapshot: baseSnapshot,
    businessConfig: makeConfig(),
  });
  const row = out[0]!;

  it("trigger_signal is 'weak_h2'", () => {
    expect(row.trigger_signal).toBe("weak_h2");
  });

  it("action_type is 'rewrite_h2'", () => {
    expect(row.action_type).toBe("rewrite_h2");
  });

  it("generator_kind is 'llm_assisted' (NOT 'deterministic')", () => {
    expect(row.generator_kind).toBe("llm_assisted");
  });

  it("confidence is 'low' (forces diagnostic_only routing)", () => {
    expect(row.confidence).toBe("low");
  });

  it("impact_estimate is 'medium'", () => {
    expect(row.impact_estimate).toBe("medium");
  });

  it("customer_copy is exactly rewriteH2Copy()", () => {
    expect(row.customer_copy).toBe(rewriteH2Copy());
  });

  it("operator_evidence includes the weak H2 text + index + missing dimension", () => {
    expect(row.operator_evidence).toContain('h2[0]="Why Choose Us"');
    expect(row.operator_evidence).toContain("missing_dimension=location");
    expect(row.operator_evidence).toContain("page_type=city");
  });

  it("evidence carries page_snapshot + business_config refs", () => {
    expect(row.evidence).toHaveLength(2);
    expect(row.evidence[0]!.kind).toBe("page_snapshot");
    expect(row.evidence[1]!.kind).toBe("business_config");
  });

  it("target_url equals the snapshot URL", () => {
    expect(row.target_url).toBe(baseSnapshot.url);
  });

  it("safety_flags is empty (no policy risk for H2 rewrites)", () => {
    expect(row.safety_flags).toEqual([]);
  });

  it("dedupe_key and cooldown_key are deterministic non-empty hashes", () => {
    expect(typeof row.dedupe_key).toBe("string");
    expect(row.dedupe_key.length).toBeGreaterThan(0);
    expect(typeof row.cooldown_key).toBe("string");
    expect(row.cooldown_key.length).toBeGreaterThan(0);
    expect(row.dedupe_key).not.toBe(row.cooldown_key);
  });

  it("created_from_signal_at mirrors snapshot.fetched_at", () => {
    expect(row.created_from_signal_at).toBe(baseSnapshot.fetched_at);
  });

  it("topic_cluster_label is the operator-locked literal", () => {
    expect(row.topic_cluster_label).toBe("H2 heading");
  });
});

// ─────────────────────────────────────────────────────────────
// Service-page service-term overlap (mirror of city/location)
// ─────────────────────────────────────────────────────────────

describe("weakH2 — service page service-term resolution", () => {
  it("uses serviceTerms when present; otherwise services base list", () => {
    const out1 = weakH2({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        url: "https://example.com/services/custom-homes",
        h2_list: ["Welcome"],
      }),
      businessConfig: makeConfig({
        services: ["custom home"],
        serviceTerms: [],
      }),
    });
    expect(out1).toHaveLength(1);
    expect(out1[0]!.operator_evidence).toContain("missing_dimension=service");
  });
});
