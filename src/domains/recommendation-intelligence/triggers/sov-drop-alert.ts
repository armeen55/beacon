/**
 * SoV drop alert trigger (BEACON 500 item 79, 2026-07-02) - predicate
 * `sov_drop_alert`.
 *
 * THE GAP: an AI engine that used to mention the tenant on a topic stopped
 * doing so this week (or fell hard). `computeWeeklySovForTenant`
 * (src/domains/ai-visibility/sov-weekly.ts) already does the honest
 * per-(engine, topic) week-over-week reduce over the native poll's
 * `prompt_answer_observations` and names the EXACT prompts that flipped
 * (mentioned last week, not mentioned this week, same prompt polled both
 * weeks). This predicate is a thin, pure wrapper that turns each already-
 * detected `SovDropAlert` into a `RecommendationCandidateRow` - it does
 * NOT do any drop math itself (that math is pinned and unit-tested in
 * sov-weekly.ts; duplicating it here would risk the two drifting apart).
 *
 * CONSERVATIVE BY CONSTRUCTION: sov-weekly.ts's own detector already
 * refuses to fire off a thin cell (MIN_PROMPTS_PER_CELL floor on BOTH the
 * current and prior week) and only fires on a real absolute-point drop or
 * a fall to zero from nonzero. This predicate adds no further filtering -
 * every alert it receives is already conservative - it only shapes the
 * candidate row and ranks by drop size (worst first, like profound-aeo-gap).
 *
 * THE PLAY: `add_answer_block`, same non-pushable DIRECTIVE action as
 * profound-aeo-gap - the owner writes the actual answer, Beacon never
 * fabricates the factual claim. Anchored on the site root (topic-level
 * signal, not a single page; queue rules require a URL for non-off-site
 * actions), mirroring profound-aeo-gap's exact anchoring choice.
 *
 * ONE emission per (engine, topic) drop, worst drop first. Card copy names
 * the engine, the topic, the week, and the exact prompts that flipped -
 * "Perplexity stopped mentioning you on 3 of 5 date question prompts this
 * week" - via `sovDropAlertCopy` (customer-copy-templates.ts, no dashes).
 *
 * PURE FUNCTION over pre-loaded alerts. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { sovDropAlertCopy } from "../customer-copy-templates";
import type { SovDropAlert } from "@/domains/ai-visibility/sov-weekly";

const SOV_ENGINE_PLAIN_NAME: Record<SovDropAlert["engine"], string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
};

export type SovDropAlertInput = {
  tenantId: string;
  /** Pre-computed drop alerts from sov-weekly.ts (empty when no drop
   *  cleared the floor + threshold this week). */
  alerts: ReadonlyArray<SovDropAlert>;
  /** Site-root URL to anchor the card on, same convention as
   *  profound-aeo-gap.ts. Null when no configured domain - the predicate
   *  then abstains (queue rules require a URL for this on-site action). */
  siteRootUrl: string | null;
  /** ISO timestamp the alerts were computed at (created_from_signal_at). */
  signalAt: string;
  /** Cap on how many drop alerts feed the candidate builder per run, so a
   *  bad week across many topics seasons the plan instead of flooding it.
   *  Defaults to 3 (mirrors MAX_ENGINE_GAP_CANDIDATES_PER_NIGHT). */
  maxCandidates?: number;
};

const DEFAULT_MAX_CANDIDATES = 3;

/**
 * @no-classifier-required: topic-level cross-engine SoV gap, not
 * page-scoped. The unit is an (engine, topic) drop, not a crawled page, so
 * emission anchors to the always-HTML site root; neither `classifyPageType`
 * nor `isNonHtmlAsset` applies. (Sanctioned opt-out per the page-classifier
 * architecture invariant, same opt-out profound-aeo-gap.ts uses.)
 */
export function sovDropAlert(input: SovDropAlertInput): RecommendationCandidateRow[] {
  const { tenantId, alerts, siteRootUrl, signalAt } = input;
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  if (alerts.length === 0) return [];

  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  // Worst drop first (biggest point loss; a fall-to-zero with 0 points lost
  // beyond the prior share still sorts by dropPoints, matching the
  // detector's own ranking in sov-weekly.ts).
  const ranked = [...alerts].sort((a, b) => b.dropPoints - a.dropPoints).slice(0, maxCandidates);

  const actionType = "add_answer_block" as const;
  const targetUrl = siteRootUrl;

  return ranked.map((alert) => {
    const engineName = SOV_ENGINE_PLAIN_NAME[alert.engine];
    const flippedCount = alert.flippedPrompts.length;
    // The (engine, topic, ISO week) triple is the dedupe anchor - a new
    // week or a different engine/topic produces a fresh candidate, but a
    // re-run within the same week collapses onto the same row.
    const topicClusterLabel = `sov_drop:${alert.engine}:${alert.topic}:${alert.weekKey}`;

    return {
      tenant_id: tenantId,
      trigger_signal: "sov_drop_alert",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "prompt_answer_observation",
          ref: `sov_drop:${alert.engine}:${alert.topic}:${alert.weekKey}`,
          detail:
            "sov_drop_alert engine=" +
            alert.engine +
            "; topic=" +
            alert.topic +
            "; week=" +
            alert.weekKey +
            "; prior_week=" +
            alert.priorWeekKey +
            "; prior_share=" +
            (alert.priorShare * 100).toFixed(1) +
            "%; current_share=" +
            (alert.currentShare * 100).toFixed(1) +
            "%; drop_points=" +
            alert.dropPoints.toFixed(1) +
            "; dropped_to_zero=" +
            String(alert.droppedToZero) +
            "; flipped_prompts=" +
            flippedCount +
            "; flipped_prompt_ids=" +
            alert.flippedPrompts.map((p) => p.promptId).join(","),
        },
      ],
      confidence: "medium",
      impact_estimate: flippedCount >= 3 || alert.droppedToZero ? "high" : "medium",
      customer_copy: sovDropAlertCopy(
        engineName,
        alert.topic,
        flippedCount,
        alert.promptsPolled,
        alert.flippedPrompts.map((p) => p.promptText),
      ),
      operator_evidence: alert.headline,
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
