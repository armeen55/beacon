/**
 * 2026-06-11 (night shift) — explicit visibility-observation store
 * TENANT ISOLATION. Held a process-global `let _state` keyed by NOTHING:
 * the first tenant's runs pinned for every later tenant in a warm
 * process. Ambient-routed disk read masked the leak (no test caught it).
 * Per-tenant Map now. Pins: hydrate-once, same-tenant reuse, cross-tenant
 * non-leak.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";

const repoRead = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({ getVisibilityObservationRunsExplicit: () => repoRead() }),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantIdMock(),
}));

function run(run_id: string): VisibilityObservationRun {
  return { run_id, run_type: "composite", source: "test", status: "completed",
    started_at: "2026-06-11T00:00:00Z", completed_at: "2026-06-11T00:01:00Z",
    scope_label: "x" } as unknown as VisibilityObservationRun;
}

describe("visibility-observation-explicit store — per-tenant cache", () => {
  beforeEach(() => {
    vi.resetModules();
    repoRead.mockReset();
    tenantIdMock.mockReset();
    tenantIdMock.mockResolvedValue("tenant-a");
  });

  it("first call hydrates from the repository once", async () => {
    repoRead.mockResolvedValueOnce([run("a1")]);
    const mod = await import("@/domains/observations/visibility-observation-explicit-store");
    mod._resetVisibilityObservationRunsExplicitForTests();
    const out = await mod.getVisibilityObservationRunsExplicit();
    expect(out.map((r) => r.run_id)).toEqual(["a1"]);
    expect(repoRead).toHaveBeenCalledTimes(1);
  });

  it("same tenant reuses the cache (one read)", async () => {
    repoRead.mockResolvedValueOnce([run("a1")]);
    const mod = await import("@/domains/observations/visibility-observation-explicit-store");
    mod._resetVisibilityObservationRunsExplicitForTests();
    await mod.getVisibilityObservationRunsExplicit();
    await mod.getVisibilityObservationRunsExplicit();
    expect(repoRead).toHaveBeenCalledTimes(1);
  });

  it("TENANT ISOLATION: tenant B gets its own runs, not tenant A's", async () => {
    repoRead.mockResolvedValueOnce([run("a1")]).mockResolvedValueOnce([run("b1")]);
    const mod = await import("@/domains/observations/visibility-observation-explicit-store");
    mod._resetVisibilityObservationRunsExplicitForTests();

    tenantIdMock.mockResolvedValue("tenant-a");
    const a = await mod.getVisibilityObservationRunsExplicit();
    tenantIdMock.mockResolvedValue("tenant-b");
    const b = await mod.getVisibilityObservationRunsExplicit();

    expect(a.map((r) => r.run_id)).toEqual(["a1"]);
    expect(b.map((r) => r.run_id)).toEqual(["b1"]); // pre-fix: returned ["a1"]
    expect(repoRead).toHaveBeenCalledTimes(2);
  });
});
