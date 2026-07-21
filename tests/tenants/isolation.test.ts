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
  getObservationRunsForTenant,
} from "@/lib/tenant-data";
import { getTenantOrThrow, listTenants } from "@/domains/tenants/store";

const FOUNDER = "tenant-ritz-founder";
const NONEXISTENT = "tenant-does-not-exist";

// ---------------------------------------------------------------------------
// Tenant store
// ---------------------------------------------------------------------------

describe("tenant store", () => {
  it("lists at least the founder tenant", async () => {
    const tenants = await listTenants();
    expect(tenants.length).toBeGreaterThanOrEqual(1);
    expect(tenants.some((t) => t.id === FOUNDER)).toBe(true);
  });

  it("getTenantOrThrow returns the founder tenant", async () => {
    const tenant = await getTenantOrThrow(FOUNDER);
    expect(tenant.id).toBe(FOUNDER);
    expect(tenant.business_name).toBe("Ritz Builders");
    expect(tenant.role).toBe("founder");
  });

  it("getTenantOrThrow throws a clear error for nonexistent tenant", async () => {
    await expect(getTenantOrThrow(NONEXISTENT)).rejects.toThrowError(
      /Unknown tenant.*tenant-does-not-exist/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tenant data isolation
// ---------------------------------------------------------------------------

describe("tenant data isolation — founder tenant", () => {
  it("getChangesForTenant returns only founder data", async () => {
    const changes = await getChangesForTenant(FOUNDER);
    // The backfill stamped all existing data with FOUNDER
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      expect(c.tenant_id).toBe(FOUNDER);
    }
  });

  it("getResultsForTenant returns only founder data", async () => {
    const results = await getResultsForTenant(FOUNDER);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.tenant_id).toBe(FOUNDER);
    }
  });

  it("getSnapshotsForTenant returns only founder data", async () => {
    const snapshots = await getSnapshotsForTenant(FOUNDER);
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) {
      expect(s.tenant_id).toBe(FOUNDER);
    }
  });

  it("getFindingsForTenant returns only founder data", async () => {
    const findings = await getFindingsForTenant(FOUNDER);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.tenant_id).toBe(FOUNDER);
    }
  });

  it("getPagesForTenant returns only founder data", async () => {
    const pages = await getPagesForTenant(FOUNDER);
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p.tenant_id).toBe(FOUNDER);
    }
  });

  it("getObservationRunsForTenant returns only founder data", async () => {
    const runs = await getObservationRunsForTenant(FOUNDER);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.tenant_id).toBe(FOUNDER);
    }
  });
});

describe("tenant data isolation — nonexistent tenant returns empty", () => {
  it("getChangesForTenant returns empty for unknown tenant", async () => {
    expect(await getChangesForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getResultsForTenant returns empty for unknown tenant", async () => {
    expect(await getResultsForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getSnapshotsForTenant returns empty for unknown tenant", async () => {
    expect(await getSnapshotsForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getFindingsForTenant returns empty for unknown tenant", async () => {
    expect(await getFindingsForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getPagesForTenant returns empty for unknown tenant", async () => {
    expect(await getPagesForTenant(NONEXISTENT)).toEqual([]);
  });

  it("getObservationRunsForTenant returns empty for unknown tenant", async () => {
    expect(await getObservationRunsForTenant(NONEXISTENT)).toEqual([]);
  });
});

describe("tenant data isolation — no cross-tenant leaks", () => {
  it("querying two different tenant IDs returns disjoint sets", async () => {
    const founderChanges = await getChangesForTenant(FOUNDER);
    const otherChanges = await getChangesForTenant("tenant-other-test");

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
