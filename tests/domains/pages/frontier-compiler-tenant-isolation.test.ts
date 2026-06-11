/**
 * 2026-06-11 (night shift) — frontier-compiler store TENANT ISOLATION.
 * frontier-attack-packages + tracked-missing-pages are both TENANT_SCOPED,
 * but the module held ONE process-global `const _state` object keyed by
 * NOTHING: the first tenant's data pinned for every later tenant in a warm
 * process (the `const _state` object form the `let _state` sweep missed).
 * Per-tenant Map now. Pins: hydrate-once, same-tenant reuse, cross-tenant
 * non-leak (both arrays).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FrontierAttackPackage, TrackedMissingPage } from "@/domains/pages/frontier-compiler";

vi.mock("server-only", () => ({}));
const apMock = vi.hoisted(() => vi.fn());
const tmpMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/json-store", () => ({ writeStore: vi.fn() }));
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    getFrontierAttackPackages: () => apMock(),
    getTrackedMissingPages: () => tmpMock(),
  }),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: () => tenantIdMock() }));

const ap = (id: string) => ({ frontierAttackPackageId: id }) as unknown as FrontierAttackPackage;
const tmp = (id: string) => ({ missingPagePlanId: id }) as unknown as TrackedMissingPage;

describe("frontier-compiler — per-tenant cache", () => {
  beforeEach(() => {
    vi.resetModules();
    apMock.mockReset(); tmpMock.mockReset(); tenantIdMock.mockReset();
    tenantIdMock.mockResolvedValue("tenant-a");
  });

  it("hydrates once, reuses for same tenant", async () => {
    apMock.mockResolvedValueOnce([ap("a1")]); tmpMock.mockResolvedValueOnce([tmp("m1")]);
    const mod = await import("@/domains/pages/frontier-compiler");
    mod._resetFrontierCompilerForTests();
    await mod.getAttackPackages();
    await mod.getTrackedMissingPages();
    await mod.getAttackPackages();
    expect(apMock).toHaveBeenCalledTimes(1);
    expect(tmpMock).toHaveBeenCalledTimes(1);
  });

  it("TENANT ISOLATION: tenant B gets its own packages + pages, not A's", async () => {
    apMock.mockResolvedValueOnce([ap("a1")]).mockResolvedValueOnce([ap("b1")]);
    tmpMock.mockResolvedValueOnce([tmp("ma")]).mockResolvedValueOnce([tmp("mb")]);
    const mod = await import("@/domains/pages/frontier-compiler");
    mod._resetFrontierCompilerForTests();

    tenantIdMock.mockResolvedValue("tenant-a");
    const aPkg = await mod.getAttackPackages();
    const aPages = await mod.getTrackedMissingPages();
    tenantIdMock.mockResolvedValue("tenant-b");
    const bPkg = await mod.getAttackPackages();
    const bPages = await mod.getTrackedMissingPages();

    expect(aPkg.map((p) => p.frontierAttackPackageId)).toEqual(["a1"]);
    expect(bPkg.map((p) => p.frontierAttackPackageId)).toEqual(["b1"]); // pre-fix: ["a1"]
    expect(aPages.map((p) => p.missingPagePlanId)).toEqual(["ma"]);
    expect(bPages.map((p) => p.missingPagePlanId)).toEqual(["mb"]); // pre-fix: ["ma"]
  });
});
