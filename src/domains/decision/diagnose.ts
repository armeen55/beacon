/**
 * decision/diagnose (evidence-qualified changes, 2026-07-27): WHY this page loses
 * clicks, READ OFF THE EXACT RESULTS PAGE rather than counted off its stored title.
 *
 * What it replaced: token containment. The old rule asked whether the searcher's
 * words appeared in the stored title, and recommended a title rewrite when they did
 * not. On live data that was wrong in the worst possible way: the stored title read
 * "Top 20 Famous Persian Actresses and Actors", so the check fired, while Google was
 * already DISPLAYING that page as "Famous Iranian & Persian Actors, Actresses &
 * Celebrities". The words a searcher actually reads carried the search. The stored
 * title was never the explanation, and a rewrite of it would have changed nothing a
 * human sees.
 *
 * So the diagnosis reads three things off the results page collected for that EXACT
 * search, and nothing else:
 *   1. THE OWNED DISPLAYED RESULT: is your page on that page, at what rank, worded
 *      how. When the words Google shows already carry the search, a title action is
 *      not supported and the cause is `google_rewrite_already_matches`.
 *   2. THE RECURRING PATTERN: wording that recurs across the results that beat you.
 *      One result's wording is that result's style, so a token appearing once is
 *      never a pattern.
 *   3. THE GAP BETWEEN THEM: only wording the winners share AND your displayed
 *      result is missing can name a title as the lever.
 * Anything else is `inconclusive`, which keeps the page under investigation and
 * spends nothing on drafting copy nobody can justify. Zero ready is a real answer.
 *
 * A meta or content action is never concluded here: naming one honestly needs the
 * description Google displays or the page's own body words, and neither is on file,
 * so this module refuses rather than guesses the field.
 *
 * PURE + deterministic: the same evidence in any order produces a byte-identical
 * diagnosis. No I/O, no LLM, no tenant or vertical vocabulary.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { publisherHost } from "@/domains/evidence/serp-shape";
import type { ActionDiagnosis } from "./contracts";

/** The receipt item keys a diagnosis cites. A claim with no item behind it is never
 *  made, and a producer that builds a receipt must build it under these keys. The
 *  conclusion itself is not one of them: a diagnosis is what I concluded FROM the
 *  receipt, so it rides on the change as its stated reason and its ruled-out
 *  alternatives, and only the observations under it are receipt items. */
export const RECEIPT = {
  gsc: "demand-exact",
  copy: "copy-current",
  serp: "serp1",
  ownedResult: "serp-owned",
  pattern: "serp-pattern",
  body: "copy-body",
} as const;

/** One result exactly as the results page displayed it. */
export type DisplayedResult = { rank: number; domain: string; url: string; title: string | null };

export type DiagnosisInput = {
  /** The EXACT search the gap was measured on. */
  query: string;
  ownedUrl: string | null;
  /** The results page collected for THIS search; null = I never looked. */
  organic: readonly DisplayedResult[] | null;
  /** True only when the page's own words beyond its title are on file. */
  body: boolean;
  /** The average position GSC reports for this exact search, when it holds one. It
   *  is the only thing that can tell "you do not rank" apart from "the one check I
   *  ran did not show you", and those two must never be said in the same words. */
  gscPosition?: number | null;
};

/** Two SITES apart is a pattern; two rows from one site are that site's house style. */
const MIN_PATTERN = 2;
/** How many recurring words the operator-facing sentence names. */
const PATTERN_SHOWN = 4;

const quote = (s: string): string => `"${s}"`;
const words = (t: readonly string[]): string => t.slice(0, PATTERN_SHOWN).map(quote).join(", ");

/** Your own line on that results page, or null when your page is not on it. */
export function ownedResultOf(input: DiagnosisInput): DisplayedResult | null {
  const key = canonicalUrlKey(input.ownedUrl);
  if (!key || !input.organic) return null;
  return [...input.organic]
    .sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url))
    .find((o) => canonicalUrlKey(o.url) === key) ?? null;
}

/** Wording that RECURS across the results you are losing to, most common first.
 *  Your own result never votes for a pattern it is being measured against. */
export function recurringPattern(input: DiagnosisInput, owned: DisplayedResult | null): string[] {
  const ownedKey = owned ? canonicalUrlKey(owned.url) : "";
  // Counted per SITE, once. One site holding four of nine results made its own house
  // words ("explode", "mine", "naval") read as what the whole page agrees on, and that
  // list is handed to the drafter as guidance.
  const sites = new Map<string, Set<string>>();
  for (const r of input.organic ?? []) {
    if (canonicalUrlKey(r.url) === ownedKey) continue;
    // ONE PUBLISHER IS ONE VOTE, the same rollup the packet uses: bare rootDomain kept
    // en / simple / de of one encyclopedia as three sites, so one publisher agreeing with
    // itself read as three sites agreeing, and that list is what the drafter is handed.
    const site = publisherHost(r.url) || publisherHost(r.domain);
    const seen = sites.get(site) ?? new Set<string>();
    for (const t of topicTokens(r.title)) seen.add(t);
    sites.set(site, seen);
  }
  const counts = new Map<string, number>();
  for (const tokens of sites.values()) for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= MIN_PATTERN)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

