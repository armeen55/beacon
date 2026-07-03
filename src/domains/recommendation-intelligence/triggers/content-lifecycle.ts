/**
 * content-lifecycle (2026-07-03, BEACON_500 R19 / N24) - the trigger adapter
 * that turns the pure content-lifecycle engine's destructive verdicts (prune /
 * merge / retire) into capped, demand-ranked RecommendationCandidateRow[].
 *
 * PURE. The loader pre-loads every signal, runs classifyContentLifecycle, and
 * passes the verdicts here (predicate purity invariant - no I/O in triggers/).
 *
 * SAFETY BY CONSTRUCTION - nothing here ever executes a prune or a redirect:
 *   • Every card uses the `merge_pages` action type, which is `generatorActive:
 *     false` AND has no promotion-eligibility entry, so the promotion ladder
 *     blocks it independently of confidence (one lock).
 *   • Every card emits at `confidence: "low"`, so applyQueueRules routes it to
 *     `diagnostic_only`, never the customer queue (a second, independent lock).
 *   The operator reads the honest sentence + the prepared redirect target on the
 *   diagnostic surface and decides. Beacon proposes; it never removes a page.
 *
 * DEMAND-RANKED + CAPPED like buried-page.ts: sort by the page's own 90-day
 * impressions (highest money at stake first), stable url tiebreak, slice to
 * MAX_EMISSIONS. keep / improve verdicts emit nothing.
 *
 * DEDUP: merge cards overlap the existing thin_content_overlap /
 * intent_cluster_conflict merge machinery. The loader dedupes both by
 * cooldown_key (tenant, action, url) so a page one of those already claimed
 * never also emits here - one merge_pages card per folded page.
 *
 * Byte-identical when there are no destructive verdicts. No em or en dashes.
 */

import type { LifecycleVerdict } from "@/domains/lifecycle/content-lifecycle";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";

export type ContentLifecycleTriggerInput = {
  tenantId: string;
  /** Every lifecycle verdict from classifyContentLifecycle. Non-destructive
   *  stages (keep / improve) are ignored here. */
  verdicts: ReadonlyArray<LifecycleVerdict>;
  /** Per-page 90-day impressions, keyed by the SAME node id the verdicts use
   *  (canonical URL). Missing page -> 0 (still emits, ranked last). Drives the
   *  demand-first ordering only; the classifier already applied its own demand
   *  gates. */
  impressionsByUrl: ReadonlyMap<string, number>;
  signalAt: string;
  maxEmissions?: number;
};

/** How many lifecycle cards, at most, per run. A site with a large dead-weight
 *  tail should not flood the diagnostic surface; the highest-demand cases lead. */
export const MAX_LIFECYCLE_EMISSIONS = 8;

const DESTRUCTIVE_STAGES = new Set(["prune", "merge", "retire"]);

/** Map a lifecycle stage to its operator-only trigger_signal + topic label.
 *  Distinct signals let the operator tell the three cases apart on the
 *  diagnostic surface even though they share the merge_pages action type. */
function labelsFor(stage: LifecycleVerdict["stage"]): {
  triggerSignal: string;
  topicClusterLabel: string;
} {
  if (stage === "prune") {
    return { triggerSignal: "lifecycle_prune", topicClusterLabel: "Remove or fold in" };
  }
  if (stage === "retire") {
    return { triggerSignal: "lifecycle_retire", topicClusterLabel: "Retire dated page" };
  }
  return { triggerSignal: "lifecycle_merge", topicClusterLabel: "Merge and redirect" };
}

/**
 * @no-classifier-required: consumes pre-classified lifecycle verdicts whose page
 * universe was already assembled from owned, non-asset snapshots in the loader.
 */
export function contentLifecycle(
  input: ContentLifecycleTriggerInput,
): RecommendationCandidateRow[] {
  const { tenantId, verdicts, impressionsByUrl, signalAt } = input;
  const max = input.maxEmissions ?? MAX_LIFECYCLE_EMISSIONS;

  // Global emptiness guard: no destructive verdict -> nothing to say ->
  // byte-identical to before this trigger existed.
  const destructive = verdicts.filter((v) => DESTRUCTIVE_STAGES.has(v.stage));
  if (destructive.length === 0) return [];

  // Highest demand first (biggest money at stake), stable url tiebreak.
  const ranked = [...destructive].sort((a, b) => {
    const ia = impressionsByUrl.get(a.url) ?? 0;
    const ib = impressionsByUrl.get(b.url) ?? 0;
    return ib - ia || a.url.localeCompare(b.url);
  });

  const actionType = "merge_pages" as const;
  const out: RecommendationCandidateRow[] = [];
  for (const v of ranked.slice(0, max)) {
    const targetUrl = v.url;
    const { triggerSignal, topicClusterLabel } = labelsFor(v.stage);
    const redirectDetail =
      v.redirectTarget != null ? "; redirect_target=" + v.redirectTarget : "";
    out.push({
      tenant_id: tenantId,
      trigger_signal: triggerSignal,
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail: v.evidence + redirectDetail,
        },
      ],
      // confidence "low" -> diagnostic_only via applyQueueRules. merge_pages is
      // also generatorActive:false with no eligibility entry: double-locked
      // against any auto-execution. Operator-approved only.
      confidence: "low",
      impact_estimate: v.stage === "merge" ? "high" : "medium",
      customer_copy: v.reason,
      operator_evidence:
        "signal=" +
        triggerSignal +
        "; stage=" +
        v.stage +
        "; url=" +
        v.url +
        redirectDetail +
        "; impressions_90d=" +
        String(impressionsByUrl.get(v.url) ?? 0) +
        "; play=content_lifecycle; " +
        v.evidence,
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
