/**
 * seasonal/seasonal-candidates (BEACON_500 item 63) - PURE bounded source that
 * turns the peak calendar into daily-experiment candidate seeds, mirroring the
 * refresh-candidates.ts source pattern exactly: inputs pre-loaded by the
 * caller, deterministic, $0, bounded to MAX_SEASONAL_CANDIDATES_PER_NIGHT,
 * soonest-window-first (the calendar arrives ranked and order is preserved).
 *
 * DISTINCT FROM seasonal-hints.ts: the item-21 hint feed only STRENGTHENS an
 * existing candidate's "why now" when the page already has one (fires inside
 * a 21-day "prep now" window). This source is a candidate in its own right -
 * a page can get a seasonal-window card with NO other lever proposing
 * anything for it that night - and fires on a WIDER 6-8 week lead ("the
 * window opens in N weeks, six to eight weeks out is when the work ships"),
 * matching the master-plan item 63 wording exactly. The two never double-fire
 * on the same page/night because build-daily-candidates' own
 * alreadyProposedPaths guard (the same one refresh candidates use) excludes a
 * page that already carries a card.
 *
 * HONESTY GATE: a calendar entry only becomes a candidate when it names a
 * KNOWN top page (the archive's topPage) - a wave with no page to strengthen
 * stays informational (the Demand band still shows it) instead of shipping a
 * vague "prep for this" card with nothing exact to change.
 */

import type { ExperimentEligibility } from "@/domains/experiments/experiment-eligibility";
import type { PeakCalendarEntry } from "./seasonality";

/** Max seasonal-window candidates entering the nightly plan (hard rule: bounded). */
export const MAX_SEASONAL_CANDIDATES_PER_NIGHT = 2;
/** The lead window this source fires within: the peak must open at least this
 *  many weeks out... */
export const SEASONAL_CANDIDATE_LEAD_MIN_WEEKS = 6;
/** ...and at most this many weeks out. Older than 8 weeks is not actionable
 *  yet (too far out to plan against); inside 6 weeks it is already the item-21
 *  "prep now" hint's job, not a new candidate. */
export const SEASONAL_CANDIDATE_LEAD_MAX_WEEKS = 8;

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

function daysUntil(iso: string, now: Date): number {
  const target = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(target)) return -Infinity;
  return Math.round((target - now.getTime()) / DAY_MS);
}

function pathOf(urlOrPath: string): string {
  return (urlOrPath.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
}

function monthWindowLabel(months: number[]): string {
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  if (months.length === 1) return MONTH_NAMES[months[0] - 1]!;
  return `${MONTH_NAMES[months[0] - 1]} and ${MONTH_NAMES[months[1] - 1]}`;
}

/** One seasonal-window candidate seed - the caller (build-daily-candidates)
 *  turns this into a full BuiltCandidate with controls + eligibility from the
 *  same machinery every lever uses. */
export type SeasonalCandidateSeed = {
  page: string;
  targetQuery: string;
  clusterLabel: string;
  confidence: PeakCalendarEntry["confidence"];
  peakMonths: number[];
  weeksOut: number;
  expectedImpressions: number;
  /** First-person "why now" for the card, in the team voice. */
  whyNow: string;
};

export type FindSeasonalCandidatesInput = {
  /** The peak calendar, ranked soonest-prep-deadline-first (order preserved). */
  calendar: readonly PeakCalendarEntry[];
  /** Per-PATH eligibility for the "content" family, from the same
   *  assessEligibility / deriveExperimentStates the rest of the batch uses
   *  (the caller's job, like the refresh source). */
  eligibility: Map<string, ExperimentEligibility>;
  /** Paths that already received a candidate tonight - a page gets ONE card
   *  per night (the same guard refresh candidates use). */
  alreadyProposedPaths?: ReadonlySet<string>;
  /** Bound override for tests; defaults to MAX_SEASONAL_CANDIDATES_PER_NIGHT. */
  maxCandidates?: number;
  now?: Date;
};

/**
 * Turn the peak calendar into bounded candidate seeds: drop entries that are
 * ineligible (mid-measurement / active control / recent no-lift on the content
 * family), that name no known top page, whose page already carries a
 * candidate tonight, or whose peak window is not 6-8 weeks out. The
 * calendar's own ranked order is preserved (soonest deadline first).
 */
export function findSeasonalCandidates(input: FindSeasonalCandidatesInput): SeasonalCandidateSeed[] {
  const cap = input.maxCandidates ?? MAX_SEASONAL_CANDIDATES_PER_NIGHT;
  const now = input.now ?? new Date();
  const already = input.alreadyProposedPaths ?? new Set<string>();
  const out: SeasonalCandidateSeed[] = [];

  for (const entry of input.calendar) {
    if (out.length >= cap) break;
    if (!entry.topPage) continue; // no page named - nothing exact to strengthen
    const path = pathOf(entry.topPage);
    if (already.has(path)) continue; // one card per page per night
    const elig = input.eligibility.get(path);
    // E-39: refresh auto-suggestions stay CONSERVATIVE - only a fully CLEAN page,
    // never a mid-measurement / comparison page (admit-with-caution). Not a
    // lockout: the page still surfaces its own daily candidate with the caution.
    if (!elig || !elig.eligible || elig.reason !== "clean") continue;

    const daysOut = daysUntil(entry.peakStartDate, now);
    const weeksOut = daysOut / WEEK_DAYS;
    if (weeksOut < SEASONAL_CANDIDATE_LEAD_MIN_WEEKS || weeksOut > SEASONAL_CANDIDATE_LEAD_MAX_WEEKS) continue;

    const roundedWeeks = Math.round(weeksOut);
    const windowLabel = monthWindowLabel(entry.peakMonths);
    const confidenceLine =
      entry.confidence === "proven"
        ? "I checked this against several years of market search data and it holds up every year."
        : entry.confidence === "repeated"
          ? "This has repeated more than once in my own records."
          : "This is one year of data so far, so I am watching it, not betting the farm on it.";
    const whyNow = `Searches for "${entry.clusterLabel}" climbed toward ${windowLabel} last time (${entry.expectedImpressions.toLocaleString()} impressions in that window). The window opens in about ${roundedWeeks} weeks. ${confidenceLine} Six to eight weeks out is when this work ships, so Google has it indexed before the wave.`;

    out.push({
      page: entry.topPage,
      targetQuery: entry.clusterLabel.toLowerCase(),
      clusterLabel: entry.clusterLabel,
      confidence: entry.confidence,
      peakMonths: entry.peakMonths,
      weeksOut: roundedWeeks,
      expectedImpressions: entry.expectedImpressions,
      whyNow,
    });
  }

  return out;
}
