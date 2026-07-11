/**
 * Small pure statistics helpers for the validation harness. No I/O.
 */

import { rngFromString } from "./rng";

export function mean(xs: ReadonlyArray<number>): number {
  return xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Sample standard deviation (n - 1 denominator); 0 for n < 2. */
export function sampleStd(xs: ReadonlyArray<number>): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1);
  return Math.sqrt(v);
}

/** OLS slope of y over x = 0..n-1. 0 for n < 2. */
export function olsSlope(ys: ReadonlyArray<number>): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i]! - my);
    den += (i - mx) * (i - mx);
  }
  return den > 0 ? num / den : 0;
}

/** Percentile with linear interpolation between nearest ranks (mirrors
 *  aa-calibration.ts's percentile95 shape, generalized). Empty input is 0. */
export function percentileInterpolated(values: ReadonlyArray<number>, p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

export type Interval = { lower: number; upper: number };

/** Wilson score interval for a binomial proportion, two sided at z. */
export function wilsonInterval(hits: number, n: number, z: number = 1.96): Interval {
  if (n <= 0) return { lower: 0, upper: 1 };
  const p = hits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

/**
 * Date-block bootstrap interval for a placebo hit rate (protocol L2c):
 * resample CALENDAR BLOCKS (ship dates) with replacement, never individual
 * units, so shared-shock correlation inside a block survives into the
 * interval. Deterministic under seedString. Returns the percentile 95
 * percent interval of the resampled rates. Degenerate cases (no blocks, no
 * units) return [0, 1].
 */
export function blockBootstrapInterval(args: {
  /** For each unit: its calendar block id and whether it was a false positive. */
  units: ReadonlyArray<{ block: string; hit: boolean }>;
  resamples?: number;
  seedString: string;
}): Interval & { resamples: number } {
  const blocks = new Map<string, { hits: number; n: number }>();
  for (const u of args.units) {
    const b = blocks.get(u.block) ?? { hits: 0, n: 0 };
    b.n += 1;
    if (u.hit) b.hits += 1;
    blocks.set(u.block, b);
  }
  const blockList = [...blocks.values()];
  const B = args.resamples ?? 2000;
  if (blockList.length === 0 || args.units.length === 0) {
    return { lower: 0, upper: 1, resamples: B };
  }
  const rng = rngFromString(args.seedString);
  const rates: number[] = [];
  for (let i = 0; i < B; i++) {
    let hits = 0;
    let n = 0;
    for (let j = 0; j < blockList.length; j++) {
      const pick = blockList[Math.floor(rng() * blockList.length)]!;
      hits += pick.hits;
      n += pick.n;
    }
    rates.push(n > 0 ? hits / n : 0);
  }
  return {
    lower: percentileInterpolated(rates, 0.025),
    upper: percentileInterpolated(rates, 0.975),
    resamples: B,
  };
}

/** Two-sided empirical permutation p with the add-one correction:
 *  p = (1 + #{|null| >= |stat|}) / (1 + n). Valid (never 0) and unit-safe
 *  because callers must pass nulls in the SAME unit as stat (protocol C6). */
export function permutationP(stat: number, nullStats: ReadonlyArray<number>): number {
  const target = Math.abs(stat);
  let ge = 0;
  for (const s of nullStats) if (Math.abs(s) >= target) ge += 1;
  return (1 + ge) / (1 + nullStats.length);
}

/** Variance-stabilizing transform for the clicks lane (protocol L8):
 *  log(x + 1). Monotone increasing; pinned by tests. */
export function log1pSafe(x: number): number {
  return Math.log(Math.max(0, x) + 1);
}
