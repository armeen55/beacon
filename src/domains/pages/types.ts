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
};

// ── PageSnapshot (future extraction) ────────────────────────────────

export type FaqItem = {
  question: string;
  answer_excerpt: string;
  source: "jsonld" | "html_details" | "html_section";
};

export type PageSnapshot = {
  id: string;
  page_id: string;
  url: string;
  fetched_at: string;
  http_status: number;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  h2_list: string[];
  faqs: FaqItem[];
  schema_types: string[];
  location_terms: string[];
  service_terms: string[];
  internal_link_count: number;
  external_link_count: number;
  word_count: number;
  content_hash: string;
  headings_hash: string;
  faq_hash: string;
  schema_hash: string;
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
