import "server-only";
import { reviewFinishedCopy, writerKindOf } from "@/domains/decision/drafted-copy"; import { REVIEW_CONTRACT, reviewFits, unreviewed } from "@/domains/decision/proof"; import { COPY_RULES } from "@/domains/decision/copy-sanitize";
import { confirmedVersion, deliverableGaps } from "@/domains/decision/completeness"; import { DRAFT_BUDGET } from "@/domains/decision/draft-budget"; import { nextObligation } from "@/domains/decision/obligation"; import { answerReviewedProposal, loadChangeProposal, loadChangeProposals, preflightReviewedProposal } from "@/domains/decision/proposal-store";
import type { ChangeProposal } from "@/domains/decision/contracts"; import { PROOF_SPEND, runWithoutSpending } from "@/lib/spend-scope"; import { researchPermission } from "./due-work";
import spendReservations, { runWithProposalWorkKey } from "@/lib/cost/spend-reservations";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { resolveCurrentBasis } from "@/domains/decision/load-proposals";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
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
const PAGE_DEPS = { ...DEPS, produce: produceProposalsForTenant, acquire: defaultSteps.acquireEvidence, list: loadChangeProposals, snapshot: loadEvidenceSnapshot,
  bodies: loadOwnedPageBodies, account: getTenant, basis: defaultSteps.currentBasis, current: resolveCurrentBasis, clock: Date.now,
  substantive: (row: ChangeProposal) => writerKindOf(row) === "answer" && row.changeFamily !== "factual_correction" || writerKindOf(row) === "description" && row.recommendedChange.kind === "existing_edit" && row.recommendedChange.field === "meta" || writerKindOf(row) === "link" && row.recommendedChange.kind === "existing_edit" && !!row.recommendedChange.linkTo };
