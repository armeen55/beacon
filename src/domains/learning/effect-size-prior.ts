/**
 * effect-size-prior (BEACON_500 R5 / N15, 2026-07-03) - the MAGNITUDE half of the
 * learning loop. The win-rate prior (experiment-prior.ts) learns how OFTEN a kind
 * of change wins; this module learns how MUCH a kind of change moved clicks when
 * it settled, per (lever family x page-type band) bucket, and turns that into a
 * SECOND bounded multiplier applied at the same post-score seam (OUTSIDE the pure
 * scorer, exactly like applyExperimentPriorToMoves).
 *
 * Design guarantees (same discipline as experiment-prior.ts, tuned per R5):
 *  - INFLUENCE, NOT DOMINATE: the multiplier is clamped to [0.8, 1.3]. A learned
 *    magnitude tilts ties; it never vaults a low-demand Move over a high-demand
 *    one, and the raw MoveComponents / candidate opportunity math are NEVER touched.
 *  - DECIDED ROWS ONLY: observations come from settled won/lost outcomes per the
 *    lifecycle DECIDED rule (the load edge, load-experiment-outcomes.ts, applies
 *    the SAME maturity + weather + parallel-trends gate the win-rate prior uses,
 *    so a 7-day read or a shock-window read can never train a magnitude).
 *  - SHRINKAGE, NOT RAW AVERAGES: each bucket's recency-weighted mean is shrunk
 *    toward the site-wide mean by EFFECT_SHRINKAGE_WEIGHT pseudo-observations
 *    (normal shrinkage), so a bucket with 3 outcomes moves ranking gently, and a
 *    bucket with 30 speaks close to its own average.
 *  - RECENCY: observations decay with a ~90 day half-life, so what worked last
 *    quarter matters less than what worked this month.
 *  - BACKOFF LADDER: (lever x pageType) bucket needs >= MIN_EFFECT_SAMPLES (3)
 *    decided samples, else the parent (lever alone) bucket, else the site-wide
 *    bucket, else neutral. When NO level clears the bar the apply function
 *    returns the input ranking byte-identical (pinned by test).
 *  - The SITE level anchors the multiplier but carries a null tag: a site-wide
 *    average argues nothing about one specific card, so surfaces stay quiet
 *    (self-hiding) instead of stamping the same generic line on every card.
 *  - READ-ONLY over the ledger: nothing here (or in its load edge) ever mutates
 *    measurement history. Recomputed from settled outcomes on every run.
 *
 * PURE / deterministic / no I/O. Pinned by effect-size-prior.test.ts.
 */

import type { MoveCandidate } from "@/domains/demand-graph/build-graph";

/** Bounded multiplier band for the effect-size prior (R5 spec: 0.8 to 1.3). */
export const EFFECT_MIN_MULTIPLIER = 0.8;
export const EFFECT_MAX_MULTIPLIER = 1.3;

/** Minimum DECIDED observations (with a usable magnitude) a level needs before
 *  its shrunken effect is trusted to move ranking. Below this -> back off. */
export const MIN_EFFECT_SAMPLES = 3;

/** Recency half-life in days: an observation this old counts half as much. */
export const EFFECT_HALF_LIFE_DAYS = 90;

/** Normal-shrinkage strength: the bucket mean is blended with this many
 *  pseudo-observations of the site-wide mean, so thin buckets stay close to
 *  what the whole site has shown. */
export const EFFECT_SHRINKAGE_WEIGHT = 3;

/** Per-observation clamp on the relative lift (a +400% outlier counts as
 *  +100%), so one lucky page can never own a bucket's average. */
export const MAX_ABS_RELATIVE_LIFT = 1;

/** Minimum window-scaled baseline clicks before a relative (percent) read is
 *  honest. Below this the observation is skipped, never fabricated. */
export const MIN_BASELINE_CLICKS_FOR_RELATIVE = 3;

/** One settled outcome's magnitude, reduced to what the table needs. */
export type EffectObservation = {
  /** Canonical lever family (experiment-prior.ts's canonicalMoveType space). */
  leverFamily: string;
  /** Coarse page-type band (experiment-prior.ts's pageTypeFromUrl space). */
  pageType?: string;
  /** Relative CLICKS lift vs the window-scaled baseline (+0.12 = +12 percent),
   *  already clamped to [-MAX_ABS_RELATIVE_LIFT, +MAX_ABS_RELATIVE_LIFT]. */
  relativeLift: number;
  /** ISO timestamp the outcome settled (recency weighting). */
  settledAt: string;
};

/** The resolved effect prior applied to one Move/candidate. */
export type EffectPrior = {
  /** Clamped [EFFECT_MIN_MULTIPLIER, EFFECT_MAX_MULTIPLIER]. */
  multiplier: number;
  /** Decided observations at the resolved level. */
  sample: number;
  /** The level that earned it: "lever:pageType", "lever", or "site". Null = neutral. */
  basis: string | null;
  /** Plain one-liner for the card, or null (site-level and neutral are silent). */
  tag: string | null;
};

