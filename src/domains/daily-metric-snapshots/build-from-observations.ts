import "server-only";

/**
 * Derive `DailyMetricSnapshot[]` rows for a tenant's active tracked entities
 * PLUS per-topic rollup rows PLUS a platform aggregate row, from a single
 * poll run's observations.
 *
 * Pure function. Zero writes. Zero DB reads. Caller provides everything it
 * needs and persists the returned rows via `syncDailyMetricSnapshots`.
 *
 * ## What this helper emits
 *
 * **Per-entity rows** (one per active tracked entity):
 *   - scope_type = "entity", scope_id = slugified entity id
 *   - metrics are PER-ENTITY (mention_count = # obs where entity appeared in
 *     mentions[]; citation_count = # obs where entity.domain appeared)
 *   - drives the competitive comparison panel
 *
 * **Per-topic rows** (one per distinct topic encountered in the run):
 *   - scope_type = "topic", scope_id = topic (empty topic → "unknown")
 *   - metrics are OWNED-BRAND ROLLUPS across that topic's observations:
 *     how visible is THE TENANT on this topic. NOT competitive totals.
 *   - drives "my visibility on recommendation prompts" / "on comparison
 *     prompts" kinds of surfaces
 *
 * **One platform aggregate row** (emitted only when observations is non-empty):
 *   - scope_type = "platform", scope_id = platform
 *   - metrics are OWNED-BRAND ROLLUPS across the whole run: the headline
 *     "overall Perplexity visibility today" number. NOT a competitive total.
 *   - drives the platform-scope trend line and the single-platform daily
 *     headline score
 *
 * Topic + platform rows explicitly do NOT emit per-competitor rollups at those
 * scopes. A competitor's topic-level visibility is a separate product concern
 * (shared-brain territory) and is out of scope here.
 *
 * ## Formulas (v0, endorsed Phase 3 Step 1)
 *
 *   visibility_score = (mention_count / total_possible) × 100
 *   share_of_voice   = (citation_count / total_citations_in_scope) × 100
 *   avg_position     = null   (Perplexity/ChatGPT/Claude web_search don't
 *                               expose native rank; needs separate phase)
 *
 * Both scores are null-safe when their denominator is 0.
 *
 * ## ID conventions (known asymmetry — intentional for now)
 *
 *   entity:   derived-{date}-{scope-id-slug}-{platform-slug}
 *   topic:    derived-{date}-topic-{topic-slug}-{platform-slug}
 *   platform: derived-{date}-platform-{platform-slug}
 *
 * The entity-row IDs do NOT contain "entity" as a segment — they predate
 * Step 2's multi-scope emission and were not migrated to preserve idempotency
 * of prior backfills. Topic + platform IDs include their scope_type as a
 * segment to disambiguate cleanly from entity IDs (and from each other).
 * Filtering consumers should use the `scope_type` column, not ID parsing.
 * Unifying to a single `derived-{date}-{scope-type}-{slug}-{platform}` form
 * is deferred until the existing Profound-path snapshot-builder is retired.
 *
 * ## Source-type + ID-prefix
 *
 * - source_type = "derived" distinguishes native-computed rows from Profound-
 *   era "benchmark" rows.
 * - id prefix "derived-" never collides with a future Profound re-import's
 *   "bench-" rows.
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
  const platformSlug = slugifyForId(platform);

  const rows: DailyMetricSnapshot[] = [];

  // ── Per-entity rows (competitive panel) ─────────────────────────────
  // One row per active tracked entity. Metrics are PER-ENTITY.
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

    // Phase 2A (2026-05-19) — Today read-model extensions.
    // See `daily-metric-snapshots/types.ts` field docstrings for the
    // formula rationale and the chart functions each reproduces.
    const mentionedObsCount = countMentionedObs(observations, entity);
    const positionWeightedCitationCount = entity.is_owned
      ? sumPositionWeightedBrandCitations(observations)
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
      // Phase 2A read-model extensions — null on platform/topic rows.
      cited_or_mentioned_count: null,
      position_weighted_citation_count: positionWeightedCitationCount,
      mentioned_obs_count: mentionedObsCount,
      // Section 6 C2 — populated on the owned-brand entity row;
      // null on competitor entity rows (primary recommendation is
      // a my-brand concept; mirrors `position_weighted_citation_count`
      // precedent).
      primary_recommendation_count: entity.is_owned
        ? countPrimaryRecommendationObs(observations)
        : null,
    });
  }

  // ── Per-topic rows (OWNED-BRAND rollups, not competitive totals) ─────
  // One row per distinct topic encountered in the run. Metrics describe
  // how visible THE TENANT is on this topic — mention_count is owned-brand
  // mentions only, citation_count is owned-brand citations only.
  const observationsByTopic = new Map<string, PromptAnswerObservation[]>();
  for (const obs of observations) {
    const topicKey = obs.topic || "unknown";
    let bucket = observationsByTopic.get(topicKey);
    if (!bucket) {
      bucket = [];
      observationsByTopic.set(topicKey, bucket);
    }
    bucket.push(obs);
  }

  for (const [topicKey, topicObs] of observationsByTopic) {
    const topicTotal = topicObs.length;
    const topicOwnedMentions = topicObs.filter(
      (o) => o.tracked_brand_mentioned,
    ).length;
    const topicOwnedCitations = topicObs.reduce(
      (sum, o) => sum + (o.owned_citation_count ?? 0),
      0,
    );
    const topicTotalCitations = topicObs.reduce(
      (sum, o) => sum + (o.citation_count ?? 0),
      0,
    );

    const topicSlug = slugifyForId(topicKey);
    const id = `derived-${date}-topic-${topicSlug}-${platformSlug}`;

    const vs =
      topicTotal > 0
        ? roundTo2((topicOwnedMentions / topicTotal) * 100)
        : null;
    const sov =
      topicTotalCitations > 0
        ? roundTo2((topicOwnedCitations / topicTotalCitations) * 100)
        : null;

    rows.push({
      id,
      date,
      scope_type: "topic",
      scope_id: topicKey,
      platform,
      source_type: "derived",
      visibility_score: vs,
      mention_count: topicOwnedMentions,
      citation_count: topicOwnedCitations,
      share_of_voice: sov,
      avg_position: null,
      total_possible: topicTotal,
      metadata: {
        source_system: "beacon_native",
        derived_from_run_id: observationRunId,
        scope_semantics: "owned_brand_rollup",
      },
      tenant_id: tenantId,
      // Phase 2A read-model extensions — null on topic rows. The Today
      // visibility section reads platform + entity rows, not topic, so
      // populating these on topic rows would add storage cost with no
      // consumer. Phase 2B can revisit if topic-level visibility surfaces
      // ever need the chart-equivalent formulas.
      cited_or_mentioned_count: null,
      position_weighted_citation_count: null,
      mentioned_obs_count: null,
      // Section 6 C2 — H8 lock: topic-scope rows MUST carry explicit
      // null. No v1 consumer for topic-level primary share; pinned
      // by `tests/architecture/snapshot-builder-topic-null-primary-rec.test.ts`.
      primary_recommendation_count: null,
    });
  }

  // ── Per-prompt rows (OWNED-BRAND rollups, one per distinct prompt_id) ─
  // Section 6 C2 (2026-05-15). Per-prompt-per-platform owned-brand
  // rollups. Populated for the Section 6 C2 contract per the C1.1
  // column comment: `primary_recommendation_count` materialized here
  // so the future Prompts detail surface (C5) can read per-prompt
  // primary share without re-walking raw observations. Other
  // denominator fields (mention/citation/total) populated for
  // completeness so C5 doesn't need to re-extend the builder.
  //
  // scope_id is the prompt_id VERBATIM (not slugified) — same pattern
  // as `topic` rows above where scope_id is the topic key verbatim.
  // The ID composition slugifies only for the `id` field; scope_id
  // remains the raw lookup key downstream consumers join against.
  const observationsByPrompt = new Map<string, PromptAnswerObservation[]>();
  for (const obs of observations) {
    let bucket = observationsByPrompt.get(obs.prompt_id);
    if (!bucket) {
      bucket = [];
      observationsByPrompt.set(obs.prompt_id, bucket);
    }
    bucket.push(obs);
  }

  for (const [promptId, promptObs] of observationsByPrompt) {
    const promptTotal = promptObs.length;
    const promptOwnedMentions = promptObs.filter(
      (o) => o.tracked_brand_mentioned,
    ).length;
    const promptOwnedCitations = promptObs.reduce(
      (sum, o) => sum + (o.owned_citation_count ?? 0),
      0,
    );
    const promptTotalCitations = promptObs.reduce(
      (sum, o) => sum + (o.citation_count ?? 0),
      0,
    );
    const promptPrimary = countPrimaryRecommendationObs(promptObs);

    const promptIdSlug = slugifyForId(promptId);
    const id = `derived-${date}-prompt-${promptIdSlug}-${platformSlug}`;

    const vs =
      promptTotal > 0
        ? roundTo2((promptOwnedMentions / promptTotal) * 100)
        : null;
    const sov =
      promptTotalCitations > 0
        ? roundTo2((promptOwnedCitations / promptTotalCitations) * 100)
        : null;

    rows.push({
      id,
      date,
      scope_type: "prompt",
      scope_id: promptId,
      platform,
      source_type: "derived",
      visibility_score: vs,
      mention_count: promptOwnedMentions,
      citation_count: promptOwnedCitations,
      share_of_voice: sov,
      avg_position: null,
      total_possible: promptTotal,
      metadata: {
        source_system: "beacon_native",
        derived_from_run_id: observationRunId,
        scope_semantics: "per_prompt_owned_brand_rollup",
        prompt_id: promptId,
      },
      tenant_id: tenantId,
      // Phase 2A read-model extensions — explicit null on prompt rows.
      // The Today visibility section reads platform + entity, not
      // prompt; populating these here would add storage cost with no
      // consumer in v1.
      cited_or_mentioned_count: null,
      position_weighted_citation_count: null,
      mentioned_obs_count: null,
      // Section 6 C2 — populated per the C1.1 column contract.
      primary_recommendation_count: promptPrimary,
    });
  }

  // ── Platform aggregate row (OWNED-BRAND rollup, run-wide) ────────────
  // A single row summarizing the tenant's owned-brand visibility across
  // the whole run on this platform. This IS the "overall Perplexity
  // visibility today" headline number for the tenant. NOT a cross-entity
  // competitive total. Skipped for empty runs (no observations to report).
  if (observations.length > 0) {
    const platformOwnedMentions = observations.filter(
      (o) => o.tracked_brand_mentioned,
    ).length;
    const platformOwnedCitations = observations.reduce(
      (sum, o) => sum + (o.owned_citation_count ?? 0),
      0,
    );

    const id = `derived-${date}-platform-${platformSlug}`;

    const vs =
      totalPossible > 0
        ? roundTo2((platformOwnedMentions / totalPossible) * 100)
        : null;
    const sov =
      totalCitationsInRun > 0
        ? roundTo2((platformOwnedCitations / totalCitationsInRun) * 100)
        : null;

    // Phase 2A (2026-05-19) — per-platform cited-OR-mentioned union.
    // Formula matches `computeVisibilityTimeSeriesByPlatform` /
    // `mentionsBrand` || `citesBrand` (visibility-score.ts:144 / 159).
    // Stored alongside the existing mention_count + citation_count so
    // the Phase 2B read-model loader can reproduce the chart's per-
    // platform view without re-reading raw observations.
    const platformCitedOrMentioned = observations.filter(
      (o) =>
        o.tracked_brand_cited === true || o.tracked_brand_mentioned === true,
    ).length;
    const platformCitedObservations = observations.filter(
      (o) => o.tracked_brand_cited === true,
    ).length;

    rows.push({
      id,
      date,
      scope_type: "platform",
      scope_id: platform,
      platform,
      source_type: "derived",
      visibility_score: vs,
      mention_count: platformOwnedMentions,
      citation_count: platformOwnedCitations,
      share_of_voice: sov,
      avg_position: null,
      total_possible: totalPossible,
      metadata: {
        source_system: "beacon_native",
        derived_from_run_id: observationRunId,
        scope_semantics: "owned_brand_rollup",
        // Stored inside the existing metadata column so this correctness fix
        // deploys safely without depending on a hosted schema migration.
        cited_obs_count: platformCitedObservations,
      },
      tenant_id: tenantId,
      // Phase 2A read-model extensions. `cited_or_mentioned_count` is
      // the headline addition for platform rows. The two entity-only
      // fields stay null here — they live on entity rows.
      cited_or_mentioned_count: platformCitedOrMentioned,
      cited_obs_count: platformCitedObservations,
      position_weighted_citation_count: null,
      mentioned_obs_count: null,
      // Section 6 C2 — populated on the platform aggregate row.
      // Same run-wide count as the owned-brand entity row (both are
      // views of the same observations); customer-facing Today hero
      // (C4) sources per-platform primary share from this column.
      primary_recommendation_count: countPrimaryRecommendationObs(observations),
    });
  }

  return rows;
}

/**
 * Section 6 C2 (2026-05-15) — count of observations where the AI
 * marked the owned brand as the primary recommended option. Mirrors
 * the `sumPositionWeightedBrandCitations` precedent — owned-brand-only
 * signal aggregated from a per-observation flag.
 *
 * Semantics (operator-locked, see
 * `src/domains/daily-metric-snapshots/types.ts` docstring on
 * `primary_recommendation_count`):
 *   • `obs.primary_recommendation === true`  → counts +1
 *   • `obs.primary_recommendation === false` → counts +0
 *   • `obs.primary_recommendation == null`   → counts +0
 *
 * The customer-facing copy (Section 6 H1 LOCKED tooltip) never
 * exposes the underlying heuristic; this helper materializes the
 * boolean signal as a count, nothing more.
 */
