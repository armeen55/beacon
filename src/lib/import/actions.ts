"use server";

import { revalidatePath } from "next/cache";
import { generateId, now } from "@/lib/actions";
import { log } from "@/lib/logger";
import { writeStore } from "@/lib/persistence/json-store";
import { parseCSV, parseJSON } from "./parsers";
import {
  mapResultRow,
  mapChangeRow,
  mapOpportunityRow,
  mapCompetitorRow,
} from "./engine";
import { mapLocalReviewRow } from "./review-mapper";
import { mergeUpsertLocalReviews } from "@/lib/local-reviews-store";
import {
  opportunities,
  briefs,
  changelogEntries,
  results,
  competitors,
  importRuns,
} from "@/lib/seed-data.server";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import type { ImportEntityType, ImportFormat, ImportRun, ImportResult, ImportPreview } from "./types";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import { appendVisibilityObservationRunSync } from "@/domains/observations/visibility-persist";
import { universeFieldsForObservationPersistence } from "@/domains/competitors/universe-run-pin";
import {
  syncImportRuns,
  syncResults,
  syncChangelogEntries,
  syncOpportunities,
  syncCompetitors,
  clearAllImportTables,
} from "@/lib/persistence/dual-write";
import { currentTenantId } from "@/lib/tenant-context";
import {
  runWebsiteScan,
  scanRoutesShouldRevalidate,
  type WebsiteScanResult,
} from "@/domains/scanning/orchestrate-scan";
// Phase 4 (2026-04-19): outcome-backfill + experiment-citation-sync removed.
// URL-level outcomes are materialized inside url-watcher from observation
// history; no separate experiment-refresh step is needed.
import { runMilestoneSync } from "@/domains/milestones/post-import-sync";

export async function getImportRuns(): Promise<ImportRun[]> {
  return [...importRuns].reverse();
}

export async function getDataCoverage(): Promise<{
  resultCount: number;
  changeCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  platforms: string[];
  lastImportAt: string | null;
}> {
  const dates = results.map((r) => r.snapshot_date).filter(Boolean).sort();
  const platformSet = new Set<string>();
  for (const r of results) {
    if (r.platform && r.platform !== "all") platformSet.add(r.platform);
  }
  const sortedRuns = [...importRuns].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
  return {
    resultCount: results.length,
    changeCount: changelogEntries.length,
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    platforms: [...platformSet],
    lastImportAt: sortedRuns[0]?.started_at ?? null,
  };
}

export async function previewImport(
  rawData: string,
  entityType: ImportEntityType,
  format: ImportFormat,
  source: string
): Promise<ImportPreview> {
  const action = "previewImport";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { entityType, format, rawLength: rawData.length },
  });
  let rows: Record<string, string>[];
  try {
    rows = format === "csv" ? parseCSV(rawData) : parseJSON(rawData);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: msg.slice(0, 500),
    });
    return {
      valid: false,
      total_rows: 0,
      valid_count: 0,
      errors: [`Parse error: ${msg}`],
      warnings: [],
      sample: [],
    };
  }

  if (rows.length === 0) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "no data rows",
    });
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

  const out: ImportPreview = {
    valid: allErrors.length === 0 || validCount > 0,
    total_rows: rows.length,
    valid_count: validCount,
    errors: allErrors.slice(0, 20),
    warnings: allWarnings.slice(0, 20),
    sample: rows.slice(0, 5),
  };
  if (out.valid) {
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
  } else {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: out.errors[0] ?? "preview invalid",
    });
  }
  return out;
}

