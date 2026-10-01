import "server-only";
import { EDITOR_SHARED, reviewFinishedCopy } from "@/domains/decision/drafted-copy"; import { REVIEW_CONTRACT, reviewFits, unreviewed } from "@/domains/decision/proof"; import { COPY_RULES } from "@/domains/decision/copy-sanitize";
import { PROMPT_REGISTRY } from "@/domains/decision/llm/prompt-registry"; import { confirmedVersion, deliverableGaps } from "@/domains/decision/completeness"; import { DRAFT_BUDGET } from "@/domains/decision/draft-budget"; import { nextObligation } from "@/domains/decision/obligation"; import { answerReviewedProposal, saveChangeProposal, loadChangeProposal, preflightReviewedProposal } from "@/domains/decision/proposal-store";
import type { ChangeProposal } from "@/domains/decision/contracts"; import { PROOF_SPEND, runWithoutSpending } from "@/lib/spend-scope"; import { researchPermission } from "./due-work";
import spendReservations from "@/lib/cost/spend-reservations";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { resolveCurrentBasis } from "@/domains/decision/load-proposals";
import { runResearchCycle } from "./on-visit-refresh";
const acceptable = (row: ChangeProposal | null): boolean => !!row && row.status === "ready" && row.researchOnly !== true
  && deliverableGaps(row).length === 0 && nextObligation(row) === null;
const DEPS = { permission: researchPermission, load: loadChangeProposal, review: reviewFinishedCopy, promote: answerReviewedProposal, reviewAuthorized: (row: ChangeProposal) => row.semanticReview?.version === REVIEW_CONTRACT && COPY_RULES.accepted(row.semanticReview.editor) && reviewFits(row, row.semanticReview.of) && unreviewed(row) == null,
  acceptable, save: saveChangeProposal, obligation: nextObligation, delivery: DRAFT_BUDGET.deliveryOf, version: confirmedVersion, preflight: preflightReviewedProposal,
  providerConfigured: () => !!process.env.OPENAI_API_KEY?.trim(), spend: spendReservations };