function countPrimaryRecommendationObs(
  observations: PromptAnswerObservation[],
): number {
  let count = 0;
  for (const obs of observations) {
    if (obs.primary_recommendation === true) count += 1;
  }
  return count;
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

// ─────────────────────────────────────────────────────────────────────
// Phase 2A (2026-05-19) — Today read-model helpers.
// Each mirrors a specific formula in `src/domains/product/visibility-
// score.ts` so the snapshot rows can reproduce the chart + leaderboard
// numbers exactly. Kept in this file (not imported from visibility-
// score.ts) so the snapshot builder stays a pure standalone module —
// the poll pipeline imports this file but not the rest of the product
// engine.
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalize an entity name into a comparison slug. Mirrors `slugifyEntity`
 * in visibility-score.ts:95 — lowercase, whitespace-collapsed. Used by
 * `countMentionedObs` to match the chart's slug-aware mention matching.
 */
function slugifyEntityForMatch(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Position weight applied to a single cited observation. Mirrors
 * `citationPositionWeight` in visibility-score.ts:133. The leaderboard
 * uses this to spread citation_rate semantically — a #1 citation is
 * worth 4× more than a #7+ citation. The chart's per-day time series
 * does NOT use position weighting; only the leaderboard / aggregateWindow
 * does. Kept in lockstep with the chart helper so the two stay aligned
 * if the weight schedule ever changes.
 *
 *   pos 1-3  → 1.0   (top-of-answer)
 *   pos 4-6  → 0.5   (mid-answer)
 *   pos 7+   → 0.25  (deep citation)
 *   unknown  → 0.5   (default for missing position data)
 */
function citationPositionWeight(position: number | null | undefined): number {
  if (position == null) return 0.5;
  if (position <= 3) return 1.0;
  if (position <= 6) return 0.5;
  return 0.25;
}

/**
 * Sum of `citationPositionWeight(obs.position)` across observations where
 * the tenant's owned brand was cited. Drives the leaderboard's brand
 * `citation_rate` formula via `brandCitationWeightSum / totalInWindow`
 * (visibility-score.ts:580).
 *
 * Stored ONLY on owned-brand entity-scope rows. Null on competitor entity
 * rows because the current Today semantics don't track position-weighted
 * citations for competitors (the chart treats cited == mentioned for
 * competitors — see countMentionedObs below).
 */
function sumPositionWeightedBrandCitations(
  observations: PromptAnswerObservation[],
): number {
  let sum = 0;
  for (const obs of observations) {
    if (obs.tracked_brand_cited !== true) continue;
    sum += citationPositionWeight(obs.position);
  }
  return sum;
}

/**
 * Count observations where the entity was "mentioned" per the chart's
 * formula (visibility-score.ts:144 `mentionsBrand` for owned, line 247
 * `mentionsSlugs.has(competitorSlug)` for competitor).
 *
 *   Owned brand: `tracked_brand_mentioned === true` OR slugified
 *     `obs.mentions` contains the entity's canonical slug. The flag
 *     fast-path matches the chart's primary branch; the slug fallback
 *     covers the alias path.
 *
 *   Competitor: slugified `obs.mentions` contains the entity's
 *     canonical slug.
 *
 * Different from the existing `countMentions(obs, entity.name)` helper
 * which uses exact-string `mentions.includes(name)` — kept distinct so
 * downstream consumers reading `mention_count` see no change while the
 * Phase 2B read-model loader gets a chart-equivalent count from
 * `mentioned_obs_count`.
 */
function countMentionedObs(
  observations: PromptAnswerObservation[],
  entity: TrackedEntity,
): number {
  const targetSlug = slugifyEntityForMatch(entity.name);
  if (!targetSlug) return 0;

  let count = 0;
  for (const obs of observations) {
    if (entity.is_owned && obs.tracked_brand_mentioned === true) {
      count += 1;
      continue;
    }
    const mentions = obs.mentions ?? [];
    for (const m of mentions) {
      if (slugifyEntityForMatch(m) === targetSlug) {
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
 * Normalize a string for use inside a deterministic ID. Lowercase, whitespace
 * collapsed to hyphens, non-alphanumeric chars replaced with hyphens, leading
 * and trailing hyphens trimmed. Used for both platform labels and topic keys.
 *
 *   "Perplexity"           -> "perplexity"
 *   "Google AI Overviews"  -> "google-ai-overviews"
 *   "ChatGPT"              -> "chatgpt"
 *   "topic-builders"       -> "topic-builders"
 *   "  Local / Services  " -> "local-services"
 */
function slugifyForId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