export const NEUTRAL_EFFECT_PRIOR: EffectPrior = { multiplier: 1, sample: 0, basis: null, tag: null };

// ---------------------------------------------------------------------------
// Magnitude extraction (pure; shaped for a ShippedChangeRecord-like row)
// ---------------------------------------------------------------------------

/**
 * The settled row's relative CLICKS lift: the basis window's control-adjusted
 * clicks lift divided by the baseline clicks pro-rated to that window's length.
 * Clicks is deliberately the ONE unit for every lever (a title test is judged
 * on CTR, but the money it earns is clicks), so magnitudes pool honestly across
 * buckets. Null (skip, never fabricate) when no window has closed or the
 * window-scaled baseline is under MIN_BASELINE_CLICKS_FOR_RELATIVE clicks (a
 * percent of nearly nothing is noise, not a magnitude). PURE.
 */
export function relativeClicksLift(record: {
  windows: ReadonlyArray<{ day: number; ran: boolean; adjustedLift: number }>;
  baseline?: { clicks?: number | null; windowDays?: number | null } | null;
}): number | null {
  const basis = [...(record.windows ?? [])].filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
  if (!basis) return null;
  const baselineClicks = record.baseline?.clicks ?? 0;
  const baselineWindowDays =
    record.baseline?.windowDays && record.baseline.windowDays > 0 ? record.baseline.windowDays : 28;
  const scaledBaseline = baselineClicks * (basis.day / baselineWindowDays);
  if (scaledBaseline < MIN_BASELINE_CLICKS_FOR_RELATIVE) return null;
  const rel = basis.adjustedLift / scaledBaseline;
  return Math.max(-MAX_ABS_RELATIVE_LIFT, Math.min(MAX_ABS_RELATIVE_LIFT, rel));
}

// ---------------------------------------------------------------------------
// Table (shrunken estimates per level)
// ---------------------------------------------------------------------------

/** Recency weight: 0.5^(ageDays / EFFECT_HALF_LIFE_DAYS). An unparseable date
 *  gets full weight (honest default; never silently zeroes real evidence). */
export function recencyWeight(settledAt: string, now: Date): number {
  const t = Date.parse(settledAt);
  if (!Number.isFinite(t)) return 1;
  const ageDays = Math.max(0, (now.getTime() - t) / 86_400_000);
  return Math.pow(0.5, ageDays / EFFECT_HALF_LIFE_DAYS);
}

export type EffectCell = {
  key: string;
  /** Raw decided-observation count at this level. */
  sample: number;
  /** Summed recency weight. */
  weight: number;
  /** Recency-weighted mean relative lift (unshrunken). */
  mean: number;
  /** Shrunk toward the site mean (the site cell's own shrunken == its mean). */
  shrunken: number;
};

export type EffectSizeTable = {
  /** `${leverFamily}::${pageType}` -> cell. Only levels with >= MIN_EFFECT_SAMPLES appear. */
  cells: Map<string, EffectCell>;
  /** `${leverFamily}` -> cell. Same sample floor. */
  parents: Map<string, EffectCell>;
  /** Site-wide anchor. Null when the whole ledger has < MIN_EFFECT_SAMPLES
   *  usable decided outcomes -> nothing may fire, apply is byte-identical. */
  site: EffectCell | null;
};

export function effectCellKey(leverFamily: string, pageType: string): string {
  return `${leverFamily}::${pageType}`;
}

type Acc = { sample: number; weight: number; weightedSum: number };
const newAcc = (): Acc => ({ sample: 0, weight: 0, weightedSum: 0 });

/** Build the per-level shrunken-effect table from decided observations. PURE. */
export function computeEffectSizeTable(
  observations: readonly EffectObservation[],
  now: Date,
): EffectSizeTable {
  const cellAcc = new Map<string, Acc>();
  const parentAcc = new Map<string, Acc>();
  const siteAcc = newAcc();

  for (const o of observations) {
    if (!o.leverFamily) continue;
    const w = recencyWeight(o.settledAt, now);
    if (w <= 0) continue;
    const add = (acc: Acc) => {
      acc.sample += 1;
      acc.weight += w;
      acc.weightedSum += w * o.relativeLift;
    };
    add(siteAcc);
    let p = parentAcc.get(o.leverFamily);
    if (!p) parentAcc.set(o.leverFamily, (p = newAcc()));
    add(p);
    if (o.pageType) {
      const key = effectCellKey(o.leverFamily, o.pageType);
      let c = cellAcc.get(key);
      if (!c) cellAcc.set(key, (c = newAcc()));
      add(c);
    }
  }

  if (siteAcc.sample < MIN_EFFECT_SAMPLES || siteAcc.weight <= 0) {
    return { cells: new Map(), parents: new Map(), site: null };
  }

  const siteMean = siteAcc.weightedSum / siteAcc.weight;
  const site: EffectCell = {
    key: "site",
    sample: siteAcc.sample,
    weight: siteAcc.weight,
    mean: siteMean,
    shrunken: siteMean, // the anchor shrinks toward nothing further
  };

  const shrink = (key: string, acc: Acc): EffectCell => ({
    key,
    sample: acc.sample,
    weight: acc.weight,
    mean: acc.weightedSum / acc.weight,
    // Normal shrinkage toward the site mean: K pseudo-observations of the anchor.
    shrunken:
      (acc.weightedSum + EFFECT_SHRINKAGE_WEIGHT * siteMean) /
      (acc.weight + EFFECT_SHRINKAGE_WEIGHT),
  });

  const cells = new Map<string, EffectCell>();
  for (const [key, acc] of cellAcc) {
    if (acc.sample < MIN_EFFECT_SAMPLES || acc.weight <= 0) continue;
    cells.set(key, shrink(key, acc));
  }
  const parents = new Map<string, EffectCell>();
  for (const [key, acc] of parentAcc) {
    if (acc.sample < MIN_EFFECT_SAMPLES || acc.weight <= 0) continue;
    parents.set(key, shrink(key, acc));
  }
  return { cells, parents, site };
}

