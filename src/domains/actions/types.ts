export type ActionType =
  | "review_cluster"
  | "replicate_pattern"
  | "expand_adjacent_opportunity"
  | "fix_changelog_coverage"
  | "fix_matching_quality"
  | "investigate_external"
  | "monitor_cluster"
  | "deprioritize_pattern";

export type ActionBucket =
  | "do_now"
  | "do_this_week"
  | "monitor"
  | "system_fix"
  | "deprioritized";

export type OperatorState = "new" | "in_progress" | "done" | "dismissed";

export type FollowThroughStatus =
  | "evidence_positive"
  | "evidence_weak"
  | "no_evidence_yet"
  | "too_early"
  | "unknown";

export type StalenessBand = "fresh" | "aging" | "stale";

export type ActionItem = {
  id: string;
  clusterId: string;
  clusterLabel: string;
  title: string;
  actionType: ActionType;
  bucket: ActionBucket;
  priorityScore: number;
  urgency: number;
  confidenceBand: string;
  status: OperatorState;
  whyNow: string;
  expectedOutcome: string;
  blockingIssue: string | null;
  recommendedScope: string;
  supportingEventIds: string[];
  supportingChangeIds: string[];
  recommendedOpportunityIds: string[];
  recommendedPatternKeys: string[];
  resolutionCriteria: string;
  createdAtComputed: string;
  stalenessBand: StalenessBand;
  followThrough: FollowThroughStatus | null;
  patternId: string | null;
  patternLabel: string | null;
  patternScore: number | null;
  patternSuccessRate: number | null;
  similarContexts: string[];
};

export type PersistedActionState = {
  actionId: string;
  state: OperatorState;
  operatorNote: string | null;
  linkedFollowUpChangeIds: string[];
  updatedAt: string;
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  review_cluster: "Triage this theme",
  replicate_pattern: "Repeat a winning play",
  expand_adjacent_opportunity: "Expand to a new pocket",
  fix_changelog_coverage: "Log what shipped",
  fix_matching_quality: "Tighten matching",
  investigate_external: "Look outside the site",
  monitor_cluster: "Keep watching",
  deprioritize_pattern: "Stop doubling down",
};

export const BUCKET_LABELS: Record<ActionBucket, string> = {
  do_now: "Today",
  do_this_week: "Next Up",
  monitor: "Watch & Learn",
  system_fix: "Fix the Inputs",
  deprioritized: "Parked",
};

export const BUCKET_COLORS: Record<ActionBucket, string> = {
  do_now: "border-status-warning/30 bg-status-warning/5",
  do_this_week: "border-accent-primary/30 bg-accent-primary/5",
  monitor: "border-border bg-surface-raised",
  system_fix: "border-status-danger/30 bg-status-danger/5",
  deprioritized: "border-border/50 bg-surface-inset",
};

export const BUCKET_TEXT_COLORS: Record<ActionBucket, string> = {
  do_now: "text-status-warning",
  do_this_week: "text-accent-primary",
  monitor: "text-muted-foreground",
  system_fix: "text-status-danger",
  deprioritized: "text-muted-foreground/60",
};

export const OPERATOR_STATE_LABELS: Record<OperatorState, string> = {
  new: "New",
  in_progress: "In Progress",
  done: "Done",
  dismissed: "Dismissed",
};

export const FOLLOW_THROUGH_LABELS: Record<FollowThroughStatus, string> = {
  evidence_positive: "Showed up in the numbers",
  evidence_weak: "Signal is fuzzy",
  no_evidence_yet: "Nothing yet",
  too_early: "Too soon to tell",
  unknown: "Not tracked yet",
};

export const FOLLOW_THROUGH_COLORS: Record<FollowThroughStatus, string> = {
  evidence_positive: "text-status-success",
  evidence_weak: "text-status-warning",
  no_evidence_yet: "text-muted-foreground",
  too_early: "text-muted-foreground/60",
  unknown: "text-muted-foreground/40",
};
