/**
 * competitor-discovery (2026-07-03, BEACON_500 P9 v1 420) - PURE detector that
 * derives who ACTUALLY competes with the tenant from persisted Google-results
 * overlap, NOT from a hand-picked list. Over the already-paid-for
 * dataforseo_serp_history top_domains (see dataforseo-serp.ts / serp-history.ts),
 * it finds the domains that KEEP showing up on the searches the tenant cares
 * about and beat the tenant's own page - the honest, evidence-grounded answer to
 * "who are my real competitors?".
 *
 * THE GAP, named: the old competitor lists were hand-guessed (and, per the
 * project memory, wrong). This replaces the guess with a count: a real
 * competitor is a domain that appears in Google's top results across MANY of the
 * tenant's tracked queries. The more distinct queries a domain beats you on, the
 * higher it ranks - "these 5 sites keep beating you on the searches you care
 * about", with the exact number of overlapping searches as the proof.
 *
 * DETERMINISTIC, empty-safe:
 *   • A domain must appear in the top TOP_SLOT results of at least
 *     MIN_QUERY_OVERLAP distinct tracked queries to count (a one-off appearance
 *     is not a competitor). The floor keeps a random blog off the list.
 *   • The tenant's own domain and noise/aggregator domains are excluded.
 *   • "Beats you" is counted honestly: a query where the competitor ranks and
 *     the tenant either does not rank or ranks below the competitor.
 *   • Uses the MOST RECENT capture per query so a competitor that has since
 *     dropped off is not counted from stale data (this pairs with the
 *     broken-competitor detector, which surfaces the drop separately).
 *
 * Empty when there is no history, no domain clears the overlap floor, or the
 * input is empty - honest silence. No I/O, no server-only: the caller passes
 * already-read history rows (the loader in competitor-discovery-loader.ts does
 * the bounded Supabase read).
 */

import { rootDomain } from "@/domains/serp/serp-provider";
import { isNoiseDomain } from "@/domains/evidence/relevance-gate";
import type { SerpOrganicItem } from "@/domains/serp/dataforseo-serp";

/** One history row's competitor-discovery-relevant fields. */
export type CompetitorDiscoveryHistoryRow = {
  query: string;
  capturedAt: string;
  ownRank: number | null;
  topDomains: SerpOrganicItem[];
};

/** One derived true competitor: a domain that keeps appearing on the tenant's
 *  tracked searches. Never fabricated - every count is a literal observation. */
export type DiscoveredCompetitor = {
  domain: string;
  /** Distinct tracked queries where this domain appears in the top results. */
  queryOverlap: number;
  /** Of those, how many the domain BEATS the tenant on (tenant absent or below). */
  queriesBeatingYou: number;
  /** The best (lowest) rank this domain has held across all its appearances. */
  bestRank: number;
  /** Up to a few example queries where the domain beats the tenant, for proof. */
  exampleQueries: string[];
};

export type CompetitorDiscoveryResult = {
  competitors: DiscoveredCompetitor[];
  /** How many distinct tracked queries had usable Google-results history. */
  queriesWithData: number;
  /** First-person, dash-clean honest headline, or null when the list is empty. */
  headline: string | null;
};

/** Only appearances in the top slots count as "competing" - a domain sitting at
 *  rank 30 is not beating you in any meaningful sense. */
const TOP_SLOT = 10;

/** A domain must overlap on at least this many distinct queries to be called a
 *  competitor - one appearance is coincidence, not competition. */
const MIN_QUERY_OVERLAP = 2;

/** Cap the returned list - the honest "top few" the operator can act on. */
const MAX_COMPETITORS = 5;

const MAX_EXAMPLE_QUERIES = 3;

function normQuery(q: string): string {
  return q.trim().toLowerCase();
}

/** The most recent capture per normalized query (freshest reading wins). */
function latestPerQuery(rows: CompetitorDiscoveryHistoryRow[]): CompetitorDiscoveryHistoryRow[] {
  const byQuery = new Map<string, CompetitorDiscoveryHistoryRow>();
  for (const r of rows) {
    const key = normQuery(r.query);
    if (!key) continue;
    const prior = byQuery.get(key);
    if (!prior || Date.parse(r.capturedAt) > Date.parse(prior.capturedAt)) byQuery.set(key, r);
  }
  return [...byQuery.values()];
}

