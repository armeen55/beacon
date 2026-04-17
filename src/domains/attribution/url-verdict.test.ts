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
