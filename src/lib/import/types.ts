export type ImportEntityType =
  | "results"
  | "changes"
  | "opportunities"
  | "competitors";

export type ImportFormat = "csv" | "json";

export type ImportRun = {
  id: string;
  source_system: string;
  entity_type: ImportEntityType;
  format: ImportFormat;
  started_at: string;
  completed_at: string;
  total_rows: number;
  imported_count: number;
  skipped_count: number;
  errors: string[];
  warnings: string[];
};

export type ImportPreview = {
  valid: boolean;
  total_rows: number;
  valid_count: number;
  errors: string[];
  warnings: string[];
  sample: Record<string, unknown>[];
};

export type ImportResult = {
  success: boolean;
  run_id: string;
  imported_count: number;
  skipped_count: number;
  errors: string[];
  warnings: string[];
};

export type WorkbookSheetSummary = {
  sheet: string;
  rows: number;
  imported: number;
  skipped: number;
  warnings: string[];
};

export type WorkbookImportResult = {
  success: boolean;
  run_id: string;
  changes_imported: number;
  results_imported: number;
  results_attribution: number;
  results_visibility: number;
  opportunities_derived: number;
  competitors_imported: number;
  changes_linked: number;
  sheets: WorkbookSheetSummary[];
  warnings: string[];
  errors: string[];
  delta?: {
    results_new: number;
    results_updated: number;
    changes_new: number;
    changes_updated: number;
    date_range_after: { from: string; to: string } | null;
  };
};

export const IMPORT_COLUMN_DOCS: Record<ImportEntityType, { required: string[]; optional: string[] }> = {
  results: {
    required: ["snapshot_date", "platform", "metric_type", "metric_value"],
    optional: ["previous_value", "topic", "city", "url_measured", "attributed_change_ids", "mention_count", "citation_count", "total_possible", "position", "notes"],
  },
  changes: {
    required: ["timestamp", "signal_type", "asset_name", "change_description", "topic_targeted"],
    optional: ["asset_type", "url", "city_targeted", "hypothesis", "expected_impact_window", "brief_id", "opportunity_id", "notes"],
  },
  opportunities: {
    required: ["title", "query_text", "topic", "platforms"],
    optional: [
      "description", "city", "intent_type", "priority", "estimated_impact", "effort",
      "confidence", "source", "current_status", "baseline_position", "target_position",
      "target_url", "identified_at", "notes",
    ],
  },
  competitors: {
    required: ["name", "domain"],
    optional: ["description", "notes"],
  },
};
