/**
 * registry.ts (2026-07-02, BEACON_500 item N2 - query-to-page ownership registry)
 *
 * THE PROBLEM: every past cannibalization mistake (v1 143 draft grounding, 242
 * mixed-intent split, 270/271 wrong-landing-page) traces back to the SAME root
 * cause - no single place ever answered "which page owns this query/topic?"
 * before a generator, drafter, or new-page candidate acted. Each engine guessed
 * independently, so two engines could each believe THEY owned one query and
 * fight over it.
 *
 * THIS FILE: one canonical owner map, computed from data Beacon already reads
 * ($0, no new I/O of its own - PURE). For every known query, it names:
 *   - owner: the page that should get any edit targeting this query, or null
 *     when nothing yet owns it (a real create_page opportunity).
 *   - basis: WHY that page is the owner -
 *       "gsc_ranks"   - Google itself sends the most impressions to this page
 *                       for this query (gsc-cannibalization.ts's per-query,
 *                       per-URL impression/position data - the strongest,
 *                       most current signal: Google's own crawl+index verdict).
 *       "serp_cluster" - no single page dominates one query, but SERP-overlap
 *                       clustering (intent-clusters.ts) proved 2+ tracked
 *                       queries are ONE Google-defined intent, and exactly one
 *                       of the tenant's own pages ranks inside that intent.
 *       "declared"    - a future operator pin (schema reserved now, not fed by
 *                       any loader yet - no declared entries exist today).
 *   - contenders: every OTHER owned page with a meaningful share of the same
 *     query/intent - the cannibalization risk list.
 *   - confidence: "high" (gsc_ranks with a clear leader), "medium" (gsc_ranks
 *     with a close contest, or serp_cluster), "low" (thin signal).
 *
 * PURE. This module never touches Supabase, fetch, or env - it only reduces
 * already-loaded rows. The I/O boundary (reading gsc-cannibalization.ts's RPC
 * output + intent-clusters-loader.ts's output for one tenant) lives in
 * registry-loader.ts, mirroring the split every other pure/loader pair in this
 * codebase already uses (intent-clusters.ts / intent-clusters-loader.ts).
 *
 * ONE resolver, `resolveOwner`, is the single answer every caller should ask
 * instead of re-deriving ownership from scratch. It normalizes both queries
 * (trim+lowercase, the same convention gsc-page-queries.ts and intent-
 * clusters.ts already use) and free-text topic labels (topicTokens() from
 * relevance-gate.ts - the same distinguishing-token utility the evidence-
 * relevance gate uses) so a create_page candidate's topic label ("Persian
 * Male Names") can resolve against a registry keyed by literal GSC queries
 * ("persian male names", "iranian boy names").
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { GscCannibalizationCase } from "@/domains/recommendation-intelligence/gsc-cannibalization";
import type { IntentCluster } from "@/domains/serp/intent-clusters";

export type OwnershipBasis = "gsc_ranks" | "serp_cluster" | "declared";
export type OwnershipConfidence = "high" | "medium" | "low";

export type OwnershipContender = {
  url: string;
  /** Share of the combined signal this contender holds (0..1). For gsc_ranks,
   *  share of impressions among competing URLs; for serp_cluster, an equal
   *  split across the cluster's distinct own pages (SERP overlap does not
   *  carry a click/impression weight per page). */
  share: number;
  /** Best (lowest) impression-weighted Google position observed for this URL
   *  on the owning query/cluster, when known. */
  position: number | null;
};

export type OwnerEntry = {
  /** The normalized query or topic key this entry answers for. */
  key: string;
  /** The page that owns this query/topic, or null when nothing owns it yet. */
  owner: string | null;
  basis: OwnershipBasis;
  /** Every OTHER owned page holding a meaningful share - real cannibalization
   *  risk, never the owner itself. Empty when only one page is involved. */
  contenders: OwnershipContender[];
  confidence: OwnershipConfidence;
  /** Plain-English, first-person, dash-free reason this entry resolved the way
   *  it did - safe to surface to the operator verbatim. */
  reason: string;
};

