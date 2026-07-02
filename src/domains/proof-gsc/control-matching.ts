/**
 * control-matching (BEACON_500 items 33 + 36) - hardens which comparison pages
 * a shipped-change verdict is allowed to lean on.
 *
 * Two independent problems, one module because both fire at GSC control
 * selection time in auto-record-on-ship.ts:
 *
 *   Item 33 - SCALE + TREND mismatch. loadControlCandidates picks the top
 *   pages by demand, so a 50-click page can get 5,000-click comparison pages
 *   whose ordinary drift dwarfs its own signal, and a comparison page can be
 *   trending in a completely different direction before the ship even
 *   happens (breaking the parallel-trends assumption diff-in-diff depends
 *   on). Ported from src/domains/attribution/natural-controls.ts
 *   (baselineSimilarityRatio + maxTrendSlopeDivergence), already built and
 *   tested for the AI-citation engine.
 *
 *   Item 36 - SUTVA violation. If a comparison page ranks for the same
 *   queries as the treated page, a winning title change steals clicks FROM
 *   the comparison page (not from thin air), so the diff-in-diff double
 *   counts the effect; a cannibalizing sibling can even read as a fake win.
 *   Excluded above an impression-weighted query-overlap threshold.
 *
 * PURE. No I/O - the caller supplies baseline/trend/overlap numbers already
 * read from GSC. Mirrors the shape of natural-controls.ts's findControls so
 * the two engines stay recognizably related, but works in clicks/day (GSC)
 * rather than citations/day.
 *
 * Fail-soft contract (caller-enforced, documented here): if a similarity or
 * overlap number could not be computed for a candidate, treat it as PASSING
 * that check rather than excluding it - a broken read must fall back to
 * current behavior, never to zero comparison pages when candidates exist.
 * Prefer fewer good comparison pages over three bad ones; MIN_SURVIVORS (2)
 * is the floor auto-record-on-ship already enforces before recording.
 */

export const MIN_SURVIVORS = 2;

/** Max allowed ratio between a candidate's and the treated page's baseline
 *  clicks (level similarity). Ported verbatim from natural-controls.ts's
 *  DEFAULT_CONFIG.baselineSimilarityRatio - the same "is this comparable
 *  scale" band, applied to GSC clicks/day instead of citations/day. */
export const BASELINE_SIMILARITY_RATIO = { min: 0.25, max: 4.0 };

/** Below this baseline, the ratio test is undefined (divide-by-near-zero);
 *  mirrors natural-controls.ts's minMuPreForRelative "near zero" floor. */
export const MIN_BASELINE_FOR_RATIO = 0.5;

/** Max allowed absolute difference of pre-period OLS daily-clicks slopes
 *  between treated and candidate. Ported verbatim from natural-controls.ts's
 *  DEFAULT_CONFIG.maxTrendSlopeDivergence. */
export const MAX_TREND_SLOPE_DIVERGENCE = 0.6;

/** SUTVA guard (item 36): exclude any candidate whose impression-weighted
 *  query overlap with the treated page exceeds this share. Documented
 *  constant per the master-plan spec ("roughly 20 percent"). */
export const MAX_QUERY_OVERLAP = 0.2;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type TreatedPageStats = {
  url: string;
  /** Mean daily clicks over the pre-ship baseline window. */
  baselineClicksPerDay: number;
  /** OLS slope (clicks/day per day) over the same pre-ship window. */
  preSlope: number;
};

export type ControlCandidateStats = {
  url: string;
  baselineClicksPerDay: number;
  preSlope: number;
  /**
   * Impression-weighted share of the candidate's queries that are also the
   * treated page's queries, in [0, 1]. Null when the overlap reader could
   * not compute a number for this pair (fail-soft - never excluded on a
   * missing read).
   */
  queryOverlap: number | null;
};

export type ControlVerdict = "kept" | "excluded";

export type RankedControl = {
  url: string;
  similarityRatio: number | null;
  slopeDivergence: number | null;
  queryOverlap: number | null;
  verdict: ControlVerdict;
  reason: string;
};

export type RankControlsResult = {
  /** Survivors in ranking order (best match first), capped by the caller. */
  kept: RankedControl[];
  /** Every candidate considered, kept and excluded, in input order - the
   *  receipt trail for controlMatchNotes. */
  all: RankedControl[];
  /**
   * True when the strict pass produced fewer than MIN_SURVIVORS pages and
   * this result instead falls back to the best-available candidates
   * (ranked by how close they came) so a real ship is never left with zero
   * comparison pages while candidates exist. The read-time honesty flag.
   */
  usedFallback: boolean;
};

// ---------------------------------------------------------------------------
// Pure math (ported)
// ---------------------------------------------------------------------------

/** Baseline-level similarity ratio: candidate / treated. Null when the
 *  treated baseline is too thin for the ratio to mean anything (mirrors
 *  natural-controls.ts's near-zero branch). */
export function baselineSimilarityRatio(
  treatedBaseline: number,
  candidateBaseline: number,
): number | null {
  if (treatedBaseline < MIN_BASELINE_FOR_RATIO) return null;
  return candidateBaseline / treatedBaseline;
}

/** Absolute pre-period trend-slope divergence between treated and candidate. */
export function trendSlopeDivergence(treatedSlope: number, candidateSlope: number): number {
  return Math.abs(candidateSlope - treatedSlope);
}

