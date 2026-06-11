/**
 * 2026-06-11 (night shift) — brief-states store TENANT ISOLATION.
 *
 * This store held a process-global `let _state` keyed by NOTHING, so in
 * a warm multi-tenant process the FIRST tenant pinned its brief states
 * for every later tenant (cross-pin). The read is ambient-routed per
 * tenant on disk, which MASKED the leak until a 2nd tenant hit a warm
 * process — so no test ever caught it. Per-tenant Map now. These pins
 * freeze: first-call hydrate, same-tenant cache reuse, cross-tenant
 * non-leak, and the stable-ref-per-tenant contract updateBriefState()
 * depends on (it mutates the returned array in place).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PersistedBriefState } from "@/domains/brief-generation/types";

vi.mock("server-only", () => ({}));

const repoRead = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({ getBriefStates: () => repoRead() }),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantIdMock(),
}));

function bs(briefId: string): PersistedBriefState {
  return { briefId, status: "proposed", acceptedBriefId: null, updatedAt: "2026-06-11T00:00:00Z" };
}

describe("brief-states store — per-tenant cache", () => {
  beforeEach(() => {
    vi.resetModules();
    repoRead.mockReset();
    tenantIdMock.mockReset();
    tenantIdMock.mockResolvedValue("tenant-a");
  });

  it("first call hydrates from the repository once", async () => {
    repoRead.mockResolvedValueOnce([bs("a1")]);
    const mod = await import("@/domains/brief-generation/store");
    mod._resetBriefStatesForTests();
    const out = await mod.getBriefStates();
    expect(out.map((s) => s.briefId)).toEqual(["a1"]);
    expect(repoRead).toHaveBeenCalledTimes(1);
  });

  it("same tenant reuses the cache (one read)", async () => {
    repoRead.mockResolvedValueOnce([bs("a1")]);
    const mod = await import("@/domains/brief-generation/store");
    mod._resetBriefStatesForTests();
    await mod.getBriefStates();
    await mod.getBriefStates();
    expect(repoRead).toHaveBeenCalledTimes(1);
  });

  it("TENANT ISOLATION: tenant B gets its own rows, not tenant A's", async () => {
    repoRead.mockResolvedValueOnce([bs("a1")]).mockResolvedValueOnce([bs("b1")]);
    const mod = await import("@/domains/brief-generation/store");
    mod._resetBriefStatesForTests();

    tenantIdMock.mockResolvedValue("tenant-a");
    const a = await mod.getBriefStates();
    tenantIdMock.mockResolvedValue("tenant-b");
    const b = await mod.getBriefStates();

    expect(a.map((s) => s.briefId)).toEqual(["a1"]);
    expect(b.map((s) => s.briefId)).toEqual(["b1"]); // pre-fix: returned ["a1"]
    expect(repoRead).toHaveBeenCalledTimes(2);
  });

  it("returns a STABLE per-tenant ref so in-place mutation persists (updateBriefState contract)", async () => {
    repoRead.mockResolvedValueOnce([]);
    const mod = await import("@/domains/brief-generation/store");
    mod._resetBriefStatesForTests();
    const first = await mod.getBriefStates();
    first.push(bs("pushed")); // updateBriefState mutates the returned array in place
    const second = await mod.getBriefStates();
    expect(second.map((s) => s.briefId)).toEqual(["pushed"]);
    expect(repoRead).toHaveBeenCalledTimes(1); // no re-read
  });
});
