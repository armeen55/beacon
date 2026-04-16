export type SnapshotScopeType =
  | "prompt"
  | "topic"
  | "entity"
  | "platform"
  | "account";

export type SnapshotSourceType =
  | "derived"
  | "benchmark";

export type DailyMetricSnapshot = {
  id: string;
  date: string;
  scope_type: SnapshotScopeType;
  scope_id: string;
  platform: string;
  source_type: SnapshotSourceType;
  visibility_score: number | null;
  mention_count: number;
  citation_count: number;
  share_of_voice: number | null;
  avg_position: number | null;
  total_possible: number | null;
  metadata: Record<string, unknown>;
  /** Owning tenant. */
  tenant_id: string;
};
