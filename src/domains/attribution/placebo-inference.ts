/**
 * Placebo (permutation) inference for the natural-controls diff-in-diff
 * estimate — the sourced hardening of the Proof Engine's `computed` claim
 * (see docs/PROOF_ENGINE_METHODOLOGY.md).
 *
 * THE IDEA (leave-one-out placebo): the engine's `adjusted_lift` is
 * `treatedΔ − mean(controlΔ)`. To ask "is this lift unusual, or just what
 * untreated pages do anyway?", treat each control URL in turn AS IF it were
 * the treated unit and compute its *pseudo-lift* against the mean of the
 * OTHER controls. The empirical p-value is the share of placebo pseudo-lifts
 * whose magnitude meets or exceeds the observed |adjusted_lift|. A small p
 * means few untreated pages moved as much as the treated one did by chance —
 * a stronger causal read than control-count alone.
 *
 * WHY THIS SHAPE:
 *   • Deterministic + PURE — exhaustive leave-one-out, no RNG, no seed, no
 *     I/O. So a `computed` outcome is reproducible run-to-run (the rails +
 *     the engine's determinism contract).
 *   • Consumes the SAME control Δs the engine already computes, so the
 *     p-value can never drift from the point estimate it qualifies.
 *   • Zero LLM / paid API.
 *
 * Sources (≥5; full list in docs/PROOF_ENGINE_METHODOLOGY.md):
 *   1. Cunningham, *Causal Inference: The Mixtape* ch.9 — placebo/permutation
 *      inference for difference-in-differences.
 *   2. Bertrand, Duflo & Mullainathan (2004), *How Much Should We Trust
 *      Differences-in-Differences Estimates?* (NBER t0312) — placebo laws.
 *   3. Conley & Taber (2011), *Inference with DiD with a Small Number of
 *      Policy Changes* — inference from a large pool of non-changers.
 *   4. Donald & Lang (2007) — small-number-of-groups inference.
 *   5. Roth, Sant'Anna et al. (2023), *What's Trending in DiD?* — modern
 *      synthesis incl. randomization/permutation inference.
 */

/**
 * Leave-one-out placebo p-value for a diff-in-diff lift.
 *
 * @param adjustedLift  the observed `treatedΔ − mean(controlΔ)`.
 * @param controlDeltas each comparable untreated URL's post−pre Δ (the same
 *                      values the engine averaged to get `adjusted_lift`).
 * @returns p in [0,1], or `null` when there are fewer than 2 controls (no
 *          placebo distribution can be formed — caller keeps the honest
 *          control-count confidence tier instead).
 */
export function computePlaceboP(
  adjustedLift: number,
  controlDeltas: readonly number[],
): number | null {
  const n = controlDeltas.length;
  // A leave-one-out placebo needs ≥2 controls (one held out as pseudo-treated,
  // ≥1 remaining to form the comparison mean).
  if (n < 2) return null;

  const total = controlDeltas.reduce((sum, d) => sum + d, 0);
  const target = Math.abs(adjustedLift);

  let atLeastAsExtreme = 0;
  for (let i = 0; i < n; i++) {
    const di = controlDeltas[i]!;
    const meanOthers = (total - di) / (n - 1);
    const pseudoLift = di - meanOthers;
    if (Math.abs(pseudoLift) >= target) atLeastAsExtreme++;
  }
  return atLeastAsExtreme / n;
}

/**
 * Significance threshold below which a placebo p-value is considered strong
 * enough to support (alongside the control-count gate) a `high` confidence
 * read. 0.1 mirrors the engine's conservative posture for thin control pools
 * (Bertrand et al.'s caution against over-rejection with few groups).
 */
export const PLACEBO_P_HIGH_CONFIDENCE_MAX = 0.1;

/**
 * Convenience: does this lift clear the placebo significance bar? `false`
 * when undeterminable (`null` p) — never over-claims on thin evidence.
 */
export function isPlaceboSignificant(p: number | null): boolean {
  return p != null && p < PLACEBO_P_HIGH_CONFIDENCE_MAX;
}
