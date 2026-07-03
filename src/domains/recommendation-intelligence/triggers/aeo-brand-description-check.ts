/**
 * AEO brand-description accuracy trigger (BEACON 500 P8, v1 ~255) - predicate
 * `aeo_brand_description_check`.
 *
 * THE PROBLEM: from the tenant's OWN persisted Profound answers that mention
 * the brand, an AI describes the brand with a descriptor that contradicts the
 * tenant's own business-config facts (deterministic industry-family
 * contradiction, e.g. a restaurant guide described as a hotel). Surfaced
 * honestly: "AI is describing you as X, but your site says Y. Here is how to
 * correct the record." The play is a clear on-page answer stating the true
 * fact so AI has something correct to re-learn from.
 *
 * All the config-vs-descriptor comparison lives in detect-defense.ts; the
 * Supabase reads of the brand-mention answers live in load-defense-signals.ts.
 * This predicate is a thin, PURE wrapper that turns each already-computed
 * BrandDescriptionMismatch into a RecommendationCandidateRow (the
 * trigger-predicate purity invariant forbids I/O here).
 *
 * ACTION: `add_answer_block`, the same non-pushable DIRECTIVE action as the
 * other AEO triggers - Beacon names the contradiction and the correct fact,
 * the owner writes the on-page correction. Anchored on the site root.
 *
 * ONE emission per distinct mismatch, capped upstream in the detector. Empty
 * when there is no persisted brand mention, no known industry to check
 * against, or no contradiction (self-hiding).
 *
 * PURE FUNCTION over pre-loaded mismatches. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { aeoBrandDescriptionCheckCopy } from "../customer-copy-templates";
import type { BrandDescriptionMismatch } from "@/domains/aeo/defense-types";

export type AeoBrandDescriptionCheckInput = {
  tenantId: string;
  /** Pre-computed brand-description mismatches (empty when no brand mention /
   *  no known industry / no contradiction). */
  mismatches: ReadonlyArray<BrandDescriptionMismatch>;
  /** Site-root URL to anchor the card on. Null when no configured domain - the
   *  predicate then abstains (queue rules require a URL for this on-site
   *  action). */
  siteRootUrl: string | null;
  /** ISO timestamp the mismatches were computed at (created_from_signal_at). */
  signalAt: string;
};

/**
 * @no-classifier-required: brand-level accuracy check, not page-scoped. The
 * unit is the brand's description in AI answers, not a crawled page, so
 * emission anchors to the always-HTML site root. (Sanctioned opt-out per the
 * page-classifier architecture invariant.)
 */
export function aeoBrandDescriptionCheck(
  input: AeoBrandDescriptionCheckInput,
): RecommendationCandidateRow[] {
  const { tenantId, mismatches, siteRootUrl, signalAt } = input;
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  if (mismatches.length === 0) return [];

  const actionType = "add_answer_block" as const;
  const targetUrl = siteRootUrl;

  return mismatches.map((mismatch) => {
    const topicClusterLabel =
      "aeo_brand_desc:" + mismatch.factKind + ":" + mismatch.aiDescriptor;
    return {
      tenant_id: tenantId,
      trigger_signal: "aeo_brand_description_check",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "prompt_answer_observation",
          ref: "profound:brand_mention",
          detail:
            "aeo_brand_description_check fact_kind=" +
            mismatch.factKind +
            "; own_fact=" +
            mismatch.ownFact +
            "; ai_descriptor=" +
            mismatch.aiDescriptor +
            "; model=" +
            (mismatch.model ?? "unknown") +
            "; excerpt=" +
            mismatch.evidenceExcerpt,
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: aeoBrandDescriptionCheckCopy(
        mismatch.aiDescriptor,
        mismatch.ownFact,
      ),
      operator_evidence:
        "signal=aeo_brand_description_check; AI describes you as \"" +
        mismatch.aiDescriptor +
        "\" but your site config says \"" +
        mismatch.ownFact +
        "\" (" +
        mismatch.factKind +
        "); evidence from " +
        (mismatch.model ?? "an AI answer") +
        ": " +
        mismatch.evidenceExcerpt +
        "; play=publish_correct_fact_answer_block",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
