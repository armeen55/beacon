/**
 * Slice 4.5.B.α₁ + α₂.2 — trigger predicate `title-h1-mismatch`
 * unit tests.
 *
 * α₂.2 added a page-type allowlist (homepage / city / service)
 * via the shared page-classifier. Default snapshot URL is a city
 * detail page so the legacy α₁ tests for Jaccard / stopword /
 * paired-emission behavior continue to fire as before.
 *
 * Stopword-aware Jaccard ≥ 0.3 suppresses; below 0.3 fires PAIRED
 * candidates (edit_title + change_h1) with distinct dedupe_keys.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import { titleH1Mismatch } from "@/domains/recommendation-intelligence/triggers/title-h1-mismatch";

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    // α₂.2: default URL is a city detail page (matches
    // urlPatterns.city `/locations/` + has detail slug) so the
    // legacy α₁ alignment / stopword / paired-emission tests
    // continue to fire as before.
    url: "https://example.com/locations/palo-alto",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "Whole Home Remodel in Palo Alto",
    meta_description: "Meta",
    h1: "Whole Home Remodel",
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
      scope: "priority" as const,
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

function runPredicate(
  snap: PageSnapshot,
  config: BusinessConfig = makeConfig(),
) {
  return titleH1Mismatch({
    tenantId: "tenant-a",
    snapshot: snap,
    businessConfig: config,
  });
}

describe("titleH1Mismatch predicate — alignment", () => {
  it("suppresses when title and h1 align (high Jaccard)", () => {
    const out = runPredicate(
      makeSnapshot({
        title: "Whole Home Remodel in Palo Alto",
        h1: "Whole Home Remodel in Palo Alto",
      }),
    );
    expect(out).toHaveLength(0);
  });

  it("suppresses when token overlap is partial but above threshold", () => {
    // title: {whole, home, remodel, palo, alto} (5 tokens)
    // h1:    {whole, home, remodel}             (3 tokens)
    // intersection: 3; union: 5; jaccard: 0.6 ≥ 0.3 → suppress
    const out = runPredicate(
      makeSnapshot({
        title: "Whole Home Remodel in Palo Alto",
        h1: "Whole Home Remodel",
      }),
    );
    expect(out).toHaveLength(0);
  });

  it("fires when token overlap is below threshold", () => {
    // title: {whole, home, remodel}      (3 tokens, "in" stripped)
    // h1:    {atherton, excellence}      (2 tokens)
    // intersection: 0; union: 5; jaccard: 0 < 0.3 → FIRE
    const out = runPredicate(
      makeSnapshot({
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    );
    expect(out).toHaveLength(2);
  });
});

describe("titleH1Mismatch predicate — paired emission", () => {
  it("fires both edit_title and change_h1 candidates with distinct dedupe_keys", () => {
    const out = runPredicate(
      makeSnapshot({
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    );
    expect(out).toHaveLength(2);
    const actionTypes = out.map((r) => r.action_type).sort();
    expect(actionTypes).toEqual(["change_h1", "edit_title"]);
    expect(out[0]!.dedupe_key).not.toBe(out[1]!.dedupe_key);
    // Same trigger_signal across both rows.
    expect(out[0]!.trigger_signal).toBe("title_h1_mismatch");
    expect(out[1]!.trigger_signal).toBe("title_h1_mismatch");
    // Cooldown keys also differ (action_type contributes).
    expect(out[0]!.cooldown_key).not.toBe(out[1]!.cooldown_key);
  });

  it("paired rows share confidence, impact, customer_copy, target_url, evidence", () => {
    const out = runPredicate(
      makeSnapshot({
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    );
    expect(out[0]!.confidence).toBe(out[1]!.confidence);
    expect(out[0]!.confidence).toBe("medium");
    expect(out[0]!.impact_estimate).toBe(out[1]!.impact_estimate);
    expect(out[0]!.customer_copy).toBe(out[1]!.customer_copy);
    expect(out[0]!.target_url).toBe(out[1]!.target_url);
    expect(out[0]!.operator_evidence).toBe(out[1]!.operator_evidence);
  });
});

describe("titleH1Mismatch predicate — stopword handling", () => {
  it("strips universal stopwords before Jaccard so 'in/the/of' alignment does not save", () => {
    // After stopword strip:
    // title: {custom, builder} (2 tokens; "the", "best")
    // h1:    {atherton} (1 token; "the")
    // intersection: 0; union: 3; jaccard: 0 < 0.3 → FIRE
    const out = runPredicate(
      makeSnapshot({
        title: "The Best Custom Builder",
        h1: "The Atherton",
      }),
    );
    expect(out).toHaveLength(2);
  });

  it("suppresses tokens of length < 2", () => {
    // "X" + "I" + "1" — all length-1 tokens are stripped from
    // tokenization. Keeps only multi-char tokens.
    const out = runPredicate(
      makeSnapshot({
        title: "X home",
        h1: "I home",
      }),
    );
    // Both tokenize to {home} → jaccard 1.0 → suppress.
    expect(out).toHaveLength(0);
  });

  it("keeps numeric tokens (years, zips, phones) when length >= 2", () => {
    const out = runPredicate(
      makeSnapshot({
        title: "Atherton 94027 Homes",
        h1: "94027 Builders",
      }),
    );
    // title: {atherton, 94027, homes}
    // h1:    {94027, builders}
    // intersection: 1 ({94027}); union: 4; jaccard: 0.25 < 0.3 → FIRE
    expect(out).toHaveLength(2);
  });
});

describe("titleH1Mismatch predicate — defensive behavior", () => {
  it("skips when title is null", () => {
    const out = runPredicate(makeSnapshot({ title: null, h1: "Some heading" }));
    expect(out).toHaveLength(0);
  });

  it("skips when h1 is null", () => {
    const out = runPredicate(makeSnapshot({ title: "Some title", h1: null }));
    expect(out).toHaveLength(0);
  });

  it("skips when title is empty", () => {
    const out = runPredicate(makeSnapshot({ title: "  ", h1: "Heading" }));
    expect(out).toHaveLength(0);
  });

  it("skips when h1 is empty", () => {
    const out = runPredicate(makeSnapshot({ title: "Title", h1: "" }));
    expect(out).toHaveLength(0);
  });

  it("skips when tokenization yields empty sets (all stopwords)", () => {
    const out = runPredicate(
      makeSnapshot({
        title: "the a an",
        h1: "of and or",
      }),
    );
    expect(out).toHaveLength(0);
  });

  it("customer_copy passes operator-locked phrasing", () => {
    const out = runPredicate(
      makeSnapshot({
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    );
    expect(out[0]!.customer_copy).toBe(
      "Bring the page title and H1 into closer alignment so AI search platforms see consistent intent for this page.",
    );
  });
});

// ── α₂.2 page-type allowlist tests ──────────────────────────────────

describe("titleH1Mismatch predicate — α₂.2 page-type allowlist", () => {
  // Mismatched title + h1 used across all the page-type cases.
  const mismatchedSnap = (url: string) =>
    makeSnapshot({
      url,
      title: "Whole Home Remodel",
      h1: "Atherton Excellence",
    });

  it("FIRES on homepage", () => {
    const out = runPredicate(mismatchedSnap("https://example.com/"));
    expect(out).toHaveLength(2);
  });

  it("FIRES on city detail page", () => {
    const out = runPredicate(
      mismatchedSnap("https://example.com/locations/palo-alto"),
    );
    expect(out).toHaveLength(2);
  });

  it("FIRES on service detail page", () => {
    const out = runPredicate(
      mismatchedSnap("https://example.com/services/whole-home"),
    );
    expect(out).toHaveLength(2);
  });

  it("SKIPS project detail pages", () => {
    const out = runPredicate(
      mismatchedSnap("https://example.com/projects/atherton-modern"),
    );
    expect(out).toHaveLength(0);
  });

  it("SKIPS hub pages (city / service / project hubs)", () => {
    for (const url of [
      "https://example.com/locations",
      "https://example.com/services",
      "https://example.com/projects",
    ]) {
      const out = runPredicate(mismatchedSnap(url));
      expect(out, `should skip hub ${url}`).toHaveLength(0);
    }
  });

  it("SKIPS universal hub names (blog / portfolio / available-homes / etc.)", () => {
    for (const url of [
      "https://example.com/blog",
      "https://example.com/portfolio",
      "https://example.com/available-homes",
      "https://example.com/explore-projects",
      "https://example.com/news",
      "https://example.com/resources",
    ]) {
      const out = runPredicate(mismatchedSnap(url));
      expect(out, `should skip universal hub ${url}`).toHaveLength(0);
    }
  });

  it("SKIPS utility / legal / about / contact / faq pages", () => {
    for (const url of [
      "https://example.com/privacy-policy",
      "https://example.com/terms-of-service",
      "https://example.com/legal",
      "https://example.com/cookie-policy",
      "https://example.com/accessibility",
      "https://example.com/platform-info",
      "https://example.com/contact-us",
      "https://example.com/about-us",
      "https://example.com/our-team",
      "https://example.com/careers",
      "https://example.com/faq",
      "https://example.com/our-partners",
    ]) {
      const out = runPredicate(mismatchedSnap(url));
      expect(out, `should skip utility page ${url}`).toHaveLength(0);
    }
  });

  it("SKIPS technical assets", () => {
    for (const url of [
      "https://example.com/llms.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/robots.txt",
      "https://example.com/image.jpg",
    ]) {
      const out = runPredicate(mismatchedSnap(url));
      expect(out, `should skip technical asset ${url}`).toHaveLength(0);
    }
  });

  it("SKIPS pages classified as 'other' (e.g., /design-studio one-off subpage)", () => {
    const out = runPredicate(mismatchedSnap("https://example.com/design-studio"));
    expect(out).toHaveLength(0);
  });
});
