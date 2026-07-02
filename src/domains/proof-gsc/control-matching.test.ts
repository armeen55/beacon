import { describe, it, expect } from "vitest";
import {
  rankControlCandidates,
  baselineSimilarityRatio,
  trendSlopeDivergence,
  MIN_SURVIVORS,
  MAX_QUERY_OVERLAP,
  BASELINE_SIMILARITY_RATIO,
  MAX_TREND_SLOPE_DIVERGENCE,
  type TreatedPageStats,
  type ControlCandidateStats,
} from "./control-matching";

/**
 * control-matching.test.ts (BEACON_500 items 33 + 36) - the matcher matrix:
 * mismatched scale, diverging trend, high query overlap, and the fail-soft
 * "all excluded -> best-available fallback with honesty flag" behavior.
 */

function treated(over: Partial<TreatedPageStats> = {}): TreatedPageStats {
  return { url: "https://site.com/treated", baselineClicksPerDay: 10, preSlope: 0, ...over };
}

function candidate(url: string, over: Partial<ControlCandidateStats> = {}): ControlCandidateStats {
  return { url, baselineClicksPerDay: 10, preSlope: 0, queryOverlap: 0.05, ...over };
}

describe("baselineSimilarityRatio", () => {
  it("is candidate/treated when treated baseline is real", () => {
    expect(baselineSimilarityRatio(10, 20)).toBe(2);
    expect(baselineSimilarityRatio(10, 5)).toBe(0.5);
  });
  it("is null when the treated baseline is near zero (ratio undefined)", () => {
    expect(baselineSimilarityRatio(0.1, 5)).toBeNull();
  });
});

describe("trendSlopeDivergence", () => {
  it("is the absolute slope gap", () => {
    expect(trendSlopeDivergence(1, 1.5)).toBeCloseTo(0.5);
    expect(trendSlopeDivergence(-1, 1)).toBeCloseTo(2);
  });
});

describe("rankControlCandidates - happy path", () => {
  it("keeps candidates matched on scale, trend, and low query overlap", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 10, preSlope: 0.1 }),
      candidates: [
        candidate("https://site.com/a", { baselineClicksPerDay: 12, preSlope: 0.2, queryOverlap: 0.05 }),
        candidate("https://site.com/b", { baselineClicksPerDay: 9, preSlope: 0.05, queryOverlap: 0.1 }),
        candidate("https://site.com/c", { baselineClicksPerDay: 11, preSlope: 0.15, queryOverlap: 0 }),
      ],
    });
    expect(result.usedFallback).toBe(false);
    expect(result.kept.map((k) => k.url).sort()).toEqual([
      "https://site.com/a",
      "https://site.com/b",
      "https://site.com/c",
    ]);
    for (const k of result.kept) expect(k.verdict).toBe("kept");
  });

  it("caps kept candidates at maxKept, ranking closest matches first", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 10, preSlope: 0 }),
      candidates: [
        candidate("https://site.com/perfect", { baselineClicksPerDay: 10, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/close", { baselineClicksPerDay: 11, preSlope: 0.05, queryOverlap: 0.02 }),
        candidate("https://site.com/ok", { baselineClicksPerDay: 15, preSlope: 0.3, queryOverlap: 0.1 }),
        candidate("https://site.com/edge", { baselineClicksPerDay: 30, preSlope: 0.5, queryOverlap: 0.15 }),
      ],
      maxKept: 2,
    });
    expect(result.kept.length).toBe(2);
    expect(result.kept.map((k) => k.url)).toEqual(["https://site.com/perfect", "https://site.com/close"]);
  });
});

