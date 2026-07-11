import { describe, expect, it } from "vitest";
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
} from "./aa-calibration";
import { buildAaHonestySentence } from "@/app/(shell)/results/proof-summary-section";
import type { AaCalibrationRow } from "./aa-calibration-store";
import { DEFAULT_MIN_LIFT_CLICKS, DEFAULT_MIN_LIFT_CTR } from "./measure";

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

  it("is stable across repeated calls with the same inputs (reruns are byte-identical)", () => {
    const a = seededPseudoShipDate("tenant-iranopedia", "https://iranopedia.com/singers", now);
    const b = seededPseudoShipDate("tenant-iranopedia", "https://iranopedia.com/singers", now);
    expect(a).toBe(b);
  });

  it("differs across tenants and pages (not a constant offset)", () => {
    const a = seededPseudoShipDate("tenant-a", "https://x.com/p1", now);
    const b = seededPseudoShipDate("tenant-b", "https://x.com/p1", now);
    const c = seededPseudoShipDate("tenant-a", "https://x.com/p2", now);
    // Extremely unlikely all three collide by chance across the 29-value range;
    // assert at least one differs from the first to prove the hash is inputs-sensitive.
    expect(a === b && a === c).toBe(false);
  });

  it("always lands 14-42 days before `now` (the 2-6 week range)", () => {
    for (const page of ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]) {
      const date = seededPseudoShipDate("tenant-x", `https://x.com/${page}`, now);
      const diffDays = Math.round((now.getTime() - Date.parse(date)) / 86_400_000);
      expect(diffDays).toBeGreaterThanOrEqual(14);
      expect(diffDays).toBeLessThanOrEqual(42);
    }
  });

  it("weekKeyOf is stable within the same 7-day bucket and changes across weeks", () => {
    const d1 = new Date("2026-07-02T00:00:00Z");
    const d2 = new Date("2026-07-02T23:00:00Z");
    const d3 = new Date("2026-07-20T00:00:00Z");
    expect(weekKeyOf(d1)).toBe(weekKeyOf(d2));
    expect(weekKeyOf(d1)).not.toBe(weekKeyOf(d3));
  });
});

describe("percentile95 — pure stats helper", () => {
  it("returns 0 for an empty set", () => {
    expect(percentile95([])).toBe(0);
  });
  it("returns the single value for a singleton set", () => {
    expect(percentile95([7])).toBe(7);
  });
  it("interpolates near the top of a sorted set", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    // rank = 0.95*99 = 94.05 -> between sorted[94]=95 and sorted[95]=96
    expect(percentile95(values)).toBeCloseTo(95.05, 5);
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
  it("returns ran:false on no tenantId", async () => {
    const result = await runAaCalibrationForTenant("");
    expect(result.ran).toBe(false);
    expect(result.sampleSize).toBe(0);
  });

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

  it("has no em or en dash", () => {
    const sentence = buildAaHonestySentence(row())!;
    expect(sentence).not.toMatch(/[–—]/);
  });

  it("has no lab jargon (this surface is jargon-guarded)", () => {
    const sentence = buildAaHonestySentence(row())!;
    expect(sentence).not.toMatch(/\b(baselines?|treatments?|reservations?|experiments?|controls?|SERP)\b/i);
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
