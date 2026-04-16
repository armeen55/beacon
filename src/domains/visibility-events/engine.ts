/**
 * Visibility Event Engine — main entry point.
 *
 * By E1.8 the engine owns the full pipeline. It no longer delegates to the
 * legacy `analyzeSpike` in spike-forensics.ts. Instead it reuses the
 * individual primitives that are still authoritative (detection math,
 * cluster labeling, cluster-burst aggregation, platform interpretation,
 * generateExplanation) and runs them in a single coherent pipeline with
 * the new primitives built in E1.2–E1.7.
 *
 * Pipeline:
 *   1. detectVisibilityEvents — scans snapshots for spikes across metrics
 *   2. buildVisibilityEventWindows — 1/3/7/14 windows + quality evidence
 *      (from outcomes / memory.ts) + learned temporal cap from patterns
 *   3. aggregateClusterBursts — per-window cluster aggregates
 *   4. attributeEventViaTriage — triage.ts-based candidate scoring, impact-
 *      weighted cluster aggregation, burst fallback, verdict derivation
 *   5. interpretPlatform — platform-specific interpretation style
 *   6. computeCrawlAlignment — most recent self-crawl before event
 *   7. generateExplanation — directional, never causal
 *   8. Decomposed confidence — detection / attribution / pattern_match
 *
 * All reused primitives are deliberate: the plan's rule is to reuse
 * existing scoring primitives rather than rewrite them.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import type { ChangePattern } from "@/domains/learning/change-patterns";
import type { ObservationRun } from "@/domains/observations/types";
import {
  detectSpikes,
  aggregateClusterBursts,
  interpretPlatform,
  generateExplanation,
} from "../forensics/spike-forensics";
import type {
  ClusterAttribution,
  PlatformInterpretation,
} from "../forensics/types";
import { attributeEventViaTriage } from "./attribute";
import { buildVisibilityEventWindows } from "./windowing";
import { computeCrawlAlignment } from "./crawl-alignment";
import { buildEventConfidence } from "./confidence";
import type {
  Spike,
  SpikeMetric,
  VisibilityEvent,
  CrawlAlignment,
  ImpactWeightedClusterAttribution,
  AttributionVerdict,
} from "./types";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect visibility events across all three metrics.
 *
 * Thin wrapper over `detectSpikes` for each metric type. Ordering by
 * peakDate keeps the newest events first. Future phases may classify
 * these into event types (spike / unlock / ramp) at E3; for now all
 * detected events are treated as spikes.
 */
export function detectVisibilityEvents(opts: {
  snapshots: DailyMetricSnapshot[];
}): Spike[] {
  const metrics: SpikeMetric[] = ["citations", "mentions", "visibility"];
  const all: Spike[] = [];
  for (const metric of metrics) {
    all.push(...detectSpikes({ snapshots: opts.snapshots, metric }));
  }
  return all.sort((a, b) => b.peakDate.localeCompare(a.peakDate));
}

const EMPTY_CRAWL_ALIGNMENT: CrawlAlignment = {
  runId: null,
  crawlCompletedAt: null,
  daysBeforeEvent: null,
};

// ---------------------------------------------------------------------------
// Legacy attribution adapter for explanation generation
// ---------------------------------------------------------------------------
// `generateExplanation` in spike-forensics.ts takes the legacy
// `ClusterAttribution[]` shape. Our new pipeline produces
// `ImpactWeightedClusterAttribution[]`. Convert the strict subset needed
// for explanation rendering — role, cluster, changeCount, primaryWindowDays,
// rationale. Impact scoring fields are not referenced by the explanation
// generator.

function toLegacyAttributionsForExplanation(
  attributions: ImpactWeightedClusterAttribution[],
): ClusterAttribution[] {
  return attributions.map((a) => ({
    cluster: a.cluster,
    role: a.role,
    changeCount: a.changeCount,
    primaryWindowDays: a.primaryWindowDays,
    rationale: a.rationale,
  }));
}

// ---------------------------------------------------------------------------
// Topic-scoping filter (mirrors legacy analyzeSpike behavior)
// ---------------------------------------------------------------------------
// `buildVisibilityEventWindows` applies scoping internally, so this is
// effectively a no-op for the new path. Kept in the pipeline layout as
// documentation of the operation.

