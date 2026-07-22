/** Page inventory (Core 100K Phase 6 merge of the four phase-named files; D1 names retired). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { buildPageInventory, matchClusterToInventory, tokenizeForMatch, type PageInventoryEntry } from "@/domains/recommendations/page-inventory";
import { type PageEntity, type PageSnapshot } from "@/domains/pages/types";
import { type TrackedEntity } from "@/domains/tracked-entities/types";

// ===== from tests/domains/recommendations/page-inventory.test.ts =====
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

// ===== from tests/domains/recommendations/page-inventory-phase2.test.ts =====
const BUILDER_FIXTURE_SYNONYMS = {
  renovation: "remodel",
  renovations: "remodel",
  your: "my",
  architectural: "architect",
} as const;

/**
 * Phase 2 (2026-04-24) — resolver correctness contract.
 *
 * Uses a small inventory modeled after the Ritz site as FIXTURES ONLY.
 * The logic under test (homepage penalty, specificity, synonym match,
 * bundled detection) is customer-agnostic. A future customer with
 * different URLs would exercise the same rules through their own
 * inventory.
 */

const HOMEPAGE: PageInventoryEntry = {
  url: "https://ritzbuilders.com/",
  title: "Luxury Home Builder Bay Area | Ritz Builders",
  h1: "Luxury Home Builder Bay Area",
  metaDescription: "Ritz Builders — luxury home builder in Bay Area.",
  h2s: ["Custom Homes", "Locations", "Services"],
  routeType: "home",
  detectedGeo: null,
  detectedService: null,
};

const LUXURY_HUB: PageInventoryEntry = {
  url: "https://ritzbuilders.com/luxury-home-builder-bay-area",
  title: "Luxury Home Builder Bay Area | Ritz Builders",
  h1: "Luxury Home Builder Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "Bay Area",
  detectedService: "Luxury Home Builder",
};

const CUSTOM_HUB: PageInventoryEntry = {
  url: "https://ritzbuilders.com/custom-home-builder-bay-area",
  title: "Custom Home Builder Bay Area",
  h1: "Custom Home Builder Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "Bay Area",
  detectedService: "Custom Home Builder",
};

const PALO_ALTO: PageInventoryEntry = {
  url: "https://ritzbuilders.com/locations/palo-alto",
  title: "Palo Alto Custom Home Builder",
  h1: "Palo Alto Custom Home Builder",
  metaDescription: null,
  h2s: [],
  routeType: "location",
  detectedGeo: "Palo Alto",
  detectedService: "Custom Home Builder",
};

const LOS_ALTOS: PageInventoryEntry = {
  url: "https://ritzbuilders.com/locations/los-altos",
  title: "Los Altos Custom Home Builder",
  h1: "Los Altos Custom Home Builder",
  metaDescription: null,
  h2s: [],
  routeType: "location",
  detectedGeo: "Los Altos",
  detectedService: "Custom Home Builder",
};

const EMERALD_HILLS: PageInventoryEntry = {
  url: "https://ritzbuilders.com/locations/emerald-hills",
  title: "Emerald Hills Custom Home Builder",
  h1: "Emerald Hills Custom Home Builder",
  metaDescription: null,
  h2s: [],
  routeType: "location",
  detectedGeo: "Emerald Hills",
  detectedService: "Custom Home Builder",
};

const CUPERTINO_NONSTANDARD: PageInventoryEntry = {
  url: "https://ritzbuilders.com/locations/cupertino-custom-home-builder",
  title: "Cupertino Custom Home Builder",
  h1: "Cupertino Custom Home Builder",
  metaDescription: null,
  h2s: [],
  routeType: "location",
  detectedGeo: "Cupertino",
  detectedService: "Custom Home Builder",
};

const WHOLE_HOME_REMODEL: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/whole-home-remodel",
  title: "Whole Home Remodel",
  h1: "Whole Home Remodel",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: null,
  detectedService: "Whole Home Remodel",
};

