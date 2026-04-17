export const PLATFORMS = [
  "chatgpt",
  "google_aio",
  "perplexity",
  "gemini",
  "claude",
  "all",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  chatgpt: "ChatGPT",
  google_aio: "Google AIO",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
  all: "All Platforms",
};

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const IMPACT_LEVELS = ["high", "medium", "low"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export const INTENT_TYPES = [
  "informational",
  "commercial",
  "navigational",
  "transactional",
] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

export const OPPORTUNITY_STATUSES = [
  "new",
  "queued",
  "executing",
  "validating",
  "partially_captured",
  "captured",
  "regressed",
  "monitoring",
  "deferred",
  "closed",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  new: "New",
  queued: "Queued",
  executing: "Executing",
  validating: "Validating",
  partially_captured: "Partially Captured",
  captured: "Captured",
  regressed: "Regressed",
  monitoring: "Monitoring",
  deferred: "Deferred",
  closed: "Closed",
};

export const OPPORTUNITY_SOURCES = [
  "manual_audit",
  "tool_alert",
  "competitor_watch",
  "ai_suggestion",
  "brief_discovery",
  "result_analysis",
] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];

export const OPPORTUNITY_SOURCE_LABELS: Record<OpportunitySource, string> = {
  manual_audit: "Manual Audit",
  tool_alert: "Tool Alert",
  competitor_watch: "Competitor Watch",
  ai_suggestion: "AI Suggestion",
  brief_discovery: "Brief Discovery",
  result_analysis: "Result Analysis",
};

export const CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
  "speculative",
] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  high: "Strong signal",
  medium: "Mixed signals",
  low: "Limited data",
  speculative: "Hunch",
};

export const CLOSE_REASONS = [
  "dismissed",
  "lost",
  "superseded",
  "irrelevant",
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  dismissed: "Dismissed",
  lost: "Lost",
  superseded: "Superseded",
  irrelevant: "Irrelevant",
};

export const SCORE_LABELS = [
  "act_now",
  "strong",
  "moderate",
  "low",
  "deferred",
] as const;
export type ScoreLabel = (typeof SCORE_LABELS)[number];

export const SCORE_LABEL_DISPLAY: Record<ScoreLabel, string> = {
  act_now: "Act Now",
  strong: "Strong",
  moderate: "Moderate",
  low: "Low",
  deferred: "Deferred",
};

export const THREAT_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type ThreatLevel = (typeof THREAT_LEVELS)[number];

export const THREAT_LEVEL_LABELS: Record<ThreatLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const BRIEF_STATUSES = [
  "draft",
  "approved",
  "in_progress",
  "completed",
  "blocked",
] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

export const BRIEF_STATUS_LABELS: Record<BriefStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  in_progress: "In Progress",
  completed: "Completed",
  blocked: "Blocked",
};

export const BRIEF_TYPES = [
  "page_rebuild",
  "new_page",
  "schema_fix",
  "content_update",
  "citation_campaign",
  "technical_fix",
  "off_page",
] as const;
export type BriefType = (typeof BRIEF_TYPES)[number];

export const BRIEF_TYPE_LABELS: Record<BriefType, string> = {
  page_rebuild: "Rebuild page",
  new_page: "New page",
  schema_fix: "Schema / structured data",
  content_update: "Content refresh",
  citation_campaign: "Citation push",
  technical_fix: "Technical fix",
  off_page: "Off-site work",
};

export const EFFORT_LEVELS = [
  "trivial",
  "small",
  "medium",
  "large",
  "epic",
] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const EFFORT_LEVEL_LABELS: Record<EffortLevel, string> = {
  trivial: "Trivial",
  small: "Small",
  medium: "Medium",
  large: "Large",
  epic: "Epic",
};

export const CHECKLIST_ITEM_STATUSES = [
  "pending",
  "in_progress",
  "done",
  "skipped",
] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

export const OUTCOME_VERDICTS = ["pending", "hit", "partial", "missed"] as const;
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];

export const OUTCOME_VERDICT_LABELS: Record<OutcomeVerdict, string> = {
  pending: "Pending",
  hit: "Hit",
  partial: "Partial",
  missed: "Missed",
};

export const SIGNAL_TYPES = [
  "faq",
  "content",
  "technical",
  "page",
  "citation",
  "review",
  "lead_form",
  "off_page_seo",
  "measurement",
  "service_page",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  faq: "FAQ content",
  content: "On-page copy",
  technical: "Technical / site",
  page: "Page launch",
  citation: "Citations / listings",
  review: "Reviews program",
  lead_form: "Lead capture",
  off_page_seo: "Off-site / authority",
  measurement: "Tracking & measurement",
  service_page: "Service page",
};

export const ASSET_TYPES = [
  "homepage",
  "city_page",
  "service_page",
  "infrastructure",
  "sitemap",
  "directory_profile",
  "lead_form",
  "project_page",
  // Phase 1 additions — canonical page-class coverage for the schema-experiment pipeline.
  "process_page",
  "brand_page",
  "hub_page",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  homepage: "Homepage",
  city_page: "City Page",
  service_page: "Service Page",
  infrastructure: "Infrastructure",
  sitemap: "Sitemap",
  directory_profile: "Directory Profile",
  lead_form: "Lead Form",
  project_page: "Project Page",
  process_page: "Process Page",
  brand_page: "Brand Page",
  hub_page: "Hub Page",
};

export const METRIC_TYPES = [
  "visibility_rank",
  "citation_share",
  "mention_count",
  "share_of_voice",
  "average_position",
  "organic_clicks",
  "ai_referrals",
  "form_submissions",
] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export const METRIC_TYPE_LABELS: Record<MetricType, string> = {
  visibility_rank: "Visibility rank",
  citation_share: "Citation share",
  mention_count: "Mentions",
  share_of_voice: "Share of voice",
  average_position: "Avg. position",
  organic_clicks: "Organic clicks",
  ai_referrals: "AI referrals",
  form_submissions: "Form submissions",
};

export const METRIC_DIRECTION: Record<
  MetricType,
  "higher_is_better" | "lower_is_better"
> = {
  visibility_rank: "lower_is_better",
  citation_share: "higher_is_better",
  mention_count: "higher_is_better",
  share_of_voice: "higher_is_better",
  average_position: "lower_is_better",
  organic_clicks: "higher_is_better",
  ai_referrals: "higher_is_better",
  form_submissions: "higher_is_better",
};

export const METRIC_UNITS: Record<MetricType, string> = {
  visibility_rank: "",
  citation_share: "%",
  mention_count: "",
  share_of_voice: "%",
  average_position: "",
  organic_clicks: "",
  ai_referrals: "",
  form_submissions: "",
};

