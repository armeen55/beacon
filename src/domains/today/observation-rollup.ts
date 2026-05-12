/**
 * Perf bundle 3 (2026-05-12) — per-request observation rollup.
 *
 * `/today` re-buckets the same ~14k-row observation array 10–15+ times per
 * render: `computeLeaderboard` × 12 (3 metrics × 4 windows),
 * `computeVisibilityTimeSeries` × 3 (per metric), `computeCompetitorSeries`
 * × 3 (each fans out 5 competitor series inside), and
 * `computeVisibilityTimeSeriesByPlatform` × 1. The measurement pass
 * attributed ~500–700 ms of /today's 947 ms warm render to these
 * repeated passes.
 *
 * This module builds ONE indexed structure from the observation array per
 * request. All downstream compute functions accept it as an optional
 * `rollup` argument and read from it in O(date-window × entity-count)
 * instead of O(observations × call-count).
 *
 * Design constraints:
 *   • Pure function — no I/O, no Supabase, no global cache.
 *   • Per-request only — the caller builds it once and discards it after
 *     the render. We never store it in module scope (each request must
 *     see fresh data, and tenant isolation comes from the caller passing
 *     only its tenant's observations).
 *   • Inputs are NEVER mutated. The rollup holds only derived data.
 *   • Memory bounded: ~5 platforms × ~60 dates × ~40 entities ≈ 12 K
 *     small objects ≈ <500 KB heap per render.
 *
 * What the rollup DOES NOT pre-compute:
 *   • Position-weighted citation rate is pre-summed per-date as
 *     `brandCitationWeightSum`; the leaderboard divides by `total` to
 *     get the position-weighted brand citation rate.
 *   • Competitor `rawMentions` (sum of occurrences across `mentions[]`)
 *     AND `dedupedMentions` (1 per obs where slug appears) are both
 *     stored because `computeLeaderboard` and `computeVisibilityTimeSeries`
 *     use different counting semantics — preserving both exactly
 *     matches today's wire output.
 *
 * What is OUT OF SCOPE for this bundle:
 *   • `buildPromptDecisionMatrix` — different walk shape (per-prompt
 *     window logic); deferred to a separate refactor.
 *   • `buildQueryKeywordIndex` — walks observations × citation index;
 *     deferred.
 *   • `computeCitationDecay` — reads citation-evidence-index, not
 *     observations.
 *   • `computeRecommendations` — risk of semantic drift; left untouched.
 *   • Inline /today enrichment rollups — out of scope for this bundle.
 */

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-(date, platform) aggregates for the brand. */
export type RollupPlatformDateBrand = Readonly<{
  /** Observations in this (platform, date) bucket. Denominator for
   *  per-platform rate. */
  obs: number;
  /** Obs where the brand was mentioned (via `tracked_brand_mentioned`
   *  flag or alias hit in `mentions[]`). */
  brandMentioned: number;
  /** Obs where the brand was cited (`tracked_brand_cited === true`). */
  brandCited: number;
  /** Obs where the brand was either mentioned OR cited — used by the
   *  per-platform chart variant (`computeVisibilityTimeSeriesByPlatform`). */
  brandCitedOrMentioned: number;
}>;

/** Per-date aggregates rolled up across all platforms. */
export type RollupDateBucket = Readonly<{
  /** Total observations on this date (bucket.length). */
  total: number;
  /** Obs where the brand was mentioned. */
  brandMentioned: number;
  /** Obs where the brand was cited (raw — no position weight). */
  brandCited: number;
  /** Sum of `citationPositionWeight(cited, position)` across this date's
   *  observations. The leaderboard's brand citation rate divides this by
   *  `total` to get a 0–100 number. */
  brandCitationWeightSum: number;
  /** Per-platform breakdown (used for the time-series composite metric). */
  perPlatform: ReadonlyMap<string, RollupPlatformDateBrand>;
}>;

/** Per-(entity-slug, date) competitor bucket. Brand is NEVER stored here —
 *  brand goes through `byDate`. */
