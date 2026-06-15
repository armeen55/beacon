/**
 * Profound AEO-gap trigger (2026-06-14) — predicate `profound_aeo_gap`.
 * The pivot-critical fuse: turn the tenant's PAID Profound answer-engine
 * data (synced nightly into `profound_visibility_rows`, never the API)
 * into an AEO recommendation. Until now NO trigger consumed Profound, so
 * the sole AEO source produced ZERO recommendations.
 *
 * THE GAP (the single clearest signal the synced data actually carries):
 *   For a Profound topic (category), the visibility rows give per-asset
 *   mentions + share-of-voice for BOTH the tenant's own brand AND its
 *   competitors, over a count of observed AI answers (`executions`).
 *   When — over a MEANINGFUL number of answers — a COMPETITOR is mentioned
 *   on the topic but the tenant's OWN brand is ABSENT (zero own mentions),
 *   that is the canonical "AI assistants answer this, citing a competitor,
 *   not you" gap. The play is an extractable direct answer block so the
 *   tenant becomes citable on that topic.
 *
 * THE PLAY (sourced — same digest as the answer-block-readiness slice):
 *   • GEO study (Aggarwal et al., KDD 2024): adding quotable, self-
 *     contained statements is among the strongest measured generative-
 *     visibility levers.
 *   • Google featured-snippet length convention: a ~40–60-word direct
 *     answer is the extractable sweet spot.
 *   Emits `add_answer_block` (operator-review-only) with a DIRECTIVE: it
 *   names the topic + the competitor winning it, never authors the answer
 *   (the owner's factual authority — a hard rail).
 *
 * CONSERVATIVE FIRING (deterministic, low false-positive):
 *   • executions ≥ MIN_EXECUTIONS — enough AI answers observed that an
 *     absence is signal, not thin/empty data;
 *   • ownMentions == 0 — the tenant is genuinely ABSENT (not merely
 *     out-ranked; absence is the unambiguous, well-sourced gap v1 commits
 *     to — out-ranked-but-present is deliberately left for a later slice);
 *   • a competitor with ≥ MIN_COMPETITOR_MENTIONS is present on the topic
 *     (a real rival is being cited where the tenant is not).
 *   No own/competitor data, thin executions, or no competitor → no emit.
 *   ONE emission per topic (the gap topic IS the unit), worst gap first.
 *
 * PURE FUNCTION — the per-topic signal + site-root URL + owned-alias set
 * are pre-loaded pure inputs (profound-topic-signals.ts does the I/O).
 * Pinned by `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { profoundAeoGapCopy } from "../customer-copy-templates";
import type { ProfoundTopicSignal } from "../profound-topic-signals";

export type ProfoundAeoGapInput = {
  tenantId: string;
  /** Pre-loaded per-topic Profound signals (empty when not connected /
   *  no synced rows). */
  signals: ReadonlyArray<ProfoundTopicSignal>;
  /** Site-root URL to anchor the card on (the owner places the answer
   *  block on the right page). Null when the tenant has no configured
   *  domain — the predicate then abstains (queue rules require a URL). */
  siteRootUrl: string | null;
  /** ISO timestamp the signal was read at (created_from_signal_at). */
  signalAt: string;
};

/** AI answers observed for the topic before an absence is signal — a
 *  sample-size floor so a one-off answer never produces a card. */
const MIN_EXECUTIONS = 10;
/** A competitor must clear this mention floor to count as "winning" the
 *  topic — guards against a stray one-mention noise asset. */
const MIN_COMPETITOR_MENTIONS = 2;

/**
 * @no-classifier-required: topic-level AEO gap, not page-scoped. The unit
 * is a Profound topic (category), not a crawled page; emission anchors to
 * the always-HTML site root, so neither `classifyPageType` nor
 * `isNonHtmlAsset` applies. (Sanctioned opt-out per the page-classifier
 * architecture invariant.)
 */
export function profoundAeoGap(
  input: ProfoundAeoGapInput,
): RecommendationCandidateRow[] {
  const { tenantId, signals, siteRootUrl, signalAt } = input;
  // Queue rules require a non-null target_url for this on-site action;
  // with no configured domain there is no page to anchor the card on.
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];

  // Clear, sourced gaps only: enough observed answers, tenant absent, a
  // real competitor present. Rank by competitor strength (worst gap first).
  const gaps = signals
    .filter(
      (s) =>
        s.executions >= MIN_EXECUTIONS &&
        s.ownMentions === 0 &&
        s.topCompetitor != null &&
        s.topCompetitor.mentions >= MIN_COMPETITOR_MENTIONS,
    )
    .sort((a, b) => (b.topCompetitor!.mentions - a.topCompetitor!.mentions));
  if (gaps.length === 0) return [];

  const worst = gaps[0]!;
  const competitor = worst.topCompetitor!;

  const actionType = "add_answer_block" as const;
  const targetUrl = siteRootUrl;
  // The topic (category) is the unit + dedupe anchor — a different gap
  // topic later produces a fresh candidate.
  const topicClusterLabel = "profound_topic:" + worst.categoryId;

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "profound_aeo_gap",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "prompt_answer_observation",
          ref: "profound:" + worst.categoryId,
          detail:
            "profound_aeo_gap category=" +
            worst.categoryId +
            "; ai_answers=" +
            worst.executions +
            "; models=" +
            worst.modelCount +
            "; own_mentions=0; competitor=" +
            competitor.assetName +
            "; competitor_mentions=" +
            competitor.mentions +
            "; competitor_sov=" +
            (competitor.shareOfVoice * 100).toFixed(1) +
            "%",
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: profoundAeoGapCopy(competitor.assetName, worst.executions),
      operator_evidence:
        "signal=profound_aeo_gap; category=" +
        worst.categoryId +
        "; ai_answers=" +
        worst.executions +
        "; models=" +
        worst.modelCount +
        "; own_mentions=0; own_sov=" +
        (worst.ownShareOfVoice * 100).toFixed(1) +
        "%; top_competitor=" +
        competitor.assetName +
        " (" +
        competitor.mentions +
        " mentions, sov " +
        (competitor.shareOfVoice * 100).toFixed(1) +
        "%); play=add_extractable_answer_block",
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    },
  ];
}