type Deps = typeof DEPS; type Input = { tenantId: string; proposalId: string; currentBasis: string | null; maxOpenAiCalls: number; maxOpenAiUsd: number; now?: Date };
async function run(input: Input, deps: Deps = DEPS) {
  const { tenantId, proposalId, currentBasis, maxOpenAiCalls, maxOpenAiUsd } = input;
  const refuse = (reason: string, stored: ChangeProposal | null = null) => ({ success: false as const, proposalId, reason, stored, meter: null });
  if (!tenantId || !currentBasis || !proposalId.startsWith(`${tenantId}::`) || maxOpenAiCalls !== 1
    || !Number.isFinite(maxOpenAiUsd) || maxOpenAiUsd <= 0 || maxOpenAiUsd > 0.05) return refuse("invalid_identity_or_ceiling");
  if (await deps.permission(tenantId) !== "paused") return refuse("research_must_remain_paused");
  let row = await deps.load(tenantId, proposalId);
  if (!row || row.id !== proposalId || row.tenantId !== tenantId) return refuse("stored_candidate_not_found");
  if (row.basis !== currentBasis) return refuse("candidate_basis_is_not_current", row);
  if (deps.delivery(row) !== "existing_page_edit" || !["needs_review", "ready"].includes(row.status)) return refuse("candidate_is_not_one_unfinished_manual_edit", row);
  const obligation = deps.obligation(row);
  if (obligation?.kind !== "review") return refuse(`candidate_owes_${obligation?.kind ?? "nothing"}`, row);
  const now = input.now ?? new Date(), preflight = await deps.preflight(tenantId, row, currentBasis, now);
  if (preflight.reason) return refuse(`candidate_preflight:${preflight.reason}`, row);
  if (row.status === "needs_review" && deps.reviewAuthorized(row) && !preflight.reviewRefresh) { if (await deps.permission(tenantId) !== "paused") return refuse("accepted_review_could_not_be_settled", row); const promoted = await deps.promote(tenantId, proposalId, deps.version(row), currentBasis, { kind: "promote", at: now.toISOString() }), stored = await deps.load(tenantId, proposalId); return promoted.status === "promoted" && deps.acceptable(stored) ? { success: true as const, proposalId, reason: "stored_ready_from_current_review", stored, meter: { ops: 0, providerCalls: 0, costUsd: 0 } } : refuse(`promotion_${promoted.status}${promoted.refusal ? `:${promoted.refusal}` : ""}`, stored); }
  const role = EDITOR_SHARED.reviewWorkKey(row, preflight.captures, preflight.checked), legacyKey = `atomic-proof-v2::${tenantId}::${proposalId}::${deps.version(row)}::draft.editor_judgement:v9`, admissionKey = `atomic-proof-v2::${tenantId}::${proposalId}::${role}::draft.editor_judgement:v${PROMPT_REGISTRY["draft.editor_judgement"]}`;
  if (!role) return refuse("exact_review_identity_unqualified", row);
  let historical: Awaited<ReturnType<Deps["spend"]["read"]>>[]; try { historical = await Promise.all([deps.spend.read({ tenantId, platform: "other", purpose: "atomic_proof_admission", logicalKey: legacyKey }), deps.spend.read({ tenantId, platform: "adjudicator-openai", purpose: "bulk", proposalWorkKey: role }), role !== row.workKey && row.workKey?.startsWith(`review::${tenantId}::${proposalId}::`) ? deps.spend.read({ tenantId, platform: "adjudicator-openai", purpose: "bulk", proposalWorkKey: row.workKey }) : Promise.resolve(null), deps.spend.read({ tenantId, platform: "other", purpose: "atomic_proof_admission", logicalKey: admissionKey })]); } catch { return refuse("proof_admission_history_unreadable", row); }
  const [legacy, current, prior, bound] = historical; if (legacy && !current && role !== row.workKey && !prior) return refuse("legacy_review_admission_unbound", row);
  const legacyReserved = !bound && legacy?.state === "reserved" && Number(PROMPT_REGISTRY["draft.editor_judgement"]) === 9 && role === row.workKey; let recoveryOnly = !!bound && bound.state !== "reserved" || !!legacy && legacy.state !== "reserved" && Number(PROMPT_REGISTRY["draft.editor_judgement"]) === 9 && role === row.workKey, replayReason = "proof_admission_replayed";
  if (!deps.providerConfigured() && !recoveryOnly) return refuse("openai_not_configured_in_this_runtime", row);
  const admission = recoveryOnly ? null : await deps.spend.reserve({ tenantId, platform: "other", purpose: "atomic_proof_admission", logicalKey: legacyReserved ? legacyKey : admissionKey, proposalWorkKey: legacyReserved ? legacy?.proposalWorkKey : role, requestFingerprint: legacyReserved ? legacyKey : admissionKey, estimatedUsd: 0, recoveryKind: "none" }).catch(() => null);
  if (!recoveryOnly) { if (!admission) return refuse("proof_admission_unavailable", row); if (["resumed", "replayed"].includes(admission.outcome) && admission.state !== "reserved") { recoveryOnly = true; replayReason = `proof_admission_${admission.outcome}`; } else if (!["reserved", "resumed"].includes(admission.outcome) || admission.state !== "reserved" || !admission.attemptId) return refuse(`proof_admission_${admission.outcome}`, row);
    else { const claim = await deps.spend.claimTransmission(admission.attemptId).catch(() => "unavailable" as const); if (claim !== "claimed") return refuse(`proof_admission_${claim}`, row); } }
  const finish = async (success: boolean, reason: string, stored: ChangeProposal | null = row,
    meter: { ops: number; providerCalls: number; costUsd: number } | null = null, beforeReview = false) => {
    if (recoveryOnly || !admission) return { success, proposalId, reason, stored, meter };
    const zeroCallFailure = !success && (beforeReview || meter != null && meter.providerCalls === 0);
    const recorded = zeroCallFailure ? await deps.spend.release(admission.attemptId!, true).catch(() => false)
      : await deps.spend.reconcile(admission.attemptId!, 0, null, "provider_reported", { success, reason }).catch(() => false);
    return success ? { success: true as const, proposalId, reason: recorded ? reason : "stored_ready_but_admission_receipt_missing", stored, meter }
      : { success: false as const, proposalId, reason: recorded ? reason : zeroCallFailure ? "admission_receipt_not_released" : "admission_receipt_not_reconciled", stored, meter };
  };
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_before_review", row, null, true);
  const owned = await EDITOR_SHARED.prepareReview(row, preflight, { saveChangeProposal: deps.save, loadChangeProposal: deps.load }).catch(() => null); if (!owned) return finish(false, "exact_review_ownership_not_saved", await deps.load(tenantId, proposalId), null, true); row = owned.row;
  const key = DRAFT_BUDGET.keyOf(row); let budget: ReturnType<typeof DRAFT_BUDGET.plan> | undefined;
  try {
  budget = DRAFT_BUDGET.plan({ candidates: 1, calls: 1,
    deliveryScope: "existing_page_edits", jobs: [{ key, family: "editor", impact: row.impactScore ?? 0,
      calls: 1, delivery: "existing_page_edit" }] });
  const attempts = budget.draw(key, 1); if (!attempts) return finish(false, "proof_review_allowance_unavailable", row, budget.meterOf(key), true);
  const review = () => deps.review(row!, { tenantId, now, bypassCache: false, attempts, proposalWorkKey: row!.workKey, reviewContext: owned.context }), reviewed = recoveryOnly ? await runWithoutSpending(review) : await PROOF_SPEND.run(tenantId, maxOpenAiCalls, maxOpenAiUsd, review);
  const meter = budget.meterOf(key), proposed = reviewed.row && reviewed.row.id === proposalId && reviewed.row.tenantId === tenantId ? reviewed.row : null;
  if (!proposed) return finish(false, recoveryOnly ? replayReason : "review_did_not_return_the_exact_candidate", row, meter);
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_before_persist");
  const candidate: ChangeProposal = { ...proposed, status: "ready", obligation: undefined }, qualified = deps.reviewAuthorized(candidate) && deps.acceptable(candidate), saved = await deps.save(qualified ? candidate : { ...proposed, status: "needs_review" }, undefined, undefined, row);
  const promoted: Awaited<ReturnType<Deps["promote"]>> = saved ? { status: saved === "saved" ? qualified ? "promoted" : "refused" : saved === "blocked" || saved === "unchanged" ? "stale" : saved } : await deps.promote(tenantId, proposalId, deps.version(row), currentBasis, { kind: "promote", at: now.toISOString() }, proposed), stored = await deps.load(tenantId, proposalId);
  if (await deps.permission(tenantId) !== "paused") return finish(false, "research_pause_changed_after_persist", stored, meter);
  if (promoted.status !== "promoted") return finish(false, `promotion_${promoted.status}${promoted.refusal ? `:${promoted.refusal}` : ""}`, stored, meter);
  const accepted = deps.acceptable(stored);
  return finish(accepted, accepted ? "stored_ready_substantive_and_complete" : "stored_row_is_not_ready_substantive_and_complete", stored, meter);
  } catch { return finish(false, "proof_execution_failed", row, budget?.meterOf(key) ?? null); }
}
const PAGE_DEPS = { permission: researchPermission, load: loadChangeProposal, produce: produceProposalsForTenant, current: resolveCurrentBasis };
const sameDocument = (a: string, b: string): boolean => { try { const x = new URL(a.startsWith("/") ? a : /^https?:\/\//i.test(a) ? a : `https://${a}`, b), y = new URL(b); return x.protocol === y.protocol && x.port === y.port && x.hostname.replace(/^www\./, "") === y.hostname.replace(/^www\./, "") && x.pathname === y.pathname && x.search === y.search; } catch { return false; } };
/** A legacy description edit whose exact predecessor disappeared is historical work. The focused $0 producer owns the new hypothesis and its atomic handover; this action only follows the successor it actually saved. */
async function currentMetaSuccessor(tenantId: string, oldId: string, basis: string | null, overrides: Partial<typeof PAGE_DEPS> = {}): Promise<string | null> {
  const d = { ...PAGE_DEPS, ...overrides };
  const prior: { row: { proposal_version: number; terminal_disposition: string | null; superseded_by: string | null } | null } = { row: null };
  const old = await d.load(tenantId, oldId, { canonicalOnly: true, retired: "include", canonicalRow: row => { prior.row = row; } });
  const change = old?.recommendedChange;
  if (old?.obligation?.kind !== "terminal" || old.obligation.reason !== COPY_RULES.metaPredecessorGone
    || change?.kind !== "existing_edit" || change.field !== "meta") return oldId;
  if (!basis || !oldId.startsWith(`${tenantId}::`) || await d.permission(tenantId) !== "paused") return null;
  if (!old || old.id !== oldId || old.tenantId !== tenantId || old.basis !== basis || old.status !== "needs_review" || old.riskLevel !== "low"
    || !prior.row?.proposal_version || ![null, "superseded"].includes(prior.row.terminal_disposition) || old.approval || old.confirmedVersion || old.redraftRequested || old.bundle || old.newPageDraft
    || old.obligation.holdCode || !change.before?.trim() || !old.pageUrl || !old.pagePath) return null;
  const successorId = `${tenantId}::${old.pagePath}::existing_edit::missing_description`;
  if (prior.row.terminal_disposition === "superseded" && prior.row.superseded_by !== successorId) return null;
  if (prior.row.terminal_disposition === null) await runWithoutSpending(() => d.produce(tenantId, { now: new Date(), focusPage: old.pageUrl!, produce: true, zeroSpend: true, persist: true,
    maxDrafts: 0, maxCalls: 0, aeoDiagnoses: 0, deliveryScope: "existing_page_edits", stopBy: Date.now() + 110_000 }));
  const retired: typeof prior = { row: null }, current: typeof prior = { row: null };
  const [oldAfter, successor, stillBasis, stillPaused] = await Promise.all([
    d.load(tenantId, oldId, { canonicalOnly: true, retired: "include", canonicalRow: row => { retired.row = row; } }),
    d.load(tenantId, successorId, { canonicalOnly: true, canonicalRow: row => { current.row = row; } }),
    d.current(tenantId), d.permission(tenantId),
  ]);
  const next = successor?.recommendedChange;
  if (retired.row?.proposal_version !== prior.row.proposal_version || retired.row?.terminal_disposition !== "superseded"
    || retired.row.superseded_by !== successorId || JSON.stringify(oldAfter) !== JSON.stringify(old) || !current.row?.proposal_version || current.row.proposal_version <= prior.row.proposal_version
    || current.row?.terminal_disposition != null || successor?.id !== successorId || successor.tenantId !== tenantId || successor.basis !== basis || successor.status !== "needs_review"
    || successor.researchOnly !== true || !successor.workKey?.trim() || successor.obligation?.kind !== "draft" || successor.approval || successor.confirmedVersion || successor.redraftRequested
    || next?.kind !== "existing_edit" || next.field !== "meta" || next.before !== null || !successor.pageUrl || !sameDocument(successor.pageUrl, old.pageUrl!) || successor.pagePath !== old.pagePath
    || stillBasis !== basis || stillPaused !== "paused") return null;
  return successorId;
}

const atomicProof = { run, currentMetaSuccessor, prepareNext: (input: { tenantId: string; currentBasis: string | null; eligible: (p: ChangeProposal) => boolean; limitToOneDollar?: true; maxTotalUsd?: number; preferred?: { proposalId: string; workKey: string; strict: true; version: number } }) => runResearchCycle(input.tenantId, { manualDelivery: { currentBasis: input.currentBasis, eligible: input.eligible, ...(input.preferred ? { preferred: input.preferred } : {}), ...(input.limitToOneDollar === true ? { limitToOneDollar: true as const } : {}), ...(input.maxTotalUsd !== undefined ? { maxTotalUsd: input.maxTotalUsd } : {}) } }) };
export default atomicProof;
