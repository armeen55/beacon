/**
 * sibling-ctr-basis (Wave 4 G8, 2026-07-11) - honest impact ranges on THIN history.
 *
 * THE GAP (pilot, verbatim): opportunity-math.ts abstains ("not enough history to size this
 * yet") on a clicks-tone move whenever the TARGET page has no positive CTR-curve gap against the
 * industry-default curve at its own position - even when the tenant's OWN sibling pages, ranking
 * at a comparable Google position, already prove a defensible, tenant-specific CTR band the
 * target page falls well short of. A real example: /famous-iranian-singers earns 0.76 percent
 * CTR at 4,765 monthly impressions while several of the tenant's OWN similarly-ranked list pages
 * earn 3.8 to 5.9 percent - a real, defensible gap opportunity-math.ts's single-page comparison
 * cannot see, because it only compares this page against the industry-default curve, never
 * sideways against this tenant's own other pages at the same rank.
 *
 * THIS MODULE is a SECOND, INDEPENDENT basis - never a replacement for opportunity-math.ts, and
 * never a ranking input. A caller (build-canonical-changes.ts) reaches for it ONLY when
 * opportunity-math.ts's own forecast is unsized for a clicks-tone move; the sized/basis output
 * here rides on canonical-change.ts's siblingBasis/siblingLowPerMonth/siblingHighPerMonth fields,
 * which impactScore, demoteUnsized, and strategy.ts's ranking never read - display + decision
 * support only, exactly as the operator spec requires this slice.
 *
 * THE RULE (every floor justified):
 *  - QUALIFYING SIBLINGS: the tenant's OWN other pages, within +/-SIBLING_POSITION_BAND (3)
 *    Google positions of the target - close enough that "how do pages at roughly this rank
 *    convert" is a fair comparison, not a different SERP intent band entirely.
 *  - each qualifying sibling needs >= SIBLING_MIN_IMPRESSIONS_28D (500) monthly impressions - the
 *    SAME material-impressions floor the caller already requires of the TARGET page before
 *    attempting this basis at all, so the evidence backing the comparison is never thinner than
 *    the evidence gating the claim itself.
 *  - each qualifying sibling needs CTR >= SIBLING_HEALTHY_CTR_FLOOR (1 percent) - excludes a
 *    sibling that is itself a broken/zero-click page (an image-intent or already-answered-on-
 *    the-SERP query, the same shape G2's zero-click-trap gate excludes elsewhere) from setting
 *    the bar; a broken sibling is not evidence of what a healthy page at this rank earns.
 *  - needs >= SIBLING_MIN_QUALIFYING (3) qualifying siblings, else this returns null and the
 *    caller's existing honest abstention stands, completely unchanged.
 *  - the band is CONSERVATIVE-TO-BASE: the 25th percentile to the median of qualifying siblings'
 *    CTRs, never the full spread and never above the single best sibling (percentile math
 *    guarantees the median can never exceed the maximum) - so the low end assumes this page only
 *    catches up to a below-average sibling, and the high end assumes it catches up to a typical
 *    one, never the tenant's single best-performing page.
 *  - range = (band - ownCtr) x ownImpressions28d, FLOORED AT 0 on both ends - never a negative
 *    promise. When the target already matches or beats the band's own high end, this returns the
 *    honest "already ahead" sentence instead of a range (still transparent, never silent).
 *
 * PURE, no I/O. Beacon voice in the rendered `basis`: plain words, always real numbers, no dash.
 */

export type SiblingPageStat = {
  /** Normalized page identity, used only to exclude the target page from its own sibling pool. */
  page: string;
  /** Google's average position for this sibling's own top query. */
  position: number;
  /** This sibling's own click-through rate (0..1) at that position. */
  ctr: number;
  /** This sibling's own monthly (28-day-equivalent) impressions for that query. */
  impressions28d: number;
};

/** How close (in Google positions) a sibling must rank to count as "a comparable position". */
export const SIBLING_POSITION_BAND = 3;
/** The material-impressions floor for a sibling - the SAME floor the caller applies to the
 *  target page before attempting this basis at all (see build-canonical-changes.ts). */
export const SIBLING_MIN_IMPRESSIONS_28D = 500;
/** A sibling below this CTR is itself a likely broken/zero-click page, not healthy comparison
 *  evidence - comfortably below the industry-default curve's own worst modeled rate (2.5 percent
 *  at position 10) while still well above true zero-click territory. */
export const SIBLING_HEALTHY_CTR_FLOOR = 0.01;
/** Fewer than this many qualifying siblings is not a defensible pattern - could be one outlier
 *  page, not "how pages like this one convert". */
export const SIBLING_MIN_QUALIFYING = 3;

export type SiblingCtrBasis = {
  /** Null exactly when the target page already matches or beats its own siblings' typical rate
   *  at this position (the honest "already ahead" case) - never a negative promise. */
  lowPerMonth: number | null;
  highPerMonth: number | null;
  /** Always present once >= SIBLING_MIN_QUALIFYING siblings qualify - the plain-English
   *  comparison, Beacon voice, always naming real numbers (never a lab word, never a dash). */
  basis: string;
  /** How many of the tenant's own pages backed this comparison. */
  siblingCount: number;
};

