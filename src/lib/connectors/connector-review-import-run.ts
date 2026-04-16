/**
 * Append a connector-driven reviews import run (audit trail + freshness).
 */

import "server-only";

import { generateId, now } from "@/lib/actions";
import type { ImportRun } from "@/lib/import/types";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { syncImportRuns } from "@/lib/persistence/dual-write";

export async function appendConnectorReviewsImportRun(opts: {
  source_system: "connector:google" | "connector:yelp";
  idPrefix: "gbp" | "yelp";
  imported: number;
  skipped: number;
  warnings: string[];
  errors: string[];
}): Promise<void> {
  const runs = readStore<ImportRun>("import-runs", []);
  const id = generateId(opts.idPrefix);
  const ts = now();
  runs.push({
    id,
    source_system: opts.source_system,
    entity_type: "reviews",
    format: "json",
    started_at: ts,
    completed_at: ts,
    total_rows: opts.imported + opts.skipped,
    imported_count: opts.imported,
    skipped_count: opts.skipped,
    errors: opts.errors.slice(0, 50),
    warnings: opts.warnings.slice(0, 50),
    tenant_id: "",
  });
  await writeStore("import-runs", runs);
  await syncImportRuns(runs);
}
