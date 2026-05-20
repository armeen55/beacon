/**
 * 2026-05-20 — Slice 4.5.C.α₁ trigger predicate:
 * `robots_blocks_googlebot`.
 *
 * Fires when verdict is `blocked_by_robots_for_googlebot`. Applies
 * to every HTML page type. Skips `technical_asset`.
 *
 * Emits `fix_robots` (high confidence, high impact). PURE FUNCTION.
 * Pinned by `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { fixRobotsCopy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type RobotsBlocksGooglebotInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  indexability: OwnedUrlIndexability;
  businessConfig: BusinessConfig;
};

export function robotsBlocksGooglebot(
  input: RobotsBlocksGooglebotInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, indexability, businessConfig } = input;

  // α₂.2: skip non-HTML assets.
  if (isNonHtmlAsset(snapshot.url)) return [];

  if (indexability.composite_verdict !== "blocked_by_robots_for_googlebot") {
    return [];
  }

  // Page classifier consulted for evidence labeling only — all
  // HTML page types are valid targets for this predicate. The
  // classifier still drives the page_type field in
  // operator_evidence so the operator can see what kind of page
  // was blocked.
  const pageType = classifyPageType(snapshot.url, businessConfig);

  const actionType = "fix_robots" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Robots crawler access";
  const robots = indexability.signals.robots_txt;
  const evidenceDetail =
    "composite_verdict=blocked_by_robots_for_googlebot; googlebot_allowed=" +
    String(robots.googlebot_allowed);
  const operatorEvidence =
    "OwnedUrlIndexability.signals.robots_txt.googlebot_allowed === false; page_type=" +
    pageType +
    "; fetched_at=" +
    (indexability.signals.page_snapshot?.fetched_at ?? "null");

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "robots_blocks_googlebot",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail: evidenceDetail,
        },
      ],
      confidence: "high",
      impact_estimate: "high",
      customer_copy: fixRobotsCopy(),
      operator_evidence: operatorEvidence,
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
