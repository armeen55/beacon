import type { SourceCategory } from "@/domains/citation-observations/types";
// Type-only import (erased at compile) for the retired-engine row shapes
// at the bottom of this file; no runtime cycle with competitor-evidence.
import type { SourceType, ResponseType } from "./competitor-evidence";

// ── Page types ──────────────────────────────────────────────────────

export type PageType =
  | "homepage"
  | "city_page"
  | "service_page"
  | "project_page"
  | "directory_profile"
  | "other";

export type OwnershipTier =
  | "owned"
  | "competitor"
  | "directory"
  | "earned_media"
  | "social"
  | "other";

export type DiscoverySource =
  | "citation"
  | "changelog"
  | "entity_url"
  | "manual";

// ── Evidence tiers ──────────────────────────────────────────────────

export type EvidenceTier = "exact" | "probable" | "weak" | "inferred";

export type EvidenceTierMeta = {
  tier: EvidenceTier;
  has_structural_url: boolean;
  snapshot_verified: boolean;
  flags: string[];
};

// ── PageEntity ──────────────────────────────────────────────────────

export type PageEntity = {
  id: string;
  url: string;
  canonical_url: string;
  domain: string;
  path: string;
  page_type: PageType;
  city: string | null;
  service: string | null;
  topics: string[];
  ownership_tier: OwnershipTier;
  tracked_entity_id: string | null;
  is_owned: boolean;
  first_seen_at: string;
  last_observed_at: string;
  discovery_sources: DiscoverySource[];
  title_last_seen: string | null;
  changelog_ids: string[];
  metadata: Record<string, unknown>;
  /** Owning tenant. */
  tenant_id: string;
};

/**
 * Narrow projection of `PageEntity` for routes that need only URL
 * lookup / ownership classification / topic context — not the full
 * 20-field row.
 *
 * Perf+egress bundle 2 (2026-05-12) — added so customer routes that
 * only build a `{ url → id }` map (e.g. `/changes/[id]` legacy
 * detail's "open this page" CTA) can fetch ~6 columns instead of the
 * full payload (~5929 rows × ~5KB ≈ 30MB → ~6KB/row ≈ 3.5MB).
 *
 * The `tenant_id` field is included because the file-backend's
 * `filterByTenantId` helper depends on it for multi-tenant
 * correctness; without it the file backend (used in tests + dev
 * fixtures) cannot enforce isolation post-projection.
 *
 * `primary_topic` is derived from `topics[0]` at the projection
 * boundary — the underlying schema stores the full `topics: string[]`
 * array. Callers that need the full array should use `getPages()`
 * (the full reader).
 */
export type PageSummary = {
  id: string;
  url: string;
  /** Schema column `canonical_url`. Equivalent to the spec's
   *  "normalized_url" — the de-trailing-slashed, lowercased URL the
   *  matching layer keys on. */
  canonical_url: string;
  is_owned: boolean;
  page_type: PageType;
  /** First entry of `topics: string[]` if non-empty, else `null`. */
  primary_topic: string | null;
  tenant_id: string;
};

// ── PageSnapshot (future extraction) ────────────────────────────────

export type FaqItem = {
  question: string;
  answer_excerpt: string;
  source: "jsonld" | "html_details" | "html_section";
};

/** How confident the extractor is about a structural field */
export type ExtractionCertainty = "confirmed" | "uncertain";

/**
 * One <img> captured during the page scan (P24 image-SEO lane, 2026-07-03).
 * `alt` is `null` when the tag has no alt attribute at all, `""` when it has an
 * empty one (a decorative-image signal), and the trimmed string otherwise. The
 * distinction matters: a missing alt is a gap the alt-text lever fixes; an
 * intentionally-empty alt is a decorative image we leave alone. `width`/`height`
 * are the tag's declared numeric attributes (not the rendered size), null when
 * absent or non-numeric.
 */
export type PageImage = {
  /** The raw src attribute, resolved to an absolute URL where possible. */
  src: string;
  /** null = no alt attribute; "" = empty alt (decorative); else the alt text. */
  alt: string | null;
  width: number | null;
  height: number | null;
};

