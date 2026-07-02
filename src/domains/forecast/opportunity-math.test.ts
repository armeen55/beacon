import { describe, expect, it } from "vitest";
import { computeOpportunity, computeOpportunityFromGap, type OpportunityInput } from "./opportunity-math";
import { forecastRange, ctrOpportunity90d } from "@/domains/experiments/pick-expectations";

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
    expect(f.basis).toContain("I do not have enough history to size this yet");
  });

  it("returns a null range + honest basis when impressions are missing/zero", () => {
    const f = computeOpportunity({ ...base, currentPosition: 8, impressions90d: 0 });
    expect(f.lowPerMonth).toBeNull();
    expect(f.basis).toContain("I do not have enough history to size this yet");
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
    expect(f.basis).toContain("too small to size honestly");
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
    expect(f.basis).toContain("too small to size honestly");
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
