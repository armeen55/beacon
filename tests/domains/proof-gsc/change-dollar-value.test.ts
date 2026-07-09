import { describe, it, expect } from "vitest";

import {
  computeChangeDollarValue,
  toMonthlyRate,
  extraSessionsFromTrafficOutcome,
  shouldShowChangeDollarLine,
  type ChangeRevenueModel,
} from "@/domains/proof-gsc/change-dollar-value";

/**
 * Pure-math matrix for the change-level dollar attribution (BEACON_500 item
 * 22). computeChangeDollarValue multiplies an already-computed traffic/lead
 * delta by the operator's own unit-economics rate. No I/O; every case here is
 * deterministic.
 */

describe("toMonthlyRate", () => {
  it("rolls a 7-day delta up to a 30-day rate", () => {
    expect(toMonthlyRate(14, 7)).toBeCloseTo(60, 5); // 14/7*30
  });

  it("passes a 30-day delta straight through", () => {
    expect(toMonthlyRate(90, 30)).toBeCloseTo(90, 5);
  });

  it("rolls a negative delta up the same way (no floor)", () => {
    expect(toMonthlyRate(-7, 7)).toBeCloseTo(-30, 5);
  });

  it("returns 0 for a zero or invalid window instead of throwing/Infinity", () => {
    expect(toMonthlyRate(10, 0)).toBe(0);
    expect(toMonthlyRate(10, -5)).toBe(0);
    expect(toMonthlyRate(Number.NaN, 7)).toBe(0);
  });
});

describe("extraSessionsFromTrafficOutcome - control-adjusted, not raw pre/post", () => {
  it("applies the adjusted percent lift to the page's own pre-window sessions", () => {
    const extra = extraSessionsFromTrafficOutcome({
      ran: true,
      treated: { sessionsPre: 87 },
      adjustedSessionsPct: 0.147, // ~ +15% control-adjusted
    });
    expect(extra).toBeCloseTo(87 * 0.147, 5);
    expect(extra).toBeGreaterThan(0);
  });

  it("can read POSITIVE even when the page's raw sessions fell, if it fell less than its comparison pages", () => {
    // Real-world case this test exists to catch: treated 87 -> 76 (raw -11,
    // i.e. -12.6%) but comparison pages fell further (-27.6%), so the
    // control-adjusted lift is a genuine +14.7% relative win. The dollar
    // line must track THIS number, not the raw negative delta, or it
    // contradicts the traffic-outcome label shown right above it.
    const extra = extraSessionsFromTrafficOutcome({
      ran: true,
      treated: { sessionsPre: 87 },
      adjustedSessionsPct: 0.14724826953473943,
    });
    expect(extra).toBeGreaterThan(0);
  });

  it("returns 0 when the window has not run yet", () => {
    expect(
      extraSessionsFromTrafficOutcome({ ran: false, treated: { sessionsPre: 100 }, adjustedSessionsPct: 0.5 }),
    ).toBe(0);
  });

  it("returns 0 when there is no adjusted percent (no pre-window data)", () => {
    expect(
      extraSessionsFromTrafficOutcome({ ran: true, treated: { sessionsPre: 0 }, adjustedSessionsPct: null }),
    ).toBe(0);
  });

  it("passes a negative adjusted lift straight through as a negative extra-sessions figure", () => {
    const extra = extraSessionsFromTrafficOutcome({
      ran: true,
      treated: { sessionsPre: 200 },
      adjustedSessionsPct: -0.2,
    });
    expect(extra).toBeCloseTo(-40, 5);
  });
});

describe("computeChangeDollarValue - no revenue model (clicks-only, honest degradation)", () => {
  it("returns null usd and a plain extra-visits sentence when no model is set", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 70, // over the window below
      windowDays: 7,
      keyEventDelta: 0,
      revenueModel: undefined,
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).toContain("extra");
    expect(r.basisSentence).toMatch(/visit/);
    expect(r.basisSentence).not.toMatch(/\$/);
  });

  it("also degrades to clicks-only when revenueModel is explicitly null", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 30,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: null,
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).not.toMatch(/\$/);
  });

  it("names a cost, not an earning, when trafficDelta is negative", () => {
    const r = computeChangeDollarValue({
      trafficDelta: -60,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: undefined,
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).toMatch(/costing you/);
  });

  it("says traffic is not moving enough to size when the delta rounds to 0/month", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 0.1,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: undefined,
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).toMatch(/not moving visits enough/);
  });
});

