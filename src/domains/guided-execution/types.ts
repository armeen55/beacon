/**
 * CX5 — Gap detection, priority scoring, and guided execution types.
 *
 * The pipeline: gaps → priority → top-3 selection → guided payloads → Moves.
 *
 * Every customer-facing output flows through this pipeline. The customer
 * never sees raw gaps, raw patterns, or raw recommendations — they see
 * Moves (defined in global-patterns/contracts.ts).
 */

// ---------------------------------------------------------------------------
// 1. Gap types — what's missing from a page
// ---------------------------------------------------------------------------

export type GapType =
  | "missing_faq"              // Page has 0 FAQ questions
  | "missing_faq_schema"       // Page has FAQ content but no FAQPage JSON-LD
  | "insufficient_faq"         // Page has 1-2 FAQ questions (should have 5-7)
  | "missing_comparison_table" // Service/city page without a comparison table
  | "missing_schema"           // Page has no JSON-LD schema at all
  | "missing_service_schema"   // Service page without Service schema type
  | "missing_localbusiness"    // Location page without LocalBusiness schema
  | "low_internal_links"       // Page has < 3 internal links
  | "thin_content"             // Page word count < 300
  | "missing_h2_structure"     // Page has 0 h2 headings
  | "duplicate_faq_schema"     // Page has multiple FAQPage JSON-LD blocks
  | "stale_content";           // Page not updated in > 90 days

export type GapSeverity =
  | "critical"    // Missing core structural element (FAQ, schema on high-traffic page)
  | "high"        // Missing important element on a cited page
  | "medium"      // Missing nice-to-have element
  | "low";        // Minor structural improvement

export type DetectedGap = {
  /** What's missing. */
  type: GapType;
  /** How bad is it. */
  severity: GapSeverity;
  /** Which page this gap is on. */
  page_url: string;
  /** Human-readable explanation. */
  description: string;
  /** What change type would fix this gap. Maps to cluster labels. */
  fix_change_type: string;
  /** Which platform benefits most from fixing this gap. */
  primary_platform: "chatgpt" | "google_aio" | "perplexity";
  /** Current state of the field (e.g., "0 FAQ questions", "no JSON-LD"). */
  current_state: string;
  /** Target state after fixing (e.g., "5-7 FAQ questions + FAQPage schema"). */
  target_state: string;
  /** How many pages have this same gap (for sitewide moves). */
  affected_page_count: number;
};

// ---------------------------------------------------------------------------
// 2. Priority scoring — why this move matters more than that one
// ---------------------------------------------------------------------------

/**
 * Priority score components. The final score is a weighted composite.
 *
 * Formula:
 *   priority = (citation_impact × 0.30)
 *            + (pattern_confidence × 0.25)
 *            + (gap_severity × 0.25)
 *            + (page_importance × 0.20)
 *
 * Each component is normalized to 0-100 before weighting.
 */
export type PriorityComponents = {
  /** 0-100. How many citations this page gets (higher = more impact). */
  citation_impact: number;
  /** 0-100. Pattern confidence from global store (0 if no pattern). */
  pattern_confidence: number;
  /** 0-100. Gap severity mapped to score (critical=100, high=75, medium=50, low=25). */
  gap_severity: number;
  /** 0-100. Page importance (homepage=100, service=80, city=70, other=40). */
  page_importance: number;
};

export type ScoredMove = {
  gap: DetectedGap;
  priority: number;           // 0-100 composite
  components: PriorityComponents;
};

// ---------------------------------------------------------------------------
// 3. Guided execution payloads — paste-ready content
// ---------------------------------------------------------------------------

export type FaqPayload = {
  kind: "faq";
  questions: Array<{
    question: string;
    answer_outline: string;
  }>;
  json_ld: string;
  placement: string;
};

export type ComparisonPayload = {
  kind: "comparison";
  competitors: string[];
  criteria: string[];
  html: string;
  placement: string;
};

export type SchemaPayload = {
  kind: "schema";
  schema_type: string;
  json_ld: string;
  placement: string;
};

export type ContentPayload = {
  kind: "content";
  section_title: string;
  outline: string;
  placement: string;
};

export type GuidedPayload =
  | FaqPayload
  | ComparisonPayload
  | SchemaPayload
  | ContentPayload;

// ---------------------------------------------------------------------------
// 4. Dev ticket format
// ---------------------------------------------------------------------------

export type TicketFormat = "linear" | "jira" | "notion" | "markdown";