export type PageSnapshot = {
  id: string;
  page_id: string;
  /** Set by website crawl — links HTML snapshot to `observation-runs.json`. */
  observation_run_id?: string;
  url: string;
  canonical_url: string | null;
  fetched_at: string;
  http_status: number;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  h2_list: string[];
  h3_count: number;
  faqs: FaqItem[];
  schema_types: string[];
  location_terms: string[];
  service_terms: string[];
  internal_link_count: number;
  external_link_count: number;
  word_count: number;
  robots_meta: string | null;
  has_canonical_mismatch: boolean;
  content_hash: string;
  headings_hash: string;
  faq_hash: string;
  schema_hash: string;
  /** Extraction confidence — "confirmed" when JSON-LD was found and parsed, "uncertain" when raw fetch may have missed client-rendered content */
  extraction_certainty?: ExtractionCertainty;
  /** Number of distinct FAQPage JSON-LD blocks found (>1 = duplicate on the page) */
  faq_schema_block_count?: number;
  /** Structural warnings detected during extraction */
  structural_warnings?: string[];
  /**
   * G8 — JSON-LD schema validation warnings vs Google rich-result specs.
   * Format: `schema_<severity>:<type>: <message>` (see `schema-validator.ts`).
   * Empty or undefined means no recognized schemas or all valid.
   */
  schema_validation_warnings?: string[];
  /** Count of meaningful HTML tables (≥2 rows) on the page */
  table_count?: number;
  /** All internal links on this page — href + anchor text. Populated after scan. */
  internal_links?: { href: string; anchor_text: string }[];

  /**
   * P24 image-SEO lane (2026-07-03): every <img> found on the page, with its
   * src + alt state + declared dimensions. Optional so every snapshot captured
   * before this field existed stays byte-identical (undefined, not `[]`). The
   * alt-text audit + lever read this; a page with no captured images (undefined
   * or empty) contributes nothing. Cap 200 entries to bound a gallery page. On
   * the egress-lean Supabase projection this column is not selected by default
   * (same posture as internal_links), so hosted firing needs the projection +
   * migration follow-up; the file backend round-trips it in full for
   * dev/tests + the generation path can consume the extractor output inline. */
  images?: PageImage[];

  // ── Plan A + B1 (2026-04-20): broader page-content extraction ──
  // All new fields are optional so pre-existing snapshots stay valid.
  // Captured in `extractor.ts`; consumed by the keyword-gap scanner's
  // coverage check to reduce false "not covered" signals.

  /** All <h3> text in document order. Parallel to `h2_list`. Cap 30. */
  h3_list?: string[];
  /** Ordered main-content excerpt, pulled from <main>/<article> (fallback:
   *  <body> minus <nav>/<footer>/<header>/<aside>). Cap 20 entries x 300
   *  chars each (~6k chars total, N19 2026-07-02, was 10x300/~3k under
   *  Plan A/B1). Prefers real <p> tags; when a page has zero usable
   *  paragraphs (e.g. a builder that renders body copy in leaf
   *  divs/spans/list items instead of <p>), falls back to leaf block-level
   *  text nodes above an 8-word floor. Explicitly excludes nav/footer
   *  boilerplate so cross-page menus don't create false "covered" signals. */
  body_paragraph_sample?: string[];
  /** Text from list/card/tile elements inside the content area. Heuristic:
   *  <li>, <article>, or class-names matching /\b(card|tile|item|neighborhood|
   *  service|offering)\b/i — restricted to the content selector, so
   *  sidebar/nav children don't leak in. Cap 20 entries × 120 chars. */
  card_texts?: string[];
  /** Schema entity names from JSON-LD Service/Offer/Organization/
   *  BreadcrumbList items (.name fields). Cap 20 entries × 100 chars.
   *  Distinct from `schema_types` which only captures @type strings. */
  schema_entity_names?: string[];

  /** Owning tenant. */
  tenant_id: string;
};

