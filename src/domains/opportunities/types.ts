import type {
  Platform,
  IntentType,
  OpportunityStatus,
  Priority,
  ImpactLevel,
  EffortLevel,
  ConfidenceLevel,
  OpportunitySource,
  CloseReason,
} from "@/lib/constants";

export type Opportunity = {
  id: string;
  title: string;
  description: string | null;
  query_text: string;
  platforms: Platform[];
  intent_type: IntentType;
  city: string | null;
  topic: string;
  tags: string[];
  current_status: OpportunityStatus;
  priority: Priority;
  estimated_impact: ImpactLevel;
  effort: EffortLevel;
  confidence: ConfidenceLevel;
  source: OpportunitySource;
  baseline_position: number | null;
  target_position: number | null;
  target_url: string | null;
  competitor_ids: string[];
  primary_competitor_id: string | null;
  linked_brief_ids: string[];
  linked_changelog_ids: string[];
  related_opportunity_ids: string[];
  identified_at: string;
  activated_at: string | null;
  captured_at: string | null;
  lost_at: string | null;
  last_verified_at: string | null;
  assessed_at: string | null;
  deferred_at: string | null;
  deferred_until: string | null;
  closed_at: string | null;
  close_reason: CloseReason | null;
  regressed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  source_system?: string;
  import_batch_id?: string;
  /** Owning tenant. */
  tenant_id: string;
};
