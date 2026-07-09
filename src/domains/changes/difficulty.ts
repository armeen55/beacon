/**
 * difficulty (operator spec 2026-07-09 C-19) - PURE, deterministic difficulty bucket for a
 * change, derived ONLY from its existing effort estimate (estimatedEffortMinutes). The Changes
 * card shows difficulty FIRST, then time ("easy, about 2 minutes"), so the operator reads how
 * hard before how long. Three coarse buckets, no fake precision:
 *   <= 5 minutes  -> easy
 *   <= 20 minutes -> medium
 *   else          -> hard
 * Returns null when there is no honest effort figure to bucket (same self-hiding discipline the
 * honestMinutesLabel time helper uses), so a card never shows a difficulty it cannot stand behind.
 * No dashes, no lab jargon. Pinned by difficulty.test.ts.
 */
export type Difficulty = "easy" | "medium" | "hard";

export function difficultyLabel(minutes: number | null | undefined): Difficulty | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes <= 5) return "easy";
  if (minutes <= 20) return "medium";
  return "hard";
}
