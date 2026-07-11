/**
 * C4 floor calibration (runbook step 5). CALIBRATION SET ONLY.
 *
 * floor(lane, window, tier) = max(minFloor, p95 of |stat| over the tier's
 * calibration placebo statistics), with the protocol's LOO stability rule:
 * if dropping any single unit moves the floor by more than 20 percent, the
 * floor is unstable and is widened to the LOO maximum. A tier with fewer
 * than minUnitsPerTier calibration units is NOT calibrated: its verdicts
 * render no_clear_effect only (C3).
 */

import type { FloorEntry } from "./types";
import { percentileInterpolated } from "./stats";

export const FLOOR_PERCENTILE = 0.95;
export const LOO_WIDEN_THRESHOLD = 0.2;
/** Minimum calibration units for a trustworthy per-tier floor. 15, not 20:
 *  the protocol's hard 20-unit rule (2.6) governs EVALUATION certificates
 *  (enforced in step 8's gate), while the calibration-side floor bar rests
 *  on the LOO stability rule; at the census pool size (P = 74) a 20 bar
 *  left the primary 28 day window entirely uncalibrated at n = 19. Chosen
 *  from census counts before the lock; recorded in the freeze log. */
export const MIN_CALIBRATION_UNITS_PER_TIER = 15;

export function calibrateFloor(args: {
  /** Calibration placebo statistics for this (lane, window, tier). */
  stats: ReadonlyArray<number>;
  minFloor: number;
  minUnits?: number;
}): FloorEntry {
  const minUnits = args.minUnits ?? MIN_CALIBRATION_UNITS_PER_TIER;
  const absStats = args.stats.map((s) => Math.abs(s));
  const n = absStats.length;
  if (n < minUnits) {
    return { floor: args.minFloor, calibrated: false, n, widened: false };
  }
  const full = Math.max(args.minFloor, percentileInterpolated(absStats, FLOOR_PERCENTILE));
  let looMax = full;
  let unstable = false;
  for (let i = 0; i < n; i++) {
    const rest = absStats.slice(0, i).concat(absStats.slice(i + 1));
    const loo = Math.max(args.minFloor, percentileInterpolated(rest, FLOOR_PERCENTILE));
    if (loo > looMax) looMax = loo;
    if (full > 0 && Math.abs(loo - full) / full > LOO_WIDEN_THRESHOLD) unstable = true;
  }
  return {
    floor: unstable ? looMax : full,
    calibrated: true,
    n,
    widened: unstable && looMax > full,
  };
}