describe("computeChangeDollarValue - rpm model (content tenants)", () => {
  const rpmModel: ChangeRevenueModel = { kind: "rpm", rpmUsd: 12 };

  it("multiplies the operator's rpm by the monthly extra sessions", () => {
    // 7-day delta of 70 sessions -> 300/month; 300/1000 * 12 = 3.6
    const r = computeChangeDollarValue({
      trafficDelta: 70,
      windowDays: 7,
      keyEventDelta: 0,
      revenueModel: rpmModel,
    });
    expect(r.usdPerMonth).toBeCloseTo(3.6, 5);
    expect(r.basisSentence).toMatch(/\$/);
    expect(r.basisSentence).toMatch(/your rate of \$12/);
    expect(r.basisSentence).toMatch(/worth about/);
  });

  it("states a negative dollar figure plainly when the lift is negative", () => {
    const r = computeChangeDollarValue({
      trafficDelta: -1000, // a full month's worth of lost sessions
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: rpmModel,
    });
    expect(r.usdPerMonth).toBeCloseTo(-12, 5);
    expect(r.basisSentence).toMatch(/costing you about \$12/);
  });

  it("never divides by a bad rpm rate (rate <= 0 degrades to clicks-only)", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 100,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: { kind: "rpm", rpmUsd: 0 },
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).not.toMatch(/\$/);
  });

  it("is deterministic - same inputs, same output, every call", () => {
    const args = { trafficDelta: 42, windowDays: 14, keyEventDelta: 0, revenueModel: rpmModel } as const;
    const a = computeChangeDollarValue(args);
    const b = computeChangeDollarValue(args);
    expect(a).toEqual(b);
  });
});

describe("computeChangeDollarValue - per_lead model (service tenants)", () => {
  const perLeadModel: ChangeRevenueModel = { kind: "per_lead", dollarsPerLead: 45 };

  it("multiplies the operator's per-lead rate by the monthly extra key events", () => {
    // 14-day delta of 2 events -> ~4.2857/month; * 45 ≈ 192.86
    const r = computeChangeDollarValue({
      trafficDelta: 0,
      windowDays: 14,
      keyEventDelta: 2,
      revenueModel: perLeadModel,
    });
    expect(r.usdPerMonth).toBeCloseTo((2 / 14) * 30 * 45, 2);
    expect(r.basisSentence).toMatch(/\$45 per lead/);
  });

  it("negative key-event delta reads as a plain cost", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 0,
      windowDays: 30,
      keyEventDelta: -3,
      revenueModel: perLeadModel,
    });
    expect(r.usdPerMonth).toBeCloseTo(-135, 5);
    expect(r.basisSentence).toMatch(/costing you about \$135/);
  });

  it("never divides by a bad per-lead rate (rate <= 0 degrades to clicks-only)", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 0,
      windowDays: 30,
      keyEventDelta: 5,
      revenueModel: { kind: "per_lead", dollarsPerLead: -10 },
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).not.toMatch(/\$/);
  });
});

describe("computeChangeDollarValue - sparse data / confidence", () => {
  it("reads low confidence on a thin extra-sessions count even with a real rate", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 2, // tiny
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: { kind: "rpm", rpmUsd: 12 },
    });
    expect(r.confidence).toBe("low");
  });

  it("reads high confidence on a large, sustained extra-sessions count", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 500,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: { kind: "rpm", rpmUsd: 12 },
    });
    expect(r.confidence).toBe("high");
  });

  it("reads medium confidence on a moderate extra-sessions count", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 50,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: { kind: "rpm", rpmUsd: 12 },
    });
    expect(r.confidence).toBe("medium");
  });

  it("derives confidence from key events (not sessions) for a per_lead model", () => {
    const low = computeChangeDollarValue({
      trafficDelta: 0,
      windowDays: 30,
      keyEventDelta: 0.5,
      revenueModel: { kind: "per_lead", dollarsPerLead: 45 },
    });
    const high = computeChangeDollarValue({
      trafficDelta: 0,
      windowDays: 30,
      keyEventDelta: 25,
      revenueModel: { kind: "per_lead", dollarsPerLead: 45 },
    });
    expect(low.confidence).toBe("low");
    expect(high.confidence).toBe("high");
  });
});

