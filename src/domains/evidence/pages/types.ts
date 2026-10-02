// ── Page types ──────────────────────────────────────────────────────

type PageType =
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
  /** Complete captured HTML answer, only within the held main-content budget; old excerpts stay samples. */
  answer_text?: string;
  answer_complete?: boolean;
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
  page_id: string; capture_version?: number;
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
  /** Number of observed FAQPage entities after supported @id merging; several entities alone do not prove duplication. */
  faq_schema_block_count?: number;
  /** Structural warnings detected during extraction */
  structural_warnings?: string[];
  /**
   * Supported Schema.org graph/content warnings, not a rich-result eligibility guarantee.
   * Format: `schema_<severity>:<type>: <message>` (see `schema-validator.ts`).
   * Empty or undefined means no recognized schemas or all valid.
   */
  schema_validation_warnings?: string[];
  /** Count of meaningful HTML tables (≥2 rows) on the page */
  table_count?: number;
  /** All internal links on this page — href + anchor text. Populated after scan. */
  internal_links?: { href: string; anchor_text: string }[];

  // Optional content projections preserve legacy snapshots.

  /** All <h3> text in document order. Parallel to `h2_list`. Cap 30. */
  h3_list?: string[];
  /** Held main text, capped at 100KB with a truncation warning; absent on legacy sample-only captures. */
  body_text?: string;
  /** Observed source markup and JSON-LD, never publication copy or rendered-visibility certification. */
  content_capture?: { version: 1; mainHtml: string; jsonLd: string[]; complete: boolean; sourceRevision?: string;
    validation?: { contract: 1; materialHash: string };
    renderedAttempt?: { sourceRevision: string; revision: string; cacheKey: string; taskId: string; outcome: "unchanged_incomplete" } };
  /** Up to 20 main-content excerpts of 300 characters; paragraphs or fallback leaf blocks of at least eight words, excluding navigation. */
  body_paragraph_sample?: string[];
  /** Up to 20 content-root list/card/item excerpts of 120 characters, excluding sidebar/navigation. */
  card_texts?: string[];
  /** Up to 20 distinct JSON-LD Service/Offer/Organization/BreadcrumbList names of 100 characters. */
  schema_entity_names?: string[];

  /** Owning tenant. */
  tenant_id: string;
};
