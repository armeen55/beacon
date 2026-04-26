/**
 * Materialized change→outcome relationships.
 *
 * Persists the output of `computeMemoryInsights()` so learning systems
 * can query explicit before/after metric deltas per changelog entry
 * without recomputing on every read.
 *
 * Write trigger: import pipeline (after snapshots + indices are built).
 * Read: learning/intelligence layers (routes still use computeMemoryInsights).
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import {
  computeMemoryInsights,
  computeAllChangeInsights,
  type MemoryInsight,
} from "./memory";
import { writeStore } from "@/lib/persistence/json-store";
import { syncChangeOutcomes } from "@/lib/persistence/dual-write";
import { normalizeImpact } from "@/domains/global-patterns/contracts";
import { currentTenantId } from "@/lib/tenant-context";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export type ChangeOutcome = {
  id: string;
  change_id: string;
  topic_targeted: string;
  changed_at: string;
  direction: "improving" | "declining" | "stable";
  mention_delta_pct: number;
  citation_delta_pct: number;
  visibility_delta_pct: number;
  mentions_before: number;
  mentions_after: number;
  citations_before: number;
  citations_after: number;
  visibility_before: number;
  visibility_after: number;
  days_before: number;
  days_after: number;
  observations_before: number;
  observations_after: number;
  platform_deltas: Record<
    string,
    {
      mentions_before: number;
      mentions_after: number;
      citations_before: number;
      citations_after: number;
    }
  >;
  computed_at: string;
  /**
   * CX4.0 — Normalized citation delta. Adjusts for observation-count
   * inflation: when observations_after > observations_before * 1.5,
   * the raw delta is scaled by sqrt(before/after). One changelog entry
   * contributes exactly one outcome to the pattern engine, regardless
   * of how many prompts observed the change. Capped at [-95%, +500%].
   */
  normalized_citation_delta_pct: number;
  /** Raw (pre-normalization) value, kept for debugging. */
  raw_citation_delta_pct: number;
  /** Whether normalization was applied. */
  normalized: boolean;
  /** Owning tenant. */
  tenant_id: string;
};

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

function pctDelta(before: number, after: number): number {
  if (before === 0) return after > 0 ? 100 : 0;
  return Math.round(((after - before) / before) * 1000) / 10; // one decimal
}

// ---------------------------------------------------------------------------
// Transform MemoryInsight → ChangeOutcome
// ---------------------------------------------------------------------------

function insightToOutcome(insight: MemoryInsight): ChangeOutcome {
  // Count days before/after from trendLine relative to changeIndex
  const daysBefore =
    insight.changeIndex > 0 ? insight.changeIndex : 0;
  const daysAfter =
    insight.trendLine.length - insight.changeIndex - 1;

  // Transform platform breakdown
  const platformDeltas: ChangeOutcome["platform_deltas"] = {};
  for (const p of insight.platformBreakdown) {
    platformDeltas[p.platform] = {
      mentions_before: p.mentionsBefore,
      mentions_after: p.mentionsAfter,
      citations_before: p.citationsBefore,
      citations_after: p.citationsAfter,
    };
  }

  const rawCitationDelta = pctDelta(
    insight.metricsBefore.avgCitations,
    insight.metricsAfter.avgCitations,
  );
  const normalizedCitationDelta = normalizeImpact({
    raw_delta_pct: rawCitationDelta,
    observations_before: insight.metricsBefore.totalObservations,
    observations_after: insight.metricsAfter.totalObservations,
  });
  const wasNormalized = normalizedCitationDelta !== rawCitationDelta;

  return {
    id: insight.changeId,
    change_id: insight.changeId,
    topic_targeted: insight.topicTargeted,
    changed_at: insight.changedAt,
    direction: insight.direction,
    mention_delta_pct: pctDelta(
      insight.metricsBefore.avgMentions,
      insight.metricsAfter.avgMentions,
    ),
    citation_delta_pct: normalizedCitationDelta,
    visibility_delta_pct: pctDelta(
      insight.metricsBefore.avgVisibility,
      insight.metricsAfter.avgVisibility,
    ),
    mentions_before: insight.metricsBefore.avgMentions,
    mentions_after: insight.metricsAfter.avgMentions,
    citations_before: insight.metricsBefore.avgCitations,
    citations_after: insight.metricsAfter.avgCitations,
    visibility_before: insight.metricsBefore.avgVisibility,
    visibility_after: insight.metricsAfter.avgVisibility,
    days_before: daysBefore,
    days_after: daysAfter,
    observations_before: insight.metricsBefore.totalObservations,
    observations_after: insight.metricsAfter.totalObservations,
    platform_deltas: platformDeltas,
    computed_at: new Date().toISOString(),
    normalized_citation_delta_pct: normalizedCitationDelta,
    raw_citation_delta_pct: rawCitationDelta,
    normalized: wasNormalized,
    tenant_id: "",
  };
}

// ---------------------------------------------------------------------------
// Materialization entry point (per-topic deduped — for sparkline display)
// ---------------------------------------------------------------------------

export async function materializeChangeOutcomes(
  changes: ChangelogEntry[],
  snapshots: DailyMetricSnapshot[],
): Promise<ChangeOutcome[]> {
  // Phase 7.7b Commit 5 (2026-04-25): server-context tenant resolution.
  const tenantId = await currentTenantId();
  const insights = computeMemoryInsights({ changes, snapshots });
  const outcomes = insights.map(insightToOutcome);

  await writeStore("change-outcomes", outcomes);
  await syncChangeOutcomes(outcomes, tenantId);

  return outcomes;
}

// ---------------------------------------------------------------------------
// Per-change materialization (no dedup — for learning system)
// ---------------------------------------------------------------------------

/**
 * Produces one ChangeOutcome per changelog entry that has sufficient
 * before/after snapshot data. Unlike materializeChangeOutcomes, this
 * does NOT deduplicate by topic — every change gets its own outcome
 * so the learning system can evaluate signal effectiveness per-change.
 */
export async function materializePerChangeOutcomes(
  changes: ChangelogEntry[],
  snapshots: DailyMetricSnapshot[],
): Promise<ChangeOutcome[]> {
  // Phase 7.7b Commit 5 (2026-04-25): server-context tenant resolution.
  const tenantId = await currentTenantId();
  // Use computeAllChangeInsights which skips the topic dedup
  const insights = computeAllChangeInsights({ changes, snapshots });
  const outcomes = insights.map(insightToOutcome);

  await writeStore("change-outcomes", outcomes);
  await syncChangeOutcomes(outcomes, tenantId);

  return outcomes;
}
