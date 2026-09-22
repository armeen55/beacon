import { describe, expect, it, vi } from "vitest";
import atomicProof from "@/domains/runtime/ops/atomic-proof";
import { PROOF_SPEND } from "@/lib/spend-scope";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";

const url = "https://kiln.example/studio-kilns", tenantId = "kiln";
const input = { tenantId, proposalId: "kiln::section", currentBasis: "basis", maxOpenAiCalls: 8, maxOpenAiUsd: 2, maxDataForSeoCalls: 3, maxDataForSeoUsd: 0.4 };
type Deps = NonNullable<Parameters<typeof atomicProof.finishPage>[1]>;
const template = { id: input.proposalId, tenantId, basis: "basis", pageUrl: "kiln.example/studio-kilns", primaryQuery: "studio kilns", workKey: "kiln-work", status: "needs_review", changeFamily: "answer_block", limitations: [], recommendedChange: { kind: "existing_edit", field: "section", after: "original" } } as unknown as ChangeProposal;
const produced = (rows: ChangeProposal[]) => ({ proposals: rows, outcome: "proposals_persisted", paid: { receipts: [], evidenceOwed: [] }, held: [] }) as unknown as Awaited<ReturnType<typeof produceProposalsForTenant>>;

describe("one paused page proof uses canonical production without renewing its budget", () => {
  it.each(["ready", "old_ready", "foreign", "wrong_site", "capture_failed", "no_wire", "ambiguous", "unqualified", "admission_used", "boxed", "unreadable", "failed_gsc", "failed_pages", "failed_snapshot", "source_ready", "source_unused", "source_failed", "source_mismatch", "source_foreign", "source_deadline", "source_repeat", "source_paused", "source_providerheld", "source_work_changed"])("reports %s from durable readback and keeps paid admission", async (outcome) => {
    const candidate = structuredClone(template), ready = { ...candidate, status: "ready" } as ChangeProposal;
    const source = outcome.startsWith("source_"), rivalUrl = "https://authority.example/kilns";
    const need = { kind: "factual_source" as const, key: DRAFT_BUDGET.keyOf(candidate), query: candidate.primaryQuery, url, proposalId: candidate.id, unlocks: { proposalId: candidate.id, step: "draft" as const }, workKey: candidate.workKey!, reason: "missing comparison", reasonCode: "source_support_unconfirmed" as const, missingTopic: "kiln insulation", rivalUrl, rivalUrls: [rivalUrl], delivery: "existing_page_edit" as const };
    let paid = 0, clock = Date.now(), acquired = 0;
    if (source) candidate.obligation = { kind: "evidence", need: { ...need, ...(outcome === "source_mismatch" ? { missingTopic: "different claim" } : {}) } };
    const reserve = vi.fn(async (_request: { logicalKey: string }) => ({ outcome: outcome === "admission_used" ? "replayed" : "reserved", attemptId: "admission" }));
    const claim = vi.fn(async () => "claimed" as const), release = vi.fn(async () => true), reconcile = vi.fn(async () => true);
    const acquire = vi.fn<NonNullable<Deps["acquire"]>>(async (_t, need, basis) => {
      if (need.kind === "factual_source") {
        expect([need.url, need.workKey, basis, need.rivalUrls]).toEqual([url, candidate.workKey, "account-basis", [rivalUrl]]);
        expect(PROOF_SPEND.authorize(tenantId, "external", 0.002, { capability: "onpage_content_parsing", url: rivalUrl })).toBe(false);
        expect(PROOF_SPEND.authorize(tenantId, "model", 0.1)).toBe(false); acquired += 1;
        if (outcome === "source_deadline") clock += 150_000;
        return { acquired: outcome !== "source_failed", unlocked: outcome !== "source_unused", detail: "source receipt" };
      }
      expect([need.kind, need.url, need.workKey, basis]).toEqual(["page_source", url, candidate.workKey, "account-basis"]);
      if (outcome === "no_wire") return { acquired: false, attempted: false, detail: "preflight deferred" };
      expect(PROOF_SPEND.authorize(tenantId, "external", 0.002, { capability: "onpage_rendered_html", url })).toBe(false);
      if (outcome === "ambiguous") throw new Error("provider response lost");
      return { acquired: outcome !== "capture_failed", detail: "canonical capture" };
    });
    const produce = vi.fn<NonNullable<Deps["produce"]>>(async (_t, options = {}) => {
      expect([options.focusPage, options.deliveryScope, options.maxDrafts]).toEqual([url, "existing_page_edits", 1]);
      paid += 1;
      expect([options.maxCalls, options.aeoDiagnoses, options.persist]).toEqual([paid === 1 ? 8 : 6, paid === 1 ? 1 : 0, true]);
      expect(PROOF_SPEND.authorize(tenantId, "model", 0.1)).toBe(false);
      if (source) {
        if (paid === 1) { options.shared!.set("evidence:old", true); options.shared!.set("cards:old", true); options.shared!.set("account:kept", true); }
        else expect([...options.shared!.keys()]).toEqual(["account:kept"]);
        const owes = paid === 1 || outcome === "source_repeat", out = produced([owes ? candidate : ready]);
        out.paid.evidenceOwed = owes ? [{ ...need, ...(outcome === "source_foreign" ? { url: "https://foreign.example/kilns" } : {}), ...(outcome === "source_work_changed" ? { workKey: "earlier-work" } : {}) }] : [];
        out.paid.receipts = [{ key: need.key, funded: true, family: "editor", treatment: null, impact: 1, allowance: 1, fallbacks: [], workKey: need.workKey, ops: 1, providerCalls: 1, costUsd: 0.1, ms: 0, providerAttempted: true, outcome: outcome === "source_providerheld" ? "provider_blocked" : "evidence_required", persistence: null }];
        return out;
      }
      return produced([outcome === "foreign" ? { ...ready, id: "other::section", tenantId: "other" } : ready]);
    });
    const deps: NonNullable<Parameters<typeof atomicProof.finishPage>[1]> = {
      permission: async () => acquired && outcome === "source_paused" ? "running" : "paused", load: async () => source ? paid === 2 && outcome === "source_ready" ? ready : candidate : paid ? outcome === "unqualified" ? candidate : ready : candidate,
      snapshot: async () => {
        expect(PROOF_SPEND.activeFor(tenantId)).toBe(false); if (outcome === "boxed") clock += 150_000;
        if (outcome === "failed_snapshot") throw new Error("snapshot unavailable");
        return { sources: [{ source: outcome === "failed_pages" ? "wix" : "gsc", status: outcome.startsWith("failed_") ? "failed" : "fresh" }] } as Awaited<ReturnType<NonNullable<Deps["snapshot"]>>>;
      },
      account: async () => ({ id: tenantId, domain: outcome === "wrong_site" ? "rival.example" : "kiln.example" }) as Awaited<ReturnType<NonNullable<Deps["account"]>>>,
      basis: async () => "account-basis",
      list: async () => { if (outcome === "unreadable") throw new Error("store unavailable"); return new Map([[candidate.id, outcome === "old_ready" ? ready : candidate]]); },
      delivery: () => "existing_page_edit", version: (row) => JSON.stringify(row.recommendedChange), substantive: () => true,
      acceptable: (row) => row?.status === "ready", bodies: async () => new Map(), clock: () => clock,
      acquire, produce,
      spend: { reserve, claimTransmission: claim, release, reconcile } as unknown as NonNullable<Parameters<typeof atomicProof.finishPage>[1]>["spend"],
    };
    const result = await atomicProof.finishPage(input, deps);
    if (source) {
      const continued = outcome === "source_ready" || outcome === "source_repeat", attempted = !["source_mismatch", "source_foreign", "source_providerheld", "source_work_changed"].includes(outcome);
      expect([result.success, paid, acquired]).toEqual([outcome === "source_ready", continued ? 2 : 1, attempted ? 1 : 0]);
      expect(result.allowance).toMatchObject({ externalCalls: attempted ? 2 : 1, modelCalls: 1 + Number(attempted) + Number(continued) });
      expect(result.meter).toEqual({ providerCalls: paid, costUsd: paid * 0.1 });
      expect(result.evidenceOwed).toHaveLength(outcome === "source_ready" ? 0 : 1);
      expect(reconcile).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalled(); return;
    }
    expect(result.success).toBe(outcome === "ready");
    expect(produce).toHaveBeenCalledTimes(["wrong_site", "capture_failed", "no_wire", "ambiguous", "admission_used", "boxed", "unreadable"].includes(outcome) || outcome.startsWith("failed_") ? 0 : 1);
    if (["admission_used", "boxed", "wrong_site", "unreadable"].includes(outcome) || outcome.startsWith("failed_")) {
      expect(acquire).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
    } else if (outcome === "no_wire") {
      expect(release).toHaveBeenCalledWith("admission", true); expect(reconcile).not.toHaveBeenCalled();
    } else {
      expect(release).not.toHaveBeenCalled(); expect(reconcile).toHaveBeenCalled();
      expect(result.allowance?.externalCalls).toBe(1);
      const key = reserve.mock.calls[0]?.[0] as { logicalKey: string } | undefined;
      expect(key?.logicalKey).toBe("page-proof-v3::kiln::kiln.example/studio-kilns::basis");
      expect(key?.logicalKey).not.toContain(candidate.workKey);
    }
  });
});
