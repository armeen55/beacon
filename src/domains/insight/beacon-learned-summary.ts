/**
 * beacon-learned-summary (R23 P15, 2026-07-03) - the ONE honest sentence the
 * "Beacon learned" tile shows about what actually moved priorities. Pure,
 * decided-only, self-hiding.
 *
 *   "I've learned your answer-block changes win most often (4 of 5 measured),
 *    so I'm putting them higher. Title-only tweaks have not moved the needle
 *    (0 of 3), so I'm easing off them."
 *
 * DERIVED ONLY FROM DECIDED OUTCOMES. The input is the tenant's SettledOutcome[]
 * - the SAME decided-only, maturity/weather/parallel-trends-gated list the R&R
 * learning reweight already consumes (loadExperimentOutcomes) - so this tile can
 * never claim a win the ranking layer didn't also earn. It reuses the identical
 * win-rate math (computeDimPriors over the actionType dimension), never a second,
 * drifting copy.
 *
 * SELF-HIDES until there are >= MIN_DECIDED_FOR_SUMMARY decided (won+lost)
 * outcomes in total: below that the tile returns null and renders nothing. No
 * fake claims - a kind is only named a "winner" when its own bucket cleared the
 * >= MIN_DECIDED sample floor the prior itself uses, and is only named as "not
 * moving the needle" on the same evidence bar. When nothing is decided, or every
 * bucket is a coin-flip, the sentence is null (the tile stays hidden).
 *
 * Beacon voice: first person, a concrete number in every clause, no lab words
 * ("prior"/"multiplier"/"bucket" never appear on this surface), no em or en
 * dashes. PURE / deterministic / no I/O. Pinned by beacon-learned-summary.test.ts.
 */

import {
  computeDimPriors,
  type SettledOutcome,
} from "@/domains/learning/experiment-prior";

/** Total decided (won+lost) outcomes required before the tile shows anything. */
export const MIN_DECIDED_FOR_SUMMARY = 3;

/** Win-rate at/above this names a kind a clear winner ("win most often"). */
const WINNER_RATE = 0.6;
/** Win-rate at/below this names a kind as not moving the needle. */
const LAGGARD_RATE = 0.4;

/** Plain, customer-safe name for a canonical move kind. No lab words. These
 *  mirror the plain-language term map's spirit; kept local so this pure module
 *  has no surface-copy dependency. Unknown kinds fall back to a readable slug. */
const KIND_PHRASE: Record<string, { subject: string }> = {
  answer_block: { subject: "answer-block changes" },
  edit_page: { subject: "title and wording tweaks" },
  create_page: { subject: "new pages" },
  add_schema: { subject: "page-info (schema) additions" },
  internal_links: { subject: "internal-link additions" },
  fix_experience: { subject: "page-experience fixes" },
};

function kindSubject(kind: string): string {
  return KIND_PHRASE[kind]?.subject ?? `${kind.replace(/[_-]+/g, " ")} changes`;
}

export type LearnedKindReadout = {
  kind: string;
  subject: string;
  won: number;
  decided: number;
  winRate: number;
};

export type BeaconLearnedSummary = {
  /** The one honest sentence, or null when the tile must self-hide. */
  sentence: string | null;
  /** Total decided outcomes considered (drives the self-hide + a small receipt). */
  decidedTotal: number;
  /** The winning kind named (if any) - for an optional accent on the tile. */
  winner: LearnedKindReadout | null;
  /** The lagging kind named (if any). */
  laggard: LearnedKindReadout | null;
};

function hidden(decidedTotal: number): BeaconLearnedSummary {
  return { sentence: null, decidedTotal, winner: null, laggard: null };
}

function isDecidedWin(o: SettledOutcome): boolean {
  return o.operatorVerdictOverride !== "inconclusive" && o.verdict === "won";
}
function isDecidedLoss(o: SettledOutcome): boolean {
  return o.operatorVerdictOverride !== "inconclusive" && o.verdict === "lost";
}

/**
 * Build the "Beacon learned" summary from decided outcomes. PURE.
 *
 * Contract:
 *  - < MIN_DECIDED_FOR_SUMMARY decided total → HIDDEN (sentence null).
 *  - Otherwise, over the SAME actionType win-rate math the ranking uses, name the
 *    strongest clear winner (winRate >= WINNER_RATE, and its own bucket cleared
 *    MIN_DECIDED) and - if one exists - the clearest laggard (winRate <=
 *    LAGGARD_RATE, cleared MIN_DECIDED). If NEITHER a winner nor a laggard clears
 *    the bar (everything is a coin-flip), HIDDEN - never a hollow "I'm still
 *    learning" claim dressed as an insight.
 */
export function buildBeaconLearnedSummary(
  outcomes: readonly SettledOutcome[],
): BeaconLearnedSummary {
  const decidedTotal = outcomes.filter((o) => isDecidedWin(o) || isDecidedLoss(o)).length;
  if (decidedTotal < MIN_DECIDED_FOR_SUMMARY) return hidden(decidedTotal);

  // Reuse the SAME win-rate math the ranking prior uses, restricted to the
  // actionType (move-kind) dimension so the sentence talks about a KIND of move.
  const table = computeDimPriors(outcomes);
  const kinds: LearnedKindReadout[] = [];
  for (const p of table.values()) {
    if (p.dimension !== "actionType") continue;
    kinds.push({
      kind: p.value,
      subject: kindSubject(p.value),
      won: p.won,
      decided: p.decided,
      winRate: p.winRate,
    });
  }

  const winner = kinds
    .filter((k) => k.winRate >= WINNER_RATE)
    .sort((a, b) => b.winRate - a.winRate || b.decided - a.decided)[0] ?? null;
  const laggard = kinds
    .filter((k) => k.winRate <= LAGGARD_RATE && k.kind !== winner?.kind)
    .sort((a, b) => a.winRate - b.winRate || b.decided - a.decided)[0] ?? null;

  if (!winner && !laggard) return { sentence: null, decidedTotal, winner: null, laggard: null };

  const parts: string[] = [];
  if (winner) {
    parts.push(
      `I've learned your ${winner.subject} win most often (${winner.won} of ${winner.decided} measured), so I'm putting them higher.`,
    );
  }
  if (laggard) {
    // Own a miss plainly.
    const lead = winner ? `Your ${laggard.subject}` : `I've learned your ${laggard.subject}`;
    parts.push(
      `${lead} have not moved the needle (${laggard.won} of ${laggard.decided}), so I'm easing off them.`,
    );
  }

  return { sentence: parts.join(" "), decidedTotal, winner, laggard };
}