describe("rankControlCandidates - mismatched scale (item 33)", () => {
  it("excludes a candidate whose baseline dwarfs the treated page (a 50-click page vs a 5000-click page)", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 1.8, preSlope: 0 }), // ~50 clicks / 28 days
      candidates: [
        candidate("https://site.com/huge", { baselineClicksPerDay: 180, preSlope: 0, queryOverlap: 0 }), // ~5000 clicks / 28 days
        candidate("https://site.com/similar-a", { baselineClicksPerDay: 2, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/similar-b", { baselineClicksPerDay: 1.5, preSlope: 0, queryOverlap: 0 }),
      ],
    });
    const huge = result.all.find((c) => c.url === "https://site.com/huge")!;
    expect(huge.verdict).toBe("excluded");
    expect(huge.similarityRatio).toBeGreaterThan(BASELINE_SIMILARITY_RATIO.max);
    expect(huge.reason).toMatch(/scale|drift/);
    // Two comparable candidates still pass -> no fallback needed.
    expect(result.usedFallback).toBe(false);
    expect(result.kept.map((k) => k.url).sort()).toEqual([
      "https://site.com/similar-a",
      "https://site.com/similar-b",
    ]);
  });

  it("excludes a candidate far below the treated page's scale too (ratio below the min band)", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 100, preSlope: 0 }),
      candidates: [
        candidate("https://site.com/tiny", { baselineClicksPerDay: 1, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/ok-a", { baselineClicksPerDay: 90, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/ok-b", { baselineClicksPerDay: 110, preSlope: 0, queryOverlap: 0 }),
      ],
    });
    const tiny = result.all.find((c) => c.url === "https://site.com/tiny")!;
    expect(tiny.verdict).toBe("excluded");
    expect(tiny.similarityRatio).toBeLessThan(BASELINE_SIMILARITY_RATIO.min);
  });

  it("near-zero treated baseline requires a near-zero candidate too", () => {
    // Two near-zero candidates pass strictly so the strict pass clears
    // MIN_SURVIVORS and the real-traffic mismatch is NOT rescued by fallback.
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 0.1, preSlope: 0 }),
      candidates: [
        candidate("https://site.com/also-near-zero-a", { baselineClicksPerDay: 0.2, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/also-near-zero-b", { baselineClicksPerDay: 0.3, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/real-traffic", { baselineClicksPerDay: 20, preSlope: 0, queryOverlap: 0 }),
      ],
    });
    expect(result.usedFallback).toBe(false);
    const realTraffic = result.all.find((c) => c.url === "https://site.com/real-traffic")!;
    expect(realTraffic.verdict).toBe("excluded");
    expect(realTraffic.similarityRatio).toBeNull();
  });
});

describe("rankControlCandidates - diverging pre-ship trend (item 33)", () => {
  it("excludes a candidate trending in a different direction before the ship", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 10, preSlope: 1.0 }), // rising fast
      candidates: [
        candidate("https://site.com/falling", { baselineClicksPerDay: 10, preSlope: -1.0, queryOverlap: 0 }), // divergence 2.0
        candidate("https://site.com/also-rising-a", { baselineClicksPerDay: 10, preSlope: 0.9, queryOverlap: 0 }),
        candidate("https://site.com/also-rising-b", { baselineClicksPerDay: 10, preSlope: 1.1, queryOverlap: 0 }),
      ],
    });
    const falling = result.all.find((c) => c.url === "https://site.com/falling")!;
    expect(falling.verdict).toBe("excluded");
    expect(falling.slopeDivergence).toBeGreaterThan(MAX_TREND_SLOPE_DIVERGENCE);
    expect(falling.reason).toMatch(/trending differently/);
    expect(result.kept.map((k) => k.url).sort()).toEqual([
      "https://site.com/also-rising-a",
      "https://site.com/also-rising-b",
    ]);
  });
});

describe("rankControlCandidates - query overlap / SUTVA guard (item 36)", () => {
  it("excludes a candidate sharing more than MAX_QUERY_OVERLAP of its demand with the treated page", () => {
    const result = rankControlCandidates({
      treated: treated(),
      candidates: [
        candidate("https://site.com/cannibal", { queryOverlap: 0.35 }),
        candidate("https://site.com/clean-a", { queryOverlap: 0.05 }),
        candidate("https://site.com/clean-b", { queryOverlap: 0.1 }),
      ],
    });
    const cannibal = result.all.find((c) => c.url === "https://site.com/cannibal")!;
    expect(cannibal.verdict).toBe("excluded");
    expect(cannibal.reason).toMatch(/search demand/);
    expect(result.kept.map((k) => k.url).sort()).toEqual(["https://site.com/clean-a", "https://site.com/clean-b"]);
  });

  it("keeps a candidate exactly AT the overlap limit (boundary is inclusive of the limit)", () => {
    const result = rankControlCandidates({
      treated: treated(),
      candidates: [
        candidate("https://site.com/boundary", { queryOverlap: MAX_QUERY_OVERLAP }),
        candidate("https://site.com/other-a", { queryOverlap: 0 }),
        candidate("https://site.com/other-b", { queryOverlap: 0 }),
      ],
    });
    const boundary = result.all.find((c) => c.url === "https://site.com/boundary")!;
    expect(boundary.verdict).toBe("kept");
  });

  it("never re-admits a query-overlap exclusion during fallback widening (a cannibal stays excluded)", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 10, preSlope: 0 }),
      candidates: [
        // Only candidate close on scale/trend, but cannibalizes queries.
        candidate("https://site.com/cannibal", { baselineClicksPerDay: 10, preSlope: 0, queryOverlap: 0.9 }),
        // Mismatched scale (would only pass in fallback).
        candidate("https://site.com/mismatched", { baselineClicksPerDay: 1000, preSlope: 0, queryOverlap: 0 }),
      ],
      minSurvivors: 2,
    });
    expect(result.usedFallback).toBe(true);
    const cannibal = result.all.find((c) => c.url === "https://site.com/cannibal")!;
    expect(cannibal.verdict).toBe("excluded"); // never re-admitted
    // Only the mismatched (but non-cannibalizing) candidate can be widened in.
    expect(result.kept.map((k) => k.url)).toEqual(["https://site.com/mismatched"]);
  });
});