export type PageSnapshotDiff = {
  page_id: string;
  url: string;
  previous_fetched_at: string;
  current_fetched_at: string;
  changed: boolean;
  title_changed: boolean;
  h1_changed: boolean;
  meta_description_changed: boolean;
  faq_count_changed: boolean;
  /** Exact prior FAQ count captured when the diff is built. Optional for
   * pre-2026-07-17 stored diffs, which cannot support a directional alert. */
  previous_faq_count?: number;
  schema_changed: boolean;
  content_changed: boolean;
  headings_changed: boolean;
  /** Phase post-A+B1 (2026-04-21). True when h2_list arrays differ
   *  (order-sensitive string equality). */
  h2_changed: boolean;
  /** Phase post-A+B1 (2026-04-21). True when h3_list arrays differ.
   *  Absent on either side is treated as empty. */
  h3_changed: boolean;
  /** Phase post-A+B1 (2026-04-21). True when schema_entity_names arrays
   *  differ (set-based — order doesn't matter). */
  schema_entity_names_changed: boolean;
  summary: string;
};

// ── Citation rollup (per page × topic) ──────────────────────────────

export type PlatformCitationStats = {
  citation_count: number;
  distinct_answers: number;
  avg_citation_order: number | null;
};

export type CitationPageRollup = {
  page_id: string;
  page_url: string;
  domain: string;
  topic: string;
  is_owned: boolean;
  total_citations: number;
  distinct_answers: number;
  distinct_prompts: number;
  by_platform: Record<string, PlatformCitationStats>;
  first_observed_at: string;
  last_observed_at: string;
};

// ── Citation evidence index ─────────────────────────────────────────

export type TopicCitationSummary = {
  topic: string;
  total_citations: number;
  owned_citations: number;
  competitor_citations: number;
  directory_citations: number;
  other_citations: number;
  top_owned_pages: { url: string; count: number }[];
  top_competitor_pages: { url: string; count: number }[];
  top_directory_pages: { url: string; count: number }[];
};

export type CitationEvidenceIndex = {
  built_at: string;
  total_citations_processed: number;
  by_page_and_topic: CitationPageRollup[];
  by_topic: TopicCitationSummary[];
  page_to_topics: Record<string, string[]>;
};

// ── Prompt-to-page fit (future) ─────────────────────────────────────

export type PagePromptFit = {
  page_id: string;
  prompt_id: string;
  topic: string;
  score: number;
  factors: {
    city_match: number;
    service_match: number;
    page_type_relevance: number;
    title_coverage: number;
    faq_coverage: number;
    schema_support: number;
    citation_evidence: number;
  };
  confidence: "high" | "medium" | "low";
  is_best_for_prompt: boolean;
};

/**
 * Sitemap reconciliation — historically stored at
 * `.data/global/sitemap-reconciliation.json`; mirrored to Supabase
 * `public.sitemap_reconciliation` (per-tenant PK) as of Phase A.3
 * (post-A.3.5). Store classification flipped from GLOBAL →
 * TENANT_SCOPED in the same step.
 *
 * Type shape extended additively from the original A.3.3b subset
 * to match what the writer (`scripts/scan-owned-pages.ts:130–138`)
 * actually emits to disk. The additive fields close a pre-existing
 * type/disk mismatch: the on-disk JSON has always carried
 * `fetched_at`, `sitemap_domain`, `registry_matched`, `sitemap_only`,
 * and per-page `sitemap_lastmod`, but the published type omitted them.
 * Older consumers continue to work — every new field is optional or
 * has a default.
 */
export type SitemapReconciliationCanonicalPage = {
  url: string;
  path: string;
  registry_page_id: string | null;
  scan_page_id: string;
  /** Phase A.3 (post-A.3.5) — sitemap-declared lastmod (optional;
   *  many sitemaps omit). */
  sitemap_lastmod?: string | null;
};

export type SitemapReconciliationStalePage = {
  url: string;
  path: string;
  domain: string;
  registry_page_id: string;
  /** Phase A.3 (post-A.3.5) — literal-union reason. Existing
   *  callers passed open `string`; tightened additively here. */
  reason: "stale_domain" | "not_in_sitemap" | "unscannable_url" | string;
};

export type SitemapReconciliation = {
  canonical_pages: SitemapReconciliationCanonicalPage[];
  stale_pages: SitemapReconciliationStalePage[];
  sitemap_url_count: number;
  /** Phase A.3 (post-A.3.5) — additive fields the writer always
   *  emitted. All optional so older consumers still type-check. */
  fetched_at?: string;
  sitemap_domain?: string;
  registry_matched?: number;
  sitemap_only?: number;
};

