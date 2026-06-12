/**
 * Decay slice (2026-06-12) — trigger predicate: `gsc_decay`. A page
 * that is LOSING the search presence it already earned is the
 * highest-urgency refresh target: recovering existing value beats
 * chasing new value (Ahrefs' "declining pages" opportunity class).
 *
 * Rule (sources in the slice commit — Animalz refresh triggers,
 * "two or more crossing simultaneously means a refresh should be
 * prioritized"; Ahrefs Opportunities "declining traffic" class):
 * fire when BOTH first-party signals cross, comparing two
 * consecutive 28-day GSC windows:
 *   • clicks down >20% vs the prior window (with a prior-clicks
 *     floor so percentages are meaningful), AND
 *   • impressions-weighted position worse by ≥2 (v1 conservatism:
 *     Animalz's published threshold is ≥5 ranking positions on a
 *     keyword; a page-level weighted average moves far less, so
 *     requiring 5 would nearly never fire — 2 on the weighted
 *     average is the page-level equivalent, flagged as the one
 *     engineering-chosen constant in this rule).
 *
 * Emits ONE update_intro (refresh) candidate per decaying page with
 * the exact numbers as evidence. PURE — the decay signal is a
 * pre-loaded input. Pinned by the purity ratchet.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { gscDecayCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";
import type { GscDecaySignal } from "../gsc-page-signals";

export type GscDecayInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  signal: GscDecaySignal | undefined;
};

const CLICKS_DROP_FACTOR = 0.2;
const MIN_PRIOR_CLICKS = 20;
const POSITION_WORSE_BY = 2;

export function isDecaying(s: GscDecaySignal): boolean {
  if (s.clicksPrior < MIN_PRIOR_CLICKS) return false;
  const clicksDropped =
    s.clicksNow < s.clicksPrior * (1 - CLICKS_DROP_FACTOR);
  const positionWorse =
    s.positionPrior > 0 &&
    s.positionNow > 0 &&
    s.positionNow - s.positionPrior >= POSITION_WORSE_BY;
  return clicksDropped && positionWorse;
}

export function gscDecay(input: GscDecayInput): RecommendationCandidateRow[] {
  const { tenantId, snapshot, signal } = input;
  if (isNonHtmlAsset(snapshot.url)) return [];
  if (signal == null || !isDecaying(signal)) return [];

  const actionType = "update_intro" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Fading page";
  const dropPct = Math.round(
    (1 - signal.clicksNow / Math.max(1, signal.clicksPrior)) * 100,
  );

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "gsc_decay",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "gsc_decay clicks " +
            signal.clicksPrior +
            "->" +
            signal.clicksNow +
            " (-" +
            dropPct +
            "%); position " +
            signal.positionPrior.toFixed(1) +
            "->" +
            signal.positionNow.toFixed(1) +
            "; windows=28d x2",
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: gscDecayCopy(dropPct),
      operator_evidence:
        "signal=gsc_decay; clicks_prior=" +
        signal.clicksPrior +
        "; clicks_now=" +
        signal.clicksNow +
        "; position_prior=" +
        signal.positionPrior.toFixed(1) +
        "; position_now=" +
        signal.positionNow.toFixed(1) +
        "; impressions_now=" +
        signal.impressionsNow,
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
