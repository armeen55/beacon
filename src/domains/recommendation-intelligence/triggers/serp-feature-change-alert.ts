/**
 * Google-results feature-change trigger (BEACON_500 P9 v1 251, 2026-07-03) -
 * predicate `serp_feature_change`.
 *
 * THE GAP: feature-steal reacts to WHO OWNS a Google feature right now; nothing
 * reacted to a feature's ARRIVAL. When Google turns on an answer box for a
 * tracked search, that is a timely, perishable opening ("Google just added an
 * answer box for 'farsi numbers'. Add an answer block to grab it.").
 * `serp-feature-change.ts` (src/domains/serp) does the deterministic diff off-
 * predicate over the already-persisted dataforseo_serp_history rows. This
 * predicate is a thin, PURE wrapper that turns each already-computed
 * SerpFeatureChange into a RecommendationCandidateRow - no diff math, no
 * Supabase read (the loader does the bounded read via serp-history.ts).
 *
 * ONLY "appeared" changes become Moves. A feature disappearing is
 * informational (it changes how to compete) but is not a fresh opportunity, so
 * only the appeared set is passed in / emitted here - never alert an operator to
 * "do something" about a feature that went away.
 *
 * ACTION: `add_answer_block` - the answer-box and People-Also-Ask appearances
 * both want a quotable answer on the page; the image-row appearance wants named
 * images, still an on-page content add. Same non-pushable, generatorActive:false
 * DIRECTIVE convention as profound_aeo_gap / citation_loss_alert. Anchored on
 * the site root (a feature change is query/topic-level, not tied to one owned
 * page - same site-root anchoring convention the other topic-level triggers use).
 *
 * ONE emission per appeared change, capped so a busy week does not flood the
 * plan. PURE FUNCTION over pre-loaded changes. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { serpFeatureAppearedCopy } from "../customer-copy-templates";
import {
  appearedFeatureChanges,
  MAX_SERP_FEATURE_CHANGE_CANDIDATES,
  type SerpFeatureChange,
  type WinnableFeature,
} from "@/domains/serp/serp-feature-change";

export type SerpFeatureChangeAlertInput = {
  tenantId: string;
  /** Pre-computed feature changes from serp-feature-change.ts (empty when
   *  nothing changed, or the history has no diff-able captures yet). Only the
   *  "appeared" subset becomes a Move; "disappeared" changes are ignored here. */
  changes: ReadonlyArray<SerpFeatureChange>;
  /** Site-root URL to anchor the card on, same convention as
   *  profound_aeo_gap / citation_loss_alert. Null when no configured domain -
   *  the predicate then abstains (queue rules require a URL for this action). */
  siteRootUrl: string | null;
  /** ISO timestamp the changes were computed at (created_from_signal_at). */
  signalAt: string;
  /** Cap on how many changes feed the candidate builder per run. Defaults to
   *  MAX_SERP_FEATURE_CHANGE_CANDIDATES. */
  maxCandidates?: number;
};

/** Plain, customer-safe feature label for the copy (never "SERP"). */
const FEATURE_LABEL: Record<WinnableFeature, string> = {
  answer_box: "an answer box",
  people_also_ask: "a People Also Ask block",
  image_row: "an image row",
};

/** Plain grab instruction per feature (customer-safe). */
const GRAB_INSTRUCTION: Record<WinnableFeature, string> = {
  answer_box: "Add a clear answer block near the top",
  people_also_ask: "Answer the exact questions people ask on this page",
  image_row: "Add clear, named images to this page",
};

/**
 * @no-classifier-required: the unit is a (query, appeared-feature) opening, not
 * a crawled owned page. Emission anchors to the always-HTML site root; neither
 * `classifyPageType` nor `isNonHtmlAsset` applies. (Sanctioned opt-out per the
 * page-classifier architecture invariant, same opt-out profound_aeo_gap /
 * citation_loss_alert use for their topic-level anchors.)
 */
export function serpFeatureChangeAlert(
  input: SerpFeatureChangeAlertInput,
): RecommendationCandidateRow[] {
  const { tenantId, changes, siteRootUrl, signalAt } = input;
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  const appeared = appearedFeatureChanges([...changes]);
  if (appeared.length === 0) return [];

  const maxCandidates = input.maxCandidates ?? MAX_SERP_FEATURE_CHANGE_CANDIDATES;
  const ranked = appeared
    .slice()
    .sort((a, b) => a.query.localeCompare(b.query) || a.feature.localeCompare(b.feature))
    .slice(0, maxCandidates);

  const actionType = "add_answer_block" as const;
  const targetUrl = siteRootUrl;

  return ranked.map((change) => {
    // (query, feature) is the dedupe anchor - the same still-present feature on
    // the same query collapses onto one row across re-runs; a new feature or a
    // new query is a fresh opening.
    const topicClusterLabel = `serp_feature_change:${change.query}:${change.feature}`;

    return {
      tenant_id: tenantId,
      trigger_signal: "serp_feature_change",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: `serp_feature_change:${change.query}:${change.feature}`,
          detail:
            "serp_feature_change query=" +
            change.query +
            "; feature=" +
            change.feature +
            "; direction=" +
            change.direction +
            "; own_rank=" +
            (change.ownRank == null ? "none" : String(change.ownRank)) +
            "; from_at=" +
            change.fromAt +
            "; to_at=" +
            change.toAt,
        },
      ],
      confidence: "medium",
      // An answer box appearing where the tenant already ranks close is the
      // highest-value grab; a feature on a query the tenant does not yet rank
      // for is still worth a Move but lower.
      impact_estimate:
        change.feature === "answer_box" && typeof change.ownRank === "number" && change.ownRank <= 10
          ? "high"
          : "medium",
      customer_copy: serpFeatureAppearedCopy(
        FEATURE_LABEL[change.feature],
        change.query,
        GRAB_INSTRUCTION[change.feature],
      ),
      operator_evidence:
        "signal=serp_feature_change; " +
        change.feature +
        ' appeared for "' +
        change.query +
        '" between ' +
        change.fromAt +
        " and " +
        change.toAt,
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
