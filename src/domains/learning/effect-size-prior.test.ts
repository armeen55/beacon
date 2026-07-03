/**
 * effect-size-prior.test.ts (BEACON_500 R5 / N15, 2026-07-03) - pins the
 * magnitude-learning math: relative-lift extraction, recency half-life
 * weighting, normal shrinkage toward the site mean, the backoff ladder
 * (bucket -> lever -> site -> neutral), the [0.8, 1.3] clamp, the plain tag
 * wording (no dashes, no lab words), and the byte-identical-when-thin pin on
 * applyEffectSizePriorToMoves.
 */
import { describe, expect, it } from "vitest";

import {
  EFFECT_MIN_MULTIPLIER,
  EFFECT_MAX_MULTIPLIER,
  EFFECT_SHRINKAGE_WEIGHT,
  MIN_EFFECT_SAMPLES,
  MIN_BASELINE_CLICKS_FOR_RELATIVE,
  relativeClicksLift,
  recencyWeight,
  computeEffectSizeTable,
  resolveEffectPrior,
  effectCellKey,
  effectTag,
  applyEffectSizePriorToMoves,
  type EffectObservation,
} from "./effect-size-prior";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";

const NOW = new Date("2026-07-03T00:00:00Z");

const obs = (over: Partial<EffectObservation> = {}): EffectObservation => ({
  leverFamily: "answer_block",
  pageType: "iran-flags",
  relativeLift: 0.2,
  settledAt: "2026-07-03T00:00:00Z", // same instant as NOW -> weight exactly 1
  ...over,
});

describe("relativeClicksLift - honest magnitude extraction", () => {
  const win = (day: number, adjustedLift: number, ran = true) => ({ day, ran, adjustedLift });

  it("divides the basis window's adjusted lift by the window-scaled baseline clicks", () => {
    // 28d baseline of 100 clicks, 28d basis window, +12 clicks lift -> +12%.
    const rel = relativeClicksLift({
      windows: [win(28, 12)],
      baseline: { clicks: 100, windowDays: 28 },
    });
    expect(rel).toBeCloseTo(0.12, 10);
  });

  it("pro-rates the baseline to the basis window length (7d basis vs 28d baseline)", () => {
    // 28d baseline of 100 clicks -> 25 clicks over a 7d window; +5 lift -> +20%.
    const rel = relativeClicksLift({
      windows: [win(7, 5)],
      baseline: { clicks: 100, windowDays: 28 },
    });
    expect(rel).toBeCloseTo(0.2, 10);
  });

  it("uses the LONGEST closed window as the basis (28 beats 7)", () => {
    const rel = relativeClicksLift({
      windows: [win(7, 100), win(28, 10)],
      baseline: { clicks: 100, windowDays: 28 },
    });
    expect(rel).toBeCloseTo(0.1, 10);
  });

  it("returns null when no window has closed", () => {
    expect(
      relativeClicksLift({ windows: [win(7, 5, false)], baseline: { clicks: 100, windowDays: 28 } }),
    ).toBeNull();
  });

  it(`returns null when the window-scaled baseline is under ${MIN_BASELINE_CLICKS_FOR_RELATIVE} clicks (a percent of nothing is noise)`, () => {
    expect(
      relativeClicksLift({ windows: [win(28, 5)], baseline: { clicks: 2, windowDays: 28 } }),
    ).toBeNull();
    expect(relativeClicksLift({ windows: [win(28, 5)], baseline: null })).toBeNull();
  });

  it("clamps a wild outlier to +/-100 percent", () => {
    expect(
      relativeClicksLift({ windows: [win(28, 500)], baseline: { clicks: 10, windowDays: 28 } }),
    ).toBe(1);
    expect(
      relativeClicksLift({ windows: [win(28, -500)], baseline: { clicks: 10, windowDays: 28 } }),
    ).toBe(-1);
  });
});

describe("recencyWeight - ~90 day half-life", () => {
  it("weighs a fresh outcome at 1 and a 90-day-old outcome at 0.5", () => {
    expect(recencyWeight("2026-07-03T00:00:00Z", NOW)).toBeCloseTo(1, 10);
    expect(recencyWeight("2026-04-04T00:00:00Z", NOW)).toBeCloseTo(0.5, 5); // 90 days earlier
  });

  it("weighs a 180-day-old outcome at 0.25", () => {
    expect(recencyWeight("2026-01-04T00:00:00Z", NOW)).toBeCloseTo(0.25, 5);
  });

  it("gives an unparseable date full weight (never silently zeroes evidence)", () => {
    expect(recencyWeight("not-a-date", NOW)).toBe(1);
  });
});

