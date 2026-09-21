import "server-only";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader"; import { applyDraftedCopy } from "@/domains/decision/drafted-copy";
import { deliverableGaps } from "@/domains/decision/completeness"; import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { nextObligation } from "@/domains/decision/obligation"; import { loadChangeProposal, saveChangeProposal } from "@/domains/decision/proposal-store";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { PROOF_SPEND } from "@/lib/spend-scope"; import { researchPermission } from "./due-work";
const acceptable = (row: ChangeProposal | null): boolean => !!row && row.status === "ready" && row.researchOnly !== true
  && deliverableGaps(row).length === 0 && nextObligation(row) === null;
const DEPS = { permission: researchPermission, load: loadChangeProposal, evidence: loadEvidenceSnapshot,
  draft: applyDraftedCopy, save: saveChangeProposal, acceptable, obligation: nextObligation, delivery: DRAFT_BUDGET.deliveryOf };
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
  const snapshot = await deps.evidence(tenantId, input.now ? { now: input.now } : {});
  const key = DRAFT_BUDGET.keyOf(row), budget = DRAFT_BUDGET.plan({ candidates: 1, calls: DRAFT_BUDGET.DELIVERABLE_CALLS,
    deliveryScope: "existing_page_edits", jobs: [{ key, family: "editor", impact: row.impactScore ?? 0,
      calls: DRAFT_BUDGET.DELIVERABLE_CALLS, delivery: "existing_page_edit" }] });
  const drafted = await PROOF_SPEND.run(tenantId, maxOpenAiCalls, maxOpenAiUsd,
    () => deps.draft([row], { tenantId, snapshot, now: input.now ?? new Date(), bypassCache: true, budget }));
  const candidate = drafted.length === 1 && drafted[0]?.id === proposalId && drafted[0].tenantId === tenantId ? drafted[0] : null;
  if (!candidate) return refuse("exact_candidate_was_not_returned", row);
  if (await deps.permission(tenantId) !== "paused") return refuse("research_pause_changed_before_persist", row);
  const saved = await deps.save(candidate, undefined, undefined, row), stored = await deps.load(tenantId, proposalId);
  const meter = budget.meterOf(key);
  if (await deps.permission(tenantId) !== "paused") return { ...refuse("research_pause_changed_after_persist", stored), meter };
  if (saved === "failed" || saved === "blocked" || saved === "refused") return { ...refuse(`persist_${saved}`, stored), meter };
  return deps.acceptable(stored) ? { success: true as const, proposalId, reason: "stored_ready_substantive_and_complete", stored, meter }
    : { ...refuse("stored_row_is_not_ready_substantive_and_complete", stored), meter };
}
const atomicProof = { run };
export default atomicProof;
