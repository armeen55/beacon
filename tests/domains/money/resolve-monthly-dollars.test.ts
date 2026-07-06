import { describe, it, expect } from "vitest";

import {
  resolveMonthlyDollars,
  groundedDollarLine,
  CONNECT_REVENUE_PROMPT,
  type MonthlyDollars,
} from "@/domains/money/resolve-monthly-dollars";

/**
 * RANK-2 money model tests. The load-bearing contract: NEVER a dollar number
 * without a real basis. Proves:
 *   - null basis + null usd when no revenue model (honest connect-prompt path),
 *   - value_per_conversion basis when per_lead is configured,
 *   - value_per_visit basis when rpm is configured,
 *   - the grounded line names the basis + always says "estimate",
 *   - the ungrounded prompt is the exact honest string,
 *   - no invented numbers (a priced number with NO model still resolves null),
 *   - no em/en dashes in any generated copy.
 */

describe("resolveMonthlyDollars - the one money model", () => {
  it("returns {usd:null, basis:null} when no revenue model is configured", () => {
    const money = resolveMonthlyDollars({
      dollarValue: { usdPerMonth: 420 },
      revenueModel: null,
    });
    expect(money).toEqual({ usd: null, basis: null });
  });

  it("returns {usd:null, basis:null} when the change has no priced dollar figure", () => {
    const money = resolveMonthlyDollars({
      dollarValue: { usdPerMonth: null },
      revenueModel: { kind: "per_lead", dollarsPerLead: 35 },
    });
    expect(money).toEqual({ usd: null, basis: null });
  });

  it("returns {usd:null, basis:null} when the dollarValue attachment is absent", () => {
    const money = resolveMonthlyDollars({ revenueModel: { kind: "rpm", rpmUsd: 12 } });
    expect(money).toEqual({ usd: null, basis: null });
  });

  it("NEVER invents a number: a priced figure with no usable model resolves null", () => {
    // A rate of 0 is not usable, so even a real priced number must not surface.
    const money = resolveMonthlyDollars({
      dollarValue: { usdPerMonth: 999 },
      revenueModel: { kind: "per_lead", dollarsPerLead: 0 },
    });
    expect(money.usd).toBeNull();
    expect(money.basis).toBeNull();
  });

  it("uses value_per_conversion basis when a per_lead model is set", () => {
    const money = resolveMonthlyDollars({
      dollarValue: { usdPerMonth: 420 },
      revenueModel: { kind: "per_lead", dollarsPerLead: 35 },
    });
    expect(money).toEqual({ usd: 420, basis: "value_per_conversion" });
  });

  it("uses value_per_visit basis when an rpm model is set", () => {
    const money = resolveMonthlyDollars({
      dollarValue: { usdPerMonth: 88 },
      revenueModel: { kind: "rpm", rpmUsd: 12 },
    });
    expect(money).toEqual({ usd: 88, basis: "value_per_visit" });
  });

  it("passes a negative priced figure straight through with a basis (no floor)", () => {
    const money = resolveMonthlyDollars({
      dollarValue: { usdPerMonth: -40 },
      revenueModel: { kind: "rpm", rpmUsd: 12 },
    });
    expect(money).toEqual({ usd: -40, basis: "value_per_visit" });
  });

  it("drops a non-finite priced figure to null (never NaN/Infinity dollars)", () => {
    const money = resolveMonthlyDollars({
      dollarValue: { usdPerMonth: Number.NaN },
      revenueModel: { kind: "per_lead", dollarsPerLead: 35 },
    });
    expect(money).toEqual({ usd: null, basis: null });
  });
});

describe("groundedDollarLine", () => {
  it("names the per-lead basis and always says estimate, not measured revenue", () => {
    const line = groundedDollarLine({ usd: 420, basis: "value_per_conversion" });
    expect(line).toBe(
      "This change earned about $420 a month, based on your Search Console clicks and the value you set per lead. This is an estimate at your own rate, not measured revenue.",
    );
    expect(line).not.toMatch(/[–—]/);
  });

  it("names the per-visit basis for an rpm model", () => {
    const line = groundedDollarLine({ usd: 88, basis: "value_per_visit" });
    expect(line).toContain("$88 a month");
    expect(line).toContain("value you set per 1,000 visits");
    expect(line).toContain("not measured revenue");
    expect(line).not.toMatch(/[–—]/);
  });

  it("rounds to whole dollars and thousands-separates a large figure", () => {
    const line = groundedDollarLine({ usd: 1234.56, basis: "value_per_conversion" });
    expect(line).toContain("$1,235 a month");
  });

  it("returns null for a null, zero, or negative figure (no celebrated non-win)", () => {
    expect(groundedDollarLine({ usd: null, basis: null } as MonthlyDollars)).toBeNull();
    expect(groundedDollarLine({ usd: 0, basis: "value_per_visit" })).toBeNull();
    expect(groundedDollarLine({ usd: -40, basis: "value_per_visit" })).toBeNull();
  });
});

describe("CONNECT_REVENUE_PROMPT", () => {
  it("is the exact honest ungrounded prompt with a next step and no fake number", () => {
    expect(CONNECT_REVENUE_PROMPT).toBe(
      "Connect revenue or tell me what a lead is worth, and I will show these wins in dollars.",
    );
    expect(CONNECT_REVENUE_PROMPT).not.toMatch(/\$/);
    expect(CONNECT_REVENUE_PROMPT).not.toMatch(/[–—]/);
  });
});
