import type {
  BriefStatus,
  BriefType,
  Priority,
  EffortLevel,
  ChecklistItemStatus,
  OutcomeVerdict,
  MetricType,
  Platform,
} from "@/lib/constants";

export type ChecklistItem = {
  id: string;
  label: string;
  status: ChecklistItemStatus;
  sort_order: number;
  linked_changelog_id: string | null;
  completed_at: string | null;
  notes: string | null;
};

export type ExpectedOutcome = {
  id: string;
  description: string;
  metric_type: MetricType;
  platform: Platform;
  target_value: number | null;
  baseline_value: number | null;
  timeframe: string;
  verdict: OutcomeVerdict;
  actual_value: number | null;
  result_id: string | null;
  judged_at: string | null;
};

export type BriefRetrospective = {
  summary: string;
  what_worked: string | null;
  what_didnt: string | null;
  actual_effort: EffortLevel;
  would_repeat: boolean;
  follow_up_brief_id: string | null;
};

export type Brief = {
  id: string;
  title: string;
  objective: string;
  opportunity_ids: string[];
  status: BriefStatus;
  priority: Priority;
  brief_type: BriefType;
  effort: EffortLevel;
  target_url: string | null;
  target_city: string | null;
  target_topic: string | null;
  checklist: ChecklistItem[];
  expected_outcomes: ExpectedOutcome[];
  linked_changelog_ids: string[];
  related_brief_ids: string[];
  prior_brief_id: string | null;
  blocked_reason: string | null;
  due_date: string | null;
  approved_at: string | null;
  started_at: string | null;
  blocked_at: string | null;
  completed_at: string | null;
  impact_window_ends_at: string | null;
  retrospective: BriefRetrospective | null;
  created_at: string;
  updated_at: string;
  source_system?: string;
  import_batch_id?: string;
};
