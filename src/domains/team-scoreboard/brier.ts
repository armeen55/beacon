/**
 * brier (2026-07-02, master plan item 38) - PURE math for the specialist scoreboard: how good is
 * each teammate's word actually worth? A specialist "votes" on a pick every time it speaks (a
 * supporting voice in team-review.ts) or objects to it (a dissenting voice). We treat that vote as
 * a probability the pick goes on to WIN, then score it against the real settled verdict with the
 * Brier score (the standard forecaster-calibration metric: mean squared error between the stated
 * probability and the 0/1 outcome - lower is better, 0 is a perfect forecaster, 0.25 is a coin
 * flip, 1 is a perfect wrong-caller).
 *
 * Probability mapping (voiceProbability), the ONE place this decision is made:
 *   - a SUPPORTING voice (spoke in team-review.ts's `voices` array) states a confidencePct 0..100.
 *     We read that directly as "this specialist is confidencePct% sure the pick wins" -> probability
 *     = confidencePct / 100.
 *   - a DISSENTING voice (raised an objection in team-review.ts's `objections` array) is a bet
 *     AGAINST the pick. team-review.ts does not persist a numeric conviction for an objection (only
 *     a severity), so a dissenting voice's implied win-probability is 1 minus a fixed severity-based
 *     conviction: a "veto" objection is a strong bet against (conviction 80%, so probability the
 *     pick wins = 0.20); a "downgrade" objection is a softer bet against (conviction 60%, so
 *     probability = 0.40). This keeps the mapping monotonic and honest without inventing a number
 *     the team-review record never actually stated.
 *   - ABSTAIN (a specialist that neither spoke nor objected on this pick) contributes no data point
 *     at all - it is excluded from that specialist's tally, never scored as a guess. This mirrors
 *     the abstain-not-guess discipline team-review.ts already uses for silent teammates.
 *   - a specialist that BOTH supports and objects on the same pick (rare - the router can raise an
 *     objection on a specialist's own claim) is scored on its strongest signal: the supporting voice
 *     wins the tie, because team-review.ts always keeps the specialist's own claim as its headline
 *     position and objections are attributed to whichever specialist raised the concern, which need
 *     not be the same specialist that also voiced support.
 *
 * PURE - no I/O, no LLM, deterministic. Pinned by brier.test.ts.
 */

export type VoiceStance = "supporting" | "dissenting";

/** A fixed, documented conviction for a dissenting voice, since team-review.ts's objections carry
 *  a severity, not a numeric conviction. Vetoes are a stronger bet against than downgrades. */
const DISSENT_CONVICTION: Record<"veto" | "downgrade", number> = {
  veto: 80,
  downgrade: 60,
};

/**
 * Map one voice's stance + conviction to a probability (0..1) that the pick wins. Supporting
 * voices read their conviction directly; dissenting voices are 1 minus their (fixed, severity-
 * based) conviction. `conviction` is 0..100 for a supporting voice; for a dissenting voice pass
 * the objection severity instead (see the `severity` overload below) - both are exposed so a
 * caller with a real numeric dissent conviction in the future is not forced through the fixed
 * table.
 */
export function voiceProbability(stance: VoiceStance, conviction: number): number {
  const c = Math.max(0, Math.min(100, Number.isFinite(conviction) ? conviction : 0));
  return stance === "supporting" ? c / 100 : 1 - c / 100;
}

/** Convenience for a dissenting voice, which team-review.ts records as a severity, not a percent. */
export function dissentProbability(severity: "veto" | "downgrade"): number {
  return voiceProbability("dissenting", DISSENT_CONVICTION[severity]);
}

/** The Brier score for one forecast: squared error between the stated probability (0..1) and the
 *  binary outcome (1 = won, 0 = did not win). Lower is better; 0 is perfect, 1 is perfectly wrong. */
export function brierScore(probability: number, outcome: 0 | 1): number {
  const p = Math.max(0, Math.min(1, Number.isFinite(probability) ? probability : 0.5));
  return (p - outcome) ** 2;
}

/** One specialist's vote on one settled pick, ready to score. `outcome` is the settled verdict
 *  collapsed to won (1) vs not-won (0) - "flat"/"lost" both score as 0, since the voice bet on a
 *  win and a win is the only outcome that pays it off. */
export type ScoredVote = {
  specialist: string;
  actionFamily: string;
  probability: number;
  outcome: 0 | 1;
};

export type Tally = {
  won: number;
  flat: number;
  lost: number;
  /** Count of scored votes (won + flat + lost). */
  n: number;
  /** Mean Brier score across this tally's votes. Null when n is 0 (never divide by zero, never
   *  fabricate a score for a specialist with no scored votes). */
  brier: number | null;
  /** Plain-English honesty note about sample size - present whenever n is thin, so a 1-of-1 record
   *  is never read as a proven skill. Null once n is comfortably large. */
  calibrationNote: string | null;
};

/** Below this many scored votes, a Brier score is real but not yet a reliable read on skill - the
 *  tally still reports it, with an honest caveat, rather than hiding the number. */
const SMALL_N_THRESHOLD = 5;

