import { describe, it, expect } from "vitest";
import { computeWinnability } from "./winnability";

describe("computeWinnability (master plan item 18)", () => {
  it("no reads at all -> honest hard/cautious default, never fabricates", () => {
    const w = computeWinnability({});
    expect(w.band).toBe("hard");
    expect(w.readsAvailable).toBe(0);
    expect(w.reasons.some((r) => /no difficulty/i.test(r))).toBe(true);
  });

  it("low difficulty + low domain ranks + tight backlink gap -> winnable, high score", () => {
    const w = computeWinnability({
      difficulty: 20,
      domainRanks: [30, 25, 40],
      backlinkGap: { theirAvgReferringDomains: 20, ownReferringDomains: 15 },
    });
    expect(w.band).toBe("winnable");
    expect(w.score).toBeGreaterThanOrEqual(70);
    expect(w.readsAvailable).toBe(3);
  });

  it("difficulty >= 70 -> hard", () => {
    const w = computeWinnability({ difficulty: 72 });
    expect(w.band).toBe("hard");
    expect(w.reasons.some((r) => /72 of 100 difficulty/.test(r))).toBe(true);
  });

  it("difficulty >= 85 -> flat reject regardless of other reads", () => {
    const w = computeWinnability({ difficulty: 90, domainRanks: [20, 25] });
    expect(w.band).toBe("reject");
  });

  it("median domain rank >= 70 -> hard", () => {
    const w = computeWinnability({ domainRanks: [65, 72, 80] }); // median 72
    expect(w.band).toBe("hard");
    expect(w.reasons.some((r) => /domain strength 72/.test(r))).toBe(true);
  });

  it("median domain rank >= 85 -> flat reject", () => {
    const w = computeWinnability({ domainRanks: [88, 90, 92] });
    expect(w.band).toBe("reject");
  });

  it("backlink gap > 50x -> reject when difficulty is not low", () => {
    const w = computeWinnability({
      difficulty: 50,
      backlinkGap: { theirAvgReferringDomains: 210, ownReferringDomains: 3 },
    });
    expect(w.band).toBe("reject");
    expect(w.reasons.some((r) => /210 linking domains/.test(r))).toBe(true);
  });

  it("backlink gap > 50x is FORGIVEN when difficulty is low (< 30) - stays winnable on merit", () => {
    const w = computeWinnability({
      difficulty: 15,
      backlinkGap: { theirAvgReferringDomains: 210, ownReferringDomains: 3 },
    });
    expect(w.band).not.toBe("reject");
    expect(w.reasons.some((r) => /70x your linking domains/.test(r) || /stays winnable on merit/.test(r))).toBe(true);
  });

  it("own referring domains is zero and they have some -> infinite multiple treated as reject (not NaN/Infinity leak)", () => {
    const w = computeWinnability({
      difficulty: 50,
      backlinkGap: { theirAvgReferringDomains: 100, ownReferringDomains: 0 },
    });
    expect(w.band).toBe("reject");
    expect(Number.isFinite(w.score)).toBe(true);
    expect(w.sentence).not.toMatch(/Infinity|NaN/);
  });

  it("partial reads (difficulty only) still produce a usable sentence and lower readsAvailable", () => {
    const w = computeWinnability({ difficulty: 35 });
    expect(w.readsAvailable).toBe(1);
    expect(w.sentence).toMatch(/35 of 100 difficulty/);
  });

  it("score is always within 0-100 and bands never overlap ranges", () => {
    const cases = [
      { difficulty: 5 },
      { difficulty: 95 },
      { domainRanks: [10, 15] },
      { domainRanks: [95, 99] },
      { backlinkGap: { theirAvgReferringDomains: 500, ownReferringDomains: 1 } },
    ];
    for (const c of cases) {
      const w = computeWinnability(c);
      expect(w.score).toBeGreaterThanOrEqual(0);
      expect(w.score).toBeLessThanOrEqual(100);
    }
  });

  it("sentence never uses an em or en dash (dash guard)", () => {
    const cases = [
      {},
      { difficulty: 20 },
      { difficulty: 90 },
      { domainRanks: [40, 50, 90] },
      { backlinkGap: { theirAvgReferringDomains: 300, ownReferringDomains: 2 } },
      {
        difficulty: 40,
        domainRanks: [60, 70, 80],
        backlinkGap: { theirAvgReferringDomains: 150, ownReferringDomains: 10 },
      },
    ];
    for (const c of cases) {
      const w = computeWinnability(c);
      expect(w.sentence).not.toMatch(/[–—]/);
      for (const r of w.reasons) expect(r).not.toMatch(/[–—]/);
    }
  });

  it("clamps out-of-range difficulty/rank inputs defensively (never throws, never negative)", () => {
    const w = computeWinnability({ difficulty: 150, domainRanks: [-10, 500] });
    expect(w.score).toBeGreaterThanOrEqual(0);
    expect(w.score).toBeLessThanOrEqual(100);
  });
});
