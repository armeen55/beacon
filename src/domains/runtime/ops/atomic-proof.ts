import "server-only";
import { reviewFinishedCopy, writerKindOf } from "@/domains/decision/drafted-copy"; import { REVIEW_CONTRACT, reviewFits, unreviewed } from "@/domains/decision/proof"; import { COPY_RULES } from "@/domains/decision/copy-sanitize";
import { confirmedVersion, deliverableGaps } from "@/domains/decision/completeness"; import { DRAFT_BUDGET } from "@/domains/decision/draft-budget"; import { nextObligation } from "@/domains/decision/obligation"; import { answerReviewedProposal, loadChangeProposal, loadChangeProposals, preflightReviewedProposal } from "@/domains/decision/proposal-store";
import type { ChangeProposal } from "@/domains/decision/contracts"; import { PROOF_SPEND, runWithoutSpending } from "@/lib/spend-scope"; import { researchPermission } from "./due-work";
import spendReservations, { runWithProposalWorkKey } from "@/lib/cost/spend-reservations";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { isCurrent } from "@/domains/evidence/freshness";
import { defaultSteps } from "./research-steps";
import { getTenant } from "@/domains/account";
const acceptable = (row: ChangeProposal | null): boolean => !!row && row.status === "ready" && row.researchOnly !== true
  && deliverableGaps(row).length === 0 && nextObligation(row) === null;
const DEPS = { permission: researchPermission, load: loadChangeProposal, review: reviewFinishedCopy, promote: answerReviewedProposal, reviewAuthorized: (row: ChangeProposal) => row.semanticReview?.version === REVIEW_CONTRACT && COPY_RULES.accepted(row.semanticReview.editor) && reviewFits(row, row.semanticReview.of) && unreviewed(row) == null,
  acceptable, obligation: nextObligation, delivery: DRAFT_BUDGET.deliveryOf, version: confirmedVersion, preflight: preflightReviewedProposal,
  providerConfigured: () => !!process.env.OPENAI_API_KEY?.trim(), spend: spendReservations };
type Deps = typeof DEPS; type Input = { tenantId: string; proposalId: string; currentBasis: string | null; maxOpenAiCalls: number; maxOpenAiUsd: number; now?: Date };
async function run(input: Input, deps: Deps = DEPS) {
  const { tenantId, proposalId, currentBasis, maxOpenAiCalls, maxOpenAiUsd } = input;
  const refuse = (reason: string, stored: ChangeProposal | null = null) => ({ success: false as const, proposalId, reason, stored, meter: null });
  if (!tenantId || !currentBasis || !proposalId.startsWith(`${tenantId}::`) || maxOpenAiCalls !== 1
    || !Number.isFinite(maxOpenAiUsd) || maxOpenAiUsd <= 0 || maxOpenAiUsd > 0.05) return refuse("invalid_identity_or_ceiling");
  if (await deps.permission(tenantId) !== "paused") return refuse("research_must_remain_paused");
  const row = await deps.load(tenantId, proposalId);
  if (!row || row.id !== proposalId || row.tenantId !== tenantId) return refuse("stored_candidate_not_found");
  if (row.basis !== currentBasis) return refuse("candidate_basis_is_not_current", row);
  if (deps.delivery(row) !== "existing_page_edit" || row.status !== "needs_review") return refuse("candidate_is_not_one_unfinished_manual_edit", row);
  const obligation = deps.obligation(row);
  if (obligation?.kind !== "review") return refuse(`candidate_owes_${obligation?.kind ?? "nothing"}`, row);
  const now = input.now ?? new Date(), preflight = await deps.preflight(tenantId, row, currentBasis, now);
  if (preflight.reason) return refuse(`candidate_preflight:${preflight.reason}`, row);
  if (deps.reviewAuthorized(row) && !preflight.reviewRefresh) { if (await deps.permission(tenantId) !== "paused") return refuse("accepted_review_could_not_be_settled", row); const promoted = await deps.promote(tenantId, proposalId, deps.version(row), currentBasis, { kind: "promote", at: now.toISOString() }), stored = await deps.load(tenantId, proposalId); return promoted.status === "promoted" && deps.acceptable(stored) ? { success: true as const, proposalId, reason: "stored_ready_from_current_review", stored, meter: { ops: 0, providerCalls: 0, costUsd: 0 } } : refuse(`promotion_${promoted.status}${promoted.refusal ? `:${promoted.refusal}` : ""}`, stored); }
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
  const promoted = await deps.promote(tenantId, proposalId, deps.version(row), currentBasis, { kind: "promote", at: now.toISOString() }, proposed), stored = await deps.load(tenantId, proposalId);
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_after_persist", stored, meter);
  if (promoted.status !== "promoted") return finish(false, `promotion_${promoted.status}${promoted.refusal ? `:${promoted.refusal}` : ""}`, stored, meter);
  const accepted = deps.acceptable(stored);
  return finish(accepted, accepted ? "stored_ready_substantive_and_complete" : "stored_row_is_not_ready_substantive_and_complete", stored, meter);
  } catch { return finish(false, "proof_execution_failed", row, budget?.meterOf(key) ?? null); }
}
const PAGE_DEPS = { ...DEPS, produce: produceProposalsForTenant, acquire: defaultSteps.acquireEvidence, list: loadChangeProposals,
  bodies: loadOwnedPageBodies, account: getTenant, basis: defaultSteps.currentBasis, clock: Date.now,
  substantive: (row: ChangeProposal) => writerKindOf(row) === "answer" && row.changeFamily !== "factual_correction" };