describe("computeChangeDollarValue - no em/en dashes anywhere (hard rule)", () => {
  const cases: Array<Parameters<typeof computeChangeDollarValue>[0]> = [
    { trafficDelta: 70, windowDays: 7, keyEventDelta: 0, revenueModel: undefined },
    { trafficDelta: -70, windowDays: 7, keyEventDelta: 0, revenueModel: undefined },
    { trafficDelta: 0.1, windowDays: 30, keyEventDelta: 0, revenueModel: undefined },
    { trafficDelta: 300, windowDays: 30, keyEventDelta: 0, revenueModel: { kind: "rpm", rpmUsd: 12 } },
    { trafficDelta: -300, windowDays: 30, keyEventDelta: 0, revenueModel: { kind: "rpm", rpmUsd: 12 } },
    { trafficDelta: 1, windowDays: 30, keyEventDelta: 0, revenueModel: { kind: "rpm", rpmUsd: 12 } },
    { trafficDelta: 0, windowDays: 30, keyEventDelta: 6, revenueModel: { kind: "per_lead", dollarsPerLead: 45 } },
    { trafficDelta: 0, windowDays: 30, keyEventDelta: -6, revenueModel: { kind: "per_lead", dollarsPerLead: 45 } },
    { trafficDelta: 0, windowDays: 30, keyEventDelta: 0.1, revenueModel: { kind: "per_lead", dollarsPerLead: 45 } },
  ];

  for (const [i, args] of cases.entries()) {
    it(`case ${i} has no em or en dash in the basis sentence`, () => {
      const r = computeChangeDollarValue(args);
      expect(r.basisSentence).not.toMatch(/[–—]/);
    });
  }
});

describe("shouldShowChangeDollarLine - won-only, measuring-never presentation gate", () => {
  it("shows on a mature win with a positive dollar value and real revenue connected", () => {
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: 340 }, hasRevenue: true }),
    ).toBe(true);
  });

  it("never shows on an in-flight (measuring) row, even with a positive dollar value", () => {
    expect(
      shouldShowChangeDollarLine({ band: "inflight", dollarValue: { usdPerMonth: 340 }, hasRevenue: true }),
    ).toBe(false);
  });

  it("never shows on a learning (mature non-win) row", () => {
    expect(
      shouldShowChangeDollarLine({ band: "learning", dollarValue: { usdPerMonth: 340 }, hasRevenue: true }),
    ).toBe(false);
  });

  it("never shows on a win with no dollar value (no revenue model configured)", () => {
    expect(shouldShowChangeDollarLine({ band: "win", dollarValue: null, hasRevenue: true })).toBe(false);
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: null }, hasRevenue: true }),
    ).toBe(false);
  });

  it("never shows on a win with a negative or zero dollar value", () => {
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: -40 }, hasRevenue: true }),
    ).toBe(false);
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: 0 }, hasRevenue: true }),
    ).toBe(false);
  });

  it("never shows when band is undefined", () => {
    expect(
      shouldShowChangeDollarLine({ band: undefined, dollarValue: { usdPerMonth: 340 }, hasRevenue: true }),
    ).toBe(false);
  });

  // operator spec 2026-07-09 E-38: hide dollar estimates until real revenue data
  // is connected, even when every other condition (mature win, positive rate-
  // based dollarValue) would otherwise show the line.
  it("never shows on an otherwise-qualifying win when real revenue is not connected yet", () => {
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: 340 }, hasRevenue: false }),
    ).toBe(false);
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: 340 }, hasRevenue: undefined }),
    ).toBe(false);
  });
});
