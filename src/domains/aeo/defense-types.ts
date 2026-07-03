/**
 * AEO defense pack (BEACON 500 P8, 2026-07-03) - shared pure types for the
 * three deterministic AEO-defense detectors that read ALREADY-PERSISTED
 * Profound data (never a live API call):
 *
 *   1. Zero-source opening  (v1 ~192) - a tracked question where AI cites no
 *      one strongly yet: a first-mover opening to own.
 *   2. Defend-a-cited-query (v1 ~116/117) - a competitor domain that NEWLY
 *      appears as an AI-cited source for a question the tenant used to own or
 *      co-own (detected from a 2-capture citation-row history delta).
 *   3. Brand-description accuracy (v1 ~255) - AI describes the tenant with a
 *      descriptor that contradicts the tenant's own business-config facts.
 *
 * These types are the pure contract between the I/O loaders
 * (`load-defense-signals.ts`, which does the Supabase reads) and the three
 * pure trigger predicates in
 * `src/domains/recommendation-intelligence/triggers/` (which stay I/O-free,
 * pinned by `recommendation-trigger-predicates-purity`). No dashes, no lab
 * jargon leaks into any customer-facing field derived from these.
 */

/**
 * One topic where AI answers the question but cites no confident source yet -
 * the zero-source opening. Derived from `profound_citation_rows`: over a
 * meaningful number of observed answers, the strongest cited domain's share of
 * the citations stays below the confidence floor (nobody has locked it in).
 */
export type ZeroSourceOpening = {
  /** Profound category id (stable topic key + dedupe anchor). */
  categoryId: string;
  /** A short, human topic label derived from the topic (for the customer
   *  copy). Falls back to the category id when no better label exists. */
  topicLabel: string;
  /** How many AI answers were observed for this topic across the window - the
   *  presence floor (a one-off answer is never an opening). */
  observedAnswers: number;
  /** Distinct AI models the topic was observed on (evidence breadth). */
  modelCount: number;
  /** The strongest cited domain's share of this topic's citations (0-1). Low
   *  by construction (below the confidence floor) - this is WHY it is an
   *  opening, surfaced honestly in the operator evidence. */
  topSourceShare: number;
  /** The strongest cited domain (for operator evidence only - never the
   *  customer copy; naming a weak incumbent would confuse the "no one owns
   *  this" story). Null when the topic has citations too diffuse to name one. */
  topSourceDomain: string | null;
};

/**
 * One question where a competitor domain NEWLY became an AI-cited source
 * between the prior capture and the latest capture, for a topic the tenant
 * used to own or co-own (the tenant's own domain was cited in the prior
 * capture). The defensive Move: strengthen the answer block before the rival
 * locks it in.
 */
export type DefendCitedQuery = {
  /** Profound category id (stable topic key + dedupe anchor). */
  categoryId: string;
  /** A short, human topic label derived from the topic (for the customer
   *  copy). */
  topicLabel: string;
  /** The competitor domain that newly appeared as a cited source (www-stripped,
   *  lower-cased). Never an aggregator/reference platform (those are filtered)
   *  and never the tenant's own domain. */
  competitorDomain: string;
  /** The latest-capture citation count for that competitor domain on the
   *  topic - how hard they are already being cited. */
  competitorCitations: number;
  /** The tenant's own citation count in the PRIOR capture (> 0 by construction
   *  - this is what makes it a query the tenant used to own/co-own). */
  ownPriorCitations: number;
  /** ISO date (YYYY-MM-DD) of the prior capture compared. */
  priorCaptureDate: string;
  /** ISO date (YYYY-MM-DD) of the latest capture compared. */
  latestCaptureDate: string;
};

/**
 * One AI-attributed descriptor about the tenant's brand that contradicts a
 * known fact from the tenant's own business-config. Deterministic: a literal
 * token in the tenant's config (a location, a service, the industry) is
 * asserted by the AI answer to be something else, OR a config-known token is
 * entirely absent while a contradicting family token is present. Surfaced
 * honestly ("AI is describing you as X, but your site says Y").
 */
export type BrandDescriptionMismatch = {
  /** Which known-fact family the mismatch is in (industry | location |
   *  service). Drives the operator evidence + which config field to cite. */
  factKind: "industry" | "location" | "service";
  /** The tenant's own known value for this fact (from business-config) - the
   *  "your site says Y". */
  ownFact: string;
  /** The contradicting descriptor the AI answer attributes to the brand - the
   *  "AI is describing you as X". Sourced verbatim from the persisted answer
   *  excerpt, never fabricated. */
  aiDescriptor: string;
  /** A short, honest snippet of the AI answer text the descriptor came from,
   *  so the operator can see the real sentence (from response_excerpt). */
  evidenceExcerpt: string;
  /** Which AI model's answer carried the mismatch (ChatGPT, Perplexity, ...),
   *  or null when the sync did not record a model. */
  model: string | null;
};

/** The full pre-loaded defense-signal bundle the loader produces once per
 *  tenant and threads into the three predicates. Every field is empty when
 *  Profound is not connected / has no rows / the sync has not run - the
 *  predicates then abstain (self-hiding). */
export type AeoDefenseSignals = {
  zeroSourceOpenings: ReadonlyArray<ZeroSourceOpening>;
  defendCitedQueries: ReadonlyArray<DefendCitedQuery>;
  brandDescriptionMismatches: ReadonlyArray<BrandDescriptionMismatch>;
};
