import { describe, it, expect, vi } from "vitest";
import {
  runKeywordVolume,
  readAllCachedKeywordDemand,
  parseKeywordVolume,
  planKeywordsCall,
  type KeywordsRunDeps,
  type KeywordDemand,
} from "./dataforseo-keywords";

const CONFIGURED_ENV = {
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

function deps(over: Partial<KeywordsRunDeps> = {}): Partial<KeywordsRunDeps> {
  return {
    env: CONFIGURED_ENV,
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
    const r = await runKeywordVolume(["iran flag"], {}, deps({ env: {} as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("DRY-RUN by default — spends nothing, makes no call", async () => {
    const fetchImpl = vi.fn();
    const r = await runKeywordVolume(["iran flag"], {}, deps({ env: { ...CONFIGURED_ENV, DATAFORSEO_DRY_RUN: "true" }, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("dry_run");
    expect(r.costUsd).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("CAP blocks the call (fail-closed) when over budget", async () => {
    const fetchImpl = vi.fn();
    const r = await runKeywordVolume(["iran flag"], {}, deps({ spentThisMonthUsd: async () => 49.99, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails CLOSED when monthly spend is unknown", async () => {
    const fetchImpl = vi.fn();
    const r = await runKeywordVolume(["iran flag"], {}, deps({ spentThisMonthUsd: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves the CACHE without spending", async () => {
    const fetchImpl = vi.fn();
    const recordSpend = vi.fn(async () => {});
    const cached = parseKeywordVolume(BODY, planKeywordsCall(["iran flag"]), "2026-06-25T00:00:00Z");
    const r = await runKeywordVolume(["iran flag"], {}, deps({
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
    const r = await runKeywordVolume(["iran flag", "extremely obscure phrase"], {}, deps({ recordSpend, writeCache }));
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

  it("drops stale (>14d) rows", async () => {
    const out = await readAllCachedKeywordDemand({
      now: NOW,
      readCache: async () => [
        { key: "old", fetchedAt: "2026-05-01T00:00:00Z", keywords: [kd("stale kw", 999, "2026-05-01T00:00:00Z")] },
        { key: "new", fetchedAt: "2026-06-24T00:00:00Z", keywords: [kd("fresh kw", 1000, "2026-06-24T00:00:00Z")] },
      ],
    });
    expect(out.map((k) => k.keyword)).toEqual(["fresh kw"]);
  });

  it("dedups by keyword, newest fetch wins", async () => {
    const out = await readAllCachedKeywordDemand({
      now: NOW,
      readCache: async () => [
        { key: "a", fetchedAt: "2026-06-20T00:00:00Z", keywords: [kd("iran flag", 100, "2026-06-20T00:00:00Z")] },
        { key: "b", fetchedAt: "2026-06-24T00:00:00Z", keywords: [kd("iran flag", 135000, "2026-06-24T00:00:00Z")] },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].searchVolume).toBe(135000); // newest wins
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
