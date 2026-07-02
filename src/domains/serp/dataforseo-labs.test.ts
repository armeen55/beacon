import { describe, it, expect, vi } from "vitest";
import {
  runLabsQuery,
  runRankedKeywords,
  runDomainIntersection,
  parseRankedKeywords,
  parseDomainIntersection,
  normalizeDomainTarget,
  LABS_COST_USD,
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
              ranked_serp_element: { serp_item: { rank_group: 3, rank_absolute: 4 } },
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
    });
    expect(rows[1].competitorRank).toBe(11); // flattened serp element shape
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
