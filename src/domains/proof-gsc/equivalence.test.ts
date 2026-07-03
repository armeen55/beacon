import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeEquivalence,
  EQUIVALENCE_MAX_LIFT_FRACTION,
  EQUIVALENCE_MAX_CLICKS_PER_MONTH,
} from "./equivalence";

/**
 * equivalence.test.ts (P4 R10b, v1 item 289) - pins the proven-neutral band:
 * BOTH caps must hold (under 5 percent of baseline monthly clicks AND under
 * 10 clicks a month), strict boundaries, the small-sample and zero-baseline
 * honest nulls, and the exact honest-close sentence.
 */

function read(over: Partial<Parameters<typeof computeEquivalence>[0]> = {}) {
  return computeEquivalence({
    ci90Low: -2,
    ci90High: 3,
    smallSample: false,
    baselineMonthlyClicks: 400,
    ...over,
  });
}

describe("computeEquivalence - the too-small-to-matter band", () => {
  it("bounds entirely inside both caps prove neutral with the honest close", () => {
    // baseline 400/month -> percent cap 20, absolute cap 10 -> band 10.
    const r = read({ ci90Low: -6, ci90High: 4 });
    expect(r?.provenNeutral).toBe(true);
    expect(r?.bandClicksPerMonth).toBe(10);
    expect(r?.sentence).toBe(
      "This change genuinely did nothing, and I can prove that now; that is different from not knowing. The plausible effect sits between 6 fewer and 4 extra clicks a month, too small to matter either way.",
    );
  });

  it("phrases an all-positive and an all-negative range without a raw minus sign", () => {
    expect(read({ ci90Low: 1, ci90High: 4 })?.sentence).toContain("between 1 and 4 extra clicks a month");
    expect(read({ ci90Low: -7, ci90High: -2 })?.sentence).toContain("between 2 and 7 fewer clicks a month");
  });

  it("the band is the SMALLER cap: a small page's 5 percent beats the 10-click cap", () => {
    // baseline 100/month -> percent cap 5, absolute cap 10 -> band 5.
    const inside = read({ baselineMonthlyClicks: 100, ci90Low: -4.9, ci90High: 4.9 });
    expect(inside?.bandClicksPerMonth).toBe(5);
    expect(inside?.provenNeutral).toBe(true);
    const breachesPct = read({ baselineMonthlyClicks: 100, ci90Low: -5.1, ci90High: 3 });
    expect(breachesPct?.provenNeutral).toBe(false);
    expect(breachesPct?.sentence).toBeNull();
  });

  it("the band is the SMALLER cap: a big page's 10-click cap beats its 5 percent", () => {
    // baseline 1000/month -> percent cap 50, absolute cap 10 -> band 10.
    expect(read({ baselineMonthlyClicks: 1000, ci90Low: -9.9, ci90High: 9.9 })?.provenNeutral).toBe(true);
    expect(read({ baselineMonthlyClicks: 1000, ci90Low: -10.5, ci90High: 2 })?.provenNeutral).toBe(false);
  });

  it("the boundary is strict: a bound sitting exactly ON the band is not proven", () => {
    expect(read({ baselineMonthlyClicks: 400, ci90Low: -10, ci90High: 3 })?.provenNeutral).toBe(false);
    expect(read({ baselineMonthlyClicks: 400, ci90Low: -3, ci90High: 10 })?.provenNeutral).toBe(false);
  });

  it("EITHER end breaching the band breaks the proof, not just the wider one", () => {
    expect(read({ ci90Low: -12, ci90High: 1 })?.provenNeutral).toBe(false);
    expect(read({ ci90Low: -1, ci90High: 12 })?.provenNeutral).toBe(false);
  });

  it("normalizes a swapped low/high pair instead of misreading it", () => {
    const r = read({ ci90Low: 4, ci90High: -6 });
    expect(r?.provenNeutral).toBe(true);
    expect(r?.ci90Low).toBe(-6);
    expect(r?.ci90High).toBe(4);
  });
});

describe("computeEquivalence - honest absence", () => {
  it("a small sample can never PROVE neutrality, however narrow its interval looks", () => {
    expect(read({ smallSample: true, ci90Low: -0.5, ci90High: 0.5 })).toBeNull();
  });

  it("a page with no baseline clicks has no percent band to prove against", () => {
    expect(read({ baselineMonthlyClicks: 0 })).toBeNull();
    expect(read({ baselineMonthlyClicks: -5 })).toBeNull();
  });

  it("non-finite bounds are a guard null, never NaN math", () => {
    expect(read({ ci90Low: Number.NaN })).toBeNull();
    expect(read({ ci90High: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("the exported caps match the item spec (5 percent AND 10 clicks a month)", () => {
    expect(EQUIVALENCE_MAX_LIFT_FRACTION).toBe(0.05);
    expect(EQUIVALENCE_MAX_CLICKS_PER_MONTH).toBe(10);
  });
});

describe("copy guard - dash-clean, no lab words", () => {
  it("equivalence.ts contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "equivalence.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });

  it("the proven sentence is dash-clean and never says equivalence or interval", () => {
    const r = read({ ci90Low: -6, ci90High: 4 });
    expect(r?.sentence).not.toMatch(/[–—]/);
    expect(r?.sentence?.toLowerCase()).not.toMatch(/equivalence|interval|credible|hypothesis/);
  });
});
