/**
 * tenant-ctr-curve (BEACON_500 R9 / P3, 2026-07-03) - the ONE position-to-clicks model.
 *
 * Before this module, FIVE rival position-to-CTR tables lived across the codebase
 * (pick-expectations.ts, daily-experiment-planner.ts, recommendation-intelligence/
 * ctr-curve.ts, triggers/gsc-low-ctr.ts, page-surgeon/expected-ctr.ts), each with
 * slightly different numbers, and none of them learned from the tenant's OWN data.
 * This module consolidates all of them:
 *
 *  - DEFAULT_CTR_BY_POSITION / defaultExpectedCtrAt: the single industry default,
 *    byte-identical to the values pick-expectations.ts and the daily planner have
 *    always used, so every consumer that passes no tenant curve behaves EXACTLY
 *    as before (pinned by tests).
 *  - PUBLISHED_TOP5_CTR_BENCHMARK: the published positions-1-to-5 industry
 *    benchmark the gsc_low_ctr trigger calibrates against. Kept as a NAMED,
 *    separate table because it is research-derived trigger calibration, not a
 *    forecast assumption - but it now lives here so there is one file to read
 *    when asking "what CTR does Beacon assume".
 *  - fitTenantCtrCurve: fits a position-to-CTR curve from the tenant's OWN
 *    Search Console query aggregates (per-bucket median CTR with honest sample
 *    floors, brand queries excluded), interpolating thin buckets and falling
 *    back to the industry default with an honest basis tag when the tenant does
 *    not have enough of their own data yet.
 *
 * Customer copy rule: the basis strings here are plain English ("your own search
 * data", "industry default"), never lab words. Surfaces render them as "based on
 * how your own pages convert position to clicks".
 *
 * PURE, no I/O. The loader edge is load-tenant-ctr-curve.ts.
 */

// R17a (P2 GSC depth pack): the brand-token logic R9 built here is now owned by
// the ONE canonical brand module (domains/evidence/gsc/brand-split.ts) so the CTR-curve
// fit and the brand/non-brand click split can never disagree on what counts as
// a brand query. Imported for the fit below and re-exported for existing
// consumers of this module - byte-identical behavior.
import { brandTokensFor, isBrandQuery } from "@/domains/evidence/gsc/brand-split";

export { brandTokensFor, isBrandQuery };

/** The single industry-default organic CTR by integer position (1-10). These are
 *  EXACTLY the values pick-expectations.ts's CTR_CURVE has always used - the
 *  default path everywhere must stay byte-identical (pinned by tests). */
const DEFAULT_CTR_BY_POSITION: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.065, 6: 0.05, 7: 0.04, 8: 0.034, 9: 0.029, 10: 0.025,
};

/** Tail bands past position 10 (same values expectedCtrAt has always returned). */
const TAIL_11_15 = 0.018;
const TAIL_16_20 = 0.012;
const TAIL_21_PLUS = 0.006;

/** The industry-default expected organic CTR at a Google position. Byte-identical
 *  to the pre-R9 pick-expectations.ts expectedCtrAt for every input. */
export function defaultExpectedCtrAt(position: number): number {
  const p = Math.round(position);
  if (p <= 0) return DEFAULT_CTR_BY_POSITION[1]!;
  if (p <= 10) return DEFAULT_CTR_BY_POSITION[p]!;
  if (p <= 15) return TAIL_11_15;
  if (p <= 20) return TAIL_16_20;
  return TAIL_21_PLUS;
}

// ---------------------------------------------------------------------------
// The tenant curve
// ---------------------------------------------------------------------------

export type TenantCtrCurve = {
  /** Expected organic CTR at a (possibly fractional) Google position. */
  expectedCtrAt: (position: number) => number;
  /** "tenant" = fitted from the tenant's own search data; "default" = the
   *  industry default (not enough of their own data yet). */
  source: "tenant" | "default";
  /** Plain-English basis for customer copy. Never a lab word, never a dash. */
  basis: string;
  /** ISO timestamp of the fit. */
  fittedAt: string;
  /** Distinct queries the fit saw (0 on the default curve). */
  queries: number;
  /** Total impressions the fit saw (0 on the default curve). */
  impressions: number;
};

