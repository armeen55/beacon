import { describe, it, expect } from "vitest";

import {
  isStrikingDistance,
  declinesForPage,
  type QueryAgg,
} from "@/domains/recommendation-intelligence/gsc-page-queries";

describe("gsc-page-queries — striking distance", () => {
  it("flags position 4–15 with ≥100 impressions", () => {
    expect(isStrikingDistance(4, 100)).toBe(true);
    expect(isStrikingDistance(8, 5000)).toBe(true);
    expect(isStrikingDistance(15, 120)).toBe(true);
  });
  it("excludes already-top-3 (no climb upside)", () => {
    expect(isStrikingDistance(1, 9999)).toBe(false);
    expect(isStrikingDistance(3.9, 9999)).toBe(false);
  });
  it("excludes deep ranks (too far to climb) and thin demand", () => {
    expect(isStrikingDistance(16, 9999)).toBe(false);
    expect(isStrikingDistance(8, 99)).toBe(false); // below the 100-impression floor
  });
});

describe("gsc-page-queries — declinesForPage (pure windowing)", () => {
  const agg = (clicks: number, impressions: number, position: number): QueryAgg => ({
    clicks,
    impressions,
    posW: position * impressions,
  });

  it("flags a real ≥30% click drop on a query with real prior demand", () => {
    const prior = new Map([["persian girl names", agg(292, 8000, 5)]]);
    const recent = new Map([["persian girl names", agg(73, 7000, 9)]]);
    const out = declinesForPage(recent, prior);
    expect(out).toHaveLength(1);
    expect(out[0]!.query).toBe("persian girl names");
    expect(out[0]!.dropPct).toBe(75); // (292-73)/292 ≈ 75%
    expect(Math.round(out[0]!.positionSlip)).toBe(4); // 9 - 5
  });

  it("ignores queries below the prior-demand floor (no false 'losing' claim)", () => {
    const prior = new Map([["tiny", agg(5, 100, 6)]]); // <10 prior clicks
    const recent = new Map([["tiny", agg(0, 0, 0)]]);
    expect(declinesForPage(recent, prior)).toHaveLength(0);
  });

  it("ignores small dips below the drop threshold", () => {
    const prior = new Map([["steady", agg(100, 5000, 4)]]);
    const recent = new Map([["steady", agg(80, 5000, 4)]]); // only −20%
    expect(declinesForPage(recent, prior)).toHaveLength(0);
  });

  it("treats a query absent from the recent window as a 100% drop", () => {
    const prior = new Map([["gone", agg(50, 2000, 7)]]);
    const recent = new Map<string, QueryAgg>();
    const out = declinesForPage(recent, prior);
    expect(out).toHaveLength(1);
    expect(out[0]!.dropPct).toBe(100);
    expect(out[0]!.recentClicks).toBe(0);
  });

  it("sorts biggest prior-clicks loss first and caps the list", () => {
    const prior = new Map([
      ["a", agg(40, 1000, 6)],
      ["b", agg(200, 5000, 5)],
      ["c", agg(80, 2000, 6)],
      ["d", agg(60, 1500, 6)],
    ]);
    const recent = new Map([
      ["a", agg(5, 200, 9)],
      ["b", agg(20, 600, 9)],
      ["c", agg(10, 300, 9)],
      ["d", agg(5, 200, 9)],
    ]);
    const out = declinesForPage(recent, prior, { cap: 3 });
    expect(out).toHaveLength(3);
    expect(out.map((d) => d.query)).toEqual(["b", "c", "d"]); // by prior clicks desc
  });
});