describe("computeEffectSizeTable - shrinkage toward the site mean", () => {
  it("shrinks a bucket mean toward the site mean by EFFECT_SHRINKAGE_WEIGHT pseudo-observations", () => {
    // Bucket A: 3 observations at +0.5. Bucket B: 3 at -0.1.
    // Site mean (equal weights of 1): (3*0.5 + 3*(-0.1)) / 6 = 0.2.
    // Bucket A shrunken: (3*0.5 + K*0.2) / (3 + K) with K=3 -> (1.5 + 0.6) / 6 = 0.35.
    const observations = [
      ...Array.from({ length: 3 }, () => obs({ relativeLift: 0.5 })),
      ...Array.from({ length: 3 }, () => obs({ leverFamily: "edit_page", pageType: "cities", relativeLift: -0.1 })),
    ];
    const table = computeEffectSizeTable(observations, NOW);
    expect(table.site?.mean).toBeCloseTo(0.2, 10);
    const cellA = table.cells.get(effectCellKey("answer_block", "iran-flags"));
    expect(cellA?.mean).toBeCloseTo(0.5, 10);
    expect(cellA?.shrunken).toBeCloseTo(
      (3 * 0.5 + EFFECT_SHRINKAGE_WEIGHT * 0.2) / (3 + EFFECT_SHRINKAGE_WEIGHT),
      10,
    );
    const cellB = table.cells.get(effectCellKey("edit_page", "cities"));
    expect(cellB?.shrunken).toBeCloseTo((3 * -0.1 + 3 * 0.2) / 6, 10);
  });

  it("recency-weights the bucket mean (an old loss matters less than a fresh win)", () => {
    // One fresh +0.4 (weight 1) and one 90-day-old -0.4 (weight 0.5) plus a
    // third fresh +0.4 -> weighted mean = (0.4 + 0.4 - 0.2) / 2.5 = 0.24.
    const observations = [
      obs({ relativeLift: 0.4 }),
      obs({ relativeLift: 0.4 }),
      obs({ relativeLift: -0.4, settledAt: "2026-04-04T00:00:00Z" }),
    ];
    const table = computeEffectSizeTable(observations, NOW);
    const cell = table.cells.get(effectCellKey("answer_block", "iran-flags"));
    expect(cell?.mean).toBeCloseTo(0.24, 5);
  });

  it(`omits levels under ${MIN_EFFECT_SAMPLES} decided samples and nulls the site under the same floor`, () => {
    const thin = computeEffectSizeTable([obs(), obs()], NOW);
    expect(thin.site).toBeNull();
    expect(thin.cells.size).toBe(0);
    expect(thin.parents.size).toBe(0);

    // 3 total but split 2/1 across buckets: site fires, neither cell does.
    const split = computeEffectSizeTable(
      [obs(), obs(), obs({ pageType: "cities" })],
      NOW,
    );
    expect(split.site).not.toBeNull();
    expect(split.cells.size).toBe(0);
    expect(split.parents.get("answer_block")?.sample).toBe(3); // lever parent pools all 3
  });
});

describe("resolveEffectPrior - the backoff ladder", () => {
  const observations = [
    // answer_block x iran-flags: 3 strong wins.
    ...Array.from({ length: 3 }, () => obs({ relativeLift: 0.5 })),
    // edit_page (spread across page types so only the PARENT clears the bar).
    obs({ leverFamily: "edit_page", pageType: "cities", relativeLift: -0.3 }),
    obs({ leverFamily: "edit_page", pageType: "people", relativeLift: -0.3 }),
    obs({ leverFamily: "edit_page", pageType: "food", relativeLift: -0.3 }),
  ];
  const table = computeEffectSizeTable(observations, NOW);

  it("prefers the exact (lever x pageType) bucket", () => {
    const p = resolveEffectPrior({ leverFamily: "answer_block", pageType: "iran-flags" }, table);
    expect(p.basis).toBe("answer_block::iran-flags");
    expect(p.multiplier).toBeGreaterThan(1);
    expect(p.tag).toContain("iran flags pages");
    expect(p.tag).toContain("3 finished tests");
  });

  it("backs off to the lever parent when the exact bucket is thin", () => {
    const p = resolveEffectPrior({ leverFamily: "edit_page", pageType: "somewhere-new" }, table);
    expect(p.basis).toBe("edit_page");
    expect(p.multiplier).toBeLessThan(1);
    expect(p.tag).toMatch(/^Changes like this cost about \d+ percent of clicks/);
  });

  it("backs off to the site level with a NULL tag (self-hiding on cards)", () => {
    const p = resolveEffectPrior({ leverFamily: "create_page", pageType: "anything" }, table);
    expect(p.basis).toBe("site");
    expect(p.tag).toBeNull();
    expect(p.sample).toBe(6);
  });

  it("is neutral when the whole table is thin", () => {
    const thin = computeEffectSizeTable([obs()], NOW);
    const p = resolveEffectPrior({ leverFamily: "answer_block", pageType: "iran-flags" }, thin);
    expect(p).toEqual({ multiplier: 1, sample: 0, basis: null, tag: null });
  });

  it("clamps the multiplier to [0.8, 1.3] even on extreme shrunken effects", () => {
    const extremeUp = computeEffectSizeTable(
      Array.from({ length: 10 }, () => obs({ relativeLift: 1 })),
      NOW,
    );
    const up = resolveEffectPrior({ leverFamily: "answer_block", pageType: "iran-flags" }, extremeUp);
    expect(up.multiplier).toBe(EFFECT_MAX_MULTIPLIER);

    const extremeDown = computeEffectSizeTable(
      Array.from({ length: 10 }, () => obs({ relativeLift: -1 })),
      NOW,
    );
    const down = resolveEffectPrior({ leverFamily: "answer_block", pageType: "iran-flags" }, extremeDown);
    expect(down.multiplier).toBe(EFFECT_MIN_MULTIPLIER);
  });
});

