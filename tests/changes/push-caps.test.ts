/**
 * Push caps — the publish-safety boundary suite (Core 100K Phase 6, changes area).
 *
 * Merges tests/domains/push/caps.test.ts + caps-supabase-failure.test.ts.
 * Pins the OPERATOR-SAFETY invariants:
 *   - deletion guard boundary math (80-char threshold, 0.2 shrink ratio)
 *   - daily-cap counting rule (per-tenant, per-day, pushed-only)
 *   - atomic reserve-before-write with stale-reservation expiry
 *   - FAIL-CLOSED posture when the durable cap check is unavailable
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const _stores = new Map<string, unknown[]>();
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    _stores.set(name, data);
  },
}));

const rpc = vi.fn();
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

import {
  assertNonDestructivePatch,
  checkDailyPushCap,
  finalizePushReservation,
  MAX_PUSHES_PER_DAY,
  reservePushSlot,
} from "@/domains/push/caps";

beforeEach(() => {
  _stores.clear();
  rpc.mockReset();
  // Default: durable RPC "not provisioned" → file fallback, matching the
  // hermetic no-Supabase posture the original caps.test.ts ran under.
  rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function missing" } });
});

describe("assertNonDestructivePatch — deletion guard (Invariant 3)", () => {
  it("refuses an empty proposed value (blanking is a deletion)", () => {
    expect(assertNonDestructivePatch({ currentText: "real content", proposedText: "" }).allowed).toBe(false);
    expect(assertNonDestructivePatch({ currentText: "x", proposedText: "   " }).allowed).toBe(false);
  });

  it("allows creating content where there was none (null current)", () => {
    expect(assertNonDestructivePatch({ currentText: null, proposedText: "brand new copy" }).allowed).toBe(true);
  });

  it(">80% shrink of >80-char content is refused; ≤80% is allowed", () => {
    const long = "x".repeat(100);
    // 100 → 19 chars (19%) → refused (< 20% of 100)
    expect(assertNonDestructivePatch({ currentText: long, proposedText: "y".repeat(19) }).allowed).toBe(false);
    // 100 → 21 chars (21%) → allowed (≥ 20%)
    expect(assertNonDestructivePatch({ currentText: long, proposedText: "y".repeat(21) }).allowed).toBe(true);
  });

  it("the shrink rule only applies past 80 chars of current content", () => {
    // current is short (≤80), so even a big shrink is allowed (rewrite).
    expect(assertNonDestructivePatch({ currentText: "x".repeat(80), proposedText: "y" }).allowed).toBe(true);
  });
});

describe("checkDailyPushCap — per-tenant, per-day, pushed-only", () => {
  const NOW = new Date("2026-06-11T12:00:00Z");
  const row = (over: Record<string, unknown>) => ({
    id: "p", tenant_id: "t", edit_id: "e", target_url: "u", adapter: "wix_cms",
    pushed_at: NOW.toISOString(), day: "2026-06-11", result: "pushed", detail: null,
    ...over,
  });

  it("allows under the cap, refuses at the cap", async () => {
    _stores.set("push-ledger", Array.from({ length: MAX_PUSHES_PER_DAY - 1 }, (_, i) => row({ id: `p${i}` })));
    expect((await checkDailyPushCap({ tenantId: "t", now: NOW })).allowed).toBe(true);
    _stores.set("push-ledger", Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) => row({ id: `p${i}` })));
    const r = await checkDailyPushCap({ tenantId: "t", now: NOW });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/daily push cap/);
  });

  it("counts only THIS tenant, THIS day, result=pushed", async () => {
    _stores.set("push-ledger", [
      ...Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) => row({ id: `other-${i}`, tenant_id: "other" })),
      ...Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) => row({ id: `yest-${i}`, day: "2026-06-10" })),
      ...Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) => row({ id: `fail-${i}`, result: "push_failed" })),
      row({ id: "mine-1" }),
    ]);
    // Only 1 row matches (t / today / pushed) → under cap.
    const r = await checkDailyPushCap({ tenantId: "t", now: NOW });
    expect(r.allowed).toBe(true);
  });

  it("honors a custom max", async () => {
    _stores.set("push-ledger", [row({ id: "a" }), row({ id: "b" })]);
    expect((await checkDailyPushCap({ tenantId: "t", now: NOW, max: 2 })).allowed).toBe(false);
  });
});

describe("reservePushSlot / finalizePushReservation — atomic reserve-before-write (#5)", () => {
  const NOW = new Date("2026-06-22T12:00:00Z");
  const reservedRow = (over: Record<string, unknown>) => ({
    id: "r", tenant_id: "t", edit_id: "e", target_url: "u", adapter: "wix_cms",
    pushed_at: NOW.toISOString(), day: "2026-06-22", result: "reserved", detail: null,
    ...over,
  });

  it("claims a slot under the cap and writes a `reserved` ledger row", async () => {
    const r = await reservePushSlot({ tenantId: "t", editId: "e1", targetUrl: "u1", now: NOW });
    expect(r.allowed).toBe(true);
    const ledger = (_stores.get("push-ledger") ?? []) as Array<{ result: string }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.result).toBe("reserved");
  });

  it("counts FRESH reserved rows against the cap (refuses at max)", async () => {
    _stores.set(
      "push-ledger",
      Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) => reservedRow({ id: `r${i}` })),
    );
    const r = await reservePushSlot({ tenantId: "t", editId: "e", targetUrl: "u", now: NOW });
    expect(r.allowed).toBe(false);
  });

  it("ignores STALE reserved rows (>10 min) — an abandoned reservation frees the slot", async () => {
    const stale = new Date(NOW.getTime() - 11 * 60_000).toISOString();
    _stores.set(
      "push-ledger",
      Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) =>
        reservedRow({ id: `r${i}`, pushed_at: stale }),
      ),
    );
    const r = await reservePushSlot({ tenantId: "t", editId: "e", targetUrl: "u", now: NOW });
    expect(r.allowed).toBe(true);
  });

  it("finalize flips the reserved row to its terminal result (then the pushed-only cap counts it)", async () => {
    const res = await reservePushSlot({ tenantId: "t", editId: "e1", targetUrl: "u1", now: NOW });
    expect(res.allowed).toBe(true);
    if (!res.allowed) return;
    await finalizePushReservation({
      tenantId: "t",
      reservationId: res.reservationId,
      result: "pushed",
      detail: "field title on item 42",
    });
    const ledger = (_stores.get("push-ledger") ?? []) as Array<{ result: string; detail: string | null }>;
    expect(ledger[0]!.result).toBe("pushed");
    expect(ledger[0]!.detail).toBe("field title on item 42");
  });
});

describe("reservePushSlot durable-cap failure posture — FAIL CLOSED", () => {
  it("fails closed on an arbitrary durable RPC error instead of trusting an empty lambda cache", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "query timed out" } });
    const result = await reservePushSlot({ tenantId: "tenant-a", editId: "edit-a", targetUrl: "https://a.test" });
    expect(result).toEqual({
      allowed: false,
      reason: "daily publishing safety check is unavailable — nothing was published; try again",
    });
    expect(_stores.get("push-ledger")).toBeUndefined();
  });

  it("fails closed when the configured durable RPC cannot be reached", async () => {
    rpc.mockRejectedValue(new Error("network unavailable"));
    const result = await reservePushSlot({ tenantId: "tenant-a", editId: "edit-a", targetUrl: "https://a.test" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("safety check is unavailable");
    expect(_stores.get("push-ledger")).toBeUndefined();
  });

  it("uses the file fallback only when the RPC is explicitly not provisioned", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function missing" } });
    const result = await reservePushSlot({ tenantId: "tenant-a", editId: "edit-a", targetUrl: "https://a.test" });
    expect(result.allowed).toBe(true);
    expect(_stores.get("push-ledger")).toHaveLength(1);
  });

  it("returns the durable reservation when the atomic RPC succeeds", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const result = await reservePushSlot({ tenantId: "tenant-a", editId: "edit-a", targetUrl: "https://a.test" });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.reservationId).toMatch(/^rsv-/);
    expect(_stores.get("push-ledger")).toBeUndefined();
  });
});
