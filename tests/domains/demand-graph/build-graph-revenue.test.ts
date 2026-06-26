/**
 * 2026-06-26 — build-graph revenue-aware scoring integration (GA4 revenue
 * migration, Phase 5). Pins that the pure scorer:
 *   • applies the PRECOMPUTED revenueMultiplier as the dollar multiplier
 *     (no longer treats a conversion COUNT as dollars),
 *   • fires the "$" signal ONLY on proven revenue (basis "revenue"),
 *   • fires a "conversions" signal on the conversion fallback (basis
 *     "conversions") — NOT "$",
 *   • exposes real revenue as components.dollarValue,
 *   • stays neutral (no boost, no punish) when revenue is unknown.
 */
import { describe, it, expect } from "vitest";
import {
  buildDemandGraph,
  type DemandInput,
  type OwnedPageInput,
} from "@/domains/demand-graph/build-graph";

function demand(key: string, over: Partial<DemandInput> = {}): DemandInput {
  return {
    label: over.label ?? key,
    queries: over.queries ?? [key],
    gscImpressions: over.gscImpressions ?? 3000,
    searchVolume: over.searchVolume ?? null,
    aiExecutions: over.aiExecutions ?? null,
    ownedAiShare: over.ownedAiShare ?? null,
    fanoutSubQueries: over.fanoutSubQueries ?? [],
    topicId: over.topicId ?? null,
    key,
    ...over,
  };
}

function ownedPage(over: Partial<OwnedPageInput>): OwnedPageInput {
  return {
    url: "https://shop.example.com/widget",
    servesDemandKeys: ["widget"],
    gscImpressions: 3000,
    gscClicks: 90,
    gscPosition: 6, // ranks but weak → goes through the scoring path
    aiCitationCount: 1,
    ...over,
  };
}

const D = [demand("widget", { label: "best widget", gscImpressions: 3000 })];

function moveFor(owned: OwnedPageInput) {
  const g = buildDemandGraph({ demand: D, ownedPages: [owned], competitorCitations: [] });
  return g.moves.find((m) => m.demandKey === "widget")!;
}

describe("build-graph — revenue-aware dollar signal", () => {
  it("proven revenue → '$' signal, dollarValue = real revenue, score boosted by the multiplier", () => {
    const withRevenue = moveFor(
      ownedPage({ ga4Conversions: 10, revenueValue: 5000, revenueMultiplier: 2.85, revenueBasis: "revenue" }),
    );
    const neutral = moveFor(
      ownedPage({ ga4Conversions: 0, revenueValue: null, revenueMultiplier: 1.0, revenueBasis: "none" }),
    );
    expect(withRevenue.signals).toContain("$");
    expect(withRevenue.signals).not.toContain("conversions");
    expect(withRevenue.components.dollarValue).toBe(5000); // REAL revenue, not a count
    // the 2.85x revenue multiplier must lift the score above the neutral 1.0x page
    expect(withRevenue.score).toBeGreaterThan(neutral.score);
  });

  it("conversion fallback → 'conversions' signal (NOT '$'), dollarValue stays 0 (no proven revenue)", () => {
    const conv = moveFor(
      ownedPage({ ga4Conversions: 40, revenueValue: null, revenueMultiplier: 1.5, revenueBasis: "conversions" }),
    );
    expect(conv.signals).toContain("conversions");
    expect(conv.signals).not.toContain("$");
    expect(conv.components.dollarValue).toBe(0); // revenue unknown → not asserted as $
  });

  it("no revenue + no conversions → neutral: no '$', no 'conversions', multiplier 1.0", () => {
    const none = moveFor(
      ownedPage({ ga4Conversions: 0, revenueValue: null, revenueMultiplier: 1.0, revenueBasis: "none" }),
    );
    expect(none.signals).not.toContain("$");
    expect(none.signals).not.toContain("conversions");
  });

  it("a higher revenue multiplier ranks a page above an otherwise-identical lower-revenue page", () => {
    const big = moveFor(ownedPage({ revenueValue: 50_000, revenueMultiplier: 3.7, revenueBasis: "revenue" }));
    const small = moveFor(ownedPage({ revenueValue: 50, revenueMultiplier: 1.26, revenueBasis: "revenue" }));
    expect(big.score).toBeGreaterThan(small.score);
  });

  it("missing revenueMultiplier (legacy caller) → neutral 1.0, never punishes", () => {
    const legacy = moveFor(ownedPage({ ga4Conversions: 5 })); // no revenue fields at all
    const neutral = moveFor(ownedPage({ ga4Conversions: 5, revenueMultiplier: 1.0, revenueBasis: "none" }));
    expect(legacy.score).toBe(neutral.score);
  });
});
