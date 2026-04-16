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
  /** Percentage change in citations vs experiment baseline */
  citationDeltaPct?: number;
  /** Percentage change in mentions vs experiment baseline */
  mentionDeltaPct?: number;
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
  /** Owning tenant. */
  tenant_id: string;
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
    tenant_id: "",
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
// Noise floor constants
// ---------------------------------------------------------------------------

/** Minimum percentage change (vs baseline) to count as a real signal. */
export const MIN_DELTA_PCT = 5;

/** Must see direction sustained across this many timeline entries. */
export const MIN_SUSTAINED_POINTS = 3;

/** Don't change status from "watching" before this many days for FULL verdict. */
export const MIN_DAYS_FOR_VERDICT = 7;

/**
 * Wave-based check-in thresholds (in days).
 * Instead of one binary gate at 7 days, the experiment progresses
 * through waves so the operator gets feedback sooner:
 *
 *   Wave 1 (3 days): "early_signal" — any delta ≥3% in consistent direction
 *   Wave 2 (5 days): "signal_building" — delta ≥5% AND 2+ sustained points
 *   Wave 3 (7 days): full verdict — standard MIN_DELTA_PCT + MIN_SUSTAINED_POINTS
 *   Wave 4 (14 days): "confirmed" or "no_movement" — high-confidence outcome
 *   Wave 5 (21 days): "inconclusive" if still flat
 */
const EARLY_SIGNAL_DAYS = 3;
const EARLY_SIGNAL_MIN_DELTA = 3; // Lower bar for early signal
const BUILDING_SIGNAL_DAYS = 5;
const CONFIRMED_DAYS = 14;

/** After this many days with no clear signal, mark inconclusive. */
const INCONCLUSIVE_DAYS = 21;

// ---------------------------------------------------------------------------
// Helpers — sustained direction check
// ---------------------------------------------------------------------------

/**
 * Returns true if the last `minPoints` timeline entries show a consistent
 * direction for citations. "up" = each entry >= previous. "down" = each <= previous.
 * Returns false if fewer than `minPoints` entries exist.
 */
export function sustainedDirection(
  timeline: TimelineEntry[],
  dir: "up" | "down",
  minPoints: number,
): boolean {
  if (timeline.length < minPoints) return false;
  const recent = timeline.slice(-minPoints);
  for (let i = 1; i < recent.length; i++) {
    if (dir === "up" && recent[i].citations < recent[i - 1].citations) return false;
    if (dir === "down" && recent[i].citations > recent[i - 1].citations) return false;
  }
  return true;
}

/**
 * Compute percentage delta from baseline. Returns 0 if baseline is 0 or null.
 */
function deltaPct(baseline: number | null, current: number): number {
  if (!baseline || baseline === 0) return 0;
  return ((current - baseline) / baseline) * 100;
}

// ---------------------------------------------------------------------------
// Evidence-based confidence (replaces time-based)
// ---------------------------------------------------------------------------