export async function executeImport(
  rawData: string,
  entityType: ImportEntityType,
  format: ImportFormat,
  source: string
): Promise<ImportResult> {
  const batchId = generateId("imp");
  const t0 = Date.now();
  const startedAt = now();
  const tenantId = await currentTenantId();

  log.info("Import started", { runId: batchId, source: "upload" });

  let rows: Record<string, string>[];
  try {
    rows = format === "csv" ? parseCSV(rawData) : parseJSON(rawData);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("Import failed", {
      runId: batchId,
      durationMs: Date.now() - t0,
      error: msg.slice(0, 500),
    });
    return {
      success: false,
      run_id: batchId,
      imported_count: 0,
      skipped_count: 0,
      errors: [`Parse error: ${msg}`],
      warnings: [],
    };
  }

  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  let imported = 0;
  let skipped = 0;

  const visibilityRunIdForResults =
    entityType === "results" ? `vis-imp-${batchId}` : null;

  if (entityType === "reviews") {
    log.info("Local reviews import started", { runId: batchId });
    const batch = new Map<string, import("@/lib/local-reviews-types").LocalReview>();
    for (let i = 0; i < rows.length; i++) {
      const result = mapLocalReviewRow(rows[i], i);
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
      if (result.entity) {
        batch.set(result.entity.id, result.entity);
      } else {
        skipped++;
      }
    }
    imported = batch.size;
    if (imported === 0) {
      log.error("Local reviews import failed", {
        runId: batchId,
        reason: allErrors[0] ?? "No valid review records found",
      });
      return {
        success: false,
        run_id: batchId,
        imported_count: 0,
        skipped_count: skipped,
        errors: allErrors.length
          ? allErrors.slice(0, 20)
          : ["No valid review records found"],
        warnings: allWarnings.slice(0, 20),
      };
    }
    try {
      await mergeUpsertLocalReviews([...batch.values()]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("Local reviews import failed", {
        runId: batchId,
        error: msg.slice(0, 500),
      });
      return {
        success: false,
        run_id: batchId,
        imported_count: 0,
        skipped_count: skipped,
        errors: [msg],
        warnings: allWarnings.slice(0, 20),
      };
    }
  } else {
    const mapper = getMapper(entityType);
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
  }

  if (entityType === "results" && imported > 0 && visibilityRunIdForResults) {
    const completedAt = now();
    const linkedCit =
      citationEvidenceIndex?.built_at != null
        ? `vis-citation-${encodeURIComponent(citationEvidenceIndex.built_at)}`
        : null;
    const visRun: VisibilityObservationRun = {
      run_id: visibilityRunIdForResults,
      run_type: "prompt_results_import",
      source: `CSV/JSON import · ${source}`,
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      scope_label: `Imported ${imported} history row(s); batch ${batchId}.`,
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
    tenant_id: "",
  };
  importRuns.push(run);
  await writeStore("import-runs", importRuns);
  await syncImportRuns(importRuns, tenantId);
  if (entityType !== "reviews") {
    await persistImportedEntities(entityType);
    await dualWriteImportedEntities(entityType, tenantId);
    // Phase 4 (2026-04-19): outcome-backfill + experiment-citation-sync removed.
    await runMilestoneSync().catch(() => {});
  }

  revalidatePath("/", "layout");
  if (entityType === "reviews") {
    revalidatePath("/local", "layout");
  }

  const durationMs = Date.now() - t0;
  if (entityType === "reviews") {
    if (imported > 0) {
      log.info("Local reviews import completed", {
        runId: batchId,
        durationMs,
        imported,
      });
    }
  } else if (imported > 0) {
    log.info("Import completed", {
      runId: batchId,
      durationMs,
      rowCount: imported,
    });
  } else {
    log.error("Import failed", {
      runId: batchId,
      durationMs,
      error:
        allErrors[0] ??
        (rows.length === 0 ? "No data rows" : "No rows imported"),
    });
  }

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
  const action = "clearEntityData";
  const t0 = Date.now();
  log.info("Action started", { action, params: { entityType } });
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
    case "reviews": {
      const { readLocalReviews, writeLocalReviews } = await import("@/lib/local-reviews-store");
      cleared = (await readLocalReviews()).length;
      await writeLocalReviews([]);
      revalidatePath("/local", "layout");
      break;
    }
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, cleared };
}

export async function clearImportedData(
  entityType: ImportEntityType
): Promise<{ success: boolean; cleared: number }> {
  const action = "clearImportedData";
  const t0 = Date.now();
  log.info("Action started", { action, params: { entityType } });
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
    case "reviews": {
      const { readLocalReviews, writeLocalReviews } = await import("@/lib/local-reviews-store");
      cleared = (await readLocalReviews()).length;
      await writeLocalReviews([]);
      revalidatePath("/local", "layout");
      break;
    }
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
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
  const action = "resetExperiment";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { preserveTruthLabels: options.preserveTruthLabels ?? false },
  });
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
  await writeStore("local-reviews", []);
  await writeStore("import-runs", []);
  await writeStore("action-states", []);
  await writeStore("brief-states", []);
  await persistCandidateLinks();
  if (!options.preserveTruthLabels) {
    await persistTruthLabels();
  }
  await clearAllImportTables();

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { cleared };
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
    case "reviews":
      return (
        row: Record<string, string>,
        idx: number,
        _batchId: string,
        _source: string,
      ) => mapLocalReviewRow(row, idx);
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
    case "reviews":
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
    case "reviews":
      break;
  }
}

