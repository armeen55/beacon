/**
 * SOURCES — DataForSEO provider boundaries (Core 100K lane S merge).
 * Spend-cap / dry-run fail-closed pins survive here per the risk register.
 */
import { describe, it, expect, vi } from "vitest";
import {
  runLabsQuery,
  runRankedKeywords,
  runRankedKeywordsForPage,
  runRelatedKeywords,
  readAllCachedRelatedKeywords,
  runDomainIntersection,
  parseRankedKeywords,
  parseDomainIntersection,
  normalizeDomainTarget,
  LABS_COST_USD,
  PAGE_KEYWORDS_COST_USD,
  PAGE_KEYWORD_ROW_LIMIT,
  RELATED_KEYWORDS_COST_USD,
  RELATED_KEYWORD_ROW_LIMIT,
  runBulkKeywordDifficulty,
  runBulkDomainRanks,
  runBacklinksSummary,
  parseBulkKeywordDifficulty,
  parseBulkDomainRanks,
  parseBacklinksSummary,
  readAllCachedKeywordDifficulty,
  readCachedKeywordResearchCorpus,
  readAllCachedBacklinks,
  LABS_BULK_DIFFICULTY_COST_USD,
  BACKLINKS_BULK_RANKS_COST_USD,
  BACKLINKS_REFERRING_DOMAINS_COST_USD,
  runHistoricalVolume,
  parseHistoricalVolume,
  HISTORICAL_VOLUME_COST_USD,
  HISTORICAL_VOLUME_KEYWORDS_LIMIT,
  type LabsRunDeps,
} from "@/domains/serp/dataforseo-labs";

const CONFIGURED_ENV = {
  BEACON_SERP_PROVIDER: "dataforseo",
  DATAFORSEO_AUTH_B64: "dGVzdDp0ZXN0",
  DATAFORSEO_DRY_RUN: "false",
  DATAFORSEO_MONTHLY_CAP_USD: "50",
} as unknown as NodeJS.ProcessEnv;

const RANKED_BODY = {
  tasks: [
    {
      result: [
        {
          items: [
            {
              keyword_data: { keyword: "persian wedding sofreh", keyword_info: { search_volume: 1900, cpc: 0.42 } },
              ranked_serp_element: { serp_item: { rank_group: 3, rank_absolute: 4, url: "https://supplehomes.com/sofreh-guide" } },
            },
            {
              keyword_data: { keyword: "no rank keyword", keyword_info: { search_volume: 10 } },
              ranked_serp_element: {}, // no rank -> dropped
            },
            {
              keyword_data: { keyword: "flat shape keyword", keyword_info: { search_volume: 320 } },
              ranked_serp_element: { rank_group: 11 }, // flattened shape also accepted
            },
          ],
        },
      ],
    },
  ],
};

const INTERSECTION_BODY = {
  tasks: [
    {
      result: [
        {
          items: [
            {
              keyword_data: { keyword: "qanat system", keyword_info: { search_volume: 720, cpc: 0.1 } },
              first_domain_serp_element: { serp_item: { rank_group: 5 } },
              second_domain_serp_element: null, // intersections:false -> tenant absent
            },
            {
              keyword_data: { keyword: "persian tea culture", keyword_info: { search_volume: 480 } },
              first_domain_serp_element: { rank_group: 9 },
              second_domain_serp_element: { rank_group: 34 }, // tenant ranks, deep
            },
          ],
        },
      ],
    },
  ],
};

function deps(over: Partial<LabsRunDeps> = {}): Partial<LabsRunDeps> {
  return {
    env: CONFIGURED_ENV,
    now: () => new Date("2026-07-02T00:00:00Z"),
    tenantId: async () => "tenant-iranopedia",
    spentThisMonthUsd: async () => 0,
    recordSpend: vi.fn(async () => {}),
    readCache: async () => [],
    writeCache: async () => {},
    fetchImpl: vi.fn(async () => ({ ok: true, json: async () => RANKED_BODY }) as unknown as Response),
    ...over,
  };
}

describe("normalizeDomainTarget", () => {
  it("strips scheme/www/path and lowercases", () => {
    expect(normalizeDomainTarget("https://www.SuppleHomes.com/about")).toBe("supplehomes.com");
    expect(normalizeDomainTarget("surfiran.com/tours")).toBe("surfiran.com");
    expect(normalizeDomainTarget("  ")).toBe("");
  });
});

