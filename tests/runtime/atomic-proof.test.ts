import { describe, expect, it, vi } from "vitest";
import atomicProof from "@/domains/runtime/ops/atomic-proof";
import { PROOF_SPEND } from "@/lib/spend-scope";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { produceProposalsForTenant } from "@/domains/decision/produce-proposals";

const url = "https://kiln.example/studio-kilns", tenantId = "kiln";
const input = { tenantId, proposalId: "kiln::section", currentBasis: "basis", maxOpenAiCalls: 8, maxOpenAiUsd: 2, maxDataForSeoCalls: 1, maxDataForSeoUsd: 0.4 };
type Result = Awaited<ReturnType<typeof produceProposalsForTenant>>;
type Deps = NonNullable<Parameters<typeof atomicProof.finishPage>[1]>;
const candidate = { id: input.proposalId, tenantId, basis: "basis", pageUrl: "kiln.example/studio-kilns", primaryQuery: "studio kilns", workKey: "kiln-work", status: "needs_review", changeFamily: "answer_block", recommendedChange: { kind: "existing_edit", field: "section", after: "original" } } as ChangeProposal;
const produced = (rows: ChangeProposal[]) => ({ proposals: rows, outcome: "proposals_persisted", paid: { receipts: [], evidenceOwed: [] }, held: [] }) as unknown as Result;

describe("one paused page proof uses canonical production without renewing its budget", () => {
  it.each(["ready", "old_ready", "foreign", "wrong_site", "capture_failed", "no_wire", "ambiguous", "unqualified", "admission_used", "boxed", "unreadable"])("reports %s from durable readback and keeps paid admission", async (outcome) => {
    const ready = { ...candidate, status: "ready" } as ChangeProposal;
    let paid = 0, clock = Date.now();
    const reserve = vi.fn(async (_request: { logicalKey: string }) => ({ outcome: outcome === "admission_used" ? "replayed" : "reserved", attemptId: "admission" }));
    const claim = vi.fn(async () => "claimed" as const), release = vi.fn(async () => true), reconcile = vi.fn(async () => true);
    const acquire = vi.fn<NonNullable<Deps["acquire"]>>(async (_t, need, basis) => {
      expect([need.kind, need.url, need.workKey, basis]).toEqual(["page_source", url, candidate.workKey, "account-basis"]);
      if (outcome === "no_wire") return { acquired: false, attempted: false, detail: "preflight deferred" };
      expect(PROOF_SPEND.authorize(tenantId, "external", 0.002, { capability: "onpage_rendered_html", url })).toBe(false);
      if (outcome === "ambiguous") throw new Error("provider response lost");
      return { acquired: outcome !== "capture_failed", detail: "canonical capture" };
    });
    const produce = vi.fn<NonNullable<Deps["produce"]>>(async (_t, options = {}) => {
      expect([options.focusPage, options.deliveryScope, options.maxDrafts]).toEqual([url, "existing_page_edits", 1]);
      if (options.zeroSpend) {
        expect([PROOF_SPEND.activeFor(tenantId), options.persist, options.maxCalls]).toEqual([false, false, 0]);
        if (outcome === "boxed") clock += 150_000;
        return produced([candidate]);
      }
      paid += 1;
      expect([options.maxCalls, options.aeoDiagnoses, options.persist]).toEqual([8, 1, true]);
      expect(PROOF_SPEND.authorize(tenantId, "model", 0.1)).toBe(false);
      return produced([outcome === "foreign" ? { ...ready, id: "other::section", tenantId: "other" } : ready]);
    });
    const deps: NonNullable<Parameters<typeof atomicProof.finishPage>[1]> = {
      permission: async () => "paused", load: async () => paid ? outcome === "unqualified" ? candidate : ready : candidate,
      account: async () => ({ id: tenantId, domain: outcome === "wrong_site" ? "rival.example" : "kiln.example" }) as Awaited<ReturnType<NonNullable<Deps["account"]>>>,
      basis: async () => "account-basis",
      list: async () => { if (outcome === "unreadable") throw new Error("store unavailable"); return new Map([[candidate.id, outcome === "old_ready" ? ready : candidate]]); },
      delivery: () => "existing_page_edit", version: (row) => JSON.stringify(row.recommendedChange), substantive: () => true,
      acceptable: (row) => row?.status === "ready", bodies: async () => new Map(), clock: () => clock,
      acquire, produce,
      spend: { reserve, claimTransmission: claim, release, reconcile } as unknown as NonNullable<Parameters<typeof atomicProof.finishPage>[1]>["spend"],
    };
    const result = await atomicProof.finishPage(input, deps);
    expect(result.success).toBe(outcome === "ready");
    expect(paid).toBe(["wrong_site", "capture_failed", "no_wire", "ambiguous", "admission_used", "boxed", "unreadable"].includes(outcome) ? 0 : 1);
    if (["admission_used", "boxed", "wrong_site", "unreadable"].includes(outcome)) {
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
