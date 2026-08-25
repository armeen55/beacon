/**
 * The shared vocabulary the measurement and opportunity record types are built
 * from. Every name here has a live import site; the label maps, score/threat/
 * brief/checklist unions and the `as const` arrays that used to back these types
 * were carried by surfaces this product no longer has, so they are gone rather
 * than kept as a wider vocabulary than anything speaks.
 */

export type Platform = "chatgpt" | "google_aio" | "perplexity" | "gemini" | "claude" | "all";

export type Priority = "critical" | "high" | "medium" | "low";

export type ImpactLevel = "high" | "medium" | "low";

export type IntentType =
  | "informational"
  | "commercial"
  | "navigational"
  | "transactional";

export type OpportunityStatus =
  | "new"
  | "queued"
  | "executing"
  | "validating"
  | "partially_captured"
  | "captured"
  | "regressed"
  | "monitoring"
  | "deferred"
  | "closed";

export type OpportunitySource =
  | "manual_audit"
  | "tool_alert"
  | "competitor_watch"
  | "ai_suggestion"
  | "brief_discovery"
  | "result_analysis";

export type ConfidenceLevel = "high" | "medium" | "low" | "speculative";

export type CloseReason = "dismissed" | "lost" | "superseded" | "irrelevant";

export type EffortLevel = "trivial" | "small" | "medium" | "large" | "epic";

export type SignalType =
  | "faq"
  | "content"
  | "technical"
  | "page"
  | "citation"
  | "review"
  | "lead_form"
  | "off_page_seo"
  | "measurement"
  | "service_page";

export type AssetType =
  | "homepage"
  | "city_page"
  | "service_page"
  | "infrastructure"
  | "sitemap"
  | "directory_profile"
  | "lead_form"
  | "project_page"
  | "process_page"
  | "brand_page"
  | "hub_page";

export type MetricType =
  | "visibility_rank"
  | "citation_share"
  | "mention_count"
  | "share_of_voice"
  | "average_position"
  | "organic_clicks"
  | "form_submissions";

/** Words that claim THE PRESENT. One owner on purpose: the receipt validator refuses an undated line that says
 *  them, and the answer-intel projection keeps an engine's present-tense wording off receipts entirely; two
 *  drifting copies of this pattern would quietly re-open whole-proposal refusals for whichever word one side gained. */
export const CURRENT_CLAIM = /\b(?:today|right now|currently|as it stands)\b/i;
