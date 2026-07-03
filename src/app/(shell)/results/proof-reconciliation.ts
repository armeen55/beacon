/**
 * proof-reconciliation (operator-experience fix batch C, item C3) - when the
 * Search read and the site-visits read point opposite ways on the same card,
 * say so in one plain sentence instead of leaving the contradiction sitting
 * there unexplained. Pure, deterministic: reads the two signs already computed
 * elsewhere (pres.direction from measurement-maturity.ts, adjustedSessionsPct
 * from traffic-outcome.ts) and never recomputes or overrides either one.
 */

export type SearchDirection = "positive" | "negative" | "neutral" | "unknown";

/**
 * True when the Search direction and the traffic direction point opposite
 * ways. Neutral/unknown/missing readings never count as a contradiction -
 * only a clean positive-vs-negative disagreement is worth flagging.
 */
export function searchAndTrafficDisagree(
  searchDirection: SearchDirection,
  adjustedSessionsPct: number | null | undefined,
): boolean {
  if (adjustedSessionsPct == null) return false;
  if (searchDirection === "positive" && adjustedSessionsPct < 0) return true;
  if (searchDirection === "negative" && adjustedSessionsPct > 0) return true;
  return false;
}

/** The one reconciliation sentence, first person, no dashes. */
export function reconciliationSentence(): string {
  return "Google clicks and site visits disagree right now. That is common early. The 28-day Google read is the one that decides.";
}
