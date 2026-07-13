/**
 * Master import orchestrator for Profound CSV exports.
 *
 * Discovery: CSVs under `.data/` are classified by **header signature** (not filename).
 * Multiple files per kind are **merged** with stable natural keys (idempotent; newest file wins on key collision).
 * Existing prompts / observations / answer texts / citation shards / benchmark snapshots are preserved
 * and unioned with new data; derived snapshots are recomputed from the merged observation set.
 */

import "server-only";

import { join } from "node:path";
import { renameSync, writeFileSync } from "node:fs";
import {
  replaceTrackedPrompts,
  replaceTrackedEntities,
  replaceObservationRuns,
  replaceObservations,
  replaceSnapshots,
  getTrackedPrompts,
  getPromptAnswerObservations,
  getDailyMetricSnapshots,
} from "@/storage/canonical-store";
import {
  writeAnswerTexts,
  writeCitationShard,
  clearCitationCache,
  getAllCitationDates,
  getCitationsForDate,
  readAnswerTextsFromDisk,
} from "@/lib/persistence/cold-store";
import { buildEntitySeed } from "./entity-seed";
import { parseProfoundPrompts } from "./prompt-adapter";
import { parseProfoundExecutions } from "./execution-adapter";
import { parseProfoundCitations } from "./citation-adapter";
import { parseProfoundBenchmark } from "./benchmark-adapter";
import type { EntityCandidate } from "./benchmark-adapter";
import { buildDerivedSnapshots } from "@/derivations/snapshot-builder";
import { writeLegacyBridge, parseChangelogCSVToLegacy } from "./bridge";
import { discoverProfoundCsvFiles } from "./csv-discovery";
import type { ProfoundCsvKind } from "./csv-discovery";
import {
  mergeById,
  mergeCitationLists,
  mergeChangelogEntries,
  mergeEntityCandidates,
  rebuildProfoundImportRuns,
} from "./merge-ingest";
import { discoverPages } from "@/domains/pages/discover";
import { buildCitationEvidenceIndex } from "@/domains/pages/citation-index";
import { buildAnswerIntelligenceIndex } from "@/domains/answer-intelligence/build-index";
import { writeStore, readStore } from "@/lib/persistence/json-store";
import { getBusinessConfig } from "@/lib/business-config";
import {
  getResults,
  getChangelogEntries,
} from "@/lib/seed-data.server";
import { refreshCitationEvidenceStore } from "@/domains/pages/citation-evidence-store";
import { refreshAnswerIntelligenceStore } from "@/domains/answer-intelligence/store";
import {
  syncCitationEvidenceIndex,
  syncAnswerIntelligenceIndex,
  syncPages,
} from "@/lib/persistence/dual-write";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

const DATA_DIR = join(process.cwd(), ".data");

export type ProfoundImportResult = {
  success: boolean;
  counts: {
    prompts: number;
    entities: number;
    observationRuns: number;
    observations: number;
    citations: number;
    derivedSnapshots: number;
    benchmarkSnapshots: number;
    entityCandidates: number;
    bridgedResults: number;
    bridgedChanges: number;
    pagesDiscovered: number;
    citationRollups: number;
    changeOutcomes?: number;
    pageVisibilitySummaries?: number;
  };
  entityCandidates: EntityCandidate[];
  warnings: string[];
  errors: string[];
  elapsed_ms: number;
  /** Which `.data/*.csv` files were used per kind (merge order = array order). */
  ingest_files?: Partial<Record<ProfoundCsvKind, string[]>>;
  /** CSVs present but not recognized as Profound-shaped (ignored). */
  unclassified_csv?: string[];
};

