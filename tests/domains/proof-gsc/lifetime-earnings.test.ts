import { describe, it, expect } from "vitest";

import {
  computeLifetimeEarnings,
  proratedLifetimeClicks,
  type LifetimeEarningsRow,
} from "@/domains/proof-gsc/lifetime-earnings";

/**
 * Pure-math matrix for the lifetime earnings odometer (BEACON_500 item 40).
 * computeLifetimeEarnings aggregates already-computed monthly rates
 * (change-dollar-value.ts's output per mature won row) into one compounding
 * sentence. No I/O; every case here is deterministic.
 */

function row(over: Partial<LifetimeEarningsRow>): LifetimeEarningsRow {
  return { id: "r1", extraSessionsPerMonth: 100, usdPerMonth: null, daysLive: 30, ...over };
}

describe("proratedLifetimeClicks", () => {
  it("prorates a monthly rate down by days-live / 30", () => {
    expect(proratedLifetimeClicks(300, 30)).toBeCloseTo(300, 5);
    expect(proratedLifetimeClicks(300, 15)).toBeCloseTo(150, 5);
    expect(proratedLifetimeClicks(300, 60)).toBeCloseTo(600, 5);
  });

  it("returns 0 for non-positive or invalid days-live (no negative proration)", () => {
    expect(proratedLifetimeClicks(300, 0)).toBe(0);
    expect(proratedLifetimeClicks(300, -5)).toBe(0);
    expect(proratedLifetimeClicks(300, Number.NaN)).toBe(0);
  });

  it("returns 0 for a non-finite rate instead of NaN/Infinity", () => {
    expect(proratedLifetimeClicks(Number.NaN, 30)).toBe(0);
    expect(proratedLifetimeClicks(Number.POSITIVE_INFINITY, 30)).toBe(0);
  });

  it("is deterministic", () => {
    expect(proratedLifetimeClicks(140, 21)).toBe(proratedLifetimeClicks(140, 21));
  });
});

describe("computeLifetimeEarnings - silence gates", () => {
  it("returns null with zero rows (never a fabricated zero-dollar line)", () => {
    expect(computeLifetimeEarnings([])).toBeNull();
  });
});

describe("computeLifetimeEarnings - clicks-only degrade (no revenue model)", () => {
  it("sums clicks and names the total, with no dollar figure", () => {
    const r = computeLifetimeEarnings([
      row({ id: "a", extraSessionsPerMonth: 300, daysLive: 30, usdPerMonth: null }),
      row({ id: "b", extraSessionsPerMonth: 120, daysLive: 30, usdPerMonth: null }),
    ])!;
    expect(r.changeCount).toBe(2);
    expect(r.clicksPerMonth).toBe(420);
    expect(r.lifetimeExtraClicks).toBe(420); // both fully mature at 30 days
    expect(r.usdPerMonth).toBeNull();
    expect(r.changesWithDollarValue).toBe(0);
    expect(r.sentence).not.toMatch(/\$/);
    expect(r.sentence).toMatch(/extra click/);
    expect(r.sentence).toMatch(/settings/);
  });

  it("still degrades to clicks-only when EVERY row has a null usdPerMonth even with a nonzero rate", () => {
    const r = computeLifetimeEarnings([row({ usdPerMonth: null, extraSessionsPerMonth: 50 })])!;
    expect(r.usdPerMonth).toBeNull();
    expect(r.sentence).not.toMatch(/\$/);
  });
});

