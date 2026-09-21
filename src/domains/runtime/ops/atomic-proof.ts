import "server-only";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader"; import { applyDraftedCopy } from "@/domains/decision/drafted-copy";
import { confirmedVersion, deliverableGaps } from "@/domains/decision/completeness"; import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { nextObligation } from "@/domains/decision/obligation"; import { loadChangeProposal, saveChangeProposal } from "@/domains/decision/proposal-store";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { PROOF_SPEND, runWithoutSpending } from "@/lib/spend-scope"; import { researchPermission } from "./due-work";
import spendReservations from "@/lib/cost/spend-reservations";
const acceptable = (row: ChangeProposal | null): boolean => !!row && row.status === "ready" && row.researchOnly !== true
  && deliverableGaps(row).length === 0 && nextObligation(row) === null;
const DEPS = { permission: researchPermission, load: loadChangeProposal, evidence: loadEvidenceSnapshot,
  draft: applyDraftedCopy, save: saveChangeProposal, acceptable, obligation: nextObligation, delivery: DRAFT_BUDGET.deliveryOf,
  version: confirmedVersion, spend: spendReservations };
type Deps = typeof DEPS; type Input = { tenantId: string; proposalId: string; maxOpenAiCalls: number; maxOpenAiUsd: number; now?: Date };
async function run(input: Input, deps: Deps = DEPS) {
  const { tenantId, proposalId, maxOpenAiCalls, maxOpenAiUsd } = input;
  const refuse = (reason: string, stored: ChangeProposal | null = null) => ({ success: false as const, proposalId, reason, stored, meter: null });
  if (!tenantId || !proposalId.startsWith(`${tenantId}::`) || !Number.isInteger(maxOpenAiCalls) || maxOpenAiCalls < 1
    || maxOpenAiCalls > DRAFT_BUDGET.DELIVERABLE_CALLS * 2 || !Number.isFinite(maxOpenAiUsd) || maxOpenAiUsd <= 0) return refuse("invalid_identity_or_ceiling");
  if (await deps.permission(tenantId) !== "paused") return refuse("research_must_remain_paused");
  const row = await deps.load(tenantId, proposalId);
  if (!row || row.id !== proposalId || row.tenantId !== tenantId) return refuse("stored_candidate_not_found");
  if (deps.delivery(row) !== "existing_page_edit" || row.status !== "needs_review") return refuse("candidate_is_not_one_unfinished_manual_edit", row);
  const obligation = deps.obligation(row);
  if (!obligation || !["draft", "redraft", "review"].includes(obligation.kind)) return refuse(`candidate_owes_${obligation?.kind ?? "nothing"}`, row);
  const admissionKey = `atomic-proof::${tenantId}::${proposalId}::${deps.version(row)}`;
  const admission = await deps.spend.reserve({ tenantId, platform: "other", purpose: "atomic_proof_admission", logicalKey: admissionKey,
    requestFingerprint: admissionKey, estimatedUsd: 0, recoveryKind: "none" }).catch(() => null);
  if (admission?.outcome !== "reserved" || !admission.attemptId) return refuse("proof_already_attempted_or_admission_unavailable", row);
  if (await deps.spend.claimTransmission(admission.attemptId).catch(() => "unavailable" as const) !== "claimed") return refuse("proof_admission_not_claimed", row);
  const finish = async (success: boolean, reason: string, stored: ChangeProposal | null = row,
    meter: { ops: number; providerCalls: number; costUsd: number } | null = null) => {
    const recorded = await deps.spend.reconcile(admission.attemptId!, 0, null, "provider_reported", { success, reason }).catch(() => false);
    return success ? { success: true as const, proposalId, reason: recorded ? reason : "stored_ready_but_admission_receipt_missing", stored, meter }
      : { success: false as const, proposalId, reason: recorded ? reason : "admission_receipt_not_reconciled", stored, meter };
  };
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_before_draft");
  const key = DRAFT_BUDGET.keyOf(row); let budget: ReturnType<typeof DRAFT_BUDGET.plan> | undefined;
  try {
  const snapshot = await runWithoutSpending(() => deps.evidence(tenantId, input.now ? { now: input.now } : {}));
  budget = DRAFT_BUDGET.plan({ candidates: 1, calls: DRAFT_BUDGET.DELIVERABLE_CALLS,
    deliveryScope: "existing_page_edits", jobs: [{ key, family: "editor", impact: row.impactScore ?? 0,
      calls: DRAFT_BUDGET.DELIVERABLE_CALLS, delivery: "existing_page_edit" }] });
  const drafted = await PROOF_SPEND.run(tenantId, maxOpenAiCalls, maxOpenAiUsd,
    () => deps.draft([row], { tenantId, snapshot, now: input.now ?? new Date(), bypassCache: true, budget }));
  const candidate = drafted.length === 1 && drafted[0]?.id === proposalId && drafted[0].tenantId === tenantId ? drafted[0] : null;
  if (!candidate) return finish(false, "exact_candidate_was_not_returned");
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_before_persist");
  const saved = await deps.save(candidate, undefined, undefined, row), stored = await deps.load(tenantId, proposalId);
  const meter = budget.meterOf(key);
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_after_persist", stored, meter);
  if (saved === "failed" || saved === "blocked" || saved === "refused") return finish(false, `persist_${saved}`, stored, meter);
  const ready = deps.acceptable(stored);
  return finish(ready, ready ? "stored_ready_substantive_and_complete" : "stored_row_is_not_ready_substantive_and_complete", stored, meter);
  } catch { return finish(false, "proof_execution_failed", row, budget?.meterOf(key) ?? null); }
}
const atomicProof = { run };
export default atomicProof;
