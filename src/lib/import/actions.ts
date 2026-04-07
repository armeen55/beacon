"use server";

import { revalidatePath } from "next/cache";
import { generateId, now } from "@/lib/actions";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { parseCSV, parseJSON } from "./parsers";
import {
  mapResultRow,
  mapChangeRow,
  mapOpportunityRow,
  mapCompetitorRow,
} from "./engine";
import {
  opportunities,
  briefs,
  changelogEntries,
  results,
  competitors,
} from "@/lib/seed-data.server";
import type { ImportEntityType, ImportFormat, ImportRun, ImportResult, ImportPreview } from "./types";

const importRuns: ImportRun[] = readStore<ImportRun>("import-runs");

export async function getImportRuns(): Promise<ImportRun[]> {
  return [...importRuns].reverse();
}

export async function previewImport(
  rawData: string,
  entityType: ImportEntityType,
  format: ImportFormat,
  source: string
): Promise<ImportPreview> {
  let rows: Record<string, string>[];
  try {
    rows = format === "csv" ? parseCSV(rawData) : parseJSON(rawData);
  } catch (e) {
    return {
      valid: false,
      total_rows: 0,
      valid_count: 0,
      errors: [`Parse error: ${e instanceof Error ? e.message : String(e)}`],
      warnings: [],
      sample: [],
    };
  }

  if (rows.length === 0) {
    return { valid: false, total_rows: 0, valid_count: 0, errors: ["No data rows found"], warnings: [], sample: [] };
  }

  const batchId = "preview";
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  let validCount = 0;

  const mapper = getMapper(entityType);
  for (let i = 0; i < rows.length; i++) {
    const result = mapper(rows[i], i, batchId, source);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
    if (result.entity) validCount++;
  }

  return {
    valid: allErrors.length === 0 || validCount > 0,
    total_rows: rows.length,
    valid_count: validCount,
    errors: allErrors.slice(0, 20),
    warnings: allWarnings.slice(0, 20),
    sample: rows.slice(0, 5),
  };
}

export async function executeImport(
  rawData: string,
  entityType: ImportEntityType,
  format: ImportFormat,
  source: string
): Promise<ImportResult> {
  const batchId = generateId("imp");
  const startedAt = now();

  let rows: Record<string, string>[];
  try {
    rows = format === "csv" ? parseCSV(rawData) : parseJSON(rawData);
  } catch (e) {
    return {
      success: false,
      run_id: batchId,
      imported_count: 0,
      skipped_count: 0,
      errors: [`Parse error: ${e instanceof Error ? e.message : String(e)}`],
      warnings: [],
    };
  }

  const mapper = getMapper(entityType);
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const result = mapper(rows[i], i, batchId, source);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);

    if (result.entity) {
      insertEntity(entityType, result.entity);
      imported++;
    } else {
      skipped++;
    }
  }

  const run: ImportRun = {
    id: batchId,
    source_system: source,
    entity_type: entityType,
    format,
    started_at: startedAt,
    completed_at: now(),
    total_rows: rows.length,
    imported_count: imported,
    skipped_count: skipped,
    errors: allErrors.slice(0, 50),
    warnings: allWarnings.slice(0, 50),
  };
  importRuns.push(run);
  await writeStore("import-runs", importRuns);
  await persistImportedEntities(entityType);

  revalidatePath("/", "layout");

  return {
    success: true,
    run_id: batchId,
    imported_count: imported,
    skipped_count: skipped,
    errors: allErrors.slice(0, 20),
    warnings: allWarnings.slice(0, 20),
  };
}

export async function clearEntityData(
  entityType: ImportEntityType
): Promise<{ success: boolean; cleared: number }> {
  let cleared = 0;
  switch (entityType) {
    case "results":
      cleared = results.length;
      results.length = 0;
      break;
    case "changes":
      cleared = changelogEntries.length;
      changelogEntries.length = 0;
      break;
    case "opportunities":
      cleared = opportunities.length;
      opportunities.length = 0;
      break;
    case "competitors":
      cleared = competitors.length;
      competitors.length = 0;
      break;
  }

  revalidatePath("/", "layout");
  return { success: true, cleared };
}

export async function clearImportedData(
  entityType: ImportEntityType
): Promise<{ success: boolean; cleared: number }> {
  let cleared = 0;
  const isImported = (item: { source_system?: string }) => !!item.source_system;

  switch (entityType) {
    case "results": {
      const keep = results.filter((r) => !isImported(r));
      cleared = results.length - keep.length;
      results.length = 0;
      results.push(...keep);
      break;
    }
    case "changes": {
      const keep = changelogEntries.filter((c) => !isImported(c));
      cleared = changelogEntries.length - keep.length;
      changelogEntries.length = 0;
      changelogEntries.push(...keep);
      break;
    }
    case "opportunities": {
      const keep = opportunities.filter((o) => !isImported(o));
      cleared = opportunities.length - keep.length;
      opportunities.length = 0;
      opportunities.push(...keep);
      break;
    }
    case "competitors": {
      const keep = competitors.filter((c) => !isImported(c));
      cleared = competitors.length - keep.length;
      competitors.length = 0;
      competitors.push(...keep);
      break;
    }
  }

  revalidatePath("/", "layout");
  return { success: true, cleared };
}

function getMapper(entityType: ImportEntityType) {
  switch (entityType) {
    case "results":
      return mapResultRow;
    case "changes":
      return mapChangeRow;
    case "opportunities":
      return mapOpportunityRow;
    case "competitors":
      return mapCompetitorRow;
  }
}

function insertEntity(entityType: ImportEntityType, entity: unknown) {
  switch (entityType) {
    case "results":
      results.push(entity as (typeof results)[number]);
      break;
    case "changes":
      changelogEntries.push(entity as (typeof changelogEntries)[number]);
      break;
    case "opportunities":
      opportunities.push(entity as (typeof opportunities)[number]);
      break;
    case "competitors":
      competitors.push(entity as (typeof competitors)[number]);
      break;
  }
}

const isImported = (item: { source_system?: string }) => !!item.source_system;

async function persistImportedEntities(entityType: ImportEntityType) {
  switch (entityType) {
    case "results":
      await writeStore("imported-results", results.filter(isImported));
      break;
    case "changes":
      await writeStore("imported-changes", changelogEntries.filter(isImported));
      break;
    case "opportunities":
      await writeStore("imported-opportunities", opportunities.filter(isImported));
      break;
    case "competitors":
      await writeStore("imported-competitors", competitors.filter(isImported));
      break;
  }
}
