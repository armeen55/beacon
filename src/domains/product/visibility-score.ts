/**
 * Visibility Score — Profound-style metric system.
 *
 * Computes daily "visibility" of the tracked tenant + competitors across all
 * prompt-answer observations. Three metric modes:
 *
 *   mention_rate  = % of observations where the entity was mentioned in text
 *   citation_rate = % of observations where the entity was cited (URL linked)
 *   composite     = weighted blend (0.6 mention + 0.4 citation)
 *
 * Built 2026-04-17 (Day 6 visual rebuild) as the replacement for the single
 * 5,146 big-number block on Today. Mirrors Profound's "Visibility Score" +
 * leaderboard dashboard. Pure read-only functions — no writes.
 *
 * Inputs: PromptAnswerObservation[] (from .data/prompt-answer-observations.json).
 * All math is aggregation + division; no LLM, no fancy stats.
 */

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import { makeCompetitorRankingFilter } from "@/domains/recommendations/entity-pollution-filter";

// ---------------------------------------------------------------------------
// Rollup types (relocated 2026-07-21 from the deleted
// src/domains/today/observation-rollup.ts engine, repository diet). The
// rollup fast paths below accept this pre-bucketed shape; the superseded
// builder that produced it in /today was replaced by the visibility read
// model, so callers today take the direct observation-walk path.
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
   *  `obs.mentions[]` at least once (per-obs dedupe). */
  dedupedMentions: number;
  /** Sum of slug occurrences across `obs.mentions[]` arrays for this
   *  date. Multiple appearances within one obs each contribute. */
  rawMentions: number;
  /** Per-platform deduped mentions (1 per obs). */
  perPlatform: ReadonlyMap<string, number>;
  /** Smallest index in the original `observations` array where this
   *  (slug, date) was mentioned — reproduces the direct path's
   *  window-bound entity insertion order so leaderboard outputs stay
   *  byte-identical between paths even when entities tie on score. */
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
  /** Brand aliases the rollup was built with. */
  brandAliases: ReadonlyArray<string>;
  /** Set of `slugifyEntity(alias)` for fast brand-alias membership. */
  brandSlugs: ReadonlySet<string>;
  /** Total observations the rollup was built from. */
  totalObservations: number;
  /** Full ISO timestamp of the latest observation, or null. */
  latestObservedAt: string | null;
  /** Total occurrences of each mention name as it appeared in
   *  `obs.mentions[]` (original case preserved), excluding brand aliases. */
  mentionCountsByOriginalName: ReadonlyMap<string, number>;
}>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VisibilityMetric = "mention_rate" | "citation_rate" | "composite";

export const VISIBILITY_METRIC_LABELS: Record<VisibilityMetric, string> = {
  mention_rate: "Mention rate",
  citation_rate: "Citation rate",
  composite: "Visibility score",
};

export const VISIBILITY_METRIC_DESCRIPTIONS: Record<VisibilityMetric, string> = {
  mention_rate: "% of AI answers that mention your brand by name",
  citation_rate: "% of AI answers that link your site",
  composite: "Overall visibility \u2014 average of per-platform cite rates on days that platform was sampled",
};

/** One day on the chart. */
export type VisibilityPoint = {
  date: string; // YYYY-MM-DD
  score: number; // 0..100
  sampleSize: number; // # observations that day (for transparency)
};

/** One row on the leaderboard. */
export type EntityVisibility = {
  name: string;
  slug: string;
  isOwned: boolean;
  rank: number;
  /** Current-window average score. 0..100. */
  score: number;
  /**
   * Δ in percentage points vs the previous equal-length window
   * (current avg − previous avg). Null when the previous window has
   * insufficient samples to make an honest comparison — Step 1.3
   * (master plan) replaces the prior fake-0 fallback.
   */
  delta: number | null;
  /** Window length used for the delta comparison, in calendar days. */
  deltaWindowDays: number;
  /** Sampled-day count in the current window — for honest tooltips. */
  currentSampledDays: number;
  /** Sampled-day count in the previous window — null delta when this is too low. */
  previousSampledDays: number;
  /** Total mentions across the current window (transparency). */
  mentionCount: number;
};

