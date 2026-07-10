/**
 * Pin tests for the GA4 card removal (Wave 1 adversarial review P1, 2026-07-10).
 *
 * GA4 sessions are NOT additive across page paths - a visit that touches several
 * pages appears in several `ga4_url_traffic` rows, so summing `sessions28d` across
 * every per-URL row and rendering it as a "Visits (28 days)" stat is the same
 * false-total class the north star's P0-A fix removed. This file pins that NO
 * card ever renders that cross-page sum as a sitewide visits stat, no matter how
 * much (or little) per-page GA4 data is fed in, and that the other sources are
 * untouched by the GA4 gate.
 */
import { describe, expect, it } from "vitest";

import { buildSourceStatCards, type AllSourceStatInputs } from "./build-source-stat-cards";
import type { Ga4PageValue } from "@/domains/recommendation-intelligence/ga4-page-values";

const baseInputs: AllSourceStatInputs = {
  gscSiteTotals: null,
  ga4: new Map(),
  clarity: new Map(),
  aeo: null,
};

function ga4Row(page: string, sessions28d: number): Ga4PageValue {
  return { page, sessions28d, engaged28d: Math.round(sessions28d * 0.6), conversions28d: 0 };
}

describe("buildSourceStatCards - GA4 false-total removal (Wave 1 P1)", () => {
  it("never renders a 'ga4' card, even with a large cross-page session sum", () => {
    const ga4 = new Map<string, Ga4PageValue>([
      ["/a", ga4Row("/a", 5000)],
      ["/b", ga4Row("/b", 4000)],
      ["/c", ga4Row("/c", 3862)],
    ]);
    // Sanity: the old bug would have summed to 12,862 - the exact inflated
    // number the north-star P0-A review caught for June. Confirms this fixture
    // reproduces the real false-total shape, not a toy number.
    const sum = [...ga4.values()].reduce((s, v) => s + v.sessions28d, 0);
    expect(sum).toBe(12_862);

    const cards = buildSourceStatCards({ ...baseInputs, ga4 });

    expect(cards.find((c) => c.key === "ga4")).toBeUndefined();
    for (const card of cards) {
      for (const stat of card.stats) {
        expect(stat.value).not.toBe("12,862");
        expect(stat.value).not.toBe("12,862".replace(",", ""));
      }
    }
  });

  it("never renders a 'ga4' card on an empty (connected-but-no-rows) GA4 map either", () => {
    const cards = buildSourceStatCards({ ...baseInputs, ga4: new Map() });
    expect(cards.find((c) => c.key === "ga4")).toBeUndefined();
  });

  it("no rendered card ever carries the 'Website visits' source label or a 'Visits (28 days)' stat", () => {
    const ga4 = new Map<string, Ga4PageValue>([
      ["/a", ga4Row("/a", 900)],
      ["/b", ga4Row("/b", 200)],
    ]);
    const cards = buildSourceStatCards({ ...baseInputs, ga4 });

    expect(cards.some((c) => c.source === "Website visits")).toBe(false);
    for (const card of cards) {
      expect(card.stats.some((s) => s.label === "Visits (28 days)")).toBe(false);
    }
  });

  it("other sources still render normally - the GA4 gate does not swallow real data from GSC/AEO", () => {
    const ga4 = new Map<string, Ga4PageValue>([["/a", ga4Row("/a", 1000)]]);
    const cards = buildSourceStatCards({
      gscSiteTotals: {
        clicks90d: 900,
        impressions90d: 10_000,
        avgPosition90d: 12.3,
        ctr90d: 0.09,
        clicks28d: 300,
        clicksPrev28d: 0,
        dailyClicks: [],
      },
      ga4,
      clarity: new Map(),
      aeo: {
        date: "2026-07-09",
        isFallback: false,
        totalCitations: 4,
        totalMentions: 9,
        platformRowCount: 2,
      },
    });

    expect(cards.map((c) => c.key).sort()).toEqual(["aeo", "gsc"]);
  });
});