// ---------------------------------------------------------------------------
// Resolution + the plain-language tag
// ---------------------------------------------------------------------------

function clampEffectMultiplier(n: number): number {
  return Math.max(EFFECT_MIN_MULTIPLIER, Math.min(EFFECT_MAX_MULTIPLIER, n));
}

/** Plain-language magnitude line. Beacon voice: a concrete number, no lab
 *  words, no em or en dashes. e.g. "Changes like this earned about +12
 *  percent clicks on average across 4 finished tests". PURE. */
export function effectTag(shrunken: number, sample: number, pageType?: string): string {
  const pct = Math.round(shrunken * 100);
  const scope = pageType
    ? `Changes like this on ${pageType.replace(/[-_]+/g, " ")} pages`
    : "Changes like this";
  const tests = `${sample} finished test${sample === 1 ? "" : "s"}`;
  if (pct > 0) return `${scope} earned about +${pct} percent clicks on average across ${tests}`;
  if (pct < 0) return `${scope} cost about ${Math.abs(pct)} percent of clicks on average across ${tests}`;
  return `${scope} barely moved clicks across ${tests}`;
}

/**
 * Resolve ONE Move/candidate's effect prior via the backoff ladder:
 * (lever x pageType) -> lever -> site -> neutral. The site level still anchors
 * the multiplier but its tag is null (a site-wide average argues nothing about
 * one specific card - surfaces self-hide). PURE.
 */
export function resolveEffectPrior(
  dims: { leverFamily?: string; pageType?: string },
  table: EffectSizeTable,
): EffectPrior {
  if (table.site == null) return NEUTRAL_EFFECT_PRIOR;
  const lever = dims.leverFamily;
  if (lever && dims.pageType) {
    const cell = table.cells.get(effectCellKey(lever, dims.pageType));
    if (cell) {
      return {
        multiplier: clampEffectMultiplier(1 + cell.shrunken),
        sample: cell.sample,
        basis: cell.key,
        tag: effectTag(cell.shrunken, cell.sample, dims.pageType),
      };
    }
  }
  if (lever) {
    const parent = table.parents.get(lever);
    if (parent) {
      return {
        multiplier: clampEffectMultiplier(1 + parent.shrunken),
        sample: parent.sample,
        basis: parent.key,
        tag: effectTag(parent.shrunken, parent.sample),
      };
    }
  }
  return {
    multiplier: clampEffectMultiplier(1 + table.site.shrunken),
    sample: table.site.sample,
    basis: "site",
    tag: null, // deliberately silent - see module doc
  };
}

/**
 * Apply the effect-size prior to a ranked Move list, OUTSIDE the pure scorer.
 * PURE. Mirrors applyExperimentPriorToMoves: multiplies each Move's final
 * `score` by its resolved (bounded) multiplier, attaches `effectPrior` for the
 * UI, re-sorts. Raw `components` are never touched. When NO level clears
 * MIN_EFFECT_SAMPLES the input ranking is returned byte-identical (same order,
 * same scores, no fields attached) - zero behavior change until there is real
 * magnitude evidence.
 */
export function applyEffectSizePriorToMoves(
  moves: readonly MoveCandidate[],
  observations: readonly EffectObservation[],
  resolveDims: (m: MoveCandidate) => { leverFamily?: string; pageType?: string },
  now: Date = new Date(),
): MoveCandidate[] {
  const table = computeEffectSizeTable(observations, now);
  if (table.site == null) return [...moves]; // thin everywhere -> byte-identical
  const out = moves.map((m) => {
    const prior = resolveEffectPrior(resolveDims(m), table);
    if (prior.multiplier === 1) return { ...m, effectPrior: prior };
    return {
      ...m,
      score: Math.max(0, Math.round(m.score * prior.multiplier)),
      effectPrior: prior,
    };
  });
  out.sort((a, b) => b.score - a.score);
  return out;
}
