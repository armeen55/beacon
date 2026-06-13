/**
 * 2026-06-13 — Wix content-push slice: deriveWixContentFieldKey.
 *
 * Pins the operator-config-driven derivation that lets Accept push a
 * content edit (title/heading/meta) LIVE to a Wix CMS page:
 *   • edit_title / change_h1 / edit_meta + a configured contentFieldRoles
 *     entry → "field:<cmsField>" (edit_meta → the `description` field the
 *     dynamic page's meta-description SEO Variable references);
 *   • action with no mapped role → null (card stays paste-ready);
 *   • URL not in the synced url-map → null;
 *   • collection present but no contentFieldRoles → null (opt-in);
 *   • NO hardcoding — the field name comes only from operator config.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const _stores = new Map<string, unknown[]>();
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    _stores.set(name, data);
  },
}));

import { deriveWixContentFieldKey } from "@/lib/connectors/wix/url-map";

const URL = "https://x.com/poets";

beforeEach(() => {
  _stores.clear();
  _stores.set("wix-url-map", [
    {
      url: URL,
      dataCollectionId: "Poets",
      dataItemId: "i1",
      slugField: "slug",
      label: null,
      syncedAt: "2026-06-13T00:00:00Z",
    },
  ]);
  _stores.set("wix-collection-config", [
    {
      dataCollectionId: "Poets",
      slugField: "slug",
      urlPrefix: "/poets",
      contentFieldRoles: {
        title: "seoTitle",
        heading: "h1Text",
        description: "seoDescription",
      },
    },
  ]);
});

describe("deriveWixContentFieldKey", () => {
  it("edit_title → field:<configured title field>", async () => {
    expect(await deriveWixContentFieldKey(URL, "edit_title")).toBe("field:seoTitle");
  });

  it("change_h1 → field:<configured heading field>", async () => {
    expect(await deriveWixContentFieldKey(URL, "change_h1")).toBe("field:h1Text");
  });

  it("edit_meta → field:<configured description field> (Wix SEO-Variable-backed meta)", async () => {
    expect(await deriveWixContentFieldKey(URL, "edit_meta")).toBe("field:seoDescription");
  });

  it("edit_meta → null when description role is absent (opt-in; many collections have no per-item meta field)", async () => {
    _stores.set("wix-collection-config", [
      {
        dataCollectionId: "Poets",
        slugField: "slug",
        urlPrefix: "/poets",
        contentFieldRoles: { title: "seoTitle", heading: "h1Text" }, // no description
      },
    ]);
    expect(await deriveWixContentFieldKey(URL, "edit_meta")).toBeNull();
    // siblings still resolve
    expect(await deriveWixContentFieldKey(URL, "edit_title")).toBe("field:seoTitle");
  });

  it("an action with no content role → null (stays paste-ready)", async () => {
    expect(await deriveWixContentFieldKey(URL, "add_internal_link")).toBeNull();
    expect(await deriveWixContentFieldKey(URL, "add_schema")).toBeNull();
  });

  it("URL not in the synced map → null", async () => {
    expect(await deriveWixContentFieldKey("https://x.com/not-mapped", "edit_title")).toBeNull();
  });

  it("collection mapped but no contentFieldRoles configured → null (opt-in)", async () => {
    _stores.set("wix-collection-config", [
      { dataCollectionId: "Poets", slugField: "slug", urlPrefix: "/poets" },
    ]);
    expect(await deriveWixContentFieldKey(URL, "edit_title")).toBeNull();
  });

  it("role present but that specific field empty → null", async () => {
    _stores.set("wix-collection-config", [
      {
        dataCollectionId: "Poets",
        slugField: "slug",
        urlPrefix: "/poets",
        contentFieldRoles: { heading: "h1Text" }, // title intentionally absent
      },
    ]);
    expect(await deriveWixContentFieldKey(URL, "edit_title")).toBeNull();
    expect(await deriveWixContentFieldKey(URL, "change_h1")).toBe("field:h1Text");
  });
});
