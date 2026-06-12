/**
 * 2026-05-19 — Slice 4.5.B.α₀ — Recommendation Intelligence emitter
 * contract: `RecommendationCandidateRow` shape.
 *
 * Pure types. Consumed by the trigger predicates, the loader, and
 * the operator-only `/diagnostics/recommendation-triggers` page.
 * Rows exist in memory only — they are NEVER persisted to
 * `recommended_edits` (pinned by
 * `recommendation-intelligence-no-queue-write`).
 *
 * α₀ ships the minimum field set the 2 metadata predicates +
 * operator diagnostic actually need. Slices α₁ / α₂ / 4.5.D
 * extend as full-emitter behavior (suppression, prerequisite
 * blocking, cooldown enforcement) lands.
 */

import type { ActionType } from "@/domains/recommendations/action-types";

export type CandidateConfidence = "high" | "medium" | "low";

/** α₀ only emits `"deterministic"`. */
export type CandidateGeneratorKind =
  | "deterministic"
  | "llm_assisted"
  | "human_task";

export type CandidateImpactEstimate = "high" | "medium" | "low";

/** α₀ never emits a flag; forward-compat for slices 4.5.G+. */
export type CandidateSafetyFlag =
  | "unsupported_claim_risk"
  | "competitor_name_leak"
  | "placeholder_text";

export type CandidateEvidenceRef = {
  kind:
    | "page_snapshot"
    | "page_snapshot_pair"
    | "page_element_inventory"
    | "prompt_answer_observation"
    | "business_config"
    | "citation_observation";
  ref: string;
  detail?: string;
};

export type RecommendationCandidateRow = {
  tenant_id: string;
  /** Operator-only signal name (e.g., `missing_meta`). */
  trigger_signal: string;
  action_type: ActionType;
  generator_kind: CandidateGeneratorKind;
  target_url: string | null;
  topic_cluster_label: string;
  evidence: ReadonlyArray<CandidateEvidenceRef>;
  confidence: CandidateConfidence;
  impact_estimate: CandidateImpactEstimate;
  /** Fusion-EV slice (2026-06-12): estimated ADDITIONAL clicks per
   *  28 days if this edit lands, computed from FIRST-PARTY data via
   *  the published CTR-gap method (Botify/SEOmonitor/Greenlane:
   *  (expected_ctr(position) − actual_ctr) × impressions). Only
   *  set by predicates with real per-query numbers (the GSC rules);
   *  absent elsewhere. Consumed as a bounded additive term in
   *  priorityScore. */
  upside_clicks_28d?: number;
  /** Plain English. Passes forbidden-vocab + internal-taxonomy
   *  scans (`recommendation-intelligence-customer-copy-vocab`). */
  customer_copy: string;
  /** Operator-only raw signal trace. */
  operator_evidence: string;
  /** SHA1 of `${tenant}::${action}::${url}::${topic_cluster}`. */
  dedupe_key: string;
  /** SHA1 of `${tenant}::${action}::${url}`. Coarser than dedupe. */
  cooldown_key: string;
  /** ISO timestamp; signal-stale rule lands in Slice 4.5.D. */
  created_from_signal_at: string;
  safety_flags: ReadonlyArray<CandidateSafetyFlag>;
};
