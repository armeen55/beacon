/**
 * Recommendation types — the shared shape produced by the retired legacy
 * recommendation engine, kept alive for surviving consumers (the change-detail
 * track record) after the engine itself was deleted (2026-07-20 legacy cleanup).
 */

export type RecommendationType =
  | "replicate"
  | "strengthen"
  | "investigate"
  | "strengthen_structure"
  | "improve_internal_links"
  | "refresh_content"
  | "competitive_displacement"
  | "cross_page_pattern"
  | "topic_cluster_gap"
  | "refresh_stale_citation"
  | "keyword_optimization";

export type BeaconRecommendation = {
  id: string;
  type: RecommendationType;
  headline: string;
  rationale: string;
  sourceEvidence: string;
  targetPageUrl: string | null;
  targetPagePath: string | null;
  sourceChangeId: string | null;
  confidence: "high" | "medium" | "low";
  priority: number;
  patternId: string | null;
  citationOpportunity: number;
  /** Answer-intelligence enrichment: what the AI actually says about this topic. */
  answerContext?: string | null;
  /** Specific action to take (e.g., "Add comparison table") */
  specificMove?: string | null;
  /** Action class for programmatic use */
  actionClass?: string | null;
  /** Which page section to target (e.g., "between Process and Testimonials") */
  targetSection?: string | null;
  /** Prior change where this move worked, with measured delta */
  priorSuccess?: {
    changeId: string;
    pagePath: string;
    description: string;
    citationDelta: number;
  } | null;
  /** Per-engine expected signal timing */
  engineTiming?: { platform: string; medianDays: number; sampleCount: number }[] | null;
  /** Concrete expected metric from pattern data */
  expectedMetric?: string | null;
  /** Secondary recs bundled during dedup — shown separately, not in rationale */
  alsoConsider?: string[];
  /** Full section gaps from analyzer — for step generation specificity */
  sectionGaps?: { label: string; display: string; pct: number; insertAfter: string | null }[];
  /** Competitor context for displacement recs */
  competitorContext?: {
    competitorDomain: string;
    competitorCitations: number;
    ownedCitations: number;
    topic: string;
    /** What the competitor has that we don't (from co-citation analysis) */
    competitorAdvantage?: string;
  } | null;
  /** Observed AI query text for this topic (from answer intelligence prompts) */
  observedQueries?: string[];
  /**
   * Which platforms this recommendation primarily impacts.
   * Based on observed correlations in data, not universal AEO claims.
   */
  targetPlatforms?: ("google_aio" | "chatgpt" | "perplexity")[];
  /** Phase 3-post: page-job-fit router verdict. Defaults to "keep" when absent. */
  placementMode?: "keep" | "move" | "new_page";
  /** Phase 3-post: when placementMode === "move", the original target path. */
  movedFromPath?: string | null;
};
