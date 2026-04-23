import "server-only";

/**
 * Derive `DailyMetricSnapshot[]` for a tenant's active tracked entities from a
 * single poll run's observations.
 *
 * Pure function. Zero writes. Zero DB reads. Caller provides everything it
 * needs and persists the returned rows via `syncDailyMetricSnapshots`.
 *
 * Why this exists: native polls currently only write to
 * `prompt_answer_observations` + `answer_texts` + `observation_runs`. The
 * `daily_metric_snapshots` table — which Today's per-entity/per-platform
 * product surfaces read from — stays frozen at the last Profound import
 * (2026-04-14 for Ritz). This helper is the smallest durable bridge between
 * raw native observations and that derived daily-state layer.
 *
 * v0 scope (intentionally narrow):
 * - emits one row per active tracked entity × (date, platform)
 * - populates unambiguous counts: mention_count, citation_count, total_possible
 * - leaves visibility_score / share_of_voice / avg_position as NULL because
 *   their canonical formulas aren't yet defined across platforms, and
 *   guessing would lock wrong numbers into historical data
 * - uses source_type "derived" to distinguish from Profound-era "benchmark"
 * - uses id prefix `derived-` so rows never collide with a future Profound
 *   re-import's `bench-` rows
 */

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { DailyMetricSnapshot } from "./types";

export type BuildDailySnapshotsArgs = {
  tenantId: string;
  /** Canonical platform label matching existing daily_metric_snapshots data (e.g., "Perplexity"). */
  platform: string;
  /** Observations produced by a single poll run. */
  observations: PromptAnswerObservation[];
  /** Tenant's tracked entities; only is_active entities get rows. */
  trackedEntities: TrackedEntity[];
  /** Snapshot date in YYYY-MM-DD (caller derives from observationRun.completed_at). */
  date: string;
  /** For provenance on the row's metadata. */
  observationRunId: string;
};

export function buildDailySnapshotsFromObservations(
  args: BuildDailySnapshotsArgs,
): DailyMetricSnapshot[] {
  const {
    tenantId,
    platform,
    observations,
    trackedEntities,
    date,
    observationRunId,
  } = args;

  const activeEntities = trackedEntities.filter((e) => e.is_active);
  const totalPossible = observations.length;
  const totalCitationsInRun = observations.reduce(
    (sum, o) => sum + (o.citation_count ?? 0),
    0,
  );
  const platformSlug = slugifyPlatform(platform);

  const rows: DailyMetricSnapshot[] = [];
  for (const entity of activeEntities) {
    const scopeId = entityToScopeId(entity);
    const id = `derived-${date}-${scopeId}-${platformSlug}`;

    const mentionCount = countMentions(observations, entity.name);
    const citationCount = countCitations(observations, entity.domain);

    // v0 formulas (endorsed Phase 3 Step 1):
    //   visibility_score = mention_rate × 100
    //     "percentage of prompts where this entity was mentioned in the answer"
    //     — honest mention-rate-derived visibility, not a fancier claim
    //   share_of_voice = entity_citations / total_citations_in_run × 100
    //     "of every citation slot in the run, what percentage went to this entity"
    //     — includes untracked-domain slots in the denominator so SOV naturally
    //     accounts for competitive and directory-dominated prompts
    //   Both null-safe when the respective denominator is 0.
    const visibilityScore =
      totalPossible > 0 ? roundTo2((mentionCount / totalPossible) * 100) : null;
    const shareOfVoice =
      totalCitationsInRun > 0
        ? roundTo2((citationCount / totalCitationsInRun) * 100)
        : null;

    rows.push({
      id,
      date,
      scope_type: "entity",
      scope_id: scopeId,
      platform,
      source_type: "derived",
      visibility_score: visibilityScore,
      mention_count: mentionCount,
      citation_count: citationCount,
      share_of_voice: shareOfVoice,
      avg_position: null, // Perplexity (and likely ChatGPT/Claude with web_search)
      // don't expose a native ranking position. Needs a dedicated
      // rank-detection pass to populate; explicitly deferred.
      total_possible: totalPossible,
      metadata: {
        source_system: "beacon_native",
        derived_from_run_id: observationRunId,
        entity_id: entity.id,
        entity_type: entity.entity_type,
        is_owned: entity.is_owned,
      },
      tenant_id: tenantId,
    });
  }

  return rows;
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Count observations in which the entity's canonical name appears in
 * `mentions[]`. The poll adapter already resolves aliases to canonical names
 * before writing, so this is an exact array membership check.
 */
function countMentions(
  observations: PromptAnswerObservation[],
  canonicalName: string,
): number {
  if (!canonicalName) return 0;
  let count = 0;
  for (const obs of observations) {
    if (obs.mentions.includes(canonicalName)) count += 1;
  }
  return count;
}

/**
 * Count observations citing the entity's domain. Case-insensitive exact match
 * against the `citation_domains[]` column (which the adapter writes already
 * lowercased).
 */
function countCitations(
  observations: PromptAnswerObservation[],
  domain: string | null,
): number {
  if (!domain) return 0;
  const needle = domain.toLowerCase();
  let count = 0;
  for (const obs of observations) {
    for (const cited of obs.citation_domains) {
      if (cited.toLowerCase() === needle) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/**
 * Derive scope_id from entity.id using the convention the existing Profound
 * rows follow: strip the known entity-type prefix and known TLD suffix.
 *
 * Examples:
 *   own-ritzbuilders-com       -> ritzbuilders
 *   comp-demattei-com          -> demattei
 *   comp-greenberg-construction -> greenberg-construction  (no TLD stripped)
 *   dir-homebuilderdigest-com  -> homebuilderdigest
 *
 * Only strips common internet TLDs — conservative. Anything not matching
 * passes through as-is so we never emit an empty scope_id.
 */
export function entityToScopeId(entity: TrackedEntity): string {
  const prefixStripped = entity.id.replace(/^(own|comp|dir|soc)-/, "");
  const tldStripped = prefixStripped.replace(
    /-(com|org|us|net|io|co|ai)$/,
    "",
  );
  return tldStripped || prefixStripped || entity.id;
}

/**
 * Normalize a platform label for use inside a deterministic ID:
 *   "Perplexity"          -> "perplexity"
 *   "Google AI Overviews" -> "google-ai-overviews"
 *   "ChatGPT"             -> "chatgpt"
 */
function slugifyPlatform(platform: string): string {
  return platform.toLowerCase().trim().replace(/\s+/g, "-");
}
