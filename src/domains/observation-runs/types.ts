export type RunSourceType =
  | "beacon_native"
  | "manual_import"
  | "api_import";

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type ObservationRun = {
  id: string;
  account_id: string;
  import_run_id: string | null;
  run_date: string;
  platform: string;
  model: string | null;
  geo: string | null;
  locale: string | null;
  source_type: RunSourceType;
  status: RunStatus;
  prompt_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
};