function computeConfidence(
  exp: Experiment,
  citDeltaPct: number,
  sustained: boolean,
): TimelineEntry["confidence"] {
  if (!exp.baselineCitations && !exp.baselineMentions) return "none";
  const n = exp.timeline?.length ?? 0;
  const absDelta = Math.abs(citDeltaPct);

  if (n < 3) return "low";
  if (n < 7 && absDelta < 10) return "low";
  if (n >= 14 && absDelta >= 10 && sustained) return "high";
  if (n >= 7 && absDelta >= MIN_DELTA_PCT && sustained) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Multi-metric update with timeline
// ---------------------------------------------------------------------------

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

  // Compute percentage deltas from baseline
  const citDeltaPct = deltaPct(exp.baselineCitations, metrics.latestCitations);
  const menDeltaPct = deltaPct(exp.baselineMentions, metrics.latestMentions);

  const daysSinceStart = Math.floor(
    (Date.now() - new Date(exp.startedAt).getTime()) / 86_400_000,
  );

  // Append timeline snapshot BEFORE status computation (so sustainedDirection
  // can use the current entry)
  const today = new Date().toISOString().slice(0, 10);
  if (!exp.timeline) exp.timeline = [];
  const alreadyRecorded = exp.timeline.some((t) => t.date === today);
  if (!alreadyRecorded) {
    // Push a placeholder — status and confidence will be set below
    exp.timeline.push({
      date: today,
      citations: metrics.latestCitations,
      mentions: metrics.latestMentions,
      visibility: metrics.latestVisibility,
      platformBreakdown: metrics.platformBreakdown,
      citationDeltaPct: Math.round(citDeltaPct * 10) / 10,
      mentionDeltaPct: Math.round(menDeltaPct * 10) / 10,
      status: exp.status, // placeholder, updated below
      confidence: "low",  // placeholder, updated below
    });
  }

  // --- Wave-based status determination ---
  // Check-in at 3d, 5d, 7d, 14d, 21d — not one binary gate at 7d.
  // Each wave gives the operator earlier feedback.

  if (daysSinceStart >= CONFIRMED_DAYS) {
    // Wave 4 (14+ days): high-confidence verdict
    if (
      citDeltaPct >= MIN_DELTA_PCT &&
      sustainedDirection(exp.timeline, "up", MIN_SUSTAINED_POINTS)
    ) {
      exp.status = "promising"; // Could upgrade to "confirmed" in future
    } else if (
      citDeltaPct <= -MIN_DELTA_PCT &&
      sustainedDirection(exp.timeline, "down", MIN_SUSTAINED_POINTS)
    ) {
      exp.status = "negative";
    } else if (daysSinceStart > INCONCLUSIVE_DAYS && Math.abs(citDeltaPct) < MIN_DELTA_PCT) {
      exp.status = "inconclusive";
    } else {
      exp.status = "watching";
    }
  } else if (daysSinceStart >= MIN_DAYS_FOR_VERDICT) {
    // Wave 3 (7-13 days): standard verdict
    if (
      citDeltaPct >= MIN_DELTA_PCT &&
      sustainedDirection(exp.timeline, "up", MIN_SUSTAINED_POINTS)
    ) {
      exp.status = "promising";
    } else if (
      citDeltaPct <= -MIN_DELTA_PCT &&
      sustainedDirection(exp.timeline, "down", MIN_SUSTAINED_POINTS)
    ) {
      exp.status = "negative";
    } else if (
      menDeltaPct >= MIN_DELTA_PCT * 2 &&
      citDeltaPct > -MIN_DELTA_PCT &&
      sustainedDirection(exp.timeline, "up", MIN_SUSTAINED_POINTS)
    ) {
      exp.status = "promising";
    } else {
      exp.status = "watching";
    }
  } else if (daysSinceStart >= BUILDING_SIGNAL_DAYS) {
    // Wave 2 (5-6 days): signal building — standard delta + 2 sustained
    if (
      citDeltaPct >= MIN_DELTA_PCT &&
      sustainedDirection(exp.timeline, "up", 2)
    ) {
      exp.status = "promising";
    } else if (
      citDeltaPct <= -MIN_DELTA_PCT &&
      sustainedDirection(exp.timeline, "down", 2)
    ) {
      exp.status = "negative";
    } else {
      exp.status = "watching";
    }
  } else if (daysSinceStart >= EARLY_SIGNAL_DAYS) {
    // Wave 1 (3-4 days): early signal — lower bar, any consistent direction
    if (citDeltaPct >= EARLY_SIGNAL_MIN_DELTA) {
      exp.status = "promising";
    } else if (citDeltaPct <= -EARLY_SIGNAL_MIN_DELTA) {
      exp.status = "negative";
    } else {
      exp.status = "watching";
    }
  } else {
    // Days 0-2: too early for any signal
    exp.status = "watching";
  }

  // Update confidence using evidence-based logic
  const sustained = sustainedDirection(exp.timeline, "up", MIN_SUSTAINED_POINTS)
    || sustainedDirection(exp.timeline, "down", MIN_SUSTAINED_POINTS);
  const conf = computeConfidence(exp, citDeltaPct, sustained);

  // Patch the latest timeline entry with final status and confidence
  const lastEntry = exp.timeline[exp.timeline.length - 1];
  if (lastEntry && lastEntry.date === today) {
    lastEntry.status = exp.status;
    lastEntry.confidence = conf;
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
