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

describe("validateCreatePage + winnability arithmetic (item 18)", () => {
  it("without winnability input, behavior is UNCHANGED (no winnability field set)", () => {
    const v = validateCreatePage({ snapshot: snap(CONTENT), ownDomain: "iranopedia.com", searchVolume: 2400 });
    expect(v.verdict).toBe("build");
    expect(v.winnability).toBeUndefined();
  });

  it("a shape-optimistic BUILD is downgraded to WAIT when the difficulty/domain-rank numbers are hard", () => {
    const v = validateCreatePage({
      snapshot: snap(CONTENT),
      ownDomain: "iranopedia.com",
      searchVolume: 2400,
      winnability: { difficulty: 75 },
    });
    expect(v.verdict).toBe("wait");
    expect(v.winnability?.band).toBe("hard");
    expect(v.reasons.some((r) => /75 of 100 difficulty/.test(r))).toBe(true);
  });

  it("a shape-optimistic BUILD is downgraded to REJECT when winnability arithmetic says reject", () => {
    const v = validateCreatePage({
      snapshot: snap(CONTENT),
      ownDomain: "iranopedia.com",
      searchVolume: 2400,
      winnability: { difficulty: 92 },
    });
    expect(v.verdict).toBe("reject");
    expect(v.winnability?.band).toBe("reject");
  });

  it("winnability NEVER upgrades a shape-based reject (already-rank stays reject)", () => {
    const v = validateCreatePage({
      snapshot: snap(["iranopedia.com", ...CONTENT]),
      ownDomain: "iranopedia.com",
      searchVolume: 2400,
      winnability: { difficulty: 5, domainRanks: [10, 15] },
    });
    expect(v.ownAlreadyRanks).toBe(true);
    expect(v.verdict).toBe("reject");
    expect(v.winnability).toBeUndefined(); // arithmetic never even runs for shape rejects
  });

  it("winnability NEVER upgrades a marketplace/UGC shape reject", () => {
    const v = validateCreatePage({
      snapshot: snap(MARKET),
      ownDomain: "iranopedia.com",
      searchVolume: 9000,
      winnability: { difficulty: 5 },
    });
    expect(v.verdict).toBe("reject");
    expect(v.winnability).toBeUndefined();
  });

  it("low difficulty + low domain ranks keeps a shape BUILD at build, with the numbers cited", () => {
    const v = validateCreatePage({
      snapshot: snap(CONTENT),
      ownDomain: "iranopedia.com",
      profoundDomains: ["theknot.com"],
      searchVolume: 2400,
      winnability: { difficulty: 20, domainRanks: [25, 30, 35] },
    });
    expect(v.verdict).toBe("build");
    expect(v.winnability?.band).toBe("winnable");
    expect(v.reasons.some((r) => /20 of 100 difficulty/.test(r))).toBe(true);
  });

  it("never emits an em or en dash across every reason, with or without winnability", () => {
    const cases = [
      validateCreatePage({ snapshot: snap(CONTENT), ownDomain: "iranopedia.com" }),
      validateCreatePage({ snapshot: snap(MARKET), ownDomain: "iranopedia.com" }),
      validateCreatePage({ snapshot: null, ownDomain: "iranopedia.com" }),
      validateCreatePage({ snapshot: snap(["iranopedia.com", ...CONTENT]), ownDomain: "iranopedia.com" }),
      validateCreatePage({ snapshot: snap(CONTENT), ownDomain: "iranopedia.com", winnability: { difficulty: 80 } }),
      validateCreatePage({ snapshot: snap(CONTENT), ownDomain: "iranopedia.com", winnability: { difficulty: 92 } }),
    ];
    for (const v of cases) {
      for (const r of v.reasons) expect(r).not.toMatch(/[–—]/);
    }
  });
});
