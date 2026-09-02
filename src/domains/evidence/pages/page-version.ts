/** pages/page-version - ONE RULE FOR WHICH CAPTURE IS THE PAGE (operator, 2026-09-01).
 *
 * Four readers each chose a "current" capture their own way: the snapshot loader kept the newest row per address even
 * when it was blank, the targeted body reader let words beat a newer blank, the page-surgeon context took the first row
 * per canonical address, and the link producer took the first link graph it met. So the actors page was zero words to
 * the diagnosis and 921 words to the writer at the same moment. PURE: hand it every capture of one page and it says which
 * one is current, which one carries the page's words, and what the difference means. Recency and quality are two
 * different facts: a newer capture the crawler could not trust never erases a body it confirmed, and an older body is
 * never called current without its date riding beside it. */

type PageVersionState = "current" | "stale_known_good" | "sample_only" | "blank" | "unread";
type PageVersionFacts = { fetchedAt: string | null; words: number; bodyHeld: boolean; certainty: string | null };
type PageVersion<T> = {
  /** The newest capture on file, whatever it holds. */
  current: T | null;
  /** The capture whose words stand for the page: the newest one the crawler confirmed with words in it. */
  content: T | null;
  state: PageVersionState;
  /** TRUE when the newest capture is blank or untrusted and an older confirmed body stands in: presence may be read off it, absence may not. */
  conflict: boolean;
  /** When the words in `content` were captured. */
  contentAt: string | null;
  words: number;
};

const at = (f: PageVersionFacts): string => f.fetchedAt ?? "";
/** A capture the crawler could trust: confirmed, and either carrying words or holding the body whole (a genuinely empty page held whole is a real read). An `uncertain` extraction, or a zero-word row with no held body, is not one. */
const good = (f: PageVersionFacts): boolean => f.certainty !== "uncertain" && (f.words > 0 || f.bodyHeld);

export function selectPageVersion<T>(rows: readonly T[], facts: (row: T) => PageVersionFacts): PageVersion<T> {
  const sorted = [...rows].sort((a, b) => at(facts(b)).localeCompare(at(facts(a))));
  const current = sorted[0] ?? null;
  if (current == null) return { current: null, content: null, state: "unread", conflict: false, contentAt: null, words: 0 };
  const cf = facts(current);
  if (good(cf)) return { current, content: current, state: cf.bodyHeld ? "current" : "sample_only", conflict: false, contentAt: cf.fetchedAt, words: cf.words };
  const known = sorted.find((r) => good(facts(r))) ?? null;
  if (known == null) return { current, content: current, state: "blank", conflict: false, contentAt: cf.fetchedAt, words: 0 };
  const kf = facts(known);
  return { current, content: known, state: "stale_known_good", conflict: true, contentAt: kf.fetchedAt, words: kf.words };
}
