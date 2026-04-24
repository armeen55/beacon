import { describe, it, expect } from "vitest";
import {
  matchClusterToInventory,
  type PageInventoryEntry,
} from "@/domains/recommendations/page-inventory";

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

const LUXURY_HUB: PageInventoryEntry = {
  url: "https://ritzbuilders.com/luxury-home-builder-bay-area",
  title: "Top Luxury Home Builders Bay Area 2026 | Ritz Builders",
  h1: "Ritz Builders Architect-Led Custom Home Builder in the Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const CUSTOM_HUB: PageInventoryEntry = {
  url: "https://ritzbuilders.com/custom-home-builder-bay-area",
  title: "Best Custom Home Builders Bay Area 2026 | Ritz Builders",
  h1: "Best Custom Home Builders in the Bay Area for Fully Custom, Ground-Up Projects (2026)",
  metaDescription: null,
  h2s: [],
  routeType: "hub",
  detectedGeo: "bay area",
  detectedService: "design-build",
};

const BUILD_ON_YOUR_LOT: PageInventoryEntry = {
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

const LOS_ALTOS: PageInventoryEntry = {
  url: "https://ritzbuilders.com/locations/los-altos",
  title: "Custom Home Builder Los Altos | Ritz Builders",
  h1: "Luxury Custom Home Builder in Los Altos & Los Altos Hills | Design Build Firm",
  metaDescription: null,
  h2s: [],
  routeType: "location",
  detectedGeo: "los altos",
  detectedService: "design build",
};

const RITZ_INVENTORY: PageInventoryEntry[] = [
  LUXURY_HUB,
  CUSTOM_HUB,
  BUILD_ON_YOUR_LOT,
  TEARDOWN_REBUILD,
  LOS_ALTOS,
];

describe("Phase 2.6 — target selection", () => {
  it("Luxury Home Builder cluster picks /luxury-home-builder-bay-area over /services/build-on-your-lot", () => {
    const matches = matchClusterToInventory({
      label: "Luxury Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(LUXURY_HUB.url);
    // Build-on-your-lot should not be the top target for a Luxury cluster.
    expect(matches[0].url).not.toBe(BUILD_ON_YOUR_LOT.url);
  });

  it("Custom Home Builder cluster picks /custom-home-builder-bay-area over /services/build-on-your-lot", () => {
    const matches = matchClusterToInventory({
      label: "Custom Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(CUSTOM_HUB.url);
    expect(matches[0].url).not.toBe(BUILD_ON_YOUR_LOT.url);
  });

  it("Best Modern Home Builder does not resolve to /services/build-on-your-lot when hub pages exist", () => {
    const matches = matchClusterToInventory({
      label: "Best Modern Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    // Top match should be one of the broad hub pages, not build-on-your-lot.
    const TOP_URL = matches[0].url;
    expect(TOP_URL).not.toBe(BUILD_ON_YOUR_LOT.url);
    expect([LUXURY_HUB.url, CUSTOM_HUB.url]).toContain(TOP_URL);
  });

  it("Build on Your Lot / Empty Lot cluster does resolve to /services/build-on-your-lot", () => {
    const matches = matchClusterToInventory({
      label: "Build on My Lot / Empty Lot Builders Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(BUILD_ON_YOUR_LOT.url);
  });
});

describe("Phase 2.6 — bundled false positives", () => {
  it("'Custom Home & Site Specialists' (build-on-your-lot title) does NOT flag as bundled for Build on Your Lot cluster", () => {
    const matches = matchClusterToInventory({
      label: "Build on My Lot Bay Area",
      kind: "topic",
      inventory: [BUILD_ON_YOUR_LOT],
      topN: 5,
    });
    const hit = matches.find((m) => m.url === BUILD_ON_YOUR_LOT.url);
    expect(hit, "build-on-your-lot should match the cluster").toBeDefined();
    expect(hit?.isBundled).toBe(false);
  });

  it("'Luxury Teardown & Rebuild Bay Area' does NOT flag as bundled for a Teardown cluster", () => {
    const matches = matchClusterToInventory({
      label: "Teardown Rebuild Bay Area",
      kind: "topic",
      inventory: [TEARDOWN_REBUILD],
      topN: 5,
    });
    const hit = matches.find((m) => m.url === TEARDOWN_REBUILD.url);
    expect(hit, "teardown-rebuild should match the cluster").toBeDefined();
    expect(hit?.isBundled).toBe(false);
  });

  it("'Los Altos & Los Altos Hills | Design Build Firm' DOES flag as bundled for a Los Altos cluster", () => {
    const matches = matchClusterToInventory({
      label: "Los Altos",
      kind: "geo",
      inventory: [LOS_ALTOS],
      topN: 5,
    });
    const hit = matches.find((m) => m.url === LOS_ALTOS.url);
    expect(hit, "los-altos should match the cluster").toBeDefined();
    expect(hit?.isBundled).toBe(true);
  });
});

describe("Phase 2.6 — URL-path-overlap tiebreak", () => {
  it("records urlPathOverlap on every match", () => {
    const matches = matchClusterToInventory({
      label: "Luxury Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 10,
    });
    const hub = matches.find((m) => m.url === LUXURY_HUB.url);
    const bol = matches.find((m) => m.url === BUILD_ON_YOUR_LOT.url);
    expect(hub?.urlPathOverlap).toBe(5); // luxury + home + builder + bay + area
    expect(bol?.urlPathOverlap).toBe(0); // none of the cluster tokens in /services/build-on-your-lot
  });

  it("tiebreak prefers higher urlPathOverlap at equal score", () => {
    // Both score 1.0 for "Luxury Home Builder Bay Area" after all boosts
    // and the cap. The hub has 5 URL-path matches; build-on-your-lot has 0.
    const matches = matchClusterToInventory({
      label: "Luxury Home Builder Bay Area",
      kind: "topic",
      inventory: [BUILD_ON_YOUR_LOT, LUXURY_HUB],
      topN: 5,
    });
    expect(matches[0].url).toBe(LUXURY_HUB.url);
  });
});
