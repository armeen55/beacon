import { describe, it, expect } from "vitest";

import {
  computePortfolioCounterfactual,
  MIN_MATURE_ROWS_FOR_COUNTERFACTUAL,
  type CounterfactualRow,
} from "@/domains/proof-gsc/portfolio-counterfactual";

/**
 * Pure-math matrix for the portfolio counterfactual sentence (BEACON_500
 * item 41). computePortfolioCounterfactual averages the treated-vs-control
 * percent decomposition of each mature row's basis window. No I/O; every
 * case here is deterministic. The maturity/weather/weak-comparison gate
 * itself lives in scoreboard-section.tsx (an I/O edge) and mirrors
 * load-experiment-outcomes.ts - this file only pins the pure aggregator.
 */

function row(over: Partial<CounterfactualRow>): CounterfactualRow {
  return { id: "r1", treatedDelta: 10, controlDelta: 0, scaledBaseline: 100, controlsUsed: 2, ...over };
}

describe("computePortfolioCounterfactual - honest minimum", () => {
  it("returns null below the minimum row count (no cherry-picked portfolio claim)", () => {
    const rows = Array.from({ length: MIN_MATURE_ROWS_FOR_COUNTERFACTUAL - 1 }, (_, i) =>
      row({ id: `r${i}` }),
    );
    expect(computePortfolioCounterfactual(rows)).toBeNull();
  });

  it("returns a result exactly AT the minimum row count", () => {
    const rows = Array.from({ length: MIN_MATURE_ROWS_FOR_COUNTERFACTUAL }, (_, i) => row({ id: `r${i}` }));
    expect(computePortfolioCounterfactual(rows)).not.toBeNull();
  });

  it("returns null on zero rows", () => {
    expect(computePortfolioCounterfactual([])).toBeNull();
  });

  it("honors a custom minRows override", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })];
    expect(computePortfolioCounterfactual(rows, 2)).not.toBeNull();
    expect(computePortfolioCounterfactual(rows, 3)).toBeNull();
  });
});

describe("computePortfolioCounterfactual - exclusion gates", () => {
  it("excludes rows with zero controlsUsed (no similar pages to compare)", () => {
    const rows = [
      row({ id: "a", controlsUsed: 0 }),
      row({ id: "b", controlsUsed: 2 }),
      row({ id: "c", controlsUsed: 2 }),
      row({ id: "d", controlsUsed: 2 }),
    ];
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.n).toBe(3);
  });

  it("excludes rows with a zero or negative scaledBaseline (no percent to compute)", () => {
    const rows = [
      row({ id: "a", scaledBaseline: 0 }),
      row({ id: "b", scaledBaseline: -5 }),
      row({ id: "c", scaledBaseline: 100 }),
      row({ id: "d", scaledBaseline: 100 }),
      row({ id: "e", scaledBaseline: 100 }),
    ];
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.n).toBe(3);
  });

  it("excludes rows with a non-finite delta", () => {
    const rows = [
      row({ id: "a", treatedDelta: Number.NaN }),
      row({ id: "b" }),
      row({ id: "c" }),
      row({ id: "d" }),
    ];
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.n).toBe(3);
  });

  it("returns null when exclusions drop the pool below the minimum", () => {
    const rows = [
      row({ id: "a", controlsUsed: 0 }),
      row({ id: "b", controlsUsed: 0 }),
      row({ id: "c" }),
      row({ id: "d" }),
    ];
    expect(computePortfolioCounterfactual(rows)).toBeNull();
  });
});