describe("parsers - lean KeywordGapRow, honest on malformed input", () => {
  it("parseRankedKeywords maps keyword/volume/cpc/rank, ownRank stays null", () => {
    const rows = parseRankedKeywords(RANKED_BODY, "supplehomes.com");
    expect(rows).toHaveLength(2); // the rank-less item is dropped
    expect(rows[0]).toEqual({
      keyword: "persian wedding sofreh",
      volume: 1900,
      competitorDomain: "supplehomes.com",
      competitorRank: 3,
      ownRank: null,
      cpcUsd: 0.42,
      source: "ranked_keywords",
      rankingUrl: "https://supplehomes.com/sofreh-guide",
    });
    expect(rows[1].competitorRank).toBe(11); // flattened serp element shape
    expect(rows[1].rankingUrl).toBeNull(); // no url on the flattened fixture item
  });

  it("parseDomainIntersection maps both domains' ranks (tenant absent -> ownRank null)", () => {
    const rows = parseDomainIntersection(INTERSECTION_BODY, "surfiran.com");
    expect(rows).toHaveLength(2);
    expect(rows[0].ownRank).toBeNull();
    expect(rows[0].competitorRank).toBe(5);
    expect(rows[1].ownRank).toBe(34);
    expect(rows[1].source).toBe("domain_intersection");
  });

  it("returns [] on malformed bodies (never throws)", () => {
    expect(parseRankedKeywords({ garbage: true }, "x.com")).toEqual([]);
    expect(parseDomainIntersection(null, "x.com")).toEqual([]);
  });
});

