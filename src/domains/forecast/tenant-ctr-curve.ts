/**
 * tenant-ctr-curve (BEACON_500 R9 / P3, 2026-07-03) - the ONE position-to-clicks model.
 *
 * Before this module, FIVE rival position-to-CTR tables lived across the codebase
 * (pick-expectations.ts, daily-experiment-planner.ts, recommendation-intelligence/
 * ctr-curve.ts, triggers/gsc-low-ctr.ts, page-surgeon/expected-ctr.ts), each with
 * slightly different numbers, and none of them learned from the tenant's OWN data.
 * This module consolidates all of them:
 *
 *  - DEFAULT_CTR_BY_POSITION / defaultExpectedCtrAt: the single industry default,
 *    byte-identical to the values pick-expectations.ts and the daily planner have
 *    always used, so every consumer that passes no tenant curve behaves EXACTLY
 *    as before (pinned by tests).
 *  - SEMRUSH_TOP5_CTR: the sourced positions-1-to-5 benchmark the gsc_low_ctr
 *    trigger calibrates against (Semrush Dec 2025). Kept as a NAMED, separate
 *    table because it is research-derived trigger calibration with citations,
 *    not a forecast assumption - but it now lives here so there is one file to
 *    read when asking "what CTR does Beacon assume".
 *  - fitTenantCtrCurve: fits a position-to-CTR curve from the tenant's OWN
 *    Search Console query aggregates (per-bucket median CTR with honest sample
 *    floors, brand queries excluded), interpolating thin buckets and falling
 *    back to the industry default with an honest basis tag when the tenant does
 *    not have enough of their own data yet.
 *
 * Customer copy rule: the basis strings here are plain English ("your own search
 * data", "industry default"), never lab words. Surfaces render them as "based on
 * how your own pages convert position to clicks".
 *
 * PURE, no I/O. The loader edge is load-tenant-ctr-curve.ts.
 */

/** The single industry-default organic CTR by integer position (1-10). These are
 *  EXACTLY the values pick-expectations.ts's CTR_CURVE has always used - the
 *  default path everywhere must stay byte-identical (pinned by tests). */
export const DEFAULT_CTR_BY_POSITION: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.065, 6: 0.05, 7: 0.04, 8: 0.034, 9: 0.029, 10: 0.025,
};

/** Tail bands past position 10 (same values expectedCtrAt has always returned). */
const TAIL_11_15 = 0.018;
const TAIL_16_20 = 0.012;
const TAIL_21_PLUS = 0.006;

/** The industry-default expected organic CTR at a Google position. Byte-identical
 *  to the pre-R9 pick-expectations.ts expectedCtrAt for every input. */
export function defaultExpectedCtrAt(position: number): number {
  const p = Math.round(position);
  if (p <= 0) return DEFAULT_CTR_BY_POSITION[1]!;
  if (p <= 10) return DEFAULT_CTR_BY_POSITION[p]!;
  if (p <= 15) return TAIL_11_15;
  if (p <= 20) return TAIL_16_20;
  return TAIL_21_PLUS;
}

/** Semrush (Dec 2025) per-position organic CTR benchmarks, positions 1-5 only
 *  (the band the source covers). This is the gsc_low_ctr trigger's calibration
 *  table (moved here from triggers/gsc-low-ctr.ts, which re-exports it) - a
 *  sourced benchmark for "is this page underperforming its rank", deliberately
 *  distinct from the forecast default above. */
export const SEMRUSH_TOP5_CTR: Record<number, number> = {
  1: 0.398,
  2: 0.187,
  3: 0.102,
  4: 0.072,
  5: 0.051,
};

// ---------------------------------------------------------------------------
// The tenant curve
// ---------------------------------------------------------------------------

/** One query's window aggregate (page+query grain is fine - each row is one
 *  "this ranked around position P and clicked at rate C" observation). */
export type QueryCtrAggregate = {
  query: string;
  clicks: number;
  impressions: number;
  /** Impressions-weighted average position over the window (1-based). */
  position: number;
};

export type TenantCtrCurve = {
  /** Expected organic CTR at a (possibly fractional) Google position. */
  expectedCtrAt: (position: number) => number;
  /** "tenant" = fitted from the tenant's own search data; "default" = the
   *  industry default (not enough of their own data yet). */
  source: "tenant" | "default";
  /** Plain-English basis for customer copy. Never a lab word, never a dash. */
  basis: string;
  /** ISO timestamp of the fit. */
  fittedAt: string;
  /** Distinct queries the fit saw (0 on the default curve). */
  queries: number;
  /** Total impressions the fit saw (0 on the default curve). */
  impressions: number;
};

export const DEFAULT_CURVE_BASIS = "industry default (not enough of your own data yet)";

/** A bucket needs at least this many impressions before its median is trusted. */
export const BUCKET_MIN_IMPRESSIONS = 200;
/** ...across at least this many query observations. */
export const BUCKET_MIN_QUERIES = 5;
/** The whole fit needs at least this many trustworthy buckets, else the tenant
 *  does not have enough of their own data yet and the default curve applies. */
export const MIN_FITTED_BUCKETS = 3;

/** Position buckets: integer positions 1-10 individually, then the same coarse
 *  tail bands the default curve uses (11-15, 16-20, 21+). `rep` is the
 *  representative position used for interpolation between fitted buckets. */
