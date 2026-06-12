/**
 * Keyword-gap slice (2026-06-12) — cross-page trigger:
 * `semrush_keyword_gap`. "Missing" keywords (a competitor ranks
 * top-10; the tenant doesn't rank at all) are new-content territory —
 * the Semrush gap-analysis guide's play: filter to competitors' top-10
 * results and KD 0–49 for smaller domains, then weigh volume.
 *
 * Emits create_page candidates at OPERATOR-REVIEW tier (new-content
 * briefs commit real authoring effort — human judgment gates them; no
 * deterministic draft pretends to write the page).
 *
 * @no-classifier-required — cross-page advisory derived from rank
 * data; no snapshot classification involved.
 *
 * PURE — gap rows are a pre-loaded input.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { keywordGapCopy } from "../customer-copy-templates";

export type KeywordGapInput = {
  tenantId: string;
  /** The tenant's site root (queue rules forbid the needs_new_page
   *  sentinel at the candidate layer; the new-page intent lives in
   *  the keyword label + copy + operator evidence). */
  siteRootUrl: string;
  gaps: ReadonlyArray<{
    keyword: string;
    competitor_domain: string;
    competitor_position: number;
    volume: number;
    difficulty: number | null;
  }>;
  signalAt: string;
  maxEmissions?: number;
};

/** Guide thresholds: competitor top-10; KD 0–49 for smaller domains;
 *  volume floor mirrors the striking-distance small-site floor. */
const MAX_COMPETITOR_POSITION = 10;
const MAX_DIFFICULTY = 49;
const MIN_VOLUME = 10;
const DEFAULT_MAX_EMISSIONS = 3;

export function semrushKeywordGap(
  input: KeywordGapInput,
): RecommendationCandidateRow[] {
  const { tenantId, gaps, signalAt, siteRootUrl } = input;
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;
  const eligible = gaps
    .filter(
      (g) =>
        g.competitor_position <= MAX_COMPETITOR_POSITION &&
        g.volume >= MIN_VOLUME &&
        (g.difficulty == null || g.difficulty <= MAX_DIFFICULTY),
    )
    .sort((a, b) => b.volume - a.volume)
    .slice(0, max);

  return eligible.map((g) => {
    const actionType = "create_page" as const;
    const targetUrl = siteRootUrl;
    const topicClusterLabel = g.keyword;
    return {
      tenant_id: tenantId,
      trigger_signal: "semrush_keyword_gap",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: g.competitor_domain,
          detail:
            "keyword_gap keyword=" +
            g.keyword +
            "; competitor=" +
            g.competitor_domain +
            " (#" +
            g.competitor_position +
            "); volume_per_month=" +
            g.volume +
            "; difficulty=" +
            (g.difficulty ?? "n/a"),
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: keywordGapCopy(g.keyword, g.volume),
      operator_evidence:
        "signal=semrush_keyword_gap; keyword=" +
        g.keyword +
        "; competitor=" +
        g.competitor_domain +
        " (#" +
        g.competitor_position +
        "); volume=" +
        g.volume +
        "; kd=" +
        (g.difficulty ?? "null") +
        "; play=new_content_brief",
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl: topicClusterLabel, // gap cards are keyword-keyed
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType,
        targetUrl: topicClusterLabel,
      }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
