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
} from "./dataforseo-labs";

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

  it("ignores a stale (>30d) cache row", async () => {
    const r = await runLabsQuery("ranked_keywords/live", {}, opts, deps({
      readCache: async () => [{ key: opts.cacheKey, rows: [], fetchedAt: "2026-05-30T00:00:00Z" }],
    }));
    expect(r.status).toBe("ok"); // fell through to the (mocked) paid call
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

  it("runRankedKeywordsForPage keeps the exact URL and requests 500 cached keywords", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => RANKED_BODY }) as unknown as Response);
    const r = await runRankedKeywordsForPage(
      "https://www.SuppleHomes.com/sofreh-guide?ref=test#top",
      {},
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(r.status).toBe("ok");
    expect(r.costUsd).toBe(PAGE_KEYWORDS_COST_USD);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(init.body))[0];
    expect(payload.target).toBe("https://www.supplehomes.com/sofreh-guide");
    expect(payload.limit).toBe(PAGE_KEYWORD_ROW_LIMIT);
    expect(payload.item_types).toEqual(["organic"]);
    expect(payload.ignore_synonyms).toBe(false);
    expect(payload.filters).toEqual([["ranked_serp_element.serp_item.rank_group", "<=", 100]]);
    expect(r.plan.cacheKey).toContain("ranked_keywords_page");
  });

  it("runRelatedKeywords extracts the provider maximum without paid clickstream bloat", async () => {
    const body = {
      tasks: [{ result: [{ items: [{
        keyword_data: {
          keyword: "nowruz activities for kids",
          keyword_info: { search_volume: 1900, cpc: 0.25, monthly_searches: [{ year: 2026, month: 3, search_volume: 2400 }] },
          keyword_properties: { keyword_difficulty: 28 },
        },
      }] }] }],
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response);
    const r = await runRelatedKeywords("Nowruz Activities", {}, deps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("ok");
    expect(r.costUsd).toBe(RELATED_KEYWORDS_COST_USD);
    expect(r.rows[0]).toMatchObject({ keyword: "nowruz activities for kids", volume: 1900, difficulty: 28 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(init.body))[0];
    expect(payload.depth).toBe(4);
    expect(payload.limit).toBe(RELATED_KEYWORD_ROW_LIMIT);
    expect(payload.include_seed_keyword).toBe(true);
    expect(payload.include_clickstream_data).toBe(false);
    expect(payload.include_serp_info).toBe(false);
  });

  it("promotes fresh broad-topic cache rows for the unified keyword library", async () => {
    const rows = [{ keyword: "nowruz activities", volume: 900, cpcUsd: null, difficulty: 25, monthlySearches: [] }];
    const result = await readAllCachedRelatedKeywords({
      now: () => new Date("2026-07-14T00:00:00.000Z"),
      readCache: async () => [{ key: "related_keywords|2840|en|depth4|nowruz", rows, fetchedAt: "2026-07-13T00:00:00.000Z" }],
    });
    expect(result).toEqual([{ ...rows[0], fetchedAt: "2026-07-13T00:00:00.000Z" }]);
  });

  it("runDomainIntersection posts intersections:false (their wins, your absences)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => INTERSECTION_BODY }) as unknown as Response);
    const r = await runDomainIntersection("surfiran.com", "iranopedia.com", {}, deps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/dataforseo_labs/google/domain_intersection/live");
    const payload = JSON.parse(String(init.body))[0];
    expect(payload.target1).toBe("surfiran.com");
    expect(payload.target2).toBe("iranopedia.com");
    expect(payload.intersections).toBe(false);
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

  it("rejects an empty keyword list without calling anything", async () => {
    const fetchImpl = vi.fn();
    const r = await runBulkKeywordDifficulty([], {}, labsDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("runBulkDomainRanks - Backlinks API path, SAME gauntlet, ONE call for every domain", () => {
  it("posts every domain in ONE batched call against the Backlinks base URL", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => RANKS_BODY }) as unknown as Response);
    const r = await runBulkDomainRanks(["https://www.TheKnot.com/x", "brides.com"], labsDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("ok");
    expect(r.costUsd).toBe(BACKLINKS_BULK_RANKS_COST_USD);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v3/backlinks/bulk_ranks/live");
    const payload = JSON.parse(String(init.body))[0];
    expect(payload.targets).toEqual(["theknot.com", "brides.com"]);
  });

  it("rejects an empty domain list without calling anything", async () => {
    const fetchImpl = vi.fn();
    const r = await runBulkDomainRanks([], labsDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("runBacklinksSummary - Backlinks API path, bounded to top URLs", () => {
  it("posts the bounded URL list against the Backlinks base URL", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => BACKLINKS_BODY }) as unknown as Response);
    const r = await runBacklinksSummary(["https://theknot.com/x", "https://iranopedia.com/home"], labsDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("ok");
    expect(r.costUsd).toBe(BACKLINKS_REFERRING_DOMAINS_COST_USD);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v3/backlinks/bulk_referring_domains/live");
    const payload = JSON.parse(String(init.body))[0];
    expect(payload.targets).toEqual(["https://theknot.com/x", "https://iranopedia.com/home"]);
  });

  it("rejects an empty url list without calling anything", async () => {
    const fetchImpl = vi.fn();
    const r = await runBacklinksSummary([], labsDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

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

  it("drops a stale (>30d) difficulty cache row", async () => {
    const cached = [
      { key: "bulk_keyword_difficulty|2840|en|persian wedding sofreh", rows: parseBulkKeywordDifficulty(DIFFICULTY_BODY), fetchedAt: "2026-05-01T00:00:00Z" },
    ];
    const map = await readAllCachedKeywordDifficulty({ now: () => new Date("2026-07-02T00:00:00Z"), readCache: async () => cached });
    expect(map.size).toBe(0);
  });

  it("is fail-soft on a cache read error (empty map, never throws)", async () => {
    const map = await readAllCachedKeywordDifficulty({ readCache: async () => { throw new Error("boom"); } });
    expect(map.size).toBe(0);
  });
});

describe("readCachedKeywordResearchCorpus - one cache read for customer surfaces", () => {
  it("projects related keywords and difficulty without duplicate repository I/O", async () => {
    const readCache = vi.fn(async () => [
      {
        key: "related_keywords|2840|en|depth4|persian names",
        rows: [{ keyword: "rare persian names", volume: 700, cpcUsd: 0.2, difficulty: 18, monthlySearches: [] }],
        fetchedAt: "2026-07-01T00:00:00Z",
      },
      {
        key: "bulk_keyword_difficulty|2840|en|rare persian names",
        rows: [{ keyword: "rare persian names", difficulty: 18 }],
        fetchedAt: "2026-07-01T00:00:00Z",
      },
    ]);
    const corpus = await readCachedKeywordResearchCorpus({
      now: () => new Date("2026-07-17T00:00:00Z"),
      readCache,
    });
    expect(readCache).toHaveBeenCalledTimes(1);
    expect(corpus.relatedKeywords[0]?.keyword).toBe("rare persian names");
    expect(corpus.difficultyByKeyword.get("rare persian names")).toBe(18);
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

  it("drops a stale (>30d) backlinks cache row", async () => {
    const cached = [
      { key: "bulk_referring_domains|https://theknot.com/x", rows: parseBacklinksSummary(BACKLINKS_BODY), fetchedAt: "2026-05-01T00:00:00Z" },
    ];
    const map = await readAllCachedBacklinks({ now: () => new Date("2026-07-02T00:00:00Z"), readCache: async () => cached });
    expect(map.size).toBe(0);
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
  it("maps keyword -> ascending (year, month) monthly curve, drops keyword-less rows", () => {
    const rows = parseHistoricalVolume(HISTORICAL_VOLUME_BODY);
    expect(rows).toEqual([
      {
        keyword: "nowruz table setting",
        monthly: [
          { year: 2025, month: 1, searchVolume: 50 },
          { year: 2025, month: 3, searchVolume: 4000 },
          { year: 2026, month: 1, searchVolume: 60 },
          { year: 2026, month: 3, searchVolume: 4300 },
        ],
      },
      { keyword: "no history keyword", monthly: [] },
    ]);
  });

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

  it("serves a cache hit within 30 days without spending", async () => {
    const fetchImpl = vi.fn();
    const cacheKey = "historical_search_volume|2840|en|nowruz table setting";
    const r = await runHistoricalVolume(
      ["nowruz table setting"],
      {},
      labsDeps({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readCache: async () => [{ key: cacheKey, rows: parseHistoricalVolume(HISTORICAL_VOLUME_BODY), fetchedAt: "2026-06-20T00:00:00Z" }],
      }),
    );
    expect(r.status).toBe("cache_hit");
    expect(r.costUsd).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an empty keyword list without calling anything", async () => {
    const fetchImpl = vi.fn();
    const r = await runHistoricalVolume([], {}, labsDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
