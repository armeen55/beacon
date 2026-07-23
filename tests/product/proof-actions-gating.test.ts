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
vi.mock("@/domains/proof-gsc/measure-pass", () => ({
  captureChangeMeta: mocks.captureChangeMeta,
  recordShippedChange: mocks.recordShippedChange,
  measureRecord: mocks.measureRecord,
  // audit-4: actions.ts now defaults shipDate to the Pacific calendar day.
  defaultPacificShipDate: () => "2026-06-22",
}));
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: mocks.loadShippedChanges,
  upsertShippedChange: mocks.upsertShippedChange,
}));

import {
  recordShippedChangeAction,
  recomputeProofLedgerAction,
  markRecrawlRequestedAction,
} from "@/app/(shell)/results/actions";

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

  it("passes explicit change fields through to recordShippedChange", async () => {
    const res = await recordShippedChangeAction({
      pageUrl: "/cities",
      changeType: "edit_meta",
      before: "old meta",
      after: "new meta",
      shippedAt: "2026-06-20",
      notes: "manual wix edit",
      targetQueries: "cities in iran\nlargest cities in iran, cities of iran",
      verifiedLive: true,
      liveSourceUrl: "https://www.iranopedia.com/cities",
    });
    expect(res.success).toBe(true);
    const arg = mocks.recordShippedChange.mock.calls[0][0];
    expect(arg.actionType).toBe("edit_meta");
    expect(arg.before).toBe("old meta");
    expect(arg.after).toBe("new meta");
    expect(arg.notes).toBe("manual wix edit");
    expect(arg.verifiedLive).toBe(true);
    expect(arg.liveSourceUrl).toBe("https://www.iranopedia.com/cities");
    expect(arg.targetQueries).toEqual([
      "cities in iran",
      "largest cities in iran",
      "cities of iran",
    ]);
  });

  it("real edit with no before/after (and no pack copy) ⇒ refused", async () => {
    mocks.captureChangeMeta.mockResolvedValue({
      canonPage: "https://x.test/cities",
      path: "/cities",
      before: null,
      after: null,
      targetQueries: [],
      headlineAction: null,
    });
    const res = await recordShippedChangeAction({ pageUrl: "/cities", changeType: "edit_title" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/before and after/i);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
  });

  it("keep_current with no before/after ⇒ still records (monitor decision)", async () => {
    mocks.captureChangeMeta.mockResolvedValue({
      canonPage: "https://x.test/cities",
      path: "/cities",
      before: null,
      after: null,
      targetQueries: [],
      headlineAction: null,
    });
    const res = await recordShippedChangeAction({ pageUrl: "/cities", changeType: "keep_current" });
    expect(res.success).toBe(true);
    expect(mocks.recordShippedChange).toHaveBeenCalledOnce();
  });

  it("duplicate page + ship date ⇒ refused, nothing overwritten", async () => {
    mocks.loadShippedChanges.mockResolvedValue([
      { path: "/cities", actionType: "meta", shippedAt: "2026-06-20T08:00:00.000Z" },
    ]);
    const res = await recordShippedChangeAction({ pageUrl: "/cities", shippedAt: "2026-06-20" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already recorded/i);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
  });

  it("fewer than 2 control pages ⇒ refused, nothing recorded", async () => {
    mocks.loadProofPlan.mockResolvedValue([]); // no plan controls
    mocks.topPagesByDemand.mockReturnValue(["https://x.test/a"]); // only 1 candidate
    const res = await recordShippedChangeAction({ pageUrl: "/cities" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not enough comparable/i);
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();
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

describe("markRecrawlRequestedAction — operator gating + toggle", () => {
  it("non-operator ⇒ refused, nothing written", async () => {
    operatorFlag.value = false;
    const res = await markRecrawlRequestedAction({ id: "/cities::2026-06-20", requested: true });
    expect(res.success).toBe(false);
    expect(mocks.upsertShippedChange).not.toHaveBeenCalled();
  });

  it("operator mark ⇒ stamps recrawlRequestedAt and persists", async () => {
    mocks.loadShippedChanges.mockResolvedValue([
      { id: "/cities::2026-06-20", recrawlRequestedAt: null },
    ]);
    const res = await markRecrawlRequestedAction({ id: "/cities::2026-06-20", requested: true });
    expect(res.success).toBe(true);
    expect(mocks.upsertShippedChange).toHaveBeenCalledOnce();
    expect(mocks.upsertShippedChange.mock.calls[0][0].recrawlRequestedAt).toBeTruthy();
  });

  it("operator undo ⇒ clears recrawlRequestedAt", async () => {
    mocks.loadShippedChanges.mockResolvedValue([
      { id: "/cities::2026-06-20", recrawlRequestedAt: "2026-06-20T00:00:00Z" },
    ]);
    const res = await markRecrawlRequestedAction({ id: "/cities::2026-06-20", requested: false });
    expect(res.success).toBe(true);
    expect(mocks.upsertShippedChange.mock.calls[0][0].recrawlRequestedAt).toBeNull();
  });

  it("unknown id ⇒ refused", async () => {
    mocks.loadShippedChanges.mockResolvedValue([]);
    const res = await markRecrawlRequestedAction({ id: "/nope::2026-06-20", requested: true });
    expect(res.success).toBe(false);
    expect(mocks.upsertShippedChange).not.toHaveBeenCalled();
  });
});
