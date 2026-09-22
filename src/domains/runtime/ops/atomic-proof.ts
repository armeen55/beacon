import "server-only";
import { reviewFinishedCopy } from "@/domains/decision/drafted-copy"; import { REVIEW_CONTRACT, reviewFits, unreviewed } from "@/domains/decision/proof"; import { COPY_RULES } from "@/domains/decision/copy-sanitize";
import { confirmedVersion, deliverableGaps } from "@/domains/decision/completeness"; import { DRAFT_BUDGET } from "@/domains/decision/draft-budget"; import { nextObligation } from "@/domains/decision/obligation"; import { answerReviewedProposal, loadChangeProposal, preflightReviewedProposal } from "@/domains/decision/proposal-store";
import type { ChangeProposal } from "@/domains/decision/contracts"; import { PROOF_SPEND } from "@/lib/spend-scope"; import { researchPermission } from "./due-work";
import spendReservations from "@/lib/cost/spend-reservations";
const acceptable = (row: ChangeProposal | null): boolean => !!row && row.status === "ready" && row.researchOnly !== true
  && deliverableGaps(row).length === 0 && nextObligation(row) === null;
const DEPS = { permission: researchPermission, load: loadChangeProposal, review: reviewFinishedCopy, promote: answerReviewedProposal, reviewAuthorized: (row: ChangeProposal) => row.semanticReview?.version === REVIEW_CONTRACT && COPY_RULES.accepted(row.semanticReview.editor) && reviewFits(row, row.semanticReview.of) && unreviewed(row) == null,
  acceptable, obligation: nextObligation, delivery: DRAFT_BUDGET.deliveryOf, version: confirmedVersion, preflight: preflightReviewedProposal,
  providerConfigured: () => !!process.env.OPENAI_API_KEY?.trim(), spend: spendReservations };
type Deps = typeof DEPS; type Input = { tenantId: string; proposalId: string; maxOpenAiCalls: number; maxOpenAiUsd: number; now?: Date };
async function run(input: Input, deps: Deps = DEPS) {
  const { tenantId, proposalId, maxOpenAiCalls, maxOpenAiUsd } = input;
  const refuse = (reason: string, stored: ChangeProposal | null = null) => ({ success: false as const, proposalId, reason, stored, meter: null });
  if (!tenantId || !proposalId.startsWith(`${tenantId}::`) || maxOpenAiCalls !== 1
    || !Number.isFinite(maxOpenAiUsd) || maxOpenAiUsd <= 0 || maxOpenAiUsd > 0.05) return refuse("invalid_identity_or_ceiling");
  if (await deps.permission(tenantId) !== "paused") return refuse("research_must_remain_paused");
  const row = await deps.load(tenantId, proposalId);
  if (!row || row.id !== proposalId || row.tenantId !== tenantId) return refuse("stored_candidate_not_found");
  if (deps.delivery(row) !== "existing_page_edit" || row.status !== "needs_review") return refuse("candidate_is_not_one_unfinished_manual_edit", row);
  const obligation = deps.obligation(row);
  if (obligation?.kind !== "review") return refuse(`candidate_owes_${obligation?.kind ?? "nothing"}`, row);
  const now = input.now ?? new Date(), preflight = await deps.preflight(tenantId, row, now);
  if (preflight) return refuse(`candidate_preflight:${preflight}`, row);
  if (deps.reviewAuthorized(row)) { if (await deps.permission(tenantId) !== "paused") return refuse("accepted_review_could_not_be_settled", row); const promoted = await deps.promote(tenantId, proposalId, deps.version(row), row.basis ?? null, { kind: "promote", at: now.toISOString() }), stored = await deps.load(tenantId, proposalId); return promoted.status === "promoted" && deps.acceptable(stored) ? { success: true as const, proposalId, reason: "stored_ready_from_current_review", stored, meter: { ops: 0, providerCalls: 0, costUsd: 0 } } : refuse(`promotion_${promoted.status}${promoted.refusal ? `:${promoted.refusal}` : ""}`, stored); }
  if (!deps.providerConfigured()) return refuse("openai_not_configured_in_this_runtime", row);
  const admissionKey = `atomic-proof-v2::${tenantId}::${proposalId}::${deps.version(row)}`;
  const admission = await deps.spend.reserve({ tenantId, platform: "other", purpose: "atomic_proof_admission", logicalKey: admissionKey,
    requestFingerprint: admissionKey, estimatedUsd: 0, recoveryKind: "none" }).catch(() => null);
  if (!admission) return refuse("proof_admission_unavailable", row);
  if (admission.outcome !== "reserved" || !admission.attemptId) return refuse(`proof_admission_${admission.outcome}`, row);
  const claim = await deps.spend.claimTransmission(admission.attemptId).catch(() => "unavailable" as const);
  if (claim !== "claimed") return refuse(`proof_admission_${claim}`, row);
  const finish = async (success: boolean, reason: string, stored: ChangeProposal | null = row,
    meter: { ops: number; providerCalls: number; costUsd: number } | null = null, beforeReview = false) => {
    const zeroCallFailure = !success && (beforeReview || meter != null && meter.providerCalls === 0);
    const recorded = zeroCallFailure ? await deps.spend.release(admission.attemptId!, true).catch(() => false)
      : await deps.spend.reconcile(admission.attemptId!, 0, null, "provider_reported", { success, reason }).catch(() => false);
    return success ? { success: true as const, proposalId, reason: recorded ? reason : "stored_ready_but_admission_receipt_missing", stored, meter }
      : { success: false as const, proposalId, reason: recorded ? reason : zeroCallFailure ? "admission_receipt_not_released" : "admission_receipt_not_reconciled", stored, meter };
  };
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_before_review", row, null, true);
  const key = DRAFT_BUDGET.keyOf(row); let budget: ReturnType<typeof DRAFT_BUDGET.plan> | undefined;
  try {
  budget = DRAFT_BUDGET.plan({ candidates: 1, calls: 1,
    deliveryScope: "existing_page_edits", jobs: [{ key, family: "editor", impact: row.impactScore ?? 0,
      calls: 1, delivery: "existing_page_edit" }] });
  const attempts = budget.draw(key, 1); if (!attempts) return finish(false, "proof_review_allowance_unavailable", row, budget.meterOf(key), true);
  const reviewed = await PROOF_SPEND.run(tenantId, maxOpenAiCalls, maxOpenAiUsd,
    () => deps.review(row, { tenantId, now, bypassCache: true, attempts, proposalWorkKey: row.workKey }));
  const meter = budget.meterOf(key), proposed = reviewed.row && reviewed.row.id === proposalId && reviewed.row.tenantId === tenantId ? reviewed.row : null;
  if (!proposed) return finish(false, "review_did_not_return_the_exact_candidate", row, meter);
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_before_persist");
  const promoted = await deps.promote(tenantId, proposalId, deps.version(row), row.basis ?? null, { kind: "promote", at: now.toISOString() }, proposed), stored = await deps.load(tenantId, proposalId);
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_after_persist", stored, meter);
  if (promoted.status !== "promoted") return finish(false, `promotion_${promoted.status}${promoted.refusal ? `:${promoted.refusal}` : ""}`, stored, meter);
  const accepted = deps.acceptable(stored);
  return finish(accepted, accepted ? "stored_ready_substantive_and_complete" : "stored_row_is_not_ready_substantive_and_complete", stored, meter);
  } catch { return finish(false, "proof_execution_failed", row, budget?.meterOf(key) ?? null); }
}
const atomicProof = { run };
export default atomicProof;
