/**
 * 2026-06-11 (night shift) — answer-snapshots store TENANT ISOLATION.
 *
 * answer-snapshots is a TENANT_SCOPED store, but the store held a
 * process-global `let _state` keyed by NOTHING: in a warm multi-tenant
 * process the first tenant's captured answers pinned for every later
 * tenant. The ambient-routed disk read masked it, and because this store
 * reads via `readStore` DIRECTLY (not getRepository), the
 * tenant-scoped-reads ratchet structurally cannot catch it. Per-tenant
 * Map now. Pins: hydrate-once, same-tenant reuse, cross-tenant non-leak,
 * and the stable-ref contract appendSnapshot() depends on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AnswerSnapshot } from "@/domains/answer-snapshots/types";

vi.mock("server-only", () => ({}));

const readStoreMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: () => readStoreMock(),
  writeStore: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantIdMock(),
}));

function snap(id: string): AnswerSnapshot {
  return {
    id, prompt_id: "p", prompt_text: "q", platform: "perplexity", model: "m",
    answer_text: "a", citations: [], entities_mentioned: [],
    sampled_at: "2026-06-11T00:00:00Z", run_id: "r", source_system: "beacon_native",
  };
}

describe("answer-snapshots store — per-tenant cache", () => {
  beforeEach(() => {
    vi.resetModules();
    readStoreMock.mockReset();
    tenantIdMock.mockReset();
    tenantIdMock.mockResolvedValue("tenant-a");
  });

  it("first call hydrates from readStore once", async () => {
    readStoreMock.mockResolvedValueOnce([snap("a1")]);
    const mod = await import("@/domains/answer-snapshots/store");
    mod._resetAnswerSnapshotsForTests();
    const out = await mod.getAnswerSnapshots();
    expect(out.map((s) => s.id)).toEqual(["a1"]);
    expect(readStoreMock).toHaveBeenCalledTimes(1);
  });

  it("same tenant reuses the cache (one read)", async () => {
    readStoreMock.mockResolvedValueOnce([snap("a1")]);
    const mod = await import("@/domains/answer-snapshots/store");
    mod._resetAnswerSnapshotsForTests();
    await mod.getAnswerSnapshots();
    await mod.getAnswerSnapshots();
    expect(readStoreMock).toHaveBeenCalledTimes(1);
  });

  it("TENANT ISOLATION: tenant B gets its own snapshots, not tenant A's", async () => {
    readStoreMock.mockResolvedValueOnce([snap("a1")]).mockResolvedValueOnce([snap("b1")]);
    const mod = await import("@/domains/answer-snapshots/store");
    mod._resetAnswerSnapshotsForTests();

    tenantIdMock.mockResolvedValue("tenant-a");
    const a = await mod.getAnswerSnapshots();
    tenantIdMock.mockResolvedValue("tenant-b");
    const b = await mod.getAnswerSnapshots();

    expect(a.map((s) => s.id)).toEqual(["a1"]);
    expect(b.map((s) => s.id)).toEqual(["b1"]); // pre-fix: returned ["a1"]
    expect(readStoreMock).toHaveBeenCalledTimes(2);
  });

  it("appendSnapshot mutates a stable per-tenant ref (visible on next read, no re-read)", async () => {
    readStoreMock.mockResolvedValueOnce([]);
    const mod = await import("@/domains/answer-snapshots/store");
    mod._resetAnswerSnapshotsForTests();
    await mod.appendSnapshot(snap("new"));
    const out = await mod.getAnswerSnapshots();
    expect(out.map((s) => s.id)).toEqual(["new"]);
    expect(readStoreMock).toHaveBeenCalledTimes(1);
  });
});
