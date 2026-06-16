/**
 * 2026-06-15 — All-source stat-row reducer (buildSourceStatCards) unit
 * tests. Pins the CRITICAL gating contract: cards gate on DATA presence,
 * never on connector status. Validates the per-source headline math
 * (impressions-weighted GSC position, site-level rates from summed
 * counts, before/after delta) and the honesty rules (Clarity "building
 * history", AEO self-hide, no "0" cards).
 */

import { describe, it, expect } from "vitest";

import {
  buildSourceStatCards,
  MIN_SPARKLINE_POINTS,
  type AllSourceStatInputs,
} from "@/domains/today-summary/build-source-stat-cards";
import type { GscSiteTotals } from "@/domains/recommendation-intelligence/gsc-page-signals";
import type { Ga4PageValue } from "@/domains/recommendation-intelligence/ga4-page-values";
import type { ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import type { SemrushPageSignal } from "@/domains/recommendation-intelligence/semrush-page-signals";
import type { TodayDerivedKpis } from "@/domains/daily-metric-snapshots/today-kpis";

function gscTotals(p: Partial<GscSiteTotals>): GscSiteTotals {
  return {
    clicks90d: 0,
    impressions90d: 0,
    avgPosition90d: 0,
    ctr90d: 0,
    clicks28d: 0,
    clicksPrev28d: 0,
    dailyClicks: [],
    ...p,
  };
}

/** Build a `dailyClicks` series of `n` days (ascending) for sparkline tests. */
function dailyClicks(n: number): { date: string; clicks: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, "0")}`,
    clicks: 10 + i,
  }));
}

function ga4Value(p: Partial<Ga4PageValue>): Ga4PageValue {
  return { page: "https://x.com/a", sessions28d: 0, engaged28d: 0, conversions28d: 0, ...p };
}

function claritySignal(p: Partial<ClarityPageSignal>): ClarityPageSignal {
  return {
    url: "https://x.com/a",
    sessions: 0,
    rageClicks: 0,
    deadClicks: 0,
    quickbacks: 0,
    excessiveScroll: 0,
    scriptErrors: 0,
    rageRate: 0,
    deadRate: 0,
    quickbackRate: 0,
    ...p,
  };
}

function semrushSignal(p: Partial<SemrushPageSignal>): SemrushPageSignal {
  return { page: "https://x.com/a", keywords: [], strikingDistance: [], ...p };
}

function emptyInputs(): AllSourceStatInputs {
  return {
    gscSiteTotals: null,
    ga4: new Map(),
    clarity: new Map(),
    semrush: new Map(),
    aeo: null,
  };
}

describe("buildSourceStatCards — empty / gating", () => {
  it("returns NO cards when every source is empty", () => {
    expect(buildSourceStatCards(emptyInputs())).toEqual([]);
  });

  it("CRITICAL: GA4 connected-but-empty (empty Map) renders NO card (no '0 sessions')", () => {
    const inputs = emptyInputs();
    // Simulate the Iranopedia case: OAuth connected but 0 rows synced.
    inputs.ga4 = new Map();
    const cards = buildSourceStatCards(inputs);
    expect(cards.find((c) => c.key === "ga4")).toBeUndefined();
  });

  it("CRITICAL: GA4 Map with rows summing to zero sessions renders NO card", () => {
    const inputs = emptyInputs();
    inputs.ga4 = new Map([
      ["a", ga4Value({ sessions28d: 0, engaged28d: 0, conversions28d: 0 })],
    ]);
    expect(buildSourceStatCards(inputs).find((c) => c.key === "ga4")).toBeUndefined();
  });

  it("AEO self-hides when KPIs are null (raw obs may exist but no derived rollup)", () => {
    const inputs = emptyInputs();
    inputs.aeo = null;
    expect(buildSourceStatCards(inputs).find((c) => c.key === "aeo")).toBeUndefined();
  });

  it("AEO self-hides when the derived rollup exists but is all-zero", () => {
    const inputs = emptyInputs();
    inputs.aeo = {
      date: "2026-06-14",
      isFallback: false,
      totalCitations: 0,
      totalMentions: 0,
      platformRowCount: 2,
    };
    expect(buildSourceStatCards(inputs).find((c) => c.key === "aeo")).toBeUndefined();
  });
});

describe("buildSourceStatCards — GSC math", () => {
  it("emits a GSC card with the site-totals' impressions-weighted position + site CTR", () => {
    const inputs = emptyInputs();
    // Equivalent to the old two-page case: Σ clicks 150, Σ impr 10,000,
    // impressions-weighted position (5*1000 + 10*9000)/10000 = 9.5,
    // site CTR 150/10000 = 1.5%. The loader pre-aggregates these.
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 150,
      impressions90d: 10_000,
      avgPosition90d: 9.5,
      ctr90d: 0.015,
    });
    const card = buildSourceStatCards(inputs).find((c) => c.key === "gsc");
    expect(card).toBeDefined();
    const labels = Object.fromEntries(card!.stats.map((s) => [s.label, s.value]));
    // Σ impr = 10,000 → compact "10K"
    expect(labels["Impressions"]).toBe("10K");
    // impressions-weighted position from the loader
    expect(labels["Avg. position"]).toBe("9.5");
    // site CTR = 150/10000 = 1.5%
    expect(labels["Click rate"]).toBe("1.5%");
  });

  it("returns NO card when site-totals is null (GSC has no data)", () => {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = null;
    expect(buildSourceStatCards(inputs).find((c) => c.key === "gsc")).toBeUndefined();
  });

  it("returns NO card when site-totals impressions are zero (never a zero card)", () => {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({ clicks90d: 0, impressions90d: 0 });
    expect(buildSourceStatCards(inputs).find((c) => c.key === "gsc")).toBeUndefined();
  });

  it("does NOT show a before/after delta when there is no prior 28-day window", () => {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 100,
      impressions90d: 1000,
      avgPosition90d: 5,
      ctr90d: 0.1,
      clicks28d: 30,
      clicksPrev28d: 0,
    });
    const card = buildSourceStatCards(inputs).find((c) => c.key === "gsc");
    expect(card!.subline).toBeNull();
  });

  it("shows an UP before/after delta when clicks rose vs the prior 28 days", () => {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 100,
      impressions90d: 1000,
      avgPosition90d: 5,
      ctr90d: 0.1,
      clicks28d: 120,
      clicksPrev28d: 100,
    });
    const card = buildSourceStatCards(inputs).find((c) => c.key === "gsc");
    expect(card!.subline?.tone).toBe("up");
    expect(card!.subline?.text).toContain("+20%");
  });
});

describe("buildSourceStatCards — alarming stats link to the fix (#action)", () => {
  it("GSC card gets an action → /recommendations when clicks FELL", () => {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 100,
      impressions90d: 1000,
      avgPosition90d: 5,
      ctr90d: 0.1,
      clicks28d: 62,
      clicksPrev28d: 100,
    });
    const card = buildSourceStatCards(inputs).find((c) => c.key === "gsc");
    expect(card!.subline?.tone).toBe("down");
    expect(card!.action?.href).toBe("/recommendations");
    expect(card!.action?.label).toMatch(/what to do/i);
  });

  it("GSC card has NO action when clicks rose (nothing alarming)", () => {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 100,
      impressions90d: 1000,
      avgPosition90d: 5,
      ctr90d: 0.1,
      clicks28d: 120,
      clicksPrev28d: 100,
    });
    const card = buildSourceStatCards(inputs).find((c) => c.key === "gsc");
    expect(card!.action ?? null).toBeNull();
  });

  it("Clarity card gets an action → /recommendations when friction is present", () => {
    const inputs = emptyInputs();
    inputs.clarity = new Map([
      ["https://x.com/a", claritySignal({ sessions: 200, rageClicks: 8, deadClicks: 30 })],
    ]);
    const card = buildSourceStatCards(inputs).find((c) => c.key === "clarity");
    expect(card!.action?.href).toBe("/recommendations");
  });

  it("Clarity card has NO action when there is no friction (rage+dead = 0)", () => {
    const inputs = emptyInputs();
    inputs.clarity = new Map([
      ["https://x.com/a", claritySignal({ sessions: 200, rageClicks: 0, deadClicks: 0 })],
    ]);
    const card = buildSourceStatCards(inputs).find((c) => c.key === "clarity");
    expect(card!.action ?? null).toBeNull();
  });
});

describe("buildSourceStatCards — GSC sparkline (daily-clicks momentum)", () => {
  function richGsc(
    daily: { date: string; clicks: number }[],
  ): AllSourceStatInputs {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 1000,
      impressions90d: 50_000,
      avgPosition90d: 8,
      ctr90d: 0.02,
      dailyClicks: daily,
    });
    return inputs;
  }

  it("carries the daily-clicks series on the card when there are ≥14 points", () => {
    const daily = dailyClicks(MIN_SPARKLINE_POINTS); // exactly the threshold
    const card = buildSourceStatCards(richGsc(daily)).find(
      (c) => c.key === "gsc",
    );
    expect(card).toBeDefined();
    expect(card!.sparkline).toBeDefined();
    expect(card!.sparkline).toHaveLength(MIN_SPARKLINE_POINTS);
    // It's the real clicks series, in order (no transform).
    expect(card!.sparkline).toEqual(daily.map((d) => d.clicks));
  });

  it("OMITS the sparkline when there are fewer than 14 points (never a flat/empty line)", () => {
    const daily = dailyClicks(MIN_SPARKLINE_POINTS - 1);
    const card = buildSourceStatCards(richGsc(daily)).find(
      (c) => c.key === "gsc",
    );
    expect(card).toBeDefined();
    expect(card!.sparkline).toBeUndefined();
  });

  it("OMITS the sparkline when there is no daily series at all", () => {
    const card = buildSourceStatCards(richGsc([])).find((c) => c.key === "gsc");
    expect(card).toBeDefined();
    expect(card!.sparkline).toBeUndefined();
  });

  it("never sets a sparkline on non-GSC cards", () => {
    const inputs = emptyInputs();
    inputs.ga4 = new Map([["a", ga4Value({ sessions28d: 100, engaged28d: 60 })]]);
    const card = buildSourceStatCards(inputs).find((c) => c.key === "ga4");
    expect(card).toBeDefined();
    expect(card!.sparkline).toBeUndefined();
  });
});

describe("buildSourceStatCards — Clarity honesty", () => {
  it("recomputes site rates from SUMMED counts and labels 'building history' on a single day", () => {
    const inputs = emptyInputs();
    inputs.clarity = new Map([
      // Iranopedia-shaped: 214 sessions, 1 rage, 63 dead across pages
      ["a", claritySignal({ sessions: 200, rageClicks: 1, deadClicks: 60, rageRate: 0.5, deadRate: 0.3 })],
      ["b", claritySignal({ sessions: 14, rageClicks: 0, deadClicks: 3 })],
    ]);
    const card = buildSourceStatCards(inputs, /* claritySpansMultipleDays */ false).find(
      (c) => c.key === "clarity",
    );
    expect(card).toBeDefined();
    const labels = Object.fromEntries(card!.stats.map((s) => [s.label, s.value]));
    expect(labels["Visits analyzed"]).toBe("214");
    // Frustrated (rage) = 1/214 = 0.5% — recomputed from sums, NOT the
    // averaged per-page rageRate (which was 0.5).
    expect(labels["Frustrated clicks"]).toBe("0.5%");
    // Dead = 63/214 = 29.4%
    expect(labels["Dead clicks"]).toBe("29.4%");
    // Single-day: building-history label, NOT a delta.
    expect(card!.subline?.text).toMatch(/building history/i);
  });

  it("shows the friction-signal sub-line (not building-history) when multiple days exist", () => {
    const inputs = emptyInputs();
    inputs.clarity = new Map([["a", claritySignal({ sessions: 1000, rageClicks: 10, deadClicks: 20 })]]);
    const card = buildSourceStatCards(inputs, true).find((c) => c.key === "clarity");
    expect(card!.subline?.text).not.toMatch(/building history/i);
    expect(card!.subline?.text).toMatch(/friction signals/i);
  });
});

describe("buildSourceStatCards — SEMrush + AEO present", () => {
  it("emits a SEMrush card with distinct keyword count + striking distance + volume", () => {
    const inputs = emptyInputs();
    inputs.semrush = new Map([
      [
        "a",
        semrushSignal({
          keywords: [
            { keyword: "persian names", position: 6, volume: 5000, difficulty: null, intent: null },
            { keyword: "iranian names", position: 3, volume: 2000, difficulty: null, intent: null },
          ],
          strikingDistance: [
            { keyword: "persian names", position: 6, volume: 5000, difficulty: null, intent: null },
          ],
        }),
      ],
    ]);
    const card = buildSourceStatCards(inputs).find((c) => c.key === "semrush");
    expect(card).toBeDefined();
    const labels = Object.fromEntries(card!.stats.map((s) => [s.label, s.value]));
    expect(labels["Keywords ranked"]).toBe("2");
    expect(labels["Quick wins"]).toBe("1");
    // 7,000 is below the 10K compaction threshold → grouped integer.
    expect(labels["Search volume"]).toBe("7,000");
  });

  it("emits the AEO card (vendor-name-free, plain English) when KPIs have data", () => {
    const inputs = emptyInputs();
    inputs.aeo = {
      date: "2026-06-13",
      isFallback: true,
      totalCitations: 19,
      totalMentions: 0,
      platformRowCount: 1,
    };
    const card = buildSourceStatCards(inputs).find((c) => c.key === "aeo");
    expect(card).toBeDefined();
    expect(card!.source).toBe("AI answers");
    // No vendor name anywhere on the card.
    const text = JSON.stringify(card);
    expect(text).not.toMatch(/profound/i);
    const labels = Object.fromEntries(card!.stats.map((s) => [s.label, s.value]));
    expect(labels["AI recommended you"]).toBe("19");
  });
});

describe("buildSourceStatCards — ordering (search-first, AEO one-among-equals)", () => {
  it("orders cards GSC → GA4 → SEMrush → Clarity → AEO", () => {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 1,
      impressions90d: 100,
      avgPosition90d: 5,
      ctr90d: 0.01,
    });
    inputs.ga4 = new Map([["a", ga4Value({ sessions28d: 100, engaged28d: 60 })]]);
    inputs.semrush = new Map([
      ["a", semrushSignal({ keywords: [{ keyword: "k", position: 5, volume: 100, difficulty: null, intent: null }] })],
    ]);
    inputs.clarity = new Map([["a", claritySignal({ sessions: 100, rageClicks: 1, deadClicks: 1 })]]);
    inputs.aeo = { date: "2026-06-14", isFallback: false, totalCitations: 5, totalMentions: 2, platformRowCount: 2 };
    const keys = buildSourceStatCards(inputs).map((c) => c.key);
    expect(keys).toEqual(["gsc", "ga4", "semrush", "clarity", "aeo"]);
  });
});

describe("buildSourceStatCards — Iranopedia ground-truth shape", () => {
  it("shows GSC + Clarity, hides GA4/SEMrush/AEO (matches verified per-tenant data)", () => {
    const inputs = emptyInputs();
    // GSC rich — Iranopedia ground truth from gsc_daily_totals (90d):
    // ~10,858 clicks / ~702,598 impressions.
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 10_858,
      impressions90d: 702_598,
      avgPosition90d: 8,
      ctr90d: 10_858 / 702_598,
    });
    // GA4 connected-but-empty → empty Map
    inputs.ga4 = new Map();
    // SEMrush not connected → empty Map
    inputs.semrush = new Map();
    // Clarity one day deep
    inputs.clarity = new Map([
      ["a", claritySignal({ sessions: 214, rageClicks: 1, deadClicks: 63 })],
    ]);
    // AEO derived rollup empty (crons off) → null
    inputs.aeo = null;
    const keys = buildSourceStatCards(inputs, false).map((c) => c.key);
    expect(keys).toEqual(["gsc", "clarity"]);
  });
});
