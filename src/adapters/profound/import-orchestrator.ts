/**
 * Master import orchestrator for Profound CSV exports.
 *
 * Runs all 4 adapters in dependency order:
 * 1. Entity seed (from known domains)
 * 2. Prompt import (from prompts_export.csv)
 * 3. Execution import (from raw_data_with_citations.csv)
 * 4. Citation import (from citations_data.csv)
 * 5. Benchmark import (from summarized_export.csv)
 *
 * Persists everything to the appropriate hot/cold stores.
 */

import "server-only";

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import {
  replaceTrackedPrompts,
  replaceTrackedEntities,
  replaceObservationRuns,
  replaceObservations,
  replaceSnapshots,
} from "@/storage/canonical-store";
import { writeAnswerTexts, writeCitationShard, clearCitationCache } from "@/lib/persistence/cold-store";
import { buildEntitySeed } from "./entity-seed";
import { parseProfoundPrompts } from "./prompt-adapter";
import { parseProfoundExecutions } from "./execution-adapter";
import { parseProfoundCitations } from "./citation-adapter";
import { parseProfoundBenchmark } from "./benchmark-adapter";
import type { EntityCandidate } from "./benchmark-adapter";
import { buildDerivedSnapshots } from "@/derivations/snapshot-builder";
import { writeLegacyBridge } from "./bridge";
import { discoverPages } from "@/domains/pages/discover";
import { buildCitationEvidenceIndex } from "@/domains/pages/citation-index";
import { writeStore, readStore } from "@/lib/persistence/json-store";
import { getAllCitationDates, getCitationsForDate } from "@/lib/persistence/cold-store";
import { getSiteConfig } from "@/lib/site-config";
import { writeFileSync, renameSync } from "node:fs";

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
};

export async function runProfoundImport(
  accountId: string
): Promise<ProfoundImportResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  const promptsFile = findFile("prompts_export");
  const rawFile = findFile("profound_raw_data_with_citations");
  const citationsFile = findFile("profound_citations_data");
  const summarizedFile = findFile("profound_summarized_export");

  if (!promptsFile) errors.push("Missing prompts_export CSV in .data/");
  if (!rawFile) errors.push("Missing profound_raw_data_with_citations.csv in .data/");
  if (!citationsFile) errors.push("Missing profound_citations_data.csv in .data/");

  if (errors.length > 0) {
    return {
      success: false,
      counts: { prompts: 0, entities: 0, observationRuns: 0, observations: 0, citations: 0, derivedSnapshots: 0, benchmarkSnapshots: 0, entityCandidates: 0, bridgedResults: 0, bridgedChanges: 0, pagesDiscovered: 0, citationRollups: 0 },
      entityCandidates: [],
      warnings,
      errors,
      elapsed_ms: Date.now() - start,
    };
  }

  const importRunId = `import-${Date.now()}`;

  // Phase 1: Entity seed
  const { entities, ownedDomains, domainToEntityId } = buildEntitySeed(accountId);
  await replaceTrackedEntities(entities);

  // Phase 2: Prompt import
  const promptResult = parseProfoundPrompts(promptsFile!, accountId);
  warnings.push(...promptResult.warnings);
  await replaceTrackedPrompts(promptResult.prompts);

  const promptLookup = new Map<string, string>();
  for (const p of promptResult.prompts) {
    promptLookup.set(p.text, p.id);
  }

  // Phase 3: Execution import
  const execResult = parseProfoundExecutions(
    rawFile!,
    accountId,
    importRunId,
    promptLookup,
    ownedDomains
  );
  warnings.push(...execResult.warnings);
  await replaceObservationRuns(execResult.runs);
  await replaceObservations(execResult.observations);
  writeAnswerTexts(execResult.answerTexts);

  // Phase 4: Citation import (to sharded cold storage)
  const citResult = parseProfoundCitations(citationsFile!, ownedDomains, domainToEntityId);
  warnings.push(...citResult.warnings);
  clearCitationCache();
  let totalCitations = 0;
  for (const [date, citations] of citResult.citationsByDate) {
    writeCitationShard(date, citations);
    totalCitations += citations.length;
  }

  // Phase 5: Derive Beacon-native snapshots from raw observations
  const ownedEntity = entities.find((e) => e.is_owned && e.entity_type === "brand");
  const ownedEntityId = ownedEntity?.id ?? "ritz";
  const derivedSnapshots = buildDerivedSnapshots(execResult.observations, ownedEntityId);

  // Phase 6: Benchmark import (optional)
  let benchmarkCount = 0;
  let entityCandidates: EntityCandidate[] = [];
  const allSnapshots = [...derivedSnapshots];
  if (summarizedFile) {
    const entityLookup = new Map<string, string>();
    for (const e of entities) {
      if (e.name) entityLookup.set(e.name, e.id);
    }
    const benchResult = parseProfoundBenchmark(summarizedFile, accountId, entityLookup);
    warnings.push(...benchResult.warnings);
    allSnapshots.push(...benchResult.snapshots);
    benchmarkCount = benchResult.snapshots.length;
    entityCandidates = benchResult.entityCandidates;
  }
  await replaceSnapshots(allSnapshots);

  // Phase 7: Bridge canonical data → legacy stores so existing
  // Review / event-detection / candidate-discovery pipeline works
  const changelogFile = findFile("ChangeLogWebsite");
  const bridgeResult = await writeLegacyBridge({
    snapshots: allSnapshots,
    changelogCSVPath: changelogFile,
    importBatchId: importRunId,
    sourceSystem: "profound",
    totalCanonicalRows: execResult.observations.length + totalCitations,
  });
  if (!changelogFile) {
    warnings.push("No ChangeLogWebsite CSV found — Review will have events but no candidate causes");
  }

  // Phase 8: Build page registry + citation evidence index
  const importedChanges = readStore<import("@/domains/changelog/types").ChangelogEntry>(
    "imported-changes"
  );

  const allCitationsForIndex: import("@/domains/citation-observations/types").CitationObservation[] =
    [];
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

  const citationIndex = buildCitationEvidenceIndex({
    citations: allCitationsForIndex,
    promptAnswers: execResult.observations,
  });
  const ciPath = join(DATA_DIR, "citation-evidence-index.json");
  const ciTmp = ciPath + ".tmp";
  writeFileSync(ciTmp, JSON.stringify(citationIndex), "utf-8");
  renameSync(ciTmp, ciPath);

  return {
    success: true,
    counts: {
      prompts: promptResult.prompts.length,
      entities: entities.length,
      observationRuns: execResult.runs.length,
      observations: execResult.observations.length,
      citations: totalCitations,
      derivedSnapshots: derivedSnapshots.length,
      benchmarkSnapshots: benchmarkCount,
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
  };
}

function findFile(prefix: string): string | null {
  if (!existsSync(DATA_DIR)) return null;
  const files = readdirSync(DATA_DIR) as string[];
  const lowerPrefix = prefix.toLowerCase();
  const match = files.find(
    (f) => f.toLowerCase().startsWith(lowerPrefix) && f.endsWith(".csv")
  );
  return match ? join(DATA_DIR, match) : null;
}
