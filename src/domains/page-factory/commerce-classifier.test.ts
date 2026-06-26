import { describe, it, expect } from "vitest";
import { classifyCommerceUrl, summarizeCommerce } from "./commerce-classifier";

describe("classifyCommerceUrl", () => {
  it("tags a product page (segment + slug)", () => {
    expect(classifyCommerceUrl("https://x.com/products/persian-rug-blue").kind).toBe("product");
    expect(classifyCommerceUrl("https://x.com/shop/item/sku-123").kind).toBe("product");
  });

  it("tags a collection/listing leaf", () => {
    expect(classifyCommerceUrl("https://x.com/collections/rugs").kind).toBe("collection");
    expect(classifyCommerceUrl("https://x.com/shop").kind).toBe("collection");
    expect(classifyCommerceUrl("https://x.com/category/gifts/").kind).toBe("collection");
  });

  it("tags a normal content page", () => {
    expect(classifyCommerceUrl("https://x.com/persian-wedding-traditions").kind).toBe("content");
    expect(classifyCommerceUrl("https://x.com/blog/nowruz-guide").kind).toBe("content");
    expect(classifyCommerceUrl("https://x.com/").kind).toBe("content");
  });

  it("honors Wix store membership over URL shape", () => {
    expect(classifyCommerceUrl("https://x.com/some-page", { isWixProduct: true }).kind).toBe("product");
    expect(classifyCommerceUrl("https://x.com/some-page", { isWixCollection: true }).kind).toBe("collection");
  });

  it("respects custom patterns (tenant-agnostic, no hardcoding)", () => {
    expect(classifyCommerceUrl("https://x.com/tienda/zapato-rojo", { productSegments: ["tienda"] }).kind).toBe("product");
  });
});

describe("summarizeCommerce", () => {
  it("counts by kind and ignores empties", () => {
    const s = summarizeCommerce([
      "https://x.com/products/a-slug",
      "https://x.com/collections/rugs",
      "https://x.com/about",
      "",
    ]);
    expect(s).toEqual({ product: 1, collection: 1, content: 1, total: 3 });
  });
});
