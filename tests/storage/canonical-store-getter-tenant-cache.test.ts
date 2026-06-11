/**
 * 2026-06-11 (night shift) — canonical-store MODULE-GETTER tenant cache.
 *
 * The sibling tests cover loadFreshCanonicalData()/forTenant (the render
 * path). This pins the OTHER path: the module-level getters (getTrackedPrompts
 * etc.) used by the poll pipeline, orchestrate-scan, url-citation-history and
 * the Profound importer. They were backed by ONE process-global `_state`
 * object whose `loadFromDiskAndMerge` guard pinned the FIRST tenant's eight
 * arrays for every later tenant in a warm process. Now a per-tenant Map.
 * (DATA_SOURCE is left unset so the Supabase merge branch is skipped — this
 * exercises the disk-read path, which is where the cache key lived.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const readStoreMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (name: string) => readStoreMock(name),
  writeStore: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: () => tenantIdMock() }));
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({ forTenant: () => ({}) }),
}));
vi.mock("@/lib/persistence/dual-write", () => ({
  syncDailyMetricSnapshots: vi.fn(),
  syncPromptAnswerObservations: vi.fn(),
  syncTrackedPrompts: vi.fn(),
  syncTrackedEntities: vi.fn(),
}));

function setTenant(t: string) {
  tenantIdMock.mockResolvedValue(t);
  readStoreMock.mockImplementation((name: string) =>
    Promise.resolve(name === "tracked-prompts" ? [{ id: `${t}-p` }] : []),
  );
}

describe("canonical-store module getters — per-tenant cache", () => {
  beforeEach(() => {
    vi.resetModules();
    readStoreMock.mockReset();
    tenantIdMock.mockReset();
  });

  it("TENANT ISOLATION: getTrackedPrompts returns the ACTIVE tenant's rows, not the first tenant's", async () => {
    const mod = await import("@/storage/canonical-store");
    mod._resetCanonicalStoreStateForTests();

    setTenant("tenant-a");
    const a = await mod.getTrackedPrompts();
    setTenant("tenant-b");
    const b = await mod.getTrackedPrompts();

    expect(a.map((p) => (p as { id: string }).id)).toEqual(["tenant-a-p"]);
    expect(b.map((p) => (p as { id: string }).id)).toEqual(["tenant-b-p"]); // pre-fix: ["tenant-a-p"]
  });

  it("same tenant reuses the cache (tracked-prompts read once across getters)", async () => {
    const mod = await import("@/storage/canonical-store");
    mod._resetCanonicalStoreStateForTests();
    setTenant("tenant-a");
    await mod.getTrackedPrompts();
    await mod.getTrackedPrompts();
    await mod.getTrackedEntities();
    const promptReads = readStoreMock.mock.calls.filter((c) => c[0] === "tracked-prompts").length;
    expect(promptReads).toBe(1);
  });
});
