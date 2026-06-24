import { describe, it, expect, vi, beforeEach } from "vitest";

let _rows: Array<Record<string, unknown>> = [];
let _eqCapture: { col: string; val: string } | null = null;

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => {
          _eqCapture = { col, val };
          return { range: (from: number) => Promise.resolve({ data: from === 0 ? _rows : [], error: null }) };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn() } }));

import { loadCompetitorCitedPagesForTenant } from "@/domains/demand-graph/competitor-citations-loader";

beforeEach(() => {
  _rows = [];
  _eqCapture = null;
});

describe("loadCompetitorCitedPagesForTenant", () => {
  it("scopes the read to the tenant (isolation) and excludes the owned domain", async () => {
    _rows = [
      { root_domain: "iranopedia.com", url: "https://iranopedia.com/cities", model: "ChatGPT", citation_count: 3 },
      { root_domain: "theknot.com", url: "https://theknot.com/content/persian-wedding", model: "ChatGPT", citation_count: 5 },
    ];
    const r = await loadCompetitorCitedPagesForTenant("tenant-iranopedia", "iranopedia.com");
    expect(_eqCapture).toEqual({ col: "tenant_id", val: "tenant-iranopedia" }); // tenant-scoped
    // owned domain → ownedCitedUrls, NOT competitors
    expect(r.competitors.map((c) => c.domain)).not.toContain("iranopedia.com");
    expect([...r.ownedCitedUrls.values()].reduce((a, b) => a + b, 0)).toBe(3);
    expect(r.competitors.map((c) => c.domain)).toContain("theknot.com");
  });

  it("aggregates a URL across models: sums citations, counts distinct models", async () => {
    _rows = [
      { root_domain: "wikipedia.org", url: "https://en.wikipedia.org/wiki/Nowruz", model: "ChatGPT", citation_count: 4 },
      { root_domain: "wikipedia.org", url: "https://en.wikipedia.org/wiki/Nowruz", model: "Perplexity", citation_count: 2 },
      { root_domain: "wikipedia.org", url: "https://en.wikipedia.org/wiki/Nowruz", model: "Gemini", citation_count: 1 },
    ];
    const r = await loadCompetitorCitedPagesForTenant("t", "iranopedia.com");
    const nowruz = r.competitors.find((c) => c.url.includes("Nowruz"))!;
    expect(nowruz.citationCount).toBe(7);
    expect(nowruz.modelCount).toBe(3);
    expect(nowruz.topicTokens).toContain("nowruz");
  });

  it("flags generic platforms/social as aggregators (never create_page seeds)", async () => {
    _rows = [
      { root_domain: "reddit.com", url: "https://reddit.com/r/iran/abc", model: "ChatGPT", citation_count: 9 },
      { root_domain: "mypersiancorner.com", url: "https://mypersiancorner.com/terminology", model: "ChatGPT", citation_count: 2 },
    ];
    const r = await loadCompetitorCitedPagesForTenant("t", "iranopedia.com");
    expect(r.competitors.find((c) => c.domain === "reddit.com")!.isAggregator).toBe(true);
    expect(r.competitors.find((c) => c.domain === "mypersiancorner.com")!.isAggregator).toBe(false);
  });

  it("ranks by model breadth first (multi-model citation = stronger competitor)", async () => {
    _rows = [
      { root_domain: "a.com", url: "https://a.com/x", model: "ChatGPT", citation_count: 100 },
      { root_domain: "b.com", url: "https://b.com/y", model: "ChatGPT", citation_count: 1 },
      { root_domain: "b.com", url: "https://b.com/y", model: "Perplexity", citation_count: 1 },
      { root_domain: "b.com", url: "https://b.com/y", model: "Gemini", citation_count: 1 },
    ];
    const r = await loadCompetitorCitedPagesForTenant("t", "iranopedia.com");
    expect(r.competitors[0]!.domain).toBe("b.com"); // 3 models beats 1 model w/ higher count
  });

  it("no rows → empty result (no crash)", async () => {
    _rows = [];
    const r = await loadCompetitorCitedPagesForTenant("t", "iranopedia.com");
    expect(r.competitors).toEqual([]);
    expect(r.rowsScanned).toBe(0);
  });
});