// ── Retired frontier/wave/outcome engine row shapes ─────────────────
// The compute engines (frontier-planner.ts, frontier-compiler.ts,
// wave-planner.ts, outcome-watch.ts, asset-response.ts) were deleted in the
// 2026-07 dead-code campaign; nothing produced or consumed their outputs at
// runtime. The persistence layer still declares repository getters typed
// against these persisted-store row shapes, so the type definitions live on
// here.

export type FrontierType =
  | "topic_frontier"
  | "city_frontier"
  | "service_frontier"
  | "page_gap_frontier"
  | "competitor_pressure_frontier";

export type RecommendedMoveType =
  | "repair_existing_pages"
  | "roll_out_validated_pattern"
  | "create_missing_page"
  | "expand_internal_link_cluster"
  | "strengthen_entity_support"
  | "comparison_content_play";

export type FrontierStatus = "opportunity" | "attacking" | "watching" | "dismissed";

export type FrontierOpportunity = {
  frontierOpportunityId: string;
  frontierKey: string;
  frontierType: FrontierType;
  title: string;
  createdAt: string;
  status: FrontierStatus;
  topic: string;
  geography: string | null;
  service: string | null;
  ownedCoverageSummary: string;
  competitorPressureSummary: string;
  citationOpportunity: number;
  ownedShare: number;
  ownedPageCount: number;
  ownedPagesWithFaq: number;
  competitorCitations: number;
  structuralOpportunity: number;
  recommendedMoveType: RecommendedMoveType;
  linkedPages: string[];
  linkedBriefIds: string[];
  linkedWaveIds: string[];
  rationale: string;
  priorityScore: number;
  notes: string | null;
};

export type WaveType =
  | "quick_fix_wave"
  | "pattern_rollout_wave"
  | "verification_wave"
  | "mixed_operator_wave";

export type WaveStatus =
  | "proposed"
  | "handed_off"
  | "in_progress"
  | "partially_shipped"
  | "shipped"
  | "partially_verified"
  | "completed"
  | "dismissed";

export type RolloutWave = {
  rolloutWaveId: string;
  title: string;
  sourcePatternId: string;
  waveType: WaveType;
  createdAt: string;
  status: WaveStatus;
  targetPages: string[];
  briefIds: string[];
  issueIds: string[];
  rationale: string;
  priorityScore: number;
  expectedVerificationMode: string;
  notes: string | null;
};

export type OutcomeAssessment =
  | "too_early"
  | "incubating"
  | "early_movement"
  | "likely_no_visible_effect_yet"
  | "mixed_signal"
  | "promising_but_ambiguous";

export type OutcomeObservation = {
  outcomeObservationId: string;
  issueId: string;
  rolloutExecutionId: string;
  sourcePatternId: string;
  targetPage: string;
  observedAt: string;
  daysSinceVerified: number;
  citationCount: number | null;
  citationDelta: number | null;
  scorecardSignals: string;
  resultSignals: string;
  outcomeAssessment: OutcomeAssessment;
  evidenceSummary: string;
  linkedResultIds: string[];
  notes: string | null;
};

export type RecommendedAssetType =
  | "city_page"
  | "service_page"
  | "comparison_page"
  | "guide_article"
  | "entity_profile_strengthening"
  | "directory_profile_strengthening"
  | "roundup_outreach_target"
  | "internal_link_support_package"
  | "structural_refresh_existing_page";

export type ConfidenceLabel = "strong_fit" | "probable_fit" | "weak_fit" | "mixed";

export type AssetResponse = {
  assetResponseId: string;
  frontierKey: string;
  topic: string;
  createdAt: string;
  dominantSourceType: SourceType;
  responseType: ResponseType;
  recommendedAssetType: RecommendedAssetType;
  confidenceLabel: ConfidenceLabel;
  rationale: string;
  ownedEquivalentExists: boolean;
  ownedEquivalentPages: string[];
  missingAssetSignals: string[];
  supportingSourcePatterns: string[];
  linkedFrontierOpportunityId: string | null;
  linkedAttackPackageId: string | null;
  notes: string | null;
};

