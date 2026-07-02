/**
 * pick-expectations (FINAL PREMIUM PLAN items 31, 34, 35) - the honest per-pick expectation
 * lines, deterministic at plan time:
 *   - forecast (34): a range from the CTR-curve opportunity ("roughly 20 to 60 extra clicks a
 *     month"), labeled an estimate, suppressed when too small to mean anything
 *   - changeOurMind (31): one falsifiability line from the proof plan ("If clicks do not move
 *     by the 14-day read, we roll it back and try X instead")
 *   - effort (35): the operator's real cost ("about 2 minutes in your site editor")
 * PURE, no I/O. Pinned by pick-expectations.test.ts.
 */

export type PickExpectations = {
  /** Absent when the opportunity is too small to forecast honestly. */
  forecast?: string;
  changeOurMind: string;
  effort: string;
};

/** What we try NEXT if this lever does not move clicks (the falsifiability exit). */
const NEXT_LEVER_PLAIN: Record<string, string> = {
  meta: "a direct answer at the top of the page",
  title: "a sharper description",
  h1: "a sharper title",
  internal_link: "a different supporting link",
  answer_block: "a sharper description",
};

/** Round to a friendly number (5s above 10, 10s above 100) so the range reads like an estimate. */
function friendly(n: number): number {
  if (n >= 100) return Math.round(n / 10) * 10;
  if (n >= 10) return Math.round(n / 5) * 5;
  return Math.round(n);
}

/**
 * Monthly extra-clicks range from the 90-day CTR-curve opportunity. The opportunity is "close the
 * whole gap to the curve"; real changes capture part of it, so the range is 25% to 75% of the
 * monthly opportunity. Returns null when the honest high end is under 3 clicks a month.
 */
export function forecastRange(ctrOpportunityClicks90d: number): { low: number; high: number } | null {
  if (!Number.isFinite(ctrOpportunityClicks90d) || ctrOpportunityClicks90d <= 0) return null;
  const monthly = ctrOpportunityClicks90d / 3;
  const low = friendly(monthly * 0.25);
  const high = friendly(monthly * 0.75);
  if (high < 3) return null;
  return { low: Math.max(1, low), high: Math.max(high, Math.max(1, low)) };
}

export function buildPickExpectations(input: {
  lever: string;
  ctrOpportunityClicks: number;
  effortMinutes: number;
}): PickExpectations {
  const range = forecastRange(input.ctrOpportunityClicks);
  const next = NEXT_LEVER_PLAIN[input.lever] ?? "a different change";
  const mins = Math.max(1, Math.round(input.effortMinutes));
  return {
    ...(range
      ? {
          forecast: `If this works: roughly ${range.low.toLocaleString()} to ${range.high.toLocaleString()} extra clicks a month. An estimate from your current rank and click rate, not a promise.`,
        }
      : {}),
    changeOurMind: `If clicks do not move by the 14-day read, we roll it back (the old text is saved) and try ${next} instead.`,
    effort: `about ${mins} minute${mins === 1 ? "" : "s"} in your site editor`,
  };
}
