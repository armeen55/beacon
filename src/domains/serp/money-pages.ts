/**
 * money-pages (2026-07-02, master plan item 60) - PURE traffic-weighted money-page
 * aggregation, the first half of the clone-and-beat brief engine. Reuses the SAME
 * ranked_keywords / domain_intersection pulls the keyword-gap engine already fetches
 * (items 16+18) - $0 marginal cost when the Labs cache is warm - and rolls them up
 * per competitor URL instead of per keyword.
 *
 * DataForSEO does not hand us a traffic number for a URL that isn't ours (Google
 * Search Console-style clicks are private), so "traffic-weighted" here means the
 * SAME CTR-decay proxy the gap engine already uses for ranking (winnability(rank)):
 * a keyword a page holds at rank 3 sends it far more of its search volume than one
 * held at rank 18. Summing `volume * winnability(rank)` across every keyword a URL
 * ranks for gives an honest, deterministic estimate of which competitor pages carry
 * the most demand - their "money pages" - without inventing a number DataForSEO
 * does not report.
 *
 * No I/O, no server-only. Unit-tested in money-pages.test.ts.
 */

import { winnability, type KeywordGapRow } from "./keyword-gaps";

export type MoneyPageKeyword = {
  keyword: string;
  volume: number | null;
  rank: number;
  /** volume * winnability(rank) - this keyword's share of the page's traffic weight. */
  weight: number;
};

export type MoneyPage = {
  url: string;
  competitorDomain: string;
  /** Sum of every ranking keyword's traffic weight - the sort key. */
  trafficWeight: number;
  /** How many of the page's ranked keywords actually reported a search volume. */
  keywordCount: number;
  /** Top keywords driving the weight, highest weight first (bounded). */
  topKeywords: MoneyPageKeyword[];
};

/** Compact promotion ceiling. The complete 500-row corpus stays in the 30-day
 * provider cache; fifty high-signal rows are enough for downstream clustering
 * and drafting without hauling the raw response through every page render. */
const MAX_TOP_KEYWORDS_PER_PAGE = 50;

/**
 * Aggregate raw Labs rows (both endpoints, all checked competitors) into a
 * traffic-weighted ranked list of competitor URLs - their money pages. PURE.
 * Rows without a ranking URL (older cache entries, or an endpoint that didn't
 * report one) are silently skipped - never fabricate a URL.
 *
 * @param rows        parsed Labs rows (ranked_keywords + domain_intersection)
 * @param perDomain   max money pages returned PER competitor domain (default 20,
 *                    matching item 60's "top 20 money pages")
 */
export function aggregateMoneyPages(
  rows: readonly KeywordGapRow[],
  perDomain = 20,
): MoneyPage[] {
  type Acc = { url: string; competitorDomain: string; keywords: MoneyPageKeyword[] };
  const byUrl = new Map<string, Acc>();

  for (const row of rows) {
    const url = row.rankingUrl?.trim();
    if (!url) continue;
    const rank = row.competitorRank;
    if (!Number.isFinite(rank) || rank < 1 || rank > 100) continue;
    const keyword = row.keyword.trim();
    if (!keyword) continue;

    const weight = (row.volume ?? 0) * winnability(rank);
    const prev = byUrl.get(url);
    const entry: MoneyPageKeyword = { keyword, volume: row.volume, rank, weight };
    if (!prev) {
      byUrl.set(url, { url, competitorDomain: row.competitorDomain, keywords: [entry] });
    } else {
      // Same keyword can appear twice across the two endpoints - keep the better rank.
      const dupe = prev.keywords.find((k) => k.keyword === keyword);
      if (dupe) {
        if (weight > dupe.weight) Object.assign(dupe, entry);
      } else {
        prev.keywords.push(entry);
      }
    }
  }

  const pages: MoneyPage[] = [...byUrl.values()].map((acc) => {
    const sorted = [...acc.keywords].sort((a, b) => b.weight - a.weight);
    const trafficWeight = sorted.reduce((sum, k) => sum + k.weight, 0);
    return {
      url: acc.url,
      competitorDomain: acc.competitorDomain,
      trafficWeight: Math.round(trafficWeight),
      keywordCount: sorted.filter((k) => k.volume != null).length,
      topKeywords: sorted.slice(0, MAX_TOP_KEYWORDS_PER_PAGE),
    };
  });

  // Rank + bound PER competitor domain (item 60: "their top 20 money pages" - a
  // per-domain cap, not a single flat cap that would let one competitor crowd out
  // the others when several are checked in one run).
  const byDomain = new Map<string, MoneyPage[]>();
  for (const p of pages) {
    const list = byDomain.get(p.competitorDomain) ?? [];
    list.push(p);
    byDomain.set(p.competitorDomain, list);
  }

  const out: MoneyPage[] = [];
  for (const domain of [...byDomain.keys()].sort()) {
    const list = byDomain
      .get(domain)!
      .sort((a, b) => b.trafficWeight - a.trafficWeight || b.keywordCount - a.keywordCount || a.url.localeCompare(b.url))
      .slice(0, perDomain);
    out.push(...list);
  }
  // Final order: highest traffic weight first across all checked competitors,
  // domain grouping above only bounded the per-domain bench.
  out.sort((a, b) => b.trafficWeight - a.trafficWeight || a.url.localeCompare(b.url));
  return out;
}

/**
 * Bound the money-page list to the top N URLs to feed the teardown (item 60: "top
 * 5 URLs per run, polite fetch"). PURE selection - the caller runs the actual
 * fetches. Highest traffic weight first, already the sort order of `aggregateMoneyPages`.
 */
export function pickTeardownTargets(pages: readonly MoneyPage[], limit = 5): MoneyPage[] {
  return [...pages].slice(0, Math.max(0, limit));
}