export type PackageStatus =
  | "proposed"
  | "compiled"
  | "launched"
  | "handed_off"
  | "in_progress"
  | "partially_verified"
  | "completed"
  | "dismissed";

export type MissingPagePlan = {
  suggestedTitle: string;
  pageType: string;
  targetTopic: string;
  targetCity: string | null;
  targetService: string | null;
  rationale: string;
  suggestedComponents: string[];
  suggestedInternalLinksIn: string[];
  suggestedInternalLinksOut: string[];
  verificationExpectations: string[];
};

export type FrontierAttackPackage = {
  frontierAttackPackageId: string;
  frontierOpportunityId: string;
  title: string;
  createdAt: string;
  status: PackageStatus;
  recommendedMoveType: RecommendedMoveType;
  linkedPages: string[];
  pagesToRepair: string[];
  pagesToCreate: MissingPagePlan[];
  comparisonTargets: string[];
  internalLinkTargets: { from: string; to: string; reason: string }[];
  linkedBriefIds: string[];
  linkedWaveIds: string[];
  rationale: string;
  executionSteps: string[];
  verificationPlan: string[];
  priorityScore: number;
  assetResponseSummary: string | null;
  notes: string | null;
};

export type MissingPageStatus =
  | "planned"
  | "handed_off"
  | "drafted"
  | "launched"
  | "indexed"
  | "watching"
  | "completed"
  | "dismissed";

export type TrackedMissingPage = {
  missingPagePlanId: string;
  frontierAttackPackageId: string;
  title: string;
  pageType: string;
  targetTopic: string;
  targetCity: string | null;
  targetService: string | null;
  status: MissingPageStatus;
  rationale: string;
  suggestedComponents: string[];
  suggestedInternalLinksIn: string[];
  suggestedInternalLinksOut: string[];
  verificationExpectations: string[];
  createdAt: string;
  handedOffAt: string | null;
  launchedAt: string | null;
  indexedAt: string | null;
  notes: string | null;
};

// Relocated verbatim from src/domains/pages/issues.ts (CORE 100K, 2026-07-21).
// The runtime issue-store getters had no callers; the persistence layer
// consumes only these row types.

export type IssueStatus =
  | "new"
  | "handed_off"
  | "in_progress"
  | "shipped"
  | "verified"
  | "not_fixed"
  | "dismissed";

export type PersistedIssue = {
  issueId: string;
  pageUrl: string;
  pagePath: string;
  category: string;
  status: IssueStatus;
  handedOffAt: string | null;
  shippedAt: string | null;
  verifiedAt: string | null;
  updatedAt: string;
  verifyResult: {
    cleared: boolean;
    remaining: string[];
    summary: string;
  } | null;
  /**
   * ObservationRun id for the live verify fetch that produced the persisted snapshot
   * (`website_verify`). Present for verifications after this field shipped.
   */
  verificationObservationRunId?: string | null;
  /**
   * Snapshot / crawl ObservationRun id on disk immediately before verify ran (nullable legacy).
   */
  verificationBaselineObservationRunId?: string | null;
};

export type RolloutExecution = {
  executionId: string;
  briefId: string;
  issueId: string;
  sourcePatternId: string;
  targetPage: string;
  briefTitle: string;
  briefType: "fix" | "growth";
  createdAt: string;
  handedOffAt: string | null;
  shippedAt: string | null;
  verifiedAt: string | null;
  verificationResult: string | null;
  notes: string | null;
};

export type OutcomeStatus =
  | "shipped_not_verified"
  | "verification_failed"
  | "structurally_verified_outcome_too_early"
  | "structurally_verified_no_clear_impact_yet"
  | "structurally_verified_with_positive_signal";

export type PatternEvidenceRecord = {
  patternEvidenceId: string;
  sourcePatternId: string;
  briefId: string;
  issueId: string;
  rolloutExecutionId: string;
  targetPage: string;
  createdAt: string;
  shippedAt: string | null;
  verifiedAt: string | null;
  structuralVerificationResult: string | null;
  preShipCitationCount: number | null;
  postShipCitationCount: number | null;
  outcomeStatus: OutcomeStatus;
  notes: string | null;
};
