/**
 * proof-plain-search-line (operator-experience fix batch C, item C4) - the
 * PRIMARY Search line on a Results card must be a short plain call ("This
 * probably hurt." / "This probably helped." / "Not clear yet."), never a
 * statistics headline. The percent-sure figure and the click range are real
 * and stay in the product, they just move one click deeper into the "See the
 * math" detail that already carries the full sentence text. Pure, deterministic.
 */

export type PlainSearchDirection = "positive" | "negative" | "neutral" | "unknown";

/** The short primary line. Mature results get a plain, confident call;
 *  everything earlier reads as a lean, never a verdict. */
export function plainSearchHeadline(direction: PlainSearchDirection, mature: boolean): string {
  if (mature) {
    if (direction === "positive") return "This helped.";
    if (direction === "negative") return "This did not help.";
    return "No clear change.";
  }
  if (direction === "positive") return "This is probably helping.";
  if (direction === "negative") return "This is probably hurting.";
  return "Not clear yet.";
}