const BUILD_ON_YOUR_LOT: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/build-on-your-lot",
  title: "Build on Your Lot",
  h1: "Build on Your Lot",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: null,
  detectedService: "Build on Your Lot",
};

const ARCHITECT_PROVIDED: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/architect-provided-plans",
  title: "Architect-Provided Plans",
  h1: "Architect-Provided Plans",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: null,
  detectedService: "Architect-Provided Plans",
};

const RITZ_INVENTORY: PageInventoryEntry[] = [
  HOMEPAGE,
  LUXURY_HUB,
  CUSTOM_HUB,
  PALO_ALTO,
  LOS_ALTOS,
  EMERALD_HILLS,
  CUPERTINO_NONSTANDARD,
  WHOLE_HOME_REMODEL,
  BUILD_ON_YOUR_LOT,
  ARCHITECT_PROVIDED,
];

describe("Phase 2 — homepage penalty", () => {
  it("luxury builder cluster prefers /luxury-home-builder-bay-area over homepage", () => {
    const matches = matchClusterToInventory({
      label: "Luxury Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      synonyms: BUILDER_FIXTURE_SYNONYMS,
    });
    expect(matches[0].url).toBe(LUXURY_HUB.url);
    const homepageMatch = matches.find((m) => m.url === HOMEPAGE.url);
    if (homepageMatch) {
      expect(homepageMatch.score).toBeLessThan(matches[0].score);
    }
  });


  it("Palo Alto geo cluster matches /locations/palo-alto, not homepage", () => {
    const matches = matchClusterToInventory({
      label: "Palo Alto",
      kind: "geo",
      inventory: RITZ_INVENTORY,
    });
    expect(matches[0].url).toBe(PALO_ALTO.url);
    expect(matches[0].url).not.toBe(HOMEPAGE.url);
  });
});

describe("Phase 2 — geo disambiguation", () => {
  it("Los Altos does NOT match /locations/emerald-hills", () => {
    const matches = matchClusterToInventory({
      label: "Los Altos",
      kind: "geo",
      inventory: RITZ_INVENTORY,
    });
    expect(matches[0].url).toBe(LOS_ALTOS.url);
    expect(matches[0].url).not.toBe(EMERALD_HILLS.url);
  });

});

describe("Phase 2 — non-standard slug handling", () => {
  it("Cupertino cluster matches /locations/cupertino-custom-home-builder (non-standard slug)", () => {
    const matches = matchClusterToInventory({
      label: "Cupertino",
      kind: "geo",
      inventory: RITZ_INVENTORY,
    });
    expect(matches[0].url).toBe(CUPERTINO_NONSTANDARD.url);
  });
});

describe("Phase 2 — synonym matching", () => {
  it("'whole-home renovation' cluster matches /services/whole-home-remodel via renovation↔remodel synonym", () => {
    const matches = matchClusterToInventory({
      label: "Whole Home Renovation Builders",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      synonyms: BUILDER_FIXTURE_SYNONYMS,
    });
    expect(matches[0]?.url).toBe(WHOLE_HOME_REMODEL.url);
  });



  it("tokenizeForMatch normalizes known synonyms", () => {
    expect(tokenizeForMatch("renovation", BUILDER_FIXTURE_SYNONYMS)).toEqual(["remodel"]);
    expect(tokenizeForMatch("renovations", BUILDER_FIXTURE_SYNONYMS)).toEqual(["remodel"]);
    expect(tokenizeForMatch("your", BUILDER_FIXTURE_SYNONYMS)).toEqual(["my"]);
    expect(tokenizeForMatch("architectural", BUILDER_FIXTURE_SYNONYMS)).toEqual(["architect"]);
  });

  it("does not impose builder vocabulary on a tenant with no curated synonyms", () => {
    expect(tokenizeForMatch("construction history")).toEqual([
      "construction",
      "history",
    ]);
    expect(tokenizeForMatch("builder history")).toEqual(["builder", "history"]);

    const editorialInventory: PageInventoryEntry[] = [{
      url: "https://iranopedia.com/builders",
      title: "Notable Builders",
      h1: "Notable Builders",
      metaDescription: null,
      h2s: [],
      routeType: "other",
      detectedGeo: null,
      detectedService: null,
    }];
    expect(matchClusterToInventory({
      label: "History of Construction",
      kind: "topic",
      inventory: editorialInventory,
    })).toEqual([]);
  });
});

