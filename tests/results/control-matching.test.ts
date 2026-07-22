import { describe, expect, it } from "vitest";
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
} from "@/domains/proof-gsc/control-matching";
import {
  ledgerExclusionPaths,
  pickPlaceboPages,
  pickPlaceboControls,
  seededPseudoShipDate,
  weekKeyOf,
  percentile95,
  deriveFloorForTier,
  runAaCalibrationForTenant,
  MAX_PLACEBO_PAGES_PER_RUN,
  MIN_SAMPLES_TO_DERIVE,
  type PlaceboCandidate,
} from "@/domains/proof-gsc/aa-calibration";
import { buildAaHonestySentence } from "@/app/(shell)/results/proof-summary-section";
import type { AaCalibrationRow } from "@/domains/proof-gsc/aa-calibration-store";
import { DEFAULT_MIN_LIFT_CLICKS, DEFAULT_MIN_LIFT_CTR } from "@/domains/proof-gsc/measure";

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

});

describe("A/A calibration: placebo picking and stricter-only floors", () => {
const cand = (page: string, impr: number): PlaceboCandidate => ({ page, baselineImpressions: impr });

describe("ledgerExclusionPaths — never sample a page the real ledger already uses", () => {
  it("excludes both treated pages AND their control pages", () => {
    const ledger = [
      { path: "/singers", controlPages: ["https://iranopedia.com/actors", "https://iranopedia.com/comedians"] },
      { path: "/cities", controlPages: [] },
    ];
    const excl = ledgerExclusionPaths(ledger);
    expect(excl.has("/singers")).toBe(true);
    expect(excl.has("/cities")).toBe(true);
    expect(excl.has("/actors")).toBe(true);
    expect(excl.has("/comedians")).toBe(true);
    expect(excl.has("/farsi-numbers")).toBe(false);
  });

  it("normalizes trailing slashes and full URLs to the same path key", () => {
    const ledger = [{ path: "https://iranopedia.com/food/", controlPages: ["/drinks/"] }];
    const excl = ledgerExclusionPaths(ledger);
    expect(excl.has("/food")).toBe(true);
    expect(excl.has("/drinks")).toBe(true);
  });
});

describe("pickPlaceboPages — pure candidate picker", () => {
  const candidates: PlaceboCandidate[] = [
    cand("https://x.com/a", 5000),
    cand("https://x.com/b", 3000),
    cand("https://x.com/c", 100), // below the 200-impression floor
    cand("https://x.com/d", 900),
  ];

  it("excludes anything in the ledger exclusion set", () => {
    const excl = new Set(["/b"]);
    const picked = pickPlaceboPages(candidates, excl, 10).map((c) => c.page);
    expect(picked).not.toContain("https://x.com/b");
    expect(picked).toContain("https://x.com/a");
    expect(picked).toContain("https://x.com/d");
  });

  it("drops candidates below the baseline-impressions floor", () => {
    const picked = pickPlaceboPages(candidates, new Set(), 10).map((c) => c.page);
    expect(picked).not.toContain("https://x.com/c");
  });

  it("is bounded by the limit and deterministically ordered (impressions desc)", () => {
    const picked = pickPlaceboPages(candidates, new Set(), 2);
    expect(picked).toHaveLength(2);
    expect(picked[0]!.page).toBe("https://x.com/a");
    expect(picked[1]!.page).toBe("https://x.com/b");
  });

  it("defaults to the documented nightly bound", () => {
    const many = Array.from({ length: 100 }, (_, i) => cand(`https://x.com/p${i}`, 1000 + i));
    const picked = pickPlaceboPages(many, new Set());
    expect(picked).toHaveLength(MAX_PLACEBO_PAGES_PER_RUN);
  });
});

describe("pickPlaceboControls — excludes the placebo page itself + the ledger set", () => {
  const candidates: PlaceboCandidate[] = [
    cand("https://x.com/target", 5000),
    cand("https://x.com/a", 4000),
    cand("https://x.com/b", 3000),
    cand("https://x.com/c", 2000),
    cand("https://x.com/excluded", 9000),
  ];

  it("never returns the placebo page as its own control", () => {
    const controls = pickPlaceboControls("https://x.com/target", candidates, new Set());
    expect(controls).not.toContain("https://x.com/target");
  });

  it("excludes ledger-reserved pages even when they have the most traffic", () => {
    const controls = pickPlaceboControls("https://x.com/target", candidates, new Set(["/excluded"]));
    expect(controls).not.toContain("https://x.com/excluded");
    expect(controls).toEqual(["https://x.com/a", "https://x.com/b", "https://x.com/c"]);
  });
});

describe("seededPseudoShipDate — deterministic, no Date.now/Math.random", () => {
  const now = new Date("2026-07-02T12:00:00Z");

  it("always lands 14-42 days before `now` (the 2-6 week range)", () => {
    for (const page of ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]) {
      const date = seededPseudoShipDate("tenant-x", `https://x.com/${page}`, now);
      const diffDays = Math.round((now.getTime() - Date.parse(date)) / 86_400_000);
      expect(diffDays).toBeGreaterThanOrEqual(14);
      expect(diffDays).toBeLessThanOrEqual(42);
    }
  });

});
describe("deriveFloorForTier — STRICTER-ONLY clamp (the core safety rule)", () => {
  it("never derives below the shipped default, even with a huge sample of tiny lifts", () => {
    const tinyLifts = Array.from({ length: 200 }, () => 0.1);
    const floor = deriveFloorForTier({ absLifts: tinyLifts, defaultFloor: DEFAULT_MIN_LIFT_CLICKS, cumulativeSampleSize: 200 });
    expect(floor).toBeGreaterThanOrEqual(DEFAULT_MIN_LIFT_CLICKS);
  });

  it("returns exactly the default (never loosens) below MIN_SAMPLES_TO_DERIVE, no matter how noisy the placebo lifts are", () => {
    const wildLifts = [50, 60, 70, 80, 90]; // would derive a much higher floor if trusted
    const floor = deriveFloorForTier({
      absLifts: wildLifts,
      defaultFloor: DEFAULT_MIN_LIFT_CLICKS,
      cumulativeSampleSize: MIN_SAMPLES_TO_DERIVE - 1,
    });
    expect(floor).toBe(DEFAULT_MIN_LIFT_CLICKS);
  });

  it("derives a stricter floor from a wide placebo lift distribution once enough samples exist", () => {
    const wideLifts = Array.from({ length: 100 }, (_, i) => i); // 0..99, p95 ~= 94
    const floor = deriveFloorForTier({
      absLifts: wideLifts,
      defaultFloor: DEFAULT_MIN_LIFT_CLICKS,
      cumulativeSampleSize: MIN_SAMPLES_TO_DERIVE,
    });
    expect(floor).toBeGreaterThan(DEFAULT_MIN_LIFT_CLICKS);
    expect(floor).toBeCloseTo(94.05, 1);
  });

  it("CTR floor derivation follows the same stricter-only rule with the CTR default", () => {
    const lifts = [0.001, 0.001, 0.001];
    const floor = deriveFloorForTier({ absLifts: lifts, defaultFloor: DEFAULT_MIN_LIFT_CTR, cumulativeSampleSize: MIN_SAMPLES_TO_DERIVE });
    expect(floor).toBeGreaterThanOrEqual(DEFAULT_MIN_LIFT_CTR);
  });
});

describe("runAaCalibrationForTenant — I/O shell, fail-soft + aggregate math (injected deps, no real GSC/Supabase)", () => {
  it("returns ran:true with an empty result when there are no GSC-covered pages", async () => {
    const result = await runAaCalibrationForTenant("tenant-x", new Date("2026-07-02T00:00:00Z"), {
      loadContext: async () => ({ gscByUrl: new Map(), snapshotByCanon: new Map() } as any),
      loadLedger: async () => [],
      readLastFinal: async () => null,
    });
    expect(result.ran).toBe(true);
    expect(result.sampleSize).toBe(0);
    expect(result.falsePositiveRate).toBe(0);
  });

  it("is fail-soft: a thrown context load never throws out of the pass", async () => {
    const result = await runAaCalibrationForTenant("tenant-x", new Date(), {
      loadContext: async () => {
        throw new Error("supabase down");
      },
    });
    expect(result.ran).toBe(false);
  });
});

describe("dash + jargon guard on the operator-visible false-positive sentence (item 31)", () => {
  const row = (overrides: Partial<AaCalibrationRow> = {}): AaCalibrationRow => ({
    tenant_id: "tenant-iranopedia",
    computed_at: "2026-07-02T00:00:00Z",
    sampleSize: 32,
    falsePositiveRate: 0.04,
    byTrafficTier: [],
    cumulativeSampleSize: 132,
    ...overrides,
  });

  it("is silent (null) when there is no calibration data yet", () => {
    expect(buildAaHonestySentence(null)).toBeNull();
    expect(buildAaHonestySentence(row({ sampleSize: 0 }))).toBeNull();
  });

  it("names the real measured rate and the 5 percent target in plain words", () => {
    const sentence = buildAaHonestySentence(row({ falsePositiveRate: 0.04 }));
    expect(sentence).toContain("4 times in 100");
    expect(sentence).toContain("under 5");
  });

  it("uses singular 'time' for a 1-in-100 rate", () => {
    const sentence = buildAaHonestySentence(row({ falsePositiveRate: 0.01 }))!;
    expect(sentence).toContain("1 time in 100");
  });

  // P1-4 (2026-07-10, visual audit) - the live Iranopedia row that produced the
  // self-contradicting "cries wolf 93 times in 100, and we tune it to stay under 5"
  // sentence (sampleSize 40, cumulativeSampleSize 360, falsePositiveRate 0.925). Above
  // target, the sentence must own the miss plainly, never pair a scary rate with an
  // unmet "already tuned" promise.
  it("never claims the under-5 promise is already kept when the rate is above target: it owns the miss and says it is tightening now", () => {
    const sentence = buildAaHonestySentence(
      row({ sampleSize: 40, cumulativeSampleSize: 360, falsePositiveRate: 0.925 }),
    )!;
    expect(sentence).toBe(
      "My self-test on pages I never touched flagged 93 of 100 as a win or a loss, so my verdict floors were too loose. I am tightening them now and treating early signals as directional until the self-test clears 5 in 100.",
    );
    expect(sentence).not.toContain("we tune it to stay under");
    expect(sentence).not.toMatch(/[–—]/);
    expect(sentence).not.toMatch(/\b(baselines?|treatments?|reservations?|experiments?|controls?|placebos?|SERP)\b/i);
  });

  it("keeps the confident framing once the self-test genuinely clears target (no false alarm downgraded to a hedge)", () => {
    const sentence = buildAaHonestySentence(row({ falsePositiveRate: 0.05 }))!;
    expect(sentence).toContain("we tune it to stay under 5");
  });
});

});
