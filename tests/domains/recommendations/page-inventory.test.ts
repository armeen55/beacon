import { describe, it, expect } from "vitest";

import {
  buildPageInventory,
  matchClusterToInventory,
  tokenizeForMatch,
  type PageInventoryEntry,
} from "@/domains/recommendations/page-inventory";
import type { PageEntity, PageSnapshot } from "@/domains/pages/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

function mkEntity(
  overrides: Partial<TrackedEntity> & { id: string; name: string },
): TrackedEntity {
  return {
    account_id: "ritz",
    entity_type: "competitor",
    domain: null,
    url: null,
    aliases: [],
    location_scope: null,
    service_scope: null,
    is_owned: false,
    is_active: true,
    metadata: {},
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

const RITZ = mkEntity({
  id: "e-r",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  entity_type: "brand",
  is_owned: true,
});

function mkPage(
  overrides: Partial<PageEntity> & { id: string; url: string },
): PageEntity {
  return {
    canonical_url: overrides.url,
    domain: "ritzbuilders.com",
    path: "/",
    page_type: "other",
    city: null,
    service: null,
    topics: [],
    ownership_tier: "owned",
    tracked_entity_id: null,
    is_owned: true,
    first_seen_at: "2026-04-20T00:00:00Z",
    last_observed_at: "2026-04-23T00:00:00Z",
    discovery_sources: ["manual"],
    title_last_seen: null,
    changelog_ids: [],
    metadata: {},
    tenant_id: "t",
    ...overrides,
  };
}

function mkSnapshot(
  overrides: Partial<PageSnapshot> & { id: string; page_id: string; url: string },
): PageSnapshot {
  return {
    canonical_url: overrides.url,
    fetched_at: "2026-04-23T00:00:00Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "hh",
    faq_hash: "fh",
    schema_hash: "sh",
    ...overrides,
  } as PageSnapshot;
}

describe("buildPageInventory", () => {
  it("joins PageEntity + latest PageSnapshot + filters to owned pages only", () => {
    const pages: PageEntity[] = [
      mkPage({
        id: "p-palo-alto",
        url: "https://ritzbuilders.com/locations/palo-alto/",
        page_type: "city_page",
        city: "Palo Alto",
        is_owned: true,
      }),
      mkPage({
        id: "p-competitor",
        url: "https://baybuilders.com/palo-alto",
        is_owned: false,
      }),
    ];
    const snapshots: PageSnapshot[] = [
      mkSnapshot({
        id: "s1",
        page_id: "p-palo-alto",
        url: "https://ritzbuilders.com/locations/palo-alto/",
        title: "Palo Alto Custom Home Builder | Ritz Builders",
        h1: "Palo Alto Custom Home Builder",
        meta_description: "Design-build homes in Palo Alto.",
        h2_list: ["Why Palo Alto", "Our process"],
        location_terms: ["Palo Alto"],
        service_terms: ["Custom Home Builder"],
      }),
    ];
    const inv = buildPageInventory({
      pages,
      snapshots,
      activeEntities: [RITZ],
    });
    expect(inv).toHaveLength(1);
    expect(inv[0].url).toBe("https://ritzbuilders.com/locations/palo-alto");
    expect(inv[0].routeType).toBe("location");
    expect(inv[0].detectedGeo).toBe("Palo Alto");
    expect(inv[0].title).toContain("Palo Alto");
    expect(inv[0].h1).toContain("Palo Alto");
  });

  it("dedupes URLs that canonicalize to the same key", () => {
    const pages: PageEntity[] = [
      mkPage({
        id: "p1",
        url: "https://www.ritzbuilders.com/locations/palo-alto/",
        page_type: "city_page",
      }),
      mkPage({
        id: "p2",
        url: "http://ritzbuilders.com/locations/palo-alto",
        page_type: "city_page",
      }),
    ];
    const inv = buildPageInventory({
      pages,
      snapshots: [],
      activeEntities: [RITZ],
    });
    expect(inv).toHaveLength(1);
  });

  it("accepts subdomains of owned hosts", () => {
    const pages = [
      mkPage({
        id: "p1",
        url: "https://blog.ritzbuilders.com/palo-alto-remodels",
        page_type: "other",
      }),
    ];
    const inv = buildPageInventory({
      pages,
      snapshots: [],
      activeEntities: [RITZ],
    });
    expect(inv).toHaveLength(1);
  });

  it("includes pages when host is owned even if PageEntity.is_owned is stale/false (Phase 2)", () => {
    const pages = [
      mkPage({
        id: "p1",
        url: "https://ritzbuilders.com/locations/palo-alto",
        page_type: "city_page",
        is_owned: false, // stale data from Supabase
      }),
    ];
    const inv = buildPageInventory({
      pages,
      snapshots: [],
      activeEntities: [RITZ],
    });
    expect(inv).toHaveLength(1);
    expect(inv[0].url).toBe("https://ritzbuilders.com/locations/palo-alto");
  });

  it("skips pages whose host is not owned", () => {
    const pages = [
      mkPage({
        id: "p1",
        url: "https://houzz.com/pro/xyz",
        is_owned: true, // misconfigured: marked owned but host isn't
        page_type: "other",
      }),
    ];
    const inv = buildPageInventory({
      pages,
      snapshots: [],
      activeEntities: [RITZ],
    });
    expect(inv).toHaveLength(0);
  });

  it("uses latest snapshot when multiple exist per page", () => {
    const pages = [
      mkPage({
        id: "p1",
        url: "https://ritzbuilders.com/services/luxury-homes/",
        page_type: "service_page",
      }),
    ];
    const snapshots = [
      mkSnapshot({
        id: "s-old",
        page_id: "p1",
        url: "https://ritzbuilders.com/services/luxury-homes/",
        title: "Old Title",
        fetched_at: "2026-04-20T00:00:00Z",
      }),
      mkSnapshot({
        id: "s-new",
        page_id: "p1",
        url: "https://ritzbuilders.com/services/luxury-homes/",
        title: "New Title",
        fetched_at: "2026-04-23T00:00:00Z",
      }),
    ];
    const inv = buildPageInventory({
      pages,
      snapshots,
      activeEntities: [RITZ],
    });
    expect(inv[0].title).toBe("New Title");
  });
});

describe("matchClusterToInventory", () => {
  const inv: PageInventoryEntry[] = [
    {
      url: "https://ritzbuilders.com/locations/palo-alto",
      title: "Palo Alto Custom Home Builder",
      h1: "Palo Alto Custom Home Builder",
      metaDescription: null,
      h2s: [],
      routeType: "location",
      detectedGeo: "Palo Alto",
      detectedService: "Custom Home Builder",
    },
    {
      url: "https://ritzbuilders.com/locations/los-altos",
      title: "Los Altos Custom Home Builder",
      h1: "Los Altos Custom Home Builder",
      metaDescription: null,
      h2s: [],
      routeType: "location",
      detectedGeo: "Los Altos",
      detectedService: "Custom Home Builder",
    },
    {
      url: "https://ritzbuilders.com/services/whole-home-remodel",
      title: "Whole Home Remodel",
      h1: "Whole Home Remodel",
      metaDescription: null,
      h2s: [],
      routeType: "service",
      detectedGeo: null,
      detectedService: "Whole Home Remodel",
    },
  ];

  it("picks the geo-matching location page for a geo cluster", () => {
    const matches = matchClusterToInventory({
      label: "Los Altos",
      kind: "geo",
      inventory: inv,
    });
    expect(matches[0].url).toBe("https://ritzbuilders.com/locations/los-altos");
    expect(matches[0].score).toBeGreaterThan(0.8);
  });

  it("picks the service page for a topic cluster matching its name", () => {
    const matches = matchClusterToInventory({
      label: "Whole Home Remodel",
      kind: "topic",
      inventory: inv,
    });
    expect(matches[0].url).toBe(
      "https://ritzbuilders.com/services/whole-home-remodel",
    );
    expect(matches[0].score).toBeGreaterThan(0.8);
  });

  it("returns [] when no inventory tokens overlap", () => {
    const matches = matchClusterToInventory({
      label: "completely unrelated topic",
      kind: "topic",
      inventory: inv,
    });
    expect(matches).toEqual([]);
  });

  it("handles empty inventory gracefully", () => {
    const matches = matchClusterToInventory({
      label: "Palo Alto",
      kind: "geo",
      inventory: [],
    });
    expect(matches).toEqual([]);
  });

  it("returns all matches sorted desc by score, capped to topN", () => {
    const matches = matchClusterToInventory({
      label: "Custom Home Builder",
      kind: "topic",
      inventory: inv,
      topN: 2,
    });
    expect(matches.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });
});

describe("tokenizeForMatch", () => {
  it("lowercases, drops stopwords, drops short tokens", () => {
    expect(tokenizeForMatch("The Best Luxury Home Builder in Bay Area")).toEqual([
      "luxury",
      "home",
      "builder",
      "bay",
      "area",
    ]);
  });

  it("splits on punctuation and underscores (and normalizes via synonym map)", () => {
    // Phase 2 (2026-04-24): synonym map normalizes services → service and
    // similar plurals so URL-path tokens align with cluster-label tokens.
    expect(tokenizeForMatch("whole-home_remodel services/luxury")).toEqual([
      "whole",
      "home",
      "remodel",
      "service",
      "luxury",
    ]);
  });
});
