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

/** The fields computeOutcomePriors needs from a proof-ledger record. The
 *  `verdict` is the kernel's settled LEARNING verdict ("won" / "lost" /
 *  "measuring"), supplied by the caller via learningVerdictOf (kernel.ts). Only
 *  a settled "won" / "lost" counts toward a prior. */
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
    // Only a settled kernel verdict counts toward a win-rate prior; "measuring"
    // (early, unseparable, or held) contributes nothing.
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

/** Per-action_type breakdown for the /results learning diagnostic: how many
 *  settled wins/losses (and operator-excluded results) feed each type's prior,
 *  so the operator can SEE which action types are steering ranking and spot a
 *  skew. `prior` is null below MIN_OUTCOME_SAMPLES (not yet trusted). */
export type OutcomePriorDiagnostic = {
  actionType: string;
  won: number;
  lost: number;
  /** Results the operator pinned to "inconclusive" (excluded from learning). */
  excluded: number;
  settled: number;
  prior: number | null;
};

/**
 * Diagnostic view over the proof ledger. PURE. Counts won/lost (settled) and
 * operator-excluded results per action_type, and reports the same prior
 * `computeOutcomePriors` would apply (null until MIN_OUTCOME_SAMPLES settled).
 * Sorted by strongest prior magnitude, then most evidence.
 */
export function computeOutcomePriorDiagnostics(
  records: readonly (OutcomeVerdictRecord & {
    operatorVerdictOverride?: string | null;
  })[],
): OutcomePriorDiagnostic[] {
  const won = new Map<string, number>();
  const lost = new Map<string, number>();
  const excluded = new Map<string, number>();
  for (const r of records) {
    if (!r.actionType) continue;
    if (r.operatorVerdictOverride === "inconclusive") {
      excluded.set(r.actionType, (excluded.get(r.actionType) ?? 0) + 1);
      continue; // pinned out of won/lost by the operator; don't double-count
    }
    if (r.verdict === "won") won.set(r.actionType, (won.get(r.actionType) ?? 0) + 1);
    else if (r.verdict === "lost") lost.set(r.actionType, (lost.get(r.actionType) ?? 0) + 1);
  }
  const priors = computeOutcomePriors(records);
  const types = new Set([...won.keys(), ...lost.keys(), ...excluded.keys()]);
  const rows: OutcomePriorDiagnostic[] = [];
  for (const at of types) {
    const w = won.get(at) ?? 0;
    const l = lost.get(at) ?? 0;
    rows.push({
      actionType: at,
      won: w,
      lost: l,
      excluded: excluded.get(at) ?? 0,
      settled: w + l,
      prior: priors.get(at) ?? null,
    });
  }
  rows.sort(
    (a, b) =>
      Math.abs(b.prior ?? 0) - Math.abs(a.prior ?? 0) || b.settled - a.settled,
  );
  return rows;
}
