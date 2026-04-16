import type { Platform, MetricType } from "@/lib/constants";

export type Result = {
  id: string;
  snapshot_date: string;
  platform: Platform;
  metric_type: MetricType;
  metric_value: number;
  previous_value: number | null;
  delta: number | null;
  delta_percentage: number | null;
  topic: string | null;
  city: string | null;
  url_measured: string | null;
  attributed_changelog_ids: string[];
  notes: string | null;

  mention_count: number;
  citation_count: number;
  total_possible: number | null;
  position: number | null;

  created_at: string;
  source_system?: string;
  import_batch_id?: string;
  /** Visibility ObservationRun that produced or owns this sample row (import / seed / workbook). */
  visibility_observation_run_id?: string | null;
  /** Owning tenant. */
  tenant_id: string;
};
