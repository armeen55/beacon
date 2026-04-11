/**
 * Training Data Pipeline — scaffold types for understanding what
 * enters model memory / crawl layers / source ecosystems.
 *
 * Beacon does NOT know what models have actually ingested. It can
 * only observe what it publishes and what gets cited. These types
 * define the assessment framework.
 */

export type ContentVisibilityChannel =
  | "website_page"
  | "structured_data"
  | "llms_txt"
  | "sitemap"
  | "social_profile"
  | "directory_listing";

export type ChannelReadiness = {
  channel: ContentVisibilityChannel;
  label: string;
  status: "active" | "partial" | "missing" | "unknown";
  detail: string;
};

export type TrainingDataReadiness = {
  computed_at: string;
  channels: ChannelReadiness[];
  active_count: number;
  total_channels: number;
  overall_status: "good" | "partial" | "weak";
  assessment: string;
};
