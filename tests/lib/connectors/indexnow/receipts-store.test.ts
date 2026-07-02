/**
 * IndexNow receipts store (BEACON_500 item 75, 2026-07-02).
 *
 * Pins: empty by default, receipts prepend newest-first, the list stays
 * bounded, and a write failure never throws (observability only).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mem = vi.hoisted(() => ({
  rows: null as unknown[] | null,
  failWrites: false,
  failReads: false,
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => {
    if (mem.failReads) throw new Error("boom");
    return mem.rows ?? [];
  }),
  writeStore: vi.fn(async (_name: string, data: unknown[]) => {
    if (mem.failWrites) throw new Error("boom");
    mem.rows = data;
  }),
}));

import {
  appendIndexNowReceipt,
  getIndexNowReceipts,
  type IndexNowReceipt,
} from "@/lib/connectors/indexnow/receipts-store";

function receipt(partial: Partial<IndexNowReceipt> = {}): IndexNowReceipt {
  return {
    id: "indexnow-1",
    url: "https://example.com/a",
    pingedAt: "2026-07-02T00:00:00Z",
    ok: true,
    status: 200,
    detail: "accepted",
    ...partial,
  };
}

beforeEach(() => {
  mem.rows = null;
  mem.failWrites = false;
  mem.failReads = false;
});

describe("getIndexNowReceipts", () => {
  it("returns empty when nothing has been recorded", async () => {
    expect(await getIndexNowReceipts()).toEqual([]);
  });

  it("fails soft to empty on a read error", async () => {
    mem.failReads = true;
    expect(await getIndexNowReceipts()).toEqual([]);
  });
});

describe("appendIndexNowReceipt", () => {
  it("prepends newest-first", async () => {
    await appendIndexNowReceipt(receipt({ id: "r1" }));
    await appendIndexNowReceipt(receipt({ id: "r2" }));
    const rows = await getIndexNowReceipts();
    expect(rows.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("never throws when the underlying write fails", async () => {
    mem.failWrites = true;
    await expect(appendIndexNowReceipt(receipt())).resolves.toBeUndefined();
  });

  it("caps the stored list", async () => {
    for (let i = 0; i < 120; i += 1) {
      await appendIndexNowReceipt(receipt({ id: `r${i}` }));
    }
    const rows = await getIndexNowReceipts();
    expect(rows.length).toBeLessThanOrEqual(100);
    expect(rows[0].id).toBe("r119");
  });
});
