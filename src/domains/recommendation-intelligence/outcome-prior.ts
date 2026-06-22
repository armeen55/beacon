/**
 * Learning loop (#10, 2026-06-22) — turn SHIPPED experiment outcomes into a
 * per-action_type priority prior, so the next-best set re-ranks toward what has
 * actually WON.
 *
 * Pure. Input = the tenant's proof-ledger verdicts (won / lost / measuring /
 * inconclusive). Output = Map<action_type, prior ∈ [-1,+1]>:
 *   prior = (winRate − 0.5) × 2   →  100% won = +1, 50/50 = 0, 0% won = −1
 *
 * Only `won` and `lost` count (a settled verdict); `measuring` / `inconclusive`
 * / `insufficient_data` are ignored. An action_type needs ≥ MIN_OUTCOME_SAMPLES
 * settled outcomes before it earns a prior — below that the sample is too thin
 * to trust, so it stays neutral (absent from the map). The prior is consumed by
 * priorityScore() via outcomePriorBonus() and is PRIORITY-ONLY — it never
 * changes confidence, QA, or pushability, and it is recomputed from the ledger
 * every run (fully reversible: delete/repair a verdict and it updates).
 */

/** Minimum settled (won+lost) outcomes for an action_type before its win-rate
 *  is trusted enough to move priority. Below this → neutral (no prior). */
export const MIN_OUTCOME_SAMPLES = 3;

/** The fields computeOutcomePriors needs from a proof-ledger record. */
export type OutcomeVerdictRecord = {
  actionType: string;
  verdict: string;
};

/**
 * Win-rate-derived priority prior per action_type, in [-1,+1]. See module doc.
 * Deterministic; pure.
 */
export function computeOutcomePriors(
  records: readonly OutcomeVerdictRecord[],
): Map<string, number> {
  const won = new Map<string, number>();
  const lost = new Map<string, number>();
  for (const r of records) {
    if (!r.actionType) continue;
    if (r.verdict === "won") {
      won.set(r.actionType, (won.get(r.actionType) ?? 0) + 1);
    } else if (r.verdict === "lost") {
      lost.set(r.actionType, (lost.get(r.actionType) ?? 0) + 1);
    }
  }
  const out = new Map<string, number>();
  const actionTypes = new Set([...won.keys(), ...lost.keys()]);
  for (const at of actionTypes) {
    const w = won.get(at) ?? 0;
    const l = lost.get(at) ?? 0;
    const n = w + l;
    if (n < MIN_OUTCOME_SAMPLES) continue;
    const winRate = w / n;
    out.set(at, (winRate - 0.5) * 2);
  }
  return out;
}