describe("rankControlCandidates - fail-soft null inputs", () => {
  it("a null queryOverlap always PASSES the overlap check (missing read never excludes)", () => {
    const result = rankControlCandidates({
      treated: treated(),
      candidates: [
        candidate("https://site.com/unknown-overlap", { queryOverlap: null }),
        candidate("https://site.com/other", { queryOverlap: 0 }),
      ],
    });
    const unknown = result.all.find((c) => c.url === "https://site.com/unknown-overlap")!;
    expect(unknown.verdict).toBe("kept");
  });
});

describe("rankControlCandidates - all-excluded fallback with honesty flag", () => {
  it("falls back to the best-available candidates when the strict pass leaves too few survivors", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 10, preSlope: 0 }),
      candidates: [
        candidate("https://site.com/far-a", { baselineClicksPerDay: 500, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/far-b", { baselineClicksPerDay: 600, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/far-c", { baselineClicksPerDay: 700, preSlope: 0, queryOverlap: 0 }),
      ],
    });
    expect(result.usedFallback).toBe(true);
    expect(result.kept.length).toBeGreaterThanOrEqual(MIN_SURVIVORS);
    // The closest-scale candidate (500) should be preferred over farther ones.
    expect(result.kept.map((k) => k.url)).toContain("https://site.com/far-a");
    // Every kept-via-fallback row explains itself.
    for (const k of result.kept) {
      expect(k.reason).toMatch(/kept anyway/);
    }
  });

  it("never manufactures comparison pages out of nothing - zero candidates in, zero out, no fallback flag", () => {
    const result = rankControlCandidates({ treated: treated(), candidates: [] });
    expect(result.kept).toEqual([]);
    expect(result.all).toEqual([]);
    expect(result.usedFallback).toBe(false);
  });

  it("falls back to fewer than minSurvivors when fewer non-cannibalizing candidates exist at all", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 10, preSlope: 0 }),
      candidates: [candidate("https://site.com/only-one", { baselineClicksPerDay: 500, preSlope: 0, queryOverlap: 0 })],
    });
    expect(result.usedFallback).toBe(true);
    expect(result.kept.map((k) => k.url)).toEqual(["https://site.com/only-one"]);
  });

  it("prefers fewer good comparison pages over three bad ones (a clean pass never widens)", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 10, preSlope: 0 }),
      candidates: [
        candidate("https://site.com/good-a", { baselineClicksPerDay: 11, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/good-b", { baselineClicksPerDay: 9, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/bad-scale", { baselineClicksPerDay: 900, preSlope: 0, queryOverlap: 0 }),
        candidate("https://site.com/bad-overlap", { baselineClicksPerDay: 10, preSlope: 0, queryOverlap: 0.8 }),
      ],
    });
    expect(result.usedFallback).toBe(false);
    expect(result.kept.map((k) => k.url).sort()).toEqual(["https://site.com/good-a", "https://site.com/good-b"]);
  });
});

describe("control-matching - no em or en dash in any reason string (hard rule)", () => {
  it("scans every possible reason string across a representative matrix", () => {
    const result = rankControlCandidates({
      treated: treated({ baselineClicksPerDay: 10, preSlope: 1 }),
      candidates: [
        candidate("https://site.com/a", { baselineClicksPerDay: 1000, preSlope: 1, queryOverlap: 0 }),
        candidate("https://site.com/b", { baselineClicksPerDay: 0.01, preSlope: 1, queryOverlap: 0 }),
        candidate("https://site.com/c", { baselineClicksPerDay: 10, preSlope: -5, queryOverlap: 0 }),
        candidate("https://site.com/d", { baselineClicksPerDay: 10, preSlope: 1, queryOverlap: 0.9 }),
        candidate("https://site.com/e", { baselineClicksPerDay: 10, preSlope: 1, queryOverlap: 0.01 }),
      ],
    });
    for (const c of result.all) {
      expect(c.reason).not.toMatch(/[–—]/);
    }
  });
});