describe("effectTag - plain language, no dashes, no lab words", () => {
  it("quotes the average percent and the finished-test count", () => {
    expect(effectTag(0.12, 4)).toBe(
      "Changes like this earned about +12 percent clicks on average across 4 finished tests",
    );
    expect(effectTag(-0.08, 3, "iran-flags")).toBe(
      "Changes like this on iran flags pages cost about 8 percent of clicks on average across 3 finished tests",
    );
    expect(effectTag(0.001, 5)).toBe("Changes like this barely moved clicks across 5 finished tests");
  });

  it("never emits an em or en dash or a lab word", () => {
    for (const tag of [effectTag(0.5, 3, "iran-flags"), effectTag(-0.5, 4), effectTag(0, 3)]) {
      expect(tag).not.toMatch(/[–—]/);
      expect(tag.toLowerCase()).not.toMatch(/posterior|shrink|bayes|prior|bucket|baseline|control/);
    }
  });
});

describe("applyEffectSizePriorToMoves - the post-score seam", () => {
  const move = (demandKey: string, score: number, gap = "answer_block", ownedUrl: string | null = "https://x.com/iran-flags/a"): MoveCandidate =>
    ({
      demandKey,
      label: demandKey,
      gap,
      score,
      components: { winnability: 0, dollarValue: 0, visibilityGap: 0, friction: 0 },
      confidence: "high",
      signals: [],
      ownedUrl,
      competitorUrls: [],
      fanoutSeeds: [],
      rationale: "",
    }) as unknown as MoveCandidate;

  const dims = (m: MoveCandidate) => ({
    leverFamily: m.gap,
    pageType: m.ownedUrl ? m.ownedUrl.replace(/^https?:\/\/[^/]+\//, "").split("/")[0] : undefined,
  });

  it("is BYTE-IDENTICAL (order + scores + fields) when no level has 3+ decided samples", () => {
    const moves = [move("a", 100), move("b", 90), move("c", 80)];
    const out = applyEffectSizePriorToMoves(moves, [obs(), obs()], dims, NOW);
    expect(out.map((m) => m.demandKey)).toEqual(["a", "b", "c"]);
    expect(out.map((m) => m.score)).toEqual([100, 90, 80]);
    expect(out.every((m) => m.effectPrior === undefined)).toBe(true);
  });

  it("re-ranks when a real bucket fired, attaching effectPrior, never touching components", () => {
    const moves = [
      move("loser-bucket", 100, "edit_page", "https://x.com/cities/one"),
      move("winner-bucket", 95, "answer_block", "https://x.com/iran-flags/two"),
    ];
    const observations = [
      ...Array.from({ length: 3 }, () => obs({ leverFamily: "answer_block", pageType: "iran-flags", relativeLift: 0.6 })),
      ...Array.from({ length: 3 }, () => obs({ leverFamily: "edit_page", pageType: "cities", relativeLift: -0.5 })),
    ];
    const out = applyEffectSizePriorToMoves(moves, observations, dims, NOW);
    expect(out[0]!.demandKey).toBe("winner-bucket");
    expect(out[0]!.effectPrior?.multiplier).toBeGreaterThan(1);
    expect(out[0]!.effectPrior?.tag).toContain("earned about");
    expect(out[1]!.effectPrior?.multiplier).toBeLessThan(1);
    expect(out[1]!.components).toEqual(moves[0]!.components); // the lie detector is untouched
  });

  it("attaches a tagless site-level prior on moves with no proven bucket", () => {
    const moves = [move("unproven", 50, "create_page", null)];
    const observations = Array.from({ length: 3 }, () => obs({ relativeLift: 0.4 }));
    const out = applyEffectSizePriorToMoves(moves, observations, dims, NOW);
    expect(out[0]!.effectPrior?.basis).toBe("site");
    expect(out[0]!.effectPrior?.tag).toBeNull();
  });
});
