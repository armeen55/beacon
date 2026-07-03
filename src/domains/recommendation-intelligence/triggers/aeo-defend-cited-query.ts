/**
 * AEO defend-a-cited-query trigger (BEACON 500 P8, v1 ~116/117) - predicate
 * `aeo_defend_cited_query`.
 *
 * THE THREAT: a competitor domain that was NOT cited by AI for a question the
 * tenant used to own or co-own has NEWLY appeared as a cited source in the
 * latest capture (detected from a real 2-capture citation-row history delta in
 * detect-defense.ts). That is a rival moving in on a query you already earned:
 * the defensive Move is to strengthen your answer block before they lock it in.
 *
 * All the history-delta math lives in detect-defense.ts; the Supabase reads of
 * the two captures live in load-defense-signals.ts. This predicate is a thin,
 * PURE wrapper that turns each already-computed DefendCitedQuery into a
 * RecommendationCandidateRow (the trigger-predicate purity invariant forbids
 * I/O here).
 *
 * ACTION: `add_answer_block`, the same non-pushable DIRECTIVE action as the
 * other AEO triggers. Anchored on the site root (topic-level, not a single
 * crawled page).
 *
 * ONE emission per topic, ranked by the newcomer's latest-capture citations
 * (hardest-pressing threat first), capped upstream in the detector. Empty when
 * no new competitor citation, when the tenant never owned the topic, or when
 * there is no 2-capture history (self-hiding).
 *
 * PURE FUNCTION over pre-loaded findings. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { aeoDefendCitedQueryCopy } from "../customer-copy-templates";
import type { DefendCitedQuery } from "@/domains/aeo/defense-types";

export type AeoDefendCitedQueryInput = {
  tenantId: string;
  /** Pre-computed defend-a-cited-query findings (empty when no new competitor
   *  citation, or no 2-capture history). */
  findings: ReadonlyArray<DefendCitedQuery>;
  /** Site-root URL to anchor the card on. Null when no configured domain - the
   *  predicate then abstains (queue rules require a URL for this on-site
   *  action). */
  siteRootUrl: string | null;
  /** ISO timestamp the findings were computed at (created_from_signal_at). */
  signalAt: string;
};

/**
 * @no-classifier-required: topic-level citation-history delta, not
 * page-scoped. The unit is a tracked topic, not a crawled page, so emission
 * anchors to the always-HTML site root. (Sanctioned opt-out per the
 * page-classifier architecture invariant.)
 */
export function aeoDefendCitedQuery(
  input: AeoDefendCitedQueryInput,
): RecommendationCandidateRow[] {
  const { tenantId, findings, siteRootUrl, signalAt } = input;
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  if (findings.length === 0) return [];

  const actionType = "add_answer_block" as const;
  const targetUrl = siteRootUrl;

  return findings.map((finding) => {
    const topicClusterLabel =
      "aeo_defend:" + finding.categoryId + ":" + finding.competitorDomain;
    return {
      tenant_id: tenantId,
      trigger_signal: "aeo_defend_cited_query",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "citation_observation",
          ref: "profound:" + finding.categoryId,
          detail:
            "aeo_defend_cited_query topic=" +
            finding.topicLabel +
            "; new_competitor=" +
            finding.competitorDomain +
            "; competitor_citations=" +
            finding.competitorCitations +
            "; own_prior_citations=" +
            finding.ownPriorCitations +
            "; prior_capture=" +
            finding.priorCaptureDate +
            "; latest_capture=" +
            finding.latestCaptureDate,
        },
      ],
      confidence: "medium",
      impact_estimate: finding.competitorCitations >= 3 ? "high" : "medium",
      customer_copy: aeoDefendCitedQueryCopy(
        finding.topicLabel,
        finding.competitorDomain,
      ),
      operator_evidence:
        "signal=aeo_defend_cited_query; topic=" +
        finding.topicLabel +
        "; a new competitor " +
        finding.competitorDomain +
        " was cited " +
        finding.competitorCitations +
        " time(s) in the " +
        finding.latestCaptureDate +
        " capture (0 in the " +
        finding.priorCaptureDate +
        " capture), on a topic you were cited " +
        finding.ownPriorCitations +
        " time(s) for before; play=strengthen_answer_block_before_lock_in",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
