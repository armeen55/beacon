import type { SourceCategory } from "@/domains/citation-observations/types";

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

// ── PageSnapshot (future extraction) ────────────────────────────────

export type FaqItem = {
  question: string;
  answer_excerpt: string;
  source: "jsonld" | "html_details" | "html_section";
};

/** How confident the extractor is about a structural field */
export type ExtractionCertainty = "confirmed" | "uncertain";

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

  // ── Plan A + B1 (2026-04-20): broader page-content extraction ──
  // All new fields are optional so pre-existing snapshots stay valid.
  // Captured in `extractor.ts`; consumed by the keyword-gap scanner's
  // coverage check to reduce false "not covered" signals.

  /** All <h3> text in document order. Parallel to `h2_list`. Cap 30. */
  h3_list?: string[];
  /** First N content paragraphs by word count, pulled from <main>/
   *  <article> (fallback: <body> minus <nav>/<footer>/<header>/<aside>).
   *  Cap 10 entries × 300 chars each. Explicitly excludes nav/footer
   *  boilerplate so cross-page menus don't create false "covered"
   *  signals. */
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

/** `.data/sitemap-reconciliation.json` — not yet mirrored in Supabase. */
export type SitemapReconciliationCanonicalPage = {
  url: string;
  path: string;
  registry_page_id: string | null;
  scan_page_id: string;
};

export type SitemapReconciliationStalePage = {
  url: string;
  path: string;
  domain: string;
  registry_page_id: string;
  reason: string;
};

export type SitemapReconciliation = {
  canonical_pages: SitemapReconciliationCanonicalPage[];
  stale_pages: SitemapReconciliationStalePage[];
  sitemap_url_count: number;
};
