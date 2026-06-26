/**
 * Profound Prompt-to-Page Coverage Compiler — types (PURE).
 *
 * The compiler maps each tracked Profound AI prompt (+ its fan-outs + the
 * competitor pages AI cites) to the right Iranopedia page ACTION: use an
 * existing page, create a new page, build a hub, fix internal links /
 * consolidate, or ignore as noise.
 *
 * These types are the deterministic contract between the upstream
 * PromptOpportunity intelligence (Profound answers + fanouts) and the
 * downstream cockpit / queue. No I/O, no hardcoding of tenant specifics:
 * entities and competitor domains are derived from the inputs themselves; the
 * only borrowed-account guard reused is isProfoundNoisePrompt.
 */

/**
 * Normalized Profound prompt input — one tracked AI prompt with everything the
 * compiler needs to decide an action. Derived from PromptOpportunity via
 * buildAeoPromptInputs (no separate source means fan-outs double as the
 * answer-search queries, theme tags double as raw-answer themes).
 */
export type AeoPromptInput = {
  /** Stable id when the answers carry one (often null -> matched by text). */
  promptId: string | null;
  /** Verbatim AI question. */
  prompt: string;
  /** Topic label the prompt belongs to. */
  topic: string | null;
  /** Profound theme tags seen on the answers. */
  tags: string[];
  /** AI models that answered it (breadth of attention). */
  models: string[];
  /** Distinct AI answers observed (the demand denominator). */
  executions: number;
  /** Answers whose mentions[] named the owned brand. */
  ownMentionCount: number;
  /** Answers that cited the owned domain. */
  ownCitationCount: number;
  /** Every cited URL for this prompt (owned + competitor, deduped). */
  citationUrls: string[];
  /** Top cited PAGES (owned + competitor), ranked, capped upstream. */
  topCitedPages: { url: string; hostname: string; answers: number; isOwned: boolean }[];
  /** Competitor domains cited (non-owned), ranked. */
  topCitedDomains: { hostname: string; answers: number }[];
  /** Downstream fan-out search queries this prompt expands into. */
  fanoutQueries: string[];
  /** Search queries to answer (fan-outs when there is no separate source). */
  answerSearchQueries: string[];
  /** Themes pulled from the raw answers (tags when no separate source). */
  rawAnswerThemes: string[];
  /** One example answer snippet for grounding, or null. */
  rawAnswerExample: string | null;
};

/**
 * An owned page the prompt could be assigned to. Carries the signals the
 * matcher needs (title/h1/h2/meta/url) plus the proof KPIs (GSC/GA4/Clarity)
 * that decide priority and confidence.
 */
export type OwnedPageCandidate = {
  url: string;
  title: string | null;
  h1: string | null;
  h2s: string[];
  metaDescription: string | null;
  wordCount: number;
  /** GSC queries this page already ranks for. */
  gscQueries: string[];
  clicks90d: number;
  impressions90d: number;
  position90d: number | null;
  ctr90d: number;
  ga4Visits28d: number;
  ga4Value: number;
  /** Clarity rage/dead-click friction score (higher = worse). */
  clarityFriction: number;
  /** Schema.org types already present on the page. */
  existingSchemaTypes: string[];
};

/** Coarse intent buckets used to shape sections, schema, and slugs. */
export type PromptIntent =
  | "definition"
  | "list"
  | "biography"
  | "cultural_guide"
  | "how_to"
  | "product_commercial"
  | "travel_place"
  | "language_translation"
  | "history"
  | "other";

/** Per-prompt page decision with the overlap signals + coverage gaps behind it. */
export type PromptPageAssignment = {
  promptId: string | null;
  prompt: string;
  assignment: "existing_page" | "new_page" | "hub_page" | "internal_link_fix" | "ignore_noise";
  /** The owned page this prompt is assigned to, or null (new/hub/ignore). */
  targetUrl: string | null;
  confidence: "high" | "medium" | "low";
  /** Human-readable reason for operator trust. */
  why: string;
  intent: PromptIntent;
  /** Overlap signals (0..1) that drove the match. */
  matchedSignals: {
    titleOverlap: number;
    h1Overlap: number;
    gscQueryOverlap: number;
    urlSlugOverlap: number;
    fanoutOverlap: number;
    citationCompetitorOverlap: number;
    semanticTokenOverlap: number;
  };
  /** What is missing on the assigned page (drives the action pack). */
  missingCoverage: {
    directAnswerMissing: boolean;
    fanoutsMissing: boolean;
    citedSourcesMissing: boolean;
    schemaMissing: boolean;
    depthMissing: boolean;
    internalLinksMissing: boolean;
  };
  /** Competitor page URLs AI cites for this prompt (the pages to beat). */
  topCompetitorPages: string[];
  /** Fan-out queries the page should explicitly answer. */
  fanoutsToAnswer: string[];
  /** Proof KPIs to watch after the move lands. */
  proofKpis: string[];
};

/** The concrete, rankable move derived from an actionable assignment. */
export type AeoActionPack = {
  action:
    | "add_answer_block"
    | "expand_existing_page"
    | "create_new_page"
    | "create_hub"
    | "consolidate_pages"
    | "add_internal_links"
    | "ignore";
  /** Higher = do first. Combines demand, attention, citation concentration, and proof KPIs. */
  priorityScore: number;
  targetUrl: string | null;
  /** Suggested slug for a new page / hub (null otherwise). */
  newPageSlug: string | null;
  title: string | null;
  h1: string | null;
  /** One-line brief for the extractable direct answer. */
  directAnswerBrief: string;
  sectionsToAdd: string[];
  faqQuestions: string[];
  schemaRecommendation: "FAQPage" | "Article" | "ItemList" | "None";
  /** Source URLs AI already cites (cite or out-cite these). */
  sourceReferences: string[];
  /** Competitor pages this move needs to beat. */
  competitorPagesToBeat: string[];
  internalLinks: string[];
  measurementPlan: string[];
  /** Human-readable evidence string. */
  evidence: string;
  /** True when a SERP check would sharpen the call but none was cached in. */
  needsSerpValidation: boolean;
  promptId: string | null;
  prompt: string;
};
