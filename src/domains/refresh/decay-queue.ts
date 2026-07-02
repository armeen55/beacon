/**
 * refresh/decay-queue (BEACON_500 item 56) - PURE rank core for the refresh production
 * line. GSC decay (src/domains/recommendation-intelligence/triggers/gsc-decay.ts) only
 * compares two 28-day windows, so a page that faded gradually over a season never crosses
 * its threshold. This module ranks pages on a QUARTER-over-quarter basis instead: which
 * pages earned real clicks last quarter and are now earning meaningfully less, worst-lost-
 * clicks-first, with a floor so a handful of clicks lost on a tiny page never queues.
 *
 * PURE: the caller loads two quarterly windows (this module never touches Supabase or the
 * clock). Deterministic, $0, no LLM. Tested by decay-queue.test.ts.
 */

/** One page's clicks + impression-weighted position for a single quarter window. */
export type QuarterlyPageRow = {
  page: string;
  clicks: number;
  impressions: number;
  /** Impression-weighted average position for the quarter (0 when no impressions). */
  position: number;
};

/** A page's two most-recent quarter windows, prior vs current. */
export type QuarterlyPageDelta = {
  page: string;
  prior: QuarterlyPageRow;
  current: QuarterlyPageRow;
};

export type RefreshCandidateRank = {
  page: string;
  /** Clicks lost per month, averaged over the quarter (prior - current, divided by 3). Always > 0. */
  clicksLostPerMonth: number;
  /** Total clicks lost across the quarter (prior.clicks - current.clicks). */
  clicksLostQuarter: number;
  /** Positions slipped (current.position - prior.position; positive = fell down the SERP). Can be 0
   *  or negative (position held or improved) when clicks fell for another reason (e.g. CTR decay). */
  positionDrift: number;
  priorClicks: number;
  currentClicks: number;
  priorPosition: number;
  currentPosition: number;
  /** Current-quarter impressions - the demand signal the daily candidate source ranks and
   *  scores controls against when the page is outside the normal GSC candidate band. */
  currentImpressions: number;
  /** First-person, plain-business sentence for the daily card - no em or en dashes ever. */
  sentence: string;
};

/** A quarter's clicks must clear this floor before a page queues for refresh - a page that
 *  earned a handful of clicks last quarter fading further is not worth a nightly slot. */
export const MIN_PRIOR_CLICKS_PER_QUARTER = 100;
/** A page must have LOST at least this share of its prior-quarter clicks to queue - a small,
 *  noisy dip is not a real fade. */
export const MIN_CLICKS_DROP_FRACTION = 0.2;

function monthPhraseOf(clicksPerMonth: number): string {
  return clicksPerMonth >= 1 ? Math.round(clicksPerMonth).toLocaleString("en-US") : "a few";
}

/** Build the operator-facing sentence for one ranked refresh candidate. Pure, exported so the
 *  brief builder and tests can reuse the exact wording. `priorClicks` is the QUARTER total;
 *  the sentence converts it to a truthful per-month figure. */
export function buildRefreshSentence(input: {
  priorClicks: number;
  clicksLostPerMonth: number;
  positionDrift: number;
}): string {
  const perMonth = monthPhraseOf(input.clicksLostPerMonth);
  const priorPerMonth = Math.round(input.priorClicks / 3).toLocaleString("en-US");
  const base = `This page earned ${priorPerMonth} clicks a month last quarter and is fading, down about ${perMonth} clicks a month since. A refresh usually brings these back.`;
  if (input.positionDrift >= 2) {
    return `${base} It also slipped ${input.positionDrift.toFixed(1)} spots on Google.`;
  }
  return base;
}

/**
 * Rank pages losing clicks quarter over quarter, worst-lost-clicks-first. A page only queues
 * when its prior quarter cleared MIN_PRIOR_CLICKS_PER_QUARTER and it lost at least
 * MIN_CLICKS_DROP_FRACTION of those clicks. Pure, deterministic, no I/O.
 */
export function rankRefreshCandidates(
  rows: readonly QuarterlyPageDelta[],
  opts: { minPriorClicks?: number; minDropFraction?: number; limit?: number } = {},
): RefreshCandidateRank[] {
  const minPriorClicks = opts.minPriorClicks ?? MIN_PRIOR_CLICKS_PER_QUARTER;
  const minDropFraction = opts.minDropFraction ?? MIN_CLICKS_DROP_FRACTION;

  const out: RefreshCandidateRank[] = [];
  for (const row of rows) {
    const { page, prior, current } = row;
    if (prior.clicks < minPriorClicks) continue; // floor: no real prior demand
    const clicksLostQuarter = prior.clicks - current.clicks;
    if (clicksLostQuarter <= 0) continue; // grew or held steady - not fading
    const dropFraction = clicksLostQuarter / prior.clicks;
    if (dropFraction < minDropFraction) continue; // not a real fade, just noise

    const clicksLostPerMonth = clicksLostQuarter / 3;
    const positionDrift =
      prior.position > 0 && current.position > 0 ? current.position - prior.position : 0;

    out.push({
      page,
      clicksLostPerMonth: Number(clicksLostPerMonth.toFixed(1)),
      clicksLostQuarter,
      positionDrift: Number(positionDrift.toFixed(1)),
      priorClicks: prior.clicks,
      currentClicks: current.clicks,
      priorPosition: prior.position,
      currentPosition: current.position,
      currentImpressions: current.impressions,
      sentence: buildRefreshSentence({
        priorClicks: prior.clicks,
        clicksLostPerMonth,
        positionDrift,
      }),
    });
  }

  out.sort((a, b) => b.clicksLostQuarter - a.clicksLostQuarter);
  return typeof opts.limit === "number" ? out.slice(0, Math.max(0, opts.limit)) : out;
}
