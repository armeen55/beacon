/**
 * Page Surgeon — Atomic Change Evidence Evaluator: the shared data contract.
 *
 * Governing principle (docs/PAGE_SURGEON_DESIGN.md): NO hardcoded SEO rules.
 * Every atomic change is decided by generating candidate options and SCORING
 * them against structured evidence — never a fixed style. A deterministic gate
 * (not the LLM) decides publishability. The LLM may evaluate candidates over
 * this structured evidence; it may never invent a metric.
 *
 * This module is PURE TYPES + tiny pure helpers only. No I/O, no tenant
 * literals, no "always X" rules. W1a uses the `title` slice of it; the same
 * contract generalizes to every AtomicChangeType.
 */

// ── Change taxonomy ─────────────────────────────────────────────────────────
export type AtomicChangeType =
  | "title"
  | "h1"
  | "meta"
  | "intro_answer_block"
  | "faq"
  | "section_add"
  | "section_remove"
  | "section_reorder"
  | "internal_link"
  | "schema"
  | "image_alt"
  | "ux_cta_fix"
  | "citation_source"
  | "create_new_page";

export type EvidenceConfidence =
  | "high"
  | "medium"
  | "low"
  | "needs_more_evidence";

export type Publishability = "publishable" | "staged" | "review_only";

export type BrandSuffixDecision = "include" | "omit" | "neutral";

// ── 1. Current state ────────────────────────────────────────────────────────
export type CurrentState = {
  tenantId: string;
  pageUrl: string;
  changeType: AtomicChangeType;
  /** Which field/section the change targets (null for whole-page changes). */
  elementKey: string | null;
  sectionLabel: string | null;
  /** Current title/h1/meta/section text, if known. */
  currentText: string | null;
  /** Is there a CMS field mapping that could publish this change? */
  cmsFieldMapped: boolean;
  publishChannel: "wix_cms" | "git_pr" | "dev_note" | "none";
};

// ── 2. Evidence (every source OPTIONAL; absence ≠ zero; never fabricate) ─────
export type GscQueryRow = {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
};
export type GscEvidence = {
  windowStart: string;
  windowEnd: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number;
  topQueries: GscQueryRow[];
  /** Expected CTR for the page's avg position (from the position→CTR curve). */
  expectedCtrForPosition: number | null;
  /** expected − actual CTR (page-level); positive ⇒ underperforming snippet. */
  ctrGap: number | null;
};
export type Ga4Evidence = {
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  avgSessionDurationSec: number | null;
  keyEvents: number | null;
  sessionKeyEventRate: number | null;
  revenue: number | null;
};
export type ClarityEvidence = {
  windowStart: string;
  windowEnd: string;
  scrollDepthMedian: number | null;
  engagementTimeSec: number | null;
  deadClicks: number | null;
  rageClicks: number | null;
  quickbacks: number | null;
  scriptErrors: number | null;
};
export type SemrushKeywordRow = {
  keyword: string;
  volume: number;
  kd: number;
  cpc: number;
  intent: string | null;
  position: number | null;
};
/** A market-context keyword from phrase_related / phrase_questions — carries
 *  volume + intent so the judge can prioritise, but no position (it describes
 *  the market, not where this page ranks). */
export type SemrushExpansionRow = {
  keyword: string;
  volume: number;
  intent: string | null;
};
export type SemrushEvidence = {
  keywords: SemrushKeywordRow[];
  serpFeatures?: Array<{ query: string; features: string[]; aiOverview: boolean }>;
  /** Query variants people also search (phrase_related), volume desc. */
  relatedKeywords?: SemrushExpansionRow[];
  /** Question-form keywords (phrase_questions) — answer-block / FAQ fodder. */
  questionKeywords?: SemrushExpansionRow[];
  /** Organic competitor domains for the site (market rivals). Per-keyword
   *  competitor ranking URLs are not a supported report → a labelled gap. */
  competitorDomains?: string[];
  competitorGaps?: Array<{
    keyword: string;
    competitorDomain: string;
    competitorPosition: number;
    volume: number;
  }>;
};
export type ProfoundEvidence = {
  aiVisibility: number | null;
  citations: number | null;
  promptClusters?: string[];
  competitorMentions?: Array<{ competitor: string; share: number }>;
};
export type CrawlEvidence = {
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  h2List: string[];
  h3List: string[];
  faqs: string[];
  schemaTypes: string[];
  wordCount: number | null;
  internalLinkCount: number | null;
  cardTexts: string[];
};

