import "server-only";
import { EDITOR_SHARED, reviewFinishedCopy, writerKindOf } from "@/domains/decision/drafted-copy"; import { REVIEW_CONTRACT, reviewFits, unreviewed } from "@/domains/decision/proof"; import { COPY_RULES } from "@/domains/decision/copy-sanitize";
import { PROMPT_REGISTRY } from "@/domains/decision/llm/prompt-registry"; import { confirmedVersion, deliverableGaps } from "@/domains/decision/completeness"; import { DRAFT_BUDGET } from "@/domains/decision/draft-budget"; import { nextObligation } from "@/domains/decision/obligation"; import { answerReviewedProposal, saveChangeProposal, loadChangeProposal, loadChangeProposals, preflightReviewedProposal } from "@/domains/decision/proposal-store";
import type { ChangeProposal } from "@/domains/decision/contracts"; import { PROOF_SPEND, runWithoutSpending } from "@/lib/spend-scope"; import { researchPermission } from "./due-work";
import spendReservations, { runWithProposalWorkKey } from "@/lib/cost/spend-reservations";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { resolveCurrentBasis } from "@/domains/decision/load-proposals";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { COMPETITIVE_PATTERN } from "@/domains/evidence/competitive-pattern";
import { isCurrent } from "@/domains/evidence/freshness"; import { isNoiseDomain } from "@/domains/evidence/relevance-gate";
import { defaultSteps } from "./research-steps"; import { runResearchCycle } from "./on-visit-refresh";
import { getTenant } from "@/domains/account";
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
const PAGE_DEPS = { ...DEPS, produce: produceProposalsForTenant, acquire: defaultSteps.acquireEvidence, list: loadChangeProposals, snapshot: loadEvidenceSnapshot,
  bodies: (...args: Parameters<typeof loadOwnedPageBodies>) => loadOwnedPageBodies(...args), account: getTenant, basis: defaultSteps.currentBasis, current: resolveCurrentBasis, clock: Date.now,
  substantive: (row: ChangeProposal) => DRAFT_BUDGET.deliveryOf(row) === "existing_page_edit" && writerKindOf(row) !== null };
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
  if (!tenantId || !currentBasis || !proposalId.startsWith(`${tenantId}::`) || !Number.isInteger(input.maxOpenAiCalls) || input.maxOpenAiCalls < 1 || input.maxOpenAiCalls > 8 || !Number.isFinite(input.maxOpenAiUsd) || input.maxOpenAiUsd <= 0 || input.maxOpenAiUsd > 2
    || !Number.isInteger(input.maxDataForSeoCalls) || input.maxDataForSeoCalls < 1 || input.maxDataForSeoCalls > 3 || !Number.isFinite(input.maxDataForSeoUsd) || input.maxDataForSeoUsd <= 0 || input.maxDataForSeoUsd > 0.4
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
    await PROOF_SPEND.run(tenantId, input.maxOpenAiCalls, input.maxOpenAiUsd, async () => {
      try {
        if (await d.permission(tenantId) !== "paused") { reason = "research_pause_changed_before_capture"; return; }
        const pages = destination ? [page, destination] : [page], bodies = await d.bodies(tenantId, pages), qualified = (body: OwnedPageBody | null | undefined, url: string) => !!body?.finalUrl && sameDocument(body.url, url) && sameDocument(body.finalUrl, url) && body.version === "current" && body.completeness === "complete" && !!body.contentHash && isCurrent("owned_page", body.fetchedAt, d.clock());
        for (const url of pages) { if (qualified(bodies.get(canonicalUrlKey(url)), url)) continue;
          const acquired = await runWithProposalWorkKey(row.workKey, () => d.acquire(tenantId, { kind: "page_source", url, query: row.primaryQuery, reasonCode: "owned_page_capture_unqualified", workKey: row.workKey! }, accountBasis, Math.min(75_000, Math.max(0, stopBy - d.clock())), undefined, "existing_page_edits")); const readback = acquired.acquired ? (await d.bodies(tenantId, [url])).get(canonicalUrlKey(url)) : null;
          if (!qualified(readback, url)) { reason = `owned_capture_owed:${acquired.detail}`; return; } }
        captured = true; if (d.clock() >= stopBy || await d.permission(tenantId) !== "paused") { reason = "captured_but_drafting_deferred"; return; }
        const produce = async (aeoDiagnoses: number, preferredWorkKey = row.workKey!) => {
          if (d.clock() >= stopBy || await d.permission(tenantId) !== "paused") return;
          output = await d.produce(tenantId, { ...base, preferred: { ...base.preferred, workKey: preferredWorkKey }, shared, persist: true, maxCalls: Math.max(0, input.maxOpenAiCalls - (PROOF_SPEND.meter(tenantId)?.modelCalls ?? input.maxOpenAiCalls)), aeoDiagnoses });
          receipts.push(...output.paid.receipts);
          if (output.persisted > 0) for (const key of shared.keys()) if (key.startsWith("proposals:") || key.startsWith("cards:")) shared.delete(key);
          for (const proposal of output.proposals.filter((p) => p.id === proposalId && samePage(p) && d.substantive(p) && already.get(p.id) !== d.version(p))) {
            const saved = await d.load(tenantId, proposal.id);
            if (saved && samePage(saved) && saved.basis === currentBasis && d.substantive(saved) && d.acceptable(saved)) { stored = saved; success = true; break; }
          }
          reason = success ? "stored_ready_substantive_and_complete" : output.outcome === "evidence_unreadable" ? "saved_evidence_unreadable" : "no_new_ready_substantive_edit";
          return output;
        };
        const eligibleEvidence = (need: NonNullable<Awaited<ReturnType<typeof d.produce>>["paid"]["evidenceOwed"]>[number]) => need.unlocks?.proposalId === proposalId && (!need.proposalId || need.proposalId === proposalId) && !!need.workKey?.trim() && !!need.query?.trim() && DRAFT_BUDGET.scopeAllows("existing_page_edits", DRAFT_BUDGET.requirementDelivery(need)) && (need.kind === "factual_source" ? !!need.url && canonicalUrlKey(need.url) === pageKey && !need.topic : need.kind === "serp" ? !need.url : need.kind === "competitor_page" && (!need.url || /^https?:\/\//i.test(need.url) && !sameDocument(need.url, page))); const exactSerp = async (query: string) => (await runWithoutSpending(() => d.snapshot(tenantId)).catch(() => null))?.research?.serpEvidence?.find(s => s.query.trim().toLowerCase() === query.trim().toLowerCase() && isCurrent("serp_hot", s.observedAt, d.clock()) && s.organic.length > 0);
        const acquireExact = async (need: NonNullable<Awaited<ReturnType<typeof d.produce>>["paid"]["evidenceOwed"]>[number]): Promise<Awaited<ReturnType<typeof d.produce>> | null | undefined> => {
          reason = `${need.kind}_exact_obligation_changed`;
          if (!eligibleEvidence(need)) return null;
          const owing = need ? await d.load(tenantId, proposalId) : null, obligation = owing ? d.obligation(owing) : null;
          const fields = ["kind", "query", "url", "reasonCode", "missingTopic", "ownerVersion", "topic", "finding", "rivalUrl", "rivalUrls"] as const;
          if (need && owing && owing.id === proposalId && samePage(owing) && owing.basis === currentBasis && owing.status === "needs_review"
            && owing.workKey === need.workKey && DRAFT_BUDGET.keyOf(owing) === need.key && obligation?.kind === "evidence"
            && fields.every((key) => JSON.stringify(need[key]) === JSON.stringify(obligation.need[key]))) {
            const urls = [...new Set([need.rivalUrl, ...(need.rivalUrls ?? [])].filter((u): u is string => !!u))]; let selectedUrl = need.url;
            if (need.kind === "factual_source" && !need.missingTopic?.trim() && !need.finding?.statementKey?.trim()) { reason = "factual_source_exact_claim_missing"; return null; }
            if (await d.basis(tenantId) !== accountBasis || await d.current(tenantId) !== currentBasis || need.ownerVersion && (await d.bodies(tenantId, [page])).get(pageKey)?.contentHash !== need.ownerVersion) { reason = "factual_source_owner_version_changed"; return null; }
            if (d.clock() < stopBy && await d.permission(tenantId) === "paused") {
              if (need.kind === "competitor_page") { const search = { kind: "serp" as const, query: need.query, reasonCode: "no_exact_serp", workKey: need.workKey, proposalId }, bank = await runWithoutSpending(() => runWithProposalWorkKey(need.workKey, () => d.acquire(tenantId, search, accountBasis, 0, undefined, "existing_page_edits"))); if (!bank.acquired) { if (bank.posted) { acquisition = bank; reason = `serp_posted:${bank.detail}`; return null; } const left = PROOF_SPEND.meter(tenantId); if (!left || left.externalCalls > 1 || left.externalReservedUsd >= input.maxDataForSeoUsd) { reason = "proof_external_allowance_unavailable"; return null; } const found = await PROOF_SPEND.withExternalTargets(tenantId, [{ capability: "serp_organic", url: need.query }], () => runWithProposalWorkKey(need.workKey, () => d.acquire(tenantId, search, accountBasis, Math.min(60_000, stopBy - d.clock()), undefined, "existing_page_edits"))); acquisition = found; if (!found.acquired) { reason = `serp_${found.posted ? "posted" : "owed"}:${found.detail}`; return null; } } const fresh = await runWithoutSpending(() => d.snapshot(tenantId)).catch(() => null), current = fresh?.research?.serpEvidence?.find((s) => s.query.trim().toLowerCase() === need.query.trim().toLowerCase() && isCurrent("serp_hot", s.observedAt, d.clock())); const winner = [...(current?.organic ?? [])].sort((a, b) => a.rank - b.rank).find((o) => { try { const u = new URL(o.url); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && COMPETITIVE_PATTERN.publisherIdentity(o.url) !== COMPETITIVE_PATTERN.publisherIdentity(page) && !isNoiseDomain(o.url); } catch { return false; } }); if (!winner || await d.basis(tenantId) !== accountBasis || await d.current(tenantId) !== currentBasis) { reason = "competitor_page_not_in_current_exact_serp"; return null; } if (need.url && canonicalUrlKey(need.url) !== canonicalUrlKey(winner.url)) { reason = "pinned_winner_no_longer_first_eligible"; return null; } const held = fresh?.research?.winningPages?.find(w => canonicalUrlKey(w.url) === canonicalUrlKey(winner.url)); if (held && COMPETITIVE_PATTERN.sourceComplete(held.extract) && isCurrent("winner_extract", held.extract?.fetchedAt, d.clock())) { for (const key of shared.keys()) if (/^(evidence|proposals|cards):/.test(key)) shared.delete(key); return produce(0, need.workKey); } if (!COMPETITIVE_PATTERN.readDue(held ?? {}, d.clock())) { reason = "competitor_page_primary_winner_held"; return null; } selectedUrl = winner.url; }
              const targets = need.kind === "serp" ? [{ capability: "serp_organic", url: need.query }] : need.kind === "competitor_page" ? [{ capability: "onpage_content_parsing", url: selectedUrl! }] : urls.slice(0, 2).map((url) => ({ capability: "onpage_content_parsing", url }));
              if (need.kind !== "factual_source") { const banked = await runWithoutSpending(() => runWithProposalWorkKey(need.workKey, () => d.acquire(tenantId, { ...need, ...(need.kind === "competitor_page" ? { url: selectedUrl } : {}) }, accountBasis, 0, undefined, "existing_page_edits"))); if (banked.acquired || banked.posted || banked.unlocked === false) { acquisition = banked; reason = `${need.kind}_owed:${banked.detail}`; if (need.kind === "serp" && banked.acquired && !await exactSerp(need.query)) { reason = "serp_current_exact_readback_missing"; return null; } return defaultSteps.resumeAcquired(banked, need.kind, (...parts) => { for (const key of shared.keys()) if (parts.some((part) => key.startsWith(`${part}:`))) shared.delete(key); }, () => produce(0, need.workKey)); } const meter = PROOF_SPEND.meter(tenantId); if (!meter || meter.externalCalls >= input.maxDataForSeoCalls || meter.externalReservedUsd >= input.maxDataForSeoUsd) { reason = "proof_external_allowance_unavailable"; return null; } }
              const acquire = () => runWithProposalWorkKey(need.workKey, () => d.acquire(tenantId,
                { ...need, ...(need.kind === "competitor_page" ? { url: selectedUrl } : need.kind === "factual_source" && targets[0] ? { rivalUrl: targets[0].url, rivalUrls: targets.map((t) => t.url) } : {}) }, accountBasis, Math.min(90_000, stopBy - d.clock()), undefined, "existing_page_edits"));
              const got = targets.length ? await PROOF_SPEND.withExternalTargets(tenantId, targets, acquire) : await acquire();
              acquisition = got; reason = `${need.kind}_owed:${got.detail}`;
              if (need.kind === "serp" && got.acquired && !await exactSerp(need.query)) { reason = "serp_current_exact_readback_missing"; return null; }
              return defaultSteps.resumeAcquired(got, need.kind, (...parts) => { for (const key of shared.keys()) if (parts.some((part) => key.startsWith(`${part}:`))) shared.delete(key); }, async () => {
                reason = "source_banked_but_drafting_deferred";
                return produce(0, need.workKey);
              });
            }
          }
          return null;
        };
        const obligation = d.obligation(row), pending = obligation?.kind === "evidence" && ["factual_source", "serp", "competitor_page"].includes(obligation.need.kind) ? { ...obligation.need, key: DRAFT_BUDGET.keyOf(row), workKey: row.workKey!, proposalId: row.id, unlocks: obligation.need.unlocks ?? { proposalId: row.id, step: "review" as const }, reason: obligation.need.reasonCode } : null;
        const first = pending ? await acquireExact(pending) : await produce(1); if (pending && !first) return;
        const canFollow = (out: typeof first) => !!out && out.outcome !== "evidence_unreadable" && out.outcome !== "persistence_failed" && !out.paid.receipts.some(r => ["provider_blocked", "cost_blocked", "retryable_blocked"].includes(r.outcome) && r.providerCalls > 0); if (!success && canFollow(first)) { const need = first!.paid.evidenceOwed?.find(n => eligibleEvidence(n) && (!pending || pending.kind !== n.kind) && (n.kind === "factual_source" || !first!.paid.receipts.some(r => r.outcome === "evidence_required" && r.providerCalls > 0))); const second = need ? await acquireExact(need) : null;
          if (!success && need?.kind === "serp" && canFollow(second)) { const winner = second!.paid.evidenceOwed?.find(n => n.kind === "competitor_page" && eligibleEvidence(n)); if (winner) await acquireExact(winner); } }
        if (!success && canFollow(output)) { const need = output!.paid.evidenceOwed?.find((n) => n.kind === "semantic_review" && n.proposalId === proposalId && n.workKey?.trim() && DRAFT_BUDGET.scopeAllows("existing_page_edits", DRAFT_BUDGET.requirementDelivery(n)));
          const owing = need ? await d.load(tenantId, proposalId) : null, obligation = owing ? d.obligation(owing) : null, emitted = output!.proposals.find(p => p.id === proposalId) ?? row, stableOwner = (p: ChangeProposal) => COPY_RULES.recordKey({ ...p, rankingReceipt: undefined, whyRankedAboveNext: undefined, impactScore: undefined, impactAttribution: undefined, demandImpressions90d: undefined });
          if (need && owing?.id === proposalId && stableOwner(owing) === stableOwner(emitted) && owing.researchOnly !== true && DRAFT_BUDGET.keyOf(owing) === need.key && samePage(owing) && owing.basis === currentBasis && owing.status === "needs_review" && (obligation?.kind === "review" || obligation?.kind === "evidence" && obligation.need.kind === "semantic_review") && d.clock() < stopBy && await d.permission(tenantId) === "paused") {
            acquisition = await runWithProposalWorkKey(need.workKey!, () => d.acquire(tenantId, need, accountBasis, Math.min(80_000, stopBy - d.clock()), undefined, "existing_page_edits")); const reviewed = acquisition.acquired && acquisition.unlocked ? await d.load(tenantId, proposalId) : null;
            if (reviewed && samePage(reviewed) && reviewed.basis === currentBasis && d.reviewAuthorized(reviewed) && await d.permission(tenantId) === "paused") {
              const promoted = await d.promote(tenantId, proposalId, d.version(reviewed), currentBasis, { kind: "promote", at: new Date(d.clock()).toISOString() }); stored = await d.load(tenantId, proposalId); success = promoted.status === "promoted" && d.acceptable(stored); reason = success ? "stored_ready_substantive_and_complete" : `promotion_${promoted.status}${promoted.refusal ? `:${promoted.refusal}` : ""}`;
            } else reason = `semantic_review_owed:${acquisition.detail}`; } }
        if (await d.permission(tenantId) !== "paused") { success = false; reason = "research_pause_changed_after_execution"; }
      } finally { allowance = PROOF_SPEND.meter(tenantId); }
    }, { maxExternalCalls: input.maxDataForSeoCalls, maxExternalUsd: input.maxDataForSeoUsd, allowedExternal: [page, ...(destination ? [destination] : [])].map((url) => ({ capability: "onpage_rendered_html", url })), stopBy });
  } catch { reason = "proof_execution_failed"; }
  // A crashed/ambiguous authorized call consumes admission. Only a positively observed zero-call scope releases it.
  const used = allowance as ReturnType<typeof PROOF_SPEND.meter>, noCalls = used != null && used.modelCalls === 0 && used.externalCalls === 0;
  const recorded = noCalls && !success ? await d.spend.release(admission.attemptId, true).catch(() => false)
    : await d.spend.reconcile(admission.attemptId, 0, null, "provider_reported", { success, reason, allowance, acquisition }).catch(() => false);
  return result(success, recorded ? reason : "proof_admission_receipt_missing");
}
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

const atomicProof = { run, finishPage, currentMetaSuccessor, prepareNext: (input: { tenantId: string; currentBasis: string | null; eligible: (p: ChangeProposal) => boolean; limitToOneDollar?: true; maxTotalUsd?: number }) => runResearchCycle(input.tenantId, { manualDelivery: { currentBasis: input.currentBasis, eligible: input.eligible, ...(input.limitToOneDollar === true ? { limitToOneDollar: true as const } : {}), ...(input.maxTotalUsd !== undefined ? { maxTotalUsd: input.maxTotalUsd } : {}) } }) };
export default atomicProof;
