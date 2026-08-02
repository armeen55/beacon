/**
 * The import-run audit trail. One writer exists
 * (`appendConnectorReviewsImportRun`) and it records reviews pulled by a
 * connector, so the entity and format are fixed rather than a union of
 * kinds nothing produces. No reader branches on either field.
 */
export type ImportRun = {
  id: string;
  source_system: string;
  entity_type: "reviews";
  format: "json";
  started_at: string;
  completed_at: string;
  total_rows: number;
  imported_count: number;
  skipped_count: number;
  errors: string[];
  warnings: string[];
  /** Owning tenant. */
  tenant_id: string;
};
