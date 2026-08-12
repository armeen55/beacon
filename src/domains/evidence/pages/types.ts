// ── Page types ──────────────────────────────────────────────────────

export type PageType =
  | "homepage"
  | "city_page"
  | "service_page"
  | "project_page"
  | "directory_profile"
  | "other";

type OwnershipTier =
  | "owned"
  | "competitor"
  | "directory"
  | "earned_media"
  | "social"
  | "other";

type DiscoverySource =
  | "citation"
  | "changelog"
  | "entity_url"
  | "manual";

// ── Evidence tiers ──────────────────────────────────────────────────

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
  /** The address the fetch actually landed on, after every redirect. Absent on rows written before this was
   *  recorded, which is exactly what marks them as unable to say where the read came from. A row whose
   *  final_url is another address is never a page carrying that address's content: the crawler drops it. */
  final_url?: string | null;
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
  /** THE WHOLE de-chromed main content of the page, capped at 100,000 characters (a cut is recorded
   *  in `structural_warnings` as `body_text_truncated:`). This is what `content_hash` hashes and
   *  what lets a reader answer "no, this page does not say that". Absent on pre-2026-08-03
   *  snapshots, which is exactly what marks them as sample-era captures. */
  body_text?: string;
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

// ── Citation rollup (per page × topic) ──────────────────────────────

type PlatformCitationStats = {
  citation_count: number;
  distinct_answers: number;
  avg_citation_order: number | null;
};

type CitationPageRollup = {
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

type TopicCitationSummary = {
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

// ── Retired frontier/wave/outcome engine row shapes ─────────────────
// The compute engines (frontier-planner.ts, frontier-compiler.ts,
// wave-planner.ts, outcome-watch.ts, asset-response.ts) were deleted in the
// 2026-07 dead-code campaign; nothing produced or consumed their outputs at
// runtime. The persistence layer still declares repository getters typed
// against these persisted-store row shapes, so the type definitions live on
// here.

// Relocated verbatim from src/domains/evidence/pages/issues.ts (CORE 100K, 2026-07-21).
// The runtime issue-store getters had no callers; the persistence layer
// consumes only these row types.

type IssueStatus =
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