type PageInput = Omit<Input, "now"> & { maxDataForSeoCalls: number; maxDataForSeoUsd: number; authorizationId?: string }; const sameDocument = (a: string, b: string): boolean => { try { const x = new URL(a.startsWith("/") ? a : /^https?:\/\//i.test(a) ? a : `https://${a}`, b), y = new URL(b); return x.protocol === y.protocol && x.port === y.port && x.hostname.replace(/^www\./, "") === y.hostname.replace(/^www\./, "") && x.pathname === y.pathname && x.search === y.search; } catch { return false; } };

async function finishPage(input: PageInput, overrides: Partial<typeof PAGE_DEPS> = {}) {
  const d = { ...PAGE_DEPS, ...overrides }, { tenantId, proposalId, currentBasis } = input, stopBy = d.clock() + 140_000;
  let stored: ChangeProposal | null = null, captured = false, allowance: ReturnType<typeof PROOF_SPEND.meter> = null;
  let output: Awaited<ReturnType<typeof produceProposalsForTenant>> | null = null, acquisition: Awaited<ReturnType<typeof defaultSteps.acquireEvidence>> | null = null;
  const receipts: Awaited<ReturnType<typeof produceProposalsForTenant>>["paid"]["receipts"][number][] = [], shared = new Map<string, unknown>();
  const result = (success: boolean, reason: string) => ({ success, proposalId: stored?.id ?? proposalId, reason, stored, captured, allowance, acquisition,
    preferredRetiredReason: output?.paid.preferredRetiredReason, preferredOutcome: output?.paid.receipts.find((r) => r.family === "editor" && !!output?.paid.preferredWorkKey && r.workKey === output?.paid.preferredWorkKey)?.outcome ?? null,
    meter: output ? receipts.reduce((m, r) => ({ providerCalls: m.providerCalls + r.providerCalls, costUsd: m.costUsd + r.costUsd }), { providerCalls: 0, costUsd: 0 }) : null,
    evidenceOwed: output?.paid.evidenceOwed ?? [], held: output?.held ?? [] });
  if (!tenantId || !currentBasis || !proposalId.startsWith(`${tenantId}::`) || input.maxOpenAiCalls !== 8 || input.maxOpenAiUsd !== 2
    || input.maxDataForSeoCalls !== 3 || input.maxDataForSeoUsd !== 0.4
    || (input.authorizationId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.authorizationId))) return result(false, "invalid_identity_or_ceiling");
  if (await d.permission(tenantId) !== "paused") return result(false, "research_must_remain_paused");
  if (!d.providerConfigured()) return result(false, "openai_not_configured_in_this_runtime");
  const row = await d.load(tenantId, proposalId);
  if (!row || row.tenantId !== tenantId || row.id !== proposalId || row.basis !== currentBasis
    || d.delivery(row) !== "existing_page_edit" || row.status !== "needs_review" || !row.pageUrl || !row.workKey?.trim()) return result(false, "candidate_is_not_current_unfinished_page_work");
  stored = row;
  const accountBasis = await d.basis(tenantId).catch(() => null); if (!accountBasis) return result(false, "account_basis_unavailable");
  const account = await d.account(tenantId).catch(() => null); let page: string; try {
    if (!account?.domain) return result(false, "owned_website_unavailable");
    const absolute = (value: string) => /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const origin = new URL(absolute(account.domain)), target = new URL(row.pageUrl.startsWith("/") ? row.pageUrl : absolute(row.pageUrl), origin);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || !sameDocument(target.origin, origin.origin)) return result(false, "candidate_is_not_owned_page");
    target.hash = ""; page = target.href;
  } catch { return result(false, "candidate_is_not_owned_page"); }
  const pageKey = canonicalUrlKey(page), samePage = (p: ChangeProposal) => p.tenantId === tenantId && !!p.pageUrl && sameDocument(p.pageUrl, page);
  const base = { focusPage: page, preferred: { proposalId: row.id, workKey: row.workKey!, strict: true as const }, deliveryScope: "existing_page_edits" as const, produce: true, maxDrafts: 1, stopBy };
  const snapshot = await runWithoutSpending(() => d.snapshot(tenantId)).catch(() => null);
  if (!snapshot || snapshot.sources.some((s) => (s.source === "gsc" || s.source === "wix") && s.status === "failed")) return result(false, "saved_evidence_unreadable");
  const link = row.recommendedChange.kind === "existing_edit" ? row.recommendedChange.linkTo : null; let destination: string | null = null; try { if (link) { const target = new URL(link, page); target.hash = ""; destination = target.href; } } catch { return result(false, "link_destination_is_not_a_distinct_owned_page"); }
  const dest = destination ? new URL(destination) : null, sourceOrigin = new URL(page), sameOrigin = (a: URL, b: URL) => a.protocol === b.protocol && a.port === b.port && a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
  if (dest && (!["http:", "https:"].includes(dest.protocol) || dest.username || dest.password || !sameOrigin(dest, sourceOrigin) || dest.pathname === sourceOrigin.pathname || !snapshot.ownedPages.some((p) => { try { const owned = new URL(/^https?:\/\//i.test(p.url) ? p.url : `https://${p.url}`); return sameOrigin(owned, dest) && owned.pathname === dest.pathname && owned.search === dest.search; } catch { return false; } }))) return result(false, "link_destination_is_not_a_distinct_owned_page");
  const savedRows = await d.list(tenantId, { failClosed: true }).catch(() => null); if (!savedRows) return result(false, "saved_proposals_unreadable");
  const already = new Map([...savedRows.values()].filter((p) => samePage(p) && d.substantive(p) && d.acceptable(p)).map((p) => [p.id, d.version(p)]));
  if (d.clock() >= stopBy || await d.permission(tenantId) !== "paused") return result(false, "proof_preparation_deferred");
  const admissionKey = `page-proof-v3::${tenantId}::${pageKey}::${currentBasis}${input.authorizationId ? `::operator:${input.authorizationId.toLowerCase()}` : ""}`;
  const admission = await d.spend.reserve({ tenantId, platform: "other", purpose: "atomic_proof_admission", logicalKey: admissionKey,
    requestFingerprint: admissionKey, estimatedUsd: 0, recoveryKind: "none" }).catch(() => null);
  if (admission?.outcome !== "reserved" || !admission.attemptId) return result(false, `proof_admission_${admission?.outcome ?? "unavailable"}`);
  if (await d.spend.claimTransmission(admission.attemptId).catch(() => "unavailable") !== "claimed") return result(false, "proof_admission_not_claimed");
  let success = false, reason = "proof_execution_failed";
  try {
    await PROOF_SPEND.run(tenantId, 8, 2, async () => {
      try {
        if (await d.permission(tenantId) !== "paused") { reason = "research_pause_changed_before_capture"; return; }
        const pages = destination ? [page, destination] : [page], bodies = await d.bodies(tenantId, pages), qualified = (body: OwnedPageBody | null | undefined, url: string) => !!body?.finalUrl && sameDocument(body.url, url) && sameDocument(body.finalUrl, url) && body.version === "current" && body.completeness === "complete" && !!body.contentHash && isCurrent("owned_page", body.fetchedAt, d.clock());
        for (const url of pages) { if (qualified(bodies.get(canonicalUrlKey(url)), url)) continue;
          const acquired = await runWithProposalWorkKey(row.workKey, () => d.acquire(tenantId, { kind: "page_source", url, query: row.primaryQuery, reasonCode: "owned_page_capture_unqualified", workKey: row.workKey! }, accountBasis, Math.min(75_000, Math.max(0, stopBy - d.clock())), undefined, "existing_page_edits")); const readback = acquired.acquired ? (await d.bodies(tenantId, [url])).get(canonicalUrlKey(url)) : null;
          if (!qualified(readback, url)) { reason = `owned_capture_owed:${acquired.detail}`; return; } }
        captured = true; if (d.clock() >= stopBy || await d.permission(tenantId) !== "paused") { reason = "captured_but_drafting_deferred"; return; }
        const produce = async (aeoDiagnoses: number) => {
          if (d.clock() >= stopBy || await d.permission(tenantId) !== "paused") return;
          output = await d.produce(tenantId, { ...base, shared, persist: true, maxCalls: Math.max(0, 8 - (PROOF_SPEND.meter(tenantId)?.modelCalls ?? 8)), aeoDiagnoses });
          receipts.push(...output.paid.receipts);
          if (output.persisted > 0) for (const key of shared.keys()) if (key.startsWith("proposals:") || key.startsWith("cards:")) shared.delete(key);
          for (const proposal of output.proposals.filter((p) => p.id === proposalId && samePage(p) && d.substantive(p) && already.get(p.id) !== d.version(p))) {
            const saved = await d.load(tenantId, proposal.id);
            if (saved && samePage(saved) && saved.basis === currentBasis && d.substantive(saved) && d.acceptable(saved)) { stored = saved; success = true; break; }
          }
          reason = success ? "stored_ready_substantive_and_complete" : output.outcome === "evidence_unreadable" ? "saved_evidence_unreadable" : "no_new_ready_substantive_edit";
          return output;
        };
        const first = await produce(1);
        if (!success && destination && first && first.outcome !== "evidence_unreadable" && first.outcome !== "persistence_failed" && !first.paid.receipts.some((r) => ["provider_blocked", "cost_blocked", "retryable_blocked"].includes(r.outcome) && r.providerCalls > 0)) { const need = first.paid.evidenceOwed?.find((n) => n.kind === "semantic_review" && n.proposalId === proposalId && n.workKey?.trim() && DRAFT_BUDGET.scopeAllows("existing_page_edits", DRAFT_BUDGET.requirementDelivery(n)));
          const owing = need ? await d.load(tenantId, proposalId) : null, obligation = owing ? d.obligation(owing) : null;
          if (need && owing && samePage(owing) && owing.basis === currentBasis && owing.status === "needs_review" && (obligation?.kind === "review" || obligation?.kind === "evidence" && obligation.need.kind === "semantic_review") && d.clock() < stopBy && await d.permission(tenantId) === "paused") {
            acquisition = await runWithProposalWorkKey(need.workKey!, () => d.acquire(tenantId, need, accountBasis, Math.min(80_000, stopBy - d.clock()), undefined, "existing_page_edits")); const reviewed = acquisition.acquired && acquisition.unlocked ? await d.load(tenantId, proposalId) : null;
            if (reviewed && samePage(reviewed) && reviewed.basis === currentBasis && d.reviewAuthorized(reviewed) && await d.permission(tenantId) === "paused") {
              const promoted = await d.promote(tenantId, proposalId, d.version(reviewed), currentBasis, { kind: "promote", at: new Date(d.clock()).toISOString() }); stored = await d.load(tenantId, proposalId); success = promoted.status === "promoted" && d.acceptable(stored); reason = success ? "stored_ready_substantive_and_complete" : `promotion_${promoted.status}${promoted.refusal ? `:${promoted.refusal}` : ""}`;
            } else reason = `semantic_review_owed:${acquisition.detail}`; } }
        if (!success && first && first.outcome !== "evidence_unreadable" && first.outcome !== "persistence_failed"
          && !first.paid.receipts.some((r) => ["provider_blocked", "cost_blocked", "retryable_blocked"].includes(r.outcome) && r.providerCalls > 0)) {
          const need = first.paid.evidenceOwed?.find((n) => n.kind === "factual_source" && n.url && canonicalUrlKey(n.url) === pageKey
            && !n.topic && n.workKey?.trim() && n.proposalId && n.proposalId === n.unlocks?.proposalId
            && DRAFT_BUDGET.scopeAllows("existing_page_edits", DRAFT_BUDGET.requirementDelivery(n)));
          const owing = need ? await d.load(tenantId, need.proposalId!) : null, obligation = owing ? d.obligation(owing) : null;
          const fields = ["kind", "query", "url", "reasonCode", "missingTopic", "ownerVersion", "delivery", "topic", "finding", "proposalId", "rivalUrl", "rivalUrls"] as const;
          if (need && owing && owing.id === need.proposalId && samePage(owing) && owing.basis === currentBasis && owing.status === "needs_review"
            && owing.workKey === need.workKey && DRAFT_BUDGET.keyOf(owing) === need.key && obligation?.kind === "evidence"
            && fields.every((key) => JSON.stringify(need[key]) === JSON.stringify(obligation.need[key]))) {
            const urls = [...new Set([need.rivalUrl, ...(need.rivalUrls ?? [])].filter((u): u is string => !!u))];
            const targets = urls.slice(0, 2).map((url) => ({ capability: "onpage_content_parsing", url }));
            if (!need.missingTopic?.trim() && !need.finding?.statementKey?.trim()) { reason = "factual_source_exact_claim_missing"; return; }
            if (await d.basis(tenantId) !== accountBasis || await d.current(tenantId) !== currentBasis || need.ownerVersion && (await d.bodies(tenantId, [page])).get(pageKey)?.contentHash !== need.ownerVersion) { reason = "factual_source_owner_version_changed"; return; }
            if (d.clock() < stopBy && await d.permission(tenantId) === "paused") {
              const acquire = () => runWithProposalWorkKey(need.workKey, () => d.acquire(tenantId,
                { ...need, ...(targets[0] ? { rivalUrl: targets[0].url, rivalUrls: targets.map((t) => t.url) } : {}) }, accountBasis, Math.min(90_000, stopBy - d.clock()), undefined, "existing_page_edits"));
              const got = targets.length ? await PROOF_SPEND.withExternalTargets(tenantId, targets, acquire) : await acquire();
              acquisition = got; reason = `factual_source_owed:${got.detail}`;
              await defaultSteps.resumeAcquired(got, need.kind, (...parts) => { for (const key of shared.keys()) if (parts.some((part) => key.startsWith(`${part}:`))) shared.delete(key); }, async () => {
                reason = "source_banked_but_drafting_deferred";
                return produce(0);
              });
            }
          }
        }
        if (await d.permission(tenantId) !== "paused") { success = false; reason = "research_pause_changed_after_execution"; }
      } finally { allowance = PROOF_SPEND.meter(tenantId); }
    }, { maxExternalCalls: 3, maxExternalUsd: 0.4, allowedExternal: [page, ...(destination ? [destination] : [])].map((url) => ({ capability: "onpage_rendered_html", url })), stopBy });
  } catch { reason = "proof_execution_failed"; }
  // A crashed/ambiguous authorized call consumes admission. Only a positively observed zero-call scope releases it.
  const used = allowance as ReturnType<typeof PROOF_SPEND.meter>, noCalls = used != null && used.modelCalls === 0 && used.externalCalls === 0;
  const recorded = noCalls && !success ? await d.spend.release(admission.attemptId, true).catch(() => false)
    : await d.spend.reconcile(admission.attemptId, 0, null, "provider_reported", { success, reason, allowance, acquisition }).catch(() => false);
  return result(success, recorded ? reason : "proof_admission_receipt_missing");
}
const atomicProof = { run, finishPage };
export default atomicProof;
