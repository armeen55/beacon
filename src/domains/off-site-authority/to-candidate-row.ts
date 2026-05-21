/**
 * Slice 4.5.D.α₂ — Off-Site Shared Queue Contract (Slice 4.5.F, 2026-05-21).
 *
 * Pure adapter from Section 7's `OffSiteCandidateAction` shape to
 * Section 4.5's `RecommendationCandidateRow` carrier. Defines the
 * shared queue language so off-site rows, deterministic-promotion
 * rows, and (future) LLM-assisted rows all flow through the same
 * recommendation-intelligence pipeline vocabulary.
 *
 * SCOPE — type-level + plumbing only:
 *   • Adapter is PURE: no I/O · no LLM · no fetch · no Supabase ·
 *     no recommended-edits-persistence · no runProviderAndPersist.
 *   • Section 7's row builder is UNCHANGED. The adapter is
 *     available but UNWIRED — no loader consumes it yet. A future
 *     slice may wire `loadOffSiteRecommendationPreview` through
 *     this adapter into `loadTriggerCandidatesForTenant`.
 *   • Off-site rows are PERMANENTLY blocked from customer-queue
 *     promotion (pinned by α₀a.1 `eligibilityForTrigger` →
 *     `"blocked"` + α₀a.3a Gate 1 → `blocked_tier`). The shared
 *     `applyQueueRules` carve-out routes off-site rows to
 *     `diagnostic_only` (operator-visible) but never to the
 *     customer queue.
 *
 * Locked mappings (F1–F10 decision block, 2026-05-21):
 *   • `generator_kind = "human_task"` LITERAL — off-site is
 *     manual operator work, not LLM-drafted text.
 *   • `target_url = null` — off-site has no owned-page URL; the
 *     directory profile URL lives in `operator_evidence` if
 *     surfaced separately by Section 7's row builder.
 *   • `trigger_signal = "off_site:${channel}"` — reserved
 *     namespace for Section 7 rows; operator-only token.
 *   • `topic_cluster_label = "off-site:${channel}"` — distinct
 *     namespace; survives the forbidden-vocab + customer-copy
 *     scans.
 *   • `evidence = [{ kind: "business_config", ref: action.id }]`
 *     — reuses the existing `CandidateEvidenceRef` "business_config"
 *     variant; no new evidence-kind enum value.
 *   • `safety_flags = action.policy_risk ? ["unsupported_claim_risk"]
 *     : []` — reuses the existing `CandidateSafetyFlag` enum;
 *     `policy_risk` (review-solicitation, PR outreach) maps to
 *     `unsupported_claim_risk` since both signal "operator must
 *     validate before action."
 *   • `impact_estimate` — `"medium"` for `claim_*` / `optimize_*`;
 *     `"low"` for `request_gbp_reviews` / `pursue_local_pr`
 *     (tunable post-deploy with paired test update).
 *   • `dedupe_key = sha1(`${tenant}::${action_type}::off_site::${action.id}`)`.
 *   • `cooldown_key = sha1(`${tenant}::${action_type}::off_site`)` —
 *     coarser than dedupe; survives across `action.id` variants.
 *
 * Pinned by:
 *   • tests/architecture/recommendation-intelligence-offsite-
 *     contract.test.ts (purity + literal pins + behavioral checks)
 *   • tests/domains/off-site-authority/to-candidate-row.test.ts
 *   • tests/domains/recommendation-intelligence/emitter/apply-queue-
 *     rules.test.ts (off-site routes to diagnostic_only contract)
 */

import { createHash } from "node:crypto";

import type {
  CandidateEvidenceRef,
  CandidateImpactEstimate,
  CandidateSafetyFlag,
  RecommendationCandidateRow,
} from "@/domains/recommendation-intelligence/emitter/candidate-row";

import type { ActionType } from "@/domains/recommendations/action-types";

import type { OffSiteCandidateAction } from "./recommendation-rules";

export type OffSiteAdapterContext = {
  tenant_id: string;
  /** ISO timestamp; survives unchanged into
   *  `RecommendationCandidateRow.created_from_signal_at`. */
  generated_at: string;
};

/**
 * Locked `impact_estimate` by action-type. Operator-locked
 * (F5, 2026-05-21); tunable post-deploy with paired test update.
 */
const IMPACT_ESTIMATE_BY_ACTION: ReadonlyMap<
  ActionType,
  CandidateImpactEstimate
> = new Map<ActionType, CandidateImpactEstimate>([
  ["claim_gbp", "medium"],
  ["optimize_gbp_profile", "medium"],
  ["claim_or_optimize_houzz", "medium"],
  ["claim_or_optimize_yelp", "medium"],
  ["submit_to_industry_directory", "medium"],
  ["request_gbp_reviews", "low"],
  ["pursue_local_pr", "low"],
]);

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

/**
 * Pure mapper. Same input → same output bytes. Used by future
 * Section 7 row builders that opt into the shared queue contract.
 */
export function offSiteCandidateToCandidateRow(
  action: OffSiteCandidateAction,
  ctx: OffSiteAdapterContext,
): RecommendationCandidateRow {
  const action_type = action.actionType;
  const channel = action.channel;

  const evidence: ReadonlyArray<CandidateEvidenceRef> = [
    { kind: "business_config", ref: action.id },
  ];

  const safety_flags: ReadonlyArray<CandidateSafetyFlag> = action.policy_risk
    ? ["unsupported_claim_risk"]
    : [];

  const impact_estimate: CandidateImpactEstimate =
    IMPACT_ESTIMATE_BY_ACTION.get(action_type) ?? "medium";

  const dedupe_key = sha1(
    `${ctx.tenant_id}::${action_type}::off_site::${action.id}`,
  );
  const cooldown_key = sha1(
    `${ctx.tenant_id}::${action_type}::off_site`,
  );

  return {
    tenant_id: ctx.tenant_id,
    trigger_signal: `off_site:${channel}`,
    action_type,
    generator_kind: "human_task",
    target_url: null,
    topic_cluster_label: `off-site:${channel}`,
    evidence,
    confidence: action.confidence,
    impact_estimate,
    customer_copy: action.title,
    operator_evidence: `${action.rationale} (source: ${action.source_note})`,
    dedupe_key,
    cooldown_key,
    created_from_signal_at: ctx.generated_at,
    safety_flags,
  };
}
