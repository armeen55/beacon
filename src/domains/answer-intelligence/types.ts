/**
 * Answer Intelligence Index — derived from prompt-answer observations,
 * answer texts, and citation detail that the product otherwise ignores.
 *
 * Built at import time alongside the citation-evidence-index.
 * Loaded at module init via the repository abstraction.
 */

// ── Top-level index ─────────────────────────────────────────────────

export type AnswerIntelligenceIndex = {
  built_at: string;
  brand_name: string;
  owned_domain: string;
  total_observations: number;
  total_with_answer_text: number;

  /** How AI platforms describe the brand, grouped by topic. */
  brand_positioning: BrandPositioningByTopic[];

  /** Per topic × platform × date visibility rates (the time-series). */
  visibility_cells: VisibilityCell[];

  /** Competitive co-citation analysis: who appears with/without you. */
  co_citation: CoCitationAnalysis;

  /** Answer narrative shifts: when the AI changed what it says about you. */
  narrative_shifts: NarrativeShift[];

  /** Pre-computed lookup: topic → platform → latest rates + trend. */
  topic_platform_summary: Record<string, Record<string, TopicPlatformSummary>>;
};

// ── Section 1: Brand positioning ────────────────────────────────────

export type BrandDescriptor = {
  /** Extracted phrase, e.g. "architect-led design-build firm" */
  fragment: string;
  /** How many distinct answers used this descriptor. */
  source_count: number;
  /** Which platforms used it. */
  platforms: string[];
  /** One observation ID for linking back to full answer text. */
  example_observation_id: string;
};

export type CompetitorCoAppearance = {
  /** Competitor name extracted from answer text. */
  domain: string;
  /** Answers where both brand + this competitor domain appear. */
  co_appearance_count: number;
  /** Total answers where this competitor domain appears (any topic). */
  total_appearances: number;
};

export type BrandPositioningByTopic = {
  topic: string;
  mention_count: number;
  total_observations: number;
  mention_rate: number;
  citation_rate: number;
  /** Short phrases describing how the AI positions the brand. */
  brand_descriptors: BrandDescriptor[];
  /** Top competitor domains that co-appear when brand is present. */
  top_co_appearing_competitors: CompetitorCoAppearance[];
  /** Average position (1-based) when the brand is mentioned. */
  avg_position_when_mentioned: number | null;
  /** Average number of total citations in answers that mention the brand. */
  typical_list_size: number | null;
};

// ── Section 2: Visibility cells (time-series) ───────────────────────

export type VisibilityCell = {
  topic: string;
  platform: string;
  date: string;
  observation_count: number;
  mention_count: number;
  citation_count: number;
  mention_rate: number;
  citation_rate: number;
  avg_position: number | null;
  avg_owned_citation_count: number;
  /** Top 5 competitor domains by frequency in this cell. */
  top_competitor_domains: { domain: string; frequency: number }[];
};

// ── Section 3: Co-citation analysis ─────────────────────────────────

export type CoCitationCompetitor = {
  domain: string;
  /** Appearances in answers that also cite the owned domain. */
  when_owned_present: number;
  /** Appearances in answers that do NOT cite the owned domain. */
  when_owned_absent: number;
  total_answer_appearances: number;
  /**
   * when_owned_absent / total — higher = more of a displacement threat.
   * If 1.0: they only appear when you don't. If 0.0: they only appear with you.
   */
  displacement_ratio: number;
};

export type CoCitationTopicBreakdown = {
  topic: string;
  answers_with_owned: number;
  answers_without_owned: number;
  /** Top competitor domains when owned IS cited. */
  top_when_present: { domain: string; count: number }[];
  /** Top competitor domains when owned is NOT cited. */
  top_when_absent: { domain: string; count: number }[];
};

export type CoCitationAnalysis = {
  owned_domain: string;
  total_answers_with_owned: number;
  total_answers_without_owned: number;
  /** All competitor domains sorted by total appearances. */
  competitors: CoCitationCompetitor[];
  by_topic: CoCitationTopicBreakdown[];
};

// ── Section 4: Narrative shifts ─────────────────────────────────────

export type NarrativeShiftType =
  | "brand_gained"
  | "brand_lost"
  | "position_improved"
  | "position_declined";

export type NarrativeShift = {
  prompt_id: string;
  topic: string;
  platform: string;
  shift_type: NarrativeShiftType;
  from_date: string;
  to_date: string;
  from_mentioned: boolean;
  to_mentioned: boolean;
  from_position: number | null;
  to_position: number | null;
  from_observation_id: string;
  to_observation_id: string;
  /** Human-readable summary. */
  detail: string;
};

// ── Lookup acceleration ─────────────────────────────────────────────

export type TopicPlatformSummary = {
  latest_mention_rate: number;
  latest_citation_rate: number;
  trend_direction: "up" | "down" | "stable";
  /** Average mention rate over last 7 days with data. */
  mention_rate_7d: number;
  /** Average mention rate over prior 7 days. */
  mention_rate_prior_7d: number;
  total_narrative_shifts: number;
};
