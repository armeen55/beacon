import { describe, it, expect } from "vitest";
import {
  matchClusterToInventory,
  type PageInventoryEntry,
} from "@/domains/recommendations/page-inventory";

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

const WHOLE_HOME_REMODEL: PageInventoryEntry = {
  url: "https://ritzbuilders.com/services/whole-home-remodel",
  title: "Whole-Home Remodel Bay Area | Ritz Builders",
  h1: "Luxury Whole-Home Remodeling in the Bay Area",
  metaDescription: null,
  h2s: [],
  routeType: "service",
  detectedGeo: "bay area",
  detectedService: "whole-home remodel",
};

const RITZ_INVENTORY: PageInventoryEntry[] = [
  LUXURY_HUB,
  CUSTOM_HUB,
  DESIGN_BUILD,
  BUILD_ON_YOUR_LOT,
  WHOLE_HOME_REMODEL,
];

describe("Phase 2.7 — service-specific page preference", () => {
  it("'Best Design-Build Firm for Custom Homes (Bay Area)' picks /services/design-build over /custom-home-builder-bay-area", () => {
    const matches = matchClusterToInventory({
      label: "Best Design-Build Firm for Custom Homes (Bay Area)",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(DESIGN_BUILD.url);
  });

  it("'Design Build Custom Home Builder Bay Area' picks /services/design-build", () => {
    const matches = matchClusterToInventory({
      label: "Design Build Custom Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(DESIGN_BUILD.url);
  });

  it("'Custom Home Builder Bay Area' still picks /custom-home-builder-bay-area (no explicit service match)", () => {
    const matches = matchClusterToInventory({
      label: "Custom Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(CUSTOM_HUB.url);
    // DESIGN_BUILD must not win — its slug tokens (design, build) are not
    // all in the cluster tokens (custom, home, builder, bay, area).
    expect(matches[0].url).not.toBe(DESIGN_BUILD.url);
  });

  it("'Luxury Home Builder Bay Area' still picks /luxury-home-builder-bay-area", () => {
    const matches = matchClusterToInventory({
      label: "Luxury Home Builder Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(LUXURY_HUB.url);
    expect(matches[0].url).not.toBe(DESIGN_BUILD.url);
  });

  it("'Build on My Lot / Empty Lot Builders Bay Area' still picks /services/build-on-your-lot", () => {
    const matches = matchClusterToInventory({
      label: "Build on My Lot / Empty Lot Builders Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(BUILD_ON_YOUR_LOT.url);
  });

  it("'Whole Home Renovation Builders Bay Area' still picks /services/whole-home-remodel (renovation→remodel synonym)", () => {
    const matches = matchClusterToInventory({
      label: "Whole Home Renovation Builders Bay Area",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].url).toBe(WHOLE_HOME_REMODEL.url);
  });

  it("isExplicitServiceMatch is exposed on the match record", () => {
    const matches = matchClusterToInventory({
      label: "Best Design-Build Firm for Custom Homes (Bay Area)",
      kind: "topic",
      inventory: RITZ_INVENTORY,
      topN: 10,
    });
    const db = matches.find((m) => m.url === DESIGN_BUILD.url);
    const custom = matches.find((m) => m.url === CUSTOM_HUB.url);
    expect(db?.isExplicitServiceMatch).toBe(true);
    expect(custom?.isExplicitServiceMatch).toBe(false); // hub, never eligible
  });
});
