export type ProfoundRunSourceType =
  | "beacon_native"
  | "manual_import"
  | "api_import";

export type ProfoundRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

/**
 * Prompt-centric observation run from Profound imports.
 *
 * NOT the same shape as `domains/observations/types.ts::ObservationRun`
 * which represents website crawl / verify runs. This type is used
 * exclusively by the Profound import pipeline (`storage/canonical-store`,
 * `adapters/profound/`).
 */
export type ProfoundImportRun = {
  id: string;
  account_id: string;
  import_run_id: string | null;
  run_date: string;
  platform: string;
  model: string | null;
  geo: string | null;
  locale: string | null;
  source_type: ProfoundRunSourceType;
  status: ProfoundRunStatus;
  prompt_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
};
