/**
 * trend-radar/spike-move-match (2026-07-02, master plan item 14) - PURE match
 * from a query spike to a worklist change the operator can actually open,
 * reusing the demand-graph evidence match helpers (relevance-gate
 * distinguishing-token rule) instead of inventing a new matcher.
 *
 * The Today Demand band matches against the WORKLIST SURFACE rows (the exact
 * rows the /changes changes list is built from), not the raw graph, so a
 * "See the matching change" deep link can never land on an empty filter. The
 * search term is the page PATH (always part of the worklist search haystack).
 */

import { scoreTopicMatch } from "@/domains/evidence/relevance-gate";
import { normalizePath } from "@/domains/experiments/daily-plan-types";
import type { QuerySpike } from "./query-spikes";

/** The minimal worklist-row shape the matcher needs (a TodayMove subset). */
export type MatchableMove = {
  /** The page label (or move label) shown on the worklist row. */
  label: string;
  /** The row's target search, when known (a second topic-match surface). */
  query?: string | null;
  /** The owned page the row targets. */
  ownedUrl: string | null;
};

export type SpikeMoveMatch = {
  /** The needle to put in /changes?search=... (the page path when known). */
  searchTerm: string;
};

/**
 * Find the worklist change a spike belongs to, or null when none exists.
 * 1. An owned-page path match wins (the change already targets the spiking page).
 * 2. Otherwise a topic match: the row's label or search shares a distinguishing
 *    token with the spiking query (relevance-gate rule, so "tehran" never
 *    matches "iranian snacks").
 */
export function matchSpikeToMove(
  spike: Pick<QuerySpike, "query" | "topPage">,
  moves: ReadonlyArray<MatchableMove>,
): SpikeMoveMatch | null {
  if (spike.topPage) {
    const path = normalizePath(spike.topPage);
    if (path && path !== "/") {
      const byPage = moves.find((m) => m.ownedUrl && normalizePath(m.ownedUrl) === path);
      if (byPage) return { searchTerm: path };
    }
  }
  const byTopic = moves.find(
    (m) =>
      (m.label && scoreTopicMatch(spike.query, m.label).relevant) ||
      (m.query && scoreTopicMatch(spike.query, m.query).relevant),
  );
  if (!byTopic) return null;
  const topicPath = byTopic.ownedUrl ? normalizePath(byTopic.ownedUrl) : "";
  return { searchTerm: topicPath && topicPath !== "/" ? topicPath : byTopic.label };
}
