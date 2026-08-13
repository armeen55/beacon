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
 *  - PUBLISHED_TOP5_CTR_BENCHMARK: the published positions-1-to-5 industry
 *    benchmark the gsc_low_ctr trigger calibrates against. Kept as a NAMED,
 *    separate table because it is research-derived trigger calibration, not a
 *    forecast assumption - but it now lives here so there is one file to read
 *    when asking "what CTR does Beacon assume".
 *  - fitTenantCtrCurve: fits a position-to-CTR curve from the tenant's OWN
 *    Search Console query rows. Clicks and views are POOLED per position band
 *    (never a median: a median throws away how much each search weighs), bands
 *    under an honest sample floor are not fitted at all, brand queries are
 *    excluded, and the fitted bands are forced decreasing by pooling adjacent
 *    violators rather than by clamping to the first one. Bands nobody measured
 *    are interpolated between the ones that were; off either end the industry
 *    table's SHAPE is scaled to this account. Falls back to the industry default
 *    with an honest basis tag when the tenant does not hold enough of their own
 *    data yet.
 *
 * Customer copy rule: the basis strings here are plain English ("your own search
 * data", "industry default"), never lab words. Surfaces render them as "based on
 * how your own pages convert position to clicks".
 *
 * PURE, no I/O. The loader edge is load-tenant-ctr-curve.ts.
 */

// R17a (P2 GSC depth pack): the brand-token logic R9 built here is now owned by
// the ONE canonical brand module (domains/evidence/gsc/brand-split.ts) so the CTR-curve
// fit and the brand/non-brand click split can never disagree on what counts as
// a brand query. Imported for the fit below and re-exported for existing
// consumers of this module - byte-identical behavior.
import { brandTokensFor, brandTokensForConfig, isBrandQuery } from "@/domains/evidence/gsc/brand-split";

export { brandTokensFor, isBrandQuery };

/** The single industry-default organic CTR by integer position (1-10). These are
 *  EXACTLY the values pick-expectations.ts's CTR_CURVE has always used - the
 *  default path everywhere must stay byte-identical (pinned by tests). */
const DEFAULT_CTR_BY_POSITION: Record<number, number> = {
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

// ---------------------------------------------------------------------------
// The tenant curve
// ---------------------------------------------------------------------------

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

/** ONE search of this account's own, over the window being fitted. `position` may be fractional (it is an
 *  impressions-weighted average) and is rounded into a band by the fit. */
export type CtrCurveRow = { query: string; position: number; impressions: number; clicks: number };

/**
 * POOL ADJACENT VIOLATORS (isotonic regression, decreasing). Walks the measured bands best position first and,
 * wherever a band pays MORE than the one above it, merges the two into their impressions-weighted average and
 * keeps merging backwards until the run decreases again. The result is the closest decreasing curve to what was
 * actually measured, so no band is dragged to a neighbour's number and no band survives claiming a worse
 * position pays better. PURE.
 */
function pooledDecreasing(points: ReadonlyArray<{ band: number; value: number; weight: number }>): Map<number, number> {
  const stack: Array<{ value: number; weight: number; bands: number[] }> = [];
  for (const p of points) {
    let block = { value: p.value, weight: Math.max(p.weight, 1), bands: [p.band] };
    while (stack.length > 0 && stack[stack.length - 1]!.value < block.value) {
      const prev = stack.pop()!;
      const weight = prev.weight + block.weight;
      block = { value: (prev.value * prev.weight + block.value * block.weight) / weight, weight, bands: [...prev.bands, ...block.bands] };
    }
    stack.push(block);
  }
  const out = new Map<number, number>();
  for (const b of stack) for (const band of b.bands) out.set(band, b.value);
  return out;
}

/** The bands the curve is fitted in: integer positions 1 to 10, then the two tail bands the default table
 *  has always used. Past 20 nothing is fitted, because nothing down there is worth planning against. */
const BANDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16] as const;
/** Which band a position falls in. Mirrors defaultExpectedCtrAt exactly, so a fitted curve and the default
 *  one answer the same question in the same shape. */
function bandOf(position: number): number | null {
  const p = Math.round(position);
  if (p <= 0) return 1;
  if (p <= 10) return p;
  if (p <= 15) return 11;
  if (p <= 20) return 16;
  return null;
}
/** How many views one band needs before this account's own rate is trusted over the industry one. Under it
 *  a single lucky search would set the bar every other search on the site is judged against. */
const MIN_BAND_IMPRESSIONS = 200;
/** The whole fit needs this many views behind it, or the account simply does not have its own curve yet. */
const MIN_FIT_IMPRESSIONS = 1_000;
/** AND THIS MANY DIFFERENT SEARCHES. Views alone are not a sample: fitted from one busy search, the curve
 *  says "position 4 earns exactly what this page earns at position 4", and the page's own shortfall defines
 *  the bar it is then judged against, so nothing can ever be found wrong with it. A curve is a claim about
 *  how an account converts position to clicks IN GENERAL, and it takes a spread of searches to make it. */
const MIN_FIT_QUERIES = 30;

/**
 * FIT THE CLICK CURVE TO THE ACCOUNT THAT IS BEING JUDGED BY IT.
 *
 * The industry default says a page at position 1 earns 28 percent of the clicks. On a site whose own
 * position-1 searches earn 1.34 percent, every gap measured against the default is roughly twenty times too
 * big, and the whole queue ranks on a number that could never be recovered. This is that repair: the bar a
 * search is held to is what THIS account's other searches actually earn at the same position.
 *
 * HOW: sum clicks and views per band; a band with at least MIN_BAND_IMPRESSIONS views is fitted to its own
 * rate. A band with too little of its own data takes the default table's SHAPE, scaled to how this account
 * converts position to clicks overall, because dropping a raw 28 percent into a curve whose neighbours sit
 * near 1 percent reintroduces the exact fantasy this function exists to end. Then the curve is forced to
 * decrease: a better position may never be worth fewer clicks than a worse one, whatever one thin band did.
 *
 * BRAND SEARCHES DO NOT TEACH THE CURVE. Somebody typing the business name clicks at rates no wording ever
 * earns, so leaving them in sets a bar no ordinary search can clear. Pass `brandTokens` to exclude them.
 *
 * Falls back to the untouched industry default (source "default") when the account does not hold enough of
 * its own data yet, which is an honest answer and the one every caller already handles.
 *
 * PURE. Deterministic for a fixed input.
 */
export function fitTenantCtrCurve(
  rows: readonly CtrCurveRow[],
  opts: { brandTokens?: readonly string[]; now?: Date } = {},
): TenantCtrCurve {
  const fittedAt = (opts.now ?? new Date()).toISOString();
  const tokens = opts.brandTokens ?? [];
  const byBand = new Map<number, { impressions: number; clicks: number }>();
  const queries = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const impressions = Number(r.impressions), clicks = Number(r.clicks);
    if (!Number.isFinite(impressions) || impressions <= 0 || !Number.isFinite(clicks) || clicks < 0) continue;
    if (!Number.isFinite(r.position) || r.position <= 0) continue;
    if (tokens.length > 0 && isBrandQuery(r.query ?? "", tokens)) continue;
    const band = bandOf(r.position);
    if (band == null) continue;
    const acc = byBand.get(band) ?? { impressions: 0, clicks: 0 };
    acc.impressions += impressions;
    acc.clicks += Math.min(clicks, impressions);
    byBand.set(band, acc);
    queries.add(r.query ?? "");
    total += impressions;
  }

  const fitted = new Map<number, number>();
  for (const band of BANDS) {
    const acc = byBand.get(band);
    if (acc && acc.impressions >= MIN_BAND_IMPRESSIONS) fitted.set(band, acc.clicks / acc.impressions);
  }
  if (total < MIN_FIT_IMPRESSIONS || queries.size < MIN_FIT_QUERIES || fitted.size === 0) {
    return { expectedCtrAt: defaultExpectedCtrAt, source: "default",
      basis: "the click rates pages at each position usually get", fittedAt, queries: 0, impressions: 0 };
  }

  // HOW THIS ACCOUNT CONVERTS POSITION TO CLICKS, as one number: its own clicks over the clicks the default
  // table predicts for the same positions. It is what carries a fitted band's honesty into a band too thin
  // to fit on its own.
  let ownClicks = 0, predicted = 0;
  for (const band of fitted.keys()) {
    const acc = byBand.get(band)!;
    ownClicks += acc.clicks;
    predicted += defaultExpectedCtrAt(band) * acc.impressions;
  }
  const scale = predicted > 0 ? ownClicks / predicted : 1;

  // MONOTONE BY POOLING, NEVER BY CLAMPING. A running ceiling let the FIRST band dictate every band under it:
  // live, position 1 measured 0.898 percent against 2.34 at position 2, 2.46 at 4 and 3.18 at 6, and the clamp
  // dragged all of them down to 0.898, so seven positions shared one wrong number and every gap under them
  // vanished. Position 1 is also the THINNEST band on most accounts, which is to say the noisiest. Pooling
  // adjacent violators replaces a run that disagrees with its own weighted average, which is the honest
  // reading of "these positions are not distinguishable on this account's data" and lets the run sit where
  // the evidence puts it rather than where its first member happens to.
  const anchors = pooledDecreasing(BANDS.filter((b) => fitted.has(b))
    .map((band) => ({ band, value: fitted.get(band)!, weight: byBand.get(band)!.impressions })));
  const known = BANDS.filter((b) => anchors.has(b));
  const curve = new Map<number, number>();
  for (const band of BANDS) {
    const at = anchors.get(band);
    if (at != null) { curve.set(band, at); continue; }
    const better = [...known].filter((b) => b < band).pop();
    const worse = known.find((b) => b > band);
    let value: number;
    if (better != null && worse != null) {
      // A straight line between the two bands actually measured, in band steps.
      const i0 = BANDS.indexOf(better), i1 = BANDS.indexOf(worse), i = BANDS.indexOf(band);
      value = anchors.get(better)! + ((i - i0) / (i1 - i0)) * (anchors.get(worse)! - anchors.get(better)!);
    } else {
      // Off the end of what was measured: the default table's SHAPE, scaled to this account, held inside the
      // nearest measured band so it can never cross it.
      value = defaultExpectedCtrAt(band) * scale;
      if (better != null) value = Math.min(value, anchors.get(better)!);
      if (worse != null) value = Math.max(value, anchors.get(worse)!);
    }
    curve.set(band, Math.max(0, value));
  }
  const tail = Math.min(curve.get(16) ?? TAIL_21_PLUS, TAIL_21_PLUS * scale);

  return {
    expectedCtrAt: (position: number) => {
      const band = bandOf(position);
      return band == null ? tail : curve.get(band) ?? tail;
    },
    source: "tenant",
    basis: "how your own pages turn a position into clicks",
    fittedAt,
    queries: queries.size,
    impressions: total,
  };
}


/**
 * THE CURVE FOR ONE ACCOUNT, off the searches an evidence snapshot already carries: no extra read, no dollars,
 * the same 90 day window. Brand searches are excluded, because no wording earns the rate somebody typing the
 * business name clicks at. This is the ONE call a decision pass makes, so every surface that measures a gap
 * measures it against the same bar.
 */
export function fitCurveForOwnedPages(
  pages: ReadonlyArray<{ search?: { topQueries: ReadonlyArray<{ query: string; impressions: number; clicks: number; position: number | null }> } | null }>,
  identity: { name?: string | null; domain?: string | null },
  now?: Date,
): TenantCtrCurve {
  return fitTenantCtrCurve(
    pages.flatMap((p) => (p.search?.topQueries ?? []).map((q) => ({ query: q.query, position: q.position ?? 0, impressions: q.impressions, clicks: q.clicks }))),
    { brandTokens: brandTokensForConfig(identity), ...(now ? { now } : {}) },
  );
}
