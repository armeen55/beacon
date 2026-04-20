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
  composite: "Overall visibility \u2014 average of per-platform cite rates on days that platform was sampled (Profound-style)",
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
  /** Delta vs previous window in percentage points (absolute, not relative). */
  delta: number;
  /** Total mentions across the window (for tooltip / transparency). */
  mentionCount: number;
};

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
}): VisibilityPoint[] {
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
}): Record<string, VisibilityPoint[]> {
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
 * Build the top-N entity leaderboard across the current window, with delta
 * vs a previous window of equal length.
 *
 * Always includes the tracked brand, even if it would rank below the top-N.
 */
export function computeLeaderboard(opts: {
  observations: PromptAnswerObservation[];
  brandAliases: string[];
  /** Current window (inclusive). */
  startDate: string;
  endDate: string;
  /** Previous window (inclusive) — typically the same duration immediately before. */
  prevStartDate: string;
  prevEndDate: string;
  metric: VisibilityMetric;
  limit?: number;
}): EntityVisibility[] {
  const limit = opts.limit ?? 5;
  const brandSlugs = new Set(opts.brandAliases.map(slugifyEntity));
  const brandDisplay = opts.brandAliases[0] ?? "You";

  // Aggregate per entity across the current window.
  const current = aggregateWindow(
    opts.observations,
    opts.startDate,
    opts.endDate,
    brandSlugs,
    brandDisplay,
    opts.metric,
  );
  const previous = aggregateWindow(
    opts.observations,
    opts.prevStartDate,
    opts.prevEndDate,
    brandSlugs,
    brandDisplay,
    opts.metric,
  );

  const previousBySlug = new Map(previous.map((e) => [e.slug, e]));

  // Combine — current score + delta vs previous.
  const combined: EntityVisibility[] = current.map((c, i) => {
    const prev = previousBySlug.get(c.slug);
    const delta = prev ? c.score - prev.score : c.score;
    return {
      name: c.name,
      slug: c.slug,
      isOwned: c.isOwned,
      rank: i + 1,
      score: c.score,
      delta,
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
      // Update rank to reflect position in the full combined list.
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

function aggregateWindow(
  observations: PromptAnswerObservation[],
  startDate: string,
  endDate: string,
  brandSlugs: Set<string>,
  brandDisplay: string,
  metric: VisibilityMetric,
): AggregatedEntity[] {
  // Counts per entity.
  const mentionsByEntity = new Map<string, { name: string; count: number }>();
  // Brand gets special handling via tracked_brand_mentioned flag.
  let brandMentioned = 0;
  let brandCited = 0;
  let brandCitationWeightSum = 0;
  let totalInWindow = 0;

  for (const obs of observations) {
    const d = dateOnly(obs.observed_at);
    if (d < startDate || d > endDate) continue;
    totalInWindow++;

    // Brand (the tracked tenant).
    if (mentionsBrand(obs, brandSlugs)) brandMentioned++;
    const brandIsCited = citesBrand(obs);
    if (brandIsCited) brandCited++;
    brandCitationWeightSum += citationPositionWeight(brandIsCited, obs.position);

    // All other entities from mentions[].
    for (const name of obs.mentions ?? []) {
      const slug = slugifyEntity(name);
      if (brandSlugs.has(slug)) continue; // Don't double-count the brand.
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

  return out;
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
    }),
  }));

  return [brand, ...competitors];
}
