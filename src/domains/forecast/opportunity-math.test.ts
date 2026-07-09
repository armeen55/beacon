import { describe, expect, it } from "vitest";
import {
  computeOpportunity,
  computeOpportunityFromGap,
  conservativePlanningEstimate,
  type OpportunityInput,
} from "./opportunity-math";
import { forecastRange, ctrOpportunity90d } from "@/domains/experiments/pick-expectations";

/**
 * operator spec 2026-07-09 E-40: conservativePlanningEstimate is the low-weighted
 * midpoint (35% of the way from low to high) a plan can actually be built around,
 * distinct from the true midpoint (50%).
 */
describe("conservativePlanningEstimate (E-40)", () => {
  it("weights 35% of the way from low to high, not the true midpoint", () => {
    expect(conservativePlanningEstimate(20, 60)).toBe(34); // 20 + 40*0.35 = 34
    expect(conservativePlanningEstimate(0, 100)).toBe(35);
  });

  it("returns the shared value when low equals high", () => {
    expect(conservativePlanningEstimate(10, 10)).toBe(10);
  });

  it("rounds to the nearest whole number", () => {
    expect(conservativePlanningEstimate(1, 2)).toBe(1); // 1 + 1*0.35 = 1.35 -> 1
    expect(conservativePlanningEstimate(1, 8)).toBe(3); // 1 + 7*0.35 = 3.45 -> 3
  });
});

const base: OpportunityInput = {
  tenantId: "t",
  page: "https://s.com/p",
  lever: "meta",
};

describe("computeOpportunity — honest-gap path (D7)", () => {
  it("returns a null range + honest basis when position is missing", () => {
    const f = computeOpportunity({ ...base, impressions90d: 5000, clicks90d: 10 });
    expect(f.lowPerMonth).toBeNull();
    expect(f.highPerMonth).toBeNull();
    expect(f.unsized).toBe(true);
    // FP2 - a mapped lever (meta) names the concrete noun instead of the fully generic line.
    expect(f.basis).toContain("I do not have Search Console impressions or a rank for this page yet");
  });

  it("returns a null range + honest basis when impressions are missing/zero", () => {
    const f = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 0 });
    expect(f.lowPerMonth).toBeNull();
    expect(f.unsized).toBe(true);
    expect(f.basis).toContain("I do not have Search Console impressions or a rank for this page yet");
  });

  it("falls back to the fully generic line for an unmapped lever", () => {
    const f = computeOpportunity({ ...base, lever: "totally_unknown_lever", impressions90d: 5000, clicks90d: 10 });
    expect(f.basis).toContain("I do not have enough history to size this yet");
  });

  it("names a not-yet-created page distinctly from an existing page with no data", () => {
    const f = computeOpportunity({ ...base, lever: "create_page" });
    expect(f.basis).toContain("This page does not exist yet");
  });

  it("never fabricates a range for NaN/negative impressions", () => {
    const f = computeOpportunity({ ...base, currentPosition: 8, impressions90d: NaN });
    expect(f.lowPerMonth).toBeNull();
  });

  it("always returns a days figure even when the range is null (caller still knows when to check back)", () => {
    const f = computeOpportunity({ ...base, lever: "create_page" });
    expect(f.days).toBe(28);
  });

  it("still returns an id even in the honest-gap path (a caller can log the absence too)", () => {
    const f = computeOpportunity(base);
    expect(f.hypothesisId).toBeTruthy();
  });
});

describe("computeOpportunity — the range matches the SAME CTR-curve math as pick-expectations.ts", () => {
  it("matches forecastRange(ctrOpportunity90d(...)) exactly for a real position/impressions input", () => {
    const input = { position: 8, ctr: 100 / 5000, impressions90d: 5000 };
    const gap = ctrOpportunity90d(input);
    const expected = forecastRange(gap)!;
    const f = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100 });
    expect(f.lowPerMonth).toBe(expected.low);
    expect(f.highPerMonth).toBe(expected.high);
  });

  it("a page already earning its curve share (small/no gap) reads honestly, not a fabricated range", () => {
    // Position 1 with a high CTR already exceeds the curve's own expectation -> no positive gap.
    const f = computeOpportunity({ ...base, currentPosition: 1, impressions90d: 1000, clicks90d: 500 });
    expect(f.lowPerMonth).toBeNull();
    expect(f.unsized).toBe(true);
    // FP2 - a real position is known, so the sentence names it instead of the generic gap line.
    expect(f.basis).toContain("already earns close to what its position typically gets");
  });
});

