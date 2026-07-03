/**
 * title-signal-retrain (BEACON_500 R9 / P3, 2026-07-03) - retrain the CTR title
 * scorer's click-signal weights from the tenant's OWN settled title tests.
 *
 * The deterministic title scorer (demand-graph/ctr-title-scorer.ts) rewards a
 * leading number, a parenthetical, a power word, the brand, and the length sweet
 * spot with fixed points. Those defaults are sensible priors, but once the proof
 * ledger holds real settled title tests (measured clicks lift vs comparison
 * pages), the tenant's own results should tilt them: if number-led titles keep
 * winning HERE, the number cue earns more weight HERE.
 *
 * Same discipline as effect-size-prior.ts (read it first; this mirrors it):
 *  - DECIDED ROWS ONLY: observations come through the identical maturity /
 *    weather / parallel-trends gate (load-experiment-outcomes.ts builds them).
 *  - >= MIN_TILT_SAMPLES (3) observations total AND per signal, else that
 *    signal stays neutral - thin data self-neutralizes (pinned byte-identical).
 *  - SHRINKAGE: a signal's recency-weighted mean lift is shrunk toward the
 *    all-titles mean by TILT_SHRINKAGE_WEIGHT pseudo-observations, so 3 lucky
 *    tests tilt gently and 30 speak close to their own average.
 *  - CLAMP: each weight multiplier is clamped to [0.8, 1.3] - a tilt influences
 *    ranking between title variants, it never rewrites the scorer.
 *  - RECENCY: the same ~90 day half-life as the effect-size prior.
 *
 * PURE, no I/O. Pinned by title-signal-retrain.test.ts.
 */

import {
  BASE_TITLE_SIGNAL_WEIGHTS,
  type TitleSignalWeights,
} from "@/domains/demand-graph/ctr-title-scorer";
import { recencyWeight } from "./effect-size-prior";

/** Bounded multiplier band per signal weight (same posture as the effect prior). */
export const TILT_MIN_MULTIPLIER = 0.8;
export const TILT_MAX_MULTIPLIER = 1.3;

/** Minimum DECIDED settled title tests, both overall and carrying a given
 *  signal, before that signal's weight may move. Below this -> neutral. */
export const MIN_TILT_SAMPLES = 3;

/** Normal-shrinkage strength: a signal's mean is blended with this many
 *  pseudo-observations of the all-titles mean. */
export const TILT_SHRINKAGE_WEIGHT = 3;

/** One settled title test: the signals the SHIPPED title carried (the scorer's
 *  own signal vocabulary: "number", "parenthetical", "power-word", "brand",
 *  "length-sweet") plus its measured relative clicks lift and settle date. */
export type TitleSignalObservation = {
  signals: readonly string[];
  /** Relative clicks lift vs the window-scaled baseline, already clamped by
   *  the ledger edge (effect-size-prior.ts relativeClicksLift). */
  relativeLift: number;
  /** ISO timestamp the test settled (recency weighting). */
  settledAt: string;
};

/** Scorer signal string -> the weight key it retrains. Signals outside this map
 *  (full-query, too-long, ...) are structural, never retrained. */
const SIGNAL_TO_WEIGHT_KEY: Record<string, keyof TitleSignalWeights> = {
  "number": "number",
  "parenthetical": "parenthetical",
  "power-word": "powerWord",
  "brand": "brand",
  "length-sweet": "lengthSweet",
};

/** Per-weight-key multiplier, present ONLY for keys that earned a real tilt. */
export type TitleSignalTilts = Partial<Record<keyof TitleSignalWeights, number>>;

function clampTilt(n: number): number {
  return Math.max(TILT_MIN_MULTIPLIER, Math.min(TILT_MAX_MULTIPLIER, n));
}

/**
 * Compute the bounded per-signal tilts from settled title tests. PURE.
 * Returns {} (fully neutral) when the ledger is thin - fewer than
 * MIN_TILT_SAMPLES decided title tests overall, or per signal.
 */
export function computeTitleSignalTilts(
  observations: readonly TitleSignalObservation[],
  now: Date = new Date(),
): TitleSignalTilts {
  if (observations.length < MIN_TILT_SAMPLES) return {};

  type Acc = { sample: number; weight: number; weightedSum: number };
  const accs = new Map<keyof TitleSignalWeights, Acc>();
  let totalWeight = 0;
  let totalSum = 0;

  for (const o of observations) {
    if (!Number.isFinite(o.relativeLift)) continue;
    const w = recencyWeight(o.settledAt, now);
    if (w <= 0) continue;
    totalWeight += w;
    totalSum += w * o.relativeLift;
    const keys = new Set<keyof TitleSignalWeights>();
    for (const s of o.signals) {
      const key = SIGNAL_TO_WEIGHT_KEY[s];
      if (key) keys.add(key);
    }
    for (const key of keys) {
      let acc = accs.get(key);
      if (!acc) accs.set(key, (acc = { sample: 0, weight: 0, weightedSum: 0 }));
      acc.sample += 1;
      acc.weight += w;
      acc.weightedSum += w * o.relativeLift;
    }
  }

  if (totalWeight <= 0) return {};
  const overallMean = totalSum / totalWeight;

  const out: TitleSignalTilts = {};
  for (const [key, acc] of accs) {
    if (acc.sample < MIN_TILT_SAMPLES || acc.weight <= 0) continue; // thin signal -> neutral
    // Normal shrinkage toward the all-titles mean, then the tilt is the shrunken
    // EXCESS lift of titles carrying this signal over titles in general.
    const shrunken =
      (acc.weightedSum + TILT_SHRINKAGE_WEIGHT * overallMean) /
      (acc.weight + TILT_SHRINKAGE_WEIGHT);
    const multiplier = clampTilt(1 + (shrunken - overallMean));
    if (multiplier !== 1) out[key] = multiplier;
  }
  return out;
}

/**
 * Apply the tilts to the base weights. PURE. Empty tilts return the base object
 * ITSELF (reference-equal), so the thin-data path is provably byte-identical to
 * the untouched scorer (pinned by test).
 */
export function retrainedTitleWeights(
  tilts: TitleSignalTilts,
  base: TitleSignalWeights = BASE_TITLE_SIGNAL_WEIGHTS,
): TitleSignalWeights {
  const keys = Object.keys(tilts) as Array<keyof TitleSignalWeights>;
  if (keys.length === 0) return base;
  const out: TitleSignalWeights = { ...base };
  for (const key of keys) {
    const m = clampTilt(tilts[key] ?? 1);
    out[key] = Math.round(base[key] * m * 100) / 100;
  }
  return out;
}