// ---------------------------------------------------------------------------
// Full analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a single detected event — windows, clusters, attributions,
 * verdict, interpretation, confidence, explanation.
 *
 * As of E1.8 this function owns the pipeline and does NOT call the legacy
 * analyzeSpike. See module-level comment for pipeline details.
 */
export function analyzeVisibilityEvent(opts: {
  spike: Spike;
  changelog: ChangelogEntry[];
  /**
   * Pre-materialized change outcomes. When provided, used directly as the
   * quality-evidence source — no recomputation. This is the preferred
   * input for production calls where the import pipeline has already
   * materialized change-outcomes.json.
   */
  outcomes?: ChangeOutcome[];
  /**
   * Daily metric snapshots. Used as a fallback quality-evidence source
   * when `outcomes` is not provided — in that case the engine calls
   * `computeAllChangeInsights` from memory.ts to build the quality map.
   */
  snapshots?: DailyMetricSnapshot[];
  /**
   * Learned change patterns from change-patterns.ts. When provided, the
   * engine_timing rows drive per-change learned temporal windows that
   * replace the hardcoded 14-day cap in the windowing stage (E1.5), and
   * the success_rate rows drive per-change clusterWeights in the impact
   * scoring stage (E1.6).
   */
  patterns?: ChangePattern[];
  /**
   * Website crawl runs from the observation-runs store. When provided,
   * the engine computes a CrawlAlignment record showing the most recent
   * self-crawl completed BEFORE the event start (E1.7). This is surfaced
   * as context only — never used as an attribution input. Beacon does
   * not have access to LLM-side fetch timestamps (documented blind
   * spot in plan Part 10).
   */
  observationRuns?: ObservationRun[];
}): VisibilityEvent {
  // 1. Window the changelog around the spike.
  const windows = buildVisibilityEventWindows({
    spike: opts.spike,
    changelog: opts.changelog,
    snapshots: opts.snapshots,
    outcomes: opts.outcomes,
    patterns: opts.patterns,
  });

  // 2. Cluster-burst aggregates per window (reused from forensics).
  const clusterBursts = [
    { windowDays: 1, clusters: aggregateClusterBursts(windows.oneDay) },
    { windowDays: 3, clusters: aggregateClusterBursts(windows.threeDays) },
    { windowDays: 7, clusters: aggregateClusterBursts(windows.sevenDays) },
    { windowDays: 14, clusters: aggregateClusterBursts(windows.fourteenDays) },
  ];

  // 3. Triage-based attribution + impact-weighted cluster scoring.
  const changelogById = new Map(opts.changelog.map((c) => [c.id, c]));
  const { attributions, verdict } = attributeEventViaTriage({
    windowedChanges: windows.fourteenDays,
    spike: opts.spike,
    changelogById,
    qualityEvidence: windows.qualityEvidence,
    patterns: opts.patterns,
  });

  // 4. Platform interpretation (reused from forensics).
  const interpretation: PlatformInterpretation = interpretPlatform(
    opts.spike,
    verdict,
  );

  // 5. Crawl alignment context (E1.7).
  const crawlAlignment = opts.observationRuns
    ? computeCrawlAlignment({
        spike: opts.spike,
        observationRuns: opts.observationRuns,
      })
    : EMPTY_CRAWL_ALIGNMENT;

  // 6. Explanation — reuse legacy generator with an adapter layer.
  const legacyAttributions = toLegacyAttributionsForExplanation(attributions);
  const explanation = generateExplanation(
    opts.spike,
    legacyAttributions,
    verdict,
    interpretation,
  );

  // 7. Decomposed confidence (E1.9) — detection, attribution, and
  //    pattern_match each scored independently from their own inputs.
  //    pattern_match stays "none" until pattern memory ships in a later
  //    phase. Downstream consumers display all three separately.
  const confidence = buildEventConfidence({
    spike: opts.spike,
    attributions,
    verdict,
  });

  return {
    tenant_id: "", // CX1: filled by caller
    spike: opts.spike,
    windows: {
      oneDay: windows.oneDay,
      threeDays: windows.threeDays,
      sevenDays: windows.sevenDays,
      fourteenDays: windows.fourteenDays,
    },
    clusterBursts,
    attributions,
    verdict,
    interpretation,
    confidence,
    crawlAlignment,
    explanation,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience (visibility-events is now the canonical entry)
// ---------------------------------------------------------------------------

export type { Spike, VisibilityEvent };
export type { AttributionVerdict };
