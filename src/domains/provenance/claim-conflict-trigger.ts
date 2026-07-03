/**
 * claim-conflict-trigger (BEACON_500 R13 / N3, 2026-07-03) - predicate
 * `claim_conflict`, fed through the existing deterministic trigger pipeline
 * (load-trigger-candidates-for-tenant.ts), same integration shape as
 * snippet-promise.ts (N18) and snippet-capture.ts (N29).
 *
 * PURE / no I/O / no LLM. The claim graph (provenance/claim-graph.ts) has
 * already found owned-page conflicts: two of the tenant's own pages carrying
 * MATERIALLY different values for the same claim subject (numbers more than
 * 5 percent apart, or differing dates - never punctuation). This module just
 * shapes each conflict into one candidate row with the plain ask:
 *
 *   "Two of your pages disagree about the year Persepolis was built
 *    (515 BC on /persepolis, 518 BC on /iran-history). Pick one and I will
 *    keep them consistent."
 *
 * This is the N26 seed: once the operator picks the right value, the fact
 * propagation engine owns updating every affected page. Until then there is
 * no mechanical edit to draft - the decision comes first - so the action is
 * `watch` (track without editing), the registry's existing passive action.
 * `claim_conflict::watch` has NO promotion-eligibility entry, so it can
 * never auto-push regardless of confidence (same deliberate posture as N7's
 * intent_cluster_conflict) - the operator always decides.
 *
 * Capped at MAX_CLAIM_CONFLICT_CANDIDATES per run, first-found first (graph
 * order is traffic order, so the most-seen disagreements surface first).
 *
 * @no-classifier-required: the anchor is a known owned page URL taken
 * directly from the claim record's affectedPages (a page_snapshots-derived
 * fact), not a crawled snapshot - neither `classifyPageType` nor
 * `isNonHtmlAsset` applies. (Sanctioned opt-out per the page-classifier
 * architecture invariant, same shape as intent-cluster-conflict.ts.)
 */

import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import { dedupeKey } from "@/domains/recommendation-intelligence/emitter/dedupe-key";
import { cooldownKey } from "@/domains/recommendation-intelligence/emitter/cooldown-key";
import { claimConflictCopy } from "@/domains/recommendation-intelligence/customer-copy-templates";
import type { ClaimConflict } from "./claim-graph";

export const MAX_CLAIM_CONFLICT_CANDIDATES = 3;

export function claimConflictCandidates(args: {
  tenantId: string;
  conflicts: readonly ClaimConflict[];
  signalAt: string;
  maxCandidates?: number;
}): RecommendationCandidateRow[] {
  const max = args.maxCandidates ?? MAX_CLAIM_CONFLICT_CANDIDATES;
  if (args.conflicts.length === 0) return [];

  const actionType = "watch" as const;

  return args.conflicts.slice(0, max).map((conflict) => {
    const targetUrl = conflict.a.pageUrl;
    const topicClusterLabel = `claim_conflict:${conflict.subjectKey}`;
    return {
      tenant_id: args.tenantId,
      trigger_signal: "claim_conflict",
      action_type: actionType,
      generator_kind: "deterministic" as const,
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot_pair" as const,
          ref: conflict.subjectKey,
          detail:
            "claim_conflict subject=" +
            conflict.subjectLabel +
            "; value_a=" +
            conflict.a.value +
            " on " +
            conflict.a.pagePath +
            "; value_b=" +
            conflict.b.value +
            " on " +
            conflict.b.pagePath,
        },
      ],
      confidence: "medium" as const,
      impact_estimate: "medium" as const,
      customer_copy: claimConflictCopy(
        conflict.subjectLabel,
        conflict.a.value,
        conflict.a.pagePath,
        conflict.b.value,
        conflict.b.pagePath,
      ),
      operator_evidence:
        "signal=claim_conflict; subject_key=" +
        conflict.subjectKey +
        "; a=" +
        conflict.a.value +
        "@" +
        conflict.a.pagePath +
        "; b=" +
        conflict.b.value +
        "@" +
        conflict.b.pagePath +
        "; claim_ids=" +
        conflict.a.claimId +
        "," +
        conflict.b.claimId,
      dedupe_key: dedupeKey({ tenantId: args.tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId: args.tenantId, actionType, targetUrl }),
      created_from_signal_at: args.signalAt,
      safety_flags: [],
    };
  });
}
