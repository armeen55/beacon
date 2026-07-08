/**
 * warmFreeSurfaces (2026-07-08) - the FREE cache-warm subset called right after
 * a manual "Update data" refresh so the post-refresh repaint is warm, not a cold
 * ~6s demand-graph rebuild. Pins the composition contract:
 *   - runs exactly the 3 free surfaces (demand-graph -> worklist -> today),
 *   - in dependency order,
 *   - NONE of the paid nightly-only steps (displacement / steal / teardown /
 *     prepare-ahead) are touched,
 *   - fail-soft: one failed surface never stops the next.
 * Mocks the dynamically-imported builders so no Supabase / graph build / FS runs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const calls: string[] = [];

vi.mock("@/domains/demand-graph/load-graph", () => ({
  loadDemandGraphForTenant: vi.fn(async () => {
    calls.push("graph:build");
    return { nodes: [] };
  }),
}));
vi.mock("@/domains/demand-graph/graph-snapshot-store", () => ({
  writeGraphSnapshot: vi.fn(async () => {
    calls.push("graph:write");
  }),
}));
vi.mock("@/app/(shell)/moves/moves-data", () => ({
  refreshWorklistSurface: vi.fn(async () => {
    calls.push("worklist");
  }),
}));
vi.mock("@/app/(shell)/today-view-data", () => ({
  refreshTodaySurface: vi.fn(async () => {
    calls.push("today");
  }),
}));

import { warmFreeSurfaces } from "@/domains/ops/warm-caches";

const TENANT = "tenant-iranopedia";

describe("warmFreeSurfaces", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("warms exactly the 3 free surfaces in dependency order", async () => {
    await warmFreeSurfaces(TENANT);
    // graph is built THEN persisted, before worklist, before today.
    expect(calls).toEqual(["graph:build", "graph:write", "worklist", "today"]);
  });

  it("never touches a paid nightly-only step (no displacement/steal/teardown/prepare)", async () => {
    await warmFreeSurfaces(TENANT);
    for (const c of calls) {
      expect(c).not.toMatch(/displacement|steal|teardown|prepare/i);
    }
  });

  it("is fail-soft: a failed surface never stops the next", async () => {
    const graph = await import("@/domains/demand-graph/load-graph");
    (graph.loadDemandGraphForTenant as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        throw new Error("graph build blew up");
      },
    );
    // Must not throw, and worklist + today still run despite the graph failure.
    await expect(warmFreeSurfaces(TENANT)).resolves.toBeUndefined();
    expect(calls).toContain("worklist");
    expect(calls).toContain("today");
  });
});