describe("Phase 2 — bundled match detection", () => {
  const BUNDLED_PAGE: PageInventoryEntry = {
    url: "https://example.com/locations/los-altos-and-hills",
    title: "Los Altos & Los Altos Hills Custom Home Builder",
    h1: "Los Altos & Los Altos Hills Custom Home Builder",
    metaDescription: null,
    h2s: [],
    routeType: "location",
    detectedGeo: "Los Altos",
    detectedService: "Custom Home Builder",
  };

  it("page with '&' connector between distinct geos is flagged as bundled", () => {
    const matches = matchClusterToInventory({
      label: "Los Altos",
      kind: "geo",
      inventory: [BUNDLED_PAGE],
    });
    expect(matches[0]?.isBundled).toBe(true);
  });

  it("page without bundling connectors is NOT flagged as bundled", () => {
    const matches = matchClusterToInventory({
      label: "Los Altos",
      kind: "geo",
      inventory: [LOS_ALTOS],
    });
    expect(matches[0]?.isBundled).toBe(false);
  });
});

describe("Phase 2 — page specificity under full-inventory pressure", () => {
  it("homepage never beats a specific service/location page when cluster is specific", () => {
    const specificClusters: { label: string; kind: "geo" | "topic" }[] = [
      { label: "Palo Alto", kind: "geo" },
      { label: "Los Altos", kind: "geo" },
      { label: "Atherton", kind: "geo" },
      { label: "Luxury Home Builder Bay Area", kind: "topic" },
      { label: "Custom Home Builder Bay Area", kind: "topic" },
    ];
    for (const cluster of specificClusters) {
      const matches = matchClusterToInventory({
        label: cluster.label,
        kind: cluster.kind,
        inventory: RITZ_INVENTORY,
      });
      expect(matches[0]?.url).not.toBe(HOMEPAGE.url);
    }
  });
});

// ===== from tests/domains/recommendations/page-inventory-phase2-6.test.ts =====
/**
 * Phase 2.6 (2026-04-24) — target selection + bundled false-positive contract.
 *
 * Locks in two resolver quality fixes:
 *
 *   A. URL-path-overlap tiebreak. At equal score, a page whose URL path
 *      explicitly names the cluster beats a page that only mentions the
 *      cluster via brand boilerplate. Fixes "Luxury Home Builder Bay Area"
 *      resolving to /services/build-on-your-lot instead of
 *      /luxury-home-builder-bay-area.
 *
 *   B. Tightened detectBundledCoverage. Short compound product names like
 *      "Custom Home & Site Specialists" and "Luxury Teardown & Rebuild"
 *      no longer flag as bundled. Real multi-intent titles like
 *      "Luxury Custom Home Builder in Los Altos & Los Altos Hills" still do.
 *
 * Fixtures model the live Ritz inventory but the logic is customer-agnostic.
 */

const LUXURY_HUB_f2: PageInventoryEntry = {
  url: "https://ritzbuilders.com/luxury-home-builder-bay-area",
  title: "Top Luxury Home Builders Bay Area 2026 | Ritz Builders",
  h1: "Ritz Builders Architect-Led Custom Home Builder in the Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const CUSTOM_HUB_f2: PageInventoryEntry = {
  url: "https://ritzbuilders.com/custom-home-builder-bay-area",
  title: "Best Custom Home Builders Bay Area 2026 | Ritz Builders",
  h1: "Best Custom Home Builders in the Bay Area for Fully Custom, Ground-Up Projects (2026)",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const BUILD_ON_YOUR_LOT_f2: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/build-on-your-lot",
  title: "Build on Your Lot Bay Area | Custom Home & Site Specialists",
  h1: "Luxury Custom Home Construction on Your Lot",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "custom homes",
};

