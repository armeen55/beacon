/**
 * load-proven-wins — the causal wedge for the home screen (2026-06-11).
 *
 * Today's "recent wins" rail is powered by the weaker per-page Z-score
 * verdict. This surfaces the STRONGEST evidence Beacon has — the causal
 * diff-in-differences Proof Engine's `computed` outcomes (adjusted_lift vs
 * comparable untreated pages, now durably persisted in change_outcomes_v2) —
 * as plain-English "we measured this" wins.
 *
 * Discipline (HARDENED 2026-06-13): ONLY `computed` outcomes that are
 * `high` confidence AND clear the flat-move bar (adjusted_lift >=
 * FLAT_LIFT_THRESHOLD) qualify. `high` is the only tier the engine grants
 * AFTER the placebo test passes (natural-controls.ts caps high→medium when
 * the lift is NOT placebo-significant, i.e. "untreated pages moved this much
 * by chance"), so this rail can honestly badge "measured cause-and-effect."
 * Previously the filter accepted any computed lift > 0 — which surfaced
 * placebo-FAILED (chance-level) and sub-flat "no real move" results as
 * front-page wins, contradicting the engine's own verdict. Weak/raw/
 * insufficient/medium never appear — the home screen states cause-and-effect
 * or stays quiet. Each win's headline is the shared plain-English proof
 * sentence (buildProofSentence), so the home-screen claim and the
 * /changes/[id] drilldown say the same honest thing.
 *
 * Server-only + failure-soft: any read error returns [] so the home screen's
 * section simply self-hides (never breaks the render). Deterministic; no LLM.
 */

import "server-only";

import { log } from "@/lib/logger";

import { loadAllChangeOutcomes } from "./change-outcome-store";
import { buildProofSentence, FLAT_LIFT_THRESHOLD } from "./proof-sentence";

export type ProvenWin = {
  sourceId: string;
  url: string | null;
  primaryBucket: string;
  /** Causal diff-in-diff lift in citations/day (> 0). */
  liftPerDay: number;
  /** Relative lift as a whole-number percent, or null. */
  relativeLiftPct: number | null;
  confidence: string;
  /** Plain-English proof sentence headline (same voice as the drilldown). */
  headline: string;
  treatmentDate: string;
};

/**
 * Load this tenant's causally-proven wins (computed + positive lift), ranked
 * by lift, for the home-screen proof rail. Failure-soft → [].
 */
export async function loadProvenWins(
  opts: { limit?: number } = {},
): Promise<ProvenWin[]> {
  const limit = opts.limit ?? 4;
  let outcomes;
  try {
    outcomes = await loadAllChangeOutcomes();
  } catch (err) {
    // A read failure here silently blanks the home-screen proven-wins rail.
    // Callers only see [] (rail self-hides) so they cannot distinguish "no
    // wins yet" from "read broke", so always log to make the difference visible.
    log.warn("load-proven-wins: outcomes read failed; proven-wins rail will self-hide", {
      store: "change-outcomes",
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  return outcomes
    .filter(
      (o) =>
        o.status === "computed" &&
        !!o.computed?.overall &&
        // `high` ⟹ placebo-significant (engine caps high→medium otherwise).
        o.confidence === "high" &&
        // A real move, not statistical noise (same bar as the proof sentence).
        o.computed.overall.adjusted_lift >= FLAT_LIFT_THRESHOLD,
    )
    .sort(
      (a, b) =>
        b.computed!.overall!.adjusted_lift - a.computed!.overall!.adjusted_lift,
    )
    .slice(0, limit)
    .map((o) => {
      const rel = o.computed!.overall!.relative_lift;
      return {
        sourceId: o.source_id,
        url: o.url,
        primaryBucket: o.primary_bucket,
        liftPerDay: o.computed!.overall!.adjusted_lift,
        relativeLiftPct: rel != null ? Math.round(rel * 100) : null,
        confidence: o.confidence,
        headline: buildProofSentence(o).headline,
        treatmentDate: o.treatment_date,
      };
    });
}
