import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// push-service is imported only for RITZ_TENANT_ID; stub its heavy deps so the
// import graph is inert (the planner is pure and calls nothing from it).
vi.mock("@/lib/connectors/wix/client", () => ({
  wixGetStoreProduct: vi.fn(), wixInsertDataItem: vi.fn(), wixQueryDataItems: vi.fn(),
  wixQueryAllDataItems: vi.fn(), wixGetDataItem: vi.fn(), wixUpdateDataItem: vi.fn(),
  wixUpdateProductSeoData: vi.fn(),
}));

import { planWholeDayRollback } from "./rollback-plan";
import { RITZ_TENANT_ID } from "./push-service";
import type { PushLedgerEntry } from "./caps";
import type { PushSnapshotRow } from "./push-snapshots";

function ledgerRow(over: Partial<PushLedgerEntry>): PushLedgerEntry {
  return {
    id: "l1", tenant_id: "t1", edit_id: "e1", target_url: "https://x.com/p",
    adapter: "wix_cms", pushed_at: "2026-07-03T10:00:00Z", day: "2026-07-03",
    result: "pushed", detail: null, ...over,
  };
}

function snap(over: Partial<PushSnapshotRow>): PushSnapshotRow {
  return {
    id: "s1", tenant_id: "t1", edit_id: "e1", target_url: "https://x.com/p",
    dataCollectionId: "C", dataItemId: "i1", field: "title",
    previous_text: "Old Title", captured_at: "2026-07-03T10:00:00Z", ...over,
  };
}

const DAY = "2026-07-03";

describe("planWholeDayRollback - pure planner (never executes)", () => {
  it("RITZ is EXCLUDED: returns an excluded, empty plan (pin)", () => {
    const plan = planWholeDayRollback({
      tenantId: RITZ_TENANT_ID, day: DAY,
      ledger: [ledgerRow({ tenant_id: RITZ_TENANT_ID })],
      snapshots: [snap({ tenant_id: RITZ_TENANT_ID })],
    });
    expect(plan.excluded).toBe(true);
    expect(plan.reverseOps).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.summary).toContain("advise mode");
  });

  it("produces a correct reverse-op for a single title push", () => {
    const plan = planWholeDayRollback({
      tenantId: "t1", day: DAY,
      ledger: [ledgerRow({})],
      snapshots: [snap({})],
    });
    expect(plan.excluded).toBe(false);
    expect(plan.reverseOps).toHaveLength(1);
    const op = plan.reverseOps[0]!;
    expect(op.field).toBe("title");
    expect(op.restoreValue).toBe("Old Title"); // restore the pre-push value
    expect(op.dataItemId).toBe("i1");
    expect(op.undoesPushes).toBe(1);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.summary).toContain("undo 1 live change");
  });

  it("restores the START-OF-DAY value when a field was pushed twice", () => {
    // Two pushes to the same title today: 10:00 captured "Original", 14:00
    // captured "Midday". Undoing the DAY must restore "Original", not "Midday".
    const plan = planWholeDayRollback({
      tenantId: "t1", day: DAY,
      ledger: [
        ledgerRow({ id: "l1", edit_id: "e1", pushed_at: "2026-07-03T10:00:00Z" }),
        ledgerRow({ id: "l2", edit_id: "e2", pushed_at: "2026-07-03T14:00:00Z" }),
      ],
      snapshots: [
        snap({ id: "s1", edit_id: "e1", previous_text: "Original", captured_at: "2026-07-03T10:00:00Z" }),
        snap({ id: "s2", edit_id: "e2", previous_text: "Midday", captured_at: "2026-07-03T14:00:00Z" }),
      ],
    });
    expect(plan.reverseOps).toHaveLength(1); // collapsed to one op
    expect(plan.reverseOps[0]!.restoreValue).toBe("Original");
    expect(plan.reverseOps[0]!.undoesPushes).toBe(2);
  });

  it("one reverse-op per distinct field (title + meta on the same page)", () => {
    const plan = planWholeDayRollback({
      tenantId: "t1", day: DAY,
      ledger: [ledgerRow({ id: "l1", edit_id: "e1" }), ledgerRow({ id: "l2", edit_id: "e2" })],
      snapshots: [
        snap({ id: "s1", edit_id: "e1", field: "title", previous_text: "Old T" }),
        snap({ id: "s2", edit_id: "e2", field: "metaDescription", previous_text: "Old M" }),
      ],
    });
    expect(plan.reverseOps).toHaveLength(2);
    expect(plan.reverseOps.map((o) => o.field).sort()).toEqual(["metaDescription", "title"]);
  });

  it("SKIPS a field whose start-of-day value was EMPTY (undoing it would blank it)", () => {
    const plan = planWholeDayRollback({
      tenantId: "t1", day: DAY,
      ledger: [ledgerRow({})],
      snapshots: [snap({ previous_text: "" })],
    });
    expect(plan.reverseOps).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.reason).toContain("blank");
  });

  it("SKIPS a pushed row with NO snapshot at all (nothing to restore, e.g. a create)", () => {
    const plan = planWholeDayRollback({
      tenantId: "t1", day: DAY,
      ledger: [ledgerRow({ edit_id: "created-page" })],
      snapshots: [],
    });
    expect(plan.reverseOps).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.field).toBeNull();
    expect(plan.skipped[0]!.reason).toContain("no saved previous version");
  });

  it("only counts THIS day + THIS tenant + result=pushed", () => {
    const plan = planWholeDayRollback({
      tenantId: "t1", day: DAY,
      ledger: [
        ledgerRow({ id: "l1", edit_id: "e1" }), // pushed today, t1 -> counts
        ledgerRow({ id: "l2", edit_id: "e2", result: "push_failed" }), // failed -> ignored
        ledgerRow({ id: "l3", edit_id: "e3", day: "2026-07-02" }), // other day -> ignored
        ledgerRow({ id: "l4", edit_id: "e4", tenant_id: "t2" }), // other tenant -> ignored
      ],
      snapshots: [
        snap({ id: "s1", edit_id: "e1", previous_text: "Keep" }),
        snap({ id: "s3", edit_id: "e3", captured_at: "2026-07-02T10:00:00Z", previous_text: "OtherDay" }),
        snap({ id: "s4", edit_id: "e4", tenant_id: "t2", previous_text: "OtherTenant" }),
      ],
    });
    expect(plan.reverseOps).toHaveLength(1);
    expect(plan.reverseOps[0]!.restoreValue).toBe("Keep");
    expect(plan.skipped).toHaveLength(0);
  });

  it("empty day -> a plainly-stated no-op plan", () => {
    const plan = planWholeDayRollback({ tenantId: "t1", day: DAY, ledger: [], snapshots: [] });
    expect(plan.reverseOps).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.summary).toContain("no live changes");
  });

  it("all operator copy is dash-free", () => {
    const plan = planWholeDayRollback({
      tenantId: "t1", day: DAY,
      ledger: [ledgerRow({}), ledgerRow({ id: "l2", edit_id: "e2" })],
      snapshots: [snap({}), snap({ id: "s2", edit_id: "e2", previous_text: "" })],
    });
    expect(plan.summary).not.toMatch(/[—–]/);
    for (const s of plan.skipped) expect(s.reason).not.toMatch(/[—–]/);
  });
});
