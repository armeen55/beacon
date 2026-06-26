import { describe, it, expect } from "vitest";
import { detectProductSeoGaps, summarizeProductSeoGaps } from "./product-seo-gaps";

describe("detectProductSeoGaps", () => {
  it("flags a product page missing schema as high severity", () => {
    const g = detectProductSeoGaps([
      { url: "https://x.com/products/blue-rug", title: "Blue Persian Rug 5x7 Handwoven", metaDescription: "A beautiful handwoven blue Persian rug, 5x7 feet, wool.", hasProductSchema: false },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe("product");
    expect(g[0].issues).toContain("missing_schema");
    expect(g[0].severity).toBe("high");
  });

  it("flags weak title / missing meta / missing alt at medium", () => {
    const g = detectProductSeoGaps([
      { url: "https://x.com/products/x", title: "Rug", metaDescription: null, hasProductSchema: true, imagesMissingAlt: 3 },
    ]);
    expect(g[0].issues).toEqual(expect.arrayContaining(["weak_title", "missing_meta", "missing_alt"]));
    expect(g[0].severity).toBe("medium");
  });

  it("skips content pages entirely", () => {
    expect(detectProductSeoGaps([{ url: "https://x.com/persian-wedding", hasProductSchema: false }])).toHaveLength(0);
  });

  it("emits nothing for a clean product page", () => {
    expect(
      detectProductSeoGaps([
        { url: "https://x.com/products/clean", title: "A Perfectly Good Product Title Here", metaDescription: "A sufficiently long and descriptive meta description for this product page.", hasProductSchema: true, imagesMissingAlt: 0 },
      ]),
    ).toHaveLength(0);
  });

  it("honors Wix product membership even on a content-shaped URL", () => {
    const g = detectProductSeoGaps([{ url: "https://x.com/special", isWixProduct: true, hasProductSchema: false, title: "ok title that is long enough", metaDescription: "long enough meta description to pass the minimum length check here" }]);
    expect(g[0].kind).toBe("product");
    expect(g[0].severity).toBe("high");
  });

  it("ranks high before medium", () => {
    const g = detectProductSeoGaps([
      { url: "https://x.com/products/med", title: "Tee", metaDescription: "long enough meta description to pass the minimum length check here", hasProductSchema: true },
      { url: "https://x.com/products/high", title: "Another fine long title", metaDescription: "long enough meta description to pass the minimum length check here", hasProductSchema: false },
    ]);
    expect(g[0].url).toBe("https://x.com/products/high");
  });
});

describe("summarizeProductSeoGaps", () => {
  it("rolls up counts", () => {
    const g = detectProductSeoGaps([
      { url: "https://x.com/products/a", title: "A long enough title here", metaDescription: "long enough meta description to pass the minimum length check here", hasProductSchema: false },
      { url: "https://x.com/collections/b", title: "B", metaDescription: null, hasProductSchema: true, imagesMissingAlt: 2 },
    ]);
    const s = summarizeProductSeoGaps(g);
    expect(s.pages).toBe(2);
    expect(s.high).toBe(1);
    expect(s.bySchema).toBe(1);
    expect(s.byAlt).toBe(1);
  });
});