const TEARDOWN_REBUILD: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/teardown-rebuild",
  title: "Luxury Teardown & Rebuild Bay Area | Ritz Builders",
  h1: "Luxury Teardown & Rebuild in the Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "custom homes",
};

const LOS_ALTOS_f2: PageInventoryEntry = {
  url: "https://ritzbuilders.com/locations/los-altos",
  title: "Custom Home Builder Los Altos | Ritz Builders",
  h1: "Luxury Custom Home Builder in Los Altos & Los Altos Hills | Design Build Firm",
  metaDescription: null,
  h2s: [],
  routeType: "location",
  detectedGeo: "los altos",
  detectedService: "design build",
};

const RITZ_INVENTORY_f2: PageInventoryEntry[] = [
  LUXURY_HUB_f2,
  CUSTOM_HUB_f2,
  BUILD_ON_YOUR_LOT_f2,
  TEARDOWN_REBUILD,
  LOS_ALTOS_f2,
];

describe("Phase 2.6 — target selection", () => {
  it("Luxury Home Builder cluster picks /luxury-home-builder-bay-area over /services/build-on-your-lot", () => {
    const matches = matchClusterToInventory({
      label: "Luxury Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY_f2,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(LUXURY_HUB_f2.url);
    // Build-on-your-lot should not be the top target for a Luxury cluster.
    expect(matches[0].url).not.toBe(BUILD_ON_YOUR_LOT_f2.url);
  });



  it("Build on Your Lot / Empty Lot cluster does resolve to /services/build-on-your-lot", () => {
    const matches = matchClusterToInventory({
      label: "Build on My Lot / Empty Lot Builders Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY_f2,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(BUILD_ON_YOUR_LOT_f2.url);
  });
});

describe("Phase 2.6 — bundled false positives", () => {
  it("'Custom Home & Site Specialists' (build-on-your-lot title) does NOT flag as bundled for Build on Your Lot cluster", () => {
    const matches = matchClusterToInventory({
      label: "Build on My Lot Bay Area",
      kind: "topic",
      inventory: [BUILD_ON_YOUR_LOT_f2],
      topN: 5,
    });
    const hit = matches.find((m) => m.url === BUILD_ON_YOUR_LOT_f2.url);
    expect(hit, "build-on-your-lot should match the cluster").toBeDefined();
    expect(hit?.isBundled).toBe(false);
  });


  it("'Los Altos & Los Altos Hills | Design Build Firm' DOES flag as bundled for a Los Altos cluster", () => {
    const matches = matchClusterToInventory({
      label: "Los Altos",
      kind: "geo",
      inventory: [LOS_ALTOS_f2],
      topN: 5,
    });
    const hit = matches.find((m) => m.url === LOS_ALTOS_f2.url);
    expect(hit, "los-altos should match the cluster").toBeDefined();
    expect(hit?.isBundled).toBe(true);
  });
});

describe("Phase 2.6 — URL-path-overlap tiebreak", () => {
  it("records urlPathOverlap on every match", () => {
    const matches = matchClusterToInventory({
      label: "Luxury Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY_f2,
      topN: 10,
    });
    const hub = matches.find((m) => m.url === LUXURY_HUB_f2.url);
    const bol = matches.find((m) => m.url === BUILD_ON_YOUR_LOT_f2.url);
    expect(hub?.urlPathOverlap).toBe(5); // luxury + home + builder + bay + area
    expect(bol?.urlPathOverlap).toBe(0); // none of the cluster tokens in /services/build-on-your-lot
  });

  it("tiebreak prefers higher urlPathOverlap at equal score", () => {
    // Both score 1.0 for "Luxury Home Builder Bay Area" after all boosts
    // and the cap. The hub has 5 URL-path matches; build-on-your-lot has 0.
    const matches = matchClusterToInventory({
      label: "Luxury Home Builder Bay Area",
      kind: "topic",
      inventory: [BUILD_ON_YOUR_LOT_f2, LUXURY_HUB_f2],
      topN: 5,
    });
    expect(matches[0].url).toBe(LUXURY_HUB_f2.url);
  });
});

// ===== from tests/domains/recommendations/page-inventory-phase2-7.test.ts =====
const BUILDER_FIXTURE_SYNONYMS_f3 = {
  renovation: "remodel",
  builders: "builder",
} as const;

/**
 * Phase 2.7 (2026-04-24) — service-specific page preference.
 *
 * When a cluster label explicitly names a service (its slug tokens are
 * all present in the cluster) AND a /services/<slug> page exists, the
 * service page should win over a broad hub.
 *
 * Tiebreak lives between score and urlPathOverlap, so Luxury/Custom/
 * Modern clusters (where no service page's slug is fully named) still
 * resolve to their hub pages via the Phase 2.6 urlPathOverlap tiebreak.
 */

const LUXURY_HUB_f3: PageInventoryEntry = {
  url: "https://ritzbuilders.com/luxury-home-builder-bay-area",
  title: "Top Luxury Home Builders Bay Area 2026 | Ritz Builders",
  h1: "Ritz Builders Architect-Led Custom Home Builder in the Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const CUSTOM_HUB_f3: PageInventoryEntry = {
  url: "https://ritzbuilders.com/custom-home-builder-bay-area",
  title: "Best Custom Home Builders Bay Area 2026 | Ritz Builders",
  h1: "Best Custom Home Builders in the Bay Area for Fully Custom, Ground-Up Projects (2026)",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const DESIGN_BUILD: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/design-build",
  title: "Architect-Led Design-Build Bay Area | Luxury Custom Homes | Ritz Builders",
  h1: "Architect-Led Design-Build for Bay Area Luxury Custom Homes",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const BUILD_ON_YOUR_LOT_f3: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/build-on-your-lot",
  title: "Build on Your Lot Bay Area | Custom Home & Site Specialists",
  h1: "Luxury Custom Home Construction on Your Lot",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "custom homes",
};

const WHOLE_HOME_REMODEL_f3: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/whole-home-remodel",
  title: "Whole-Home Remodel Bay Area | Ritz Builders",
  h1: "Luxury Whole-Home Remodeling in the Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "whole-home remodel",
};

const RITZ_INVENTORY_f3: PageInventoryEntry[] = [
  LUXURY_HUB_f3,
  CUSTOM_HUB_f3,
  DESIGN_BUILD,
  BUILD_ON_YOUR_LOT_f3,
  WHOLE_HOME_REMODEL_f3,
];

describe("Phase 2.7 — service-specific page preference", () => {
  it("'Best Design-Build Firm for Custom Homes (Bay Area)' picks /services/design-build over /custom-home-builder-bay-area", () => {
    const matches = matchClusterToInventory({
      label: "Best Design-Build Firm for Custom Homes (Bay Area)",
      kind: "topic",
      inventory: RITZ_INVENTORY_f3,
      topN: 5,
      synonyms: BUILDER_FIXTURE_SYNONYMS_f3,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(DESIGN_BUILD.url);
  });


  it("'Custom Home Builder Bay Area' still picks /custom-home-builder-bay-area (no explicit service match)", () => {
    const matches = matchClusterToInventory({
      label: "Custom Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY_f3,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(CUSTOM_HUB_f3.url);
    // DESIGN_BUILD must not win — its slug tokens (design, build) are not
    // all in the cluster tokens (custom, home, builder, bay, area).
    expect(matches[0].url).not.toBe(DESIGN_BUILD.url);
  });




  it("isExplicitServiceMatch is exposed on the match record", () => {
    const matches = matchClusterToInventory({
      label: "Best Design-Build Firm for Custom Homes (Bay Area)",
      kind: "topic",
      inventory: RITZ_INVENTORY_f3,
      topN: 10,
    });
    const db = matches.find((m) => m.url === DESIGN_BUILD.url);
    const custom = matches.find((m) => m.url === CUSTOM_HUB_f3.url);
    expect(db?.isExplicitServiceMatch).toBe(true);
    expect(custom?.isExplicitServiceMatch).toBe(false); // hub, never eligible
  });
});
