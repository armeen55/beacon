/**
 * ctr-curve (2026-06-25) — a PURE, deterministic organic-CTR-by-position model so
 * different rank signals share ONE honest currency: estimated monthly clicks at
 * stake. Used to rank a striking-distance opportunity (clicks you'd GAIN climbing
 * to the top) against a decline (clicks you've already LOST) on the same scale.
 *
 * The curve is a widely-cited industry approximation of average organic CTR by
 * SERP position (position 1 ~30%, decaying fast). It is a MODEL, not measured —
 * callers must label its output "potential / estimated", never as fact. No tenant
 * specifics, no Date dependency, fully testable.
 */

// Average organic CTR by integer position (1-indexed). Beyond the table → ~0.5%.
const CTR_BY_POSITION = [
  0.30, // 1
  0.15, // 2
  0.10, // 3
  0.07, // 4
  0.05, // 5
  0.04, // 6
  0.03, // 7
  0.025, // 8
  0.02, // 9
  0.018, // 10
  0.015, // 11
  0.013, // 12
  0.011, // 13
  0.01, // 14
  0.009, // 15
];
const TAIL_CTR = 0.005;

/** Estimated average organic CTR for a (possibly fractional) SERP position. */
export function estimatedCtr(position: number): number {
  if (!Number.isFinite(position) || position < 1) return CTR_BY_POSITION[0]!;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  const ctrAt = (p: number) => CTR_BY_POSITION[p - 1] ?? TAIL_CTR;
  if (lo === hi) return ctrAt(lo);
  // Linear interpolation between the two bracketing integer positions.
  const frac = position - lo;
  return ctrAt(lo) + (ctrAt(hi) - ctrAt(lo)) * frac;
}

/**
 * Estimated monthly clicks GAINED by moving a query from its current position to
 * a realistic target (default position 3 — a credible striking-distance goal, not
 * a fantasy #1). Never negative; 0 if already at/above target.
 */
export function clicksAtStakeForStriking(
  impressions: number,
  currentPosition: number,
  targetPosition = 3,
): number {
  if (!Number.isFinite(impressions) || impressions <= 0) return 0;
  const uplift = estimatedCtr(targetPosition) - estimatedCtr(currentPosition);
  if (uplift <= 0) return 0;
  return Math.round(impressions * uplift);
}