type PageInput = Omit<Input, "now"> & { maxDataForSeoCalls: number; maxDataForSeoUsd: number };

async function finishPage(input: PageInput, overrides: Partial<typeof PAGE_DEPS> = {}) {
  const d = { ...PAGE_DEPS, ...overrides }, { tenantId, proposalId, currentBasis } = input;
  const deadline = d.clock() + 240_000, stopBy = deadline - 100_000;
  let stored: ChangeProposal | null = null, captured = false, allowance: ReturnType<typeof PROOF_SPEND.meter> = null;
  let output: Awaited<ReturnType<typeof produceProposalsForTenant>> | null = null;
  const result = (success: boolean, reason: string) => ({ success, proposalId: stored?.id ?? proposalId, reason, stored, captured, allowance,
    meter: output ? output.paid.receipts.reduce((m, r) => ({ providerCalls: m.providerCalls + r.providerCalls, costUsd: m.costUsd + r.costUsd }), { providerCalls: 0, costUsd: 0 }) : null,
    evidenceOwed: output?.paid.evidenceOwed ?? [], held: output?.held ?? [] });
  if (!tenantId || !currentBasis || !proposalId.startsWith(`${tenantId}::`) || input.maxOpenAiCalls !== 8 || input.maxOpenAiUsd !== 2
    || input.maxDataForSeoCalls !== 1 || input.maxDataForSeoUsd !== 0.4) return result(false, "invalid_identity_or_ceiling");
  if (await d.permission(tenantId) !== "paused") return result(false, "research_must_remain_paused");
  const row = await d.load(tenantId, proposalId);
  if (!row || row.tenantId !== tenantId || row.id !== proposalId || row.basis !== currentBasis
    || d.delivery(row) !== "existing_page_edit" || row.status !== "needs_review" || !row.pageUrl || !row.workKey?.trim()) return result(false, "candidate_is_not_current_unfinished_page_work");
  stored = row;
  const accountBasis = await d.basis(tenantId).catch(() => null);
  if (!accountBasis) return result(false, "account_basis_unavailable");
  const account = await d.account(tenantId).catch(() => null); let page: string;
  try {
    if (!account?.domain) return result(false, "owned_website_unavailable");
    const absolute = (value: string) => /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const origin = new URL(absolute(account.domain)), target = new URL(row.pageUrl.startsWith("/") ? row.pageUrl : absolute(row.pageUrl), origin);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || canonicalUrlKey(target.origin) !== canonicalUrlKey(origin.origin)) return result(false, "candidate_is_not_owned_page");
    target.hash = ""; page = target.href;
  } catch { return result(false, "candidate_is_not_owned_page"); }
  const pageKey = canonicalUrlKey(page), samePage = (p: ChangeProposal) => p.tenantId === tenantId && canonicalUrlKey(p.pageUrl ?? "") === pageKey;
  const base = { focusPage: page, deliveryScope: "existing_page_edits" as const, produce: true, maxDrafts: 1, stopBy };
  output = await runWithoutSpending(() => d.produce(tenantId, { ...base, persist: false, zeroSpend: true, maxCalls: 0, aeoDiagnoses: 0 }));
  if (output.outcome === "evidence_unreadable") return result(false, "saved_evidence_unreadable");
  const savedRows = await d.list(tenantId, { failClosed: true }).catch(() => null);
  if (!savedRows) return result(false, "saved_proposals_unreadable");
  const already = new Map([...savedRows.values()].filter((p) => samePage(p) && d.substantive(p) && d.acceptable(p)).map((p) => [p.id, d.version(p)]));
  if (d.clock() >= stopBy || await d.permission(tenantId) !== "paused") return result(false, "proof_preparation_deferred");
  const admissionKey = `page-proof-v3::${tenantId}::${pageKey}::${currentBasis}`;
  const admission = await d.spend.reserve({ tenantId, platform: "other", purpose: "atomic_proof_admission", logicalKey: admissionKey,
    requestFingerprint: admissionKey, estimatedUsd: 0, recoveryKind: "none" }).catch(() => null);
  if (admission?.outcome !== "reserved" || !admission.attemptId) return result(false, `proof_admission_${admission?.outcome ?? "unavailable"}`);
  if (await d.spend.claimTransmission(admission.attemptId).catch(() => "unavailable") !== "claimed") return result(false, "proof_admission_not_claimed");
  let success = false, reason = "proof_execution_failed";
  try {
    await PROOF_SPEND.run(tenantId, 8, 2, async () => {
      try {
        if (await d.permission(tenantId) !== "paused") { reason = "research_pause_changed_before_capture"; return; }
        const body = (await d.bodies(tenantId, [page])).get(pageKey);
        captured = body?.version === "current" && body.completeness === "complete" && !!body.contentHash && isCurrent("owned_page", body.fetchedAt, d.clock());
        if (!captured) {
          const acquired = await runWithProposalWorkKey(row.workKey, () => d.acquire(tenantId, {
            kind: "page_source", url: page, query: row.primaryQuery, reasonCode: "owned_page_capture_unqualified", workKey: row.workKey!,
          }, accountBasis, Math.min(75_000, Math.max(0, stopBy - d.clock())), undefined, "existing_page_edits"));
          captured = acquired.acquired;
          if (!captured) { reason = `owned_capture_owed:${acquired.detail}`; return; }
        }
        if (d.clock() >= stopBy || await d.permission(tenantId) !== "paused") { reason = "captured_but_drafting_deferred"; return; }
        output = await d.produce(tenantId, { ...base, persist: true, maxCalls: 8, aeoDiagnoses: 1 });
        for (const proposal of output.proposals.filter((p) => samePage(p) && d.substantive(p) && already.get(p.id) !== d.version(p))) {
          const saved = await d.load(tenantId, proposal.id);
          if (saved && samePage(saved) && saved.basis === currentBasis && d.substantive(saved) && d.acceptable(saved)) { stored = saved; success = true; break; }
        }
        reason = success ? "stored_ready_substantive_and_complete" : "no_new_ready_substantive_edit";
        if (await d.permission(tenantId) !== "paused") { success = false; reason = "research_pause_changed_after_execution"; }
      } finally { allowance = PROOF_SPEND.meter(tenantId); }
    }, { maxExternalCalls: 1, maxExternalUsd: 0.4, allowedExternal: [{ capability: "onpage_rendered_html", url: page }], stopBy });
  } catch { reason = "proof_execution_failed"; }
  // A crashed/ambiguous authorized call consumes admission. Only a positively observed zero-call scope releases it.
  const used = allowance as ReturnType<typeof PROOF_SPEND.meter>;
  const noCalls = used != null && used.modelCalls === 0 && used.externalCalls === 0;
  const recorded = noCalls && !success ? await d.spend.release(admission.attemptId, true).catch(() => false)
    : await d.spend.reconcile(admission.attemptId, 0, null, "provider_reported", { success, reason, allowance }).catch(() => false);
  return result(success, recorded ? reason : "proof_admission_receipt_missing");
}
const atomicProof = { run, finishPage };
export default atomicProof;
