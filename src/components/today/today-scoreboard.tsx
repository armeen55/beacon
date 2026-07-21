import type { SamplingStatus } from "@/domains/observations/poll-health";

/**
 * ScoreboardData - the AI-visibility scoreboard view model.
 *
 * Phase 4D (2026-07-21): the `TodayScoreboard` render component that consumed
 * this type was dead (never mounted on any surface) and pulled in the
 * health-strip / how-we-know-panel subtree; both were deleted. Only the TYPE
 * survives - it is still the shape `today-shared-types.ts` (and its loaders)
 * carry, so it stays here as a pure type module with no JSX and no dead render.
 */
export type ScoreboardData = {
  totalCitations: number;
  totalMentions: number;
  trendPct: number | null;
  platformBreakdown: { platform: string; label: string; citations: number; mentions: number }[];
  citedPageCount: number;
  resultCount: number;
  dateRange: { from: string; to: string } | null;
  mentionRate: number | null;
  /**
   * Metric-honesty fix #376 (2026-06-14). Number of AI-answer observations
   * the `mentionRate` headline % was computed over. Drives an honest
   * sample-size qualifier so a volatile small-sample rate (e.g. 23% from 13
   * answers) is never presented as a stable fact. Null when the rate isn't shown.
   */
  mentionRateSampleSize?: number | null;
  decliningTopicCount: number;
  risingTopicCount: number;
  weekOverWeekCitations: number | null;
  weekOverWeekMentions: number | null;
  /**
   * Commit 5 (2026-04-24). When non-null, `totalCitations`/`totalMentions`
   * are read from `daily_metric_snapshots source_type='derived'` for the
   * given ISO date (today or yesterday), not from the cumulative raw
   * `results` totals.
   */
  derivedKpiAsOfDate?: string | null;
  /** True when derivedKpiAsOfDate fell back to yesterday's row. */
  derivedKpiIsFallback?: boolean;
  /**
   * Poll Integrity Hardening (2026-05-04, Operator R7). Sampling status of the
   * as-of-date sample, aggregated across both platforms (worst-case wins). Null
   * when there is no poll-health signal yet.
   */
  derivedKpiSamplingStatus?: SamplingStatus | null;
  /**
   * Metric-honesty fix #357 (2026-06-14). TRUE when today's (and yesterday's)
   * derived daily snapshot is missing, so `totalCitations` / `totalMentions`
   * fell back to the CUMULATIVE all-time `results` totals. Distinct from
   * `isFirstRunNoData`: here data EXISTS, it's just not a current-period snapshot.
   */
  cumulativeFallback?: boolean;
};