describe("computeOpportunity — correction factor + capture band composition (items 27/64)", () => {
  it("a below-1 correction factor shrinks the range, matching forecastRange directly", () => {
    const uncorrected = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100 });
    const corrected = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100, correctionFactor: 0.8 });
    expect(corrected.lowPerMonth!).toBeLessThanOrEqual(uncorrected.lowPerMonth!);
    expect(corrected.highPerMonth!).toBeLessThanOrEqual(uncorrected.highPerMonth!);
  });

  it("an empirical capture band shifts the range vs the static 25/75 default", () => {
    const withDefault = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 50000, clicks90d: 1000 });
    const withBand = computeOpportunity({
      ...base,
      currentPosition: 8,
      impressions90d: 50000,
      clicks90d: 1000,
      captureBand: { low: 0.4, high: 0.9, n: 20, isEmpirical: true },
    });
    expect(withBand.lowPerMonth!).toBeGreaterThan(withDefault.lowPerMonth!);
    expect(withBand.highPerMonth!).toBeGreaterThan(withDefault.highPerMonth!);
  });
});

describe("computeOpportunity — lever name coverage (never 'a change change')", () => {
  it("never doubles the word 'change' for an unmapped lever", () => {
    const f = computeOpportunity({ ...base, lever: "totally_unknown_lever", currentPosition: 8, impressions90d: 5000, clicks90d: 100 });
    expect(f.basis).not.toContain("change change");
  });

  it("names the plain lever for both the ExperimentLever and ActionType vocabularies", () => {
    for (const lever of ["title", "edit_title", "meta", "edit_meta", "answer_block", "add_answer_block"]) {
      const f = computeOpportunity({ ...base, lever, currentPosition: 8, impressions90d: 5000, clicks90d: 100 });
      expect(f.basis).not.toContain("change change");
      expect(f.basis).toContain(" change ");
    }
  });
});

describe("computeOpportunity — the basis sentence names real evidence", () => {
  it("names the position and the days-to-impact when a range exists", () => {
    const f = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100 });
    expect(f.basis).toContain("Based on your own click rates at each Google position");
    expect(f.basis).toContain("position 8");
    expect(f.basis).toContain(`within ${f.days} days`);
  });

  it("names a target position when it is better than current", () => {
    const f = computeOpportunity({ ...base, currentPosition: 8, targetPosition: 3, impressions90d: 5000, clicks90d: 100 });
    expect(f.basis).toContain("from position 8 to 3");
  });

  it("names the settled-results count when provided", () => {
    const f = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100, settledResultsCount: 9 });
    expect(f.basis).toContain("9 settled results");
  });

  it("omits the settled-results clause when zero/omitted", () => {
    const f = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100 });
    expect(f.basis).not.toContain("settled result");
  });

  it("names the conservative planning estimate alongside the range (E-40)", () => {
    const f = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100 });
    expect(f.basis).toContain("I plan around");
    expect(f.basis).toContain(`I plan around ${conservativePlanningEstimate(f.lowPerMonth!, f.highPerMonth!)}.`);
  });

  it("never emits an em or en dash anywhere in the basis sentence (dash guard)", () => {
    const cases = [
      computeOpportunity(base),
      computeOpportunity({ ...base, currentPosition: 1, impressions90d: 1000, clicks90d: 500 }),
      computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100, settledResultsCount: 9 }),
    ];
    for (const f of cases) expect(f.basis).not.toMatch(/[–—]/);
  });
});

describe("computeOpportunity — time-to-impact defaults + measured override", () => {
  it("text levers default to 14 days", () => {
    for (const lever of ["meta", "title", "h1", "internal_link", "answer_block"]) {
      expect(computeOpportunity({ ...base, lever }).days).toBe(14);
    }
  });

  it("structural levers default to 28 days", () => {
    for (const lever of ["fix_experience", "create_page", "add_schema"]) {
      expect(computeOpportunity({ ...base, lever }).days).toBe(28);
    }
  });

  it("an unknown lever defaults to 28 (conservative)", () => {
    expect(computeOpportunity({ ...base, lever: "mystery_lever" }).days).toBe(28);
  });

  it("a measured time-to-signal overrides the lever default", () => {
    const f = computeOpportunity({ ...base, lever: "meta", measuredDaysToImpact: 21 });
    expect(f.days).toBe(21);
  });

  it("ignores a non-positive/non-finite measured override (falls back to the lever default)", () => {
    expect(computeOpportunity({ ...base, lever: "meta", measuredDaysToImpact: 0 }).days).toBe(14);
    expect(computeOpportunity({ ...base, lever: "meta", measuredDaysToImpact: -5 }).days).toBe(14);
    expect(computeOpportunity({ ...base, lever: "meta", measuredDaysToImpact: NaN }).days).toBe(14);
  });
});

