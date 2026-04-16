/**
 * Tenant isolation test harness — CX1.9.
 *
 * Verifies that the tenant-filtered data adapters in tenant-data.ts
 * never leak data across tenants. Also verifies that the tenant store
 * itself works correctly.
 *
 * These tests are load-bearing: if they fail, tenant isolation is broken
 * and no downstream phase should advance.
 */

import { describe, it, expect } from "vitest";
import {
  getResultsForTenant,
  getChangesForTenant,
  getOpportunitiesForTenant,
  getCompetitorsForTenant,
  getFindingsForTenant,
  getPagesForTenant,
  getSnapshotsForTenant,
  getOutcomesForTenant,
  getObservationRunsForTenant,
} from "@/lib/tenant-data";
import { getTenantOrThrow, listTenants } from "@/domains/tenants/store";

const FOUNDER = "tenant-ritz-founder";
const NONEXISTENT = "tenant-does-not-exist";

// ---------------------------------------------------------------------------
// Tenant store
// ---------------------------------------------------------------------------

describe("tenant store", () => {
  it("lists at least the founder tenant", () => {
    const tenants = listTenants();
    expect(tenants.length).toBeGreaterThanOrEqual(1);
    expect(tenants.some((t) => t.id === FOUNDER)).toBe(true);
  });

  it("getTenantOrThrow returns the founder tenant", () => {
    const tenant = getTenantOrThrow(FOUNDER);
    expect(tenant.id).toBe(FOUNDER);
    expect(tenant.business_name).toBe("Ritz Builders");
    expect(tenant.role).toBe("founder");
  });

  it("getTenantOrThrow throws a clear error for nonexistent tenant", () => {
    expect(() => getTenantOrThrow(NONEXISTENT)).toThrowError(
      /Unknown tenant.*tenant-does-not-exist/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tenant data isolation
// ---------------------------------------------------------------------------

describe("tenant data isolation — founder tenant", () => {
  it("getChangesForTenant returns only founder data", () => {
    const changes = getChangesForTenant(FOUNDER);
    // The backfill stamped all existing data with FOUNDER
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      expect(c.tenant_id).toBe(FOUNDER);
    }
  });

  it("getResultsForTenant returns only founder data", () => {
    const results = getResultsForTenant(FOUNDER);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.tenant_id).toBe(FOUNDER);
    }
  });

  it("getSnapshotsForTenant returns only founder data", () => {
    const snapshots = getSnapshotsForTenant(FOUNDER);
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) {
      expect(s.tenant_id).toBe(FOUNDER);
    }
  });

  it("getFindingsForTenant returns only founder data", () => {
    const findings = getFindingsForTenant(FOUNDER);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.tenant_id).toBe(FOUNDER);
    }
  });

  it("getPagesForTenant returns only founder data", () => {
    const pages = getPagesForTenant(FOUNDER);
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p.tenant_id).toBe(FOUNDER);
    }
  });

  it("getOutcomesForTenant returns only founder data", () => {
    const outcomes = getOutcomesForTenant(FOUNDER);
    expect(outcomes.length).toBeGreaterThan(0);
    for (const o of outcomes) {
      expect(o.tenant_id).toBe(FOUNDER);
    }
  });

  it("getObservationRunsForTenant returns only founder data", () => {
    const runs = getObservationRunsForTenant(FOUNDER);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.tenant_id).toBe(FOUNDER);
    }
  });
});

describe("tenant data isolation — nonexistent tenant returns empty", () => {
  it("getChangesForTenant returns empty for unknown tenant", () => {
    expect(getChangesForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getResultsForTenant returns empty for unknown tenant", () => {
    expect(getResultsForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getSnapshotsForTenant returns empty for unknown tenant", () => {
    expect(getSnapshotsForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getFindingsForTenant returns empty for unknown tenant", () => {
    expect(getFindingsForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getPagesForTenant returns empty for unknown tenant", () => {
    expect(getPagesForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getOutcomesForTenant returns empty for unknown tenant", () => {
    expect(getOutcomesForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getObservationRunsForTenant returns empty for unknown tenant", () => {
    expect(getObservationRunsForTenant(NONEXISTENT)).toEqual([]);
  });
});

describe("tenant data isolation — no cross-tenant leaks", () => {
  it("querying two different tenant IDs returns disjoint sets", () => {
    const founderChanges = getChangesForTenant(FOUNDER);
    const otherChanges = getChangesForTenant("tenant-other-test");

    // Founder has data, other has none (no records with that tenant_id)
    expect(founderChanges.length).toBeGreaterThan(0);
    expect(otherChanges.length).toBe(0);

    // No overlap
    const founderIds = new Set(founderChanges.map((c) => c.id));
    for (const c of otherChanges) {
      expect(founderIds.has(c.id)).toBe(false);
    }
  });
});
