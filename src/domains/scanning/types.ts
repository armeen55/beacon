export type FindingType =
  | "title_changed"
  | "meta_changed"
  | "h1_changed"
  | "canonical_changed"
  | "faq_changed"
  | "schema_changed"
  | "content_changed"
  | "links_changed"
  | "new_guardrail"
  | "guardrail_cleared"
  | "deploy_mismatch"
  | "unexpected_change"
  | "page_added"
  | "page_removed"
  | "stale_visibility"
  | "faq_without_schema";

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
  canonical_changed: "Canonical changed",
  faq_changed: "Q&A count changed",
  schema_changed: "Schema changed",
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
