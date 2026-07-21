/**
 * ctr-curve-consolidation (R9 / P3) - one test per consumer proving every place
 * a CTR-by-position assumption used to live now reads the ONE canonical module
 * (tenant-ctr-curve.ts), and that the default path stays byte-identical to the
 * constants each consumer carried before R9.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CTR_BY_POSITION,
  SEMRUSH_TOP5_CTR,
  defaultCtrCurve,
  defaultExpectedCtrAt,
  type TenantCtrCurve,
} from "./tenant-ctr-curve";
import { computeOpportunity } from "./opportunity-math";
import {
  ctrOpportunity90d,
  expectedCtrAt,
  forecastRange,
} from "@/domains/experiments/pick-expectations";
import { scoreCandidate, type DailyCandidate } from "@/domains/experiments/daily-experiment-planner";
import {
  EXPECTED_CTR_BY_POSITION as SURGEON_TABLE,
  expectedCtrForPosition,
} from "@/domains/recommendation-intelligence/page-surgeon/expected-ctr";
import { pickHeadlineQuery } from "@/domains/recommendation-intelligence/evidence-summary";
import {
  BASE_TITLE_SIGNAL_WEIGHTS,
  buildTitleVariants,
  scoreTitle,
} from "@/domains/demand-graph/ctr-title-scorer";

/** A deliberately unrealistic tenant curve so any consumer reading it is unmistakable. */
const tenantCurve: TenantCtrCurve = {
  expectedCtrAt: (p) => (Math.round(p) <= 10 ? 0.5 : 0.1),
  source: "tenant",
  basis: "your own search data (12 queries, 3,400 impressions)",
  fittedAt: "2026-07-03T00:00:00.000Z",
  queries: 12,
  impressions: 3400,
};

describe("pick-expectations (forecast spine) reads the canonical module", () => {
  it("expectedCtrAt with no curve is byte-identical to the canonical default at every position", () => {
    for (let p = -1; p <= 30; p++) expect(expectedCtrAt(p)).toBe(defaultExpectedCtrAt(p));
    expect(expectedCtrAt(7.6)).toBe(defaultExpectedCtrAt(7.6));
  });

  it("expectedCtrAt honors a tenant-fitted curve when one is passed", () => {
    expect(expectedCtrAt(8, tenantCurve)).toBe(0.5);
    expect(expectedCtrAt(14, tenantCurve)).toBe(0.1);
  });

  it("ctrOpportunity90d sizes the gap from the passed curve", () => {
    const input = { position: 8, ctr: 0.02, impressions90d: 1000 };
    expect(ctrOpportunity90d(input)).toBeCloseTo((0.034 - 0.02) * 1000, 10);
    expect(ctrOpportunity90d(input, tenantCurve)).toBeCloseTo((0.5 - 0.02) * 1000, 10);
  });
});

describe("daily-experiment-planner (nightly scoring) reads the canonical module", () => {
  const base: DailyCandidate = {
    url: "/x",
    actionFamily: "title",
    targetQuery: "q",
    impressions: 1000,
    position: 6,
    ctr: defaultExpectedCtrAt(6), // exactly the curve expectation -> weakCtr factor is 1
    ownership: 0.5,
    ctrOpportunityClicks: 300,
    effortMinutes: 5,
  };

  it("scores exactly the hand-computed formula seeded with the canonical curve value", () => {
    // positionFactor 1 (pos 6), mediumFactor 1 (1000 impressions), weakCtr 1
    // (ctr equals the canonical expectation), ownershipFactor 1 -> 300 * (1 / 1.5).
    expect(scoreCandidate(base)).toBeCloseTo(300 / 1.5, 10);
  });

  it("the tail band comes from the canonical curve too (position 13)", () => {
    const tail: DailyCandidate = { ...base, position: 13, ctr: defaultExpectedCtrAt(13) };
    // positionFactor 0.5 past position 12; weakCtr still exactly 1.
    expect(scoreCandidate(tail)).toBeCloseTo((300 * 0.5) / 1.5, 10);
  });
});