describe("runLabsQuery - the money gauntlet", () => {
  const opts = { cacheKey: "test|2840|en|supplehomes.com", parse: (b: unknown) => parseRankedKeywords(b, "supplehomes.com") };

  it("is DISABLED when DataForSEO is not configured (no fetch)", async () => {
    const fetchImpl = vi.fn();
    const r = await runLabsQuery("ranked_keywords/live", {}, opts, deps({ env: {} as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("DRY-RUN is the DEFAULT (env without the flag) - no call, no spend, priced plan returned", async () => {
    const fetchImpl = vi.fn();
    const { DATAFORSEO_DRY_RUN: _drop, ...rest } = CONFIGURED_ENV as Record<string, string>;
    const r = await runLabsQuery("ranked_keywords/live", {}, opts, deps({ env: rest as unknown as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("dry_run");
    expect(r.costUsd).toBe(0);
    expect(r.plan.estCostUsd).toBe(LABS_COST_USD);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("CAP blocks the call (fail-closed) when over budget", async () => {
    const fetchImpl = vi.fn();
    const r = await runLabsQuery("ranked_keywords/live", {}, opts, deps({ spentThisMonthUsd: async () => 49.95, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails CLOSED when monthly spend is unknown", async () => {
    const fetchImpl = vi.fn();
    const r = await runLabsQuery("ranked_keywords/live", {}, opts, deps({ spentThisMonthUsd: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves the 30-DAY cache without spending (a 20-day-old row is still fresh)", async () => {
    const fetchImpl = vi.fn();
    const recordSpend = vi.fn(async () => {});
    const cachedRows = parseRankedKeywords(RANKED_BODY, "supplehomes.com");
    const r = await runLabsQuery("ranked_keywords/live", {}, opts, deps({
      readCache: async () => [{ key: opts.cacheKey, rows: cachedRows, fetchedAt: "2026-06-12T00:00:00Z" }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      recordSpend,
    }));
    expect(r.status).toBe("cache_hit");
    expect(r.rows).toHaveLength(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });


  it("OK path: fetches, parses, records spend ONCE, writes the cache", async () => {
    const recordSpend = vi.fn(async () => {});
    const writeCache = vi.fn(async () => {});
    const r = await runLabsQuery("ranked_keywords/live", { target: "supplehomes.com" }, opts, deps({ recordSpend, writeCache }));
    expect(r.status).toBe("ok");
    expect(r.rows).toHaveLength(2);
    expect(r.costUsd).toBe(LABS_COST_USD);
    expect(recordSpend).toHaveBeenCalledTimes(1);
    expect(recordSpend).toHaveBeenCalledWith("tenant-iranopedia", LABS_COST_USD);
    expect(writeCache).toHaveBeenCalledTimes(1);
  });

  it("http error -> status error, $0 recorded", async () => {
    const recordSpend = vi.fn(async () => {});
    const r = await runLabsQuery("ranked_keywords/live", {}, opts, deps({
      fetchImpl: vi.fn(async () => ({ ok: false, status: 402 }) as unknown as Response) as unknown as typeof fetch,
      recordSpend,
    }));
    expect(r.status).toBe("error");
    expect(r.costUsd).toBe(0);
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("never emits em/en dashes in details", async () => {
    for (const d of [
      deps({ env: {} as NodeJS.ProcessEnv }),
      deps({ env: { ...CONFIGURED_ENV, DATAFORSEO_DRY_RUN: "true" } }),
      deps({ spentThisMonthUsd: async () => null }),
      deps(),
    ]) {
      const r = await runLabsQuery("ranked_keywords/live", {}, opts, d);
      expect(/[–—]/.test(r.detail)).toBe(false);
    }
  });
});

describe("endpoint runners", () => {
  it("runRankedKeywords posts the bounded payload (limit 300, rank<=20 filter)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => RANKED_BODY }) as unknown as Response);
    const r = await runRankedKeywords("https://www.SuppleHomes.com/x", {}, deps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/dataforseo_labs/google/ranked_keywords/live");
    const payload = JSON.parse(String(init.body))[0];
    expect(payload.target).toBe("supplehomes.com");
    expect(payload.limit).toBe(300);
    expect(payload.filters).toEqual([["ranked_serp_element.serp_item.rank_group", "<=", 20]]);
  });





  it("rejects empty domains without calling anything", async () => {
    const fetchImpl = vi.fn();
    expect((await runRankedKeywords("", {}, deps({ fetchImpl: fetchImpl as unknown as typeof fetch }))).status).toBe("error");
    expect((await runDomainIntersection("a.com", "", {}, deps({ fetchImpl: fetchImpl as unknown as typeof fetch }))).status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ── Item 18: winnability reads (difficulty, domain ranks, backlinks) ──────────

const DIFFICULTY_BODY = {
  tasks: [{ result: [{ items: [
    { keyword: "persian wedding sofreh", keyword_difficulty: 34 },
    { keyword: "no score keyword", keyword_difficulty: null },
    { keyword: "", keyword_difficulty: 50 }, // no keyword -> dropped
  ] }] }],
};

const RANKS_BODY = {
  tasks: [{ result: [{ items: [
    { target: "theknot.com", rank: 42 },
    { target: "www.Brides.com", rank: 38 },
    { target: "", rank: 10 }, // no target -> dropped
  ] }] }],
};

const BACKLINKS_BODY = {
  tasks: [{ result: [{ items: [
    { target: "https://theknot.com/x", referring_domains: 210, backlinks: 900 },
    { target: "https://iranopedia.com/home", referring_domains: 3, backlinks: 10 },
    { target: "", referring_domains: 5, backlinks: 5 }, // no target -> dropped
  ] }] }],
};

describe("parsers - winnability rows (item 18), honest on malformed input", () => {
  it("parseBulkKeywordDifficulty maps keyword -> difficulty, drops keyword-less rows", () => {
    const rows = parseBulkKeywordDifficulty(DIFFICULTY_BODY);
    expect(rows).toEqual([
      { keyword: "persian wedding sofreh", difficulty: 34 },
      { keyword: "no score keyword", difficulty: null },
    ]);
  });

  it("parseBulkDomainRanks maps target -> rank, normalizes the domain, drops target-less rows", () => {
    const rows = parseBulkDomainRanks(RANKS_BODY);
    expect(rows).toEqual([
      { domain: "theknot.com", rank: 42 },
      { domain: "brides.com", rank: 38 },
    ]);
  });

  it("parseBacklinksSummary maps target url -> referring domains + backlinks, drops target-less rows", () => {
    const rows = parseBacklinksSummary(BACKLINKS_BODY);
    expect(rows).toEqual([
      { url: "https://theknot.com/x", referringDomains: 210, backlinks: 900 },
      { url: "https://iranopedia.com/home", referringDomains: 3, backlinks: 10 },
    ]);
  });

  it("every winnability parser returns [] on malformed bodies (never throws)", () => {
    expect(parseBulkKeywordDifficulty({ garbage: true })).toEqual([]);
    expect(parseBulkDomainRanks(null)).toEqual([]);
    expect(parseBacklinksSummary(undefined)).toEqual([]);
  });
});

function labsDeps(over: Partial<LabsRunDeps> = {}, body: unknown = DIFFICULTY_BODY): Partial<LabsRunDeps> {
  return {
    ...deps(over),
    fetchImpl: vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response),
    ...over,
  };
}

describe("runBulkKeywordDifficulty - the SAME money gauntlet, ONE call for every keyword", () => {
  it("posts every keyword in ONE batched call (deduped, lowercased)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => DIFFICULTY_BODY }) as unknown as Response);
    const r = await runBulkKeywordDifficulty(
      ["Persian Wedding Sofreh", "persian wedding sofreh", "No Score Keyword"],
      {},
      labsDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(r.status).toBe("ok");
    expect(r.costUsd).toBe(LABS_BULK_DIFFICULTY_COST_USD);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/dataforseo_labs/google/bulk_keyword_difficulty/live");
    const payload = JSON.parse(String(init.body))[0];
    expect(payload.keywords).toEqual(["persian wedding sofreh", "no score keyword"]);
  });

  it("DRY-RUN default still applies (no call, priced plan only)", async () => {
    const fetchImpl = vi.fn();
    const { DATAFORSEO_DRY_RUN: _drop, ...rest } = CONFIGURED_ENV as Record<string, string>;
    const r = await runBulkKeywordDifficulty(["x"], {}, labsDeps({ env: rest as unknown as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("dry_run");
    expect(r.plan.estCostUsd).toBe(LABS_BULK_DIFFICULTY_COST_USD);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the shared cap fails CLOSED (no call)", async () => {
    const fetchImpl = vi.fn();
    const r = await runBulkKeywordDifficulty(["x"], {}, labsDeps({ spentThisMonthUsd: async () => 49.99, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

});


describe("runBacklinksSummary - Backlinks API path, bounded to top URLs", () => {


  it("respects the shared monthly cap fail-closed, same as every other Labs/Backlinks call", async () => {
    const fetchImpl = vi.fn();
    const r = await runBacklinksSummary(["https://x.com/a"], labsDeps({ spentThisMonthUsd: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("readAllCachedKeywordDifficulty - $0 read for the daily-evidence-brief upgrade", () => {
  it("flattens fresh bulk_keyword_difficulty cache rows into a keyword -> difficulty map", async () => {
    const cached = [
      { key: "bulk_keyword_difficulty|2840|en|persian wedding sofreh", rows: parseBulkKeywordDifficulty(DIFFICULTY_BODY), fetchedAt: "2026-06-20T00:00:00Z" },
      { key: "ranked_keywords|2840|en|supplehomes.com", rows: [{ keyword: "unrelated", volume: 1 }], fetchedAt: "2026-06-20T00:00:00Z" },
    ];
    const map = await readAllCachedKeywordDifficulty({ now: () => new Date("2026-07-02T00:00:00Z"), readCache: async () => cached });
    expect(map.get("persian wedding sofreh")).toBe(34);
    expect(map.has("unrelated")).toBe(false); // non-difficulty cache rows are ignored
  });


  it("is fail-soft on a cache read error (empty map, never throws)", async () => {
    const map = await readAllCachedKeywordDifficulty({ readCache: async () => { throw new Error("boom"); } });
    expect(map.size).toBe(0);
  });
});


describe("readAllCachedBacklinks - $0 read for the RANK-7 link-gap engine", () => {
  it("flattens fresh bulk_referring_domains cache rows into a url -> referring-domains map", async () => {
    const cached = [
      { key: "bulk_referring_domains|https://iranopedia.com/home,https://theknot.com/x", rows: parseBacklinksSummary(BACKLINKS_BODY), fetchedAt: "2026-06-20T00:00:00Z" },
      { key: "bulk_keyword_difficulty|2840|en|unrelated", rows: parseBulkKeywordDifficulty(DIFFICULTY_BODY), fetchedAt: "2026-06-20T00:00:00Z" },
    ];
    const map = await readAllCachedBacklinks({ now: () => new Date("2026-07-02T00:00:00Z"), readCache: async () => cached });
    expect(map.get("https://theknot.com/x")).toBe(210);
    expect(map.get("https://iranopedia.com/home")).toBe(3);
    // non-backlinks cache rows are ignored
    expect(map.has("persian wedding sofreh")).toBe(false);
  });


  it("is fail-soft on a cache read error (empty map, never throws)", async () => {
    const map = await readAllCachedBacklinks({ readCache: async () => { throw new Error("boom"); } });
    expect(map.size).toBe(0);
  });
});

const HISTORICAL_VOLUME_BODY = {
  tasks: [
    {
      result: [
        {
          items: [
            {
              keyword: "nowruz table setting",
              keyword_info: {
                monthly_searches: [
                  { year: 2025, month: 3, search_volume: 4000 },
                  { year: 2025, month: 1, search_volume: 50 },
                  { year: 2026, month: 3, search_volume: 4300 },
                  { year: 2026, month: 1, search_volume: 60 },
                ],
              },
            },
            { keyword: "no history keyword", keyword_info: {} }, // no monthly_searches -> []
            { keyword_info: { monthly_searches: [] } }, // no keyword -> dropped entirely
          ],
        },
      ],
    },
  ],
};

describe("parseHistoricalVolume - honest on malformed input", () => {

  it("returns [] on malformed bodies (never throws)", () => {
    expect(parseHistoricalVolume(null)).toEqual([]);
    expect(parseHistoricalVolume({ garbage: true })).toEqual([]);
    expect(parseHistoricalVolume(undefined)).toEqual([]);
  });
});

describe("runHistoricalVolume - the SAME money gauntlet, bounded to the top cluster heads", () => {
  it("posts every keyword in ONE batched call (deduped, lowercased, capped at the limit)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => HISTORICAL_VOLUME_BODY }) as unknown as Response);
    const many = Array.from({ length: HISTORICAL_VOLUME_KEYWORDS_LIMIT + 5 }, (_, i) => `keyword ${i}`);
    const r = await runHistoricalVolume(many, {}, labsDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("ok");
    expect(r.costUsd).toBe(HISTORICAL_VOLUME_COST_USD);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/dataforseo_labs/google/historical_search_volume/live");
    const payload = JSON.parse(String(init.body))[0];
    expect(payload.keywords.length).toBe(HISTORICAL_VOLUME_KEYWORDS_LIMIT);
  });

  it("DRY-RUN default still applies (no call, priced plan only)", async () => {
    const fetchImpl = vi.fn();
    const { DATAFORSEO_DRY_RUN: _drop, ...rest } = CONFIGURED_ENV as Record<string, string>;
    const r = await runHistoricalVolume(["nowruz table setting"], {}, labsDeps({ env: rest as unknown as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("dry_run");
    expect(r.plan.estCostUsd).toBe(HISTORICAL_VOLUME_COST_USD);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the shared cap fails CLOSED (no call)", async () => {
    const fetchImpl = vi.fn();
    const r = await runHistoricalVolume(["x"], {}, labsDeps({ spentThisMonthUsd: async () => 49.99, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });


});

import {
  runKeywordVolume,
  readAllCachedKeywordDemand,
  parseKeywordVolume,
  planKeywordsCall,
  type KeywordsRunDeps,
  type KeywordDemand,
} from "@/domains/serp/dataforseo-keywords";

const KW_CONFIGURED_ENV = {
  BEACON_SERP_PROVIDER: "dataforseo",
  DATAFORSEO_AUTH_B64: "dGVzdDp0ZXN0",
  DATAFORSEO_DRY_RUN: "false",
  DATAFORSEO_MONTHLY_CAP_USD: "50",
} as unknown as NodeJS.ProcessEnv;

const BODY = {
  tasks: [
    {
      result: [
        {
          keyword: "iran flag",
          search_volume: 22000,
          cpc: 0.31,
          competition_index: 18,
          monthly_searches: [
            { year: 2026, month: 4, search_volume: 20000 },
            { year: 2026, month: 5, search_volume: 24000 },
          ],
        },
        { keyword: "extremely obscure phrase", search_volume: null },
      ],
    },
  ],
};

function kwDeps(over: Partial<KeywordsRunDeps> = {}): Partial<KeywordsRunDeps> {
  return {
    env: KW_CONFIGURED_ENV,
    now: () => new Date("2026-06-25T00:00:00Z"),
    tenantId: async () => "tenant-iranopedia",
    spentThisMonthUsd: async () => 0,
    recordSpend: vi.fn(async () => {}),
    readCache: async () => [],
    writeCache: async () => {},
    fetchImpl: vi.fn(async () => ({ ok: true, json: async () => BODY }) as unknown as Response),
    ...over,
  };
}

describe("planKeywordsCall", () => {
  it("dedupes, lowercases, drops too-short, and caps the batch", () => {
    const plan = planKeywordsCall(["Iran Flag", "iran flag", " ", "a", "Nowruz Gifts"]);
    expect(plan.keywords).toEqual(["iran flag", "nowruz gifts"]);
    expect(plan.estCostUsd).toBeGreaterThan(0);
  });
});

describe("parseKeywordVolume — honest normalization", () => {
  it("maps volume/cpc/competition/trend and marks no-data as low confidence (no fabrication)", () => {
    const plan = planKeywordsCall(["iran flag", "extremely obscure phrase"]);
    const rows = parseKeywordVolume(BODY, plan, "2026-06-25T00:00:00Z");
    const flag = rows.find((r) => r.keyword === "iran flag")!;
    expect(flag.searchVolume).toBe(22000);
    expect(flag.cpcUsd).toBeCloseTo(0.31);
    expect(flag.competition).toBeCloseTo(0.18);
    expect(flag.competitionLevel).toBe("low");
    expect(flag.monthlySearches.length).toBe(2);
    expect(flag.confidence).toBe("medium"); // has volume but < 6 months trend
    const obscure = rows.find((r) => r.keyword === "extremely obscure phrase")!;
    expect(obscure.searchVolume).toBeNull();
    expect(obscure.confidence).toBe("low"); // NEVER a guessed number
  });
  it("returns [] on a malformed body (never throws)", () => {
    expect(parseKeywordVolume({ garbage: true }, planKeywordsCall(["x y"]), "t")).toEqual([]);
  });
});

describe("runKeywordVolume — the money gauntlet", () => {
  it("is DISABLED when DataForSEO is not configured (no fetch)", async () => {
    const fetchImpl = vi.fn();
    const r = await runKeywordVolume(["iran flag"], {}, kwDeps({ env: {} as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("DRY-RUN by default — spends nothing, makes no call", async () => {
    const fetchImpl = vi.fn();
    const r = await runKeywordVolume(["iran flag"], {}, kwDeps({ env: { ...KW_CONFIGURED_ENV, DATAFORSEO_DRY_RUN: "true" }, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("dry_run");
    expect(r.costUsd).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("CAP blocks the call (fail-closed) when over budget", async () => {
    const fetchImpl = vi.fn();
    const r = await runKeywordVolume(["iran flag"], {}, kwDeps({ spentThisMonthUsd: async () => 49.99, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails CLOSED when monthly spend is unknown", async () => {
    const fetchImpl = vi.fn();
    const r = await runKeywordVolume(["iran flag"], {}, kwDeps({ spentThisMonthUsd: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves the CACHE without spending", async () => {
    const fetchImpl = vi.fn();
    const recordSpend = vi.fn(async () => {});
    const cached = parseKeywordVolume(BODY, planKeywordsCall(["iran flag"]), "2026-06-25T00:00:00Z");
    const r = await runKeywordVolume(["iran flag"], {}, kwDeps({
      readCache: async () => [{ key: `2840|en|iran flag`, keywords: cached, fetchedAt: "2026-06-25T00:00:00Z" }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      recordSpend,
    }));
    expect(r.status).toBe("cache_hit");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("OK path: fetches, normalizes, records spend, caches", async () => {
    const recordSpend = vi.fn(async () => {});
    const writeCache = vi.fn(async () => {});
    const r = await runKeywordVolume(["iran flag", "extremely obscure phrase"], {}, kwDeps({ recordSpend, writeCache }));
    expect(r.status).toBe("ok");
    expect(r.keywords.length).toBe(2);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(recordSpend).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledTimes(1);
  });
});

describe("readAllCachedKeywordDemand (cache-only, $0)", () => {
  const NOW = () => new Date("2026-06-25T00:00:00Z");
  const kd = (keyword: string, vol: number | null, fetchedAt: string): KeywordDemand => ({
    keyword,
    searchVolume: vol,
    cpcUsd: 0,
    competition: 0,
    competitionLevel: "low",
    monthlySearches: [],
    locationCode: 2840,
    languageCode: "en",
    source: "dataforseo",
    fetchedAt,
    confidence: vol == null ? "low" : "high",
    evidenceRef: `kw:${keyword}`,
  });

  it("flattens fresh cache rows", async () => {
    const out = await readAllCachedKeywordDemand({
      now: NOW,
      readCache: async () => [
        { key: "a", fetchedAt: "2026-06-24T00:00:00Z", keywords: [kd("iran flag", 135000, "2026-06-24T00:00:00Z")] },
        { key: "b", fetchedAt: "2026-06-24T00:00:00Z", keywords: [kd("persian food", 8100, "2026-06-24T00:00:00Z")] },
      ],
    });
    expect(out.map((k) => k.keyword).sort()).toEqual(["iran flag", "persian food"]);
  });



  it("fail-soft: a throwing cache read → []", async () => {
    const out = await readAllCachedKeywordDemand({
      now: NOW,
      readCache: async () => {
        throw new Error("store down");
      },
    });
    expect(out).toEqual([]);
  });
});