/**
 * PURE: derive the tenant's real competitors from Google-results overlap. Groups
 * to the latest capture per query, counts each non-own non-noise domain's
 * distinct-query overlap + how often it beats the tenant, and returns the top
 * few that clear the overlap floor. Empty-safe.
 */
export function discoverCompetitors(
  rows: CompetitorDiscoveryHistoryRow[],
  ownDomain: string | null | undefined,
  opts: { minOverlap?: number; maxCompetitors?: number } = {},
): CompetitorDiscoveryResult {
  const own = rootDomain((ownDomain ?? "").trim());
  const minOverlap = opts.minOverlap ?? MIN_QUERY_OVERLAP;
  const maxCompetitors = opts.maxCompetitors ?? MAX_COMPETITORS;

  const latest = latestPerQuery(rows).filter((r) => r.topDomains.length > 0);
  const queriesWithData = latest.length;
  if (queriesWithData === 0) {
    return { competitors: [], queriesWithData: 0, headline: null };
  }

  type Agg = {
    queries: Set<string>;
    beats: Set<string>;
    bestRank: number;
    examples: string[];
  };
  const byDomain = new Map<string, Agg>();

  for (const row of latest) {
    const query = normQuery(row.query);
    // The best (lowest) rank each domain held in THIS capture, plus whether it
    // beats the tenant's own rank in this capture.
    const seenThisQuery = new Set<string>();
    for (const it of row.topDomains) {
      if (typeof it.rank !== "number" || it.rank > TOP_SLOT) continue;
      const dom = (it.domain || rootDomain(it.url)).toLowerCase();
      if (!dom || !dom.includes(".")) continue;
      if (own && (dom === own || dom.endsWith(`.${own}`))) continue;
      if (it.url && isNoiseDomain(it.url)) continue;
      if (seenThisQuery.has(dom)) continue; // count a domain once per query
      seenThisQuery.add(dom);

      let agg = byDomain.get(dom);
      if (!agg) {
        agg = { queries: new Set(), beats: new Set(), bestRank: it.rank, examples: [] };
        byDomain.set(dom, agg);
      }
      agg.queries.add(query);
      if (it.rank < agg.bestRank) agg.bestRank = it.rank;
      // "Beats you" = tenant not ranked, or ranked strictly below this domain.
      const beatsYou = row.ownRank == null || it.rank < row.ownRank;
      if (beatsYou) {
        agg.beats.add(query);
        if (agg.examples.length < MAX_EXAMPLE_QUERIES && !agg.examples.includes(query)) {
          agg.examples.push(query);
        }
      }
    }
  }

  const competitors: DiscoveredCompetitor[] = [...byDomain.entries()]
    .map(([domain, agg]) => ({
      domain,
      queryOverlap: agg.queries.size,
      queriesBeatingYou: agg.beats.size,
      bestRank: agg.bestRank,
      exampleQueries: agg.examples,
    }))
    .filter((c) => c.queryOverlap >= minOverlap)
    // Rank by how many searches they beat you on, then total overlap, then the
    // best spot they hold, then alphabetically for a stable order.
    .sort(
      (a, b) =>
        b.queriesBeatingYou - a.queriesBeatingYou ||
        b.queryOverlap - a.queryOverlap ||
        a.bestRank - b.bestRank ||
        a.domain.localeCompare(b.domain),
    )
    .slice(0, maxCompetitors);

  return {
    competitors,
    queriesWithData,
    headline: buildHeadline(competitors),
  };
}

/** PURE: the honest one-line headline, or null when the list is empty. */
export function buildHeadline(competitors: ReadonlyArray<DiscoveredCompetitor>): string | null {
  if (competitors.length === 0) return null;
  const beating = competitors.filter((c) => c.queriesBeatingYou > 0);
  if (beating.length === 0) {
    // They show up alongside you but do not clearly beat you anywhere yet.
    const siteWord = competitors.length === 1 ? "site keeps" : "sites keep";
    return `These ${competitors.length} ${siteWord} showing up next to you on the searches you care about. Watch them closely.`;
  }
  const n = beating.length;
  const siteWord = n === 1 ? "site keeps" : "sites keep";
  return `These ${n} ${siteWord} beating you on the searches you care about.`;
}
