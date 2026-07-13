import { describe, it, expect } from "vitest";
import {
  matchClusterToInventory,
  tokenizeForMatch,
  type PageInventoryEntry,
} from "@/domains/recommendations/page-inventory";

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

  it("custom builder cluster matches /custom-home-builder-bay-area, not homepage", () => {
    const matches = matchClusterToInventory({
      label: "Custom Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      synonyms: BUILDER_FIXTURE_SYNONYMS,
    });
    expect(matches[0].url).toBe(CUSTOM_HUB.url);
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

  it("Emerald Hills does NOT match /locations/los-altos", () => {
    const matches = matchClusterToInventory({
      label: "Emerald Hills",
      kind: "geo",
      inventory: RITZ_INVENTORY,
    });
    expect(matches[0].url).toBe(EMERALD_HILLS.url);
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

  it("'build on my lot' cluster matches /services/build-on-your-lot via my↔your synonym", () => {
    const matches = matchClusterToInventory({
      label: "Build on My Lot",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      synonyms: BUILDER_FIXTURE_SYNONYMS,
    });
    expect(matches[0]?.url).toBe(BUILD_ON_YOUR_LOT.url);
  });

  it("'architectural plans' cluster matches /services/architect-provided-plans", () => {
    const matches = matchClusterToInventory({
      label: "Architectural Plans",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      synonyms: BUILDER_FIXTURE_SYNONYMS,
    });
    expect(matches[0]?.url).toBe(ARCHITECT_PROVIDED.url);
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
