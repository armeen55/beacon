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

function emptyInputs(): AllSourceStatInputs {
  return {
    gscSiteTotals: null,
    ga4: new Map(),
    clarity: new Map(),
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
    expect(labels["Times shown on Google"]).toBe("10K");
    // impressions-weighted position from the loader
    expect(labels["Average Google rank"]).toBe("9.5");
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

describe("buildSourceStatCards — per-page click-loss decomposition (#topDeclines)", () => {
  function decay(
    page: string,
    clicksNow: number,
    clicksPrior: number,
  ): [string, import("@/domains/recommendation-intelligence/gsc-page-signals").GscDecaySignal] {
    return [
      page,
      {
        page,
        clicksNow,
        clicksPrior,
        positionNow: 5,
        positionPrior: 4,
        impressionsNow: 1000,
        impressionsPrior: 1200,
      },
    ];
  }

  function gscInputsWithDecay(): AllSourceStatInputs {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 1000,
      impressions90d: 50_000,
      avgPosition90d: 6,
      ctr90d: 0.02,
      clicks28d: 300,
      clicksPrev28d: 500,
    });
    return inputs;
  }

  it("names the top pages losing clicks, sorted by clicks lost, capped at 3", () => {
    const inputs = gscInputsWithDecay();
    inputs.gscDecay = new Map([
      decay("https://x.com/big-drop", 100, 700), // lost 600, -86%
      decay("https://x.com/mid-drop", 40, 140), //  lost 100, -71%
      decay("https://x.com/small-drop", 20, 60), // lost 40,  -67%
      decay("https://x.com/tiny", 18, 22), //       lost 4,   -18% (below 20% floor)
      decay("https://x.com/grew", 90, 40), //       grew — excluded
    ]);
    const card = buildSourceStatCards(inputs).find((c) => c.key === "gsc");
    expect(card!.topDeclines).toHaveLength(3);
    expect(card!.topDeclines![0]).toEqual({ path: "/big-drop", dropPct: 86 });
    expect(card!.topDeclines![1].path).toBe("/mid-drop");
    expect(card!.topDeclines!.map((d) => d.path)).not.toContain("/grew");
    expect(card!.topDeclines!.map((d) => d.path)).not.toContain("/tiny");
  });

  it("excludes pages with too few prior clicks (noise floor)", () => {
    const inputs = gscInputsWithDecay();
    inputs.gscDecay = new Map([
      decay("https://x.com/noise", 0, 3), // prior < 5 → excluded even at -100%
    ]);
    const card = buildSourceStatCards(inputs).find((c) => c.key === "gsc");
    expect(card!.topDeclines ?? null).toBeNull();
  });

  it("topDeclines is null when no decay map is supplied", () => {
    const inputs = gscInputsWithDecay();
    const card = buildSourceStatCards(inputs).find((c) => c.key === "gsc");
    expect(card!.topDeclines ?? null).toBeNull();
  });

  it("buildFixFirstPages — only pages in BOTH the decline + friction sets, ranked by combined severity", async () => {
    const { buildFixFirstPages } = await import(
      "@/domains/today-summary/build-source-stat-cards"
    );
    const decayMap = new Map([
      decay("https://x.com/both-bad", 30, 100), // -70% drop
      decay("https://x.com/decline-only", 60, 100), // -40% drop, no friction
      decay("https://x.com/mild-both", 80, 100), // -20% drop
    ]);
    const clarityMap = new Map([
      ["https://x.com/both-bad", claritySignal({ url: "https://x.com/both-bad", sessions: 100, deadClicks: 50, rageClicks: 0 })], // 50% friction
      ["https://x.com/mild-both", claritySignal({ url: "https://x.com/mild-both", sessions: 100, deadClicks: 15, rageClicks: 0 })], // 15% friction
      ["https://x.com/friction-only", claritySignal({ url: "https://x.com/friction-only", sessions: 100, deadClicks: 40, rageClicks: 0 })], // friction, no decline
    ]);
    const fixFirst = buildFixFirstPages(decayMap, clarityMap);
    expect(fixFirst).not.toBeNull();
    // Only the two pages in BOTH sets, worst combined first.
    expect(fixFirst!.map((p) => p.path)).toEqual(["/both-bad", "/mild-both"]);
    expect(fixFirst![0]).toEqual({ path: "/both-bad", dropPct: 70, frictionPerVisit: 0.5 });
    // decline-only + friction-only are excluded.
    expect(fixFirst!.map((p) => p.path)).not.toContain("/decline-only");
    expect(fixFirst!.map((p) => p.path)).not.toContain("/friction-only");
  });

  it("Clarity card names the most-frustrating pages, ranked by combined rate", () => {
    const inputs = emptyInputs();
    inputs.clarity = new Map([
      // 50% combined friction (40 dead + 10 rage over 100 sessions)
      ["https://x.com/worst", claritySignal({ url: "https://x.com/worst", sessions: 100, deadClicks: 40, rageClicks: 10 })],
      // 20% combined
      ["https://x.com/mid", claritySignal({ url: "https://x.com/mid", sessions: 100, deadClicks: 15, rageClicks: 5 })],
      // below the 10-session floor → excluded even at 100%
      ["https://x.com/noise", claritySignal({ url: "https://x.com/noise", sessions: 4, deadClicks: 4, rageClicks: 0 })],
      // below the 10% rate floor → excluded
      ["https://x.com/clean", claritySignal({ url: "https://x.com/clean", sessions: 200, deadClicks: 4, rageClicks: 0 })],
    ]);
    const card = buildSourceStatCards(inputs).find((c) => c.key === "clarity");
    expect(card!.topFriction).not.toBeNull();
    expect(card!.topFriction![0]).toEqual({ path: "/worst", perVisit: 0.5 });
    expect(card!.topFriction!.map((f) => f.path)).toEqual(["/worst", "/mid"]);
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
    expect(labels["Clicks that did nothing"]).toBe("29.4%");
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

describe("buildSourceStatCards — AEO present", () => {
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
  it("orders cards GSC → GA4 → Clarity → AEO", () => {
    const inputs = emptyInputs();
    inputs.gscSiteTotals = gscTotals({
      clicks90d: 1,
      impressions90d: 100,
      avgPosition90d: 5,
      ctr90d: 0.01,
    });
    inputs.ga4 = new Map([["a", ga4Value({ sessions28d: 100, engaged28d: 60 })]]);
    inputs.clarity = new Map([["a", claritySignal({ sessions: 100, rageClicks: 1, deadClicks: 1 })]]);
    inputs.aeo = { date: "2026-06-14", isFallback: false, totalCitations: 5, totalMentions: 2, platformRowCount: 2 };
    const keys = buildSourceStatCards(inputs).map((c) => c.key);
    expect(keys).toEqual(["gsc", "ga4", "clarity", "aeo"]);
  });
});

describe("buildSourceStatCards — Iranopedia ground-truth shape", () => {
  it("shows GSC + Clarity, hides GA4/AEO (matches verified per-tenant data)", () => {
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
