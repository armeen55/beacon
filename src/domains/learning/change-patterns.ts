/**
 * Learning Loop 1: Change Pattern Recognition
 *
 * Groups change outcomes by signal_type × asset_type to detect
 * which types of changes reliably produce improvements.
 *
 * Passive — stored only, not consumed by UI or recommendations.
 * Runs after import pipeline (after change_outcomes are materialized).
 */

import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import type { ChangelogEntry } from "@/domains/changelog/types";
import { writeStore } from "@/lib/persistence/json-store";
import { syncChangePatterns } from "@/lib/persistence/dual-write";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** Intentionally no tenant_id — this is a global aggregate across all tenants. CX4 replaces with GlobalPattern. */
export type ChangePattern = {
  id: string; // `${signal_type}::${asset_type}`
  signal_type: string;
  asset_type: string;
  sample_count: number;
  success_count: number;
  success_rate: number; // 0-1
  avg_citation_delta: number; // avg % delta for improving outcomes
  avg_mention_delta: number;
  avg_days_to_signal: number; // avg days_after for improving outcomes
  platform_response: Record<
    string,
    { improving: number; total: number; rate: number }
  >;
  engine_timing: {
    platform: string;
    median_days: number;
    earliest_days: number;
    latest_days: number;
    sample_count: number;
  }[];
  confidence: "high" | "medium" | "low";
  computed_at: string;
};

// ---------------------------------------------------------------------------
// Noise guards
// ---------------------------------------------------------------------------

const MIN_DAYS_AFTER = 7;
const MIN_OBSERVATIONS_AFTER = 10;
const SUCCESS_CITATION_THRESHOLD = 10; // % delta to count as success
const SUCCESS_MENTION_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function isQualifiedOutcome(o: ChangeOutcome): boolean {
  return o.days_after >= MIN_DAYS_AFTER && o.observations_after >= MIN_OBSERVATIONS_AFTER;
}

function isSuccess(o: ChangeOutcome): boolean {
  return (
    o.direction === "improving" &&
    (o.citation_delta_pct >= SUCCESS_CITATION_THRESHOLD ||
      o.mention_delta_pct >= SUCCESS_MENTION_THRESHOLD)
  );
}

export function computeChangePatterns(
  outcomes: ChangeOutcome[],
  changes: ChangelogEntry[],
): ChangePattern[] {
  // Build change lookup
  const changeMap = new Map<string, ChangelogEntry>();
  for (const c of changes) changeMap.set(c.id, c);

  // Filter to qualified outcomes
  const qualified = outcomes.filter(isQualifiedOutcome);

  // Group by signal_type::asset_type
  const groups = new Map<
    string,
    { outcomes: ChangeOutcome[]; signal_type: string; asset_type: string }
  >();

  for (const o of qualified) {
    const change = changeMap.get(o.change_id);
    if (!change) continue;

    const key = `${change.signal_type}::${change.asset_type}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        outcomes: [],
        signal_type: change.signal_type,
        asset_type: change.asset_type,
      };
      groups.set(key, group);
    }
    group.outcomes.push(o);
  }

  const patterns: ChangePattern[] = [];

  for (const [id, group] of groups) {
    const { outcomes: groupOutcomes, signal_type, asset_type } = group;
    const sampleCount = groupOutcomes.length;
    const successes = groupOutcomes.filter(isSuccess);
    const successCount = successes.length;

    // Avg deltas for improving outcomes only
    const avgCitationDelta =
      successes.length > 0
        ? successes.reduce((a, o) => a + o.citation_delta_pct, 0) /
          successes.length
        : 0;
    const avgMentionDelta =
      successes.length > 0
        ? successes.reduce((a, o) => a + o.mention_delta_pct, 0) /
          successes.length
        : 0;
    const avgDaysToSignal =
      successes.length > 0
        ? Math.round(
            successes.reduce((a, o) => a + o.days_after, 0) /
              successes.length,
          )
        : 0;

    // Platform response breakdown
    const platformResponse: ChangePattern["platform_response"] = {};
    for (const o of groupOutcomes) {
      for (const [platform, deltas] of Object.entries(o.platform_deltas)) {
        if (!platformResponse[platform]) {
          platformResponse[platform] = { improving: 0, total: 0, rate: 0 };
        }
        platformResponse[platform].total++;
        // Check if this platform specifically improved
        const citBefore = deltas.citations_before;
        const citAfter = deltas.citations_after;
        if (citBefore > 0 && (citAfter - citBefore) / citBefore >= 0.15) {
          platformResponse[platform].improving++;
        } else if (citBefore === 0 && citAfter > 0) {
          platformResponse[platform].improving++;
        }
      }
    }
    for (const p of Object.values(platformResponse)) {
      p.rate = p.total > 0 ? Math.round((p.improving / p.total) * 100) / 100 : 0;
    }

    // Per-engine timing: collect days_after for improving outcomes per platform
    const platformTimingData = new Map<string, number[]>();
    for (const o of groupOutcomes) {
      for (const [platform, deltas] of Object.entries(o.platform_deltas)) {
        const citBefore = deltas.citations_before;
        const citAfter = deltas.citations_after;
        const isImproving =
          (citBefore > 0 && (citAfter - citBefore) / citBefore >= 0.15) ||
          (citBefore === 0 && citAfter > 0);
        if (isImproving) {
          const arr = platformTimingData.get(platform) ?? [];
          arr.push(o.days_after);
          platformTimingData.set(platform, arr);
        }
      }
    }
    const engineTiming: ChangePattern["engine_timing"] = [
      ...platformTimingData.entries(),
    ]
      .filter(([, days]) => days.length >= 2)
      .map(([platform, days]) => {
        const sorted = [...days].sort((a, b) => a - b);
        return {
          platform,
          median_days: sorted[Math.floor(sorted.length / 2)],
          earliest_days: sorted[0],
          latest_days: sorted[sorted.length - 1],
          sample_count: sorted.length,
        };
      });

    // Confidence level
    const confidence: ChangePattern["confidence"] =
      sampleCount >= 5 ? "high" : sampleCount >= 3 ? "medium" : "low";

    patterns.push({
      id,
      signal_type,
      asset_type,
      sample_count: sampleCount,
      success_count: successCount,
      success_rate:
        sampleCount > 0
          ? Math.round((successCount / sampleCount) * 100) / 100
          : 0,
      avg_citation_delta: Math.round(avgCitationDelta * 10) / 10,
      avg_mention_delta: Math.round(avgMentionDelta * 10) / 10,
      avg_days_to_signal: avgDaysToSignal,
      platform_response: platformResponse,
      engine_timing: engineTiming,
      confidence,
      computed_at: new Date().toISOString(),
    });
  }

  // Sort by success_rate descending
  patterns.sort((a, b) => b.success_rate - a.success_rate);

  return patterns;
}

// ---------------------------------------------------------------------------
// Materialization entry point
// ---------------------------------------------------------------------------

export async function materializeChangePatterns(
  outcomes: ChangeOutcome[],
  changes: ChangelogEntry[],
): Promise<ChangePattern[]> {
  const patterns = computeChangePatterns(outcomes, changes);
  await writeStore("change-patterns", patterns);
  await syncChangePatterns(patterns);
  return patterns;
}