export type OwnershipRegistry = {
  /** Keyed by normalized literal query (trim+lowercase). The primary index. */
  byQuery: Map<string, OwnerEntry>;
  /** Every entry with 2+ contenders (real, evidence-backed ownership
   *  conflicts) - worst (most contenders, then lowest confidence) first. */
  conflicts: OwnerEntry[];
  coverage: {
    totalQueries: number;
    gscBasisCount: number;
    serpClusterBasisCount: number;
    unresolvedCount: number;
  };
};

/** A contender's share must clear this floor to count as real cannibalization
 *  risk - a page with a stray 1% of impressions is not "contending" for a
 *  query, it is noise (e.g. a homepage catching a search-operator query). */
const MIN_CONTENDER_SHARE = 0.08;
/** gsc_ranks needs this many total impressions before confidence is "high" -
 *  below this, a clear leader could still flip with a few more days of data. */
const HIGH_CONFIDENCE_MIN_IMPRESSIONS = 200;
/** The dominant URL needs at least this much MORE share than the runner-up to
 *  count as a "clear" leader (gsc_ranks high vs medium confidence). */
const CLEAR_LEAD_MARGIN = 0.25;

const normKey = (s: string): string => s.trim().toLowerCase();

/**
 * PURE: fold one gsc-cannibalization.ts case (a query + its competing owned
 * URLs by impressions/position) into an OwnerEntry. Every case here already
 * has 2+ competing URLs (groupCannibalizationRows enforces that), so this
 * always resolves an owner (the best-position/highest-impression URL) with
 * the rest as contenders - the direct "does Google send more impressions to
 * one of my own pages than the others" verdict.
 */
function entryFromCannibalizationCase(c: GscCannibalizationCase): OwnerEntry {
  const totalImpr = c.totalImpressions || 1;
  const ranked = [...c.competingUrls].sort((a, b) => b.impressions - a.impressions);
  const leader = ranked[0]!;
  const leaderShare = leader.impressions / totalImpr;
  const runnerUpShare = ranked[1] ? ranked[1].impressions / totalImpr : 0;

  const contenders: OwnershipContender[] = ranked
    .slice(1)
    .map((u) => ({ url: u.url, share: u.impressions / totalImpr, position: u.position }))
    .filter((c) => c.share >= MIN_CONTENDER_SHARE);

  const confidence: OwnershipConfidence =
    c.totalImpressions >= HIGH_CONFIDENCE_MIN_IMPRESSIONS && leaderShare - runnerUpShare >= CLEAR_LEAD_MARGIN
      ? "high"
      : contenders.length > 0
        ? "medium"
        : "low";

  const reason =
    contenders.length > 0
      ? `Google sends ${Math.round(leaderShare * 100)}% of the impressions for "${c.query}" to ${leader.url}, but ${contenders.length} other page(s) of mine also rank for it and split the rest.`
      : `Google sends nearly all impressions for "${c.query}" to ${leader.url}, its clear owner.`;

  return {
    key: normKey(c.query),
    owner: leader.url,
    basis: "gsc_ranks",
    contenders,
    confidence,
    reason,
  };
}

/**
 * PURE: fold one intent-clusters.ts cluster into one OwnerEntry PER member
 * query (every query in a cluster shares the same resolved owner - that is
 * the whole point of "Google treats these as one intent"). Only clusters with
 * at least one owned page produce an entry (an empty ownPagesInCluster means
 * the tenant does not rank for this intent at all yet - not this registry's
 * job to invent an owner).
 */
