import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * answer-intelligence/store.test (Codex P2, 2026-07-09). Pins the tenant-EXPLICIT
 * read `getAnswerIntelligenceIndexForTenant`: it threads the caller-supplied
 * tenant straight to getRepository().forTenant(tenantId) (never the ambient
 * currentTenantId), keeps two tenants' indices apart, and FAILS CLOSED on an
 * unresolved tenant (empty tenantId -> null, no repository read at all).
 */

const forTenantMock = vi.fn();
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({ forTenant: forTenantMock }),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-ambient"),
}));

import {
  getAnswerIntelligenceIndexForTenant,
  _resetAnswerIntelligenceForTests,
} from "./store";
import type { AnswerIntelligenceIndex } from "./types";

function indexFor(tenantId: string): AnswerIntelligenceIndex {
  return { tenant_id: tenantId, total_observations: tenantId === "tenant-a" ? 111 : 222 } as unknown as AnswerIntelligenceIndex;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetAnswerIntelligenceForTests();
  forTenantMock.mockImplementation((tenantId: string) => ({
    getAnswerIntelligenceIndex: async () => (tenantId ? indexFor(tenantId) : null),
  }));
});

describe("getAnswerIntelligenceIndexForTenant", () => {
  it("reads the EXPLICIT tenant's index (never the ambient currentTenantId)", async () => {
    const idx = await getAnswerIntelligenceIndexForTenant("tenant-a");
    expect(forTenantMock).toHaveBeenCalledWith("tenant-a");
    expect(idx?.tenant_id).toBe("tenant-a");
    expect(idx?.total_observations).toBe(111);
  });

  it("keeps two tenants' indices apart (A never returns B's)", async () => {
    const a = await getAnswerIntelligenceIndexForTenant("tenant-a");
    const b = await getAnswerIntelligenceIndexForTenant("tenant-b");
    expect(a?.total_observations).toBe(111);
    expect(b?.total_observations).toBe(222);
  });

  it("fails CLOSED on an empty tenantId: returns null and never touches the repository", async () => {
    const idx = await getAnswerIntelligenceIndexForTenant("");
    expect(idx).toBeNull();
    expect(forTenantMock).not.toHaveBeenCalled();
  });
});
