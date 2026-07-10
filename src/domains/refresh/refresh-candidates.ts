/**
 * refresh/refresh-candidates (BEACON_500 item 56) - PURE bounded source that turns the
 * nightly refresh queue (fading pages + evidence briefs) into daily-experiment candidate
 * seeds, mirroring the family-win-propagation source pattern exactly: inputs pre-filtered
 * and pre-loaded by the caller, deterministic, $0, bounded to MAX_REFRESH_CANDIDATES_PER_NIGHT,
 * decayed-winners-first (the queue arrives ranked worst-lost-clicks-first and order is
 * preserved).
 *
 * HONESTY GATE: a queue page only becomes a candidate when its brief names a CONCRETE
 * section target (a winner's section this page lacks, or a searched query no H2 answers) -
 * the same "never force weak work" posture as chooseProposal. A fading page with no
 * concrete target stays on the war-room band for the operator instead of shipping a vague
 * "improve this page" card.
 */

import type { ExperimentEligibility } from "@/domains/experiments/experiment-eligibility";
import {
  briefSentences,
  buildNewQueryGapSentence,
  buildWinnerSectionSentence,
  type RefreshBrief,
} from "./refresh-brief";

/** Max refresh candidates entering the nightly plan (hard rule: bounded). */
export const MAX_REFRESH_CANDIDATES_PER_NIGHT = 2;

/** One refresh candidate seed - the caller (build-daily-candidates) turns this into a full
 *  BuiltCandidate with controls + eligibility from the same machinery every lever uses. */
export type RefreshCandidateSeed = {
  page: string;
  /** The query this refresh chiefly serves (the top uncovered query, else the top losing one). */
  targetQuery: string;
  /** The EXACT new section heading to add - the one-variable change apply/paste ships and
   *  verify-live checks for. */
  proposedHeading: string;
  /** First-person "why now" for the card: the fade + the strongest evidence line. */
  whyNow: string;
  /** Every evidence sentence from the brief (rides the plan record's refresh detail). */
  briefSentences: string[];
  /** The refresh forecast: winning back what faded (clicks per month). */
  clicksLostPerMonth: number;
  currentImpressions: number;
  currentPosition: number;
  currentClicks: number;
};

function headingCase(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function pathOf(urlOrPath: string): string {
  return (urlOrPath.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
}

export type FindRefreshCandidatesInput = {
  /** The nightly refresh queue, ranked worst-lost-clicks-first (order preserved here). */
  queue: readonly RefreshBrief[];
  /** Per-PATH eligibility for the "content" family, from the same assessEligibility /
   *  deriveExperimentStates the rest of the batch uses (the caller's job, like item 29). */
  eligibility: Map<string, ExperimentEligibility>;
  /** Paths that already received a candidate tonight - a page gets ONE card per night. */
  alreadyProposedPaths?: ReadonlySet<string>;
  /** Bound override for tests; defaults to MAX_REFRESH_CANDIDATES_PER_NIGHT. */
  maxCandidates?: number;
};

/**
 * Turn the ranked refresh queue into bounded candidate seeds: drop pages that are ineligible
 * (mid-measurement / active control / recent no-lift on the content family), pages already
 * carrying a candidate tonight, and pages whose brief has no concrete section target. The
 * queue's own worst-lost-clicks-first order IS the priority order (decayed winners first).
 */
export function findRefreshCandidates(input: FindRefreshCandidatesInput): RefreshCandidateSeed[] {
  const cap = input.maxCandidates ?? MAX_REFRESH_CANDIDATES_PER_NIGHT;
  const already = input.alreadyProposedPaths ?? new Set<string>();
  const out: RefreshCandidateSeed[] = [];

  for (const brief of input.queue) {
    if (out.length >= cap) break;
    const path = pathOf(brief.page);
    if (already.has(path)) continue; // one card per page per night
    const elig = input.eligibility.get(path);
    // E-39: refresh auto-suggestions stay CONSERVATIVE - only a fully CLEAN page,
    // never a mid-measurement / comparison page (admit-with-caution). Not a
    // lockout: the page still surfaces its own daily candidate with the caution.
    if (!elig || !elig.eligible || elig.reason !== "clean") continue;

    // Concrete section target: the winner's missing section beats a raw query gap (it
    // carries competitor proof), and a query gap beats nothing.
    const winner = brief.winnerSection;
    const topGap = brief.newQueryGaps[0];
    if (!winner && !topGap) continue; // no concrete target - honest skip

    const proposedHeading = winner ? winner.sectionTitle : headingCase(topGap!.query);
    const targetQuery = topGap?.query ?? brief.losingQueries[0]?.query ?? proposedHeading.toLowerCase();

    const evidenceLine = winner
      ? buildWinnerSectionSentence(winner)
      : buildNewQueryGapSentence(brief.newQueryGaps);
    const whyNow = evidenceLine ? `${brief.rank.sentence} ${evidenceLine}` : brief.rank.sentence;

    out.push({
      page: brief.page,
      targetQuery,
      proposedHeading,
      whyNow,
      briefSentences: briefSentences(brief),
      clicksLostPerMonth: brief.rank.clicksLostPerMonth,
      currentImpressions: brief.rank.currentImpressions,
      currentPosition: brief.rank.currentPosition,
      currentClicks: brief.rank.currentClicks,
    });
  }

  return out;
}