function entriesFromCluster(cluster: IntentCluster): OwnerEntry[] {
  if (cluster.ownPagesInCluster.length === 0) return [];
  const [best, ...rest] = cluster.ownPagesInCluster;
  const distinctOwn = cluster.ownPagesInCluster.length;
  // SERP overlap carries no per-page click/impression weight, so a fair
  // split is the honest signal: each contending page gets an equal share.
  const equalShare = 1 / distinctOwn;
  const contenders: OwnershipContender[] = rest
    .filter(() => equalShare >= MIN_CONTENDER_SHARE)
    .map((p) => ({ url: p.url, share: equalShare, position: p.bestRank }));

  const reason =
    contenders.length > 0
      ? `Google's own top-10 groups ${cluster.queries.length} of my tracked queries into one intent, and ${distinctOwn} of my own pages rank inside it - ${best!.url} ranks best (position ${best!.bestRank}).`
      : `Google's own top-10 groups ${cluster.queries.length} of my tracked queries into one intent, and only ${best!.url} (position ${best!.bestRank}) ranks inside it.`;

  return cluster.queries.map((q) => ({
    key: normKey(q),
    owner: best!.url,
    basis: "serp_cluster" as const,
    contenders,
    confidence: contenders.length > 0 ? ("medium" as const) : ("low" as const),
    reason,
  }));
}

/**
 * Build the canonical ownership registry from already-loaded evidence. PURE -
 * the caller (registry-loader.ts) is responsible for reading
 * loadGscCannibalizationForTenant + loadIntentClustersForTenant for one
 * tenant. gsc_ranks entries take priority over serp_cluster entries for the
 * SAME query (a direct Google-impressions verdict beats an intent-overlap
 * inference); serp_cluster only fills in queries gsc_ranks did not resolve.
 */
export function buildOwnershipRegistry(input: {
  cannibalization: ReadonlyArray<GscCannibalizationCase>;
  clusters: ReadonlyArray<IntentCluster>;
  trackedQueryCount?: number;
}): OwnershipRegistry {
  const byQuery = new Map<string, OwnerEntry>();
  let gscBasisCount = 0;
  let serpClusterBasisCount = 0;

  for (const c of input.cannibalization) {
    const entry = entryFromCannibalizationCase(c);
    if (!byQuery.has(entry.key)) {
      byQuery.set(entry.key, entry);
      gscBasisCount += 1;
    }
  }

  for (const cluster of input.clusters) {
    for (const entry of entriesFromCluster(cluster)) {
      if (byQuery.has(entry.key)) continue; // gsc_ranks already resolved this query
      byQuery.set(entry.key, entry);
      serpClusterBasisCount += 1;
    }
  }

  const conflicts = [...byQuery.values()]
    .filter((e) => e.contenders.length > 0)
    .sort((a, b) => {
      if (b.contenders.length !== a.contenders.length) return b.contenders.length - a.contenders.length;
      const confRank: Record<OwnershipConfidence, number> = { high: 2, medium: 1, low: 0 };
      return confRank[b.confidence] - confRank[a.confidence];
    });

  const totalQueries = input.trackedQueryCount ?? byQuery.size;

  return {
    byQuery,
    conflicts,
    coverage: {
      totalQueries,
      gscBasisCount,
      serpClusterBasisCount,
      unresolvedCount: Math.max(0, totalQueries - byQuery.size),
    },
  };
}

/**
 * THE resolver every caller should use instead of re-deriving ownership.
 * Tries, in order: (1) exact normalized-query match, (2) for a free-text
 * topic label (a create_page candidate's label, not a literal tracked
 * query), a distinguishing-topic-token match against every registry key -
 * the SAME token utility (topicTokens) the evidence-relevance gate uses, so
 * "related" means one thing across the app. Requires ALL of the shorter
 * side's distinguishing tokens to appear in the other (a strict subset/
 * equality match, not a loose overlap) so "Persian Male Names" can resolve
 * against a tracked query "best persian male names 2026" without also
 * matching an unrelated query that merely shares one generic word - every
 * generic/stopword token is already stripped by topicTokens, so what
 * remains is the distinguishing content.
 *
 * Returns null when nothing in the registry matches - the honest "I don't
 * know who owns this yet" answer, never a guess.
 */
