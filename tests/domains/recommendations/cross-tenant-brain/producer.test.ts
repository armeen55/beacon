/**
 * 2026-05-26 Phase A.2 (Section 3.2 / E1) — cross-tenant producer tests.
 * Synthetic multi-tenant fixtures; gate forced via injected deps.
 */

import { describe, it, expect } from "vitest";
import { computeCrossTenantPatterns } from "@/domains/recommendations/cross-tenant-brain/producer";
import type { CrossTenantProducerDeps } from "@/domains/recommendations/cross-tenant-brain/producer";
import type { CrossTenantEditOutcome } from "@/domains/recommendations/cross-tenant-brain/aggregate";

const SELF = "tenant-self";

function args(overrides: Partial<Parameters<typeof computeCrossTenantPatterns>[0]> = {}) {
  return {
    tenantId: SELF,
    actionTypes: [] as ReadonlyArray<string>,
    clusterKind: null,
    clusterLabel: null,
    ...overrides,
  };
}

function deps(over: Partial<CrossTenantProducerDeps> = {}): CrossTenantProducerDeps {
  return {
    isEnabled: () => true,
    listTenants: async () => [{ id: SELF }, { id: "t1" }, { id: "t2" }],
    loadOutcomesForTenant: async (id) => {
      const helped: CrossTenantEditOutcome[] = [];
      for (let i = 0; i < 3; i++) {
        helped.push({ tenantId: id, matchKey: "edit_type:add_h2_section", helped: true });
      }
      return helped;
    },
    buildBlocklist: async () => [],
    ...over,
  };
}

describe("computeCrossTenantPatterns — gate", () => {
  it("returns [] when the gate is OFF (no reads)", async () => {
    let listed = false;
    const out = await computeCrossTenantPatterns(
      args(),
      deps({
        isEnabled: () => false,
        listTenants: async () => {
          listed = true;
          return [{ id: "t1" }];
        },
      }),
    );
    expect(out).toEqual([]);
    expect(listed).toBe(false); // gate short-circuits before any read
  });
});

describe("computeCrossTenantPatterns — exclude-self / n=1", () => {
  it("returns [] when the requester is the only tenant", async () => {
    const out = await computeCrossTenantPatterns(
      args(),
      deps({ listTenants: async () => [{ id: SELF }] }),
    );
    expect(out).toEqual([]);
  });

  it("excludes the requesting tenant's own outcomes from the aggregate", async () => {
    let loadedSelf = false;
    const out = await computeCrossTenantPatterns(
      args(),
      deps({
        listTenants: async () => [{ id: SELF }, { id: "t1" }, { id: "t2" }],
        loadOutcomesForTenant: async (id) => {
          if (id === SELF) loadedSelf = true;
          return [{ tenantId: id, matchKey: "edit_type:add_h2_section", helped: true }];
        },
      }),
    );
    // SELF is filtered out of the tenant list → never loaded.
    expect(loadedSelf).toBe(false);
    expect(out).toEqual([]); // only 2 other tenants × 1 each = 2 ships < gate(5)
  });
});

describe("computeCrossTenantPatterns — aggregation", () => {
  it("aggregates across tenants and emits a pattern above the sample gate", async () => {
    // 6 tenants, 1 helped ship each = 6 ships >= 5 → one pattern.
    const out = await computeCrossTenantPatterns(
      args(),
      deps({
        listTenants: async () =>
          Array.from({ length: 7 }, (_, i) => ({ id: i === 0 ? SELF : `t${i}` })),
        loadOutcomesForTenant: async (id) => [
          { tenantId: id, matchKey: "edit_type:add_h2_section", helped: true },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.sampleSize).toBe(6); // self excluded
    expect(out[0]!.helpingRate).toBe(1);
    expect(out[0]!.matchKey).toBe("edit_type:add_h2_section");
  });

  it("returns [] when no other tenant has outcomes", async () => {
    const out = await computeCrossTenantPatterns(
      args(),
      deps({ loadOutcomesForTenant: async () => [] }),
    );
    expect(out).toEqual([]);
  });
});

describe("computeCrossTenantPatterns — fault tolerance", () => {
  it("returns [] (never throws) when a dep rejects", async () => {
    const out = await computeCrossTenantPatterns(
      args(),
      deps({
        loadOutcomesForTenant: async () => {
          throw new Error("read failed");
        },
      }),
    );
    expect(out).toEqual([]);
  });

  it("returns [] when listTenants rejects", async () => {
    const out = await computeCrossTenantPatterns(
      args(),
      deps({
        listTenants: async () => {
          throw new Error("enumerate failed");
        },
      }),
    );
    expect(out).toEqual([]);
  });
});
