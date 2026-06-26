import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/domains/recommendation-intelligence/gsc-page-signals", () => ({
  loadGscPageSignalsForTenant: vi.fn(),
}));
vi.mock("@/domains/recommendation-intelligence/ga4-page-values", () => ({
  loadGa4PageValuesForTenant: vi.fn(),
  loadGa4PageRevenueForTenant: vi.fn(),
}));
vi.mock("@/domains/recommendation-intelligence/clarity-page-signals", () => ({
  loadClarityPageSignalsForTenant: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/domains/demand-graph/competitor-citations-loader", () => ({
  loadCompetitorCitedPagesForTenant: vi.fn(),
}));

import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGa4PageValuesForTenant, loadGa4PageRevenueForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { normalizePageRevenue } from "@/domains/recommendation-intelligence/ga4-revenue";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { loadCompetitorCitedPagesForTenant } from "@/domains/demand-graph/competitor-citations-loader";

const gscMock = loadGscPageSignalsForTenant as unknown as ReturnType<typeof vi.fn>;
const ga4Mock = loadGa4PageValuesForTenant as unknown as ReturnType<typeof vi.fn>;
const ga4RevMock = loadGa4PageRevenueForTenant as unknown as ReturnType<typeof vi.fn>;
const clarityMock = loadClarityPageSignalsForTenant as unknown as ReturnType<typeof vi.fn>;
const compMock = loadCompetitorCitedPagesForTenant as unknown as ReturnType<typeof vi.fn>;

function comp(over: Partial<Record<string, unknown>>): unknown {
  return { url: "https://c.com/x", domain: "c.com", topicTokens: [], label: "x", citationCount: 1, modelCount: 1, isAggregator: false, ...over };
}

function gscPage(over: Partial<Record<string, unknown>>): unknown {
  return {
    page: "p",
    clicks90d: 0,
    impressions90d: 0,
    ctr90d: 0,
    position90d: 99,
    topQueries: [],
    ...over,
  };
}

beforeEach(() => {
  gscMock.mockReset();
  ga4Mock.mockReset();
  ga4RevMock.mockReset();
  clarityMock.mockReset();
  compMock.mockReset();
  ga4Mock.mockResolvedValue(new Map());
  // Default: no revenue observed → scorer uses the conversion/neutral fallback.
  ga4RevMock.mockResolvedValue(new Map());
  clarityMock.mockResolvedValue(new Map());
  compMock.mockResolvedValue({ competitors: [], ownedCitedUrls: new Map(), rowsScanned: 0 });
});

