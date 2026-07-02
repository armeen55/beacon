/**
 * BEACON_500 item 45 (2026-07-02): the Wix deep-link resolver contract.
 * Pure function - no mocks needed. Pins the two real URL shapes (Stores
 * product editor vs Content Manager collection view) and the honest-null
 * rails for every missing piece.
 */

import { describe, it, expect } from "vitest";

import {
  buildWixEditorLink,
  WIX_STORES_PRODUCTS_COLLECTION_ID,
} from "@/domains/push/wix-deep-link";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const SITE_ID = "a1b2c3d4-0000-1111-2222-333344445555";

describe("buildWixEditorLink - mapped CMS collection item", () => {
  it("resolves a non-Stores collection to the Content Manager collection URL", () => {
    const link = buildWixEditorLink({
      siteId: SITE_ID,
      dataCollectionId: "FamousIranians",
      dataItemId: "item-42",
    });
    expect(link).not.toBeNull();
    expect(link!.toString()).toBe(
      `https://manage.wix.com/dashboard/${SITE_ID}/database/data/FamousIranians`,
    );
  });

  it("does not require an item id for a plain CMS collection link", () => {
    const link = buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: "Recipes" });
    expect(link).not.toBeNull();
    expect(link!.toString()).toContain("/database/data/Recipes");
  });

  it("URL-encodes a collection id containing special characters", () => {
    const link = buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: "My Collection/v2" });
    expect(link).not.toBeNull();
    expect(link!.pathname).toContain(encodeURIComponent("My Collection/v2"));
  });
});

describe("buildWixEditorLink - Wix Stores product", () => {
  it("resolves Stores/Products + an item id to the product editor URL", () => {
    const link = buildWixEditorLink({
      siteId: SITE_ID,
      dataCollectionId: WIX_STORES_PRODUCTS_COLLECTION_ID,
      dataItemId: "product-99",
    });
    expect(link).not.toBeNull();
    expect(link!.toString()).toBe(
      `https://manage.wix.com/dashboard/${SITE_ID}/stores/products/product-99`,
    );
  });

  it("a Stores product with no item id resolves to null (never a dead link)", () => {
    const link = buildWixEditorLink({
      siteId: SITE_ID,
      dataCollectionId: WIX_STORES_PRODUCTS_COLLECTION_ID,
      dataItemId: null,
    });
    expect(link).toBeNull();
  });
});

describe("buildWixEditorLink - honest null when unmapped", () => {
  it("no site id (Wix not connected) resolves to null", () => {
    expect(buildWixEditorLink({ siteId: null, dataCollectionId: "Recipes", dataItemId: "x" })).toBeNull();
    expect(buildWixEditorLink({ siteId: undefined, dataCollectionId: "Recipes" })).toBeNull();
    expect(buildWixEditorLink({ siteId: "  ", dataCollectionId: "Recipes" })).toBeNull();
  });

  it("no collection mapping (page not resolved through the url-map) resolves to null", () => {
    expect(buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: null })).toBeNull();
    expect(buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: undefined })).toBeNull();
    expect(buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: "   " })).toBeNull();
  });

  it("never throws on empty input", () => {
    expect(() => buildWixEditorLink({ siteId: null, dataCollectionId: null })).not.toThrow();
  });
});

describe("buildWixEditorLink - dash-clean, read-only affordance", () => {
  it("the resolved URL string never carries a banned dash from formatting", () => {
    const link = buildWixEditorLink({
      siteId: SITE_ID,
      dataCollectionId: WIX_STORES_PRODUCTS_COLLECTION_ID,
      dataItemId: "product-1",
    });
    expect(link).not.toBeNull();
    expect(hasBannedDash(link!.toString())).toBe(false);
  });

  it("is a pure function: the same input always returns an equal URL", () => {
    const a = buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: "Recipes", dataItemId: "1" });
    const b = buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: "Recipes", dataItemId: "1" });
    expect(a!.toString()).toBe(b!.toString());
  });
});
