import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * push-service-pins.test.ts (R23 P12, 2026-07-03) - pins the three safety
 * invariants R23 must PRESERVE, exercised through the REAL executePush with a
 * MOCKED Wix client (no network, no live publish):
 *   1. Ritz hard-block: tenant-ritz-founder can NEVER publish (dev_note, no write).
 *   2. Dry-run default is side-effect-free: a dry_run returns before any adapter
 *      write, snapshot, or ledger row.
 *   3. Daily caps are enforced in the push path: an over-cap reservation refuses
 *      before any write.
 *
 * These pins are why the push-depth pack is additive: the new helpers compose
 * executePush and never bypass these rails. If any of these break, the whole
 * safety story breaks.
 */

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const getTenantMock = vi.fn();
vi.mock("@/domains/tenants/store", () => ({
  getTenant: (...a: unknown[]) => getTenantMock(...a),
}));

// Wix client - EVERY call is a mock. A real write would be a spy call we assert
// on; the pins prove these are NEVER called on the refused/dry-run paths.
const wixUpdateDataItemMock = vi.fn();
const wixGetDataItemMock = vi.fn();
const wixInsertDataItemMock = vi.fn();
const wixUpdateProductSeoDataMock = vi.fn();
const wixGetStoreProductMock = vi.fn();
const wixQueryAllDataItemsMock = vi.fn();
const wixQueryDataItemsMock = vi.fn();
vi.mock("@/lib/connectors/wix/client", () => ({
  wixUpdateDataItem: (...a: unknown[]) => wixUpdateDataItemMock(...a),
  wixGetDataItem: (...a: unknown[]) => wixGetDataItemMock(...a),
  wixInsertDataItem: (...a: unknown[]) => wixInsertDataItemMock(...a),
  wixUpdateProductSeoData: (...a: unknown[]) => wixUpdateProductSeoDataMock(...a),
  wixGetStoreProduct: (...a: unknown[]) => wixGetStoreProductMock(...a),
  wixQueryAllDataItems: (...a: unknown[]) => wixQueryAllDataItemsMock(...a),
  wixQueryDataItems: (...a: unknown[]) => wixQueryDataItemsMock(...a),
}));

const resolveWixItemForUrlMock = vi.fn();
const resolveWixBodyFieldForUrlMock = vi.fn();
const deriveWixContentFieldKeyMock = vi.fn();
vi.mock("@/lib/connectors/wix/url-map", () => ({
  resolveWixItemForUrl: (...a: unknown[]) => resolveWixItemForUrlMock(...a),
  resolveWixBodyFieldForUrl: (...a: unknown[]) => resolveWixBodyFieldForUrlMock(...a),
  deriveWixContentFieldKey: (...a: unknown[]) => deriveWixContentFieldKeyMock(...a),
}));

// Snapshot capture - a spy so we can assert it is NEVER written on a dry-run.
const appendPushSnapshotMock = vi.fn();
vi.mock("./push-snapshots", () => ({
  appendPushSnapshot: (...a: unknown[]) => appendPushSnapshotMock(...a),
  isSnapshotRevertEdit: () => false,
}));

// Caps - spies. reservePushSlot controls whether the daily cap allows the push.
const reservePushSlotMock = vi.fn();
const checkDailyPushCapMock = vi.fn();
const finalizePushReservationMock = vi.fn();
const appendPushLedgerMock = vi.fn();
vi.mock("./caps", () => ({
  reservePushSlot: (...a: unknown[]) => reservePushSlotMock(...a),
  checkDailyPushCap: (...a: unknown[]) => checkDailyPushCapMock(...a),
  finalizePushReservation: (...a: unknown[]) => finalizePushReservationMock(...a),
  appendPushLedger: (...a: unknown[]) => appendPushLedgerMock(...a),
  assertNonDestructivePatch: () => ({ allowed: true }),
}));

// Outbox - first-seen (never blocks); record is a no-op spy.
vi.mock("./publish-outbox", () => ({
  changeHashFor: () => "hash",
  outboxKeyFor: () => ({ key: "key", shipDate: "2026-07-03" }),
  checkOutbox: async () => ({ seen: false }),
  recordOutbox: vi.fn(),
}));

vi.mock("./body-merge", () => ({
  bodyMergeModeForAction: () => null,
  mergeBodyContent: vi.fn(),
}));

import { executePush, RITZ_TENANT_ID } from "./push-service";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

