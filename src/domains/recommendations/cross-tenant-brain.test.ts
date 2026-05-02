/**
 * W3 Step 3.2 (2026-05-01) — cross-tenant brain stub tests.
 *
 * Locks the contract: stub returns `[]` deterministically. Pure
 * compute, no I/O, no env reads. The signature is operator-locked
 * so the future producer can drop in without touching consumers.
 */

import { describe, expect, it } from "vitest";

import {
  getCrossTenantPatterns,
  type CrossTenantPattern,
  type GetCrossTenantPatternsArgs,
} from "./cross-tenant-brain";

describe("getCrossTenantPatterns — stub returns []", () => {
  it("returns [] for the simplest single-tenant args", () => {
    const result = getCrossTenantPatterns({
      tenantId: "tenant-test",
      actionTypes: ["edit_title", "add_h2_section", "add_faq"],
      clusterKind: "geo",
      clusterLabel: "Atherton",
    });
    expect(result).toEqual([]);
  });

  it("returns [] regardless of input shape", () => {
    const cases: GetCrossTenantPatternsArgs[] = [
      {
        tenantId: "t1",
        actionTypes: [],
        clusterKind: null,
        clusterLabel: null,
      },
      {
        tenantId: "t2",
        actionTypes: ["edit_title"],
        clusterKind: "topic",
        clusterLabel: "kitchen renovation",
      },
      {
        tenantId: "",
        actionTypes: ["a", "b", "c"],
        clusterKind: "geo",
        clusterLabel: "",
      },
    ];
    for (const args of cases) {
      expect(getCrossTenantPatterns(args)).toEqual([]);
    }
  });

  it("is deterministic — repeated calls return the same value (reference inequality OK)", () => {
    const a = getCrossTenantPatterns({
      tenantId: "tenant-test",
      actionTypes: [],
      clusterKind: null,
      clusterLabel: null,
    });
    const b = getCrossTenantPatterns({
      tenantId: "tenant-test",
      actionTypes: [],
      clusterKind: null,
      clusterLabel: null,
    });
    expect(a).toEqual(b);
  });

  it("returns a JSON-serializable array (locks the contract for the future producer)", () => {
    const result: CrossTenantPattern[] = getCrossTenantPatterns({
      tenantId: "tenant-test",
      actionTypes: ["edit_title"],
      clusterKind: "geo",
      clusterLabel: "Atherton",
    });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).toBe("[]");
  });
});