export async function postImportSetup(): Promise<{
  success: boolean;
  registryBuilt: boolean;
  scanRun: boolean;
  pagesRegistered?: number;
  pagesScanned?: number;
  error?: string;
}> {
  const action = "postImportSetup";
  const t0 = Date.now();
  log.info("Action started", { action, params: {} });
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    let registryBuilt = false;
    let pagesRegistered = 0;
    try {
      const { stdout } = await execAsync("npx tsx scripts/build-page-registry.ts", {
        cwd: process.cwd(),
        timeout: 30_000,
      });
      registryBuilt = true;
      const match = stdout.match(/(\d+)\s*pages/);
      if (match) pagesRegistered = parseInt(match[1], 10);
    } catch {
      // Registry build script may not exist — non-fatal
    }

    let scanRun = false;
    let pagesScanned = 0;
    let scanRes: WebsiteScanResult | null = null;
    try {
      scanRes = await runWebsiteScan({ trigger: "import" });
      scanRun = !!scanRes.payload;
      pagesScanned = scanRes.payload?.pagesScanned ?? 0;
    } catch {
      // Scan may fail in minimal environments — non-fatal for import
    }

    revalidatePath("/", "layout");
    if (scanRes && scanRoutesShouldRevalidate(scanRes)) {
      revalidatePath("/pages", "layout");
    }

    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return {
      success: true,
      registryBuilt,
      scanRun,
      pagesRegistered,
      pagesScanned,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return {
      success: false,
      registryBuilt: false,
      scanRun: false,
      error: err,
    };
  }
}

async function dualWriteImportedEntities(
  entityType: ImportEntityType,
  tenantId: string,
) {
  switch (entityType) {
    case "results":
      await syncResults(results.filter(isImported), tenantId);
      break;
    case "changes":
      await syncChangelogEntries(changelogEntries.filter(isImported), tenantId);
      break;
    case "opportunities":
      // Phase 7.7b Commit 2 — `syncOpportunities` not yet converted (Tier
      // classification pending; see plan §G). Stays unscoped for now.
      await syncOpportunities(opportunities.filter(isImported));
      break;
    case "competitors":
      // Phase 7.7b Commit 2 — same as opportunities; unscoped pending audit.
      await syncCompetitors(competitors.filter(isImported));
      break;
    case "reviews":
      break;
  }
}

// ---------------------------------------------------------------------------
// On-demand attribution refresh — recompute outcomes + patterns from
// existing changelog + daily metric snapshots without requiring re-import.
// ---------------------------------------------------------------------------

export async function refreshAttributionAction(): Promise<{
  success: boolean;
  outcomes: number;
  patterns: number;
  durationMs: number;
}> {
  const action = "refreshAttribution";
  const t0 = Date.now();
  log.info("Action started", { action });

  try {
    const { readStore: readStoreLocal } = await import("@/lib/persistence/json-store");
    const { materializePerChangeOutcomes } = await import(
      "@/domains/attribution/change-outcome"
    );
    const { materializeChangePatterns } = await import(
      "@/domains/learning/change-patterns"
    );
    type DMS = import("@/domains/daily-metric-snapshots/types").DailyMetricSnapshot;

    const snapshots = await readStoreLocal<DMS>("daily-metric-snapshots");
    const outcomes = await materializePerChangeOutcomes(
      changelogEntries,
      snapshots,
    );
    const patterns = await materializeChangePatterns(outcomes, changelogEntries);

    revalidatePath("/changes", "layout");
    const durationMs = Date.now() - t0;
    log.info("Action completed", { action, durationMs, outcomes: outcomes.length, patterns: patterns.length });
    return { success: true, outcomes: outcomes.length, patterns: patterns.length, durationMs };
  } catch (err) {
    const durationMs = Date.now() - t0;
    log.error("Action failed", { action, durationMs, error: String(err) });
    return { success: false, outcomes: 0, patterns: 0, durationMs };
  }
}