/** Round to a friendly number, same convention as opportunity-math.ts/pick-expectations.ts, so a
 *  sibling-sized range never reads differently shaped than a curve-sized one. */
function friendly(n: number): number {
  if (n >= 100) return Math.round(n / 10) * 10;
  if (n >= 10) return Math.round(n / 5) * 5;
  return Math.round(n);
}

/** Standard linear-interpolation percentile (numpy's default "linear" method) over an ALREADY
 *  sorted-ascending array. `p` in [0,1]. Pure, deterministic, exported for direct testing. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * frac;
}

/** One decimal, trailing ".0" trimmed ("4.0" -> "4", "0.76" -> "0.8") - the same shape the
 *  operator's own by-hand math reads in. */
function pct(fraction: number): string {
  const s = (fraction * 100).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * The tenant's OWN other pages within the position band, above both honesty floors. PURE,
 * exported for direct testing. Never includes the target page itself.
 */
export function qualifyingSiblings(
  ownPage: string,
  ownPosition: number,
  siblings: readonly SiblingPageStat[],
): SiblingPageStat[] {
  return siblings.filter(
    (s) =>
      s.page !== ownPage &&
      Number.isFinite(s.position) &&
      Math.abs(s.position - ownPosition) <= SIBLING_POSITION_BAND &&
      Number.isFinite(s.ctr) &&
      s.ctr >= SIBLING_HEALTHY_CTR_FLOOR &&
      Number.isFinite(s.impressions28d) &&
      s.impressions28d >= SIBLING_MIN_IMPRESSIONS_28D,
  );
}

/**
 * The canonical sibling-CTR-basis entry point. Null when there is no defensible pattern to size
 * from (fewer than SIBLING_MIN_QUALIFYING qualifying siblings, or a target page with no own
 * position/impressions to compare) - the caller's existing honest abstention stands, unchanged.
 */
export function computeSiblingCtrBasis(input: {
  /** The target page's own normalized identity (excluded from its own sibling pool). */
  ownPage: string;
  ownPosition: number;
  ownCtr: number;
  /** The target page's own monthly (28-day-equivalent) impressions. Must already clear the
   *  caller's material-impressions gate (>= 500) - this function re-checks it defensively. */
  ownImpressions28d: number;
  /** Every other candidate sibling this tenant has (not yet filtered to the position band or
   *  the honesty floors - qualifyingSiblings does that here). */
  siblings: readonly SiblingPageStat[];
}): SiblingCtrBasis | null {
  if (
    !Number.isFinite(input.ownPosition) ||
    !Number.isFinite(input.ownCtr) ||
    !Number.isFinite(input.ownImpressions28d) ||
    input.ownImpressions28d < SIBLING_MIN_IMPRESSIONS_28D
  ) {
    return null;
  }
  const qualifying = qualifyingSiblings(input.ownPage, input.ownPosition, input.siblings);
  if (qualifying.length < SIBLING_MIN_QUALIFYING) return null;

  const ctrsAsc = qualifying.map((s) => s.ctr).sort((a, b) => a - b);
  // Conservative-to-base: p25 to median, never the full spread. Percentile math guarantees
  // bandHighCtr (the median) can never exceed the single best sibling's CTR.
  const bandLowCtr = percentile(ctrsAsc, 0.25);
  const bandHighCtr = percentile(ctrsAsc, 0.5);

  const ownCtr = Math.max(0, input.ownCtr);
  const ownImpressions = input.ownImpressions28d;
  const ownPct = pct(ownCtr);
  const impressionsLabel = Math.round(ownImpressions).toLocaleString("en-US");
  const positionLabel = `position ${Math.round(input.ownPosition)}`;
  const bandLine = `they earn ${pct(bandLowCtr)} to ${pct(bandHighCtr)} percent of views as clicks`;

  // Zero-floor: the target already matches or beats the healthy band's own high end - never a
  // negative promise, never silence either. State it plainly instead.
  if (ownCtr >= bandHighCtr) {
    return {
      lowPerMonth: null,
      highPerMonth: null,
      basis: `Based on your own pages at similar positions: ${bandLine}; this page already earns ${ownPct} percent on ${impressionsLabel} views a month at ${positionLabel}. You are already ahead of similar pages here.`,
      siblingCount: qualifying.length,
    };
  }

  const high = friendly(Math.max(0, (bandHighCtr - ownCtr) * ownImpressions));
  // The gap is real but rounds under an honest floor - same spirit as forecastRange's own
  // "under 3 clicks a month is not a claim worth making" floor. The caller's existing honest
  // abstention stands unchanged rather than this module inventing a third, thinner sentence.
  if (high < 3) return null;
  const low = Math.min(friendly(Math.max(0, (bandLowCtr - ownCtr) * ownImpressions)), high);

  return {
    lowPerMonth: low,
    highPerMonth: high,
    basis: `Based on your own pages at similar positions: ${bandLine}; this page earns ${ownPct} percent on ${impressionsLabel} views a month at ${positionLabel}. That gap is worth roughly ${low.toLocaleString("en-US")} to ${high.toLocaleString("en-US")} extra clicks a month if it closes.`,
    siblingCount: qualifying.length,
  };
}
