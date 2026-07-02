/**
 * intent-clusters.ts (2026-07-02, BEACON_500 item N7) - SERP-overlap intent
 * clustering, the precursor to the N2 query-to-page ownership registry.
 *
 * THE IDEA: Google itself tells us when two queries mean the same thing - if
 * their top-10 organic results share most of the same URLs, Google has
 * already decided the searcher's intent is one intent, not two. Beacon
 * already stores exactly the evidence needed for this in
 * `dataforseo_serp_history.top_domains` (the ranked { rank, domain, url }
 * organic array captured on every live SERP read - see
 * `src/domains/serp/dataforseo-serp.ts::organicItemsOf`). This module reads
 * NOTHING new; it only reduces rows Beacon already paid for once.
 *
 * PURE. No Supabase, no fetch, no env reads in this file - every function
 * takes already-loaded rows and returns a value. The loader that reads
 * Supabase lives in `intent-clusters-loader.ts` (kept separate so this file
 * stays trivially unit-testable and mirrors the trigger-predicate-purity
 * convention used across `recommendation-intelligence/triggers/*`).
 *
 * ALGORITHM:
 *   1. One representative snapshot per query (the most recent
 *      `dataforseo_serp_history` row) - never mixes two different capture
 *      dates for the same query into one comparison.
 *   2. Pairwise Jaccard-style overlap over the top-10 URL sets. Two queries
 *      join the same cluster when >= OVERLAP_THRESHOLD of the smaller
 *      query's 10 results also appear in the other's (default 4 of 10 -
 *      the number the task spec calls out; matches Google's "same SERP"
 *      folk threshold used by rank trackers generally).
 *   3. Union-find merges transitively overlapping queries into one cluster
 *      (query A overlaps B, B overlaps C => A, B, C are one cluster even if
 *      A and C alone do not clear the threshold - this is deliberate: a
 *      cluster is a connected component of "Google treats these as the same
 *      SERP", not a clique).
 *   4. Per cluster: which of the tenant's OWN pages actually rank in ANY
 *      member query's top 10 (own-page identification reuses the same
 *      root-domain matching `resolveOwnRank` uses, so "own" here means
 *      exactly what the rest of the SERP domain already means by it).
 *   5. `conflict: true` when 2+ DISTINCT own URLs appear across the
 *      cluster's member queries - two of the tenant's own pages are being
 *      sent by Google to fight over one intent (real cannibalization,
 *      proven by Google's own top-10, not guessed from title tokens).
 *
 * HONESTY: `coverage` reports how many of the tenant's tracked queries this
 * run actually had usable SERP history and how many didn't, so callers never
 * mistake "no cluster found" for "no cannibalization exists" when it really
 * means "we haven't captured a SERP for that query yet".
 */

import { rootDomain } from "./serp-provider";
import type { SerpOrganicItem } from "./dataforseo-serp";

/** One already-captured SERP snapshot for one query, the minimal shape this
 *  module needs (matches what `serp-history.ts` reads off
 *  `dataforseo_serp_history`, but this file never reads Supabase itself). */
export type QuerySerpSnapshot = {
  query: string;
  capturedAt: string;
  /** Ranked top-10 (or fewer) organic results captured for this query. */
  topResults: ReadonlyArray<SerpOrganicItem>;
};

export type IntentCluster = {
  clusterId: string;
  /** Every query in this connected component, in the order first seen. */
  queries: string[];
  /** URLs shared by 2+ member queries' top-10s (the literal overlap
   *  evidence - the "Google shows the same results" proof). */
  sharedUrls: string[];
  /** Every distinct owned URL that ranks in ANY member query's top 10,
   *  ranked by best (lowest) observed rank first. Empty when the tenant
   *  does not rank for this intent at all yet. */
  ownPagesInCluster: Array<{ url: string; bestRank: number; queries: string[] }>;
  /** True when 2+ DISTINCT own URLs compete inside this one cluster -
   *  cannibalization, proven by SERP overlap rather than inferred from
   *  title/H1 token similarity. */
  conflict: boolean;
};

export type IntentClusterCoverage = {
  /** Distinct queries passed in. */
  totalQueries: number;
  /** Queries that had a usable SERP snapshot (non-empty top results). */
  queriesWithSerpData: number;
  /** Queries passed in with no usable SERP snapshot at all - Beacon has
   *  never captured (or the capture came back empty for) these; honestly
   *  reported rather than silently dropped. */
  queriesMissingSerpData: string[];
  /** queriesWithSerpData / totalQueries, 0 when totalQueries is 0. */
  coverageRatio: number;
};