function edit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "e1", rec_id: "r1", tenant_id: "t1",
    action_type: "edit_title", target_url: "https://x.com/p",
    target_element_key: "field:title", display_label: "Title",
    current_text: "Old Title", proposed_text: "New Title",
    why: "", evidence: [], expected_impact: null, difficulty: "low",
    confidence: "medium", measurement_plan: null, risks: [],
    source: "deterministic", provider_name: null, evidence_hash: null,
    model: null, cost_usd: null,
    created_at: "2026-07-03T00:00:00Z", updated_at: "2026-07-03T00:00:00Z",
    implementation_status: "accepted", ...over,
  } as RecommendedEditRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  getTenantMock.mockResolvedValue({ id: "t1", publish_target: "wix_cms" });
  resolveWixItemForUrlMock.mockResolvedValue({ dataCollectionId: "C", dataItemId: "i1" });
  wixGetDataItemMock.mockResolvedValue({ ok: true, value: { id: "i1", dataCollectionId: "C", data: { title: "Old Title" } } });
  wixUpdateDataItemMock.mockResolvedValue({ ok: true, value: { id: "i1", dataCollectionId: "C", data: {} } });
  appendPushSnapshotMock.mockResolvedValue(undefined);
  reservePushSlotMock.mockResolvedValue({ allowed: true, reservationId: "rsv-1" });
  checkDailyPushCapMock.mockResolvedValue({ allowed: true });
  finalizePushReservationMock.mockResolvedValue(undefined);
});

describe("PIN 1 - Ritz hard-block: tenant-ritz-founder can NEVER publish", () => {
  it("returns dev_note and performs NO write, NO snapshot, NO cap reservation", async () => {
    const res = await executePush({ tenantId: RITZ_TENANT_ID, edit: edit() });
    expect(res.kind).toBe("dev_note");
    if (res.kind === "dev_note") expect(res.reason).toContain("advise-mode only");
    expect(wixUpdateDataItemMock).not.toHaveBeenCalled();
    expect(appendPushSnapshotMock).not.toHaveBeenCalled();
    expect(reservePushSlotMock).not.toHaveBeenCalled();
  });

  it("even a Ritz DRY-RUN never writes (hard-block wins before dry-run branch)", async () => {
    const res = await executePush({ tenantId: RITZ_TENANT_ID, edit: edit(), dryRun: true });
    expect(res.kind).toBe("dev_note");
    expect(wixUpdateDataItemMock).not.toHaveBeenCalled();
  });
});

describe("PIN 2 - dry-run is side-effect-free by default", () => {
  it("a dry_run returns before ANY adapter write, snapshot, or reservation", async () => {
    const res = await executePush({ tenantId: "t1", edit: edit(), dryRun: true });
    expect(res.kind).toBe("dry_run");
    expect(wixUpdateDataItemMock).not.toHaveBeenCalled();
    expect(appendPushSnapshotMock).not.toHaveBeenCalled();
    // A dry-run uses the read-only cap CHECK, never reserves a slot.
    expect(reservePushSlotMock).not.toHaveBeenCalled();
    expect(checkDailyPushCapMock).toHaveBeenCalled();
  });

  it("a REAL push (no dryRun) DOES write - proving the dry-run difference is real", async () => {
    const res = await executePush({ tenantId: "t1", edit: edit() });
    expect(res.kind).toBe("pushed");
    expect(appendPushSnapshotMock).toHaveBeenCalledTimes(1);
    expect(wixUpdateDataItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("PIN 3 - daily caps enforced in the push path", () => {
  it("an over-cap reservation REFUSES before any write or snapshot", async () => {
    reservePushSlotMock.mockResolvedValueOnce({
      allowed: false,
      reason: "daily push cap reached (10/10 for 2026-07-03)",
    });
    const res = await executePush({ tenantId: "t1", edit: edit() });
    expect(res.kind).toBe("refused");
    if (res.kind === "refused") expect(res.reason).toContain("daily push cap reached");
    expect(wixUpdateDataItemMock).not.toHaveBeenCalled();
    expect(appendPushSnapshotMock).not.toHaveBeenCalled();
  });

  it("a dry-run over the cap refuses via the read-only check (no reservation, no write)", async () => {
    checkDailyPushCapMock.mockResolvedValueOnce({
      allowed: false,
      reason: "daily push cap reached (10/10 for 2026-07-03)",
    });
    const res = await executePush({ tenantId: "t1", edit: edit(), dryRun: true });
    expect(res.kind).toBe("refused");
    expect(reservePushSlotMock).not.toHaveBeenCalled();
    expect(wixUpdateDataItemMock).not.toHaveBeenCalled();
  });
});
