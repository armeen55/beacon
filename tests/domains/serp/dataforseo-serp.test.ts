import { describe, it, expect } from "vitest";

import {
  runSerpQuery,
  planSerpCall,
  parseDataForSeoSerp,
  isDataForSeoConfigured,
  isDryRun,
  monthlyCapUsd,
  type SerpRunDeps,
} from "@/domains/serp/dataforseo-serp";

const CONFIGURED = {
  DATAFORSEO_LOGIN: "u",
  DATAFORSEO_PASSWORD: "p",
  BEACON_SERP_PROVIDER: "dataforseo",
} as unknown as NodeJS.ProcessEnv;

function baseDeps(over: Partial<SerpRunDeps> = {}): { d: Partial<SerpRunDeps>; fetchCalls: number; spends: number[] } {
  let fetchCalls = 0;
  const spends: number[] = [];
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
    ...over,
  };
  return { d, get fetchCalls() { return fetchCalls; }, spends };
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
