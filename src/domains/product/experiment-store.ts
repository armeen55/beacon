/**
 * Experiment Store — lightweight persistence for the recommendation→action→outcome loop.
 *
 * An experiment tracks: what Beacon recommended, what the operator actually did,
 * what to watch, and whether the outcome looks positive after future imports.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExperimentStatus =
  | "testing"
  | "watching"
  | "promising"
  | "inconclusive"
  | "negative"
  | "dropped";

export type Experiment = {
  id: string;
  recId: string;
  headline: string;
  recType: string;
  targetPageUrl: string | null;
  targetPagePath: string | null;
  watchAfter: string;
  operatorNote: string;
  startedAt: string;
  status: ExperimentStatus;
  baselineCitations: number | null;
  latestCitations: number | null;
  lastCheckedAt: string | null;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORE_NAME = "experiments";

export const experiments: Experiment[] =
  readStore<Experiment>(STORE_NAME);

export async function persistExperiments(): Promise<void> {
  await writeStore(STORE_NAME, experiments);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getExperiment(id: string): Experiment | undefined {
  return experiments.find((e) => e.id === id);
}

export function getExperimentByRecId(recId: string): Experiment | undefined {
  return experiments.find((e) => e.recId === recId);
}

export function getActiveExperiments(): Experiment[] {
  return experiments.filter(
    (e) => e.status !== "dropped",
  );
}

export function startExperiment(opts: {
  recId: string;
  headline: string;
  recType: string;
  targetPageUrl: string | null;
  targetPagePath: string | null;
  watchAfter: string;
  operatorNote: string;
  baselineCitations: number | null;
}): Experiment {
  const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const exp: Experiment = {
    id,
    recId: opts.recId,
    headline: opts.headline,
    recType: opts.recType,
    targetPageUrl: opts.targetPageUrl,
    targetPagePath: opts.targetPagePath,
    watchAfter: opts.watchAfter,
    operatorNote: opts.operatorNote,
    startedAt: new Date().toISOString(),
    status: "testing",
    baselineCitations: opts.baselineCitations,
    latestCitations: null,
    lastCheckedAt: null,
  };

  const existing = experiments.findIndex((e) => e.recId === opts.recId);
  if (existing >= 0) {
    experiments[existing] = exp;
  } else {
    experiments.push(exp);
  }

  return exp;
}

export function updateExperimentStatus(
  id: string,
  status: ExperimentStatus,
): void {
  const exp = experiments.find((e) => e.id === id);
  if (exp) exp.status = status;
}

export function updateExperimentCitations(
  id: string,
  latestCitations: number,
): void {
  const exp = experiments.find((e) => e.id === id);
  if (!exp) return;
  exp.latestCitations = latestCitations;
  exp.lastCheckedAt = new Date().toISOString();

  if (exp.baselineCitations === null) return;
  const delta = latestCitations - exp.baselineCitations;

  if (exp.status === "dropped") return;

  if (delta > 0) {
    exp.status = "promising";
  } else if (delta < 0) {
    exp.status = "negative";
  } else {
    const daysSinceStart = Math.floor(
      (Date.now() - new Date(exp.startedAt).getTime()) / 86_400_000,
    );
    exp.status = daysSinceStart > 14 ? "inconclusive" : "watching";
  }
}

export function updateExperimentNote(id: string, note: string): void {
  const exp = experiments.find((e) => e.id === id);
  if (exp) exp.operatorNote = note;
}
