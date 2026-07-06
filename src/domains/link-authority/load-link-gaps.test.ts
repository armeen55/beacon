import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoredKeywordGaps } from "@/domains/serp/keyword-gap-store";

// The loader reads the $0 keyword-gap store + the ALREADY-cached backlink /
// difficulty maps. Mock all three so no real store or paid path is touched.
let _storedGaps: StoredKeywordGaps | null = null;
let _cachedBacklinks: Map<string, number | null> = new Map();
let _cachedDifficulty: Map<string, number | null> = new Map();

vi.mock("@/domains/serp/keyword-gap-store", () => ({
  readKeywordGapResults: async () => _storedGaps,
}));

vi.mock("@/domains/serp/dataforseo-labs", async () => {
  const actual = await vi.importActual<typeof import("@/domains/serp/dataforseo-labs")>(
    "@/domains/serp/dataforseo-labs",
  );
  return {
    ...actual,
    readAllCachedBacklinks: async () => _cachedBacklinks,
    readAllCachedKeywordDifficulty: async () => _cachedDifficulty,
  };
});

import { loadLinkGapsForTenant } from "./load-link-gaps";

function storedGaps(overrides: Partial<StoredKeywordGaps> = {}): StoredKeywordGaps {
  return {
    tenant_id: "tenant-a",
    computed_at: new Date().toISOString(),
    own_domain: "iranopedia.com",
    competitors: ["supplehomes.com"],
    spent_usd: 0,
    gaps: [
      {
        keyword: "persian rugs",
        volume: 1900,
        cpcUsd: null,
        competitorDomain: "supplehomes.com",
        competitorRank: 3,
        ownRank: 24,
        alsoWonBy: [],
        score: 1900,
        evidence: "supplehomes.com ranks 3 on Google for persian rugs.",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  _storedGaps = null;
  _cachedBacklinks = new Map();
  _cachedDifficulty = new Map();
});

describe("loadLinkGapsForTenant - joins the $0 gap store with cached backlink reads", () => {
  it("emits a link gap when the cached backlink counts show a huge multiple", async () => {
    _storedGaps = storedGaps();
    _cachedBacklinks = new Map<string, number | null>([
      ["https://supplehomes.com/persian-rugs", 210],
      ["https://iranopedia.com/rugs", 3],
    ]);
    const gaps = await loadLinkGapsForTenant("tenant-a", { ownDomain: "iranopedia.com" });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.competitorDomain).toBe("supplehomes.com");
    expect(gaps[0]!.referringDomainMultiple).toBe(70);
  });

  it("returns [] when there is no keyword-gap run yet (empty-safe)", async () => {
    _storedGaps = null;
    _cachedBacklinks = new Map<string, number | null>([["https://supplehomes.com/x", 210]]);
    expect(await loadLinkGapsForTenant("tenant-a", { ownDomain: "iranopedia.com" })).toEqual([]);
  });

  it("returns [] when no backlink reads are cached yet (never a fresh paid call)", async () => {
    _storedGaps = storedGaps();
    _cachedBacklinks = new Map();
    expect(await loadLinkGapsForTenant("tenant-a", { ownDomain: "iranopedia.com" })).toEqual([]);
  });

  it("returns [] when the competitor domain has no cached backlink read", async () => {
    _storedGaps = storedGaps();
    // Only the tenant's own page is cached; the competitor's is not.
    _cachedBacklinks = new Map<string, number | null>([["https://iranopedia.com/rugs", 3]]);
    expect(await loadLinkGapsForTenant("tenant-a", { ownDomain: "iranopedia.com" })).toEqual([]);
  });

  it("returns [] when the multiple is within the threshold (a beatable gap)", async () => {
    _storedGaps = storedGaps();
    _cachedBacklinks = new Map<string, number | null>([
      ["https://supplehomes.com/persian-rugs", 20],
      ["https://iranopedia.com/rugs", 8],
    ]);
    expect(await loadLinkGapsForTenant("tenant-a", { ownDomain: "iranopedia.com" })).toEqual([]);
  });

  it("stays winnable on merit (no gap) when a cached low-difficulty read exists", async () => {
    _storedGaps = storedGaps();
    _cachedBacklinks = new Map<string, number | null>([
      ["https://supplehomes.com/persian-rugs", 210],
      ["https://iranopedia.com/rugs", 3],
    ]);
    _cachedDifficulty = new Map<string, number | null>([["persian rugs", 15]]);
    expect(await loadLinkGapsForTenant("tenant-a", { ownDomain: "iranopedia.com" })).toEqual([]);
  });

  it("uses the strongest competitor page's referring-domain count for the domain", async () => {
    _storedGaps = storedGaps();
    _cachedBacklinks = new Map<string, number | null>([
      ["https://supplehomes.com/weak-page", 40],
      ["https://supplehomes.com/persian-rugs", 210],
      ["https://iranopedia.com/rugs", 3],
    ]);
    const gaps = await loadLinkGapsForTenant("tenant-a", { ownDomain: "iranopedia.com" });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.competitorReferringDomains).toBe(210);
  });
});
