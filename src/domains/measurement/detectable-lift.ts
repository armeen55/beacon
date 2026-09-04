/**
 * detectable-lift - WHAT A PAGE'S OWN CLICKS COULD EVER SHOW, decided before anything at all is read off them. PURE: arithmetic over
 * two numbers, no clock, no I/O, and no opinion about what happened on any page.
 *
 * WHY A PRODUCT NEEDS THIS. Two windows of counted clicks are two samples, and the fewer the clicks the wider the ordinary swing
 * between them. A page taking five clicks a day can end a month a third above or below the month before it with nothing having
 * happened, while a real edit moves five to fifteen percent. Reading that page and reporting "twenty percent ahead" states an effect
 * the counts cannot carry, and an operator who acts on it is acting on noise this file can name in advance, on the day of the change.
 *
 * THE NUMBER. Over two equal windows each expecting N clicks, the smallest relative change that stands clear of ordinary movement is
 * about 2.8 * sqrt(2 / N). The 2.8 is the conventional pair of cut-offs added together at the usual 80 percent; the 2 is there because
 * both windows are counted and both wobble. Under six clicks across the two of them nothing separates at any size, so the answer is
 * null rather than a very large number wearing the costume of a threshold.
 *
 * IT SAYS NOTHING ABOUT ONE READING. What comes back is a property of the page's traffic alone. Whether a particular reading cleared
 * it is the kernel's question, and what an operator is told about that is the surface's sentence.
 */

/** The conventional pair of cut-offs, added, at the 80 percent that is standard practice. Named once so nothing re-derives it. */
const CUT_OFFS = 2.8;
/** Under this many clicks across BOTH windows nothing separates at any size, so no floor would be an honest one. */
const MIN_TOTAL_CLICKS = 6;

/** The smallest change a read over `days` could tell apart from ordinary movement on a page taking `clicksPerDay`, as a share of that
 *  page's own clicks (0.28 is 28 percent). Null when the two windows together hold too few clicks for any read at all. Pure. */
export function detectableLift(clicksPerDay: number, days: number): number | null {
  const perWindow = clicksPerDay * days;
  if (!Number.isFinite(perWindow) || perWindow * 2 < MIN_TOTAL_CLICKS) return null;
  return CUT_OFFS * Math.sqrt(2 / perWindow);
}
