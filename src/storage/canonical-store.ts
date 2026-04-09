/**
 * Profound import pipeline data stores.
 *
 * This module is consumed ONLY by `adapters/profound/import-orchestrator.ts`.
 * App route pages should NOT import from here — they use
 * `domains/attribution/store.ts` for event-decisions and
 * `domains/observations/read.ts` for website observation runs.
 *
 * Hot stores: loaded eagerly via json-store (small collections).
 * Cold stores: loaded on-demand via cold-store (large observation data).
 *
 * Shared filename: `.data/observation-runs.json` also receives website `ObservationRun`
 * rows from scan/verify. This module only ever treats the file as `ProfoundImportRun[]`
 * (json-store parse). Website runs are read via `SeedDataRepository.getObservationRuns()`
 * (`file-backend` merges typed rows + `scan-runs.json`, skipping Profound-shaped objects).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { ProfoundImportRun } from "@/domains/observation-runs/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { OutcomeEvent } from "@/domains/outcome-events/types";
import type { CandidateCause } from "@/domains/candidate-causes/types";
import type { EventDecision } from "@/domains/event-decisions/types";

// ---------------------------------------------------------------------------
// Hot stores — small, loaded at startup
// ---------------------------------------------------------------------------

export const trackedPrompts: TrackedPrompt[] = readStore<TrackedPrompt>("tracked-prompts");
export const trackedEntities: TrackedEntity[] = readStore<TrackedEntity>("tracked-entities");
export const observationRuns: ProfoundImportRun[] = readStore<ProfoundImportRun>("observation-runs");
export const promptAnswerObservations: PromptAnswerObservation[] =
  readStore<PromptAnswerObservation>("prompt-answer-observations");
export const dailyMetricSnapshots: DailyMetricSnapshot[] =
  readStore<DailyMetricSnapshot>("daily-metric-snapshots");
export const outcomeEvents: OutcomeEvent[] = readStore<OutcomeEvent>("outcome-events");
export const candidateCauses: CandidateCause[] = readStore<CandidateCause>("candidate-causes");
export const eventDecisions: EventDecision[] = readStore<EventDecision>("event-decisions");

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export async function persistTrackedPrompts(): Promise<void> {
  await writeStore("tracked-prompts", trackedPrompts);
}

export async function persistTrackedEntities(): Promise<void> {
  await writeStore("tracked-entities", trackedEntities);
}

export async function persistObservationRuns(): Promise<void> {
  await writeStore("observation-runs", observationRuns);
}

export async function persistObservations(): Promise<void> {
  await writeStore("prompt-answer-observations", promptAnswerObservations);
}

export async function persistSnapshots(): Promise<void> {
  await writeStore("daily-metric-snapshots", dailyMetricSnapshots);
}

export async function persistOutcomeEvents(): Promise<void> {
  await writeStore("outcome-events", outcomeEvents);
}

export async function persistCandidateCauses(): Promise<void> {
  await writeStore("candidate-causes", candidateCauses);
}

export async function persistEventDecisions(): Promise<void> {
  await writeStore("event-decisions", eventDecisions);
}

// ---------------------------------------------------------------------------
// Bulk replace helpers (for import pipeline)
// ---------------------------------------------------------------------------

function replaceAll<T>(target: T[], source: T[]): void {
  target.length = 0;
  target.push(...source);
}

export async function replaceTrackedPrompts(data: TrackedPrompt[]): Promise<void> {
  replaceAll(trackedPrompts, data);
  await persistTrackedPrompts();
}

export async function replaceTrackedEntities(data: TrackedEntity[]): Promise<void> {
  replaceAll(trackedEntities, data);
  await persistTrackedEntities();
}

export async function replaceObservationRuns(data: ProfoundImportRun[]): Promise<void> {
  replaceAll(observationRuns, data);
  await persistObservationRuns();
}

export async function replaceObservations(data: PromptAnswerObservation[]): Promise<void> {
  replaceAll(promptAnswerObservations, data);
  await persistObservations();
}

export async function replaceSnapshots(data: DailyMetricSnapshot[]): Promise<void> {
  replaceAll(dailyMetricSnapshots, data);
  await persistSnapshots();
}
