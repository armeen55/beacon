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
  // Section 6 C2 (2026-05-15). Per-scope count of observations where
  // `obs.primary_recommendation === true`. Populated on entity +
  // platform emit rows; topic emit rows force this to NULL per H8.
  // No prompt or account rows are emitted by this legacy importer
  // — see the buildDerivedSnapshots header comment.
  primary_recommendation: number;
};

/**
 * Build derived daily metric snapshots from raw prompt answer observations.
 * Produces snapshots at multiple scope levels:
 * - per topic × platform × date
 * - per platform × date (cross-topic)
 *
 * Section 6 C2 (2026-05-15) — primary_recommendation_count contract:
 *   • entity + platform emit rows populate the column from the
 *     per-scope accumulator.
 *   • topic emit rows explicitly set the column to NULL per the H8
 *     lock (no v1 consumer for topic-level primary share; locked
 *     NULL until a future phase introduces one).
 *   • This LEGACY Profound importer does NOT emit prompt-scope or
 *     account-scope rows. The native production builder
 *     (`src/domains/daily-metric-snapshots/build-from-observations.ts`)
 *     is the canonical source for prompt rows; account-scope is not
 *     materialized in C2 (derived at read time from platform rows
 *     per the C1.1 column comment correction). Missing prompt-scope
 *     rows from Profound imports are acceptable because Profound
 *     import is operator-triggered and the C3 backfill script
 *     handles legacy gaps.
 */
export function buildDerivedSnapshots(
  observations: PromptAnswerObservation[],
  ownedEntityId: string,
  tenantId: string,
): DailyMetricSnapshot[] {
  if (!tenantId) {
    throw new Error(
      "[buildDerivedSnapshots] tenantId required; pass currentTenantId() / BEACON_TENANT_ID from the calling orchestrator or script.",
    );
  }
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
        // Section 6 C2.
        primary_recommendation: 0,
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
    // Section 6 C2 — only true counts; false and null do not.
    const isPrimary = obs.primary_recommendation === true;

    const topicAcc = getOrCreate(date, "topic", topic, platform);
    topicAcc.total++;
    if (isMentioned) topicAcc.mentioned++;
    if (isCited) topicAcc.cited++;
    topicAcc.owned_cited += obs.owned_citation_count;
    topicAcc.citation_count += obs.citation_count;
    if (isPrimary) topicAcc.primary_recommendation++;
    if (obs.position !== null && isMentioned) {
      topicAcc.positions.push(obs.position);
    }

    const platformAcc = getOrCreate(date, "platform", platform, platform);
    platformAcc.total++;
    if (isMentioned) platformAcc.mentioned++;
    if (isCited) platformAcc.cited++;
    platformAcc.owned_cited += obs.owned_citation_count;
    platformAcc.citation_count += obs.citation_count;
    if (isPrimary) platformAcc.primary_recommendation++;
    if (obs.position !== null && isMentioned) {
      platformAcc.positions.push(obs.position);
    }

    const entityAcc = getOrCreate(date, "entity", ownedEntityId, platform);
    entityAcc.total++;
    if (isMentioned) entityAcc.mentioned++;
    if (isCited) entityAcc.cited++;
    entityAcc.owned_cited += obs.owned_citation_count;
    entityAcc.citation_count += obs.citation_count;
    if (isPrimary) entityAcc.primary_recommendation++;
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
      tenant_id: tenantId,
      // Section 6 C2 — topic-scope rows force NULL per H8 lock; entity
      // + platform scopes populate from the accumulator. The legacy
      // Profound importer does NOT emit prompt or account rows (see
      // header comment); only topic / entity / platform appear here.
      primary_recommendation_count:
        acc.scope_type === "topic" ? null : acc.primary_recommendation,
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
