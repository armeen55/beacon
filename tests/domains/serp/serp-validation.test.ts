import { describe, it, expect } from "vitest";

import { validateCreatePage } from "@/domains/serp/serp-validation";
import type { SerpSnapshot, SerpResult } from "@/domains/serp/serp-provider";

const r = (rank: number, domain: string): SerpResult => ({ rank, domain, url: `https://${domain}/x`, title: domain });
const snap = (domains: string[]): SerpSnapshot => ({
  query: "persian wedding",
  results: domains.map((d, i) => r(i + 1, d)),
  features: [],
  source: "dataforseo",
  fetchedAt: "2026-06-25T00:00:00Z",
});

const CONTENT = ["theknot.com", "brides.com", "history.com", "wikipedia.org", "seriouseats.com", "vogue.com"];
const MARKET = ["amazon.com", "etsy.com", "ebay.com", "pinterest.com", "aliexpress.com", "walmart.com", "reddit.com"];

describe("validateCreatePage (Phase 4 SERP verdict)", () => {
  it("content SERP + real volume + Profound overlap → build / HIGH", () => {
    const v = validateCreatePage({
      snapshot: snap(CONTENT),
      ownDomain: "iranopedia.com",
      profoundDomains: ["theknot.com"],
      searchVolume: 2400,
    });
    expect(v.verdict).toBe("build");
    expect(v.confidence).toBe("high");
    expect(v.profoundOverlapCount).toBe(1);
    expect(v.intent).toBe("content");
  });

  it("content SERP but no volume + no overlap → build / LOW (buildable, unproven)", () => {
    const v = validateCreatePage({ snapshot: snap(CONTENT), ownDomain: "iranopedia.com" });
    expect(v.verdict).toBe("build");
    expect(v.confidence).toBe("low");
  });

  it("marketplace/UGC-dominated SERP → reject", () => {
    const v = validateCreatePage({ snapshot: snap(MARKET), ownDomain: "iranopedia.com", searchVolume: 9000 });
    expect(v.verdict).toBe("reject");
    expect(v.intent).toBe("marketplace_ugc");
    expect(v.marketplaceUgcCount).toBeGreaterThanOrEqual(6);
  });

  it("you already rank in the top 10 → reject (it's an edit, not a create)", () => {
    const v = validateCreatePage({
      snapshot: snap(["iranopedia.com", ...CONTENT]),
      ownDomain: "iranopedia.com",
      searchVolume: 2400,
    });
    expect(v.ownAlreadyRanks).toBe(true);
    expect(v.verdict).toBe("reject");
  });

  it("no snapshot (SERP unknown) → wait / LOW, never fabricates", () => {
    const v = validateCreatePage({ snapshot: null, ownDomain: "iranopedia.com" });
    expect(v.verdict).toBe("wait");
    expect(v.confidence).toBe("low");
    expect(v.topDomains).toEqual([]);
  });

  it("content + only volume (no overlap) → build / MEDIUM", () => {
    const v = validateCreatePage({ snapshot: snap(CONTENT), ownDomain: "iranopedia.com", searchVolume: 1200 });
    expect(v.verdict).toBe("build");
    expect(v.confidence).toBe("medium");
  });
});
