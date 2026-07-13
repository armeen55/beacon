/**
 * Warm-receipt store (2026-07-02, BEACON 500 item 13).
 *
 * Pins the run-marker idempotency semantics over a mocked json-store:
 *   - only a SUCCESSFUL run marks the day (a failed attempt never blocks the
 *     retry that could fix it),
 *   - an unreadable store never blocks the pass (marker reads fail-open to
 *     false; the pass is $0 so a re-warm is harmless),
 *   - the latest attempt per day replaces the previous one,
 *   - receipts stay bounded per tenant and never clobber other tenants,
 *   - readLastWarmReceipt returns the newest attempt (or null on error).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mem = vi.hoisted(() => ({
  rows: null as unknown[] | null,
  failReads: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => {
    if (mem.failReads) throw new Error("boom");
    return mem.rows ?? [];
  }),
  writeStore: vi.fn(async (_name: string, data: unknown[]) => {
    mem.rows = data;
  }),
}));

import {
  hasWarmRunForDay,
  recordWarmRun,
  readLastWarmReceipt,
  type WarmRunReceipt,
} from "@/domains/ops/warm-receipt-store";

const TENANT = "tenant-iranopedia";

function receipt(partial: Partial<WarmRunReceipt> = {}): WarmRunReceipt {
  return {
    tenant_id: TENANT,
    date: "2026-07-02",
    ran_at: "2026-07-02T12:00:00.000Z",
    ok: true,
    totalMs: 1234,
    steps: [{ name: "demand-graph", ok: true, ms: 1000 }],
    ...partial,
  };
}

beforeEach(() => {
  mem.rows = null;
  mem.failReads = false;
});

describe("warm-receipt-store", () => {
  it("marks the day only after a SUCCESSFUL run", async () => {
    expect(await hasWarmRunForDay(TENANT, "2026-07-02")).toBe(false);
    await recordWarmRun(receipt({ ok: false }));
    expect(await hasWarmRunForDay(TENANT, "2026-07-02")).toBe(false);
    await recordWarmRun(receipt({ ok: true }));
    expect(await hasWarmRunForDay(TENANT, "2026-07-02")).toBe(true);
    // A different day is still unmarked.
    expect(await hasWarmRunForDay(TENANT, "2026-07-03")).toBe(false);
  });

  it("an unreadable marker never blocks the pass", async () => {
    mem.failReads = true;
    expect(await hasWarmRunForDay(TENANT, "2026-07-02")).toBe(false);
  });

  it("latest attempt per day replaces the previous one", async () => {
    await recordWarmRun(receipt({ ok: false, ran_at: "2026-07-02T12:00:00.000Z" }));
    await recordWarmRun(receipt({ ok: true, ran_at: "2026-07-02T12:05:00.000Z" }));
    const mine = (mem.rows as WarmRunReceipt[]).filter((r) => r.tenant_id === TENANT);
    expect(mine).toHaveLength(1);
    expect(mine[0].ok).toBe(true);
  });

  it("stays bounded per tenant and preserves other tenants' rows", async () => {
    for (let d = 1; d <= 20; d += 1) {
      await recordWarmRun(receipt({ date: `2026-06-${String(d).padStart(2, "0")}` }));
    }
    await recordWarmRun(receipt({ tenant_id: "tenant-other", date: "2026-07-02" }));
    const rows = mem.rows as WarmRunReceipt[];
    expect(rows.filter((r) => r.tenant_id === TENANT).length).toBeLessThanOrEqual(28);
    expect(rows.filter((r) => r.tenant_id === "tenant-other")).toHaveLength(1);
  });

  it("readLastWarmReceipt returns the newest attempt; null on read error", async () => {
    await recordWarmRun(receipt({ date: "2026-07-01", ran_at: "2026-07-01T12:00:00.000Z" }));
    await recordWarmRun(receipt({ date: "2026-07-02", ran_at: "2026-07-02T12:04:00.000Z", totalMs: 999 }));
    const last = await readLastWarmReceipt(TENANT);
    expect(last?.date).toBe("2026-07-02");
    expect(last?.totalMs).toBe(999);
    mem.failReads = true;
    expect(await readLastWarmReceipt(TENANT)).toBeNull();
  });

  it("keeps cron and visit receipts for the same tenant and day independently", async () => {
    await recordWarmRun(receipt({ trigger: "cron", totalMs: 10 }));
    await recordWarmRun(receipt({ trigger: "visit", totalMs: 20 }));
    expect((mem.rows as WarmRunReceipt[]).filter((r) => r.tenant_id === TENANT)).toHaveLength(2);
    expect((await readLastWarmReceipt(TENANT, "cron"))?.totalMs).toBe(10);
    expect((await readLastWarmReceipt(TENANT, "visit"))?.totalMs).toBe(20);
  });
});
