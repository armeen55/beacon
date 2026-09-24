import { describe, expect, it, vi } from "vitest";
import atomicProof from "@/domains/runtime/ops/atomic-proof";
import { PROOF_SPEND } from "@/lib/spend-scope";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
const url = "https://kiln.example/studio-kilns", tenantId = "kiln", input = { tenantId, proposalId: "kiln::section", currentBasis: "basis", maxOpenAiCalls: 8, maxOpenAiUsd: 2, maxDataForSeoCalls: 3, maxDataForSeoUsd: 0.4 }, AUTH = "4B926534-2D8F-4AD8-A84B-15137B8AA007";
type Deps = NonNullable<Parameters<typeof atomicProof.finishPage>[1]>;
const template = { id: input.proposalId, tenantId, basis: "basis", pageUrl: "kiln.example/studio-kilns", primaryQuery: "studio kilns", workKey: "kiln-work", status: "needs_review", changeFamily: "answer_block", limitations: [], recommendedChange: { kind: "existing_edit", field: "section", after: "original" } } as unknown as ChangeProposal; const produced = (rows: ChangeProposal[]) => ({ proposals: rows, outcome: "proposals_persisted", paid: { receipts: [], evidenceOwed: [] }, held: [] }) as unknown as Awaited<ReturnType<typeof produceProposalsForTenant>>;
describe("one paused page proof uses canonical production without renewing its budget", () => {
  it.each(["ready", "meta_ready", "link_ready", "link_review_failed", "link_unowned", "link_capture_failed", "link_readback_failed", "link_wrong_port", "link_query", "wrong_port", "readback_wrong_url", "readback_wrong_final", "authorized", "authorized_used", "malformed_authorization", "provider_missing", "old_ready", "foreign", "wrong_site", "capture_failed", "no_wire", "ambiguous", "unqualified", "admission_used", "boxed", "unreadable", "failed_gsc", "failed_pages", "failed_snapshot", "preferred_missing", "exact_owed", "source_ready", "source_no_url", "source_unused", "source_failed", "source_mismatch", "source_foreign", "source_deadline", "source_repeat", "source_paused", "source_providerheld", "source_work_changed"])("reports %s from durable readback and keeps paid admission", async (outcome) => {
    const candidate = structuredClone(template), link = outcome.startsWith("link_"); if (outcome === "wrong_port") candidate.pageUrl = "https://kiln.example:8080/studio-kilns"; if (outcome === "meta_ready") Object.assign(candidate, { changeFamily: "meta", recommendedChange: { kind: "existing_edit", field: "meta", before: "Wrong subject", after: "Right subject" } }); if (link) Object.assign(candidate, { id: "kiln::/studio-kilns::existing_edit::internal_link@/related", changeFamily: "section", recommendedChange: { kind: "existing_edit", field: "section", after: "Visit the related kiln guide.", linkTo: outcome === "link_wrong_port" ? "https://kiln.example:8080/related" : outcome === "link_query" ? "/related?preview=1" : "/related", anchorText: "related kiln guide" } }); const ready = { ...candidate, status: "ready" } as ChangeProposal;
    const source = outcome.startsWith("source_"), noUrl = outcome === "source_no_url", rivalUrl = "https://authority.example/kilns", targetUrl = "https://kiln.example/related", callInput = { ...input, proposalId: candidate.id }; const need = { kind: "factual_source" as const, key: DRAFT_BUDGET.keyOf(candidate), query: candidate.primaryQuery, url, proposalId: candidate.id, unlocks: { proposalId: candidate.id, step: "draft" as const }, workKey: candidate.workKey!, reason: "missing comparison", reasonCode: "source_support_unconfirmed" as const, missingTopic: "kiln insulation", ...(!noUrl ? { rivalUrl, rivalUrls: [rivalUrl] } : {}), delivery: "existing_page_edit" as const };
    let paid = 0, clock = Date.now(), acquired = 0, admitted = false, reviewed = false, promoted = false; const captured = new Map<string, { url: string; finalUrl: string; version: "current"; completeness: "complete"; contentHash: string; fetchedAt: string }>(); if (source) candidate.obligation = { kind: "evidence", need: { ...need, ...(outcome === "source_mismatch" ? { missingTopic: "different claim" } : {}) } };
    const reserve = vi.fn(async (_request: { logicalKey: string }) => ({ outcome: ["admission_used", "authorized_used"].includes(outcome) || outcome === "authorized" && admitted ? "replayed" : (admitted = true, "reserved"), attemptId: "admission" }));
    const claim = vi.fn(async () => "claimed" as const), release = vi.fn(async () => true), reconcile = vi.fn(async () => true);
    const acquire = vi.fn<NonNullable<Deps["acquire"]>>(async (_t, need, basis) => {
      if (need.kind === "semantic_review") { expect([need.proposalId, need.workKey, basis]).toEqual([candidate.id, candidate.workKey, "account-basis"]); reviewed = outcome !== "link_review_failed"; return { acquired: reviewed, unlocked: reviewed, detail: reviewed ? "review banked" : "review refused" }; }
      if (need.kind === "factual_source") {
        expect([need.url, need.workKey, basis, need.rivalUrls]).toEqual([url, candidate.workKey, "account-basis", noUrl ? undefined : [rivalUrl]]);
        if (noUrl) await PROOF_SPEND.withExternalTargets(tenantId, [{ capability: "serp_organic", url: need.query }], async () => { expect(PROOF_SPEND.authorize(tenantId, "external", 0.002, { capability: "serp_organic", url: need.query })).toBe(false); expect(PROOF_SPEND.admitSearchResults(tenantId, need.query, [rivalUrl])).toBe(true); expect(PROOF_SPEND.authorize(tenantId, "external", 0.002, { capability: "onpage_content_parsing", url: rivalUrl })).toBe(false); }); else expect(PROOF_SPEND.authorize(tenantId, "external", 0.002, { capability: "onpage_content_parsing", url: rivalUrl })).toBe(false); expect(PROOF_SPEND.authorize(tenantId, "model", 0.1)).toBe(false); acquired += 1;
        if (outcome === "source_deadline") clock += 150_000;
        return { acquired: outcome !== "source_failed", ...(outcome !== "source_unused" ? { unlocked: true } : {}), detail: "source receipt" };
      }
      expect([need.kind, need.url, need.workKey, basis]).toEqual(["page_source", link && acquire.mock.calls.length === 2 ? targetUrl : url, candidate.workKey, "account-basis"]);
      if (outcome === "no_wire") return { acquired: false, attempted: false, detail: "preflight deferred" };
      expect(PROOF_SPEND.authorize(tenantId, "external", 0.002, { capability: "onpage_rendered_html", url: need.url! })).toBe(false);
      if (link) expect(PROOF_SPEND.authorize(tenantId, "external", 0.002, { capability: "onpage_rendered_html", url: "https://kiln.example/not-owned" })).toBe(true);
      if (outcome === "ambiguous") throw new Error("provider response lost");
      const success = outcome !== "capture_failed" && !(outcome === "link_capture_failed" && need.url === targetUrl); if (success && !(outcome === "link_readback_failed" && need.url === targetUrl)) captured.set(need.url!, { url: outcome === "readback_wrong_url" ? "https://kiln.example:8080/studio-kilns" : need.url!, finalUrl: outcome === "readback_wrong_final" ? "https://kiln.example/studio-kilns?preview=1" : need.url!, version: "current", completeness: "complete", contentHash: "current-hash", fetchedAt: new Date(clock).toISOString() });
      return { acquired: success, detail: "canonical capture" };
    });
    const produce = vi.fn<NonNullable<Deps["produce"]>>(async (_t, options = {}) => {
      expect([options.focusPage, options.preferred, options.deliveryScope, options.maxDrafts]).toEqual([url, { proposalId: candidate.id, workKey: candidate.workKey, strict: true }, "existing_page_edits", 1]); paid += 1;
      expect([options.maxCalls, options.aeoDiagnoses, options.persist]).toEqual([paid === 1 ? 8 : 6, paid === 1 ? 1 : 0, true]);
      if (!["preferred_missing", "exact_owed"].includes(outcome)) expect(PROOF_SPEND.authorize(tenantId, "model", 0.1)).toBe(false);
      if (source) {
        if (paid === 1) { options.shared!.set("evidence:old", true); options.shared!.set("cards:old", true); options.shared!.set("account:kept", true); }
        else expect([...options.shared!.keys()]).toEqual(["account:kept"]);
        const owes = paid === 1 || outcome === "source_repeat", out = produced([owes ? candidate : ready]);
        out.paid.evidenceOwed = owes ? [{ ...need, ...(outcome === "source_foreign" ? { url: "https://foreign.example/kilns" } : {}), ...(outcome === "source_work_changed" ? { workKey: "earlier-work" } : {}) }] : [];
        out.paid.receipts = [{ key: need.key, funded: true, family: "editor", treatment: null, impact: 1, allowance: 1, fallbacks: [], workKey: need.workKey, ops: 1, providerCalls: 1, costUsd: 0.1, ms: 0, providerAttempted: true, outcome: outcome === "source_providerheld" ? "provider_blocked" : "evidence_required", persistence: null }];
        return out;
      }
      if (link) { const out = produced([candidate]); out.paid.evidenceOwed = [{ kind: "semantic_review", key: DRAFT_BUDGET.keyOf(candidate), query: candidate.primaryQuery, url, proposalId: candidate.id, workKey: candidate.workKey!, reason: "review owed", reasonCode: "review_owed", delivery: "existing_page_edit" }]; return out; }
      if (["preferred_missing", "exact_owed"].includes(outcome)) { const out = produced([candidate]); if (outcome === "preferred_missing") out.paid.preferredRetiredReason = "missing"; else { out.paid.preferredWorkKey = candidate.workKey; out.paid.receipts = [{ key: DRAFT_BUDGET.keyOf(candidate), family: "editor", workKey: candidate.workKey!, providerCalls: 0, costUsd: 0, outcome: "evidence_required" } as typeof out.paid.receipts[number]]; out.paid.evidenceOwed = [{ kind: "serp", key: DRAFT_BUDGET.keyOf(candidate), query: "named source", proposalId: candidate.id, workKey: candidate.workKey!, reason: "private planning detail", reasonCode: "no_winner_to_read", delivery: "existing_page_edit" }]; } return out; } return produced([outcome === "foreign" ? { ...ready, id: "other::section", tenantId: "other" } : ready]);
    });
    const deps: NonNullable<Parameters<typeof atomicProof.finishPage>[1]> = {
      permission: async () => acquired && outcome === "source_paused" ? "running" : "paused", providerConfigured: () => outcome !== "provider_missing", load: async () => link ? promoted ? ready : candidate : source ? paid === 2 && ["source_ready", "source_no_url"].includes(outcome) ? ready : candidate : paid ? ["unqualified", "preferred_missing", "exact_owed"].includes(outcome) ? candidate : ready : candidate,
      snapshot: async () => {
        expect(PROOF_SPEND.activeFor(tenantId)).toBe(false); if (outcome === "boxed") clock += 150_000;
        if (outcome === "failed_snapshot") throw new Error("snapshot unavailable");
        return { sources: [{ source: outcome === "failed_pages" ? "wix" : "gsc", status: outcome.startsWith("failed_") ? "failed" : "fresh" }], ownedPages: link && outcome !== "link_unowned" ? [{ url: targetUrl }] : [] } as Awaited<ReturnType<NonNullable<Deps["snapshot"]>>>;
      },
      account: async () => ({ id: tenantId, domain: outcome === "wrong_site" ? "rival.example" : "kiln.example" }) as Awaited<ReturnType<NonNullable<Deps["account"]>>>,
      basis: async () => "account-basis", current: async () => "basis",
      list: async () => { if (outcome === "unreadable") throw new Error("store unavailable"); return new Map([[candidate.id, outcome === "old_ready" ? ready : candidate]]); },
      delivery: () => "existing_page_edit", version: (row) => JSON.stringify(row.recommendedChange), substantive: () => true, obligation: (row) => link ? { kind: "review" } : row.obligation ?? null, reviewAuthorized: () => reviewed, promote: async () => { promoted = true; return { status: "promoted" as const }; },
      acceptable: (row) => row?.status === "ready", bodies: async (_t, urls) => ["preferred_missing", "exact_owed"].includes(outcome) ? new Map([["kiln.example/studio-kilns", { url, finalUrl: url, version: "current", completeness: "complete", contentHash: "current-hash", fetchedAt: new Date(clock).toISOString() }]]) as Awaited<ReturnType<NonNullable<Deps["bodies"]>>> : new Map(urls.filter((u) => captured.has(u)).map((u) => [u.replace(/^https?:\/\//, ""), captured.get(u)!])) as Awaited<ReturnType<NonNullable<Deps["bodies"]>>>, clock: () => clock,
      acquire, produce,
      spend: { reserve, claimTransmission: claim, release, reconcile } as unknown as NonNullable<Parameters<typeof atomicProof.finishPage>[1]>["spend"],
    }; if (outcome === "meta_ready" || link) delete deps.substantive;
    const withAuth = ["authorized", "authorized_used"].includes(outcome), result = await atomicProof.finishPage({ ...callInput, ...(withAuth ? { authorizationId: AUTH } : outcome === "malformed_authorization" ? { authorizationId: "not-a-uuid" } : {}) }, deps);
    if (outcome === "authorized") { paid = 0; const replay = await atomicProof.finishPage({ ...callInput, authorizationId: AUTH }, deps); expect([replay.reason, reserve.mock.calls.length, produce.mock.calls.length]).toEqual(["proof_admission_replayed", 2, 1]); }
    if (link) { expect([result.success, acquire.mock.calls.map((c) => c[1].kind === "semantic_review" ? "review" : c[1].url), produce.mock.calls.length]).toEqual(["link_unowned", "link_wrong_port", "link_query"].includes(outcome) ? [false, [], 0] : ["link_capture_failed", "link_readback_failed"].includes(outcome) ? [false, [url, targetUrl], 0] : [outcome === "link_ready", [url, targetUrl, "review"], 1]); return; } if (source) {
      const continued = ["source_ready", "source_repeat", "source_no_url"].includes(outcome), attempted = !["source_mismatch", "source_foreign", "source_providerheld", "source_work_changed"].includes(outcome);
      expect([result.success, paid, acquired]).toEqual([["source_ready", "source_no_url"].includes(outcome), continued ? 2 : 1, attempted ? 1 : 0]);
      expect(result.allowance).toMatchObject({ externalCalls: attempted ? noUrl ? 3 : 2 : 1, modelCalls: 1 + Number(attempted) + Number(continued) });
      expect(result.meter).toEqual({ providerCalls: paid, costUsd: paid * 0.1 });
      expect(result.evidenceOwed).toHaveLength(["source_ready", "source_no_url"].includes(outcome) ? 0 : 1);
      expect(reconcile).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalled(); return;
    }
    expect(result.success).toBe(["ready", "meta_ready", "authorized"].includes(outcome)); if (["preferred_missing", "exact_owed"].includes(outcome)) expect([result.preferredRetiredReason, result.preferredOutcome, result.captured, result.allowance?.modelCalls, result.allowance?.externalCalls]).toEqual([outcome === "preferred_missing" ? "missing" : undefined, outcome === "exact_owed" ? "evidence_required" : null, true, 0, 0]);
    expect(produce).toHaveBeenCalledTimes(["wrong_site", "wrong_port", "readback_wrong_url", "readback_wrong_final", "capture_failed", "no_wire", "ambiguous", "admission_used", "authorized_used", "malformed_authorization", "provider_missing", "boxed", "unreadable"].includes(outcome) || outcome.startsWith("failed_") ? 0 : 1);
    if (["admission_used", "authorized_used", "malformed_authorization", "provider_missing", "boxed", "wrong_site", "wrong_port", "unreadable"].includes(outcome) || outcome.startsWith("failed_")) {
      expect(acquire).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
      if (["malformed_authorization", "provider_missing"].includes(outcome)) expect(reserve).not.toHaveBeenCalled();
      if (outcome === "authorized_used") expect((reserve.mock.calls[0]?.[0] as { logicalKey: string }).logicalKey).toBe(`page-proof-v3::kiln::kiln.example/studio-kilns::basis::operator:${AUTH.toLowerCase()}`);
    } else if (["no_wire", "preferred_missing", "exact_owed"].includes(outcome)) {
      expect(release).toHaveBeenCalledWith("admission", true); expect(reconcile).not.toHaveBeenCalled();
    } else {
      expect(release).not.toHaveBeenCalled(); expect(reconcile).toHaveBeenCalled();
      expect(result.allowance?.externalCalls).toBe(1);
      const key = reserve.mock.calls[0]?.[0] as { logicalKey: string } | undefined;
      expect(key?.logicalKey).toBe(`page-proof-v3::kiln::kiln.example/studio-kilns::basis${withAuth ? `::operator:${AUTH.toLowerCase()}` : ""}`);
      expect(key?.logicalKey).not.toContain(candidate.workKey);
    }
  });
});
