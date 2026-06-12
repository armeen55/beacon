/**
 * expected-value — turn the Move Forecast into a prioritization signal
 * (2026-06-11). The plan's "$499 expected-value engine": don't just show the
 * odds per Move, RANK the queue by expected payoff so the owner spends the
 * next dev hour where it's most likely to move AI citations.
 *
 * EV is honest + bounded: it combines the causal self-forecast's empirical
 * base rate (`helpingRate`, 0..1) with the typical magnitude among the
 * priors that DID help (`typicalRelativeLift`, a relative lift). The product
 * is an expected RELATIVE lift — "probability it helps × how much it helped
 * when it did." It is NOT a fabricated absolute number, and it's `null` (not
 * 0) whenever the forecast can't speak (no causal-grade history for that
 * Move's reference class) — so "unknown" never masquerades as "low value".
 *
 * Pure, deterministic. No I/O, no LLM. Pinned by expected-value.test.ts.
 */

import type { CausalSelfForecast } from "./causal-self-forecast";

/**
 * Expected relative citation lift for a Move, or null when there's no causal-
 * grade history to forecast from. Rounded to 3dp. `typicalRelativeLift` is
 * null when no helped prior carried a relative figure → EV is null (we won't
 * invent a magnitude from a bare helping-rate).
 */
export function expectedRelativeLift(
  forecast: CausalSelfForecast | null,
): number | null {
  if (!forecast || forecast.typicalRelativeLift == null) return null;
  return Math.round(forecast.helpingRate * forecast.typicalRelativeLift * 1000) / 1000;
}

export type EvTier = "high" | "moderate" | "low" | "unknown";

/** Coarse band for at-a-glance sorting/labelling. `unknown` = no forecast. */
export function evTier(ev: number | null): EvTier {
  if (ev == null) return "unknown";
  if (ev >= 0.3) return "high";
  if (ev >= 0.1) return "moderate";
  return "low";
}

export type RankedMove<T> = {
  move: T;
  forecast: CausalSelfForecast | null;
  /** Expected relative lift, or null when unforecastable. */
  ev: number | null;
  tier: EvTier;
};

/**
 * Rank Moves by expected value, highest first. Moves with no forecast (ev
 * null) sort LAST (after every forecastable Move), preserving their input
 * order among themselves (stable). Ties broken by helpingRate then sampleSize
 * so a better-evidenced Move outranks a thinly-evidenced one at equal EV.
 */
export function rankByExpectedValue<T>(
  items: ReadonlyArray<{ move: T; forecast: CausalSelfForecast | null }>,
): RankedMove<T>[] {
  return items
    .map((it, index) => ({
      move: it.move,
      forecast: it.forecast,
      ev: expectedRelativeLift(it.forecast),
      tier: evTier(expectedRelativeLift(it.forecast)),
      _index: index,
    }))
    .sort((a, b) => {
      // Forecastable Moves always rank above unforecastable ones.
      const aHas = a.ev != null;
      const bHas = b.ev != null;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (!aHas && !bHas) return a._index - b._index; // stable for unknowns
      if (b.ev! !== a.ev!) return b.ev! - a.ev!;
      const ahr = a.forecast?.helpingRate ?? 0;
      const bhr = b.forecast?.helpingRate ?? 0;
      if (bhr !== ahr) return bhr - ahr;
      const asz = a.forecast?.sampleSize ?? 0;
      const bsz = b.forecast?.sampleSize ?? 0;
      if (bsz !== asz) return bsz - asz;
      return a._index - b._index;
    })
    .map(({ move, forecast, ev, tier }) => ({ move, forecast, ev, tier }));
}