export function resolveOwner(
  registry: OwnershipRegistry,
  queryOrTopic: string,
): OwnerEntry | null {
  const key = normKey(queryOrTopic ?? "");
  if (!key) return null;

  const exact = registry.byQuery.get(key);
  if (exact) return exact;

  const topicSet = new Set(topicTokens(queryOrTopic));
  if (topicSet.size === 0) return null;

  let best: OwnerEntry | null = null;
  let bestOverlap = 0;
  for (const entry of registry.byQuery.values()) {
    const entryTokens = new Set(topicTokens(entry.key));
    if (entryTokens.size === 0) continue;
    const [smaller, larger] = entryTokens.size <= topicSet.size ? [entryTokens, topicSet] : [topicSet, entryTokens];
    let shared = 0;
    for (const t of smaller) if (larger.has(t)) shared += 1;
    // Strict: every token of the SMALLER side must be present in the larger
    // side (a true subset), so "tehran" alone never matches "tehran hotels".
    if (shared !== smaller.size) continue;
    if (shared > bestOverlap) {
      bestOverlap = shared;
      best = entry;
    }
  }
  return best;
}

/** Convenience: does this query/topic already have a known owner (any
 *  basis)? Used by enforcement call sites that only need a yes/no gate. */
export function hasKnownOwner(registry: OwnershipRegistry, queryOrTopic: string): boolean {
  return resolveOwner(registry, queryOrTopic)?.owner != null;
}

/**
 * CONFLICT SURFACE (N2 item 3): the registry-only conflict shape the existing
 * `intent_cluster_conflict` trigger (src/domains/recommendation-intelligence/
 * triggers/intent-cluster-conflict.ts) already knows how to turn into a
 * `merge_pages` candidate. That trigger only ever saw `serp_cluster`-basis
 * conflicts (it consumes `IntentCluster[]` directly); this adapter converts
 * `gsc_ranks`-basis registry conflicts (from gsc-cannibalization.ts, a signal
 * the trigger never saw) into the SAME `IntentCluster` shape, so ONE emission
 * code path produces every merge_pages card - never two competing triggers
 * fighting over the same page pair.
 *
 * A `serp_cluster`-basis conflict is NEVER re-emitted here (it is already an
 * `IntentCluster` the caller already has) - only `gsc_ranks`-basis entries are
 * converted, so a caller merging `[...intentClusters, ...registryGscConflictsAsClusters(registry)]`
 * gets each real conflict exactly once. Entries are grouped by their
 * (owner, contender set) so multiple queries resolving to the SAME
 * cannibalization case collapse into ONE synthetic cluster, mirroring how one
 * real `GscCannibalizationCase` is one conflict, not one per query.
 */
export function registryGscConflictsAsClusters(registry: OwnershipRegistry): IntentCluster[] {
  const groups = new Map<string, { queries: string[]; owner: string; contenders: OwnershipContender[] }>();
  for (const entry of registry.conflicts) {
    if (entry.basis !== "gsc_ranks" || !entry.owner) continue;
    const groupKey = `${entry.owner}::${entry.contenders.map((c) => c.url).sort().join(",")}`;
    const g = groups.get(groupKey);
    if (g) g.queries.push(entry.key);
    else groups.set(groupKey, { queries: [entry.key], owner: entry.owner, contenders: entry.contenders });
  }

  let i = 0;
  const out: IntentCluster[] = [];
  for (const g of groups.values()) {
    i += 1;
    const ownPagesInCluster = [
      { url: g.owner, bestRank: 1, queries: g.queries },
      ...g.contenders.map((c) => ({ url: c.url, bestRank: c.position ?? 999, queries: g.queries })),
    ];
    out.push({
      clusterId: `registry_gsc_conflict_${i}`,
      queries: g.queries,
      sharedUrls: [],
      ownPagesInCluster,
      conflict: true,
    });
  }
  return out;
}