export type EvidencePacket = {
  current: CurrentState;
  gsc?: GscEvidence;
  ga4?: Ga4Evidence;
  clarity?: ClarityEvidence;
  semrush?: SemrushEvidence;
  profound?: ProfoundEvidence;
  crawl?: CrawlEvidence;
  /** Sources with usable data for THIS page. */
  sourcesPresent: string[];
  /** Sources CONNECTED but returning no rows (so "missing" ≠ "not connected"). */
  sourcesConnectedButEmpty: string[];
  /** Lowercased terms the tenant's OWN pages repeat as boilerplate/chrome
   *  (derived from the fleet, e.g. via the chrome detector) — NOT a hardcoded
   *  list. Used so dropping boilerplate isn't penalized as a real term loss. */
  boilerplateTerms?: string[];
};

// ── 3. Candidate options ────────────────────────────────────────────────────
export type CandidateOption = {
  /** Stable per (page, changeType, strategy). */
  id: string;
  strategy: string;
  /** null for keep_current / do_nothing. */
  proposedText: string | null;
  preservedTerms: string[];
  removedTerms: string[];
  brandSuffixDecision: BrandSuffixDecision;
  /** Why this option is on the table (NOT its score). */
  rationaleSeed: string;
};

// ── 4. Scoring ──────────────────────────────────────────────────────────────
export type ScoreDimension =
  | "query_intent_fit"
  | "page_topic_fit"
  | "business_value"
  | "ctr_or_ranking_upside"
  | "conversion_engagement_value"
  | "ux_friction_impact"
  | "semrush_market_opportunity"
  | "aeo_serp_feature_fit"
  | "lost_term_risk"
  | "google_title_rewrite_risk"
  | "brand_trust_fit"
  | "implementation_risk"
  | "measurement_clarity"
  | "already_satisfies_query"
  | "snippet_promise_improvement";

export type DimensionScore = {
  dimension: ScoreDimension;
  /** 0..1. For risk dimensions, 1 = low risk / good. */
  score: number;
  /** Provenance — which packet fields drove this. Empty when unavailable. */
  evidenceUsed: string[];
  /** false ⇒ the source for this dimension was absent → NOT scored, NOT faked. */
  available: boolean;
};

export type CandidateScore = {
  candidateId: string;
  dimensions: DimensionScore[];
  /** Weighted mean over AVAILABLE dimensions (weights are config, not magic). */
  weightedTotal: number;
  /** Hard vetoes that fired (e.g. clarity_ux_veto, factual_brand_risk). */
  vetoes: string[];
};

// ── 5. Decision ─────────────────────────────────────────────────────────────
export type RejectedCandidate = {
  candidateId: string;
  title: string | null;
  reason: string;
};

export type EvaluatorDecision = {
  changeType: AtomicChangeType;
  pageUrl: string;
  recommendedCandidateId: string | null; // null ⇒ keep_current / needs_more_evidence
  recommendedText: string | null;
  keepCurrent: boolean;
  rejectedCandidates: RejectedCandidate[];
  confidence: EvidenceConfidence;
  evidenceUsed: string[];
  evidenceGaps: string[];
  hypothesis: string;
  risks: string[];
  beforeAfterDiff: { before: string | null; after: string | null };
  measurementPlan: string;
  rollbackPlan: string;
  /** SET BY THE DETERMINISTIC GATE, not the candidate scoring / LLM. */
  publishability: Publishability;
  /** How the recommendation was reached (deterministic vs LLM-judge-assisted). */
  decidedBy: "deterministic" | "llm_judge";
  /** Title specialization (operator's exact output shape), when changeType=title. */
  titleStrategy?: TitleStrategyOutput;
};

/** Operator's exact title-output contract (a specialization of the decision). */
export type TitleStrategyOutput = {
  recommended_strategy: string;
  recommended_title: string | null;
  keep_current_title: boolean;
  brand_suffix_decision: BrandSuffixDecision;
  preserved_terms: string[];
  removed_terms: string[];
  rejected_candidates: Array<{ title: string | null; reason: string }>;
  confidence: EvidenceConfidence;
  evidence_used: string[];
  risks: string[];
};

// ── Tiny pure helpers (no rules, just text/number utilities) ────────────────

/** Lowercase word-token set (punctuation stripped). */
export function tokenSet(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

/** Fraction of `query` tokens present in `text` (0..1). 0 when query empty. */
export function tokenCoverage(text: string | null, query: string | null): number {
  const q = tokenSet(query);
  if (q.size === 0) return 0;
  const t = tokenSet(text);
  let hit = 0;
  for (const tok of q) if (t.has(tok)) hit += 1;
  return hit / q.size;
}

/** Clamp to [0,1]. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
