import { describe, it, expect } from "vitest";

import {
  runSerpQuery,
  planSerpCall,
  parseDataForSeoSerp,
  parseAiOverview,
  isDataForSeoConfigured,
  isDryRun,
  monthlyCapUsd,
  organicItemsOf,
  resolveOwnRank,
  buildSerpHistoryRow,
  type SerpRunDeps,
  type SerpHistoryRow,
} from "@/domains/evidence/readers/dataforseo-serp";

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

describe("parseAiOverview — item 20 (Google AI Overview citations)", () => {
  it("answers the honest absent shape when no ai_overview item exists", () => {
    expect(parseAiOverview(undefined)).toEqual({ present: false, citedDomains: [], overviewTextExcerpt: "" });
    expect(parseAiOverview({ type: "organic", url: "https://a.com" })).toEqual({
      present: false,
      citedDomains: [],
      overviewTextExcerpt: "",
    });
  });

  it("parses the real live/advanced shape: top-level references[] with domain/url/position", () => {
    const item = {
      type: "ai_overview",
      markdown: "Nowruz is the Persian New Year.",
      references: [
        { type: "ai_overview_reference", domain: "www.un.org", url: "https://www.un.org/en/observances/international-nowruz-day", source: "United Nations" },
        { type: "ai_overview_reference", domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Nowruz", source: "Wikipedia" },
      ],
    };
    const parsed = parseAiOverview(item);
    expect(parsed.present).toBe(true);
    expect(parsed.citedDomains).toEqual([
      { domain: "un.org", url: "https://www.un.org/en/observances/international-nowruz-day", position: 1 },
      { domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Nowruz", position: 2 },
    ]);
    expect(parsed.overviewTextExcerpt).toBe("Nowruz is the Persian New Year.");
  });

  it("present with zero references when the response withholds them (still honest, never null)", () => {
    const parsed = parseAiOverview({ type: "ai_overview", markdown: "Some overview text.", references: [] });
    expect(parsed.present).toBe(true);
    expect(parsed.citedDomains).toEqual([]);
  });

  it("skips malformed reference entries instead of throwing", () => {
    const parsed = parseAiOverview({
      type: "ai_overview",
      references: [null, { url: "" }, { domain: "good.com", url: "https://good.com/x" }],
    });
    expect(parsed.citedDomains).toEqual([{ domain: "good.com", url: "https://good.com/x", position: 1 }]);
  });

  it("normalizes a www-prefixed reference domain the same way SerpOrganicItem.domain does", () => {
    const parsed = parseAiOverview({
      type: "ai_overview",
      references: [{ domain: "www.un.org", url: "https://www.un.org/en/observances/international-nowruz-day" }],
    });
    expect(parsed.citedDomains).toEqual([
      { domain: "un.org", url: "https://www.un.org/en/observances/international-nowruz-day", position: 1 },
    ]);
  });

  it("truncates the text excerpt to 300 chars with a trailing ellipsis", () => {
    const longText = "a".repeat(400);
    const parsed = parseAiOverview({ type: "ai_overview", markdown: longText, references: [] });
    expect(parsed.overviewTextExcerpt.length).toBe(300);
    expect(parsed.overviewTextExcerpt.endsWith("...")).toBe(true);
  });

  it("falls back to the plain text field when markdown is absent", () => {
    const parsed = parseAiOverview({ type: "ai_overview", text: "Plain overview text.", references: [] });
    expect(parsed.overviewTextExcerpt).toBe("Plain overview text.");
  });

  it("parseDataForSeoSerp wires the ai_overview item through as snapshot.aiOverview", () => {
    const withOverview = parseDataForSeoSerp(
      "what is nowruz",
      {
        tasks: [
          {
            result: [
              {
                items: [
                  { type: "ai_overview", markdown: "Nowruz overview.", references: [{ domain: "un.org", url: "https://un.org/x" }] },
                  { type: "organic", url: "https://a.com/x", title: "X" },
                ],
              },
            ],
          },
        ],
      },
      "2026-07-02T00:00:00Z",
    );
    expect(withOverview.aiOverview.present).toBe(true);
    expect(withOverview.aiOverview.citedDomains).toEqual([{ domain: "un.org", url: "https://un.org/x", position: 1 }]);

    const withoutOverview = parseDataForSeoSerp(
      "q",
      { tasks: [{ result: [{ items: [{ type: "organic", url: "https://a.com/x", title: "X" }] }] }] },
      "2026-07-02T00:00:00Z",
    );
    expect(withoutOverview.aiOverview).toEqual({ present: false, citedDomains: [], overviewTextExcerpt: "" });
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

  it("item 20: defaults ai_overview_present/domains to the honest absent shape when omitted", () => {
    const snapshot = parseDataForSeoSerp("q", { tasks: [{ result: [{ items: [
      { type: "organic", url: "https://a.com/x", title: "X" },
    ] }] }] }, "2026-06-25T00:00:00Z");
    const row = buildSerpHistoryRow({
      tenantId: "t", query: "q", location: "", snapshot, tenantDomain: null,
      capturedAt: "2026-06-25T00:00:00.000Z", costUsd: 0,
    });
    expect(row.ai_overview_present).toBe(false);
    expect(row.ai_overview_domains).toEqual([]);
  });

  it("item 20: persists the parsed AI Overview when the caller passes it", () => {
    const snapshot = parseDataForSeoSerp(
      "persian carpets",
      { tasks: [{ result: [{ items: [
        { type: "ai_overview", markdown: "Persian carpets overview.", references: [{ domain: "carpetencyclopedia.com", url: "https://carpetencyclopedia.com/x" }] },
        { type: "organic", url: "https://a.com/x", title: "X" },
      ] }] }] },
      "2026-06-25T00:00:00Z",
    );
    const row = buildSerpHistoryRow({
      tenantId: "t",
      query: "persian carpets",
      location: "2840|en",
      snapshot,
      tenantDomain: null,
      capturedAt: "2026-06-25T00:00:00.000Z",
      costUsd: 0.003,
      aiOverview: snapshot.aiOverview,
    });
    expect(row.ai_overview_present).toBe(true);
    expect(row.ai_overview_domains).toEqual([{ domain: "carpetencyclopedia.com", url: "https://carpetencyclopedia.com/x", position: 1 }]);
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

  it("item 20: OK live read with an ai_overview item persists it onto the history row", async () => {
    const bd = baseDeps({
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({ tasks: [{ result: [{ items: [
          { type: "ai_overview", markdown: "Persian wedding overview.", references: [{ domain: "theknot.com", url: "https://theknot.com/persian-wedding" }] },
          { type: "organic", url: "https://theknot.com/persian-wedding", title: "Persian Wedding" },
        ] }] }] }),
      })) as unknown as typeof fetch,
    });
    const r = await runSerpQuery("persian wedding", {}, bd.d);
    expect(r.status).toBe("ok");
    const row = bd.historyRows[0];
    expect(row.ai_overview_present).toBe(true);
    expect(row.ai_overview_domains).toEqual([{ domain: "theknot.com", url: "https://theknot.com/persian-wedding", position: 1 }]);
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
