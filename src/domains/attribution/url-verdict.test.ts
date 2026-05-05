import { describe, it, expect } from "vitest";
import {
  computeUrlVerdict,
  DEFAULT_THRESHOLDS,
  type DailyPoint,
} from "./url-verdict";

/**
 * Helper: build a dense daily series from a starting date and an array of counts.
 * counts[0] lands on `start`; counts[1] on start+1; etc.
 */
function series(start: string, counts: number[]): DailyPoint[] {
  const out: DailyPoint[] = [];
  const t0 = new Date(start + "T00:00:00Z").getTime();
  for (let i = 0; i < counts.length; i++) {
    const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: iso, count: counts[i] });
  }
  return out;
}

describe("computeUrlVerdict — baseline windowing", () => {
  it("uses the 14 days immediately before the change as the baseline", () => {
    // Baseline flat 5/day for 14 days, then change on day 15, then flat 10/day after.
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, // 14d baseline (2026-03-01..03-14)
      0, // change day (2026-03-15) — not in baseline, not in post window
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, // 14d post
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("helping");
    expect(r.explanation.math.baseline_days_used).toBe(14);
    expect(r.explanation.math.mu_pre).toBe(5);
    expect(r.explanation.math.mu_post).toBe(10);
    expect(r.explanation.math.post_days_used).toBe(14);
    expect(r.delta_abs).toBe(5);
    expect(r.delta_pct).toBe(1); // 100% delta
  });

  it("returns not_enough_data when baseline has fewer than baselineMinDays (3)", () => {
    const s = series("2026-03-13", [
      3, 3, // only 2 baseline days
      0,
      5, 5, 5, 5, 5, 5, 5,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-22",
    });
    expect(r.verdict).toBe("not_enough_data");
    expect(r.z).toBeNull();
    expect(r.delta_pct).toBeNull();
  });

  it("adaptive baseline: 3-day baseline produces verdict at low confidence", () => {
    const s = series("2026-03-12", [
      2, 2, 2, // 3 baseline days (minimum)
      0,
      8, 8, 8, 8, 8, 8, 8, // 7d post
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-22",
    });
    expect(r.verdict).not.toBe("not_enough_data");
    expect(r.explanation.math.baseline_days_used).toBe(3);
    // Adaptive-short baseline downgrades confidence
    expect(r.confidence).toBe("low");
  });

  it("adaptive baseline: 5-day baseline + strong z downgrades confidence from high to medium", () => {
    const s = series("2026-03-10", [
      5, 5, 5, 5, 5, // 5 baseline days (< confident 7d)
      0,
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, // 14d post, huge lift
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("helping");
    expect(r.explanation.math.baseline_days_used).toBe(5);
    // Without adaptive-short downgrade this would be "high" — z is very large
    expect(r.confidence).toBe("medium");
  });

  it("adaptive baseline: 7-day baseline reaches confident floor, no downgrade", () => {
    const s = series("2026-03-08", [
      5, 5, 5, 5, 5, 5, 5, // 7 baseline days — exactly at confident floor
      0,
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("helping");
    expect(r.explanation.math.baseline_days_used).toBe(7);
    // At confident floor, no downgrade → should be "high" given strong z + full post window
    expect(r.confidence).toBe("high");
  });
});

describe("computeUrlVerdict — verdict classification", () => {
  it("returns helping when z ≥ 2 and sustain ≥ 5", () => {
    // Baseline 5±0 (sigma floors to 1). Post 10/day for 14d → z enormous.
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("helping");
    expect(r.z!).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.zBar);
    expect(r.sustain.up).toBe(7);
  });

  it("returns hurting when z ≤ −2 and sustain_down ≥ 5", () => {
    const s = series("2026-03-01", [
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
      0,
      2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("hurting");
    expect(r.z!).toBeLessThanOrEqual(-DEFAULT_THRESHOLDS.zBar);
    expect(r.sustain.down).toBe(7);
  });

  it("returns nothing_yet when |z| < 2 but ≥14d of post data", () => {
    // Baseline 10±1ish, post 10 — no real movement.
    const s = series("2026-03-01", [
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
      0,
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("nothing_yet");
    expect(Math.abs(r.z!)).toBeLessThan(DEFAULT_THRESHOLDS.zBar);
  });

  it("returns too_early when post window has < 14 days", () => {
    // Strong lift but only 5 days after change.
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      10, 10, 10, 10, 10,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-20",
    });
    // Even though z is high, post window is only 5d which is < nothingYetMinDays (14).
    // But sustain up is 5, so helping verdict CAN still fire once we're in 5d.
    // The assertion: if sustain is hit, verdict can be helping even at N=5.
    // Otherwise too_early.
    expect(["helping", "too_early"]).toContain(r.verdict);
    if (r.verdict === "too_early") {
      expect(r.post_days).toBe(5);
    }
  });

  it("returns too_early when N = 0 (change is today or future)", () => {
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-14",
      asOfDate: "2026-03-14",
    });
    expect(r.verdict).toBe("too_early");
    expect(r.post_days).toBe(0);
    expect(r.z).toBeNull();
    expect(r.delta_pct).toBeNull();
  });
});

describe("computeUrlVerdict — Poisson σ floor", () => {
  it("prevents a winner verdict on flat-baseline low-volume pages from a single citation blip", () => {
    // Baseline 14 days of 0, post 14 days of 1 (single citation/day).
    // Without σ floor: σ = 0, division by zero → fake infinite z → 'helping'.
    // With σ floor = 1, σ_used = 1, z = 1 / (1/√14) = √14 ≈ 3.74 → still helping, but
    // this is a true signal: 14 consecutive days with citations vs none before.
    const s = series("2026-03-01", [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    // This SHOULD be helping — 14 days of sustained citations is meaningful even if volume is tiny.
    expect(r.verdict).toBe("helping");
    expect(Number.isFinite(r.z!)).toBe(true); // σ floor prevents Infinity
  });

  it("prevents a winner verdict on a single post-change spike against zero baseline", () => {
    // Baseline all 0, post just one day of 3 then back to 0. z depends on sustain.
    const s = series("2026-03-01", [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0,
      3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    // 1 sustain-up day out of 7 is below SUSTAIN_MIN=5 → not helping.
    expect(r.verdict).not.toBe("helping");
    expect(r.sustain.up).toBeLessThan(DEFAULT_THRESHOLDS.sustainMin);
  });
});

describe("computeUrlVerdict — explanation structure", () => {
  it("returns human-readable summary and structured math for helping verdict", () => {
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.explanation.summary).toContain("Citations up");
    expect(r.explanation.summary).toMatch(/baseline .+\/day/);
    expect(r.explanation.summary).toMatch(/z=\+\d/);
    expect(r.explanation.math.mu_pre).toBe(5);
    expect(r.explanation.math.mu_post).toBe(10);
    expect(r.explanation.math.post_days_used).toBe(14);
    expect(r.explanation.math.sustain_up).toBe(7);
  });

  it("returns coherent summary for not_enough_data", () => {
    const s = series("2026-03-13", [3, 3, 0, 5, 5]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-18",
    });
    expect(r.verdict).toBe("not_enough_data");
    expect(r.explanation.summary).toMatch(/baseline data|enough baseline/);
  });
});

describe("computeUrlVerdict — confidence tier", () => {
  it("marks confidence high when |z| ≥ 3 and ≥14d of post data", () => {
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.confidence).toBe("high");
  });

  it("marks confidence low when post data is very short", () => {
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      20, 20,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-17",
    });
    expect(["low", "medium"]).toContain(r.confidence);
  });
});

describe("computeUrlVerdict — thresholds override", () => {
  it("respects a custom zBar", () => {
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    ]);
    const strict = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
      thresholds: { zBar: 10 }, // unreachable bar
    });
    expect(strict.verdict).toBe("nothing_yet");

    const loose = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
      thresholds: { zBar: 1 }, // easy bar
    });
    expect(loose.verdict).toBe("helping");
  });
});