export type RollupEntityDateBucket = Readonly<{
  /** Number of observations on this date where the slug appears in
   *  `obs.mentions[]` at least once (per-obs dedupe). Used by
   *  `computeVisibilityTimeSeries` competitor path. */
  dedupedMentions: number;
  /** Sum of slug occurrences across `obs.mentions[]` arrays for this
   *  date. Multiple appearances within one obs each contribute. Used
   *  by `computeLeaderboard`. */
  rawMentions: number;
  /** Per-platform deduped mentions (1 per obs). Used by the competitor
   *  path of `computeVisibilityTimeSeries` for the composite metric. */
  perPlatform: ReadonlyMap<string, number>;
  /** Smallest index in the original `observations` array where this
   *  (slug, date) was mentioned. Used by `aggregateWindowFromRollup` to
   *  reproduce the direct path's window-bound entity insertion order
   *  so leaderboard outputs are byte-identical between paths even when
   *  multiple entities tie on score. */
  firstObsIndex: number;
}>;

export type ObservationRollup = Readonly<{
  /** Distinct YYYY-MM-DD dates with ≥1 observation. Sorted ascending. */
  sampledDates: ReadonlyArray<string>;
  /** Set form of `sampledDates` for O(1) membership. */
  sampledDateSet: ReadonlySet<string>;

  /** Per-date aggregates. */
  byDate: ReadonlyMap<string, RollupDateBucket>;

  /** Per-entity-slug → per-date bucket. Brand absent. */
  byEntityDate: ReadonlyMap<string, ReadonlyMap<string, RollupEntityDateBucket>>;

  /** Display name (first observed) for each entity slug. */
  entityNameBySlug: ReadonlyMap<string, string>;

  /** Brand aliases the rollup was built with (echoed for callers that
   *  want to verify before reading). */
  brandAliases: ReadonlyArray<string>;
  /** Set of `slugifyEntity(alias)` for fast brand-alias membership. */
  brandSlugs: ReadonlySet<string>;

  /** Total observations the rollup was built from. */
  totalObservations: number;
}>;

// ---------------------------------------------------------------------------
// Helpers (must match `visibility-score.ts` exactly — single source of
// truth lives THERE; we re-implement here only because they're private
// over there. Equivalence tests pin them.)
// ---------------------------------------------------------------------------

/** Normalize an entity name to a stable slug for comparison.
 *  MUST match `visibility-score.ts:slugifyEntity`. */
