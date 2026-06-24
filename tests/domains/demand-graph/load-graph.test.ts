import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/domains/recommendation-intelligence/gsc-page-signals", () => ({
  loadGscPageSignalsForTenant: vi.fn(),
}));
vi.mock("@/domains/recommendation-intelligence/ga4-page-values", () => ({
  loadGa4PageValuesForTenant: vi.fn(),
}));
vi.mock("@/domains/recommendation-intelligence/clarity-page-signals", () => ({
  loadClarityPageSignalsForTenant: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";

const gscMock = loadGscPageSignalsForTenant as unknown as ReturnType<typeof vi.fn>;
const ga4Mock = loadGa4PageValuesForTenant as unknown as ReturnType<typeof vi.fn>;
const clarityMock = loadClarityPageSignalsForTenant as unknown as ReturnType<typeof vi.fn>;

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
  clarityMock.mockReset();
  ga4Mock.mockResolvedValue(new Map());
  clarityMock.mockResolvedValue(new Map());
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

  it("GA4 conversions become the $ component (money-first)", async () => {
    gscMock.mockResolvedValue(
      new Map([
        ["https://x.com/quote", gscPage({ page: "https://x.com/quote", clicks90d: 40, impressions90d: 5000, ctr90d: 0.008, position90d: 8, topQueries: [{ query: "custom home quote", clicks: 40, impressions: 5000, ctr: 0.008, position: 8 }] })],
      ]),
    );
    ga4Mock.mockResolvedValue(
      new Map([["https://x.com/quote", { page: "https://x.com/quote", sessions28d: 200, engaged28d: 150, conversions28d: 12 }]]),
    );
    const { graph } = await loadDemandGraphForTenant("tenant-ritz-founder");
    const m = graph.moves.find((x) => x.label === "custom home quote")!;
    expect(m.components.dollarValue).toBe(12); // conversions surfaced as $
    expect(m.signals).toContain("$");
  });

  it("Clarity friction on a top page surfaces fix_experience", async () => {
    gscMock.mockResolvedValue(
      new Map([
        ["https://x.com/flags", gscPage({ page: "https://x.com/flags", clicks90d: 400, impressions90d: 10000, ctr90d: 0.04, position90d: 2, topQueries: [{ query: "iran flag", clicks: 400, impressions: 10000, ctr: 0.04, position: 2 }] })],
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
});
