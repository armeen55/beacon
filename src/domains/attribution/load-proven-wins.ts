/**
 * load-proven-wins — the causal wedge for the home screen (2026-06-11).
 *
 * Today's "recent wins" rail is powered by the weaker per-page Z-score
 * verdict. This surfaces the STRONGEST evidence Beacon has — the causal
 * diff-in-differences Proof Engine's `computed` outcomes (adjusted_lift vs
 * comparable untreated pages, now durably persisted in change_outcomes_v2) —
 * as plain-English "we measured this" wins.
 *
 * Discipline: ONLY `computed` outcomes with a positive adjusted_lift qualify
 * (a real, control-backed causal gain). Weak/raw/insufficient never appear —
 * the home screen states cause-and-effect or stays quiet. Each win's headline
 * is the shared plain-English proof sentence (buildProofSentence), so the
 * home-screen claim and the /changes/[id] drilldown say the same honest thing.
 *
 * Server-only + failure-soft: any read error returns [] so the home screen's
 * section simply self-hides (never breaks the render). Deterministic; no LLM.
 */

import "server-only";

import { loadAllChangeOutcomes } from "./change-outcome-store";
import { buildProofSentence } from "./proof-sentence";

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
  } catch {
    return [];
  }
  return outcomes
    .filter(
      (o) =>
        o.status === "computed" &&
        !!o.computed?.overall &&
        o.computed.overall.adjusted_lift > 0,
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