/** An honest refusal: the page stays under investigation and nothing is drafted. */
const open = (
  cause: ActionDiagnosis["cause"],
  explanation: string,
  evidenceKeys: string[],
  alternativesRuledOut: ActionDiagnosis["alternativesRuledOut"],
): ActionDiagnosis => ({ status: "inconclusive", cause, action: null, evidenceKeys, alternativesRuledOut, explanation });

/**
 * THE reasoning step between "this page underperforms" and "change this". Returns a
 * DIAGNOSED title action only when the results page itself proves the lever.
 */
export function diagnoseCandidate(input: DiagnosisInput): ActionDiagnosis {
  if (!input.organic || input.organic.length === 0) {
    return open("unknown", "I have not looked at the results page for that search yet, so I cannot tell you what to change. It is first in line on my next research pass.", [RECEIPT.gsc], []);
  }
  const owned = ownedResultOf(input);
  if (!owned) {
    // GSC counts every country and device over 90 days; the results page I collect is
    // ONE check. Saying "you rank third" and "I could not find you" in the same breath
    // is how a product loses a customer, so a held position means the CHECK missed the
    // page, and only a page with no position at all may be called not ranking.
    const ranks = typeof input.gscPosition === "number" && Number.isFinite(input.gscPosition);
    return ranks
      ? open("serp_market_mismatch",
        `Google reports this page at about position ${input.gscPosition!.toFixed(1)} for that search, but the results page I collected did not list it, so I am looking at a different slice of Google than your visitors are and I will check again before naming a fix.`,
        [RECEIPT.gsc, RECEIPT.serp],
        [{ alternative: "Rewrite the page title", reason: "I cannot yet see the line a searcher actually reads for this page, so a rewrite would be a guess.", evidenceKeys: [RECEIPT.serp] }])
      : open("wrong_page_ranking",
        "I checked the results page and this page is not on it, so before touching its wording I will look at which of your pages Google is showing instead.",
        [RECEIPT.serp],
        [{ alternative: "Rewrite the page title", reason: "A page that does not come up for the search does not lose the click on its wording.", evidenceKeys: [RECEIPT.serp] }]);
  }
  const displayed = (owned.title ?? "").trim();
  const wanted = topicTokens(input.query);
  const shown = new Set(topicTokens(displayed));
  const missing = wanted.filter((t) => !shown.has(t));
  // THE RULE THAT DEMOTES A REWRITE NOBODY WOULD SEE: Google rewrites the line it
  // displays, and when that line already carries the search, the stored title is not
  // the explanation however poorly it reads.
  if (displayed && wanted.length > 0 && missing.length === 0) {
    return open("google_rewrite_already_matches",
      `I checked the results page, and Google already shows this page as ${quote(displayed)}, which carries the words people are searching for, so rewriting the title would not change what a searcher reads. I am looking at what the page itself offers instead.`,
      [RECEIPT.serp, RECEIPT.ownedResult],
      [{ alternative: "Rewrite the page title",
        reason: `Google writes the line it displays for ${quote(input.query)} and that line already carries those words, so changing the stored title would not change what a searcher reads.`,
        evidenceKeys: [RECEIPT.ownedResult, RECEIPT.copy] }]);
  }
  const pattern = recurringPattern(input, owned); const shared = missing.filter((t) => pattern.includes(t));
  if (!displayed || shared.length === 0) {
    return open("ambiguous_search_intent",
      `I checked the ${input.organic.length} ${input.organic.length === 1 ? "result" : "results"} that come up for that search and they share no wording this page is missing, so the title is not the problem I can prove. I am reading the pages that beat it next.`,
      [RECEIPT.serp, RECEIPT.ownedResult],
      [{ alternative: "Rewrite the page title", reason: "Nothing recurs across the pages that beat this one here, so I have nothing that proves sharper wording is what wins the click.", evidenceKeys: [RECEIPT.serp, RECEIPT.pattern] }]);
  }
  return {
    status: "diagnosed",
    cause: "snippet_intent_mismatch",
    action: "title",
    evidenceKeys: [RECEIPT.gsc, RECEIPT.copy, RECEIPT.serp, RECEIPT.ownedResult, RECEIPT.pattern, ...(input.body ? [RECEIPT.body] : [])],
    alternativesRuledOut: [
      { alternative: "Google is already showing the words people search for",
        reason: `Google shows this page as ${quote(displayed)}, and that line does not say ${words(shared)}.`,
        evidenceKeys: [RECEIPT.ownedResult] },
      { alternative: "A different page of yours is the one ranking",
        reason: "This page is the one Google shows for that search, so no other page of yours is taking the click.",
        evidenceKeys: [RECEIPT.ownedResult] },
    ],
    explanation: `I checked the results page: Google shows this page as ${quote(displayed)}, and the other sites that come up share wording that line does not carry: ${words(shared)}.`,
  };
}
