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
  trackedPrompts,
  promptAnswerObservations,
  dailyMetricSnapshots,
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
import { getSiteConfig } from "@/lib/site-config";
import {
  results as moduleResults,
  changelogEntries as moduleChangelog,
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
  accountId: string
): Promise<ProfoundImportResult> {
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
  const { entities, ownedDomains, domainToEntityId } = buildEntitySeed(accountId);
  await replaceTrackedEntities(entities);

  // Phase 2: Prompts — merge all prompt-shaped CSVs + existing store
  let mergedPrompts = [...trackedPrompts];
  for (const filePath of byKind.prompts) {
    const pr = parseProfoundPrompts(filePath, accountId);
    warnings.push(...pr.warnings);
    mergedPrompts = mergeById(mergedPrompts, pr.prompts, true);
  }
  await replaceTrackedPrompts(mergedPrompts);

  const promptLookup = new Map<string, string>();
  for (const p of mergedPrompts) {
    promptLookup.set(p.text, p.id);
  }

  // Phase 3: Raw executions — merge observations + answer texts + rebuild runs
  let mergedObservations: PromptAnswerObservation[] = [...promptAnswerObservations];
  const mergedAnswerTexts: Record<string, string> = { ...readAnswerTextsFromDisk() };
  for (const filePath of byKind.raw_executions) {
    const ex = parseProfoundExecutions(
      filePath,
      accountId,
      importRunId,
      promptLookup,
      ownedDomains
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
  await replaceObservations(mergedObservations);
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
  const ownedEntity = entities.find((e) => e.is_owned && e.entity_type === "brand");
  const ownedEntityId = ownedEntity?.id ?? "ritz";
  const derivedSnapshots = buildDerivedSnapshots(mergedObservations, ownedEntityId);

  // Phase 6: Benchmark — merge all summarized files + existing benchmark rows on disk
  const entityLookup = new Map<string, string>();
  for (const e of entities) {
    if (e.name) entityLookup.set(e.name, e.id);
  }

  const existingBench = dailyMetricSnapshots.filter(
    (s) => s.source_type === "benchmark"
  );
  let mergedBenchmark: DailyMetricSnapshot[] = [...existingBench];
  const candidateLists: EntityCandidate[][] = [];

  for (const filePath of byKind.benchmark) {
    const bench = parseProfoundBenchmark(filePath, accountId, entityLookup);
    warnings.push(...bench.warnings);
    mergedBenchmark = mergeById(mergedBenchmark, bench.snapshots, true);
    candidateLists.push(bench.entityCandidates);
  }

  const allSnapshots: DailyMetricSnapshot[] = [
    ...derivedSnapshots,
    ...mergedBenchmark,
  ];
  await replaceSnapshots(allSnapshots);

  const entityCandidates =
    candidateLists.length > 0 ? mergeEntityCandidates(candidateLists) : [];

  // Phase 7: Changelog — optional; merge discovered files into existing imported-changes
  let changelogForBridge: ChangelogEntry[] | undefined;
  if (byKind.changelog.length > 0) {
    let mergedChangelog = readStore<ChangelogEntry>("imported-changes");
    for (const filePath of byKind.changelog) {
      const parsed = parseChangelogCSVToLegacy(filePath, importRunId);
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
  const freshResults = readStore<import("@/domains/results/types").Result>("imported-results");
  moduleResults.length = 0;
  moduleResults.push(...freshResults);

  const importedChanges = readStore<ChangelogEntry>("imported-changes");
  moduleChangelog.length = 0;
  moduleChangelog.push(...importedChanges);

  const allCitationsForIndex: CitationObservation[] = [];
  for (const d of getAllCitationDates()) {
    allCitationsForIndex.push(...getCitationsForDate(d));
  }

  const { siteDomain } = getSiteConfig();
  const pages = discoverPages({
    citations: allCitationsForIndex,
    changes: importedChanges,
    entities,
    ownedDomain: siteDomain,
  });
  await writeStore("pages", pages);
  await syncPages(pages);

  const citationIndex = buildCitationEvidenceIndex({
    citations: allCitationsForIndex,
    promptAnswers: mergedObservations,
  });
  const ciPath = join(DATA_DIR, "citation-evidence-index.json");
  const ciTmp = ciPath + ".tmp";
  writeFileSync(ciTmp, JSON.stringify(citationIndex), "utf-8");
  renameSync(ciTmp, ciPath);
  await syncCitationEvidenceIndex(citationIndex);

  // Build answer intelligence index — extracts brand positioning, visibility
  // time-series, co-citation analysis, and narrative shifts from observation +
  // answer text data that the citation-evidence-index doesn't surface.
  const { entityDisplayName } = getSiteConfig();
  const answerIntelIndex = buildAnswerIntelligenceIndex({
    observations: mergedObservations,
    answerTexts: mergedAnswerTexts,
    brandName: entityDisplayName,
    ownedDomain: siteDomain,
  });
  const aiPath = join(DATA_DIR, "answer-intelligence-index.json");
  const aiTmp = aiPath + ".tmp";
  writeFileSync(aiTmp, JSON.stringify(answerIntelIndex), "utf-8");
  renameSync(aiTmp, aiPath);
  await syncAnswerIntelligenceIndex(answerIntelIndex);

  // Refresh module-level caches so the UI reads fresh data without server restart
  refreshCitationEvidenceStore();
  refreshAnswerIntelligenceStore();

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
    },
    entityCandidates,
    warnings,
    errors,
    elapsed_ms: Date.now() - start,
    ingest_files: byKind,
    unclassified_csv: unclassified,
  };
}