function calibrationNoteFor(n: number): string | null {
  if (n === 0) return null;
  if (n < SMALL_N_THRESHOLD) {
    return n === 1
      ? "Only 1 settled pick so far. Too early to call this a track record."
      : `Only ${n} settled picks so far. Too early to call this a track record.`;
  }
  return null;
}

/** Fold a set of scored votes (already filtered to one specialist, or one specialist+family) into
 *  a tally. `wonFlags` distinguishes won (1) from not-won (0) per vote; a vote counts as "flat" (as
 *  opposed to "lost") when its own probability said the pick would not win AND it did not - i.e.
 *  the specialist called it correctly by dissenting on a loser. A vote counts as "lost" when the
 *  specialist backed a pick (probability >= 0.5) that did not win. This keeps won/flat/lost reading
 *  as "did this voice's bet pay off", not a raw restatement of the ledger's own verdict. */
export function aggregateVotes(votes: ScoredVote[]): Tally {
  let won = 0;
  let flat = 0;
  let lost = 0;
  let sumBrier = 0;
  for (const v of votes) {
    sumBrier += brierScore(v.probability, v.outcome);
    const backedWin = v.probability >= 0.5;
    if (v.outcome === 1) {
      // The pick won. A voice that backed it called this right; a voice that bet against it
      // (dissented) was simply wrong about a pick that went on to win - that is a loss for the
      // dissenter's record, not a "flat".
      won++;
    } else if (backedWin) {
      // The pick did not win and this voice backed it (or was neutral): a miss.
      lost++;
    } else {
      // The pick did not win and this voice bet against it (or was neutral-against): a correct
      // call that does not carry a positive "won" swing - counted as a steady/flat correct read.
      flat++;
    }
  }
  const n = votes.length;
  return {
    won,
    flat,
    lost,
    n,
    brier: n > 0 ? sumBrier / n : null,
    calibrationNote: calibrationNoteFor(n),
  };
}

export type SpecialistScoreboardRow = {
  specialist: string;
  overall: Tally;
  byFamily: Record<string, Tally>;
};

/** Group scored votes by specialist, and within each specialist by actionFamily, then aggregate
 *  each group. PURE, deterministic order (specialists sorted alphabetically; families likewise). */
export function buildSpecialistScoreboard(votes: ScoredVote[]): SpecialistScoreboardRow[] {
  const bySpecialist = new Map<string, ScoredVote[]>();
  for (const v of votes) {
    const arr = bySpecialist.get(v.specialist) ?? [];
    arr.push(v);
    bySpecialist.set(v.specialist, arr);
  }
  const rows: SpecialistScoreboardRow[] = [];
  for (const specialist of [...bySpecialist.keys()].sort()) {
    const specialistVotes = bySpecialist.get(specialist)!;
    const byFamilyVotes = new Map<string, ScoredVote[]>();
    for (const v of specialistVotes) {
      const arr = byFamilyVotes.get(v.actionFamily) ?? [];
      arr.push(v);
      byFamilyVotes.set(v.actionFamily, arr);
    }
    const byFamily: Record<string, Tally> = {};
    for (const family of [...byFamilyVotes.keys()].sort()) {
      byFamily[family] = aggregateVotes(byFamilyVotes.get(family)!);
    }
    rows.push({ specialist, overall: aggregateVotes(specialistVotes), byFamily });
  }
  return rows;
}

/** Pick the single best forecaster (lowest Brier, ties broken by more settled votes, then name)
 *  among specialists with at least `minN` settled votes. Null when nobody clears the bar - the
 *  surface stays silent rather than naming a "best" forecaster off a coin flip's worth of data. */
export function bestForecaster(rows: SpecialistScoreboardRow[], minN: number): SpecialistScoreboardRow | null {
  const eligible = rows.filter((r) => r.overall.n >= minN && r.overall.brier != null);
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => {
    const byBrier = (a.overall.brier ?? 1) - (b.overall.brier ?? 1);
    if (byBrier !== 0) return byBrier;
    const byN = b.overall.n - a.overall.n;
    if (byN !== 0) return byN;
    return a.specialist.localeCompare(b.specialist);
  })[0]!;
}

/** Plain-English one-line record for a specialist, e.g. "5 of 6" wins. Null below 1 settled vote. */
export function recordLine(tally: Tally): string | null {
  if (tally.n === 0) return null;
  return `${tally.won} of ${tally.n}`;
}

/**
 * The honest standup footer sentence naming the best forecaster, e.g. "The Search demand teammate
 * has called 5 of 6 winners right this quarter - the sharpest eye on the team right now." Null when
 * there is no eligible best forecaster (silence below the minimum, per the surface contract).
 * `specialistLabel` maps the internal specialist key to its operator-facing name (team/identity.ts).
 */
export function buildBestForecasterLine(
  rows: SpecialistScoreboardRow[],
  minN: number,
  specialistLabel: (specialist: string) => string,
): string | null {
  const best = bestForecaster(rows, minN);
  if (!best) return null;
  const label = specialistLabel(best.specialist);
  const won = best.overall.won;
  const n = best.overall.n;
  return `The ${label} teammate has called ${won} of ${n} winners right this quarter - the sharpest eye on the team right now.`;
}
