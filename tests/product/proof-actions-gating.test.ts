/**
 * GSC Proof ledger — server-action gating.
 *
 * Measurement mutations are ACCOUNT-OWNER-ONLY (2026-07-23 account-isolation
 * contraction): the record / recompute actions must never run their heavy GSC
 * reads or writes unless the authenticated user owns the current account. No
 * environment flag can grant this. Mocks the server-only deps so this is a
 * fast behavioral test of the gate.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { ownerFlag, mocks } = vi.hoisted(() => ({
  ownerFlag: { value: true },
  mocks: {
    captureChangeMeta: vi.fn(),
    recordShippedChange: vi.fn(),
    measureRecord: vi.fn(),
    loadShippedChanges: vi.fn(),
    upsertShippedChange: vi.fn(),
    loadPageSurgeonContext: vi.fn(),
    topPagesByDemand: vi.fn(),
    loadChangeProposal: vi.fn(),
    markProposalApplied: vi.fn(),
    resolveCurrentBasis: vi.fn(),
  },
}));

vi.mock("@/lib/auth/can-publish", () => ({
  isAccountOwner: async () => ownerFlag.value,
  canPublishForCurrentTenant: async () => ownerFlag.value,
}));
vi.mock("@/domains/decision", () => ({
  loadPageSurgeonContext: mocks.loadPageSurgeonContext, topPagesByDemand: mocks.topPagesByDemand,
  loadChangeProposal: mocks.loadChangeProposal, markProposalApplied: mocks.markProposalApplied,
  resolveCurrentBasis: mocks.resolveCurrentBasis,
  editLifecycleStatus: () => "accepted", markRecommendedEditsAsShipped: async () => ({ flipped: 0, skipped: 0 }),
}));
vi.mock("@/lib/persistence/repositories", () => ({ getRepository: () => ({ forTenant: () => ({}) }) }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => {} }));
// The presentation-only operator flag must be POWERLESS here: force it on to
// prove it cannot authorize a mutation for a non-owner.
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: () => true }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-test") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: mocks.loadPageSurgeonContext, topPagesByDemand: mocks.topPagesByDemand,
}));
vi.mock("@/domains/measurement/proof-gsc/measure-pass", () => ({
  captureChangeMeta: mocks.captureChangeMeta, recordShippedChange: mocks.recordShippedChange, measureRecord: mocks.measureRecord,
  // audit-4: actions.ts now defaults shipDate to the Pacific calendar day.
  defaultPacificShipDate: () => "2026-06-22",
}));
vi.mock("@/domains/measurement/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: mocks.loadShippedChanges, upsertShippedChange: mocks.upsertShippedChange,
}));

import { recordShippedChangeAction, recomputeProofLedgerAction } from "@/app/(shell)/results/actions";
import { markProposalImplementedAction } from "@/app/(shell)/changes/actions";

const BASIS = "basis_today::d6";
const PROPOSAL_ID = "tenant-test::/nowruz-guide::existing_edit::bundle";
/** The change the operator is confirming: a two-component bundle on a page Beacon holds. */
const proposal = (over: Record<string, unknown> = {}) => ({
  id: PROPOSAL_ID, tenantId: "tenant-test", kind: "existing_edit", pagePath: "/nowruz-guide",
  pageUrl: "https://x.test/nowruz-guide", pageLabel: "Nowruz guide", primaryQuery: "nowruz traditions",
  opportunityType: "Capture clicks", changeFamily: "title", status: "proposed", basis: BASIS, publish: "manual",
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" },
  whyItMatters: "The line Google shows misses the words people search for.",
  bundle: { objective: "Say what the searcher asked for in the line Google shows.",
    scope: { queries: ["nowruz traditions"], prompts: [] },
    // One component graded dangerous on an ORDINARY kind: the grade is the only thing that says so.
    components: [{ kind: "title", label: "Page title", after: null, risk: "dangerous" }, { kind: "opening_answer", label: "Opening answer", risk: "safe" }] },
  ...over,
});

beforeEach(() => {
  ownerFlag.value = true;
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.captureChangeMeta.mockResolvedValue({
    canonPage: "https://x.test/cities", path: "/cities", before: "old", after: "new", targetQueries: ["cities in iran"],
    headlineAction: "title", contentHash: "hash-before",
  });
  mocks.recordShippedChange.mockResolvedValue({ id: "/cities::2026-06-19", verdict: "measuring" });
  mocks.upsertShippedChange.mockResolvedValue(undefined);
  mocks.loadShippedChanges.mockResolvedValue([]);
  mocks.loadPageSurgeonContext.mockResolvedValue({});
  mocks.topPagesByDemand.mockReturnValue(["https://x.test/a", "https://x.test/b", "https://x.test/c"]);
  mocks.resolveCurrentBasis.mockResolvedValue(BASIS);
  mocks.loadChangeProposal.mockResolvedValue(proposal());
  mocks.markProposalApplied.mockResolvedValue(true);
});

