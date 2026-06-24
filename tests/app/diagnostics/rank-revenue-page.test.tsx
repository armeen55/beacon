/**
 * /diagnostics/rank-revenue render contract (2026-06-24): operator gate, the
 * Top-25 table renders each Move with its RAW components + confidence, and an
 * honest empty state. The loader is mocked — this pins the surface, not the data.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
}));

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: () => _operator }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-iranopedia" }));

const empty = {
  graph: { demandNodes: [], pageNodes: [], edges: [], moves: [] as unknown[] },
  coverage: { gscPages: 0, ga4Pages: 0, clarityPages: 0, competitorCitations: 0, emptySources: ["gsc"] },
};
let _result: unknown = empty;
vi.mock("@/domains/demand-graph/load-graph", () => ({
  loadDemandGraphForTenant: async () => _result,
}));

import RankRevenuePage from "@/app/(shell)/diagnostics/rank-revenue/page";

beforeEach(() => {
  _operator = true;
  _result = empty;
});

describe("/diagnostics/rank-revenue", () => {
  it("404s for non-operators", async () => {
    _operator = false;
    await expect(RankRevenuePage()).rejects.toBeInstanceOf(NotFoundError);
  });

  it("renders a Move row with raw components + confidence", async () => {
    _result = {
      graph: {
        demandNodes: [],
        pageNodes: [],
        edges: [],
        moves: [
          {
            demandKey: "https://iranopedia.com/cities",
            label: "cities in iran",
            gap: "edit_page",
            score: 1234,
            components: { demand: 16000, winnability: 0.9, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
            confidence: "medium",
            signals: ["GSC"],
            ownedUrl: "https://iranopedia.com/cities",
            competitorUrls: [],
            fanoutSeeds: [],
            rationale: "You rank but under-perform — tighten the title.",
          },
        ],
      },
      coverage: { gscPages: 1, ga4Pages: 0, clarityPages: 0, competitorCitations: 0, emptySources: ["ga4", "clarity"] },
    };
    const html = renderToStaticMarkup(await RankRevenuePage());
    expect(html).toContain("Top 25");
    expect(html).toContain("cities in iran");
    expect(html).toContain("edit_page");
    expect(html).toContain("medium"); // confidence chip
    expect(html).toContain("tenant-iranopedia");
  });

  it("honest empty state when no actionable Moves", async () => {
    _result = empty;
    const html = renderToStaticMarkup(await RankRevenuePage());
    expect(html).toContain("No actionable Moves");
    expect(html).toContain("Search Console");
  });
});