describe("loadDemandGraphForTenant — wires real loaders into the graph", () => {
  it("turns GSC pages into demand + owned nodes; weak page → edit_page with raw components", async () => {
    gscMock.mockResolvedValue(
      new Map([
        [
          "https://iranopedia.com/cities",
          gscPage({
            page: "https://iranopedia.com/cities",
            clicks90d: 70,
            impressions90d: 16000,
            ctr90d: 0.0044,
            position90d: 9,
            topQueries: [{ query: "cities in iran", clicks: 70, impressions: 16000, ctr: 0.0044, position: 9 }],
          }),
        ],
      ]),
    );
    const { graph, coverage } = await loadDemandGraphForTenant("tenant-iranopedia");
    expect(coverage.gscPages).toBe(1);
    const m = graph.moves.find((x) => x.label === "cities in iran")!;
    expect(m.gap).toBe("edit_page"); // position 9, CTR far below expected
    expect(m.components.demand).toBe(16000);
    expect(m.signals).toContain("GSC");
  });

  it("real GA4 REVENUE becomes the $ component + '$' signal (revenue-aware, 2026-06-26)", async () => {
    gscMock.mockResolvedValue(
      new Map([
        ["https://x.com/quote", gscPage({ page: "https://x.com/quote", clicks90d: 40, impressions90d: 5000, ctr90d: 0.008, position90d: 8, topQueries: [{ query: "custom home quote", clicks: 40, impressions: 5000, ctr: 0.008, position: 8 }] })],
      ]),
    );
    ga4Mock.mockResolvedValue(
      new Map([["https://x.com/quote", { page: "https://x.com/quote", sessions28d: 200, engaged28d: 150, conversions28d: 12 }]]),
    );
    // Observed revenue → the $ component is REAL revenue (not the conversion count).
    ga4RevMock.mockResolvedValue(
      new Map([["https://x.com/quote", normalizePageRevenue({ page: "https://x.com/quote", sessions: 200, engagedSessions: 150, conversions: 12, totalRevenue: 4000, purchaseRevenue: 4000, transactions: 12, revenueCurrency: "USD", revenueObserved: true })]]),
    );
    const { graph } = await loadDemandGraphForTenant("tenant-ritz-founder");
    const m = graph.moves.find((x) => x.label === "custom home quote")!;
    expect(m.components.dollarValue).toBe(4000); // real revenue, NOT the 12 conversions
    expect(m.signals).toContain("$");
  });

  it("GA4 conversions but revenue UNKNOWN → conversion fallback ($=0, 'conversions' not '$')", async () => {
    gscMock.mockResolvedValue(
      new Map([
        ["https://x.com/quote", gscPage({ page: "https://x.com/quote", clicks90d: 40, impressions90d: 5000, ctr90d: 0.008, position90d: 8, topQueries: [{ query: "custom home quote", clicks: 40, impressions: 5000, ctr: 0.008, position: 8 }] })],
      ]),
    );
    ga4Mock.mockResolvedValue(
      new Map([["https://x.com/quote", { page: "https://x.com/quote", sessions28d: 200, engaged28d: 150, conversions28d: 12 }]]),
    );
    // ga4RevMock defaults to empty (revenue never observed) → conversion fallback.
    const { graph } = await loadDemandGraphForTenant("tenant-ritz-founder");
    const m = graph.moves.find((x) => x.label === "custom home quote")!;
    expect(m.components.dollarValue).toBe(0); // revenue unknown — never asserted as $
    expect(m.signals).not.toContain("$");
    expect(m.signals).toContain("conversions");
  });

  it("Clarity friction on a top page surfaces fix_experience", async () => {
    gscMock.mockResolvedValue(
      new Map([
        // healthy CTR @ pos 2 → NOT weak; friction is the ONLY issue → fix_experience
        ["https://x.com/flags", gscPage({ page: "https://x.com/flags", clicks90d: 3000, impressions90d: 10000, ctr90d: 0.30, position90d: 2, topQueries: [{ query: "iran flag", clicks: 3000, impressions: 10000, ctr: 0.30, position: 2 }] })],
      ]),
    );
    clarityMock.mockResolvedValue(
      new Map([["https://x.com/flags", { url: "https://x.com/flags", sessions: 500, rageClicks: 5, deadClicks: 60, quickbacks: 0, excessiveScroll: 0, scriptErrors: 0, rageRate: 0.01, deadRate: 0.12, quickbackRate: 0 }]]),
    );
    const { graph } = await loadDemandGraphForTenant("tenant-x");
    const m = graph.moves.find((x) => x.label === "iran flag")!;
    expect(m.gap).toBe("fix_experience");
    expect(m.components.friction).toBeGreaterThanOrEqual(60);
  });

  it("no GSC data → no moves + honest emptySources (not fake certainty)", async () => {
    gscMock.mockResolvedValue(new Map());
    const { graph, coverage } = await loadDemandGraphForTenant("tenant-empty");
    expect(graph.moves).toEqual([]);
    expect(coverage.emptySources).toContain("gsc");
  });

  it("Step 2: competitor cited for a topic you rank for but AI doesn't cite you → answer_block", async () => {
    gscMock.mockResolvedValue(
      new Map([
        ["https://iranopedia.com/farsi-vs-persian", gscPage({ page: "https://iranopedia.com/farsi-vs-persian", clicks90d: 120, impressions90d: 6000, ctr90d: 0.02, position90d: 3, topQueries: [{ query: "farsi vs persian", clicks: 120, impressions: 6000, ctr: 0.02, position: 3 }] })],
      ]),
    );
    compMock.mockResolvedValue({
      competitors: [comp({ url: "https://history.com/farsi-persian-difference", domain: "history.com", topicTokens: ["farsi", "persian", "difference"], label: "farsi persian difference", citationCount: 12, modelCount: 5 })],
      ownedCitedUrls: new Map(), // you are NOT cited
      rowsScanned: 1,
    });
    const { graph, coverage } = await loadDemandGraphForTenant("tenant-iranopedia");
    const m = graph.moves.find((x) => x.demandKey === "https://iranopedia.com/farsi-vs-persian")!;
    expect(m.gap).toBe("answer_block");
    expect(m.competitorUrls).toContain("https://history.com/farsi-persian-difference");
    expect(m.components.visibilityGap).toBeGreaterThan(0.5); // real gap, no longer constant-only
    expect(coverage.competitorEdges).toBeGreaterThan(0);
  });

  it("Step 2: high-demand competitor topic with NO owned page → create_page (low confidence)", async () => {
    gscMock.mockResolvedValue(
      new Map([
        // an owned PERSIAN page → tenant vocab includes "persian" (on-topic gate)
        ["https://iranopedia.com/persian-girl-names", gscPage({ page: "https://iranopedia.com/persian-girl-names", clicks90d: 70, impressions90d: 16000, ctr90d: 0.004, position90d: 9, topQueries: [{ query: "persian girl names", clicks: 70, impressions: 16000, ctr: 0.004, position: 9 }] })],
      ]),
    );
    compMock.mockResolvedValue({
      competitors: [
        // shares only "persian" (1 token) with the owned page → not matched → create candidate
        comp({ url: "https://theknot.com/content/persian-wedding", domain: "theknot.com", topicTokens: ["persian", "wedding", "traditions"], label: "persian wedding traditions", citationCount: 30, modelCount: 6 }),
      ],
      ownedCitedUrls: new Map(),
      rowsScanned: 1,
    });
    const { graph, coverage } = await loadDemandGraphForTenant("tenant-iranopedia");
    const created = graph.moves.find((x) => x.gap === "create_page");
    expect(created).toBeTruthy();
    expect(created!.label).toContain("persian wedding");
    expect(created!.competitorUrls).toContain("https://theknot.com/content/persian-wedding");
    expect(created!.confidence).toBe("low"); // AI-citation proxy only — honest
    expect(coverage.createPageCandidates).toBeGreaterThan(0);
  });

  it("Step 2: aggregator (reddit) never seeds a create_page on its own", async () => {
    gscMock.mockResolvedValue(
      new Map([["https://iranopedia.com/cities", gscPage({ page: "https://iranopedia.com/cities", impressions90d: 16000, clicks90d: 70, ctr90d: 0.004, position90d: 9, topQueries: [{ query: "cities in iran", clicks: 70, impressions: 16000, ctr: 0.004, position: 9 }] })]]),
    );
    compMock.mockResolvedValue({
      competitors: [comp({ url: "https://reddit.com/r/iran/abc", domain: "reddit.com", topicTokens: ["something", "random"], label: "something random", citationCount: 50, modelCount: 6, isAggregator: true })],
      ownedCitedUrls: new Map(),
      rowsScanned: 1,
    });
    const { graph } = await loadDemandGraphForTenant("tenant-iranopedia");
    expect(graph.moves.some((m) => m.gap === "create_page")).toBe(false);
  });
});
