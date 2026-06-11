/**
 * 2026-06-11 (night shift, fuel #4) — direct unit pins for the
 * publish-SAFETY invariants in push/caps.ts. Previously exercised only
 * through the push-service integration; these pin the BOUNDARY math
 * (the 80-char threshold, the 0.2 shrink ratio, the daily-cap
 * counting-rule) so a refactor can't silently loosen a safety gate.
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

import {
  assertNonDestructivePatch,
  checkDailyPushCap,
  MAX_PUSHES_PER_DAY,
} from "@/domains/push/caps";

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

  it("a normal rewrite (similar length) is allowed", () => {
    expect(
      assertNonDestructivePatch({
        currentText: "the old introduction paragraph for this page",
        proposedText: "a refreshed introduction paragraph for this page with dates",
      }).allowed,
    ).toBe(true);
  });
});

describe("checkDailyPushCap — per-tenant, per-day, pushed-only", () => {
  beforeEach(() => _stores.clear());

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
