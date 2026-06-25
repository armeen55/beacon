import { describe, it, expect } from "vitest";
import { buildProductOpportunities } from "./product-opportunities";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

function kw(keyword: string, searchVolume: number | null, rising = false): KeywordDemand {
  const monthly = rising
    ? Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1, volume: 100 + i * 80 }))
    : Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1, volume: 100 }));
  return {
    keyword,
    searchVolume,
    cpcUsd: 0.5,
    competition: 0.3,
    competitionLevel: "low",
    monthlySearches: monthly,
    locationCode: 2840,
    languageCode: "en",
    source: "dataforseo",
    fetchedAt: "2026-06-25T00:00:00Z",
    confidence: "high",
    evidenceRef: `kw:${keyword}`,
  };
}

describe("buildProductOpportunities", () => {
  it("commerce keyword with no page → concept-only product/collection", () => {
    const out = buildProductOpportunities({ keywords: [kw("nowruz gifts", 1200)], pages: [] });
    const p = out.find((x) => x.keyword === "nowruz gifts")!;
    expect(p).toBeDefined();
    expect(p.conceptOnly).toBe(true);
    expect(p.inventoryStatus).toBe("concept_only");
    expect(p.recommendedAction).toBe("create_collection"); // "gifts" = category
    expect(p.risk).toMatch(/concept only/i);
  });

  it("non-commerce keyword is NOT a product opportunity", () => {
    const out = buildProductOpportunities({ keywords: [kw("persian history", 5000)], pages: [] });
    expect(out.find((x) => x.keyword === "persian history")).toBeUndefined();
  });

  it("attaches LICENSING/IP risk to team/world-cup/jersey concepts", () => {
    const out = buildProductOpportunities({ keywords: [kw("iran world cup jersey", 4800)], pages: [] });
    const p = out.find((x) => x.keyword === "iran world cup jersey")!;
    expect(p.licensingRisk).toBeTruthy();
    expect(p.licensingRisk).toMatch(/licensing|ip/i);
    expect(p.recommendedAction).toBe("create_product");
    expect(p.conceptOnly).toBe(true);
  });

  it("inventory UNKNOWN stays concept_only even when a content page matches", () => {
    const out = buildProductOpportunities({
      keywords: [kw("persian jewelry shop", 900)],
      pages: [{ url: "https://x.com/persian-jewelry", kind: "content" }],
    });
    const p = out.find((x) => x.keyword === "persian jewelry shop")!;
    expect(p.inventoryStatus).toBe("concept_only");
    expect(p.conceptOnly).toBe(true);
  });

  it("CONFIRMED in-stock product page → verified + improve_product_page (no duplicate)", () => {
    const out = buildProductOpportunities({
      keywords: [kw("persian rug shop", 700)],
      pages: [{ url: "https://x.com/products/persian-rug", kind: "product", inStock: true, title: "Persian Rug" }],
    });
    const p = out.find((x) => x.keyword === "persian rug shop")!;
    expect(p.matchStrength).not.toBe("none");
    expect(p.inventoryStatus).toBe("verified");
    expect(p.conceptOnly).toBe(false);
    expect(p.recommendedAction).toBe("improve_product_page");
  });

  it("collection page match → improve_collection (no duplicate collection)", () => {
    const out = buildProductOpportunities({
      keywords: [kw("nowruz gift shop", 1100)],
      pages: [{ url: "https://x.com/collections/nowruz-gift", kind: "collection", title: "Nowruz Gift" }],
    });
    const p = out.find((x) => x.keyword === "nowruz gift shop")!;
    expect(p.matchStrength).not.toBe("none");
    expect(p.recommendedAction).toBe("improve_collection");
  });

  it("weak demand (below floor, not rising) → dropped", () => {
    const out = buildProductOpportunities({ keywords: [kw("obscure persian mug", 10)], pages: [] });
    expect(out.find((x) => x.keyword === "obscure persian mug")).toBeUndefined();
  });

  it("low-volume rising commerce keyword is allowed but low confidence (not a Today Move)", () => {
    const out = buildProductOpportunities({ keywords: [kw("farsi learning gift", 20, true)], pages: [] });
    const p = out.find((x) => x.keyword === "farsi learning gift");
    if (p) {
      expect(p.confidence).toBe("low");
      expect(p.shouldBeTodayMove).toBe(false);
    }
  });

  it("concept-only product with strong demand CAN be a Today Move (but stays labeled)", () => {
    const out = buildProductOpportunities({ keywords: [kw("iranian flag gift", 2000)], pages: [] });
    const p = out.find((x) => x.keyword === "iranian flag gift")!;
    expect(p.conceptOnly).toBe(true);
    expect(p.shouldBeTodayMove).toBe(true);
  });
});
