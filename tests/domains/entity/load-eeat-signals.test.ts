/**
 * E-E-A-T signals loader tests (BEACON 500 P10, 2026-07-03).
 *
 * Mocks the Wikidata cache read (readStore) + the page classifier's content
 * gating, then verifies the assembler joins known entities to page text, builds
 * author gaps from body/schema signals, and computes brand presence from the
 * site-root snapshot. EMPTY-safe when there is no data.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

const _readStoreMock = vi.fn<() => Promise<unknown[]>>();

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => _readStoreMock(),
}));

// Force every content-ish URL to classify as "content" so the assembler's
// content gate is exercised without needing contentSiteMode plumbing here.
vi.mock("@/domains/recommendation-intelligence/page-classifier", () => ({
  classifyPageType: (url: string) =>
    url.endsWith("/") || url.includes("/home") ? "homepage" : "content",
  isNonHtmlAsset: () => false,
}));

function cacheRow(over: Record<string, unknown> = {}) {
  return {
    key: "nowruz",
    fetchedAt: "2026-07-01T00:00:00Z",
    match: {
      queriedName: "Nowruz",
      qid: "Q11448",
      label: "Nowruz",
      confidence: "high",
      wikidataUrl: "https://www.wikidata.org/wiki/Q11448",
      wikipediaUrl: "https://en.wikipedia.org/wiki/Nowruz",
    },
    ...over,
  };
}

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "s",
    page_id: "p",
    url: "https://iranopedia.com/nowruz",
    canonical_url: null,
    fetched_at: "2026-07-03T00:00:00Z",
    http_status: 200,
    title: "Nowruz: The Persian New Year",
    meta_description: "About Nowruz.",
    h1: "Nowruz",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 500,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "a",
    headings_hash: "b",
    faq_hash: "c",
    schema_hash: "d",
    tenant_id: "t",
    ...over,
  };
}

function config(over: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    name: "Iranopedia",
    domain: "iranopedia.com",
    industry: "content",
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
    scanSettings: { preferredHour: 7, timezone: "UTC", scope: "priority", enabled: true },
    ...over,
  } as BusinessConfig;
}

async function load(snapshots: PageSnapshot[], cfg = config()) {
  const { loadEeatSignalsForTenant } = await import(
    "@/domains/entity/load-eeat-signals"
  );
  return loadEeatSignalsForTenant({ tenantId: "t", snapshots, businessConfig: cfg });
}

beforeEach(() => {
  _readStoreMock.mockReset();
  _readStoreMock.mockResolvedValue([cacheRow()]);
});

describe("loadEeatSignalsForTenant", () => {
  it("joins a known entity named in a page's title/H1 into an entity-link gap", async () => {
    const result = await load([snap()]);
    expect(result.entityLinkGaps).toHaveLength(1);
    expect(result.entityLinkGaps[0]!.entities[0]!.qid).toBe("Q11448");
  });

  it("does NOT create an entity-link gap when the page names no known entity", async () => {
    const result = await load([snap({ title: "Persian Rugs Buying Guide", h1: "Persian Rugs" })]);
    expect(result.entityLinkGaps).toEqual([]);
  });

  it("EMPTY entity gaps when the Wikidata cache is empty (byte-identical baseline)", async () => {
    _readStoreMock.mockResolvedValue([]);
    const result = await load([snap()]);
    expect(result.entityLinkGaps).toEqual([]);
  });

  it("builds an author gap for a guide-shaped page with no author signal", async () => {
    const result = await load([
      snap({
        url: "https://iranopedia.com/how-nowruz-is-celebrated",
        title: "How Nowruz Is Celebrated",
        h1: "How Nowruz Is Celebrated",
        body_paragraph_sample: ["Nowruz is the Persian new year celebrated across many countries."],
      }),
    ]);
    expect(result.authorGaps.map((g) => g.url)).toContain(
      "https://iranopedia.com/how-nowruz-is-celebrated",
    );
  });

  it("does NOT build an author gap when Person schema is present", async () => {
    const result = await load([
      snap({
        url: "https://iranopedia.com/how-nowruz-is-celebrated",
        title: "How Nowruz Is Celebrated",
        h1: "How Nowruz Is Celebrated",
        schema_types: ["Article", "Person"],
      }),
    ]);
    expect(result.authorGaps).toEqual([]);
  });

  it("does NOT build an author gap when a visible byline is present in the body", async () => {
    const result = await load([
      snap({
        url: "https://iranopedia.com/how-nowruz-is-celebrated",
        title: "How Nowruz Is Celebrated",
        h1: "How Nowruz Is Celebrated",
        body_paragraph_sample: ["By Sara Karimi. Nowruz is the Persian new year celebrated widely."],
      }),
    ]);
    expect(result.authorGaps).toEqual([]);
  });

  it("computes a brand-presence gap when the homepage has no Organization schema", async () => {
    const result = await load([
      snap({ url: "https://iranopedia.com/", title: "Iranopedia", h1: "Iranopedia", schema_types: [] }),
    ]);
    expect(result.brandPresenceGap).not.toBeNull();
    expect(result.brandPresenceGap!.gap).toBe("no_org_schema");
  });

  it("SELF-HIDES the brand gap when the homepage carries Organization schema with a linked profile", async () => {
    const result = await load([
      snap({
        url: "https://iranopedia.com/",
        title: "Iranopedia",
        h1: "Iranopedia",
        schema_types: ["Organization"],
        schema_entity_names: ["Iranopedia", "https://twitter.com/iranopedia"],
      }),
    ]);
    expect(result.brandPresenceGap).toBeNull();
  });

  it("EMPTY everywhere when there are no snapshots (empty-safe baseline)", async () => {
    _readStoreMock.mockResolvedValue([]);
    const result = await load([]);
    expect(result.entityLinkGaps).toEqual([]);
    expect(result.authorGaps).toEqual([]);
    // Honesty gate: with NO homepage snapshot, the brand check abstains (we
    // never crawled the homepage, so we cannot claim it lacks brand schema).
    expect(result.brandPresenceGap).toBeNull();
  });

  it("brand check abstains when the homepage was not part of this scan (honesty gate)", async () => {
    // Only a deep content page, no site-root snapshot.
    const result = await load([snap({ url: "https://iranopedia.com/nowruz" })]);
    expect(result.brandPresenceGap).toBeNull();
  });

  it("fails soft to empty signals when the cache read throws", async () => {
    _readStoreMock.mockRejectedValue(new Error("store read failed"));
    const result = await load([snap()]);
    // The cache read failure only zeroes the entity join; author + brand still
    // compute from snapshots/config.
    expect(result.entityLinkGaps).toEqual([]);
  });
});