/**
 * Minimum sampled-day count required in the PREVIOUS window before we'll
 * report a delta. Below this we return `delta: null` so the UI can render
 * a "—" / "limited data" treatment instead of pretending we know.
 *
 * Threshold chosen at ⌈windowDays / 3⌉ with a hard floor of 2: a 7d window
 * requires 3 prior sampled days, 14d requires 5, 30d requires 10, 60d 20.
 */
function minSampledDaysForDelta(windowDays: number): number {
  return Math.max(2, Math.ceil(windowDays / 3));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an entity name to a stable slug for comparison.
 * "Ritz Builders" → "ritz builders"
 * "De Mattei Construction" → "de mattei construction"
 */
function slugifyEntity(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Extract YYYY-MM-DD from an ISO timestamp. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Iterate YYYY-MM-DD strings inclusive from start to end. */
function dateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Composite score formula (single source of truth). */
function composite(mentionRate: number, citationRate: number): number {
  // Equal blend so the three toggles produce visibly different numbers
  // (mention_rate is usually higher than the position-weighted citation_rate,
  // so composite lands strictly between them).
  return 0.5 * mentionRate + 0.5 * citationRate;
}

/**
 * Position-weight for a single cited observation.
 *
 *   pos 1\u20133  \u2192 1.0   (top-of-answer, maximum impact)
 *   pos 4\u20136  \u2192 0.5   (mid-answer, half-credit)
 *   pos 7+   \u2192 0.25  (deep citation, quarter-credit)
 *   unknown  \u2192 0.5   (default mid-tier when position data missing ~13% of cites)
 *
 * Observations that aren't cited at all return 0.
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

/** Tested whether any brand alias appears in the observation's mentions list. */
function mentionsBrand(
  obs: PromptAnswerObservation,
  brandSlugs: Set<string>,
): boolean {
  // Fast path: observation has tracked_brand_mentioned flag (trusted).
  if (obs.tracked_brand_mentioned === true) return true;
  // Fallback: scan mentions[] for any alias match.
  for (const m of obs.mentions ?? []) {
    if (brandSlugs.has(slugifyEntity(m))) return true;
  }
  return false;
}

/** Tested whether any brand alias appears in the observation's citations. */
function citesBrand(obs: PromptAnswerObservation): boolean {
  return obs.tracked_brand_cited === true;
}

// ---------------------------------------------------------------------------
// Time-series computation
// ---------------------------------------------------------------------------

/**
 * Build a daily time series of visibility score for ONE entity (the tracked
 * brand by default, or a competitor when `entitySlug` is provided).
 */
export function computeVisibilityTimeSeries(opts: {
  observations: PromptAnswerObservation[];
  metric: VisibilityMetric;
  brandAliases: string[];
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** When provided, compute for this competitor entity instead of tracked brand. */
  competitorName?: string;
  /**
   * Perf bundle 3 (2026-05-12) — optional shared rollup. When supplied
   * (and built from the same `brandAliases`), the function reads
   * pre-bucketed per-(date, platform) aggregates in O(window) instead
   * of walking the full observation array. Callers without a rollup
   * get the original direct path verbatim — public output unchanged.
   */
  rollup?: ObservationRollup;
}): VisibilityPoint[] {
  // Fast path: caller supplied a rollup. Must stay output-equivalent to the
  // direct path below (the former equivalence test was retired with the
  // rollup builder; no live caller supplies a rollup today).
  if (opts.rollup) {
    return computeVisibilityTimeSeriesFromRollup({
      rollup: opts.rollup,
      metric: opts.metric,
      brandAliases: opts.brandAliases,
      startDate: opts.startDate,
      endDate: opts.endDate,
      competitorName: opts.competitorName,
    });
  }

  const brandSlugs = new Set(opts.brandAliases.map(slugifyEntity));
  const competitorSlug = opts.competitorName
    ? slugifyEntity(opts.competitorName)
    : null;

  // Bucket observations by date.
  const byDate = new Map<string, PromptAnswerObservation[]>();
  for (const obs of opts.observations) {
    const d = dateOnly(obs.observed_at);
    if (d < opts.startDate || d > opts.endDate) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(obs);
  }

  const out: VisibilityPoint[] = [];
  for (const date of dateRange(opts.startDate, opts.endDate)) {
    const bucket = byDate.get(date) ?? [];
    // Skip zero-sample dates entirely \u2014 these are usually today/future dates
    // where observations haven't landed yet, and rendering them as 0% causes
    // a misleading "crash" at the end of the chart.
    if (bucket.length === 0) continue;

    // 2026-04-19: rewrote the formulas to MATCH PROFOUND.
    //   mention_rate  = % of obs that mentioned the brand by name
    //   citation_rate = % of obs that cited the brand domain (RAW, no position weight)
    //   composite     = average of per-platform raw cite rate, over platforms
    //                   that were sampled (>0 obs for that platform that day).
    //                   Unsampled platforms are EXCLUDED from the average.
    //                   This matches Profound's "Overall" UI number that
    //                   averages non-zero per-platform visibilities.
    const byPlatform = new Map<string, { obs: number; mentioned: number; cited: number }>();
    let mentionedTotal = 0;
    let citedTotal = 0;

    for (const obs of bucket) {
      const platform = obs.platform ?? "unknown";
      let p = byPlatform.get(platform);
      if (!p) {
        p = { obs: 0, mentioned: 0, cited: 0 };
        byPlatform.set(platform, p);
      }
      p.obs += 1;

      if (competitorSlug) {
        // Competitors: rely on mentions[] field. Citation = mention until
        // we wire a competitor-domain map.
        const mentionsSlugs = new Set((obs.mentions ?? []).map(slugifyEntity));
        if (mentionsSlugs.has(competitorSlug)) {
          p.mentioned += 1; mentionedTotal += 1;
          p.cited += 1;     citedTotal += 1;
        }
      } else {
        if (mentionsBrand(obs, brandSlugs)) {
          p.mentioned += 1; mentionedTotal += 1;
        }
        if (citesBrand(obs)) {
          p.cited += 1;     citedTotal += 1;
        }
      }
    }

    const mentionRate = (mentionedTotal / bucket.length) * 100;
    const citationRate = (citedTotal / bucket.length) * 100;

    // Composite (Profound-style): avg of per-platform cite rates where the
    // platform was sampled. If only 1 platform was sampled, that IS the
    // composite. Unsampled platforms contribute nothing (they are not
    // "0% mentions", they are "we don't know about today").
    let compositeScore: number;
    const sampledPlatformRates: number[] = [];
    for (const p of byPlatform.values()) {
      if (p.obs === 0) continue;
      sampledPlatformRates.push((p.cited / p.obs) * 100);
    }
    if (sampledPlatformRates.length === 0) {
      compositeScore = 0;
    } else {
      compositeScore = sampledPlatformRates.reduce((a, b) => a + b, 0) / sampledPlatformRates.length;
    }

    const score =
      opts.metric === "mention_rate"
        ? mentionRate
        : opts.metric === "citation_rate"
          ? citationRate
          : compositeScore;

    out.push({ date, score, sampleSize: bucket.length });
  }

  return out;
}

/**
 * Variant: break down visibility per platform, for the chart's platform-split
 * view. Returns one time series per platform. Uses raw cite rate (matches
 * Profound's per-platform "visibility" column).
 */
export function computeVisibilityTimeSeriesByPlatform(opts: {
  observations: PromptAnswerObservation[];
  brandAliases: string[];
  startDate: string;
  endDate: string;
  /** Perf bundle 3 (2026-05-12) — shared rollup, see
   *  `computeVisibilityTimeSeries` for details. */
  rollup?: ObservationRollup;
}): Record<string, VisibilityPoint[]> {
  if (opts.rollup) {
    return computeVisibilityTimeSeriesByPlatformFromRollup({
      rollup: opts.rollup,
      startDate: opts.startDate,
      endDate: opts.endDate,
    });
  }

  const brandSlugs = new Set(opts.brandAliases.map(slugifyEntity));

  // Bucket by (platform, date).
  const byPlatformDate = new Map<string, Map<string, PromptAnswerObservation[]>>();
  for (const obs of opts.observations) {
    const d = dateOnly(obs.observed_at);
    if (d < opts.startDate || d > opts.endDate) continue;
    const platform = obs.platform ?? "unknown";
    if (!byPlatformDate.has(platform)) byPlatformDate.set(platform, new Map());
    const dmap = byPlatformDate.get(platform)!;
    if (!dmap.has(d)) dmap.set(d, []);
    dmap.get(d)!.push(obs);
  }

  const result: Record<string, VisibilityPoint[]> = {};
  for (const [platform, dmap] of byPlatformDate) {
    const series: VisibilityPoint[] = [];
    for (const date of dateRange(opts.startDate, opts.endDate)) {
      const bucket = dmap.get(date) ?? [];
      if (bucket.length === 0) continue; // unsampled platform/day: exclude
      let cited = 0;
      for (const obs of bucket) {
        if (citesBrand(obs) || mentionsBrand(obs, brandSlugs)) {
          cited += 1;
        }
      }
      const rate = (cited / bucket.length) * 100;
      series.push({ date, score: rate, sampleSize: bucket.length });
    }
    result[platform] = series;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/**
 * Build the top-N entity leaderboard across the current window, with the
 * delta column reading "current avg − previous-equal-length-window avg".
 *
 * Step 1.3 (master plan) — `windowDays` is the single knob the caller
 * twists. The function derives both windows from `windowEndDate` so the
 * delta semantics ALWAYS read "vs. previous {windowDays} days":
 *
 *   current  = [windowEndDate − windowDays + 1, windowEndDate]
 *   previous = [windowEndDate − 2·windowDays + 1, windowEndDate − windowDays]
 *
 * Always includes the tracked brand even if it would rank below the top-N.
 *
 * Tests: see `visibility-score-delta.test.ts`.
 */
export function computeLeaderboard(opts: {
  observations: PromptAnswerObservation[];
  brandAliases: string[];
  /** Inclusive end of the current window — usually today's UTC date. */
  windowEndDate: string;
  /** Length of the current AND previous windows in calendar days. */
  windowDays: number;
  metric: VisibilityMetric;
  limit?: number;
  /**
   * Step 1.4 (master plan) — when supplied, directories
   * (Houzz/Yelp/Angi/etc.) and obvious generic-noun mentions are
   * excluded from competitor rows. Brand row + real builders unaffected.
   * Falls back to a name-only generic-noun filter when omitted, so
   * non-Today callers stay safe.
   */
  trackedEntities?: ReadonlyArray<TrackedEntity>;
  /** Perf bundle 3 (2026-05-12) — shared rollup, see
   *  `computeVisibilityTimeSeries` for details. */
  rollup?: ObservationRollup;
}): EntityVisibility[] {
  const limit = opts.limit ?? 5;
  const brandSlugs = new Set(opts.brandAliases.map(slugifyEntity));
  const brandDisplay = opts.brandAliases[0] ?? "You";

  // Derive windows from the single (windowEndDate, windowDays) knob.
  const startDate = subtractDays(opts.windowEndDate, opts.windowDays - 1);
  const endDate = opts.windowEndDate;
  const prevEndDate = subtractDays(opts.windowEndDate, opts.windowDays);
  const prevStartDate = subtractDays(opts.windowEndDate, 2 * opts.windowDays - 1);

  // Build the filter once per call so both windows agree on which
  // mentions count as competitors.
  const competitorRankingFilter = makeCompetitorRankingFilter(
    opts.trackedEntities ?? [],
  );

  const useRollup = opts.rollup != null;
  const current = useRollup
    ? aggregateWindowFromRollup(
        opts.rollup!,
        startDate,
        endDate,
        brandDisplay,
        opts.metric,
        competitorRankingFilter,
      )
    : aggregateWindow(
        opts.observations,
        startDate,
        endDate,
        brandSlugs,
        brandDisplay,
        opts.metric,
        competitorRankingFilter,
      );
  const previous = useRollup
    ? aggregateWindowFromRollup(
        opts.rollup!,
        prevStartDate,
        prevEndDate,
        brandDisplay,
        opts.metric,
        competitorRankingFilter,
      )
    : aggregateWindow(
        opts.observations,
        prevStartDate,
        prevEndDate,
        brandSlugs,
        brandDisplay,
        opts.metric,
        competitorRankingFilter,
      );

  const previousBySlug = new Map(previous.entities.map((e) => [e.slug, e]));
  const minPrev = minSampledDaysForDelta(opts.windowDays);
  const previousIsHonest = previous.sampledDays >= minPrev;

  // Combine — current score + delta vs previous. Null delta when the
  // previous window is too sparse to compare honestly.
  const combined: EntityVisibility[] = current.entities.map((c, i) => {
    const prev = previousBySlug.get(c.slug);
    const delta = previousIsHonest && prev ? c.score - prev.score : null;
    return {
      name: c.name,
      slug: c.slug,
      isOwned: c.isOwned,
      rank: i + 1,
      score: c.score,
      delta,
      deltaWindowDays: opts.windowDays,
      currentSampledDays: current.sampledDays,
      previousSampledDays: previous.sampledDays,
      mentionCount: c.mentionCount,
    };
  });

  // Sort descending by score, take top N.
  combined.sort((a, b) => b.score - a.score);
  const topN = combined.slice(0, limit);

  // Ensure tracked brand appears in the leaderboard even if it ranked outside
  // top-N. Append at the end with its real rank.
  const brandInTopN = topN.some((e) => e.isOwned);
  if (!brandInTopN) {
    const brand = combined.find((e) => e.isOwned);
    if (brand) {
      const brandRank = combined.findIndex((e) => e.slug === brand.slug) + 1;
      topN.push({ ...brand, rank: brandRank });
    }
  }

  // Re-number displayed rank positions 1..N based on sorted order (but keep
  // the actual rank for the brand when it was appended beyond top-N).
  const withDisplayRank = topN.map((e, i) => ({
    ...e,
    rank: brandInTopN ? i + 1 : e.isOwned && i === topN.length - 1 ? e.rank : i + 1,
  }));

  return withDisplayRank;
}

/** Subtract N calendar days from a YYYY-MM-DD string. UTC-safe. */
function subtractDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type AggregatedEntity = {
  name: string;
  slug: string;
  isOwned: boolean;
  score: number;
  mentionCount: number;
};

/**
 * Result of an aggregation pass. `sampledDays` is the count of distinct
 * dates inside [startDate, endDate] with at least one observation —
 * `computeLeaderboard` reads this to decide whether the previous window
 * is dense enough to support an honest delta.
 */
type AggregateWindowResult = {
  entities: AggregatedEntity[];
  sampledDays: number;
};

function aggregateWindow(
  observations: PromptAnswerObservation[],
  startDate: string,
  endDate: string,
  brandSlugs: Set<string>,
  brandDisplay: string,
  metric: VisibilityMetric,
  /**
   * Step 1.4 (master plan) — predicate returns `true` for entities that
   * SHOULD rank as competitors. Pre-built once per `computeLeaderboard`
   * call from the supplied tracked-entity registry. When undefined,
   * every mention is allowed (legacy behaviour for non-Today callers).
   */
  shouldRankAsCompetitor?: (name: string) => boolean,
): AggregateWindowResult {
  // Counts per entity.
  const mentionsByEntity = new Map<string, { name: string; count: number }>();
  // Brand gets special handling via tracked_brand_mentioned flag.
  let brandMentioned = 0;
  let brandCited = 0;
  let brandCitationWeightSum = 0;
  let totalInWindow = 0;
  const sampledDateSet = new Set<string>();

  for (const obs of observations) {
    const d = dateOnly(obs.observed_at);
    if (d < startDate || d > endDate) continue;
    totalInWindow++;
    sampledDateSet.add(d);

    // Brand (the tracked tenant).
    if (mentionsBrand(obs, brandSlugs)) brandMentioned++;
    const brandIsCited = citesBrand(obs);
    if (brandIsCited) brandCited++;
    brandCitationWeightSum += citationPositionWeight(brandIsCited, obs.position);

    // All other entities from mentions[].
    for (const name of obs.mentions ?? []) {
      const slug = slugifyEntity(name);
      if (brandSlugs.has(slug)) continue; // Don't double-count the brand.
      // Step 1.4 — exclude directories + generic-noun mentions from
      // competitor rows when the caller supplied a filter. Brand row is
      // unaffected (handled above via brandSlugs short-circuit).
      if (shouldRankAsCompetitor && !shouldRankAsCompetitor(name)) continue;
      const existing = mentionsByEntity.get(slug);
      if (existing) {
        existing.count++;
      } else {
        mentionsByEntity.set(slug, { name, count: 1 });
      }
    }
  }

  const out: AggregatedEntity[] = [];

  // Brand row \u2014 citation rate uses position-weight for semantic spread.
  if (totalInWindow > 0) {
    const mentionRate = (brandMentioned / totalInWindow) * 100;
    const citationRate = (brandCitationWeightSum / totalInWindow) * 100;
    const score =
      metric === "mention_rate"
        ? mentionRate
        : metric === "citation_rate"
          ? citationRate
          : composite(mentionRate, citationRate);
    out.push({
      name: brandDisplay,
      slug: slugifyEntity(brandDisplay),
      isOwned: true,
      score,
      mentionCount: brandMentioned,
    });
  }

  // Competitor rows — all entities in mentions[] ≥ 3 (noise filter).
  for (const { name, count } of mentionsByEntity.values()) {
    if (count < 3) continue; // Filter out noise entities mentioned < 3 times.
    const score = totalInWindow > 0 ? (count / totalInWindow) * 100 : 0;
    out.push({
      name,
      slug: slugifyEntity(name),
      isOwned: false,
      score,
      mentionCount: count,
    });
  }

  return { entities: out, sampledDays: sampledDateSet.size };
}

// ---------------------------------------------------------------------------
// Convenience — multi-entity time series for "compare competitors" toggle
// ---------------------------------------------------------------------------

/**
 * Build time series for [brand, ...topCompetitors] in one pass.
 * Used by the "Compare competitors" chart view.
 */
export function computeCompetitorSeries(opts: {
  observations: PromptAnswerObservation[];
  brandAliases: string[];
  competitorNames: string[];
  metric: VisibilityMetric;
  startDate: string;
  endDate: string;
  /** Perf bundle 3 (2026-05-12) — shared rollup, see
   *  `computeVisibilityTimeSeries` for details. When supplied, each
   *  inner `computeVisibilityTimeSeries` call inherits it; saves
   *  N×bucketing where N is `1 + competitorNames.length`. */
  rollup?: ObservationRollup;
}): Array<{ name: string; isOwned: boolean; points: VisibilityPoint[] }> {
  const brand = {
    name: opts.brandAliases[0] ?? "You",
    isOwned: true,
    points: computeVisibilityTimeSeries({
      observations: opts.observations,
      metric: opts.metric,
      brandAliases: opts.brandAliases,
      startDate: opts.startDate,
      endDate: opts.endDate,
      rollup: opts.rollup,
    }),
  };

  const competitors = opts.competitorNames.map((name) => ({
    name,
    isOwned: false,
    points: computeVisibilityTimeSeries({
      observations: opts.observations,
      metric: opts.metric,
      brandAliases: opts.brandAliases,
      startDate: opts.startDate,
      endDate: opts.endDate,
      competitorName: name,
      rollup: opts.rollup,
    }),
  }));

  return [brand, ...competitors];
}

// ---------------------------------------------------------------------------
// Perf bundle 3 (2026-05-12) — Rollup fast-path helpers.
//
// Each helper produces output that MUST match the direct path
// byte-for-byte for the same inputs. (The equivalence test suite was retired
// 2026-07-21 along with the rollup builder; no live caller supplies a rollup
// today.)
//
// The helpers run in O(window-days × entity-count), independent of the
// observation array's size.
// ---------------------------------------------------------------------------

/** Iterate YYYY-MM-DD strings inclusive between start and end. UTC-safe. */
function dateRangeUtc(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function computeVisibilityTimeSeriesFromRollup(opts: {
  rollup: ObservationRollup;
  metric: VisibilityMetric;
  brandAliases: string[];
  startDate: string;
  endDate: string;
  competitorName?: string;
}): VisibilityPoint[] {
  const competitorSlug = opts.competitorName
    ? slugifyEntity(opts.competitorName)
    : null;
  const entityDateMap = competitorSlug
    ? opts.rollup.byEntityDate.get(competitorSlug)
    : null;

  const out: VisibilityPoint[] = [];
  for (const date of dateRangeUtc(opts.startDate, opts.endDate)) {
    const bucket = opts.rollup.byDate.get(date);
    if (!bucket || bucket.total === 0) continue; // skip unsampled dates (matches direct path)

    let mentionedTotal: number;
    let citedTotal: number;
    const sampledPlatformRates: number[] = [];

    if (competitorSlug) {
      const compBucket = entityDateMap?.get(date);
      // Competitor: mentioned == cited (no competitor-domain map, matches
      // direct path which sets both from `mentionsSlugs.has(competitorSlug)`).
      mentionedTotal = compBucket?.dedupedMentions ?? 0;
      citedTotal = mentionedTotal;
      // Per-platform composite — only platforms sampled on this date
      // contribute; "sampled" means platform appears in bucket.perPlatform
      // (whether or not competitor was mentioned there).
      for (const [platform, pdb] of bucket.perPlatform) {
        if (pdb.obs === 0) continue;
        const compOnPlatform = compBucket?.perPlatform.get(platform) ?? 0;
        sampledPlatformRates.push((compOnPlatform / pdb.obs) * 100);
      }
    } else {
      mentionedTotal = bucket.brandMentioned;
      citedTotal = bucket.brandCited;
      for (const [, pdb] of bucket.perPlatform) {
        if (pdb.obs === 0) continue;
        sampledPlatformRates.push((pdb.brandCited / pdb.obs) * 100);
      }
    }

    const mentionRate = (mentionedTotal / bucket.total) * 100;
    const citationRate = (citedTotal / bucket.total) * 100;
    const compositeScore =
      sampledPlatformRates.length === 0
        ? 0
        : sampledPlatformRates.reduce((a, b) => a + b, 0) /
          sampledPlatformRates.length;

    const score =
      opts.metric === "mention_rate"
        ? mentionRate
        : opts.metric === "citation_rate"
          ? citationRate
          : compositeScore;

    out.push({ date, score, sampleSize: bucket.total });
  }

  return out;
}

function computeVisibilityTimeSeriesByPlatformFromRollup(opts: {
  rollup: ObservationRollup;
  startDate: string;
  endDate: string;
}): Record<string, VisibilityPoint[]> {
  // Direct path iterates byPlatformDate.entries() and emits one series
  // per platform that had ≥1 observation in the window. Reproduce that
  // ordering by scanning the rollup's dates in the window and inserting
  // each platform's per-date data.
  const platformPoints = new Map<string, VisibilityPoint[]>();
  for (const date of dateRangeUtc(opts.startDate, opts.endDate)) {
    const bucket = opts.rollup.byDate.get(date);
    if (!bucket) continue;
    for (const [platform, pdb] of bucket.perPlatform) {
      if (pdb.obs === 0) continue; // unsampled platform/day excluded (matches direct)
      let series = platformPoints.get(platform);
      if (!series) {
        series = [];
        platformPoints.set(platform, series);
      }
      const rate = (pdb.brandCitedOrMentioned / pdb.obs) * 100;
      series.push({ date, score: rate, sampleSize: pdb.obs });
    }
  }

  const result: Record<string, VisibilityPoint[]> = {};
  for (const [platform, series] of platformPoints) result[platform] = series;
  return result;
}

function aggregateWindowFromRollup(
  rollup: ObservationRollup,
  startDate: string,
  endDate: string,
  brandDisplay: string,
  metric: VisibilityMetric,
  shouldRankAsCompetitor?: (name: string) => boolean,
): AggregateWindowResult {
  let totalInWindow = 0;
  let brandMentioned = 0;
  let brandCitationWeightSum = 0;
  const sampledDateSet = new Set<string>();

  // Use rollup.sampledDates (sorted ASC) and a string-compare window
  // filter instead of computing `dateRangeUtc` per call. The rollup's
  // dates are exactly the dates with ≥1 observation, so we never visit
  // an unsampled date — strictly faster than walking the full calendar.
  // (YYYY-MM-DD strings are lex-safe for date ordering.)
  const datesInWindow: string[] = [];
  for (const date of rollup.sampledDates) {
    if (date < startDate) continue;
    if (date > endDate) break; // sorted ASC — done
    datesInWindow.push(date);

    const bucket = rollup.byDate.get(date);
    if (!bucket || bucket.total === 0) continue;
    totalInWindow += bucket.total;
    brandMentioned += bucket.brandMentioned;
    brandCitationWeightSum += bucket.brandCitationWeightSum;
    sampledDateSet.add(date);
  }

  // Per-entity raw mention totals over the window. To reproduce the direct
  // path's insertion order (which controls stable-sort tiebreaking), we
  // first collect (slug, count, name, firstObsIndexInWindow) then insert
  // into the Map sorted ascending by `firstObsIndexInWindow`. The direct
  // path implicitly does this because it iterates observations in array
  // order and inserts on first sighting.
  type EntityScratch = {
    slug: string;
    name: string;
    count: number;
    firstObsIndexInWindow: number;
  };
  const scratch: EntityScratch[] = [];
  for (const [slug, dateMap] of rollup.byEntityDate) {
    // shouldRankAsCompetitor filter applies to the DISPLAY name, matching
    // the direct path's `for (const name of obs.mentions) { … if
    // (shouldRankAsCompetitor && !shouldRankAsCompetitor(name)) continue; }`.
    const displayName = rollup.entityNameBySlug.get(slug) ?? slug;
    if (shouldRankAsCompetitor && !shouldRankAsCompetitor(displayName)) continue;

    let count = 0;
    let firstObsIndexInWindow = Number.POSITIVE_INFINITY;
    // Reuse the pre-computed `datesInWindow` array — no per-entity
    // calendar walk.
    for (const date of datesInWindow) {
      const eb = dateMap.get(date);
      if (!eb) continue;
      count += eb.rawMentions;
      if (eb.firstObsIndex < firstObsIndexInWindow) {
        firstObsIndexInWindow = eb.firstObsIndex;
      }
    }
    if (count > 0) {
      scratch.push({ slug, name: displayName, count, firstObsIndexInWindow });
    }
  }
  scratch.sort((a, b) => a.firstObsIndexInWindow - b.firstObsIndexInWindow);

  const mentionsByEntity = new Map<string, { name: string; count: number }>();
  for (const e of scratch) {
    mentionsByEntity.set(e.slug, { name: e.name, count: e.count });
  }

  const out: AggregatedEntity[] = [];

  if (totalInWindow > 0) {
    const mentionRate = (brandMentioned / totalInWindow) * 100;
    const citationRate = (brandCitationWeightSum / totalInWindow) * 100;
    const score =
      metric === "mention_rate"
        ? mentionRate
        : metric === "citation_rate"
          ? citationRate
          : composite(mentionRate, citationRate);
    out.push({
      name: brandDisplay,
      slug: slugifyEntity(brandDisplay),
      isOwned: true,
      score,
      mentionCount: brandMentioned,
    });
  }

  for (const { name, count } of mentionsByEntity.values()) {
    if (count < 3) continue;
    const score = totalInWindow > 0 ? (count / totalInWindow) * 100 : 0;
    out.push({
      name,
      slug: slugifyEntity(name),
      isOwned: false,
      score,
      mentionCount: count,
    });
  }

  return { entities: out, sampledDays: sampledDateSet.size };
}