export function slugifyEntity(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Extract YYYY-MM-DD from an ISO timestamp.
 *  MUST match `visibility-score.ts:dateOnly`. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Position-weight for a single cited observation.
 * MUST match `visibility-score.ts:citationPositionWeight`.
 *
 *   pos 1–3  → 1.0
 *   pos 4–6  → 0.5
 *   pos 7+   → 0.25
 *   unknown  → 0.5  (when cited but position is null/undefined)
 *   not cited → 0
 */
function citationPositionWeight(
  cited: boolean,
  position: number | null | undefined,
): number {
  if (!cited) return 0;
  if (position == null) return 0.5;
  if (position <= 3) return 1.0;
  if (position <= 6) return 0.5;
  return 0.25;
}

/** Does any brand alias appear in this obs?
 *  MUST match `visibility-score.ts:mentionsBrand`. */
function mentionsBrand(
  obs: PromptAnswerObservation,
  brandSlugs: ReadonlySet<string>,
): boolean {
  if (obs.tracked_brand_mentioned === true) return true;
  for (const m of obs.mentions ?? []) {
    if (brandSlugs.has(slugifyEntity(m))) return true;
  }
  return false;
}

/** Does the obs cite the brand? MUST match `visibility-score.ts:citesBrand`. */
function citesBrand(obs: PromptAnswerObservation): boolean {
  return obs.tracked_brand_cited === true;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a per-request observation rollup. Pure: no I/O, no mutation of
 * inputs, no module-level cache.
 *
 * Call site convention: build ONCE per `/today` (or per-render of any
 * route that calls the visibility-score functions multiple times) and
 * pass into each compute function as `options.rollup`.
 *
 * The rollup is tenant-safe by construction: it receives only the
 * caller's filtered observations. There is no cross-tenant join.
 */
export function buildObservationRollup(opts: {
  observations: ReadonlyArray<PromptAnswerObservation>;
  brandAliases: ReadonlyArray<string>;
}): ObservationRollup {
  const brandSlugs = new Set(opts.brandAliases.map(slugifyEntity));

  // Mutable scratch — wrapped as Readonly at return.
  const sampledDateSet = new Set<string>();
  const byDate = new Map<
    string,
    {
      total: number;
      brandMentioned: number;
      brandCited: number;
      brandCitationWeightSum: number;
      perPlatform: Map<
        string,
        {
          obs: number;
          brandMentioned: number;
          brandCited: number;
          brandCitedOrMentioned: number;
        }
      >;
    }
  >();
  const byEntityDate = new Map<
    string,
    Map<
      string,
      {
        dedupedMentions: number;
        rawMentions: number;
        perPlatform: Map<string, number>;
        firstObsIndex: number;
      }
    >
  >();
  const entityNameBySlug = new Map<string, string>();

  for (let obsIndex = 0; obsIndex < opts.observations.length; obsIndex++) {
    const obs = opts.observations[obsIndex];
    const d = dateOnly(obs.observed_at);
    const platform = obs.platform ?? "unknown";
    sampledDateSet.add(d);

    // Per-date bucket.
    let dateBucket = byDate.get(d);
    if (!dateBucket) {
      dateBucket = {
        total: 0,
        brandMentioned: 0,
        brandCited: 0,
        brandCitationWeightSum: 0,
        perPlatform: new Map(),
      };
      byDate.set(d, dateBucket);
    }
    dateBucket.total += 1;

    let pdb = dateBucket.perPlatform.get(platform);
    if (!pdb) {
      pdb = { obs: 0, brandMentioned: 0, brandCited: 0, brandCitedOrMentioned: 0 };
      dateBucket.perPlatform.set(platform, pdb);
    }
    pdb.obs += 1;

    // Brand flags (computed once per obs).
    const isBrandMentioned = mentionsBrand(obs, brandSlugs);
    const isBrandCited = citesBrand(obs);
    if (isBrandMentioned) {
      dateBucket.brandMentioned += 1;
      pdb.brandMentioned += 1;
    }
    if (isBrandCited) {
      dateBucket.brandCited += 1;
      pdb.brandCited += 1;
    }
    if (isBrandMentioned || isBrandCited) {
      pdb.brandCitedOrMentioned += 1;
    }
    dateBucket.brandCitationWeightSum += citationPositionWeight(
      isBrandCited,
      obs.position,
    );

    // Per-entity counts. RAW vs DEDUPED matters:
    //   - rawMentions counts every occurrence in obs.mentions[]
    //     (matches `computeLeaderboard:aggregateWindow` which loops
    //     `for (const name of obs.mentions)` without a per-obs Set).
    //   - dedupedMentions counts 1 per obs where the slug appears at
    //     least once (matches `computeVisibilityTimeSeries` competitor
    //     path: `new Set((obs.mentions ?? []).map(slugifyEntity))`).
    if (obs.mentions && obs.mentions.length > 0) {
      const seenInObsRaw = new Set<string>();
      for (const name of obs.mentions) {
        const slug = slugifyEntity(name);
        if (brandSlugs.has(slug)) continue;
        // Record display name (first occurrence wins — matches
        // aggregateWindow's `mentionsByEntity.set(slug, { name, count: 1 })`).
        if (!entityNameBySlug.has(slug)) entityNameBySlug.set(slug, name);

        let entDates = byEntityDate.get(slug);
        if (!entDates) {
          entDates = new Map();
          byEntityDate.set(slug, entDates);
        }
        let entBucket = entDates.get(d);
        if (!entBucket) {
          entBucket = {
            dedupedMentions: 0,
            rawMentions: 0,
            perPlatform: new Map(),
            firstObsIndex: obsIndex,
          };
          entDates.set(d, entBucket);
        }
        entBucket.rawMentions += 1;
        if (!seenInObsRaw.has(slug)) {
          seenInObsRaw.add(slug);
          entBucket.dedupedMentions += 1;
          entBucket.perPlatform.set(
            platform,
            (entBucket.perPlatform.get(platform) ?? 0) + 1,
          );
        }
      }
    }
  }

  const sampledDates = Array.from(sampledDateSet).sort();
  // Lock the mutable maps as Readonly views before exposing.
  const byDateReadonly: ReadonlyMap<string, RollupDateBucket> = byDate;
  const byEntityDateReadonly: ReadonlyMap<
    string,
    ReadonlyMap<string, RollupEntityDateBucket>
  > = byEntityDate;

  return {
    sampledDates,
    sampledDateSet,
    byDate: byDateReadonly,
    byEntityDate: byEntityDateReadonly,
    entityNameBySlug,
    brandAliases: opts.brandAliases,
    brandSlugs,
    totalObservations: opts.observations.length,
  };
}
