/**
 * 2026-05-20 — Slice 4.5.D.α₁a — pure mapper from `PromotionResult`
 * (α₀a.3b orchestrator output) to a `recommended_edits`-shaped row.
 *
 * Pure. No I/O. No mutation. NO writes. The row produced here is
 * RENDER + PERSIST-READY but α₁a itself never persists. The writer
 * (`promotion-writer.ts`) lands in Slice 4.5.D.α₁b.
 *
 * Boundary-crossing safety
 * ------------------------
 * This is the first slice on the customer-queue boundary chain. The
 * mapper applies 5 defensive null-returns BEFORE producing a row.
 * The α₀a.3a safety gates already enforce the same conditions
 * upstream — these checks are belt-and-suspenders so a future
 * regression elsewhere in the engine can't leak an unsafe row.
 *
 *   Defensive rejection conditions (mapper returns null):
 *     1. result.eligible === false
 *     2. result.tier !== "customer-queue-ready"
 *     3. result.candidate.target_url === null
 *     4. result.candidate.confidence === "low"
 *     5. result.candidate.safety_flags.length > 0
 *
 * Local type discipline
 * ---------------------
 * Returns a LOCAL minimal `DeterministicPromotionEditRow` shape that
 * is structurally compatible with `RecommendedEditRow` (the production
 * persistence type). The mapper does NOT import from
 * `@/domains/recommendations/recommended-edits-persistence` —
 * preserves the existing `recommendation-intelligence-no-queue-write`
 * invariant without modification. The α₁b writer module will be the
 * single allowlisted file that legitimately imports the persistence
 * helpers.
 *
 * Provenance + idempotency
 * ------------------------
 *   • `source = "deterministic_promotion"` — distinct from the legacy
 *     `"deterministic"` specific-edit provider; pinned by the
 *     `-promotion-writer-source-pin` invariant.
 *   • `rec_id = "promotion-${promotion_cooldown_key.slice(0, 16)}"` —
 *     64-bit entropy from the α₀a.2 cooldown_key. Re-emitting the
 *     same promotion candidate produces the SAME rec_id → SAME row
 *     `id` → upsert overwrites in place via the existing
 *     `(tenant_id, rec_id, action_type, target_element_key)` unique
 *     index (NULLS NOT DISTINCT).
 *   • `evidence_hash = sha1(${dedupe_key}::${cooldown_key}::${priority_score})`
 *     — full traceability back to the α₀a.3b orchestrator output even
 *     though the row's `id` only carries 16 hex chars of the cooldown
 *     key.
 *
 * Evidence
 * --------
 * `SpecificEditEvidenceRef` is a strict discriminated union (5
 * variants: prompt / element / owned_page / competitor /
 * prior_outcome). The operator-locked α₁a contract permits ONLY
 * `SpecificEditSource` to be extended — not `SpecificEditEvidenceRef`.
 * The mapper therefore preserves traceability via existing fields:
 *   • rec_id encodes 16-hex prefix of promotion_cooldown_key
 *   • evidence_hash encodes the full dedupe + cooldown + priority
 *   • evidence carries one `owned_page` ref for the target URL
 */

import { createHash } from "node:crypto";

import type { ActionType } from "@/domains/recommendations/action-types";
import type {
  SpecificEditEvidenceRef,
  SpecificEditSource,
} from "@/domains/recommendations/specific-edit-provider";

import type { PromotionResult } from "@/domains/recommendation-intelligence/promote-to-queue";

/**
 * Source value reserved for α₀a-trigger-engine-promoted rows.
 * Distinct from the legacy `"deterministic"` (which labels rows from
 * the deterministic specific-edit provider — different pipeline).
 * Pinned by `recommendation-intelligence-promotion-writer-source-pin`.
 */
export const DETERMINISTIC_PROMOTION_SOURCE: SpecificEditSource =
  "deterministic_promotion";

/**
 * Local minimal row shape — structurally compatible with the
 * production `RecommendedEditRow` from
 * `@/domains/recommendations/recommended-edits-persistence`. Defined
 * here to keep this module independent of that file (preserves the
 * existing `recommendation-intelligence-no-queue-write` invariant).
 *
 * Field set matches what the mapper actually produces on initial
 * write. All `live_*` fields are `null` because the row has never
 * been observed live yet (Phase 3 match engine populates them later).
 */
export type DeterministicPromotionEditRow = {
  id: string;
  tenant_id: string;
  rec_id: string;
  action_type: ActionType;
  target_url: string;
  target_element_key: string | null;
  display_label: string | null;
  current_text: string | null;
  proposed_text: string | null;
  why: string;
  evidence: SpecificEditEvidenceRef[];
  expected_impact: string | null;
  difficulty: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  measurement_plan: string | null;
  risks: string[];
  source: SpecificEditSource;
  provider_name: string | null;
  evidence_hash: string;
  model: string | null;
  cost_usd: number;
  created_at: string;
  updated_at: string;
  implementation_status: "recommended";
  live_at: null;
  live_snapshot_id: null;
  live_match_confidence: null;
  live_match_kind: null;
  live_element_key: null;
  not_found_reason: null;
};

/**
 * Pure mapper. Returns `null` for any of the 5 defensive rejection
 * conditions; otherwise returns a fully-populated row ready for
 * upsert via the future α₁b writer. Pinned by
 * `recommendation-intelligence-promotion-writer-eligibility-pin`.
 */
export function promotionResultToRecommendedEditRow(
  result: PromotionResult,
  now: Date,
): DeterministicPromotionEditRow | null {
  // Defensive rejection ladder (5 conditions).
  if (!result.eligible) return null;
  if (result.tier !== "customer-queue-ready") return null;
  if (result.candidate.target_url == null) return null;
  if (result.candidate.confidence === "low") return null;
  if (result.candidate.safety_flags.length > 0) return null;

  const targetUrl = result.candidate.target_url;
  const recId = `promotion-${result.promotion_cooldown_key.slice(0, 16)}`;
  const id = `${recId}__${result.candidate.action_type}__null`;
  const nowIso = now.toISOString();
  const evidence_hash = createHash("sha1")
    .update(
      `${result.promotion_dedupe_key}::${result.promotion_cooldown_key}::${result.priority_score}`,
    )
    .digest("hex");

  return {
    id,
    tenant_id: result.candidate.tenant_id,
    rec_id: recId,
    action_type: result.candidate.action_type,
    target_url: targetUrl,
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: result.candidate.customer_copy,
    evidence: [{ type: "owned_page", url: targetUrl }],
    expected_impact: null,
    difficulty: "low",
    confidence: result.candidate.confidence,
    measurement_plan: null,
    risks: [],
    source: DETERMINISTIC_PROMOTION_SOURCE,
    provider_name: null,
    evidence_hash,
    model: null,
    cost_usd: 0,
    created_at: nowIso,
    updated_at: nowIso,
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
  };
}
