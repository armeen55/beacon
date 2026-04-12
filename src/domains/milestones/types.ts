/**
 * Milestones / all-time highs — progress evidence, not gamification.
 * Peaks are grounded in stored results + citation index; events fire only
 * when a peak is newly beaten after initial bootstrap.
 */

export type MilestoneKind =
  | "citation_daily_total"
  | "citation_7d_surge"
  | "platform_citation_share_peak"
  | "topic_rank_best"
  | "topic_first_top3"
  | "topic_first_rank1"
  | "page_citation_peak"
  | "corpus_owned_share_peak"
  | "direct_competitor_lead_peak";

export type MilestonePeakRow = {
  key: string;
  kind: MilestoneKind;
  /** Higher = better for all kinds (positions encoded as rankScore). */
  value: number;
  achievedAt: string;
  proofSummary: string;
  meta?: Record<string, unknown>;
};

export type MilestoneEvent = {
  id: string;
  kind: MilestoneKind;
  key: string;
  title: string;
  subtitle: string;
  achievedAt: string;
  value: number;
  proofSummary: string;
  meta?: Record<string, unknown>;
};

export type MilestoneState = {
  meta?: { bootstrapped?: boolean };
  peaks: Record<string, MilestonePeakRow>;
  events: MilestoneEvent[];
};
