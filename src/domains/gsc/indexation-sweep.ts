/**
 * indexation-sweep (BEACON_500 R17c / P2, v1 item 138) - a BUDGETED check of
 * whether Google has actually indexed the tenant's highest-demand owned pages.
 *
 * A page can rank, get impressions, and STILL be missing from Google's index
 * (canonical confusion, crawl backlog, a stray noindex). The daily Search
 * Analytics sync never surfaces that - it only shows the pages that already
 * appear. This sweep inspects a BOUNDED batch of top-demand URLs' index state
 * and says the honest headline: "3 of your top pages are not indexed by Google
 * yet."
 *
 * THE BUDGET RULE (the reason this is safe to run at render time): the sweep
 * NEVER inspects more than GSC_INSPECT_PER_RENDER_LIMIT URLs, and each
 * inspection goes through the SAME bounded adapter (loadGscSignal) the
 * indexability page uses - a 24h Supabase-cached URL Inspection call, never a
 * raw loop, never a fresh fetch past the budget. This module is the PURE
 * selection + copy math; the I/O edge (which threads the budget) is
 * load-indexation-sweep.ts.
 *
 * PLAIN WORDS: the operator sees "indexed by Google" / "not in Google's index",
 * never coverage_state / indexing_state / an internal enum.
 *
 * PURE, no I/O.
 */

/** One candidate page for the sweep (a high-demand owned URL). */
export type IndexationCandidate = {
  page: string;
  impressions90d: number;
};

/** One inspected page's honest, plain-words index verdict. */
export type IndexationVerdict = {
  page: string;
  /** true = Google has it indexed; false = confirmed not indexed;
   *  null = Google's answer was inconclusive (we do not count it either way). */
  indexed: boolean | null;
};

export type IndexationSweep = {
  /** How many top pages we actually inspected this render (<= the budget). */
  checked: number;
  /** How many of the checked pages Google has NOT indexed. */
  notIndexed: number;
  /** The not-indexed page URLs (for the surface list), most demand first. */
  notIndexedPages: string[];
  /** The one honest headline line, or null when nothing to say. */
  line: string | null;
};

/**
 * Pick the batch to inspect: the highest-demand owned pages, deduped, capped
 * at the render budget. Pages with no impressions are dropped (nothing proven
 * to lose). Pure so the loader and its test share one selection rule.
 */
export function selectIndexationBatch(
  candidates: readonly IndexationCandidate[],
  budget: number,
): IndexationCandidate[] {
  const cap = Math.max(0, Math.floor(budget));
  if (cap === 0) return [];
  const byPage = new Map<string, number>();
  for (const c of candidates) {
    if (typeof c.page !== "string" || c.page.trim() === "") continue;
    const impr = Number(c.impressions90d) || 0;
    if (impr <= 0) continue;
    const key = c.page.trim();
    byPage.set(key, Math.max(byPage.get(key) ?? 0, impr));
  }
  return [...byPage.entries()]
    .map(([page, impressions90d]) => ({ page, impressions90d }))
    .sort((a, b) => b.impressions90d - a.impressions90d || a.page.localeCompare(b.page))
    .slice(0, cap);
}

/**
 * Assemble the sweep from the inspected verdicts. `null` (inconclusive)
 * verdicts count toward `checked` but never toward `notIndexed` - we only ever
 * report a page as missing when Google explicitly said so. Returns a sweep
 * whose `line` is null when nothing was inspected OR every inspected page is
 * indexed (the surface self-hides, never a bare "0 not indexed").
 */
export function buildIndexationSweep(
  verdicts: readonly IndexationVerdict[],
): IndexationSweep {
  const checked = verdicts.length;
  const notIndexedPages = verdicts
    .filter((v) => v.indexed === false && typeof v.page === "string" && v.page !== "")
    .map((v) => v.page);
  const notIndexed = notIndexedPages.length;
  return {
    checked,
    notIndexed,
    notIndexedPages,
    line: buildIndexationLine(checked, notIndexed),
  };
}

/** The honest headline. Null when there is nothing worth saying (nothing
 *  checked, or everything checked is indexed). */
export function buildIndexationLine(checked: number, notIndexed: number): string | null {
  if (checked <= 0) return null;
  if (notIndexed <= 0) return null;
  // Verb agrees with the not-indexed COUNT; the "top N" noun agrees with the
  // number checked. "1 of your top 3 pages is ..." / "3 of your top 5 pages
  // are ..." both read naturally.
  const verb = notIndexed === 1 ? "is" : "are";
  const checkedNoun = checked === 1 ? "page" : "pages";
  return (
    `${notIndexed} of your top ${checked} ${checkedNoun} ` +
    `${verb} not indexed by Google yet, so ${notIndexed === 1 ? "it earns" : "they earn"} ` +
    `no Google traffic no matter how good the content is. I will flag getting ` +
    `${notIndexed === 1 ? "it" : "them"} indexed as the first move.`
  );
}
