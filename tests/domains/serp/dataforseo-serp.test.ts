import { describe, it, expect } from "vitest";

import {
  runSerpQuery,
  planSerpCall,
  parseDataForSeoSerp,
  isDataForSeoConfigured,
  isDryRun,
  monthlyCapUsd,
  organicItemsOf,
  resolveOwnRank,
  buildSerpHistoryRow,
  type SerpRunDeps,
  type SerpHistoryRow,
} from "@/domains/serp/dataforseo-serp";

const CONFIGURED = {
  DATAFORSEO_LOGIN: "u",
  DATAFORSEO_PASSWORD: "p",
  BEACON_SERP_PROVIDER: "dataforseo",
} as unknown as NodeJS.ProcessEnv;

function baseDeps(over: Partial<SerpRunDeps> = {}): {
  d: Partial<SerpRunDeps>;
  fetchCalls: number;
  spends: number[];
  historyRows: SerpHistoryRow[];
} {
  let fetchCalls = 0;
  const spends: number[] = [];
  const historyRows: SerpHistoryRow[] = [];
  const d: Partial<SerpRunDeps> = {
    env: { ...CONFIGURED, DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv,
    now: () => new Date("2026-06-25T00:00:00Z"),
    tenantId: async () => "tenant-iranopedia",
    spentThisMonthUsd: async () => 0,
    recordSpend: async (_t, c) => {
      spends.push(c);
    },
    readCache: async () => [],
    writeCache: async () => {},
    fetchImpl: (async () => {
      fetchCalls += 1;
      return {
        ok: true,
        json: async () => ({ tasks: [{ result: [{ items: [
          { type: "organic", rank_group: 1, url: "https://theknot.com/persian-wedding", title: "Persian Wedding" },
          { type: "people_also_ask" },
        ] }] }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch,
    tenantDomain: async () => "iranopedia.com",
    appendHistory: async (row) => {
      historyRows.push(row);
    },
    ...over,
  };
  return { d, get fetchCalls() { return fetchCalls; }, spends, historyRows };
}

describe("DataForSEO SERP — config + helpers", () => {
  it("isDataForSeoConfigured needs provider + both creds", () => {
    expect(isDataForSeoConfigured(CONFIGURED)).toBe(true);
    expect(isDataForSeoConfigured({ BEACON_SERP_PROVIDER: "dataforseo" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isDataForSeoConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it("DRY-RUN is the default — only DATAFORSEO_DRY_RUN=false disables it", () => {
    expect(isDryRun({} as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isDryRun({ DATAFORSEO_DRY_RUN: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isDryRun({ DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it("monthlyCapUsd defaults to 50 and reads the env override", () => {
    expect(monthlyCapUsd({} as unknown as NodeJS.ProcessEnv)).toBe(50);
    expect(monthlyCapUsd({ DATAFORSEO_MONTHLY_CAP_USD: "150" } as unknown as NodeJS.ProcessEnv)).toBe(150);
  });
  it("planSerpCall returns endpoint + estimated cost without calling anything", () => {
    const plan = planSerpCall("iran flag");
    expect(plan.endpoint).toContain("dataforseo.com");
    expect(plan.estCostUsd).toBeGreaterThan(0);
    expect(plan.query).toBe("iran flag");
  });
  it("parseDataForSeoSerp maps organic items + SERP features", () => {
    const snap = parseDataForSeoSerp("q", { tasks: [{ result: [{ items: [
      { type: "organic", url: "https://a.com/x", title: "X" },
      { type: "featured_snippet" },
    ] }] }] }, "2026-06-25T00:00:00Z");
    expect(snap.results).toHaveLength(1);
    expect(snap.results[0].domain).toBe("a.com");
    expect(snap.features).toContain("featured_snippet");
  });

  it("parseDataForSeoSerp ADDITIONALLY returns ranked organicItems (item 17, additive)", () => {
    const snap = parseDataForSeoSerp("q", { tasks: [{ result: [{ items: [
      { type: "organic", url: "https://a.com/x", title: "X" },
      { type: "people_also_ask" },
      { type: "organic", url: "https://b.com/y", title: "Y" },
    ] }] }] }, "2026-06-25T00:00:00Z");
    expect(snap.organicItems).toEqual([
      { rank: 1, domain: "a.com", url: "https://a.com/x" },
      { rank: 2, domain: "b.com", url: "https://b.com/y" },
    ]);
    // organicItemsOf reproduces the same triples from any SerpSnapshot.
    expect(organicItemsOf(snap)).toEqual(snap.organicItems);
  });
});

describe("resolveOwnRank — the tenant's literal Google position", () => {
  const items = [
    { rank: 1, domain: "theknot.com", url: "https://theknot.com/persian-wedding" },
    { rank: 2, domain: "iranopedia.com", url: "https://www.iranopedia.com/persian-wedding" },
    { rank: 3, domain: "brides.com", url: "https://brides.com/x" },
  ];

  it("finds the own rank for a bare tenant domain", () => {
    expect(resolveOwnRank(items, "iranopedia.com")).toEqual({
      ownRank: 2,
      ownUrl: "https://www.iranopedia.com/persian-wedding",
    });
  });

  it("handles scheme + www forms of the tenant domain (the schemeless trap)", () => {
    expect(resolveOwnRank(items, "https://www.iranopedia.com").ownRank).toBe(2);
    expect(resolveOwnRank(items, "www.iranopedia.com").ownRank).toBe(2);
    expect(resolveOwnRank(items, "IRANOPEDIA.COM").ownRank).toBe(2);
  });

  it("matches subdomains of the tenant domain", () => {
    const withSub = [{ rank: 4, domain: "blog.iranopedia.com", url: "https://blog.iranopedia.com/p" }];
    expect(resolveOwnRank(withSub, "iranopedia.com").ownRank).toBe(4);
  });

  it("resolves schemeless result urls when the domain field is empty", () => {
    const schemeless = [{ rank: 5, domain: "", url: "www.iranopedia.com/persian-cats" }];
    expect(resolveOwnRank(schemeless, "iranopedia.com")).toEqual({
      ownRank: 5,
      ownUrl: "www.iranopedia.com/persian-cats",
    });
  });

  it("does NOT match suffix look-alikes and answers null honestly", () => {
    const lookAlike = [{ rank: 1, domain: "notiranopedia.com", url: "https://notiranopedia.com/x" }];
    expect(resolveOwnRank(lookAlike, "iranopedia.com")).toEqual({ ownRank: null, ownUrl: null });
    expect(resolveOwnRank(items, "ritzbuilders.com")).toEqual({ ownRank: null, ownUrl: null });
    expect(resolveOwnRank(items, null)).toEqual({ ownRank: null, ownUrl: null });
    expect(resolveOwnRank(items, "")).toEqual({ ownRank: null, ownUrl: null });
  });
});

describe("buildSerpHistoryRow — the append-only history row", () => {
  it("builds a normalized, fully-populated row (shared by live writer + backfill)", () => {
    const snapshot = parseDataForSeoSerp("Persian Wedding", { tasks: [{ result: [{ items: [
      { type: "organic", url: "https://theknot.com/x", title: "X" },
      { type: "organic", url: "https://iranopedia.com/persian-wedding", title: "Y" },
      { type: "people_also_ask" },
    ] }] }] }, "2026-06-25T00:00:00Z");
    const row = buildSerpHistoryRow({
      tenantId: "tenant-iranopedia",
      query: " Persian Wedding ",
      location: "2840|en",
      snapshot,
      tenantDomain: "iranopedia.com",
      capturedAt: "2026-06-25T00:00:00.000Z",
      costUsd: 0.003,
    });
    expect(row.tenant_id).toBe("tenant-iranopedia");
    expect(row.query).toBe("persian wedding");
    expect(row.id).toBe("persian wedding|2026-06-25T00:00:00.000Z");
    expect(row.location).toBe("2840|en");
    expect(row.own_rank).toBe(2);
    expect(row.own_url).toBe("https://iranopedia.com/persian-wedding");
    expect(row.top_domains).toHaveLength(2);
    expect(row.top_domains[0]).toEqual({ rank: 1, domain: "theknot.com", url: "https://theknot.com/x" });
    expect(row.serp_features).toEqual(["people_also_ask"]);
    expect(row.raw_cost_usd).toBe(0.003);
  });

  it("answers null own_rank when the tenant domain is unknown or absent", () => {
    const snapshot = parseDataForSeoSerp("q", { tasks: [{ result: [{ items: [
      { type: "organic", url: "https://a.com/x", title: "X" },
    ] }] }] }, "2026-06-25T00:00:00Z");
    const row = buildSerpHistoryRow({
      tenantId: "t", query: "q", location: "", snapshot, tenantDomain: null,
      capturedAt: "2026-06-25T00:00:00.000Z", costUsd: 0,
    });
    expect(row.own_rank).toBeNull();
    expect(row.own_url).toBeNull();
  });
});

describe("runSerpQuery — money guardrails", () => {
  it("env not configured → disabled, no fetch, no spend", async () => {
    const { d, spends } = baseDeps({ env: {} as unknown as NodeJS.ProcessEnv });
    const r = await runSerpQuery("iran flag", {}, d);
    expect(r.status).toBe("disabled");
    expect(spends).toHaveLength(0);
  });

  it("DRY-RUN (default) → returns the plan, NO fetch, NO spend", async () => {
    const bd = baseDeps({ env: { ...CONFIGURED } as unknown as NodeJS.ProcessEnv }); // no DRY_RUN=false → dry-run on
    const r = await runSerpQuery("iran flag", {}, bd.d);
    expect(r.status).toBe("dry_run");
    expect(r.costUsd).toBe(0);
    expect(bd.fetchCalls).toBe(0);
    expect(bd.spends).toHaveLength(0);
  });

  it("over the monthly cap → capped, NO fetch, NO spend", async () => {
    const bd = baseDeps({ spentThisMonthUsd: async () => 999 });
    const r = await runSerpQuery("iran flag", {}, bd.d);
    expect(r.status).toBe("capped");
    expect(bd.fetchCalls).toBe(0);
    expect(bd.spends).toHaveLength(0);
  });

  it("unknown spend → FAILS CLOSED (capped), no fetch", async () => {
    const bd = baseDeps({ spentThisMonthUsd: async () => null });
    const r = await runSerpQuery("iran flag", {}, bd.d);
    expect(r.status).toBe("capped");
    expect(bd.fetchCalls).toBe(0);
  });

  it("cache hit → served from cache, NO fetch, NO spend", async () => {
    const bd = baseDeps({
      readCache: async () => [
        { key: "2840|en|iran flag", snapshot: { query: "iran flag", results: [], features: [], source: "dataforseo", fetchedAt: "2026-06-20T00:00:00Z" }, fetchedAt: "2026-06-20T00:00:00Z" },
      ],
    });
    const r = await runSerpQuery("iran flag", {}, bd.d);
    expect(r.status).toBe("cache_hit");
    expect(bd.fetchCalls).toBe(0);
    expect(bd.spends).toHaveLength(0);
  });

  it("configured + not dry-run + under cap + cache miss → ok, fetch once, records spend", async () => {
    const bd = baseDeps();
    const r = await runSerpQuery("persian wedding", {}, bd.d);
    expect(r.status).toBe("ok");
    expect(bd.fetchCalls).toBe(1);
    expect(bd.spends).toHaveLength(1);
    expect(r.snapshot?.results[0]?.domain).toBe("theknot.com");
    expect(r.snapshot?.features).toContain("people_also_ask");
  });
});

describe("runSerpQuery — append-only SERP history (item 17)", () => {
  it("OK live read appends exactly ONE history row with the observed data", async () => {
    const bd = baseDeps();
    const r = await runSerpQuery("Persian Wedding", {}, bd.d);
    expect(r.status).toBe("ok");
    expect(bd.historyRows).toHaveLength(1);
    const row = bd.historyRows[0];
    expect(row.tenant_id).toBe("tenant-iranopedia");
    expect(row.query).toBe("persian wedding");
    expect(row.id).toBe("persian wedding|2026-06-25T00:00:00.000Z");
    expect(row.location).toBe("2840|en");
    expect(row.captured_at).toBe("2026-06-25T00:00:00.000Z");
    // theknot.com holds rank 1; iranopedia.com is absent → own_rank stays null (honest).
    expect(row.own_rank).toBeNull();
    expect(row.top_domains).toEqual([{ rank: 1, domain: "theknot.com", url: "https://theknot.com/persian-wedding" }]);
    expect(row.serp_features).toEqual(["people_also_ask"]);
    expect(row.raw_cost_usd).toBe(r.costUsd);
  });

  it("history append failure is FAIL-SOFT — the read still returns ok", async () => {
    const bd = baseDeps({
      appendHistory: async () => {
        throw new Error("table missing");
      },
    });
    const r = await runSerpQuery("persian wedding", {}, bd.d);
    expect(r.status).toBe("ok");
    expect(r.snapshot?.results).toHaveLength(1);
  });

  it("tenantDomain failure is FAIL-SOFT — row still appends with null own_rank", async () => {
    const bd = baseDeps({
      tenantDomain: async () => {
        throw new Error("no tenant registry");
      },
    });
    const r = await runSerpQuery("persian wedding", {}, bd.d);
    expect(r.status).toBe("ok");
    expect(bd.historyRows).toHaveLength(1);
    expect(bd.historyRows[0].own_rank).toBeNull();
  });

  it("cache hit → NO history write (history rides paid reads only)", async () => {
    const bd = baseDeps({
      readCache: async () => [
        { key: "2840|en|iran flag", snapshot: { query: "iran flag", results: [], features: [], source: "dataforseo", fetchedAt: "2026-06-20T00:00:00Z" }, fetchedAt: "2026-06-20T00:00:00Z" },
      ],
    });
    const r = await runSerpQuery("iran flag", {}, bd.d);
    expect(r.status).toBe("cache_hit");
    expect(bd.historyRows).toHaveLength(0);
  });

  it("dry-run → NO history write", async () => {
    const bd = baseDeps({ env: { ...CONFIGURED } as unknown as NodeJS.ProcessEnv });
    const r = await runSerpQuery("iran flag", {}, bd.d);
    expect(r.status).toBe("dry_run");
    expect(bd.historyRows).toHaveLength(0);
  });

  it("capped / error paths → NO history write", async () => {
    const capped = baseDeps({ spentThisMonthUsd: async () => 999 });
    await runSerpQuery("iran flag", {}, capped.d);
    expect(capped.historyRows).toHaveLength(0);

    const errored = baseDeps({
      fetchImpl: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
    });
    const r = await runSerpQuery("iran flag", {}, errored.d);
    expect(r.status).toBe("error");
    expect(errored.historyRows).toHaveLength(0);
  });
});