// (2026-07-21) The gsc-low-ctr trigger died with the trigger->promotion
// pipeline; evidence-summary remains the consumer under pin here.
describe("evidence-summary reads the canonical benchmark", () => {
  it("evidence-summary flags a low-CTR headline query against the canonical benchmark", () => {
    const signal = {
      page: "https://s.com/p",
      clicks90d: 9,
      impressions90d: 1000,
      ctr90d: 0.009,
      position90d: 3,
      topQueries: [
        { query: "persian flags", clicks: 9, impressions: 300, ctr: 0.03, position: 3 },
      ],
    };
    const pick = pickHeadlineQuery(signal);
    expect(pick?.kind).toBe("low_ctr"); // 0.03 under the canonical 0.102 at position 3
  });

  it("a query already beating the canonical benchmark is never called a shortfall", () => {
    const signal = {
      page: "https://s.com/p",
      clicks90d: 60,
      impressions90d: 1000,
      ctr90d: 0.06,
      topQueries: [
        { query: "persian flags", clicks: 60, impressions: 300, ctr: 0.2, position: 3 },
      ],
      position90d: 3,
    };
    expect(pickHeadlineQuery(signal)).toBeNull(); // above benchmark, and pos 3 is outside the striking band
  });
});

describe("page-surgeon expected-ctr reads the canonical module", () => {
  it("expectedCtrForPosition matches the canonical default at every position (one curve, no drift)", () => {
    for (let p = 1; p <= 30; p++) expect(expectedCtrForPosition(p)).toBe(defaultExpectedCtrAt(p));
    expect(expectedCtrForPosition(0)).toBe(defaultExpectedCtrAt(1));
    expect(expectedCtrForPosition(NaN)).toBe(defaultExpectedCtrAt(1));
  });

  it("the re-exported table IS the canonical default table (same object)", () => {
    expect(SURGEON_TABLE).toBe(DEFAULT_CTR_BY_POSITION);
  });

  it("honors a tenant-fitted curve when threaded", () => {
    expect(expectedCtrForPosition(5, tenantCurve)).toBe(0.5);
  });
});

describe("opportunity-math sizes and NAMES the tenant curve", () => {
  const input = {
    tenantId: "t",
    page: "https://s.com/p",
    lever: "title",
    currentPosition: 8,
    impressions90d: 5000,
    clicks90d: 100,
  };

  it("without a curve: byte-identical to the default forecastRange math and the default sentence", () => {
    const gap = ctrOpportunity90d({ position: 8, ctr: 100 / 5000, impressions90d: 5000 });
    const expected = forecastRange(gap)!;
    const f = computeOpportunity(input);
    expect(f.lowPerMonth).toBe(expected.low);
    expect(f.highPerMonth).toBe(expected.high);
    expect(f.basis).toContain("Based on your own click rates at each Google position");
    expect(f.basis).not.toContain("convert position to clicks");
  });

  it("a DEFAULT-source curve (fit fell back) keeps the default sentence - never a false 'your own data' claim", () => {
    const f = computeOpportunity({ ...input, curve: defaultCtrCurve() });
    const plain = computeOpportunity(input);
    expect(f.lowPerMonth).toBe(plain.lowPerMonth);
    expect(f.highPerMonth).toBe(plain.highPerMonth);
    expect(f.basis).toBe(plain.basis);
  });

  it("a TENANT-fitted curve sizes the gap from the curve AND the copy names the basis in plain words", () => {
    const f = computeOpportunity({ ...input, curve: tenantCurve });
    const gap = ctrOpportunity90d({ position: 8, ctr: 100 / 5000, impressions90d: 5000 }, tenantCurve);
    const expected = forecastRange(gap)!;
    expect(f.lowPerMonth).toBe(expected.low);
    expect(f.highPerMonth).toBe(expected.high);
    expect(f.basis).toContain("Based on how your own pages convert position to clicks");
    expect(f.basis).toContain("your own search data (12 queries, 3,400 impressions)");
    expect(f.basis).not.toMatch(/[–—]/);
    // no lab words on the surface
    expect(f.basis.toLowerCase()).not.toContain("ctr");
    expect(f.basis.toLowerCase()).not.toContain("curve");
  });
});

describe("ctr-title-scorer (CTR Title Lab) - retrainable weights, byte-identical default", () => {
  it("scoreTitle with no weights equals scoreTitle with the base constants", () => {
    const title = "10 Best Persian Cat Names (With Meanings)";
    expect(scoreTitle(title, "persian cat names", "Iranopedia")).toEqual(
      scoreTitle(title, "persian cat names", "Iranopedia", BASE_TITLE_SIGNAL_WEIGHTS),
    );
  });

  it("buildTitleVariants default ranking is byte-identical with and without explicit base weights", () => {
    expect(buildTitleVariants("best persian cat names", "Iranopedia")).toEqual(
      buildTitleVariants("best persian cat names", "Iranopedia", undefined, BASE_TITLE_SIGNAL_WEIGHTS),
    );
  });

  it("the base constants are the exact pre-R9 inline literals", () => {
    expect(BASE_TITLE_SIGNAL_WEIGHTS).toEqual({ number: 12, parenthetical: 8, powerWord: 6, brand: 5, lengthSweet: 6 });
  });
});
