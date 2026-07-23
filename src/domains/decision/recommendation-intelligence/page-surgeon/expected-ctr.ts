/**
 * Page Surgeon - organic CTR-by-position (deterministic).
 *
 * Single source shared by packet assembly (page-level ctrGap) and the decision
 * gate (per-query snippet-deficit detection) so the two never drift.
 *
 * R9 (2026-07-03): this file used to carry its OWN slightly-different curve
 * table (pos 4 at 7% vs 8%, a flat 2% tail, etc). It now delegates to the ONE
 * canonical curve module (tenant-ctr-curve.ts) - same default everywhere a
 * forecast or gap is computed, with an optional tenant-fitted curve a caller
 * with tenant context can thread in (load-tenant-ctr-curve.ts). Pure. No I/O.
 */

import {
  DEFAULT_CTR_BY_POSITION,
  defaultExpectedCtrAt,
  type TenantCtrCurve,
} from "@/domains/evidence/forecast/tenant-ctr-curve";

/** Re-export of the canonical industry-default table (positions 1-10). */
export const EXPECTED_CTR_BY_POSITION: Record<number, number> = DEFAULT_CTR_BY_POSITION;

/** Expected organic CTR for a (possibly fractional) position. Coarse tail bands
 *  past position 10, from the canonical curve. Pass the tenant's own fitted
 *  curve to read how THEIR pages convert position to clicks instead. */
export function expectedCtrForPosition(pos: number, curve?: TenantCtrCurve | null): number {
  const r = Math.max(1, Math.round(Number.isFinite(pos) ? pos : 1));
  return curve ? curve.expectedCtrAt(r) : defaultExpectedCtrAt(r);
}
