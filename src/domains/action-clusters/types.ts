export type ClusterStatus =
  | "working"
  | "review_now"
  | "fix_data"
  | "investigate_external"
  | "monitor_only"
  | "low_signal";

export type ConfidenceBand = "high" | "medium" | "low" | "insufficient";

export type ActionCluster = {
  id: string;
  label: string;
  opportunityId: string | null;
  opportunityLabel: string | null;
  topicKey: string;
  platformKey: string;
  geoKey: string;
  timeWindow: { earliest: string; latest: string };
  eventIds: string[];
  changeIds: string[];
  candidateChangeIds: string[];
  confirmedChangeIds: string[];
  rejectedChangeIds: string[];
  unresolvedCandidateIds: string[];
  eventCount: number;
  attributedEventCount: number;
  pendingEventCount: number;
  noCandidateEventCount: number;
  rejectedOnlyEventCount: number;
  dominantEventTypes: string[];
  dominantChangePatterns: string[];
  status: ClusterStatus;
  recommendationType: string;
  recommendationReason: string;
  explanation: ClusterExplanation;
  confidenceBand: ConfidenceBand;
  score: number;
  urgency: number;
};

export type ClusterExplanation = {
  why: string;
  triggeringEventIds: string[];
  supportingChangeIds: string[];
  evidenceStrength: "direct" | "contributing" | "weak";
  toIncreaseConfidence: string;
  toResolve: string;
};

export const CLUSTER_STATUS_LABELS: Record<ClusterStatus, string> = {
  working: "Working",
  review_now: "Review Now",
  fix_data: "Fix Data",
  investigate_external: "Investigate",
  monitor_only: "Monitor",
  low_signal: "Low Signal",
};

export const CLUSTER_STATUS_COLORS: Record<ClusterStatus, string> = {
  working: "text-status-success",
  review_now: "text-status-warning",
  fix_data: "text-accent-primary",
  investigate_external: "text-status-danger",
  monitor_only: "text-muted-foreground",
  low_signal: "text-muted-foreground/60",
};
