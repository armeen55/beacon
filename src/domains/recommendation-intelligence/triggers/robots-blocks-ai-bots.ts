/**
 * 2026-05-20 — Slice 4.5.C.α₂ Tier-2 sensitive trigger predicate:
 * `robots_blocks_ai_bots`.
 *
 * Fires when verdict is `blocked_by_robots_for_ai` AND page type
 * is in the AI-bot applicability allowlist (homepage / city /
 * service / project / hub). Skips utility, other, technical_asset.
 *
 * Emits `fix_robots` (already active from α₁) at
 * `confidence: "low"` so `applyQueueRules` routes the candidate
 * to `diagnostic_only` (NOT the customer queue). Operator
 * validates on the diagnostic page; per-bot signal granularity
 * is preserved in `operator_evidence` so the operator can
 * distinguish "1 bot blocked = misconfiguration" from "4 bots
 * blocked = AI policy."
 *
 * Sensitivity rationale: AI-bot blocking is sometimes a CONSCIOUS
 * marketing/legal stance (publishers, paywalls, regulated
 * industries). Even when the customer chose Beacon for AEO, the
 * recommendation needs operator validation before customer-queue
 * promotion. The `low` confidence is the safety net.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
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

export type RobotsBlocksAiBotsInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  indexability: OwnedUrlIndexability;
  businessConfig: BusinessConfig;
};

export function robotsBlocksAiBots(
  input: RobotsBlocksAiBotsInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, indexability, businessConfig } = input;

  if (isNonHtmlAsset(snapshot.url)) return [];
  if (indexability.composite_verdict !== "blocked_by_robots_for_ai") {
    return [];
  }

  const pageType = classifyPageType(snapshot.url, businessConfig);
  if (
    pageType !== "homepage" &&
    pageType !== "city" &&
    pageType !== "service" &&
    pageType !== "project" &&
    pageType !== "hub"
  ) {
    return [];
  }

  const robots = indexability.signals.robots_txt;
  // Count the AI bots explicitly disallowed (allowed === false).
  // Per-bot granularity is preserved in operator_evidence so the
  // operator can distinguish 1-bot misconfiguration from 4-bot
  // policy stance.
  const bots: Array<[string, boolean | null]> = [
    ["gptbot", robots.gptbot_allowed],
    ["perplexitybot", robots.perplexitybot_allowed],
    ["claudebot", robots.claudebot_allowed],
    ["google_extended", robots.google_extended_allowed],
  ];
  const blockedCount = bots.filter(([, allowed]) => allowed === false).length;

  const actionType = "fix_robots" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Indexability — AI bot crawler access";
  const evidenceDetail =
    "composite_verdict=blocked_by_robots_for_ai; blocked_count=" +
    String(blockedCount) +
    "/4; gptbot_allowed=" +
    String(robots.gptbot_allowed) +
    "; perplexitybot_allowed=" +
    String(robots.perplexitybot_allowed) +
    "; claudebot_allowed=" +
    String(robots.claudebot_allowed) +
    "; google_extended_allowed=" +
    String(robots.google_extended_allowed) +
    "; page_type=" +
    pageType;
  const operatorEvidence =
    "robots_txt: gptbot_allowed=" +
    String(robots.gptbot_allowed) +
    "; perplexitybot_allowed=" +
    String(robots.perplexitybot_allowed) +
    "; claudebot_allowed=" +
    String(robots.claudebot_allowed) +
    "; google_extended_allowed=" +
    String(robots.google_extended_allowed) +
    "; blocked_count=" +
    String(blockedCount) +
    "; page_type=" +
    pageType +
    "; fetched_at=" +
    (indexability.signals.page_snapshot?.fetched_at ?? "null");

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "robots_blocks_ai_bots",
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
      // Slice 4.5.C.α₂ — Tier-2 SAFETY: low confidence routes to
      // `diagnostic_only`. NEVER promote without operator
      // calibration.
      confidence: "low",
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
