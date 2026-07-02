/**
 * Intent cluster conflict trigger (BEACON_500 item N7, 2026-07-02) -
 * predicate `intent_cluster_conflict`.
 *
 * THE GAP: the existing `thin_content_overlap` predicate guesses
 * cannibalization from title/H1 TOKEN similarity between two thin pages -
 * a proxy for intent, not proof of it. `intent-clusters.ts`
 * (src/domains/serp/intent-clusters.ts) instead reduces Beacon's own
 * already-stored `dataforseo_serp_history` rows: when two or more tracked
 * queries return top-10 results that heavily overlap, GOOGLE ITSELF has
 * decided those queries are one intent. When 2+ of the tenant's OWN pages
 * rank inside that one Google-defined intent, that is real, evidence-grade
 * cannibalization - not a token-overlap guess. This predicate is a thin,
 * PURE wrapper that turns each already-computed `IntentCluster` with
 * `conflict: true` into a `RecommendationCandidateRow` - it does no overlap
 * math itself (that math is pinned and unit-tested in intent-clusters.ts;
 * duplicating it here would risk the two drifting apart).
 *
 * ACTION: `merge_pages`, the SAME action `thin_content_overlap` already
 * uses - both predicates converge on the existing consolidation machinery
 * (specific-edit-validator.ts / recommendation-action-rows.ts already know
 * how to route merge_pages). This predicate's copy is grounded in the
 * SERP-overlap evidence and worded distinctly from `mergePagesCopy` so an
 * operator never confuses the two evidence sources.
 *
 * CONFIDENCE: `medium` (one tier above thin_content_overlap's `low`) - this
 * fires off literal Google top-10 overlap, not a token-similarity proxy,
 * so it deserves more trust than the guess it complements. `merge_pages`
 * has no promotion-ladder eligibility-table entry (see
 * `specific-edit-validator.ts`), so it can never auto-push regardless of
 * confidence - the operator always validates before anything ships.
 *
 * Anchored on the cluster's BEST-RANKING own page (the page worth keeping);
 * the candidate names the OTHER own pages in the cluster as the ones to
 * fold in, mirroring thin_content_overlap's anchor-vs-target convention.
 *
 * ONE emission per conflicting cluster, biggest cluster (most entangled
 * queries) first, capped so a bad crawl of overlapping content does not
 * flood the plan.
 *
 * PURE FUNCTION over pre-loaded clusters. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { intentClusterConflictCopy } from "../customer-copy-templates";
import type { IntentCluster } from "@/domains/serp/intent-clusters";

export type IntentClusterConflictInput = {
  tenantId: string;
  /** Pre-computed clusters from intent-clusters.ts (empty when no SERP
   *  history exists yet, or nothing overlapped). Only entries with
   *  `conflict: true` produce a candidate; the rest are silently skipped
   *  here (they belong to the future N2 ownership registry, not this
   *  alert). */
  clusters: ReadonlyArray<IntentCluster>;
  /** ISO timestamp the clusters were computed at (created_from_signal_at). */
  signalAt: string;
  /** Cap on how many conflicting clusters feed the candidate builder per
   *  run, mirroring sov-drop-alert's DEFAULT_MAX_CANDIDATES. Defaults to 3. */
  maxCandidates?: number;
};

const DEFAULT_MAX_CANDIDATES = 3;

/**
 * @no-classifier-required: the anchor is a known owned page URL taken
 * directly from the pre-computed cluster's best-ranking own page (a
 * SERP-history observation), not a crawled snapshot - neither
 * `classifyPageType` nor `isNonHtmlAsset` applies. (Sanctioned opt-out per
 * the page-classifier architecture invariant, same shape of opt-out
 * displacement-check-alert.ts / sov-drop-alert.ts use for their own
 * non-snapshot anchors.)
 */
export function intentClusterConflict(
  input: IntentClusterConflictInput,
): RecommendationCandidateRow[] {
  const { tenantId, clusters, signalAt } = input;
  const conflicts = clusters.filter((c) => c.conflict && c.ownPagesInCluster.length >= 2);
  if (conflicts.length === 0) return [];

  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  // Biggest cluster (most entangled queries) first - the largest cleanup
  // opportunity, matching the ranking convention of the other alert
  // predicates (worst-first).
  const ranked = [...conflicts].sort((a, b) => b.queries.length - a.queries.length).slice(0, maxCandidates);

  const actionType = "merge_pages" as const;

  return ranked.map((cluster) => {
    // ownPagesInCluster is already sorted best-rank-first (intent-clusters.ts).
    const [keep, ...fold] = cluster.ownPagesInCluster;
    const targetUrl = keep!.url;
    const otherUrls = fold.map((p) => p.url);
    const topicClusterLabel = `intent_cluster_conflict:${cluster.clusterId}`;

    return {
      tenant_id: tenantId,
      trigger_signal: "intent_cluster_conflict",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot_pair",
          ref: cluster.clusterId,
          detail:
            "intent_cluster_conflict cluster=" +
            cluster.clusterId +
            "; queries=" +
            cluster.queries.join(" | ") +
            "; shared_urls=" +
            cluster.sharedUrls.length +
            "; own_pages=" +
            cluster.ownPagesInCluster.map((p) => `${p.url} (best_rank=${p.bestRank})`).join(", "),
        },
      ],
      confidence: "medium",
      impact_estimate: cluster.queries.length >= 3 ? "high" : "medium",
      customer_copy: intentClusterConflictCopy(cluster.queries.length, cluster.ownPagesInCluster.length),
      operator_evidence:
        `intent_cluster_conflict: keep=${targetUrl}; fold_in=${otherUrls.join(", ")}; ` +
        `queries=[${cluster.queries.join(", ")}]; shared_urls=${cluster.sharedUrls.length}`,
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
