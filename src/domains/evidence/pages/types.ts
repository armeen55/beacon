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

type FaqItem = {
  question: string;
  answer_excerpt: string;
  source: "jsonld" | "html_details" | "html_section";
};

/** Visible answered pairs, never markup assertions or legacy entries of unknown origin. Raw snapshots remain intact. */
export function visibleFaqs(items: unknown): (FaqItem & { source: Exclude<FaqItem["source"], "jsonld"> })[] {
  return (Array.isArray(items) ? items : []).filter((item): item is FaqItem & { source: Exclude<FaqItem["source"], "jsonld"> } => {
    const f = item as Partial<FaqItem> | null;
    return !!f && (f.source === "html_details" || f.source === "html_section")
      && typeof f.question === "string" && !!f.question.trim()
      && typeof f.answer_excerpt === "string" && !!f.answer_excerpt.trim();
  });
}

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
  /** How confident the extractor is: "confirmed" when real body content was read, "uncertain" when a raw fetch may have missed client-rendered content. */
  extraction_certainty?: "confirmed" | "uncertain";
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