type BucketDef = { rep: number; defaultCtr: number };
const BUCKETS: BucketDef[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ rep: i + 1, defaultCtr: DEFAULT_CTR_BY_POSITION[i + 1]! })),
  { rep: 13, defaultCtr: TAIL_11_15 },
  { rep: 18, defaultCtr: TAIL_16_20 },
  { rep: 25, defaultCtr: TAIL_21_PLUS },
];

function bucketIndexFor(position: number): number {
  const p = Math.round(position);
  if (p <= 1) return 0;
  if (p <= 10) return p - 1;
  if (p <= 15) return 10;
  if (p <= 20) return 11;
  return 12;
}

/** Brand tokens from the tenant's name ("Ritz Builders" -> ["ritz builders",
 *  "ritz"]) - the same shape answer-intelligence uses. Empty name -> no tokens. */
export function brandTokensFor(brandName: string | null | undefined): string[] {
  const full = (brandName ?? "").toLowerCase().trim();
  if (!full) return [];
  const tokens = [full];
  const words = full.split(/\s+/);
  if (words.length > 1 && words[0]!.length >= 3) tokens.push(words[0]!);
  return tokens;
}

/** A brand query clicks like a brand query (position 1, huge CTR) regardless of
 *  how well the page converts its rank - it must not teach the curve. */
export function isBrandQuery(query: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const q = query.toLowerCase();
  return tokens.some((t) => q.includes(t));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Sanity clamp on a fitted bucket value - a median CTR outside this band is a
 *  data artifact, not a click-through rate worth forecasting with. */
function clampCtr(v: number): number {
  return Math.min(0.95, Math.max(0.0005, v));
}

/** The always-available industry-default curve, honestly tagged. */
export function defaultCtrCurve(now: Date = new Date()): TenantCtrCurve {
  return {
    expectedCtrAt: defaultExpectedCtrAt,
    source: "default",
    basis: DEFAULT_CURVE_BASIS,
    fittedAt: now.toISOString(),
    queries: 0,
    impressions: 0,
  };
}

/**
 * Fit the tenant's own position-to-CTR curve from their Search Console query
 * aggregates. PURE.
 *
 * Fit rules:
 *  - brand queries excluded (they click like navigation, not like a rank)
 *  - rows bucketed by rounded position (1-10 individually, then 11-15 / 16-20 / 21+)
 *  - a bucket is trusted only with >= BUCKET_MIN_IMPRESSIONS impressions across
 *    >= BUCKET_MIN_QUERIES query observations; its value is the median CTR
 *  - an untrusted bucket between two trusted ones is linearly interpolated on
 *    position; an untrusted edge bucket falls back to the industry default value
 *  - fewer than MIN_FITTED_BUCKETS trusted buckets = not enough of the tenant's
 *    own data yet: the whole curve is the industry default, honestly tagged
 */
export function fitTenantCtrCurve(
  rows: readonly QueryCtrAggregate[],
  opts: { brandName?: string | null; now?: Date } = {},
): TenantCtrCurve {
  const now = opts.now ?? new Date();
  const tokens = brandTokensFor(opts.brandName);

  const usable = rows.filter(
    (r) =>
      Number.isFinite(r.impressions) &&
      r.impressions > 0 &&
      Number.isFinite(r.position) &&
      r.position >= 1 &&
      Number.isFinite(r.clicks) &&
      r.clicks >= 0 &&
      typeof r.query === "string" &&
      r.query.trim().length > 0 &&
      !isBrandQuery(r.query, tokens),
  );

  const byBucket: QueryCtrAggregate[][] = BUCKETS.map(() => []);
  for (const r of usable) byBucket[bucketIndexFor(r.position)]!.push(r);

  const fitted: Array<number | null> = byBucket.map((bucket) => {
    const impressions = bucket.reduce((s, r) => s + r.impressions, 0);
    if (impressions < BUCKET_MIN_IMPRESSIONS || bucket.length < BUCKET_MIN_QUERIES) return null;
    return clampCtr(median(bucket.map((r) => Math.min(1, r.clicks / r.impressions))));
  });

  const fittedCount = fitted.filter((v) => v != null).length;
  if (fittedCount < MIN_FITTED_BUCKETS) return defaultCtrCurve(now);

  // Fill untrusted buckets: interpolate between the nearest trusted neighbors,
  // else (no trusted neighbor on one side) use the industry default for that bucket.
  const values: number[] = fitted.map((v, i) => {
    if (v != null) return v;
    let lo = -1;
    for (let j = i - 1; j >= 0; j--) if (fitted[j] != null) { lo = j; break; }
    let hi = -1;
    for (let j = i + 1; j < fitted.length; j++) if (fitted[j] != null) { hi = j; break; }
    if (lo >= 0 && hi >= 0) {
      const span = BUCKETS[hi]!.rep - BUCKETS[lo]!.rep;
      const frac = span > 0 ? (BUCKETS[i]!.rep - BUCKETS[lo]!.rep) / span : 0.5;
      return fitted[lo]! + (fitted[hi]! - fitted[lo]!) * frac;
    }
    return BUCKETS[i]!.defaultCtr;
  });

  const queries = new Set(usable.map((r) => r.query.trim().toLowerCase())).size;
  const impressions = usable.reduce((s, r) => s + r.impressions, 0);

  return {
    expectedCtrAt: (position: number) => values[bucketIndexFor(position)]!,
    source: "tenant",
    basis: `your own search data (${queries.toLocaleString("en-US")} queries, ${impressions.toLocaleString("en-US")} impressions)`,
    fittedAt: now.toISOString(),
    queries,
    impressions,
  };
}
