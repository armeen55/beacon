/**
 * Page Surgeon — organic CTR-by-position curve (deterministic, generic).
 *
 * Single source of truth shared by packet assembly (page-level ctrGap) and the
 * decision gate (per-query snippet-deficit detection) so the two never drift.
 * Pure. No I/O, no tenant literals.
 */

/** Industry-standard organic CTR-by-position curve. */
export const EXPECTED_CTR_BY_POSITION: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.1, 4: 0.07, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.035, 9: 0.03, 10: 0.028,
};

/** Expected organic CTR for a (possibly fractional) position. Flat 2% past
 *  position 10 — coarse on purpose, so it's a floor, not a precise model. */
export function expectedCtrForPosition(pos: number): number {
  const r = Math.max(1, Math.round(pos));
  return EXPECTED_CTR_BY_POSITION[r] ?? 0.02;
}