describe("hypothesisId — deterministic + stable", () => {
  it("is the SAME id for the same tenant/page/lever on the same day, regardless of other inputs", () => {
    const a = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100 });
    const b = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100, correctionFactor: 1.2 });
    expect(a.hypothesisId).toBe(b.hypothesisId);
  });

  it("differs across pages, levers, or tenants", () => {
    const a = computeOpportunity(base);
    const diffPage = computeOpportunity({ ...base, page: "https://s.com/other" });
    const diffLever = computeOpportunity({ ...base, lever: "title" });
    const diffTenant = computeOpportunity({ ...base, tenantId: "t2" });
    const ids = new Set([a.hypothesisId, diffPage.hypothesisId, diffLever.hypothesisId, diffTenant.hypothesisId]);
    expect(ids.size).toBe(4);
  });
});

describe("computeOpportunityFromGap — legacy pre-computed-gap entry point matches forecastRange exactly", () => {
  it("byte-identical range to a direct forecastRange call for the same gap", () => {
    const gap = 240;
    const expected = forecastRange(gap)!;
    const f = computeOpportunityFromGap(base, gap);
    expect(f.lowPerMonth).toBe(expected.low);
    expect(f.highPerMonth).toBe(expected.high);
  });

  it("honest null when the gap is too small, same floor as forecastRange", () => {
    const f = computeOpportunityFromGap(base, 2);
    expect(f.lowPerMonth).toBeNull();
    expect(f.unsized).toBe(true);
    // FP2 - no position was supplied, so this reads the no-position variant of the honest line.
    expect(f.basis).toContain("Worth doing for coverage");
  });

  it("honest null for a zero/absent gap (never a fabricated range)", () => {
    expect(computeOpportunityFromGap(base, 0).lowPerMonth).toBeNull();
    expect(computeOpportunityFromGap(base, NaN).lowPerMonth).toBeNull();
  });

  it("omits the position clause entirely when no position is supplied", () => {
    const f = computeOpportunityFromGap(base, 240);
    expect(f.basis).not.toContain(" at position ");
    expect(f.basis).not.toContain(" from position ");
    expect(f.basis).toContain("Based on your own click rates at each Google position");
  });

  it("includes the position clause when a position is supplied", () => {
    const f = computeOpportunityFromGap(base, 240, 6);
    expect(f.basis).toContain("at position 6");
  });
});

describe("computeOpportunity — FP2 (2026-07-02) varied honest fallback, never one stamped sentence", () => {
  it("unsized is true for every null-range case and false for every sized case", () => {
    expect(computeOpportunity(base).unsized).toBe(true);
    expect(computeOpportunity({ ...base, currentPosition: 1, impressions90d: 1000, clicks90d: 500 }).unsized).toBe(true);
    expect(computeOpportunity({ ...base, currentPosition: 8, impressions90d: 5000, clicks90d: 100 }).unsized).toBe(false);
  });

  it("the no-history fallback varies by lever instead of stamping the same sentence", () => {
    const meta = computeOpportunity({ ...base, lever: "meta" });
    const link = computeOpportunity({ ...base, lever: "internal_link" });
    const createPage = computeOpportunity({ ...base, lever: "create_page" });
    expect(meta.basis).not.toBe(link.basis);
    expect(meta.basis).not.toBe(createPage.basis);
    expect(meta.basis).toContain("the meta description");
    expect(link.basis).toContain("internal linking");
  });

  it("the too-small-gap fallback varies by whether a position is known, never one templated line", () => {
    const noPosition = computeOpportunityFromGap({ ...base, lever: "meta" }, 2);
    const withPosition = computeOpportunityFromGap({ ...base, lever: "meta" }, 2, 4);
    expect(noPosition.basis).not.toBe(withPosition.basis);
    expect(withPosition.basis).toContain("position");
    expect(noPosition.basis).not.toContain("position");
  });

  it("the too-small-gap fallback names settled history when present, without inventing a number", () => {
    const f = computeOpportunityFromGap({ ...base, lever: "meta", settledResultsCount: 5 }, 2);
    expect(f.basis).toContain("5 settled results");
    expect(f.lowPerMonth).toBeNull();
  });

  it("every honest fallback still reads as one short sentence set, never an em/en dash", () => {
    const cases = [
      computeOpportunity({ ...base, lever: "meta" }),
      computeOpportunity({ ...base, lever: "internal_link" }),
      computeOpportunity({ ...base, lever: "create_page" }),
      computeOpportunity({ ...base, lever: "totally_unknown" }),
      computeOpportunityFromGap({ ...base, lever: "meta" }, 2),
      computeOpportunityFromGap({ ...base, lever: "meta" }, 2, 4),
    ];
    for (const f of cases) {
      expect(f.basis).not.toMatch(/[–—]/);
      expect(f.unsized).toBe(true);
    }
  });
});
