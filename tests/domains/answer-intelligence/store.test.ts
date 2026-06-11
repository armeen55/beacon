/**
 * Phase 7.8e-4b (2026-04-26) → night-shift rewrite (2026-06-11) —
 * answer-intelligence store is now PER-TENANT and repository-routed.
 * Mirrors tests/domains/pages/citation-evidence-store.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const repoRead = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (tenantId: string) => ({
      getAnswerIntelligenceIndex: () => repoRead(tenantId),
    }),
  }),
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantIdMock(),
}));

const stubIndex = (built_at: string) => ({ built_at });

describe("answer-intelligence store — per-tenant repository-routed getter", () => {
  beforeEach(() => {
    vi.resetModules();
    repoRead.mockReset();
    tenantIdMock.mockReset();
    tenantIdMock.mockResolvedValue("tenant-a");
  });

  it("first call hydrates via the tenant-scoped repository", async () => {
    repoRead.mockResolvedValueOnce(stubIndex("2026-06-11"));
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    const out = await mod.getAnswerIntelligenceIndex();
    expect(repoRead).toHaveBeenCalledTimes(1);
    expect(repoRead).toHaveBeenCalledWith("tenant-a");
    expect(out?.built_at).toBe("2026-06-11");
  });

  it("same tenant reuses the cache (one read)", async () => {
    repoRead.mockResolvedValueOnce(stubIndex("x"));
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    await mod.getAnswerIntelligenceIndex();
    await mod.getAnswerIntelligenceIndex();
    expect(repoRead).toHaveBeenCalledTimes(1);
  });

  it("TENANT ISOLATION: tenant B gets its own read + value, not tenant A's", async () => {
    repoRead
      .mockResolvedValueOnce(stubIndex("a-index"))
      .mockResolvedValueOnce(stubIndex("b-index"));
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    tenantIdMock.mockResolvedValue("tenant-a");
    const a = await mod.getAnswerIntelligenceIndex();
    tenantIdMock.mockResolvedValue("tenant-b");
    const b = await mod.getAnswerIntelligenceIndex();
    expect(a?.built_at).toBe("a-index");
    expect(b?.built_at).toBe("b-index"); // pre-rewrite: returned "a-index"
  });

  it("caches a null loaded-state (one read, not two)", async () => {
    repoRead.mockResolvedValueOnce(null);
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    expect(await mod.getAnswerIntelligenceIndex()).toBeNull();
    expect(await mod.getAnswerIntelligenceIndex()).toBeNull();
    expect(repoRead).toHaveBeenCalledTimes(1);
  });

  it("repository throw → soft null (surfaces degrade, never crash)", async () => {
    repoRead.mockRejectedValueOnce(new Error("table missing"));
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    expect(await mod.getAnswerIntelligenceIndex()).toBeNull();
  });

  it("refreshAnswerIntelligenceStore() re-reads the current tenant", async () => {
    repoRead
      .mockResolvedValueOnce(stubIndex("first"))
      .mockResolvedValueOnce(stubIndex("second"));
    const mod = await import("@/domains/answer-intelligence/store");
    mod._resetAnswerIntelligenceForTests();
    expect((await mod.getAnswerIntelligenceIndex())?.built_at).toBe("first");
    await mod.refreshAnswerIntelligenceStore();
    expect((await mod.getAnswerIntelligenceIndex())?.built_at).toBe("second");
  });
});