describe("recordShippedChangeAction — account-owner gating", () => {
  it("non-owner ⇒ refused even with the operator env flag on, no record written", async () => {
    ownerFlag.value = false;
    const res = await recordShippedChangeAction({ pageUrl: "https://x.test/cities" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/owner/i);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
    expect(mocks.upsertShippedChange).not.toHaveBeenCalled();
  });

  it("account owner ⇒ captures baseline + persists the record", async () => {
    const res = await recordShippedChangeAction({ pageUrl: "https://x.test/cities" });
    expect(res.success).toBe(true);
    expect(mocks.recordShippedChange).toHaveBeenCalledOnce();
    expect(mocks.upsertShippedChange).toHaveBeenCalledOnce();
  });

  it("missing page ⇒ refused", async () => {
    const res = await recordShippedChangeAction({ pageUrl: "" });
    expect(res.success).toBe(false);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
  });

  it("ANY page ⇒ still records, controls derived from top-demand pages", async () => {
    const res = await recordShippedChangeAction({ pageUrl: "/cities" });
    expect(res.success).toBe(true);
    expect(mocks.topPagesByDemand).toHaveBeenCalled(); // fallback control selection fired
    expect(mocks.recordShippedChange).toHaveBeenCalledOnce();
    const arg = mocks.recordShippedChange.mock.calls[0][0];
    expect(arg.controlPages.length).toBeGreaterThan(0);
  });

  it("passes explicit change fields through to recordShippedChange", async () => {
    const res = await recordShippedChangeAction({
      pageUrl: "/cities", changeType: "edit_meta", before: "old meta", after: "new meta", shippedAt: "2026-06-20",
      notes: "manual wix edit", targetQueries: "cities in iran\nlargest cities in iran, cities of iran",
      verifiedLive: true, liveSourceUrl: "https://www.fixture-content.example/cities",
    });
    expect(res.success).toBe(true);
    const arg = mocks.recordShippedChange.mock.calls[0][0];
    expect(arg.actionType).toBe("edit_meta");
    expect(arg.before).toBe("old meta");
    expect(arg.after).toBe("new meta");
    expect(arg.notes).toBe("manual wix edit");
    expect(arg.verifiedLive).toBe(true);
    expect(arg.liveSourceUrl).toBe("https://www.fixture-content.example/cities");
    expect(arg.targetQueries).toEqual(["cities in iran", "largest cities in iran", "cities of iran"]);
  });

  it("real edit with no before/after (and no pack copy) ⇒ refused", async () => {
    mocks.captureChangeMeta.mockResolvedValue({
      canonPage: "https://x.test/cities", path: "/cities", before: null, after: null, targetQueries: [], headlineAction: null,
    });
    const res = await recordShippedChangeAction({ pageUrl: "/cities", changeType: "edit_title" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/before and after/i);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
  });

  it("keep_current with no before/after ⇒ still records (monitor decision)", async () => {
    mocks.captureChangeMeta.mockResolvedValue({
      canonPage: "https://x.test/cities", path: "/cities", before: null, after: null, targetQueries: [], headlineAction: null,
    });
    const res = await recordShippedChangeAction({ pageUrl: "/cities", changeType: "keep_current" });
    expect(res.success).toBe(true);
    expect(mocks.recordShippedChange).toHaveBeenCalledOnce();
  });

  it("duplicate page + ship date ⇒ refused, nothing overwritten", async () => {
    mocks.loadShippedChanges.mockResolvedValue([{ path: "/cities", actionType: "meta", shippedAt: "2026-06-20T08:00:00.000Z" }]);
    const res = await recordShippedChangeAction({ pageUrl: "/cities", shippedAt: "2026-06-20" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already recorded/i);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
  });

  it("fewer than 2 control pages ⇒ refused, nothing recorded", async () => {
    mocks.topPagesByDemand.mockReturnValue(["https://x.test/a"]); // only 1 candidate
    const res = await recordShippedChangeAction({ pageUrl: "/cities" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not enough comparable/i);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
  });
});

describe("recomputeProofLedgerAction — account-owner gating", () => {
  it("non-owner ⇒ refused, nothing recomputed", async () => {
    ownerFlag.value = false;
    const res = await recomputeProofLedgerAction();
    expect(res.success).toBe(false);
    expect(mocks.loadShippedChanges).not.toHaveBeenCalled();
  });
});

/** THE SHIPMENT TRANSACTION (Phase 6). "Mark implemented" used to flip a status and nothing
 *  else, so a change the operator really made left no record of what was applied or where the
 *  page stood beforehand. The press now writes a Shipment FIRST and flips SECOND: a crash
 *  between them leaves a Shipment nobody flipped, which the next press heals, whereas the
 *  reverse leaves a change marked done that nothing measures. Store idempotency: tests/results. */
describe("markProposalImplementedAction — the shipment transaction", () => {
  it("writes the shipment BEFORE it flips the change", async () => {
    expect((await markProposalImplementedAction({ proposalId: PROPOSAL_ID })).success).toBe(true);
    expect(mocks.recordShippedChange).toHaveBeenCalledOnce();
    expect(mocks.markProposalApplied).toHaveBeenCalledOnce();
    expect(mocks.upsertShippedChange.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.markProposalApplied.mock.invocationCallOrder[0]);
    const { shipment } = mocks.recordShippedChange.mock.calls[0][0];
    expect(shipment.proposalId).toBe(PROPOSAL_ID);
    expect(shipment.basis).toBe(BASIS);
    expect(shipment.implementedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(shipment.bundleHypothesis).toMatch(/line Google shows/);
    expect(shipment.preChangeContentHash).toBe("hash-before");
    expect(shipment.componentsApplied.map((c: { kind: string }) => c.kind)).toEqual(["title", "opening_answer"]);
  });

  it("a shipment that does not land leaves the change unflipped", async () => {
    mocks.upsertShippedChange.mockRejectedValue(new Error("durable write refused"));
    const res = await markProposalImplementedAction({ proposalId: PROPOSAL_ID });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/couldn't start measuring/i);
    expect(mocks.markProposalApplied).not.toHaveBeenCalled();
  });

  it("a second press on the same change does NOTHING: the record I already hold stands", async () => {
    await markProposalImplementedAction({ proposalId: PROPOSAL_ID });
    const version = mocks.recordShippedChange.mock.calls[0][0].shipment.proposalVersion;
    // The change is now on file, checked, with its own ship date and starting numbers.
    mocks.loadShippedChanges.mockResolvedValue([{
      id: "shp_1", proposalId: PROPOSAL_ID, proposalVersion: version, shippedAt: "2026-06-19T00:00:00.000Z",
      baseline: { clicks: 9 }, verification: { status: "verified", checkedAt: "2026-06-20T00:00:00.000Z", components: [] },
    }]);
    mocks.loadChangeProposal.mockResolvedValue(proposal({ status: "applied" })); // the flip already happened
    mocks.recordShippedChange.mockClear();
    mocks.upsertShippedChange.mockClear();
    // Success, because the change really is recorded as done. And nothing is rebuilt: rebuilding it erased
    // the live check back to null, moved the ship date to today, and recomputed the displayed starting
    // numbers over a window that included the days AFTER the change.
    expect((await markProposalImplementedAction({ proposalId: PROPOSAL_ID })).success).toBe(true);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
    expect(mocks.upsertShippedChange).not.toHaveBeenCalled();
  });

  it("a genuinely new version of the copy is a new Shipment, and leaves the old one alone", async () => {
    await markProposalImplementedAction({ proposalId: PROPOSAL_ID });
    mocks.loadShippedChanges.mockResolvedValue([{ id: "shp_1", proposalId: PROPOSAL_ID, proposalVersion: "an-older-version" }]);
    mocks.recordShippedChange.mockClear();
    expect((await markProposalImplementedAction({ proposalId: PROPOSAL_ID })).success).toBe(true);
    expect(mocks.recordShippedChange).toHaveBeenCalledOnce();
  });

  it("records only the components the operator says they applied, with the risk grade each carried", async () => {
    expect((await markProposalImplementedAction({ proposalId: PROPOSAL_ID, componentKinds: ["title"] })).success).toBe(true);
    // The grade travels because measurement owes a dangerous change a fourth checkpoint, and the
    // component's kind alone never says it is dangerous.
    expect(mocks.recordShippedChange.mock.calls[0][0].shipment.componentsApplied)
      .toEqual([{ kind: "title", label: "Page title", after: null, risk: "dangerous" }]);
  });

  it("carries the operator's own confirmation through, so an override is expressible and never a default", async () => {
    await markProposalImplementedAction({ proposalId: PROPOSAL_ID, operatorConfirmed: true, overrideReason: "I pasted it in myself." });
    const { shipment } = mocks.recordShippedChange.mock.calls[0][0];
    expect([shipment.operatorConfirmed, shipment.operatorOverrideReason]).toEqual([true, "I pasted it in myself."]);
    mocks.recordShippedChange.mockClear();
    await markProposalImplementedAction({ proposalId: PROPOSAL_ID });
    expect(mocks.recordShippedChange.mock.calls[0][0].shipment.operatorConfirmed).toBeUndefined();
  });

  it.each([
    ["a change I set aside", () => mocks.resolveCurrentBasis.mockResolvedValue("basis_today::d9")],
    ["a change I cannot find", () => mocks.loadChangeProposal.mockResolvedValue(null)],
    ["a press by someone who may not publish", () => { ownerFlag.value = false; }],
  ])("%s is refused before anything is written", async (_name, arrange) => {
    arrange();
    expect((await markProposalImplementedAction({ proposalId: PROPOSAL_ID })).success).toBe(false);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
    expect(mocks.markProposalApplied).not.toHaveBeenCalled();
  });
});