export async function runProfoundImport(
  tenantId: string,
): Promise<ProfoundImportResult> {
  tenantId = tenantId.trim();
  if (!tenantId) {
    throw new Error(
      "[profound/import-orchestrator] runProfoundImport requires an explicit tenantId",
    );
  }
  // This legacy importer reads operator-dropped files from `.data/` and uses
  // synchronous cold stores that are scoped to one local process. It is not a
  // hosted, multi-tenant connector. Refuse to run where the filesystem is
  // read-only or when the request tenant differs from the explicitly configured
  // local tenant; silently crossing either boundary could mix customer data.
  if (process.env.VERCEL === "1") {
    throw new Error(
      "[profound/import-orchestrator] legacy CSV import is local-operator-only and cannot run on Vercel",
    );
  }
  const configuredTenantId = process.env.BEACON_TENANT_ID?.trim();
  if (!configuredTenantId || configuredTenantId !== tenantId) {
    throw new Error(
      "[profound/import-orchestrator] request tenant must match the explicitly configured local BEACON_TENANT_ID",
    );
  }
  const accountId = tenantId;
  const business = getBusinessConfig(tenantId);

  const start = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  const discovery = discoverProfoundCsvFiles(DATA_DIR);
  const { byKind, unclassified } = discovery;

  if (unclassified.length > 0) {
    warnings.push(
      `Unclassified CSV (ignored): ${unclassified.map((p) => p.split("/").pop()).join(", ")}`
    );
  }

  if (byKind.prompts.length === 0) {
    errors.push("No prompts CSV found in .data/ (expected columns: id, prompt, topic)");
  }
  if (byKind.raw_executions.length === 0) {
    errors.push(
      "No raw execution CSV found in .data/ (expected columns: run_id, date, platform, prompt, response, …)"
    );
  }
  if (byKind.citations.length === 0) {
    errors.push(
      "No citations CSV found in .data/ (expected columns: run_id, date, url, hostname, …)"
    );
  }

  if (errors.length > 0) {
    return {
      success: false,
      counts: {
        prompts: 0,
        entities: 0,
        observationRuns: 0,
        observations: 0,
        citations: 0,
        derivedSnapshots: 0,
        benchmarkSnapshots: 0,
        entityCandidates: 0,
        bridgedResults: 0,
        bridgedChanges: 0,
        pagesDiscovered: 0,
        citationRollups: 0,
      },
      entityCandidates: [],
      warnings,
      errors,
      elapsed_ms: Date.now() - start,
      ingest_files: byKind,
      unclassified_csv: unclassified,
    };
  }

  const importRunId = `import-${Date.now()}`;

  // Phase 1: Entity seed
  const { entities, ownedDomains, domainToEntityId } = buildEntitySeed(
    accountId,
    business,
  );
  const ownedEntity = entities.find(
    (entity) => entity.is_owned && entity.entity_type === "brand",
  );
  if (!ownedEntity) {
    throw new Error(
      `[profound/import-orchestrator] no owned brand entity for tenant ${tenantId}`,
    );
  }
  await replaceTrackedEntities(entities, tenantId);

  // Phase 2: Prompts — merge all prompt-shaped CSVs + existing store
  let mergedPrompts = [...(await getTrackedPrompts())];
  for (const filePath of byKind.prompts) {
    const pr = parseProfoundPrompts(filePath, accountId);
    warnings.push(...pr.warnings);
    mergedPrompts = mergeById(mergedPrompts, pr.prompts, true);
  }
  await replaceTrackedPrompts(mergedPrompts, tenantId);

  const promptLookup = new Map<string, string>();
  for (const p of mergedPrompts) {
    promptLookup.set(p.text, p.id);
  }

  // Phase 3: Raw executions — merge observations + answer texts + rebuild runs
  // 2026-04-19: pass brand aliases so the execution adapter can fall back to
  // text-scan mention detection when Profound's CSV "mentions" column is
  // incomplete (a systematic Profound bug).
  //
  // Aliases come from THREE sources, unioned:
  //   1. business-config.json `name` (canonical brand name, e.g. "Ritz Builders")
  //   2. Tracked entity names with is_owned=true
  //   3. First-word shortening of the above ("Ritz Builders" \u2192 "Ritz")
  // The entity-seed-only path produced "Ritzbuilders" (one word) which failed
  // to match "Ritz Builders" in actual response text.
  const bizName = business.name;
  const rawAliases = new Set<string>();
  if (bizName) rawAliases.add(bizName);
  for (const e of entities) {
    if (e.is_owned && e.entity_type === "brand" && e.name) rawAliases.add(e.name);
  }
  // Add first-word shortening for each multi-word alias.
  for (const a of [...rawAliases]) {
    const first = a.split(/\s+/)[0];
    if (first && first !== a && first.length >= 3) rawAliases.add(first);
  }
  const ownedBrandAliases = [...rawAliases];

  let mergedObservations: PromptAnswerObservation[] = [...(await getPromptAnswerObservations())];
  const mergedAnswerTexts: Record<string, string> = { ...readAnswerTextsFromDisk() };
  for (const filePath of byKind.raw_executions) {
    const ex = parseProfoundExecutions(
      filePath,
      accountId,
      importRunId,
      promptLookup,
      ownedDomains,
      tenantId,
      ownedBrandAliases,
    );
    warnings.push(...ex.warnings);
    mergedObservations = mergeById(mergedObservations, ex.observations, true);
    Object.assign(mergedAnswerTexts, ex.answerTexts);
  }
  const mergedRuns = rebuildProfoundImportRuns(
    mergedObservations,
    accountId,
    importRunId
  );
  await replaceObservationRuns(mergedRuns);
  await replaceObservations(mergedObservations, tenantId);
  writeAnswerTexts(mergedAnswerTexts);

  // Phase 4: Citations — merge per date into shards
  clearCitationCache();
  const datesTouched = new Set<string>();
  const incomingByDate = new Map<string, CitationObservation[]>();

  for (const filePath of byKind.citations) {
    const cit = parseProfoundCitations(filePath, ownedDomains, domainToEntityId);
    warnings.push(...cit.warnings);
    for (const [date, list] of cit.citationsByDate) {
      datesTouched.add(date);
      if (!incomingByDate.has(date)) incomingByDate.set(date, []);
      incomingByDate.get(date)!.push(...list);
    }
  }

  for (const date of [...datesTouched].sort()) {
    const existing = getCitationsForDate(date);
    const incoming = incomingByDate.get(date) ?? [];
    const merged = mergeCitationLists(existing, incoming);
    writeCitationShard(date, merged);
  }
  // Dates only on disk (not in this import) are left unchanged.

  let totalCitations = 0;
  for (const d of getAllCitationDates()) {
    totalCitations += getCitationsForDate(d).length;
  }

  // Phase 5: Derived snapshots from merged observations
  const derivedSnapshots = buildDerivedSnapshots(
    mergedObservations,
    ownedEntity.id,
    tenantId,
  );

  // Phase 6: Benchmark — merge all summarized files + existing benchmark rows on disk
  const entityLookup = new Map<string, string>();
  for (const e of entities) {
    if (e.name) entityLookup.set(e.name, e.id);
  }

  const existingBench = (await getDailyMetricSnapshots()).filter(
    (s) => s.source_type === "benchmark"
  );
  let mergedBenchmark: DailyMetricSnapshot[] = [...existingBench];
  const candidateLists: EntityCandidate[][] = [];

  for (const filePath of byKind.benchmark) {
    const bench = parseProfoundBenchmark(
      filePath,
      accountId,
      entityLookup,
      tenantId,
      business.name,
    );
    warnings.push(...bench.warnings);
    mergedBenchmark = mergeById(mergedBenchmark, bench.snapshots, true);
    candidateLists.push(bench.entityCandidates);
  }

  const allSnapshots: DailyMetricSnapshot[] = [
    ...derivedSnapshots,
    ...mergedBenchmark,
  ];
  await replaceSnapshots(allSnapshots, tenantId);

  const entityCandidates =
    candidateLists.length > 0 ? mergeEntityCandidates(candidateLists) : [];

  // Phase 7: Changelog — optional; merge discovered files into existing imported-changes
  let changelogForBridge: ChangelogEntry[] | undefined;
  if (byKind.changelog.length > 0) {
    let mergedChangelog = await readStore<ChangelogEntry>("imported-changes");
    for (const filePath of byKind.changelog) {
      const parsed = parseChangelogCSVToLegacy(filePath, importRunId, tenantId);
      mergedChangelog = mergeChangelogEntries(mergedChangelog, parsed);
    }
    changelogForBridge = mergedChangelog;
  }
  if (byKind.changelog.length === 0) {
    warnings.push(
      "No changelog CSV found — Review may lack candidate causes (expected columns: Date, Signal Type, …)"
    );
  }

  const bridgeResult = await writeLegacyBridge({
    snapshots: allSnapshots,
    changelogCSVPath: null,
    changelogEntries: changelogForBridge,
    importBatchId: importRunId,
    sourceSystem: "profound",
    totalCanonicalRows: mergedObservations.length + totalCitations,
  });

  // Refresh the module-level arrays so the UI immediately reflects bridged data.
  // Without this, seed-data.server.ts keeps the stale arrays from server startup.
  const freshResults = await readStore<import("@/domains/results/types").Result>("imported-results");
  const moduleResults = await getResults();
  moduleResults.length = 0;
  moduleResults.push(...freshResults);

  const importedChanges = await readStore<ChangelogEntry>("imported-changes");
  const moduleChangelog = await getChangelogEntries();
  moduleChangelog.length = 0;
  moduleChangelog.push(...importedChanges);

  const allCitationsForIndex: CitationObservation[] = [];
  for (const d of getAllCitationDates()) {
    allCitationsForIndex.push(...getCitationsForDate(d));
  }

  const siteDomain = business.domain.trim().toLowerCase().replace(/^www\./, "");
  const pages = discoverPages({
    citations: allCitationsForIndex,
    changes: importedChanges,
    entities,
    ownedDomain: siteDomain,
    tenantId,
  });
  await writeStore("pages", pages);
  await syncPages(pages, tenantId);

  const citationIndex = buildCitationEvidenceIndex({
    citations: allCitationsForIndex,
    promptAnswers: mergedObservations,
  });
  const ciPath = join(DATA_DIR, "citation-evidence-index.json");
  const ciTmp = ciPath + ".tmp";
  writeFileSync(ciTmp, JSON.stringify(citationIndex), "utf-8");
  renameSync(ciTmp, ciPath);
  await syncCitationEvidenceIndex(citationIndex, tenantId);

  // Build answer intelligence index — extracts brand positioning, visibility
  // time-series, co-citation analysis, and narrative shifts from observation +
  // answer text data that the citation-evidence-index doesn't surface.
  const answerIntelIndex = buildAnswerIntelligenceIndex({
    observations: mergedObservations,
    answerTexts: mergedAnswerTexts,
    brandName: business.name,
    ownedDomain: siteDomain,
    tenantId,
  });
  const aiPath = join(DATA_DIR, "answer-intelligence-index.json");
  const aiTmp = aiPath + ".tmp";
  writeFileSync(aiTmp, JSON.stringify(answerIntelIndex), "utf-8");
  renameSync(aiTmp, aiPath);
  await syncAnswerIntelligenceIndex(answerIntelIndex, tenantId);

  // Refresh module-level caches so the UI reads fresh data without server restart
  await refreshCitationEvidenceStore();
  await refreshAnswerIntelligenceStore();

  // Phase 11: materialize relationship stores (best-effort)
  let changeOutcomeCount = 0;
  let pageVisibilityCount = 0;
  let materializedOutcomes: import("@/domains/attribution/change-outcome").ChangeOutcome[] = [];
  try {
    const { materializePerChangeOutcomes } = await import(
      "@/domains/attribution/change-outcome"
    );
    materializedOutcomes = await materializePerChangeOutcomes(
      importedChanges,
      allSnapshots,
    );
    changeOutcomeCount = materializedOutcomes.length;
  } catch (e) {
    console.warn(
      "[materialize] change-outcomes:",
      e instanceof Error ? e.message : e,
    );
  }
  try {
    const { materializePageVisibility } = await import(
      "@/domains/pages/page-visibility"
    );
    const summaries = await materializePageVisibility(
      citationIndex,
      allSnapshots,
      tenantId,
      materializedOutcomes,
    );
    pageVisibilityCount = summaries.length;
  } catch (e) {
    console.warn(
      "[materialize] page-visibility:",
      e instanceof Error ? e.message : e,
    );
  }

  // Phase 12: learning loops (best-effort, passive storage only)
  try {
    const { materializeChangePatterns } = await import(
      "@/domains/learning/change-patterns"
    );
    await materializeChangePatterns(materializedOutcomes, importedChanges);
  } catch (e) {
    console.warn("[learning] change-patterns:", e instanceof Error ? e.message : e);
  }
  try {
    const { materializeConfidenceCalibration } = await import(
      "@/domains/learning/confidence-calibration"
    );
    const { readStore: readLearningStore } = await import(
      "@/lib/persistence/json-store"
    );
    const decisions = await readLearningStore<{ id: string; primary_change_id: string | null; operator_confidence: string; cause_type: string }>("event-decisions");
    await materializeConfidenceCalibration(decisions, materializedOutcomes);
  } catch (e) {
    console.warn("[learning] confidence-calibration:", e instanceof Error ? e.message : e);
  }

  return {
    success: true,
    counts: {
      prompts: mergedPrompts.length,
      entities: entities.length,
      observationRuns: mergedRuns.length,
      observations: mergedObservations.length,
      citations: totalCitations,
      derivedSnapshots: derivedSnapshots.length,
      benchmarkSnapshots: mergedBenchmark.length,
      entityCandidates: entityCandidates.length,
      bridgedResults: bridgeResult.resultCount,
      bridgedChanges: bridgeResult.changeCount,
      pagesDiscovered: pages.length,
      citationRollups: citationIndex.by_page_and_topic.length,
      changeOutcomes: changeOutcomeCount,
      pageVisibilitySummaries: pageVisibilityCount,
    },
    entityCandidates,
    warnings,
    errors,
    elapsed_ms: Date.now() - start,
    ingest_files: byKind,
    unclassified_csv: unclassified,
  };
}
