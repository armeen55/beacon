/**
 * AEO zero-source opening trigger (BEACON 500 P8, v1 ~192) - predicate
 * `aeo_zero_source_opening`.
 *
 * THE OPENING: a tracked question AI actually gets asked about, where AI cites
 * no one confidently yet (over a meaningful number of observed answers, the
 * strongest source sits below the confidence floor, or there are no citations
 * at all). That is a first-mover opening: publish the clear answer now and you
 * can own it before anyone else does.
 *
 * All window math + the confidence-floor detection live in
 * detect-defense.ts; the Supabase reads live in load-defense-signals.ts. This
 * predicate is a thin, PURE wrapper that turns each already-computed
 * ZeroSourceOpening into a RecommendationCandidateRow (the trigger-predicate
 * purity invariant forbids I/O here).
 *
 * ACTION: `add_answer_block`, the same non-pushable DIRECTIVE action as
 * profound-aeo-gap.ts / citation-loss-alert.ts - Beacon never fabricates the
 * factual claim, the owner writes the real answer. Anchored on the site root
 * (topic-level opening, not a single crawled page - same anchoring convention
 * the other Profound triggers use).
 *
 * ONE emission per topic, ranked by observed answers (biggest opening first),
 * capped upstream in the detector. Empty when every tracked topic already has
 * a confident source, or on thin data (self-hiding).
 *
 * PURE FUNCTION over pre-loaded openings. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { aeoZeroSourceOpeningCopy } from "../customer-copy-templates";
import type { ZeroSourceOpening } from "@/domains/aeo/defense-types";

export type AeoZeroSourceOpeningInput = {
  tenantId: string;
  /** Pre-computed zero-source openings (empty when Profound is not connected /
   *  no rows / every topic already has a confident source). */
  openings: ReadonlyArray<ZeroSourceOpening>;
  /** Site-root URL to anchor the card on, same convention as the other
   *  Profound triggers. Null when no configured domain - the predicate then
   *  abstains (queue rules require a URL for this on-site action). */
  siteRootUrl: string | null;
  /** ISO timestamp the openings were computed at (created_from_signal_at). */
  signalAt: string;
};

/**
 * @no-classifier-required: topic-level AEO opening, not page-scoped. The unit
 * is a tracked topic, not a crawled page, so emission anchors to the always-
 * HTML site root; neither `classifyPageType` nor `isNonHtmlAsset` applies.
 * (Sanctioned opt-out per the page-classifier architecture invariant, the same
 * opt-out profound-aeo-gap.ts / citation-loss-alert.ts use.)
 */
export function aeoZeroSourceOpening(
  input: AeoZeroSourceOpeningInput,
): RecommendationCandidateRow[] {
  const { tenantId, openings, siteRootUrl, signalAt } = input;
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  if (openings.length === 0) return [];

  const actionType = "add_answer_block" as const;
  const targetUrl = siteRootUrl;

  return openings.map((opening) => {
    const topicClusterLabel = "aeo_zero_source:" + opening.categoryId;
    return {
      tenant_id: tenantId,
      trigger_signal: "aeo_zero_source_opening",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "prompt_answer_observation",
          ref: "profound:" + opening.categoryId,
          detail:
            "aeo_zero_source_opening topic=" +
            opening.topicLabel +
            "; observed_answers=" +
            opening.observedAnswers +
            "; models=" +
            opening.modelCount +
            "; top_source_share=" +
            (opening.topSourceShare * 100).toFixed(1) +
            "%; top_source=" +
            (opening.topSourceDomain ?? "none"),
        },
      ],
      confidence: "medium",
      impact_estimate: opening.observedAnswers >= 25 ? "high" : "medium",
      customer_copy: aeoZeroSourceOpeningCopy(
        opening.topicLabel,
        opening.observedAnswers,
      ),
      operator_evidence:
        "signal=aeo_zero_source_opening; topic=" +
        opening.topicLabel +
        "; observed_answers=" +
        opening.observedAnswers +
        "; models=" +
        opening.modelCount +
        "; top_source=" +
        (opening.topSourceDomain ?? "none") +
        " (" +
        (opening.topSourceShare * 100).toFixed(1) +
        "% of citations); play=publish_first_mover_answer_block",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
