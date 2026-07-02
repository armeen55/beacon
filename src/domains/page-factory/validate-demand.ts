/**
 * page-factory/validate-demand (BEACON 500 item 62) - $0 demand validation for
 * entity-attribute factory candidates. PURE / deterministic / no I/O.
 *
 * A candidate clears the governance floor when EITHER:
 *   (a) it matches a CACHED DataForSEO keyword (strong/exact confidence) with
 *       searchVolume >= DEMAND_FLOOR_VOLUME, or
 *   (b) the tenant's own demand graph already carries a Move for the same
 *       entity with a fused demand component >= DEMAND_FLOOR_GRAPH (real GSC
 *       impressions / AI-ask volume the graph already computed - "graph demand").
 *
 * A candidate with NO cached keyword match at all (neither a hit nor a miss -
 * simply never looked up) is QUEUED, not rejected: it stays a candidate for the
 * next capped keyword batch (dataforseo-keywords.ts's own $-capped run), and
 * this module never triggers a fresh paid lookup itself. A candidate that DID
 * match a cached keyword but fell under the floor, and has no graph-demand
 * backup either, is REJECTED (real signal, just not enough of it).
 *
 * Pinned by validate-demand.test.ts.
 */

import type { PageCandidate } from "./entity-attribute-factory";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { matchKeywordDemand } from "@/domains/demand/keyword-match";

/** Minimum cached monthly search volume for a candidate to be worth drafting. */
export const DEMAND_FLOOR_VOLUME = 100;

/** Minimum fused graph-demand component for the graph-demand fallback path. */
export const DEMAND_FLOOR_GRAPH = 50;

export type GraphDemandSignal = {
  /** The demand-graph Move's label (matched against the candidate's entity). */
  label: string;
  /** MoveComponents.demand - the fused raw demand signal already computed by the graph. */
  demand: number;
};

export type DemandVerdict =
  | { status: "pass"; source: "cached_keyword"; matchedKeyword: string; searchVolume: number }
  | { status: "pass"; source: "graph_demand"; matchedLabel: string; demand: number }
  | { status: "queued"; reason: string }
  | { status: "rejected"; reason: string };

/**
 * Validate ONE candidate against cached keyword demand + graph demand. Never
 * performs I/O and never triggers a fresh DataForSEO spend - `keywords` and
 * `graphSignals` are pre-loaded by the caller (production-line.ts) from the
 * existing $0 cache reads.
 */
export function validateCandidateDemand(
  candidate: Pick<PageCandidate, "title" | "entity">,
  keywords: readonly KeywordDemand[],
  graphSignals: readonly GraphDemandSignal[],
): DemandVerdict {
  const hasAnyCachedKeywords = keywords.length > 0;
  const match = matchKeywordDemand(candidate.title, null, keywords);

  if ((match.confidence === "exact" || match.confidence === "strong") && (match.searchVolume ?? 0) >= DEMAND_FLOOR_VOLUME) {
    return { status: "pass", source: "cached_keyword", matchedKeyword: match.keyword!, searchVolume: match.searchVolume! };
  }

  // Graph-demand fallback: the tenant's own demand graph already fused GSC +
  // AI-ask signal for a Move naming this same entity, above the floor.
  const entityLower = candidate.entity.toLowerCase();
  const graphHit = graphSignals
    .filter((g) => g.label.toLowerCase().includes(entityLower) && g.demand >= DEMAND_FLOOR_GRAPH)
    .sort((a, b) => b.demand - a.demand)[0];
  if (graphHit) {
    return { status: "pass", source: "graph_demand", matchedLabel: graphHit.label, demand: graphHit.demand };
  }

  // A real (weak/none) match against a non-empty cache, with no graph backup,
  // is an honest reject - the lookup happened, the demand just isn't there
  // strongly enough. Two distinct reasons, so the receipt never claims a
  // volume floor miss when the real issue is a weak topic match (or vice versa).
  if (hasAnyCachedKeywords && match.confidence !== "none") {
    const belowFloor = (match.searchVolume ?? 0) < DEMAND_FLOOR_VOLUME;
    const reason = belowFloor
      ? `Matched "${match.keyword}" at only ${match.searchVolume ?? 0}/mo, below the ${DEMAND_FLOOR_VOLUME}/mo floor.`
      : `Only a weak keyword match ("${match.keyword}") for this topic, not a confident enough demand signal to draft from.`;
    return { status: "rejected", reason };
  }
  if (hasAnyCachedKeywords && match.confidence === "none") {
    return { status: "queued", reason: "No cached keyword covers this topic yet. Queued for the next keyword batch." };
  }
  // No cached keyword data exists at all yet.
  return { status: "queued", reason: "No cached DataForSEO keyword data yet. Queued for the next keyword batch." };
}
