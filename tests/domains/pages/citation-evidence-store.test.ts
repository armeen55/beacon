/**
 * Phase 7.8e-4a (2026-04-26) → night-shift rewrite (2026-06-11) —
 * citation-evidence-store is now PER-TENANT and repository-routed.
 *
 * Pins:
 *   - First call hydrates via getRepository().forTenant(currentTenantId()).
 *   - Subsequent calls for the SAME tenant reuse the cache (one read).
 *   - DIFFERENT tenants get their own reads + values — the first tenant
 *     can no longer pin its index for everyone in a warm process (the
 *     pre-rewrite bug).
 *   - null is a cached loaded-state (one read, not two).
 *   - Repository throw → soft-null (surfaces degrade, never crash).
 *   - refreshCitationEvidenceStore() re-reads the current tenant only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const repoRead = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (tenantId: string) => ({
      getCitationEvidenceIndex: () => repoRead(tenantId),
    }),
  }),
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantIdMock(),
}));

function idx(built_at: string) {
  return { built_at, by_page_and_topic: [], by_topic: [], page_to_topics: {}, total_citations_processed: 0 };
}

describe("citation-evidence-store — per-tenant repository-routed getter", () => {
  beforeEach(() => {
    vi.resetModules();
    repoRead.mockReset();
    tenantIdMock.mockReset();
    tenantIdMock.mockResolvedValue("tenant-a");
  });

  it("first call hydrates via the tenant-scoped repository", async () => {
    repoRead.mockResolvedValueOnce(idx("2026-06-11T00:00:00Z"));
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    const out = await mod.getCitationEvidenceIndex();
    expect(repoRead).toHaveBeenCalledTimes(1);
    expect(repoRead).toHaveBeenCalledWith("tenant-a");
    expect(out?.built_at).toBe("2026-06-11T00:00:00Z");
  });

  it("same tenant reuses the cache (one read)", async () => {
    repoRead.mockResolvedValueOnce(idx("x"));
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    await mod.getCitationEvidenceIndex();
    await mod.getCitationEvidenceIndex();
    expect(repoRead).toHaveBeenCalledTimes(1);
  });

  it("TENANT ISOLATION: tenant B gets its own read + value, not tenant A's", async () => {
    repoRead
      .mockResolvedValueOnce(idx("a-index"))
      .mockResolvedValueOnce(idx("b-index"));
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();

    tenantIdMock.mockResolvedValue("tenant-a");
    const a = await mod.getCitationEvidenceIndex();
    tenantIdMock.mockResolvedValue("tenant-b");
    const b = await mod.getCitationEvidenceIndex();

    expect(a?.built_at).toBe("a-index");
    expect(b?.built_at).toBe("b-index"); // pre-rewrite: returned "a-index"
    expect(repoRead).toHaveBeenNthCalledWith(1, "tenant-a");
    expect(repoRead).toHaveBeenNthCalledWith(2, "tenant-b");
  });

  it("caches a null loaded-state (one read, not two)", async () => {
    repoRead.mockResolvedValueOnce(null);
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    expect(await mod.getCitationEvidenceIndex()).toBeNull();
    expect(await mod.getCitationEvidenceIndex()).toBeNull();
    expect(repoRead).toHaveBeenCalledTimes(1);
  });

  it("repository throw → soft null (surfaces degrade, never crash)", async () => {
    repoRead.mockRejectedValueOnce(new Error("table missing"));
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    expect(await mod.getCitationEvidenceIndex()).toBeNull();
  });

  it("refreshCitationEvidenceStore() re-reads the current tenant", async () => {
    repoRead
      .mockResolvedValueOnce(idx("first"))
      .mockResolvedValueOnce(idx("second"));
    const mod = await import("@/domains/pages/citation-evidence-store");
    mod._resetCitationEvidenceForTests();
    expect((await mod.getCitationEvidenceIndex())?.built_at).toBe("first");
    await mod.refreshCitationEvidenceStore();
    expect((await mod.getCitationEvidenceIndex())?.built_at).toBe("second");
    expect(repoRead).toHaveBeenCalledTimes(2);
  });
});
