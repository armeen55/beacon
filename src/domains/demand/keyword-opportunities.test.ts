import { describe, it, expect } from "vitest";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { clusterKeywords, matchClusterToPage, buildOpportunities } from "./keyword-opportunities";

function kw(keyword: string, searchVolume: number | null, over: Partial<KeywordDemand> = {}): KeywordDemand {
  return {
    keyword,
    searchVolume,
    cpcUsd: 0.3,
    competition: 0.2,
    competitionLevel: "low",
    monthlySearches: [],
    locationCode: 2840,
    languageCode: "en",
    source: "dataforseo",
    fetchedAt: "2026-06-25T00:00:00Z",
    confidence: searchVolume != null ? "medium" : "low",
    evidenceRef: "dataforseo:keywords_data/google_ads/search_volume",
    ...over,
  };
}

const risingTrend = Array.from({ length: 8 }, (_, i) => ({ year: 2026, month: i + 1, volume: i < 5 ? 100 : 400 }));
const decliningTrend = Array.from({ length: 8 }, (_, i) => ({ year: 2026, month: i + 1, volume: i < 5 ? 1000 : 200 }));

describe("clusterKeywords", () => {
  it("groups near-duplicates into one cluster, keeps distinct topics separate", () => {
    const clusters = clusterKeywords([
      kw("persian boy names", 5000),
      kw("persian boys names", 800),
      kw("persian male names", 1200),
      kw("iran flag history", 2000),
    ]);
    // 3 name variants collapse; the flag topic is its own cluster.
    expect(clusters.length).toBe(2);
    const nameCluster = clusters.find((c) => c.some((k) => k.keyword === "persian boy names"))!;
    expect(nameCluster.length).toBeGreaterThanOrEqual(2);
  });
});

describe("matchClusterToPage (gap map)", () => {
  const pages = [{ url: "https://iranopedia.com/persian-male-names", title: "Persian Male Names" }];
  it("strong match for an on-topic existing page", () => {
    const m = matchClusterToPage(new Set(["persian", "male", "name"]), pages);
    expect(m.strength).toBe("strong");
    expect(m.url).toContain("persian-male-names");
  });
  it("none when no page is close", () => {
    expect(matchClusterToPage(new Set(["nowruz", "gift"]), pages).strength).toBe("none");
  });
});

describe("buildOpportunities", () => {
  const ownedPages = [
    { url: "https://iranopedia.com/persian-male-names", title: "Persian Male Names" },
    { url: "https://iranopedia.com/iran-flags", title: "Iran Flag" },
  ];
  const tenantTopics = ["persian male names", "iran flag", "persian culture", "iran cities"];

  it("creates a NEW page opportunity for unmatched demand", () => {
    const opps = buildOpportunities({ keywords: [kw("persian wedding traditions", 4000)], ownedPages, tenantTopics: [...tenantTopics, "persian wedding"] });
    expect(opps).toHaveLength(1);
    expect(opps[0]!.action).toBe("create_page");
    expect(opps[0]!.proposedSlug).toBe("persian-wedding-traditions");
    expect(opps[0]!.matchStrength).toBe("none");
  });

  it("recommends improving an EXISTING page (not a duplicate) on a strong match", () => {
    const opps = buildOpportunities({ keywords: [kw("persian male names meaning", 3000)], ownedPages, tenantTopics });
    expect(opps[0]!.action).toBe("update_title_meta");
    expect(opps[0]!.matchedPageUrl).toContain("persian-male-names");
    expect(opps[0]!.proposedSlug).toBeNull(); // never a duplicate page
  });

  it("refreshes a strong-match page when its demand is DECLINING", () => {
    const opps = buildOpportunities({ keywords: [kw("iran flag", 9000, { monthlySearches: decliningTrend })], ownedPages, tenantTopics });
    expect(opps[0]!.action).toBe("content_refresh");
    expect(opps[0]!.trend).toBe("declining");
  });

  it("drops garbage low-volume keywords, keeps a rising low-volume one", () => {
    const opps = buildOpportunities({
      keywords: [kw("obscure thin term", 5), kw("emerging persian topic", 20, { monthlySearches: risingTrend })],
      ownedPages,
      tenantTopics: [...tenantTopics, "persian topic", "emerging"],
    });
    expect(opps.some((o) => o.primaryKeyword === "obscure thin term")).toBe(false);
    expect(opps.some((o) => o.primaryKeyword === "emerging persian topic")).toBe(true);
  });

  it("drops OFF-BRAND keywords when tenant topics are known", () => {
    const opps = buildOpportunities({ keywords: [kw("car insurance quotes", 90000)], ownedPages, tenantTopics });
    expect(opps).toHaveLength(0);
  });

  it("treats a commercial keyword as a PRODUCT CONCEPT (no live inventory)", () => {
    const opps = buildOpportunities({ keywords: [kw("iran flag t-shirt", 3000)], ownedPages, tenantTopics: [...tenantTopics, "iran flag shirt"] });
    expect(opps[0]!.action).toBe("create_product");
    expect(opps[0]!.parentType).toBe("commerce_move");
    expect(opps[0]!.risk).toContain("Concept only");
  });

  it("never fabricates demand: a null-volume keyword contributes no invented number", () => {
    const opps = buildOpportunities({ keywords: [kw("nowruz gifts", null)], ownedPages, tenantTopics: [...tenantTopics, "nowruz gifts"] });
    // estDemand 0, non-rising → below floor → dropped (no fake volume).
    expect(opps).toHaveLength(0);
  });
});