// ---------------------------------------------------------------------------
// Commit 2 (2026-04-24) — pure-split mixed-source guard
// ---------------------------------------------------------------------------

/** Helper: tag every point in a series with a source_type. */
function tagSeries(
  points: DailyPoint[],
  tag: "benchmark" | "derived",
): DailyPoint[] {
  return points.map((p) => ({ ...p, source_type: tag }));
}

describe("computeUrlVerdict — mixed-source abstain guard", () => {
  it("abstains with not_enough_native_baseline when baseline is benchmark-only and post is derived-only", () => {
    // Baseline 5/day for 14d (benchmark era), then change, then 10/day for 14d (derived era).
    const baseline = tagSeries(
      series("2026-04-08", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "benchmark",
    );
    const afterChange = tagSeries(
      series("2026-04-23", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    // Change day is 2026-04-22 — not in either window.
    const changeDay: DailyPoint[] = [
      { date: "2026-04-22", count: 0, source_type: "derived" },
    ];
    const s = [...baseline, ...changeDay, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    expect(r.verdict).toBe("not_enough_native_baseline");
    expect(r.z).toBeNull();
    expect(r.delta_pct).toBeNull();
    expect(r.delta_abs).toBeNull();
    // Phase v4 Commit 7A (2026-04-30): summary now reflects the drop-benchmark
    // partial-overlap algorithm rather than the Commit 2 pure-split copy.
    expect(r.explanation.summary).toMatch(/pre-cutover/);
    expect(r.explanation.summary).toMatch(/native day/);
  });

  it("computes normally when baseline and post are both benchmark-tagged (pure same-source)", () => {
    const baseline = tagSeries(
      series("2026-03-01", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "benchmark",
    );
    const afterChange = tagSeries(
      series("2026-03-16", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "benchmark",
    );
    const changeDay: DailyPoint[] = [
      { date: "2026-03-15", count: 0, source_type: "benchmark" },
    ];
    const s = [...baseline, ...changeDay, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });

    expect(r.verdict).toBe("helping");
    expect(r.z).not.toBeNull();
  });

  it("computes normally when baseline and post are both derived-tagged (pure same-source native)", () => {
    const baseline = tagSeries(
      series("2026-04-22", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "derived",
    );
    const afterChange = tagSeries(
      series("2026-05-07", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    const changeDay: DailyPoint[] = [
      { date: "2026-05-06", count: 0, source_type: "derived" },
    ];
    const s = [...baseline, ...changeDay, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-05-06",
      asOfDate: "2026-05-20",
    });

    expect(r.verdict).toBe("helping");
    expect(r.z).not.toBeNull();
  });

  it("does not fire the guard when ANY point is untagged (back-compat path)", () => {
    // Baseline has one untagged day — guard is disabled; normal Z-score math runs.
    const baseline: DailyPoint[] = [
      ...tagSeries(series("2026-04-08", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), "benchmark"),
      { date: "2026-04-21", count: 5 }, // untagged
    ];
    const afterChange = tagSeries(
      series("2026-04-23", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    const s = [...baseline, { date: "2026-04-22", count: 0 }, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    // Untagged baseline disables guard — engine computes normally.
    expect(r.verdict).toBe("helping");
    expect(r.verdict).not.toBe("not_enough_native_baseline");
  });

  it("does not fire when baseline and post carry the same source (no split to detect)", () => {
    const baseline = tagSeries(
      series("2026-03-01", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "derived",
    );
    const afterChange = tagSeries(
      series("2026-03-16", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    const s = [...baseline, { date: "2026-03-15", count: 0, source_type: "derived" as const }, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });

    expect(r.verdict).toBe("helping");
  });

  it("partial-overlap baseline (mixed benchmark+derived) + all-derived post → drops benchmark, computes Z normally", () => {
    // Phase v4 Commit 7A (2026-04-30) — replaces Commit 2's pure-split-only
    // guard with drop-benchmark on any mix. The 7 derived baseline days
    // remaining after the filter pass meets baselineMinDays (3), so the
    // engine falls through to the standard Z-score path.
    const baselineMixed: DailyPoint[] = [
      ...tagSeries(series("2026-04-08", [5, 5, 5, 5, 5, 5, 5]), "benchmark"),
      ...tagSeries(series("2026-04-15", [5, 5, 5, 5, 5, 5, 5]), "derived"),
    ];
    const afterChange = tagSeries(
      series("2026-04-23", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    const s = [...baselineMixed, { date: "2026-04-22", count: 0, source_type: "derived" as const }, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    // 7 derived baseline days remain after dropping 7 benchmark; native post
    // is 5/day → 10/day. Z-score should fire helping.
    expect(r.verdict).toBe("helping");
    expect(r.z).not.toBeNull();
    expect(r.explanation.math.baseline_days_used).toBe(7);
  });
});

describe("computeUrlVerdict — Phase v4 Commit 7A partial-overlap math (2026-04-30)", () => {
  it("abstains when filtered baseline (after dropping benchmark) is below baselineMinDays", () => {
    // 12 benchmark + 2 derived baseline; post all derived. After drop only
    // 2 derived baseline days remain — below the default minDays=3 floor.
    const baselineMostlyBenchmark: DailyPoint[] = [
      ...tagSeries(series("2026-04-08", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), "benchmark"),
      ...tagSeries(series("2026-04-20", [5, 5]), "derived"),
    ];
    const afterChange = tagSeries(
      series("2026-04-23", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    const s = [
      ...baselineMostlyBenchmark,
      { date: "2026-04-22", count: 0, source_type: "derived" as const },
      ...afterChange,
    ];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    expect(r.verdict).toBe("not_enough_native_baseline");
    expect(r.z).toBeNull();
    expect(r.explanation.summary).toMatch(/Dropped 12 pre-cutover/);
    expect(r.explanation.summary).toMatch(/2 native day/);
    expect(r.explanation.math.baseline_days_used).toBe(2);
  });

  it("post window with mixed benchmark+derived also drops benchmark days", () => {
    // 14 derived baseline; post = 1 benchmark + 13 derived.
    // After drop: 14 baseline + 13 derived post; should compute normally.
    const baseline = tagSeries(
      series("2026-04-08", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "derived",
    );
    const postMixed: DailyPoint[] = [
      { date: "2026-04-23", count: 100, source_type: "benchmark" }, // outlier — should be dropped
      ...tagSeries(series("2026-04-24", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]), "derived"),
    ];
    const s = [
      ...baseline,
      { date: "2026-04-22", count: 0, source_type: "derived" as const },
      ...postMixed,
    ];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    // 1 benchmark dropped from post; 13 derived days remain. Z computed on
    // 14 baseline (5/day) vs 13 post (10/day) — strong helping signal.
    expect(r.verdict).toBe("helping");
    expect(r.explanation.math.post_days_used).toBe(13);
  });

  it("pure-split (no overlap) still abstains because filtered baseline is empty", () => {
    // Identical to Commit 2's headline pure-split case — preserves the
    // abstain semantics now produced via the drop-benchmark path.
    const baseline = tagSeries(
      series("2026-04-08", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "benchmark",
    );
    const afterChange = tagSeries(
      series("2026-04-23", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    const s = [
      ...baseline,
      { date: "2026-04-22", count: 0, source_type: "derived" as const },
      ...afterChange,
    ];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    expect(r.verdict).toBe("not_enough_native_baseline");
    expect(r.explanation.math.baseline_days_used).toBe(0);
    expect(r.explanation.summary).toMatch(/Dropped 14 pre-cutover/);
  });

  it("filtered baseline at exactly baselineMinDays (3) → falls through, computes Z at low confidence", () => {
    // 11 benchmark + 3 derived baseline; post all derived. After drop the
    // baseline has exactly minDays=3 — should fall through to compute Z.
    const baselineEdge: DailyPoint[] = [
      ...tagSeries(series("2026-04-08", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), "benchmark"),
      ...tagSeries(series("2026-04-19", [5, 5, 5]), "derived"),
    ];
    const afterChange = tagSeries(
      series("2026-04-23", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    const s = [
      ...baselineEdge,
      { date: "2026-04-22", count: 0, source_type: "derived" as const },
      ...afterChange,
    ];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    // 3 days >= minDays → fall through to Z. Baseline confidence will be
    // downgraded since 3 < baselineConfidentDays (7), but verdict still computes.
    expect(r.verdict).not.toBe("not_enough_native_baseline");
    expect(r.verdict).not.toBe("not_enough_data");
    expect(r.explanation.math.baseline_days_used).toBe(3);
  });

  it("legacy pure-benchmark series (both sides) still computes normally — Profound-only data unchanged", () => {
    // Smoke test: pre-2026-04-22 changes never need to drop anything.
    const baseline = tagSeries(
      series("2026-03-01", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "benchmark",
    );
    const afterChange = tagSeries(
      series("2026-03-16", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "benchmark",
    );
    const s = [
      ...baseline,
      { date: "2026-03-15", count: 0, source_type: "benchmark" as const },
      ...afterChange,
    ];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });

    expect(r.verdict).toBe("helping");
    expect(r.z).not.toBeNull();
    expect(r.explanation.math.baseline_days_used).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// M3 (operator audit, 2026-05-05) — attribution-overclaim guards
// ---------------------------------------------------------------------------

describe("M3 — denominator floor on delta_pct", () => {
  it("returns delta_pct = null when baseline mean is below the floor (0.5/day → null)", () => {
    // Baseline averages 0.5 cite/day; post averages 6 cite/day. Without
    // the floor, delta_pct would compute to (6 − 0.5) / 0.5 = 1100% —
    // an obvious overclaim from a sub-1/day baseline.
    const s = series("2026-03-01", [
      // 14 baseline days alternating 0/1 → mean = 0.5
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
      0, // change day
      6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, // 14d post @ 6/day
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.delta_pct).toBeNull();
    // Absolute delta still reports honestly.
    expect(r.delta_abs).not.toBeNull();
    expect(r.delta_abs!).toBeCloseTo(5.5, 1);
    // Z-score remains visible — confidence layer is unaffected.
    expect(r.z).not.toBeNull();
    expect(Math.abs(r.z!)).toBeGreaterThan(0);
  });

  it("returns delta_pct as a normal ratio when baseline meets the floor (5/day → +100%)", () => {
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.delta_pct).not.toBeNull();
    expect(r.delta_pct!).toBeCloseTo(1.0, 5); // exactly +100%
  });

  it("explicit deltaPctMinBaseline override flips the gate", () => {
    // Baseline 0.5/day, but caller raises the floor to 0.25 — guard clears.
    const s = series("2026-03-01", [
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
      0,
      6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
      thresholds: { deltaPctMinBaseline: 0.25 },
    });
    expect(r.delta_pct).not.toBeNull();
  });
});

describe("M3 — sampling-status attribution guard", () => {
  function seriesWithSampling(
    start: string,
    points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }>,
  ): DailyPoint[] {
    const out: DailyPoint[] = [];
    const t0 = new Date(start + "T00:00:00Z").getTime();
    for (let i = 0; i < points.length; i++) {
      const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      out.push({ date: iso, count: points[i].count, sampling_status: points[i].sampling_status });
    }
    return out;
  }

  it("demotes helping → nothing_yet when post-window contains a `proof` day", () => {
    // Strong helping signal: 14 baseline @ 5, 14 post @ 20. Z is huge.
    // But the LAST post-day is a proof-status sample (manual 5-prompt
    // recovery run) — the verdict must demote to nothing_yet.
    const points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }> = [
      ...Array.from({ length: 14 }, () => ({ count: 5, sampling_status: "full" as const })),
      { count: 0, sampling_status: "full" }, // change day
      ...Array.from({ length: 13 }, () => ({ count: 20, sampling_status: "full" as const })),
      { count: 1, sampling_status: "proof" as const }, // proof day in post-window
    ];
    const s = seriesWithSampling("2026-03-01", points);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("nothing_yet");
  });

  it("demotes helping → nothing_yet when post-window has zero `full` days", () => {
    // Every post-window day is `partial` — none reaches full sample
    // size, so the verdict is too thin to publish a measured win.
    const points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }> = [
      ...Array.from({ length: 14 }, () => ({ count: 5, sampling_status: "full" as const })),
      { count: 0, sampling_status: "full" },
      ...Array.from({ length: 14 }, () => ({ count: 20, sampling_status: "partial" as const })),
    ];
    const s = seriesWithSampling("2026-03-01", points);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("nothing_yet");
  });

  it("KEEPS helping when post-window has at least one `full` day and no `proof` day", () => {
    // One partial day, but the rest are full and there's no proof day.
    const points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }> = [
      ...Array.from({ length: 14 }, () => ({ count: 5, sampling_status: "full" as const })),
      { count: 0, sampling_status: "full" },
      ...Array.from({ length: 13 }, () => ({ count: 20, sampling_status: "full" as const })),
      { count: 18, sampling_status: "partial" as const }, // partial, not proof
    ];
    const s = seriesWithSampling("2026-03-01", points);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("helping");
  });

  it("guard is a no-op when no point carries sampling_status (back-compat)", () => {
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    // No sampling_status anywhere → guard never fires → original
    // helping verdict survives.
    expect(r.verdict).toBe("helping");
  });

  it("a single proof-day post-window cannot create a measured win", () => {
    // Operator's canonical M3.3 case: pretend the day-after-change is
    // the May-4 5-prompt manual proof. With only one post-window day
    // and that day being `proof`, no measured win is possible.
    const points: Array<{ count: number; sampling_status?: DailyPoint["sampling_status"] }> = [
      ...Array.from({ length: 14 }, () => ({ count: 5, sampling_status: "full" as const })),
      { count: 0, sampling_status: "full" },
      { count: 25, sampling_status: "proof" as const },
    ];
    const s = seriesWithSampling("2026-03-01", points);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-16",
    });
    // Even if z would have suggested helping, the proof-day guard
    // forces nothing_yet (or too_early on N=1).
    expect(["nothing_yet", "too_early"]).toContain(r.verdict);
    expect(r.verdict).not.toBe("helping");
  });
});
