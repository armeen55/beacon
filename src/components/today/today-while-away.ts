/**
 * today-while-away (P21, v1 238 - "while you were away") - the pure selector behind the
 * one honest block that greets an operator returning after time away:
 *
 *   "While you were away: 2 changes finished measuring (1 won, up about 38 clicks a
 *    month), and 3 new opportunities appeared."
 *
 * PURE (no I/O, deterministic for a fixed nowMs). It is fed the previous-visit mark
 * (today-last-seen-store) and the CURRENT canonical lifecycle counts (the shared FP3
 * loader Results and the tiles read), and reports only the DELTA. Every number reuses
 * a count another surface owns:
 *   - "finished measuring" = decidedNow - decidedThen   (Results' decided total)
 *   - "won"                = wonNow - wonThen            (Results' Wins band)
 *   - "new opportunities"  = toDoNow - toDoThen          (the Changes list open count)
 * The won-clicks-a-month figure, when shown, is the summed measured monthly lift of the
 * newly-won changes, the SAME per-record math the lead headline uses.
 *
 * Self-hides (returns null) when:
 *   - there is no previous-visit mark (first-ever visit - nothing to compare),
 *   - the gap since the last visit is under a threshold (a refresh is not "away"),
 *   - or nothing changed in either lane (no false "while you were away" on a quiet return).
 *
 * Beacon voice: first person where it speaks, a concrete number in every clause, no lab
 * jargon (never "verdict"/"experiment"), no em or en dashes; a loss is owned plainly, a
 * win celebrated in one sentence.
 */

/** The two count snapshots being diffed: the previous visit, and now. */
export type WhileAwayInput = {
  /** Counts captured at the previous Today visit. Null on first-ever visit. */
  then: { decided: number; won: number; toDo: number } | null;
  /** ISO timestamp of the previous visit. Null / unparseable hides the block. */
  seenAt: string | null;
  /** The current canonical lifecycle counts (shared FP3 loader). */
  now: { decided: number; won: number; toDo: number };
  /** Summed measured monthly click lift of the changes that WON since the last visit,
   *  or null when none of the newly-won changes carries a final measured lift. */
  newWonMonthlyClickLift?: number | null;
  /** Clock. */
  nowMs: number;
};

export type WhileAwaySummary = {
  /** The one first-person sentence, already assembled. */
  sentence: string;
  /** How many changes finished measuring since the last visit (>= 0). */
  finishedMeasuring: number;
  /** How many of those won (>= 0). */
  wonCount: number;
  /** How many new opportunities appeared (>= 0). */
  newOpportunities: number;
};

/** A visit closer together than this is a refresh, not time "away". */
const AWAY_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The "finished measuring" clause, or null when nothing settled since the last visit. */
function measuredClause(
  finished: number,
  won: number,
  wonLift: number | null | undefined,
): string | null {
  if (finished <= 0) return null;
  const head = `${finished} ${plural(finished, "change", "changes")} finished measuring`;
  if (won <= 0) {
    // Everything that settled did not work - own it plainly, no false celebration.
    return `${head} (none won this time)`;
  }
  const wonPhrase = `${won} won`;
  if (typeof wonLift === "number" && wonLift > 0) {
    return `${head} (${wonPhrase}, up about ${wonLift.toLocaleString()} ${plural(wonLift, "click", "clicks")} a month)`;
  }
  return `${head} (${wonPhrase})`;
}

/**
 * Compose the while-you-were-away summary, or null when the block should self-hide.
 * The delta is clamped at zero in each lane: a count going DOWN (an opportunity
 * dismissed, a verdict revised) is never reported as negative news here.
 */
export function buildWhileAwaySummary(input: WhileAwayInput): WhileAwaySummary | null {
  if (!input.then || !input.seenAt) return null;
  const seenMs = Date.parse(input.seenAt);
  if (!Number.isFinite(seenMs)) return null;
  if (input.nowMs - seenMs < AWAY_THRESHOLD_MS) return null;

  const finishedMeasuring = Math.max(0, input.now.decided - input.then.decided);
  const wonCount = Math.max(0, input.now.won - input.then.won);
  const newOpportunities = Math.max(0, input.now.toDo - input.then.toDo);

  if (finishedMeasuring === 0 && newOpportunities === 0) return null;

  const measured = measuredClause(finishedMeasuring, wonCount, input.newWonMonthlyClickLift);
  const oppClause =
    newOpportunities > 0
      ? `${newOpportunities} new ${plural(newOpportunities, "opportunity", "opportunities")} appeared`
      : null;

  const parts = [measured, oppClause].filter((p): p is string => p !== null);
  // Join with ", and" only when both clauses are present.
  const body = parts.length === 2 ? `${parts[0]}, and ${parts[1]}` : parts[0]!;
  const sentence = `While you were away: ${body}.`;

  return { sentence, finishedMeasuring, wonCount, newOpportunities };
}