function passesBaseline(treated: TreatedPageStats, candidate: ControlCandidateStats): { pass: boolean; ratio: number | null } {
  const ratio = baselineSimilarityRatio(treated.baselineClicksPerDay, candidate.baselineClicksPerDay);
  if (ratio === null) {
    // Treated baseline is near zero - level-match at the low end instead: a
    // comparable comparison page must ALSO be near-zero (same rule
    // natural-controls.ts applies when treatedPreAvg is ~0).
    return { pass: candidate.baselineClicksPerDay < MIN_BASELINE_FOR_RATIO, ratio: null };
  }
  return {
    pass: ratio >= BASELINE_SIMILARITY_RATIO.min && ratio <= BASELINE_SIMILARITY_RATIO.max,
    ratio,
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank + filter comparison-page candidates for one treated page. PURE.
 *
 * Order of checks per candidate (first failure wins the exclusion reason):
 *   1. query overlap (SUTVA) - a cannibalizing sibling is disqualified outright
 *   2. baseline-similarity band - comparable scale
 *   3. trend-slope divergence - comparable pre-ship trajectory
 *
 * A null similarity/overlap input (read failed) always PASSES that check -
 * fail-soft never excludes on missing data.
 *
 * When fewer than `minSurvivors` candidates pass every check, this widens to
 * a best-available fallback: every candidate is scored by how far it sits
 * from the bands (0 = perfect), and the closest `minSurvivors` (or however
 * many candidates exist, if fewer) are kept with `usedFallback: true` so the
 * caller can render the honest "read cautiously" sentence. Excluded-only
 * results are never manufactured when ANY candidates were supplied.
 */
export function rankControlCandidates(args: {
  treated: TreatedPageStats;
  candidates: ReadonlyArray<ControlCandidateStats>;
  minSurvivors?: number;
  maxKept?: number;
}): RankControlsResult {
  const minSurvivors = args.minSurvivors ?? MIN_SURVIVORS;
  const maxKept = args.maxKept ?? 3;

  const scored = args.candidates.map((c) => {
    const overlap = c.queryOverlap;
    const overlapFails = overlap !== null && overlap > MAX_QUERY_OVERLAP;

    const { pass: baselinePass, ratio } = passesBaseline(args.treated, c);
    const divergence = trendSlopeDivergence(args.treated.preSlope, c.preSlope);
    const trendFails = divergence > MAX_TREND_SLOPE_DIVERGENCE;

    let verdict: ControlVerdict = "kept";
    let reason = "matched on scale and trend, low query overlap with this page";

    if (overlapFails) {
      verdict = "excluded";
      reason = `shares ${Math.round((overlap as number) * 100)} percent of its search demand with this page (over the ${Math.round(MAX_QUERY_OVERLAP * 100)} percent limit), so a title win here would steal its clicks`;
    } else if (!baselinePass) {
      verdict = "excluded";
      reason =
        ratio === null
          ? "its own traffic level is not near zero like this page's, so it is not a comparable scale"
          : `its traffic level is ${ratio < 1 ? "far below" : "far above"} this page's (ratio ${ratio.toFixed(2)}), so its normal drift would swamp the signal`;
    } else if (trendFails) {
      verdict = "excluded";
      reason = `it was trending differently before the ship (slope gap ${divergence.toFixed(2)} clicks per day), so it was not moving like this page`;
    }

    // Fallback distance: how far past each threshold this candidate sits,
    // used ONLY when the strict pass leaves too few survivors. 0 = clean.
    const overlapDistance = overlap !== null ? Math.max(0, overlap - MAX_QUERY_OVERLAP) : 0;
    const baselineDistance =
      ratio === null
        ? Math.max(0, c.baselineClicksPerDay - MIN_BASELINE_FOR_RATIO)
        : Math.max(0, BASELINE_SIMILARITY_RATIO.min - ratio, ratio - BASELINE_SIMILARITY_RATIO.max);
    const trendDistance = Math.max(0, divergence - MAX_TREND_SLOPE_DIVERGENCE);
    const fallbackScore = overlapDistance * 10 + baselineDistance + trendDistance;

    return {
      url: c.url,
      similarityRatio: ratio,
      slopeDivergence: round(divergence),
      queryOverlap: overlap,
      verdict,
      reason,
      fallbackScore,
    };
  });

  const kept = scored.filter((s) => s.verdict === "kept");

  if (kept.length >= minSurvivors || args.candidates.length === 0) {
    const ranked = [...kept].sort((a, b) => a.fallbackScore - b.fallbackScore).slice(0, maxKept);
    return {
      kept: ranked.map(stripScore),
      all: scored.map(stripScore),
      usedFallback: false,
    };
  }

  // Fail-soft widening: too few (or zero) strict survivors but candidates
  // exist - prefer the least-bad candidates over leaving the ship with no
  // comparison pages at all. Never re-admit a query-overlap exclusion above
  // the SUTVA limit; a cannibalizing sibling stays excluded even in fallback
  // (it would actively corrupt the read, not just weaken it).
  const widenable = scored.filter((s) => {
    const overlap = s.queryOverlap;
    return overlap === null || overlap <= MAX_QUERY_OVERLAP;
  });
  const fallbackKept = [...widenable]
    .sort((a, b) => a.fallbackScore - b.fallbackScore)
    .slice(0, Math.max(minSurvivors, Math.min(maxKept, widenable.length)));
  const fallbackKeptUrls = new Set(fallbackKept.map((s) => s.url));

  const allWithFallback = scored.map((s) =>
    fallbackKeptUrls.has(s.url) && s.verdict === "excluded"
      ? { ...s, verdict: "kept" as ControlVerdict, reason: `${s.reason} (kept anyway - not enough closely matched comparison pages were available)` }
      : s,
  );

  return {
    kept: allWithFallback.filter((s) => fallbackKeptUrls.has(s.url)).map(stripScore),
    all: allWithFallback.map(stripScore),
    usedFallback: true,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function stripScore(s: RankedControl & { fallbackScore: number }): RankedControl {
  const { fallbackScore: _drop, ...rest } = s;
  return rest;
}
