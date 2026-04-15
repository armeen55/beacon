/**
 * Experiment Store — lightweight persistence for the recommendation→action→outcome loop.
 *
 * An experiment tracks: what Beacon recommended, what the operator actually did,
 * what to watch, and whether the outcome looks positive after future imports.
 *
 * Timeline: each experiment appends daily snapshots so progression is visible
 * over time. Snapshots are never overwritten — chronology is preserved.
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

export type TimelineEntry = {
  date: string;
  citations: number;
  mentions: number;
  visibility: number;
  platformBreakdown?: Record<string, { citations: number; mentions: number }>;
  status: ExperimentStatus;
  confidence: "none" | "low" | "medium" | "high";
};

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
  // Citations
  baselineCitations: number | null;
  latestCitations: number | null;
  lastCheckedAt: string | null;
  // Mentions + visibility
  baselineMentions: number | null;
  latestMentions: number | null;
  baselineVisibility: number | null;
  latestVisibility: number | null;
  // Topic tracking
  trackedTopic: string | null;
  // Daily timeline (append-only)
  timeline: TimelineEntry[];
  // Replication linkage
  replicationSourceChangeId?: string | null;
  replicationPatternId?: string | null;
  replicationEvidenceTier?: "observed" | "mixed" | "inferred";
  // Backfill provenance
  backfilled?: boolean;
  backfillReason?: string | null;
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
  baselineMentions?: number | null;
  baselineVisibility?: number | null;
  trackedTopic?: string | null;
  replicationSourceChangeId?: string | null;
  replicationPatternId?: string | null;
  replicationEvidenceTier?: "observed" | "mixed" | "inferred";
  backfilled?: boolean;
  backfillReason?: string | null;
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
    baselineMentions: opts.baselineMentions ?? null,
    latestMentions: null,
    baselineVisibility: opts.baselineVisibility ?? null,
    latestVisibility: null,
    trackedTopic: opts.trackedTopic ?? null,
    timeline: [],
    replicationSourceChangeId: opts.replicationSourceChangeId ?? null,
    replicationPatternId: opts.replicationPatternId ?? null,
    replicationEvidenceTier: opts.replicationEvidenceTier,
    backfilled: opts.backfilled,
    backfillReason: opts.backfillReason ?? null,
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

// ---------------------------------------------------------------------------
// Multi-metric update with timeline
// ---------------------------------------------------------------------------

function computeConfidence(exp: Experiment): TimelineEntry["confidence"] {
  if (!exp.baselineCitations && !exp.baselineMentions) return "none";
  const daysSinceStart = Math.floor(
    (Date.now() - new Date(exp.startedAt).getTime()) / 86_400_000,
  );
  if (daysSinceStart < 3) return "low";
  if (daysSinceStart < 7) return "medium";
  return "high";
}

export function updateExperimentMetrics(
  id: string,
  metrics: {
    latestCitations: number;
    latestMentions: number;
    latestVisibility: number;
    platformBreakdown?: Record<string, { citations: number; mentions: number }>;
  },
): void {
  const exp = experiments.find((e) => e.id === id);
  if (!exp) return;

  exp.latestCitations = metrics.latestCitations;
  exp.latestMentions = metrics.latestMentions;
  exp.latestVisibility = metrics.latestVisibility;
  exp.lastCheckedAt = new Date().toISOString();

  if (exp.status === "dropped") return;

  // Status from combined signals
  const citDelta = (exp.baselineCitations ?? 0) > 0
    ? metrics.latestCitations - exp.baselineCitations!
    : 0;
  const menDelta = (exp.baselineMentions ?? 0) > 0
    ? metrics.latestMentions - exp.baselineMentions!
    : 0;
  const daysSinceStart = Math.floor(
    (Date.now() - new Date(exp.startedAt).getTime()) / 86_400_000,
  );

  if (citDelta > 0 || menDelta > 0) {
    exp.status = "promising";
  } else if (citDelta < 0 && menDelta < 0) {
    exp.status = "negative";
  } else {
    exp.status = daysSinceStart > 14 ? "inconclusive" : "watching";
  }

  // Append timeline snapshot (one per date — skip if today already recorded)
  const today = new Date().toISOString().slice(0, 10);
  if (!exp.timeline) exp.timeline = [];
  const alreadyRecorded = exp.timeline.some((t) => t.date === today);
  if (!alreadyRecorded) {
    exp.timeline.push({
      date: today,
      citations: metrics.latestCitations,
      mentions: metrics.latestMentions,
      visibility: metrics.latestVisibility,
      platformBreakdown: metrics.platformBreakdown,
      status: exp.status,
      confidence: computeConfidence(exp),
    });
  }
}

/** Legacy single-metric update — delegates to updateExperimentMetrics */
export function updateExperimentCitations(
  id: string,
  latestCitations: number,
): void {
  const exp = experiments.find((e) => e.id === id);
  if (!exp) return;
  updateExperimentMetrics(id, {
    latestCitations,
    latestMentions: exp.latestMentions ?? exp.baselineMentions ?? 0,
    latestVisibility: exp.latestVisibility ?? exp.baselineVisibility ?? 0,
  });
}

export function updateExperimentNote(id: string, note: string): void {
  const exp = experiments.find((e) => e.id === id);
  if (exp) exp.operatorNote = note;
}
