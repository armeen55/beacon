export type ProposedBriefType =
  | "page_rebuild"
  | "new_page"
  | "page_refresh"
  | "faq_upgrade"
  | "schema_alignment"
  | "internal_linking"
  | "crawlability_fix"
  | "measurement_fix"
  | "coverage_expansion";

export type ProposedBriefPriority = "critical" | "high" | "medium" | "low";
export type ProposedBriefConfidence = "high" | "medium" | "low";
export type ProposedBriefStatus = "proposed" | "accepted" | "rejected" | "archived";

export type ProposedBrief = {
  id: string;
  sourceActionId: string | null;
  sourceClusterId: string | null;
  sourcePatternId: string | null;
  sourceOpportunityId: string | null;
  sourceCandidateId: string | null;

  title: string;
  briefType: ProposedBriefType;

  priority: ProposedBriefPriority;
  confidence: ProposedBriefConfidence;

  objective: string;
  whyThisNow: string;
  expectedOutcome: string;

  targetEntityLabel: string;
  targetUrl: string | null;
  targetTopic: string | null;
  targetCity: string | null;
  targetPlatform: string | "all";

  evidenceSummary: string[];
  caveats: string[];
  assumptions: string[];

  requiredComponents: string[];
  recommendedSteps: string[];
  blockedBy: string[];
  validationChecks: string[];
  successCriteria: string[];
  followThroughSignals: string[];

  score: number;
  status: ProposedBriefStatus;
};

export type PersistedBriefState = {
  briefId: string;
  status: ProposedBriefStatus;
  acceptedBriefId: string | null;
  updatedAt: string;
};

export const BRIEF_TYPE_LABELS: Record<ProposedBriefType, string> = {
  page_rebuild: "Page Rebuild",
  new_page: "New Page",
  page_refresh: "Page Refresh",
  faq_upgrade: "FAQ Upgrade",
  schema_alignment: "Schema Alignment",
  internal_linking: "Internal Linking",
  crawlability_fix: "Crawlability Fix",
  measurement_fix: "Measurement Fix",
  coverage_expansion: "Coverage Expansion",
};

export const BRIEF_TYPE_COLORS: Record<ProposedBriefType, string> = {
  page_rebuild: "text-status-danger",
  new_page: "text-status-success",
  page_refresh: "text-accent-primary",
  faq_upgrade: "text-accent-primary",
  schema_alignment: "text-muted-foreground",
  internal_linking: "text-muted-foreground",
  crawlability_fix: "text-status-warning",
  measurement_fix: "text-status-warning",
  coverage_expansion: "text-status-success",
};

export const BRIEF_PRIORITY_COLORS: Record<ProposedBriefPriority, string> = {
  critical: "text-status-danger",
  high: "text-status-warning",
  medium: "text-accent-primary",
  low: "text-muted-foreground",
};

export const BRIEF_STATUS_LABELS: Record<ProposedBriefStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  archived: "Archived",
};

export const BRIEF_STATUS_COLORS: Record<ProposedBriefStatus, string> = {
  proposed: "text-accent-primary",
  accepted: "text-status-success",
  rejected: "text-status-danger",
  archived: "text-muted-foreground",
};
