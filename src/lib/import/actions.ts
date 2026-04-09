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
import { parseWorkbook, WORKBOOK_IMPORT_SOURCE } from "./workbook";
import { classifyResultMode } from "@/domains/attribution/result-mode";
import type { ImportEntityType, ImportFormat, ImportRun, ImportResult, ImportPreview, WorkbookImportResult } from "./types";
import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import { appendVisibilityObservationRunSync } from "@/domains/observations/visibility-persist";
import { universeFieldsForObservationPersistence } from "@/domains/competitors/universe-run-pin";

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

  const visibilityRunIdForResults =
    entityType === "results" ? `vis-imp-${batchId}` : null;

  for (let i = 0; i < rows.length; i++) {
    const result =
      entityType === "results"
        ? mapResultRow(
            rows[i],
            i,
            batchId,
            source,
            visibilityRunIdForResults ?? undefined
          )
        : mapper(rows[i], i, batchId, source);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);

    if (result.entity) {
      insertEntity(entityType, result.entity);
      imported++;
    } else {
      skipped++;
    }
  }

  if (entityType === "results" && imported > 0 && visibilityRunIdForResults) {
    const completedAt = now();
    const ci = readDotDataJson<CitationEvidenceIndex>("citation-evidence-index");
    const linkedCit =
      ci?.built_at != null
        ? `vis-citation-${encodeURIComponent(ci.built_at)}`
        : null;
    const visRun: VisibilityObservationRun = {
      run_id: visibilityRunIdForResults,
      run_type: "prompt_results_import",
      source: `CSV/JSON import · ${source}`,
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      scope_label: `Imported ${imported} Sample history row(s); batch ${batchId}.`,
      prompt_set_version: null,
      engine_platform_note: null,
      parser_version: "import-csv-v1",
      baseline_visibility_run_id: null,
      counts: {
        topic_buckets: 0,
        page_topic_rollup_rows: 0,
        total_citations_accounted: 0,
        distinct_external_domains_sampled: 0,
        owned_rollup_rows: 0,
      },
      is_synthetic_wrapper: false,
      citation_index_built_at: null,
      sample_result_row_count: imported,
      linked_citation_index_run_id: linkedCit,
      ...universeFieldsForObservationPersistence(),
    };
    appendVisibilityObservationRunSync(visRun);
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
    success: imported > 0,
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

export async function resetExperiment(
  options: { preserveTruthLabels?: boolean } = {}
): Promise<{
  cleared: {
    results: number;
    changes: number;
    opportunities: number;
    competitors: number;
    candidateLinks: number;
    truthLabels: number;
    importRuns: number;
  };
}> {
  const { candidateLinks, truthLabels, persistCandidateLinks, persistTruthLabels } = await import("@/domains/attribution/store");
  const { actionStates, persistActionStates } = await import("@/domains/actions/store");
  const { briefStates, persistBriefStates } = await import("@/domains/brief-generation/store");

  const cleared = {
    results: results.length,
    changes: changelogEntries.length,
    opportunities: opportunities.length,
    competitors: competitors.length,
    candidateLinks: candidateLinks.length,
    truthLabels: options.preserveTruthLabels ? 0 : truthLabels.length,
    importRuns: importRuns.length,
  };

  results.length = 0;
  changelogEntries.length = 0;
  opportunities.length = 0;
  competitors.length = 0;
  candidateLinks.length = 0;
  importRuns.length = 0;
  actionStates.length = 0;
  briefStates.length = 0;

  if (!options.preserveTruthLabels) {
    truthLabels.length = 0;
  }

  await writeStore("imported-results", []);
  await writeStore("imported-changes", []);
  await writeStore("imported-opportunities", []);
  await writeStore("imported-competitors", []);
  await writeStore("import-runs", []);
  await writeStore("action-states", []);
  await writeStore("brief-states", []);
  await persistCandidateLinks();
  if (!options.preserveTruthLabels) {
    await persistTruthLabels();
  }

  revalidatePath("/", "layout");
  return { cleared };
}

export async function importWorkbook(
  formData: FormData
): Promise<WorkbookImportResult> {
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return {
      success: false,
      run_id: "",
      changes_imported: 0,
      results_imported: 0,
      results_attribution: 0,
      results_visibility: 0,
      opportunities_derived: 0,
      competitors_imported: 0,
      changes_linked: 0,
      sheets: [],
      warnings: [],
      errors: ["No file provided"],
    };
  }

  const batchId = generateId("wb");
  const startedAt = now();

  let data;
  const visibilityRunId = `vis-wb-${batchId}`;
  try {
    const buffer = await file.arrayBuffer();
    data = parseWorkbook(buffer, batchId, visibilityRunId);
  } catch (e) {
    return {
      success: false,
      run_id: batchId,
      changes_imported: 0,
      results_imported: 0,
      results_attribution: 0,
      results_visibility: 0,
      opportunities_derived: 0,
      competitors_imported: 0,
      changes_linked: 0,
      sheets: [],
      warnings: [],
      errors: [
        `Workbook parse error: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  const existingIds = new Set([
    ...results.map((r) => r.id),
    ...changelogEntries.map((c) => c.id),
    ...opportunities.map((o) => o.id),
    ...competitors.map((c) => c.id),
  ]);

  let changesLinked = 0;

  for (const entry of data.changes) {
    if (existingIds.has(entry.id)) {
      const idx = changelogEntries.findIndex((c) => c.id === entry.id);
      if (idx >= 0) changelogEntries[idx] = entry;
    } else {
      changelogEntries.push(entry);
    }
    if (entry.opportunity_id) changesLinked++;
  }

  for (const result of data.results) {
    if (existingIds.has(result.id)) {
      const idx = results.findIndex((r) => r.id === result.id);
      if (idx >= 0) results[idx] = result;
    } else {
      results.push(result);
    }
  }

  for (const opp of data.opportunities) {
    if (existingIds.has(opp.id)) {
      const idx = opportunities.findIndex((o) => o.id === opp.id);
      if (idx >= 0) opportunities[idx] = opp;
    } else {
      opportunities.push(opp);
    }
  }

  for (const comp of data.competitors) {
    if (existingIds.has(comp.id)) {
      const idx = competitors.findIndex((c) => c.id === comp.id);
      if (idx >= 0) competitors[idx] = comp;
    } else {
      competitors.push(comp);
    }
  }

  await writeStore(
    "imported-changes",
    changelogEntries.filter(isImported)
  );
  await writeStore("imported-results", results.filter(isImported));
  await writeStore(
    "imported-opportunities",
    opportunities.filter(isImported)
  );
  await writeStore(
    "imported-competitors",
    competitors.filter(isImported)
  );

  const run: ImportRun = {
    id: batchId,
    source_system: WORKBOOK_IMPORT_SOURCE,
    entity_type: "results",
    format: "csv",
    started_at: startedAt,
    completed_at: now(),
    total_rows:
      data.changes.length +
      data.results.length +
      data.opportunities.length +
      data.competitors.length,
    imported_count:
      data.changes.length +
      data.results.length +
      data.opportunities.length +
      data.competitors.length,
    skipped_count: data.sheets.reduce((sum, s) => sum + s.skipped, 0),
    errors: data.warnings.filter((w) => w.toLowerCase().includes("error")),
    warnings: data.warnings,
  };
  importRuns.push(run);
  await writeStore("import-runs", importRuns);

  if (data.results.length > 0) {
    const completedAt = now();
    const ci = readDotDataJson<CitationEvidenceIndex>("citation-evidence-index");
    const linkedCit =
      ci?.built_at != null
        ? `vis-citation-${encodeURIComponent(ci.built_at)}`
        : null;
    const visRun: VisibilityObservationRun = {
      run_id: visibilityRunId,
      run_type: "prompt_results_import",
      source: `Workbook · ${WORKBOOK_IMPORT_SOURCE}`,
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      scope_label: `Workbook import ${batchId} — ${data.results.length} aggregated Sample history row(s) from prompt_intelligence_daily.`,
      prompt_set_version: "prompt_intelligence_daily",
      engine_platform_note:
        "Rows are aggregated buckets (date × engine × topic cluster), not raw prompts.",
      parser_version: "workbook-v1",
      baseline_visibility_run_id: null,
      counts: {
        topic_buckets: 0,
        page_topic_rollup_rows: 0,
        total_citations_accounted: 0,
        distinct_external_domains_sampled: 0,
        owned_rollup_rows: 0,
      },
      is_synthetic_wrapper: false,
      citation_index_built_at: null,
      sample_result_row_count: data.results.length,
      linked_citation_index_run_id: linkedCit,
      ...universeFieldsForObservationPersistence(),
    };
    appendVisibilityObservationRunSync(visRun);
  }

  revalidatePath("/", "layout");

  const attrCount = data.results.filter(
    (r) => classifyResultMode(r) === "attribution"
  ).length;

  return {
    success: true,
    run_id: batchId,
    changes_imported: data.changes.length,
    results_imported: data.results.length,
    results_attribution: attrCount,
    results_visibility: data.results.length - attrCount,
    opportunities_derived: data.opportunities.length,
    competitors_imported: data.competitors.length,
    changes_linked: changesLinked,
    sheets: data.sheets,
    warnings: data.warnings,
    errors: [],
  };
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
