/**
 * GSC Proof ledger — server-action gating (Phase 5, Path B).
 *
 * The record / recompute actions are OPERATOR-ONLY and must never run their
 * heavy GSC reads or writes for a non-operator. Mocks the server-only deps so
 * this is a fast behavioral test of the gate.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { operatorFlag, mocks } = vi.hoisted(() => ({
  operatorFlag: { value: true },
  mocks: {
    loadProofPlan: vi.fn(),
    captureChangeMeta: vi.fn(),
    recordShippedChange: vi.fn(),
    measureRecord: vi.fn(),
    loadShippedChanges: vi.fn(),
    upsertShippedChange: vi.fn(),
    loadPageSurgeonContext: vi.fn(),
    topPagesByDemand: vi.fn(),
  },
}));

vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: () => operatorFlag.value }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-test") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/domains/recommendation-intelligence/page-surgeon/bridge", () => ({
  loadProofPlan: mocks.loadProofPlan,
}));
vi.mock("@/domains/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: mocks.loadPageSurgeonContext,
  topPagesByDemand: mocks.topPagesByDemand,
}));
vi.mock("@/domains/proof-gsc/run-measurement", () => ({
  captureChangeMeta: mocks.captureChangeMeta,
  recordShippedChange: mocks.recordShippedChange,
  measureRecord: mocks.measureRecord,
}));
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: mocks.loadShippedChanges,
  upsertShippedChange: mocks.upsertShippedChange,
}));

import { recordShippedChangeAction, recomputeProofLedgerAction } from "./actions";

beforeEach(() => {
  operatorFlag.value = true;
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.loadProofPlan.mockResolvedValue([
    { pageUrl: "https://x.test/cities", controlPaths: ["/a", "/b"], headlineAction: "title" },
  ]);
  mocks.captureChangeMeta.mockResolvedValue({
    canonPage: "https://x.test/cities",
    path: "/cities",
    before: "old",
    after: "new",
    targetQueries: ["cities in iran"],
    headlineAction: "title",
  });
  mocks.recordShippedChange.mockResolvedValue({ id: "/cities::2026-06-19", verdict: "measuring" });
  mocks.upsertShippedChange.mockResolvedValue(undefined);
  mocks.loadShippedChanges.mockResolvedValue([]);
  mocks.loadPageSurgeonContext.mockResolvedValue({});
  mocks.topPagesByDemand.mockReturnValue([
    "https://x.test/a",
    "https://x.test/b",
    "https://x.test/c",
  ]);
});

describe("recordShippedChangeAction — operator gating", () => {
  it("non-operator ⇒ refused, no record written", async () => {
    operatorFlag.value = false;
    const res = await recordShippedChangeAction({ pageUrl: "https://x.test/cities" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/operator/i);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
    expect(mocks.upsertShippedChange).not.toHaveBeenCalled();
  });

  it("operator ⇒ captures baseline + persists the record", async () => {
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

  it("ANY page (no proof-plan row) ⇒ still records, controls derived from top-demand pages", async () => {
    mocks.loadProofPlan.mockResolvedValue([]); // page was never review-approved
    const res = await recordShippedChangeAction({ pageUrl: "/cities" });
    expect(res.success).toBe(true);
    expect(mocks.topPagesByDemand).toHaveBeenCalled(); // fallback control selection fired
    expect(mocks.recordShippedChange).toHaveBeenCalledOnce();
    const arg = mocks.recordShippedChange.mock.calls[0][0];
    expect(arg.controlPages.length).toBeGreaterThan(0);
  });
});

describe("recomputeProofLedgerAction — operator gating", () => {
  it("non-operator ⇒ refused, nothing recomputed", async () => {
    operatorFlag.value = false;
    const res = await recomputeProofLedgerAction();
    expect(res.success).toBe(false);
    expect(mocks.loadShippedChanges).not.toHaveBeenCalled();
  });
});
