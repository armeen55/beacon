import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// In-memory json-store mock (the outbox's only persistence).
let rows: Record<string, unknown>[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => rows,
  writeStore: async (_name: string, data: unknown[]) => {
    rows = data as Record<string, unknown>[];
  },
}));

import {
  changeHashFor,
  outboxKeyFor,
  checkOutbox,
  recordOutbox,
  listRecentOutbox,
} from "./publish-outbox";

beforeEach(() => {
  rows = [];
});

describe("changeHashFor - deterministic digest of what gets written", () => {
  it("is stable for the same inputs", () => {
    const a = changeHashFor({ actionType: "edit_title", elementKey: "field:title", proposedText: "Best Tehran Guide" });
    const b = changeHashFor({ actionType: "edit_title", elementKey: "field:title", proposedText: "Best Tehran Guide" });
    expect(a).toBe(b);
  });
  it("changes when the proposed text changes (a re-edit is a different key)", () => {
    const a = changeHashFor({ actionType: "edit_title", elementKey: "field:title", proposedText: "One" });
    const b = changeHashFor({ actionType: "edit_title", elementKey: "field:title", proposedText: "Two" });
    expect(a).not.toBe(b);
  });
  it("normalizes cosmetic whitespace (identical content still dedupes)", () => {
    const a = changeHashFor({ actionType: "edit_title", elementKey: "field:title", proposedText: "Hello world" });
    const b = changeHashFor({ actionType: "edit_title", elementKey: "field:title", proposedText: "  Hello   world  " });
    expect(a).toBe(b);
  });
  it("changes when the action or element key changes", () => {
    const base = changeHashFor({ actionType: "edit_title", elementKey: "field:title", proposedText: "x" });
    expect(changeHashFor({ actionType: "edit_meta", elementKey: "field:title", proposedText: "x" })).not.toBe(base);
    expect(changeHashFor({ actionType: "edit_title", elementKey: "field:h1", proposedText: "x" })).not.toBe(base);
  });
});

describe("outboxKeyFor - key per (tenant, url, hash, ship_date)", () => {
  const now = new Date("2026-07-03T12:00:00Z");
  it("is identical for the same four inputs (a retry collapses to one key)", () => {
    const a = outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/p", changeHash: "h", now });
    const b = outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/p", changeHash: "h", now });
    expect(a.key).toBe(b.key);
    expect(a.shipDate).toBe("2026-07-03");
  });
  it("differs by tenant, url, hash, and ship date", () => {
    const base = outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/p", changeHash: "h", now }).key;
    expect(outboxKeyFor({ tenantId: "t2", targetUrl: "https://x.com/p", changeHash: "h", now }).key).not.toBe(base);
    expect(outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/q", changeHash: "h", now }).key).not.toBe(base);
    expect(outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/p", changeHash: "g", now }).key).not.toBe(base);
    const tomorrow = new Date("2026-07-04T12:00:00Z");
    expect(outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/p", changeHash: "h", now: tomorrow }).key).not.toBe(base);
  });
});

describe("checkOutbox - first-seen byte-identical, dedup after pushed", () => {
  const now = new Date("2026-07-03T12:00:00Z");
  const key = outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/p", changeHash: "h", now });

  it("a FIRST-SEEN key returns seen:false (push proceeds exactly as today)", async () => {
    const check = await checkOutbox(key.key);
    expect(check).toEqual({ seen: false });
  });

  it("after a PUSHED record, the SAME key short-circuits and returns the prior receipt", async () => {
    await recordOutbox({
      tenantId: "t1",
      key: key.key,
      targetUrl: "https://x.com/p",
      changeHash: "h",
      shipDate: key.shipDate,
      state: "pushed",
      receipt: "I updated the title.",
      now,
    });
    const check = await checkOutbox(key.key);
    expect(check.seen).toBe(true);
    if (check.seen) {
      expect(check.state).toBe("pushed");
      expect(check.receipt).toBe("I updated the title.");
    }
  });

  it("a prior FAILED attempt does NOT short-circuit (a retry is exactly what should happen)", async () => {
    await recordOutbox({
      tenantId: "t1",
      key: key.key,
      targetUrl: "https://x.com/p",
      changeHash: "h",
      shipDate: key.shipDate,
      state: "push_failed",
      receipt: "wix write failed",
      now,
    });
    const check = await checkOutbox(key.key);
    expect(check).toEqual({ seen: false });
  });

  it("a retry that finally lands overwrites the failure row -> then dedupes", async () => {
    await recordOutbox({
      tenantId: "t1", key: key.key, targetUrl: "https://x.com/p", changeHash: "h",
      shipDate: key.shipDate, state: "push_failed", receipt: "failed", now,
    });
    await recordOutbox({
      tenantId: "t1", key: key.key, targetUrl: "https://x.com/p", changeHash: "h",
      shipDate: key.shipDate, state: "pushed", receipt: "landed", now,
    });
    // Exactly one row for the key (upsert, not append).
    expect(rows.filter((r) => (r as { key: string }).key === key.key)).toHaveLength(1);
    const check = await checkOutbox(key.key);
    expect(check.seen).toBe(true);
    if (check.seen) expect(check.receipt).toBe("landed");
  });

  it("a DIFFERENT change to the same URL/day (different hash) pushes normally", async () => {
    await recordOutbox({
      tenantId: "t1", key: key.key, targetUrl: "https://x.com/p", changeHash: "h",
      shipDate: key.shipDate, state: "pushed", receipt: "first", now,
    });
    const other = outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/p", changeHash: "DIFFERENT", now });
    expect(await checkOutbox(other.key)).toEqual({ seen: false });
  });

  it("checkOutbox fails soft to seen:false on a read error (never blocks a legit push)", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "readStore").mockRejectedValueOnce(new Error("read boom"));
    expect(await checkOutbox(key.key)).toEqual({ seen: false });
    spy.mockRestore();
  });
});

describe("listRecentOutbox + tenant isolation", () => {
  it("only returns a tenant's own rows", async () => {
    const now = new Date("2026-07-03T12:00:00Z");
    const k1 = outboxKeyFor({ tenantId: "t1", targetUrl: "https://a.com", changeHash: "h", now });
    const k2 = outboxKeyFor({ tenantId: "t2", targetUrl: "https://b.com", changeHash: "h", now });
    await recordOutbox({ tenantId: "t1", key: k1.key, targetUrl: "https://a.com", changeHash: "h", shipDate: k1.shipDate, state: "pushed", receipt: "a", now });
    await recordOutbox({ tenantId: "t2", key: k2.key, targetUrl: "https://b.com", changeHash: "h", shipDate: k2.shipDate, state: "pushed", receipt: "b", now });
    const t1 = await listRecentOutbox("t1");
    expect(t1).toHaveLength(1);
    expect(t1[0]!.tenant_id).toBe("t1");
  });
});
