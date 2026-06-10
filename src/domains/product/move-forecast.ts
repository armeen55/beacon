/**
 * 2026-06-09 — Move Forecast composer (§ killer-feature half A,
 * "before you ship").
 *
 * The What-If engine (`whatif-engine.ts simulateAction`) speaks ONLY from
 * this tenant's own history; when that's thin it returns
 * `direction: "insufficient_data"` and says nothing useful. This pure
 * composer fills exactly that gap from the cross-tenant brain: "N similar
 * changes other businesses shipped had a positive outcome X% of the time."
 *
 * Discipline (mirrors natural-controls' computed-vs-weak_estimate posture):
 *   • Fills in ONLY when this-tenant evidence is thin — when simulateAction
 *     can already speak, its first-party signal is better and we defer.
 *   • Honest sample floors: suppress entirely below FORECAST_SUPPRESS_BELOW
 *     peer attempts; flag `seeded` (early-signal caveat) below
 *     FORECAST_SEEDED_BELOW.
 *   • Returns `null` whenever there's nothing trustworthy to say — and the
 *     gate-first producer returns `[]` at n=1 / gate-off, so this is inert
 *     (always null) until a 2nd tenant exists AND BEACON_CROSS_TENANT_BRAIN
 *     is on. NO fake forecasts, NO causal claims (that's the Proof Engine).
 *
 * PURE (no I/O) — the caller supplies the producer's patterns + the
 * this-tenant result. Activation into a customer "Move" surface is deferred
 * with the rest of the cross-tenant-brain runtime (n≥2 + gate + a surface).
 *
 * Pinned by tests/domains/product/move-forecast.test.ts.
 */

import type { SimulationActionType, SimulationResult } from "./whatif-types";
import type { CrossTenantPattern } from "@/domains/recommendations/cross-tenant-brain";

/** Below this many aggregated peer attempts, say nothing at all. */
export const FORECAST_SUPPRESS_BELOW = 3;
/** Below this, render with an "early signal — still gathering" caveat. */
export const FORECAST_SEEDED_BELOW = 10;

export type MoveForecast = {
  kind: "peer_forecast";
  actionType: SimulationActionType;
  /** Cites the pattern by id (no tenant data leaks through). */
  patternId: string;
  /** 0..1 peer helping-outcome rate. */
  helpingRate: number;
  /** Aggregated peer shipped attempts (anonymized, cross-tenant). */
  sampleSize: number;
  /** True in the seeded band — render the early-signal caveat. */
  seeded: boolean;
  /** Customer-facing one-liner. Plain English, associative (not causal). */
  line: string;
};

export type BuildPeerMoveForecastArgs = {
  actionType: SimulationActionType;
  /**
   * This-tenant simulation result, or null if not computed. The forecast
   * fills in only when this is thin — `direction === "insufficient_data"`
   * (or null). When this-tenant evidence suffices, defer to simulateAction.
   */
  thisTenantResult: Pick<SimulationResult, "direction"> | null;
  /**
   * Patterns from the gate-first producer (`computeCrossTenantPatterns`).
   * Empty at n=1 / gate-off → this returns null (inert).
   */
  patterns: ReadonlyArray<CrossTenantPattern>;
};

/**
 * Compose a single peer-forecast line for a proposed Move, or null when
 * there is nothing honest to say.
 */
export function buildPeerMoveForecast(
  args: BuildPeerMoveForecastArgs,
): MoveForecast | null {
  // 1) Only fill the gap when this-tenant evidence is thin.
  const thin =
    args.thisTenantResult == null ||
    args.thisTenantResult.direction === "insufficient_data";
  if (!thin) return null;

  // 2) Patterns relevant to this action type. matchKey is a closed-vocab
  //    token string (e.g. "edit_type:add_faq"); relevant when it references
  //    the action type.
  const relevant = args.patterns.filter((p) =>
    p.matchKey.includes(args.actionType),
  );
  if (relevant.length === 0) return null;

  // 3) Strongest pattern: most peer attempts, then highest helping rate.
  const best = [...relevant].sort(
    (a, b) => b.sampleSize - a.sampleSize || b.helpingRate - a.helpingRate,
  )[0]!;

  // 4) Honesty floor: too few peer attempts → suppress.
  if (best.sampleSize < FORECAST_SUPPRESS_BELOW) return null;

  const seeded = best.sampleSize < FORECAST_SEEDED_BELOW;
  const pct = Math.round(best.helpingRate * 100);
  const line = seeded
    ? `Early signal — ${pct}% of ${best.sampleSize} similar changes by other businesses like you had a positive outcome so far. Still gathering data; treat as directional.`
    : `${pct}% of ${best.sampleSize} similar changes shipped by other businesses like you had a positive outcome.`;

  return {
    kind: "peer_forecast",
    actionType: args.actionType,
    patternId: best.patternId,
    helpingRate: best.helpingRate,
    sampleSize: best.sampleSize,
    seeded,
    line,
  };
}
