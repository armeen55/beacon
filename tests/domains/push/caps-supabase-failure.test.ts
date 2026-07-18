import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const stores = new Map<string, unknown[]>();
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => stores.set(name, data),
}));

const rpc = vi.fn();
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

import { reservePushSlot } from "@/domains/push/caps";

describe("reservePushSlot durable-cap failure posture", () => {
  beforeEach(() => {
    stores.clear();
    rpc.mockReset();
  });

  it("fails closed on an arbitrary durable RPC error instead of trusting an empty lambda cache", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "query timed out" } });
    const result = await reservePushSlot({ tenantId: "tenant-a", editId: "edit-a", targetUrl: "https://a.test" });
    expect(result).toEqual({
      allowed: false,
      reason: "daily publishing safety check is unavailable — nothing was published; try again",
    });
    expect(stores.get("push-ledger")).toBeUndefined();
  });

  it("fails closed when the configured durable RPC cannot be reached", async () => {
    rpc.mockRejectedValue(new Error("network unavailable"));
    const result = await reservePushSlot({ tenantId: "tenant-a", editId: "edit-a", targetUrl: "https://a.test" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("safety check is unavailable");
    expect(stores.get("push-ledger")).toBeUndefined();
  });

  it("uses the file fallback only when the RPC is explicitly not provisioned", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function missing" } });
    const result = await reservePushSlot({ tenantId: "tenant-a", editId: "edit-a", targetUrl: "https://a.test" });
    expect(result.allowed).toBe(true);
    expect(stores.get("push-ledger")).toHaveLength(1);
  });

  it("returns the durable reservation when the atomic RPC succeeds", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const result = await reservePushSlot({ tenantId: "tenant-a", editId: "edit-a", targetUrl: "https://a.test" });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.reservationId).toMatch(/^rsv-/);
    expect(stores.get("push-ledger")).toBeUndefined();
  });
});