describe("computeLifetimeEarnings - dollar figure present", () => {
  it("sums usdPerMonth across rows and states both dollars and lifetime clicks", () => {
    const r = computeLifetimeEarnings([
      row({ id: "a", extraSessionsPerMonth: 300, daysLive: 60, usdPerMonth: 12.5 }),
      row({ id: "b", extraSessionsPerMonth: 100, daysLive: 30, usdPerMonth: 4 }),
    ])!;
    expect(r.usdPerMonth).toBeCloseTo(16.5, 5);
    expect(r.changesWithDollarValue).toBe(2);
    // a: 300/month * (60/30) = 600 lifetime; b: 100/month * (30/30) = 100 lifetime
    expect(r.lifetimeExtraClicks).toBe(700);
    // 16.5 rounds to whole dollars once >= 10 (matches change-dollar-value.ts's fmtUsd convention)
    expect(r.sentence).toMatch(/\$17/);
    expect(r.sentence).toMatch(/a month at your rate/);
    expect(r.sentence).toMatch(/700 extra clicks/);
  });

  it("sums dollars only from rows that HAVE a figure, clicks from every row", () => {
    const r = computeLifetimeEarnings([
      row({ id: "a", extraSessionsPerMonth: 300, daysLive: 30, usdPerMonth: 10 }),
      row({ id: "b", extraSessionsPerMonth: 50, daysLive: 30, usdPerMonth: null }),
    ])!;
    expect(r.usdPerMonth).toBe(10);
    expect(r.changesWithDollarValue).toBe(1);
    expect(r.clicksPerMonth).toBe(350);
    expect(r.lifetimeExtraClicks).toBe(350);
  });

  it("a single mature win reads clicks-only from the 1-win real-world shape (Iranopedia probe)", () => {
    // Mirrors the shape observed against real data: 1 mature win, no revenue
    // model configured, ~30 days live.
    const r = computeLifetimeEarnings([
      row({ id: "iranopedia-1", extraSessionsPerMonth: 42, daysLive: 21, usdPerMonth: null }),
    ])!;
    expect(r.changeCount).toBe(1);
    expect(r.usdPerMonth).toBeNull();
    expect(r.sentence).toMatch(/1 change/);
    expect(r.sentence).not.toMatch(/\$/);
  });
});

describe("computeLifetimeEarnings - honest wording edge cases", () => {
  it("names a change that has not yet compounded into extra clicks honestly (near-zero lifetime)", () => {
    const r = computeLifetimeEarnings([row({ extraSessionsPerMonth: 0.01, daysLive: 1, usdPerMonth: null })])!;
    expect(r.lifetimeExtraClicks).toBe(0);
    expect(r.sentence).toMatch(/not added up to extra clicks yet/);
  });

  it("singular change wording for exactly one row", () => {
    const r = computeLifetimeEarnings([row({ extraSessionsPerMonth: 300, daysLive: 30, usdPerMonth: null })])!;
    expect(r.sentence).toMatch(/1 change I shipped/);
    expect(r.sentence).not.toMatch(/changes I shipped/);
  });

  it("plural change wording for more than one row", () => {
    const r = computeLifetimeEarnings([
      row({ id: "a", extraSessionsPerMonth: 300, daysLive: 30, usdPerMonth: null }),
      row({ id: "b", extraSessionsPerMonth: 300, daysLive: 30, usdPerMonth: null }),
    ])!;
    expect(r.sentence).toMatch(/2 changes I shipped/);
  });
});

describe("computeLifetimeEarnings - no em/en dashes anywhere (hard rule)", () => {
  const cases: LifetimeEarningsRow[][] = [
    [row({ extraSessionsPerMonth: 300, daysLive: 30, usdPerMonth: null })],
    [row({ extraSessionsPerMonth: 300, daysLive: 30, usdPerMonth: 12.5 })],
    [row({ extraSessionsPerMonth: 0.01, daysLive: 1, usdPerMonth: null })],
    [
      row({ id: "a", extraSessionsPerMonth: 300, daysLive: 60, usdPerMonth: 12.5 }),
      row({ id: "b", extraSessionsPerMonth: 100, daysLive: 30, usdPerMonth: 4 }),
    ],
  ];

  for (const [i, rows] of cases.entries()) {
    it(`case ${i} has no em or en dash in the sentence`, () => {
      const r = computeLifetimeEarnings(rows)!;
      expect(r.sentence).not.toMatch(/[–—]/);
    });
  }
});

describe("computeLifetimeEarnings - determinism", () => {
  it("same inputs, same output, every call", () => {
    const rows = [row({ extraSessionsPerMonth: 250, daysLive: 45, usdPerMonth: 8.2 })];
    expect(computeLifetimeEarnings(rows)).toEqual(computeLifetimeEarnings(rows));
  });
});