export type IntentClusterResult = {
  clusters: IntentCluster[];
  coverage: IntentClusterCoverage;
};

/** Default: 4 of the smaller query's 10 results shared = same intent. */
export const DEFAULT_OVERLAP_THRESHOLD = 4;
/** Only compare the top N organic results per snapshot (defensive cap; the
 *  stored rows are already top-10-ish, but never trust an upstream shape
 *  drift to blow up the pairwise comparison cost). */
const TOP_N = 10;

const normQuery = (q: string) => q.trim().toLowerCase();

/** PURE: reduce possibly-multiple stored snapshots per query down to ONE
 *  representative per query (the most recently captured), so the pairwise
 *  comparison never mixes two different capture dates for the same query. */
export function latestSnapshotPerQuery(
  snapshots: ReadonlyArray<QuerySerpSnapshot>,
): Map<string, QuerySerpSnapshot> {
  const byQuery = new Map<string, QuerySerpSnapshot>();
  for (const snap of snapshots) {
    const q = normQuery(snap.query);
    if (!q) continue;
    const existing = byQuery.get(q);
    if (!existing || Date.parse(snap.capturedAt) > Date.parse(existing.capturedAt)) {
      byQuery.set(q, snap);
    }
  }
  return byQuery;
}

function topUrlSet(snap: QuerySerpSnapshot): Set<string> {
  return new Set(
    [...snap.topResults]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, TOP_N)
      .map((r) => r.url),
  );
}

/** PURE: how many URLs two top-10 sets share. */
export function sharedResultCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const url of a) if (b.has(url)) shared++;
  return shared;
}

/** PURE: do these two query snapshots clear the overlap threshold? Compared
 *  against the SMALLER set's size so a query with fewer than 10 captured
 *  results (a thin SERP, or a truncated capture) is not unfairly penalized
 *  against a full 10-result query. */
