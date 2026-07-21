/**
 * wix-mapping — the relocated Discover collections workflow (2026-07-20, moved
 * off the retired /diagnostics/wix surface). These pins mock the Wix lib and
 * prove the orchestration: read-only discover → auto-map not-yet-mapped CONTENT
 * collections (never system ones, never clobbering operator-saved rows) → build
 * the url map → report the real mapped-page count, with honest failure reasons.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { WixDiscoveredCollection } from "@/lib/connectors/wix/types";

vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  // Keep the real pure helpers (isProtectedUrlField, used by suggest-mapping);
  // only the network-touching list call is faked.
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return { ...actual, wixListDataCollections: vi.fn() };
});
vi.mock("@/lib/connectors/wix/url-map", () => ({
  getWixCollectionConfig: vi.fn(),
  saveWixCollectionConfig: vi.fn(),
  syncWixUrlMap: vi.fn(),
}));

import { wixListDataCollections } from "@/lib/connectors/wix/client";
import {
  getWixCollectionConfig,
  saveWixCollectionConfig,
  syncWixUrlMap,
} from "@/lib/connectors/wix/url-map";
import { discoverAndMapWixCollections } from "./wix-mapping";

const ARGS = { siteBaseUrl: "https://www.example.com" };

function collection(id: string, displayName: string): WixDiscoveredCollection {
  return {
    id,
    displayName,
    fields: [
      { key: "title", displayName: "Title", type: "TEXT" },
      { key: "slug", displayName: "Slug", type: "TEXT" },
    ],
  };
}

function syncOk(itemsMapped: number, failures: string[] = []) {
  return {
    ok: true as const,
    collections: 1,
    itemsMapped,
    errors: [] as string[],
    probe: { checked: failures.length, ok: 0, failures },
  };
}

beforeEach(() => {
  vi.mocked(wixListDataCollections).mockReset();
  vi.mocked(getWixCollectionConfig).mockReset();
  vi.mocked(saveWixCollectionConfig).mockReset();
  vi.mocked(syncWixUrlMap).mockReset();
  vi.mocked(getWixCollectionConfig).mockResolvedValue([]);
  vi.mocked(saveWixCollectionConfig).mockResolvedValue(undefined);
});

describe("discoverAndMapWixCollections", () => {
  it("auto-maps content collections, skips system ones, and reports the mapped-page count", async () => {
    vi.mocked(wixListDataCollections).mockResolvedValue({
      ok: true,
      value: [
        collection("Recipes", "Persian Recipes"),
        collection("Cities", "Cities"),
        collection("Forms/Contact", "Contact form submissions"),
      ],
    });
    vi.mocked(syncWixUrlMap).mockResolvedValue(syncOk(42));

    const result = await discoverAndMapWixCollections(ARGS);

    expect(result).toEqual({
      ok: true,
      collectionsFound: 2, // the Forms/ system collection is excluded
      collectionsMapped: 2,
      newlyMapped: 2,
      mappedPages: 42,
      probeWarnings: 0,
    });
    // Saved exactly the two content collections; never the system one.
    const saved = vi.mocked(saveWixCollectionConfig).mock.calls[0]![0];
    expect(saved.map((m) => m.dataCollectionId)).toEqual(["Recipes", "Cities"]);
    expect(vi.mocked(syncWixUrlMap)).toHaveBeenCalledWith(ARGS, {});
  });

  it("preserves operator-saved rows and only ADDS the newly discovered collections", async () => {
    vi.mocked(getWixCollectionConfig).mockResolvedValue([
      { dataCollectionId: "Recipes", slugField: "slug", urlPrefix: "/recipes" },
    ]);
    vi.mocked(wixListDataCollections).mockResolvedValue({
      ok: true,
      value: [collection("Recipes", "Persian Recipes"), collection("Cities", "Cities")],
    });
    vi.mocked(syncWixUrlMap).mockResolvedValue(syncOk(10));

    const result = await discoverAndMapWixCollections(ARGS);

    expect(result.ok && result.newlyMapped).toBe(1);
    expect(result.ok && result.collectionsMapped).toBe(2);
    const saved = vi.mocked(saveWixCollectionConfig).mock.calls[0]![0];
    expect(saved.map((m) => m.dataCollectionId)).toEqual(["Recipes", "Cities"]);
  });

  it("does not re-save when every content collection is already mapped, but still rebuilds the map", async () => {
    vi.mocked(getWixCollectionConfig).mockResolvedValue([
      { dataCollectionId: "Recipes", slugField: "slug", urlPrefix: "/recipes" },
    ]);
    vi.mocked(wixListDataCollections).mockResolvedValue({
      ok: true,
      value: [collection("Recipes", "Persian Recipes")],
    });
    vi.mocked(syncWixUrlMap).mockResolvedValue(syncOk(7));

    const result = await discoverAndMapWixCollections(ARGS);

    expect(vi.mocked(saveWixCollectionConfig)).not.toHaveBeenCalled();
    expect(result.ok && result.mappedPages).toBe(7);
    expect(result.ok && result.newlyMapped).toBe(0);
  });

  it("surfaces a not-connected read as no_key without touching the config", async () => {
    vi.mocked(wixListDataCollections).mockResolvedValue({ ok: false, reason: "no_key" });
    const result = await discoverAndMapWixCollections(ARGS);
    expect(result).toEqual({ ok: false, reason: "no_key", detail: undefined });
    expect(vi.mocked(saveWixCollectionConfig)).not.toHaveBeenCalled();
    expect(vi.mocked(syncWixUrlMap)).not.toHaveBeenCalled();
  });

  it("maps an unexpected Wix read failure to api_error and preserves the detail", async () => {
    vi.mocked(wixListDataCollections).mockResolvedValue({
      ok: false,
      reason: "api_error",
      detail: "http_500: boom",
    });
    const result = await discoverAndMapWixCollections(ARGS);
    expect(result).toEqual({ ok: false, reason: "api_error", detail: "http_500: boom" });
  });

  it("returns sync_failed with a joined detail when the url-map build fails", async () => {
    vi.mocked(wixListDataCollections).mockResolvedValue({
      ok: true,
      value: [collection("Recipes", "Persian Recipes")],
    });
    vi.mocked(syncWixUrlMap).mockResolvedValue({
      ok: false,
      collections: 1,
      itemsMapped: 0,
      errors: ["Recipes: api_error (http_503)"],
      probe: { checked: 0, ok: 0, failures: [] },
    });
    const result = await discoverAndMapWixCollections(ARGS);
    expect(result).toEqual({
      ok: false,
      reason: "sync_failed",
      detail: "Recipes: api_error (http_503)",
    });
  });

  it("reports ok with mappedPages 0 when collections exist but nothing mapped yet (honest, not faked success)", async () => {
    vi.mocked(wixListDataCollections).mockResolvedValue({
      ok: true,
      value: [collection("Recipes", "Persian Recipes")],
    });
    vi.mocked(syncWixUrlMap).mockResolvedValue(syncOk(0));
    const result = await discoverAndMapWixCollections(ARGS);
    expect(result).toEqual({
      ok: true,
      collectionsFound: 1,
      collectionsMapped: 1,
      newlyMapped: 1,
      mappedPages: 0,
      probeWarnings: 0,
    });
  });
});
