/**
 * Derives DailyMetricSnapshots from canonical PromptAnswerObservations.
 *
 * Beacon computes its own visibility metrics from raw observations:
 * - mention_rate = mentioned / total_executions per scope
 * - citation_rate = cited / total_executions per scope
 * - avg_position = mean of positions where brand was mentioned
 *
 * These are "derived" snapshots, separate from "benchmark" snapshots
 * imported from Profound's summarized export.
 */

import "server-only";

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

type ScopeKey = string;

function scopeKey(
  date: string,
  scopeType: string,
  scopeId: string,
  platform: string
): ScopeKey {
  return `${date}|${scopeType}|${scopeId}|${platform}`;
}

type Accumulator = {
  date: string;
  scope_type: "prompt" | "topic" | "entity" | "platform";
  scope_id: string;
  platform: string;
  total: number;
  mentioned: number;
  cited: number;
  owned_cited: number;
  positions: number[];
  citation_count: number;
};

/**
 * Build derived daily metric snapshots from raw prompt answer observations.
 * Produces snapshots at multiple scope levels:
 * - per topic × platform × date
 * - per platform × date (cross-topic)
 */
export function buildDerivedSnapshots(
  observations: PromptAnswerObservation[],
  ownedEntityId: string
): DailyMetricSnapshot[] {
  const accumulators = new Map<ScopeKey, Accumulator>();

  function getOrCreate(
    date: string,
    scopeType: "prompt" | "topic" | "entity" | "platform",
    scopeId: string,
    platform: string
  ): Accumulator {
    const key = scopeKey(date, scopeType, scopeId, platform);
    let acc = accumulators.get(key);
    if (!acc) {
      acc = {
        date,
        scope_type: scopeType,
        scope_id: scopeId,
        platform,
        total: 0,
        mentioned: 0,
        cited: 0,
        owned_cited: 0,
        positions: [],
        citation_count: 0,
      };
      accumulators.set(key, acc);
    }
    return acc;
  }

  for (const obs of observations) {
    const date = obs.observed_at.slice(0, 10);
    const platform = obs.platform;
    const topic = obs.topic || "unknown";
    const isMentioned = obs.tracked_brand_mentioned === true;
    const isCited = obs.tracked_brand_cited === true;

    const topicAcc = getOrCreate(date, "topic", topic, platform);
    topicAcc.total++;
    if (isMentioned) topicAcc.mentioned++;
    if (isCited) topicAcc.cited++;
    topicAcc.owned_cited += obs.owned_citation_count;
    topicAcc.citation_count += obs.citation_count;
    if (obs.position !== null && isMentioned) {
      topicAcc.positions.push(obs.position);
    }

    const platformAcc = getOrCreate(date, "platform", platform, platform);
    platformAcc.total++;
    if (isMentioned) platformAcc.mentioned++;
    if (isCited) platformAcc.cited++;
    platformAcc.owned_cited += obs.owned_citation_count;
    platformAcc.citation_count += obs.citation_count;
    if (obs.position !== null && isMentioned) {
      platformAcc.positions.push(obs.position);
    }

    const entityAcc = getOrCreate(date, "entity", ownedEntityId, platform);
    entityAcc.total++;
    if (isMentioned) entityAcc.mentioned++;
    if (isCited) entityAcc.cited++;
    entityAcc.owned_cited += obs.owned_citation_count;
    entityAcc.citation_count += obs.citation_count;
    if (obs.position !== null && isMentioned) {
      entityAcc.positions.push(obs.position);
    }
  }

  const snapshots: DailyMetricSnapshot[] = [];

  for (const acc of accumulators.values()) {
    const visibility =
      acc.total > 0
        ? Math.round((acc.mentioned / acc.total) * 10000) / 100
        : null;

    const avgPos =
      acc.positions.length > 0
        ? Math.round(
            (acc.positions.reduce((a, b) => a + b, 0) / acc.positions.length) *
              10
          ) / 10
        : null;

    const sov =
      acc.total > 0
        ? Math.round((acc.owned_cited / acc.citation_count || 0) * 10000) / 100
        : null;

    const id = `derived-${acc.date}-${slugify(acc.scope_type)}-${slugify(acc.scope_id)}-${slugify(acc.platform)}`;

    snapshots.push({
      id,
      date: acc.date,
      scope_type: acc.scope_type,
      scope_id: acc.scope_id,
      platform: acc.platform,
      source_type: "derived",
      visibility_score: visibility,
      mention_count: acc.mentioned,
      citation_count: acc.owned_cited,
      share_of_voice: sov,
      avg_position: avgPos,
      total_possible: acc.total,
      metadata: {
        total_citations_all_sources: acc.citation_count,
        cited_count: acc.cited,
      },
    });
  }

  return snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