export function overlaps(
  a: QuerySerpSnapshot,
  b: QuerySerpSnapshot,
  threshold: number = DEFAULT_OVERLAP_THRESHOLD,
): boolean {
  const setA = topUrlSet(a);
  const setB = topUrlSet(b);
  if (setA.size === 0 || setB.size === 0) return false;
  return sharedResultCount(setA, setB) >= threshold;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * PURE: identify which of a cluster's member queries' top-10 URLs belong to
 * the tenant's own domain. Reuses the exact root-domain matching
 * `resolveOwnRank` uses elsewhere in the SERP domain (subdomains count as
 * owned; suffix look-alikes like "notiranopedia.com" do not), so "own" means
 * the same thing here as everywhere else in the app.
 */
function ownPagesAcross(
  memberSnapshots: ReadonlyArray<QuerySerpSnapshot>,
  ownDomain: string,
): Array<{ url: string; bestRank: number; queries: string[] }> {
  const own = rootDomain(ownDomain.trim());
  if (!own) return [];
  const byUrl = new Map<string, { url: string; bestRank: number; queries: Set<string> }>();
  for (const snap of memberSnapshots) {
    for (const r of snap.topResults) {
      const d = (r.domain || rootDomain(r.url)).toLowerCase();
      if (d !== own && !d.endsWith(`.${own}`)) continue;
      const existing = byUrl.get(r.url);
      if (existing) {
        existing.bestRank = Math.min(existing.bestRank, r.rank);
        existing.queries.add(snap.query);
      } else {
        byUrl.set(r.url, { url: r.url, bestRank: r.rank, queries: new Set([snap.query]) });
      }
    }
  }
  return [...byUrl.values()]
    .map((v) => ({ url: v.url, bestRank: v.bestRank, queries: [...v.queries] }))
    .sort((a, b) => a.bestRank - b.bestRank);
}

/**
 * Compute intent clusters from already-loaded SERP snapshots. PURE - the
 * caller is responsible for loading `snapshots` from
 * `dataforseo_serp_history` ($0, no new paid SERP pulls: see
 * `loadIntentClustersForTenant` in intent-clusters-loader.ts) and for
 * passing every tracked query so `coverage` can honestly report gaps.
 *
 * @param trackedQueries every query the tenant cares about this run (e.g.
 *   GSC queries + tracked keywords). Queries with no entry in `snapshots`
 *   are counted in `coverage.queriesMissingSerpData` and excluded from
 *   clustering (never fabricated).
 * @param snapshots already-captured SERP history rows, any number per
 *   query (the newest per query wins - see `latestSnapshotPerQuery`).
 * @param ownDomain the tenant's own root domain (e.g. "iranopedia.com").
 *   When empty/null, clusters still compute but `ownPagesInCluster` and
 *   `conflict` are always empty/false (never guessed).
 */
export function computeIntentClusters(input: {
  trackedQueries: ReadonlyArray<string>;
  snapshots: ReadonlyArray<QuerySerpSnapshot>;
  ownDomain: string | null;
  overlapThreshold?: number;
}): IntentClusterResult {
  const { trackedQueries, snapshots, ownDomain } = input;
  const threshold = input.overlapThreshold ?? DEFAULT_OVERLAP_THRESHOLD;

  const distinctTracked = [...new Set(trackedQueries.map(normQuery).filter((q) => q.length > 0))];
  const byQuery = latestSnapshotPerQuery(snapshots);

  const usable: QuerySerpSnapshot[] = [];
  const missing: string[] = [];
  for (const q of distinctTracked) {
    const snap = byQuery.get(q);
    if (snap && snap.topResults.length > 0) usable.push(snap);
    else missing.push(q);
  }

  const coverage: IntentClusterCoverage = {
    totalQueries: distinctTracked.length,
    queriesWithSerpData: usable.length,
    queriesMissingSerpData: missing,
    coverageRatio: distinctTracked.length > 0 ? usable.length / distinctTracked.length : 0,
  };

  if (usable.length < 2) {
    return { clusters: [], coverage };
  }

  // Pairwise overlap -> union-find. Bounded n^2 over the USABLE subset only
  // (mirrors thin-content-overlap.ts's bounded-pairwise posture).
  const uf = new UnionFind();
  for (const snap of usable) uf.find(snap.query);
  const urlSets = new Map(usable.map((s) => [s.query, topUrlSet(s)] as const));
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i]!;
      const b = usable[j]!;
      const setA = urlSets.get(a.query)!;
      const setB = urlSets.get(b.query)!;
      if (setA.size === 0 || setB.size === 0) continue;
      if (sharedResultCount(setA, setB) >= threshold) uf.union(a.query, b.query);
    }
  }

  // Group queries by their union-find root, preserving first-seen order.
  const groups = new Map<string, QuerySerpSnapshot[]>();
  for (const snap of usable) {
    const root = uf.find(snap.query);
    const list = groups.get(root);
    if (list) list.push(snap);
    else groups.set(root, [snap]);
  }

  const clusters: IntentCluster[] = [];
  let clusterIndex = 0;
  for (const members of groups.values()) {
    // Single-query "clusters" (nothing overlapped it) are not an intent
    // collision by definition - skip them. A cluster requires 2+ queries
    // Google itself grouped by shared results.
    if (members.length < 2) continue;

    clusterIndex += 1;
    const clusterId = `intent_cluster_${clusterIndex}`;

    // Shared URLs = any URL appearing in 2+ member queries' top-10s.
    const urlQueryCount = new Map<string, number>();
    for (const m of members) {
      for (const url of urlSets.get(m.query)!) {
        urlQueryCount.set(url, (urlQueryCount.get(url) ?? 0) + 1);
      }
    }
    const sharedUrls = [...urlQueryCount.entries()]
      .filter(([, count]) => count >= 2)
      .map(([url]) => url);

    const ownPagesInCluster = ownDomain ? ownPagesAcross(members, ownDomain) : [];
    const distinctOwnUrls = new Set(ownPagesInCluster.map((p) => p.url));

    clusters.push({
      clusterId,
      queries: members.map((m) => m.query),
      sharedUrls,
      ownPagesInCluster,
      conflict: distinctOwnUrls.size >= 2,
    });
  }

  // Worst-first: conflicts before non-conflicts, then by cluster size (more
  // queries entangled = bigger cleanup), so a caller taking the head of the
  // list sees the highest-value clusters first.
  clusters.sort((a, b) => {
    if (a.conflict !== b.conflict) return a.conflict ? -1 : 1;
    return b.queries.length - a.queries.length;
  });

  return { clusters, coverage };
}

/** PURE: every cluster with a real, Google-proven cannibalization conflict. */
export function conflictClusters(result: IntentClusterResult): IntentCluster[] {
  return result.clusters.filter((c) => c.conflict);
}
