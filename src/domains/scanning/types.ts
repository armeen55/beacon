export type FindingType =
  | "title_changed"
  | "meta_changed"
  | "h1_changed"
  /** Phase post-A+B1 (2026-04-21) — H2 list changed between scans.
   *  Replaces the fallback into `unexpected_change` that previously
   *  swallowed H2 edits. Surfaces in the Today banner. */
  | "h2_changed"
  /** Phase post-A+B1 (2026-04-21) — H3 list changed. h3_list was added
   *  to PageSnapshot yesterday but had no diff/finding surface until now. */
  | "h3_changed"
  | "canonical_changed"
  | "faq_changed"
  | "schema_changed"
  /** Phase post-A+B1 (2026-04-21) — schema entity names (Service.name,
   *  Offer.name, BreadcrumbList items, etc.) changed. Distinct from
   *  `schema_changed` which only tracks @type values. */
  | "schema_entity_names_changed"
  | "content_changed"
  | "links_changed"
  | "new_guardrail"
  | "guardrail_cleared"
  | "deploy_mismatch"
  | "unexpected_change"
  | "page_added"
  | "page_removed"
  | "stale_visibility"
  | "faq_without_schema"
  /** G8 — JSON-LD doesn't satisfy Google rich-result requirements. */
  | "schema_invalid"
  /** G6 — at least one AI crawler (GPTBot/PerplexityBot/ClaudeBot/...) is
   * disallowed by robots.txt on a cited URL. Silent AEO killer. */
  | "robots_txt_blocked"
  /** Phase 1 — page's `schema_types` is missing at least one type from
   * the expected set for its `asset_type`. Proactive (pre-change)
   * finding that surfaces schema-parity opportunities. */
  | "schema_missing_for_page_type";

export type FindingStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "ignored"
  | "expected";

export type FindingSeverity = "high" | "medium" | "low";

export type FindingPriority = "critical" | "important" | "minor" | "informational";

export type PromotionStatus = "none" | "changelog" | "secondary_note" | "history_only";

export type Finding = {
  id: string;
  type: FindingType;
  url: string;
  pagePath: string;
  detectedAt: string;
  scanRunId: string;
  previousState: string | null;
  currentState: string | null;
  severity: FindingSeverity;
  priority: FindingPriority;
  priorityScore: number;
  summary: string;
  suggestedAction: string;
  status: FindingStatus;
  resolvedAt: string | null;
  linkedChangeId: string | null;
  promotionStatus: PromotionStatus;
  resolutionNote: string | null;
  suppressUntil: string | null;
  citationCount: number;
  isHomepage: boolean;
  contradictsChangelog: boolean;
  /** Phase 11: whether topic-level metrics moved ≥15% around detection date */
  metricMovementDetected?: boolean;
  /** Phase 11: composite signal strength 0-100 */
  signalStrength?: number;
  /** Fix 2 (2026-04-21) — auto-link: if this finding's URL matches a recently-
   *  accepted recommendation (within 14 days), the rec's ID is stamped here at
   *  detection time. `confirmFindingAsChange` carries this into the created
   *  ChangelogEntry so the attribution engine knows the outcome came from an
   *  accepted Beacon rec. Manual Confirm preserved — this is linkage, not
   *  auto-confirmation. */
  source_rec_id?: string;
  /** Matching pattern ID (from `BeaconRecommendation.patternId`) when the
   *  auto-linked rec carries one. Null when the rec isn't pattern-backed. */
  source_pattern_id?: string | null;
  /** Owning tenant. */
  tenant_id: string;
};

export type ScanSettings = {
  preferredHour: number;
  timezone: string;
  scope: "full" | "priority";
  enabled: boolean;
};

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  preferredHour: 9,
  timezone: "America/Los_Angeles",
  scope: "full",
  enabled: true,
};

export const FINDING_TYPE_LABELS: Record<FindingType, string> = {
  title_changed: "Title changed",
  meta_changed: "Meta description changed",
  h1_changed: "H1 changed",
  h2_changed: "H2 changed",
  h3_changed: "H3 changed",
  canonical_changed: "Canonical changed",
  faq_changed: "Q&A count changed",
  schema_changed: "Schema changed",
  schema_entity_names_changed: "Schema entity names changed",
  content_changed: "Content changed",
  links_changed: "Internal links changed",
  new_guardrail: "New issue detected",
  guardrail_cleared: "Issue resolved",
  deploy_mismatch: "Deploy mismatch",
  unexpected_change: "Unexpected change",
  page_added: "Page added",
  page_removed: "Page removed",
  stale_visibility: "Visibility data stale",
  faq_without_schema: "FAQ visible, no schema",
  schema_invalid: "Schema fails rich-result spec",
  robots_txt_blocked: "robots.txt blocks AI crawler",
  schema_missing_for_page_type: "Schema missing for page type",
};

export const FINDING_SEVERITY_LABELS: Record<FindingSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const FINDING_PRIORITY_LABELS: Record<FindingPriority, string> = {
  critical: "Critical",
  important: "Important",
  minor: "Minor",
  informational: "FYI",
};

export const FINDING_PRIORITY_ORDER: Record<FindingPriority, number> = {
  critical: 0,
  important: 1,
  minor: 2,
  informational: 3,
};

export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  none: "Not promoted",
  changelog: "In changelog",
  secondary_note: "Secondary note",
  history_only: "History only",
};
