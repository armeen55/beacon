/**
 * N40 contract test - Wix Data collections/items + Stores SEO fields.
 *
 * Feeds checked-in fixtures of the REAL Wix REST response shapes through the
 * ACTUAL client functions (wixQueryDataItems / wixListDataCollections /
 * wixGetStoreProduct with an injected fetchImpl + token seam - the same code
 * the push layer and the mapping UI call), so a silent upstream change fails
 * a named test here instead of surfacing as a broken URL map or a blanked
 * SEO field. NO live calls.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  wixQueryDataItems,
  wixListDataCollections,
  wixGetStoreProduct,
} from "@/lib/connectors/wix/client";

const TOKEN = { api_key: "test-key", site_id: "test-site" };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf-8"));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Wix Data items/query contract", () => {
  it("parses dataItems[] { id, data } and drops malformed items instead of throwing", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return jsonResponse(fixture("wix-query-items.json"));
    }) as unknown as typeof fetch;
    const r = await wixQueryDataItems(
      { dataCollectionId: "Recipes" },
      { fetchImpl, token: TOKEN },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 3 raw items -> 2 kept: the id-less item is dropped; the data-less item
    // keeps an empty data object (id is the only hard requirement).
    expect(r.value).toHaveLength(2);
    const koobideh = r.value[0]!;
    expect(koobideh.id).toBe("item-koobideh");
    expect(koobideh.dataCollectionId).toBe("Recipes");
    // The CMS SEO fields our mapping + push layer read live under `data`.
    expect(typeof koobideh.data.seoTitle).toBe("string");
    expect(typeof koobideh.data.seoDescription).toBe("string");
    expect(typeof koobideh.data.slug).toBe("string");
    expect(r.value[1]!.data).toEqual({});
    expect(calls[0]).toContain("/wix-data/v2/items/query");
  });
});

describe("Wix Data collections/list contract", () => {
  it("parses collections[] with fields, honoring BOTH `type` and legacy `fieldType`", async () => {
    const fetchImpl = (async () => jsonResponse(fixture("wix-collections.json"))) as typeof fetch;
    const r = await wixListDataCollections({ fetchImpl, token: TOKEN });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The id-less collection is dropped; the rest keep their shape.
    expect(r.value).toHaveLength(2);
    const recipes = r.value.find((c) => c.id === "Recipes")!;
    expect(recipes.displayName).toBe("Recipes");
    // 6 raw fields -> 5 kept (the key-less field is dropped, never throws).
    expect(recipes.fields).toHaveLength(5);
    const byKey = new Map(recipes.fields.map((f) => [f.key, f]));
    expect(byKey.get("title")!.type).toBe("TEXT");
    // Wix uses `fieldType` on some API versions - the fallback must hold.
    expect(byKey.get("seoTitle")!.type).toBe("TEXT");
    // Unknown-typed fields degrade to "UNKNOWN", never undefined.
    expect(byKey.get("mysteryField")!.type).toBe("UNKNOWN");
    // A collection with no displayName falls back to its id.
    const cities = r.value.find((c) => c.id === "Cities")!;
    expect(cities.displayName).toBe("Cities");
  });
});

describe("Wix Stores product SEO fields contract", () => {
  it("parses product { id, name, slug, seoData.tags[] } - the pre-push snapshot shape", async () => {
    const fetchImpl = (async () => jsonResponse(fixture("wix-store-product.json"))) as typeof fetch;
    const r = await wixGetStoreProduct({ productId: "prod-123" }, { fetchImpl, token: TOKEN });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe("prod-123");
    expect(r.value.name).toBe("Saffron Threads 2g");
    expect(r.value.slug).toBe("saffron-threads-2g");
    // seoData.tags is the shape wixUpdateProductSeoData writes back - a drift
    // here would make the fail-closed pre-push snapshot silently empty.
    const tags = r.value.seoData?.tags ?? [];
    expect(tags).toHaveLength(2);
    const title = tags.find((t) => t.type === "title")!;
    expect(typeof title.children).toBe("string");
    const meta = tags.find((t) => t.type === "meta")!;
    expect(meta.props).toMatchObject({ name: "description" });
    expect(typeof meta.props?.content).toBe("string");
  });
  it("a body with no product is an api_error result, never a throw", async () => {
    const fetchImpl = (async () => jsonResponse({})) as typeof fetch;
    const r = await wixGetStoreProduct({ productId: "prod-404" }, { fetchImpl, token: TOKEN });
    expect(r).toMatchObject({ ok: false, reason: "api_error" });
  });
});