describe("computePortfolioCounterfactual - percent math", () => {
  it("treated up, controls flat: reads a positive treated percent and near-zero control percent", () => {
    const rows = [
      row({ id: "a", treatedDelta: 12, controlDelta: 0, scaledBaseline: 100 }),
      row({ id: "b", treatedDelta: 12, controlDelta: 0, scaledBaseline: 100 }),
      row({ id: "c", treatedDelta: 12, controlDelta: 0, scaledBaseline: 100 }),
    ];
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.treatedPct).toBeCloseTo(0.12, 5);
    expect(r.controlPct).toBeCloseTo(0, 5);
    expect(r.spreadPct).toBeCloseTo(0.12, 5);
    expect(r.sentence).toMatch(/up about 12 percent/);
    expect(r.sentence).toMatch(/held about flat/);
  });

  it("treated up, controls down: names both directions honestly", () => {
    const rows = [
      row({ id: "a", treatedDelta: 12, controlDelta: -3, scaledBaseline: 100 }),
      row({ id: "b", treatedDelta: 12, controlDelta: -3, scaledBaseline: 100 }),
      row({ id: "c", treatedDelta: 12, controlDelta: -3, scaledBaseline: 100 }),
    ];
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.treatedPct).toBeCloseTo(0.12, 5);
    expect(r.controlPct).toBeCloseTo(-0.03, 5);
    expect(r.sentence).toMatch(/up about 12 percent/);
    expect(r.sentence).toMatch(/down about 3 percent/);
  });

  it("treated down, controls up: a real loss reads honestly, not hidden", () => {
    const rows = [
      row({ id: "a", treatedDelta: -8, controlDelta: 4, scaledBaseline: 100 }),
      row({ id: "b", treatedDelta: -8, controlDelta: 4, scaledBaseline: 100 }),
      row({ id: "c", treatedDelta: -8, controlDelta: 4, scaledBaseline: 100 }),
    ];
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.treatedPct).toBeCloseTo(-0.08, 5);
    expect(r.sentence).toMatch(/down about 8 percent/);
    expect(r.sentence).toMatch(/up about 4 percent/);
  });

  it("averages across rows with different baselines and magnitudes (weighted by row, not by clicks)", () => {
    const rows = [
      row({ id: "a", treatedDelta: 20, controlDelta: 0, scaledBaseline: 100 }), // +20%
      row({ id: "b", treatedDelta: 4, controlDelta: 0, scaledBaseline: 40 }), // +10%
      row({ id: "c", treatedDelta: 0, controlDelta: 0, scaledBaseline: 50 }), // 0%
    ];
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.treatedPct).toBeCloseTo((0.2 + 0.1 + 0) / 3, 5);
  });

  it("consistency: spreadPct always equals treatedPct minus controlPct", () => {
    const rows = [
      row({ id: "a", treatedDelta: 15, controlDelta: 5, scaledBaseline: 200 }),
      row({ id: "b", treatedDelta: -3, controlDelta: -10, scaledBaseline: 150 }),
      row({ id: "c", treatedDelta: 7, controlDelta: 2, scaledBaseline: 90 }),
    ];
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.spreadPct).toBeCloseTo(r.treatedPct - r.controlPct, 10);
  });

  it("is deterministic - same inputs, same output every call", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    expect(computePortfolioCounterfactual(rows)).toEqual(computePortfolioCounterfactual(rows));
  });
});

describe("computePortfolioCounterfactual - no em/en dashes anywhere (hard rule)", () => {
  const cases: CounterfactualRow[][] = [
    [row({ id: "a", treatedDelta: 12, controlDelta: -3 }), row({ id: "b", treatedDelta: 12, controlDelta: -3 }), row({ id: "c", treatedDelta: 12, controlDelta: -3 })],
    [row({ id: "a", treatedDelta: -8, controlDelta: 4 }), row({ id: "b", treatedDelta: -8, controlDelta: 4 }), row({ id: "c", treatedDelta: -8, controlDelta: 4 })],
    [row({ id: "a", treatedDelta: 0, controlDelta: 0 }), row({ id: "b", treatedDelta: 0, controlDelta: 0 }), row({ id: "c", treatedDelta: 0, controlDelta: 0 })],
  ];

  for (const [i, rows] of cases.entries()) {
    it(`case ${i} has no em or en dash in the sentence`, () => {
      const r = computePortfolioCounterfactual(rows)!;
      expect(r.sentence).not.toMatch(/[–—]/);
    });
  }
});
