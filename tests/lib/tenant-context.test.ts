/**
 * Sprint 7 Phase 7.3 (2026-04-25) — tests for the async cached tenant resolver.
 *
 * Covers:
 *   1. Header path — `x-beacon-tenant` returned when present.
 *   2. Env path — `BEACON_TENANT_ID` returned when no header (the
 *      production-today path until middleware lands in Phase 7.4).
 *   3. Throw path — neither header nor env → fail-loud.
 *   4. Cache path — repeated calls within a test re-use the resolution
 *      (smoke for `React.cache` integration; we can't directly observe
 *      cache hits but we can assert idempotency).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mutable state so mock and tests share one source of truth.
const mockState = vi.hoisted(() => ({ headers: new Map<string, string>() }));

// `headers()` is async in Next 16; the resolved object's `.get()` is sync.
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => mockState.headers.get(key.toLowerCase()) ?? null,
  }),
}));

// Stub the tenant store so resolver tests don't depend on `.data/tenants.json`.
vi.mock("@/domains/tenants/store", () => ({
  getTenantOrThrow: (id: string) => ({ id, slug: "stub", business_name: "stub" }),
  getTenant: (id: string) => ({ id, slug: "stub" }),
}));

// Re-import the resolver per test so React.cache scope is fresh.
async function loadResolver() {
  vi.resetModules();
  return await import("@/lib/tenant-context");
}

describe("Sprint 7 Phase 7.3 — currentTenantId resolver", () => {
  const ORIGINAL_ENV = process.env.BEACON_TENANT_ID;

  beforeEach(() => {
    mockState.headers = new Map();
  });

  afterEach(() => {
    if (ORIGINAL_ENV !== undefined) {
      process.env.BEACON_TENANT_ID = ORIGINAL_ENV;
    } else {
      delete process.env.BEACON_TENANT_ID;
    }
  });

  it("returns the x-beacon-tenant header value when set", async () => {
    mockState.headers = new Map([["x-beacon-tenant", "tenant-acme"]]);
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    const { currentTenantId } = await loadResolver();
    // Header takes precedence even though env is set.
    expect(await currentTenantId()).toBe("tenant-acme");
  });

  it("falls back to BEACON_TENANT_ID env var when no header", async () => {
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    const { currentTenantId } = await loadResolver();
    expect(await currentTenantId()).toBe("tenant-ritz-founder");
  });

  it("throws when neither header nor env is set", async () => {
    delete process.env.BEACON_TENANT_ID;
    const { currentTenantId } = await loadResolver();
    await expect(currentTenantId()).rejects.toThrow(
      /no x-beacon-tenant header and no BEACON_TENANT_ID/,
    );
  });

  it("returns the same value on repeated calls within a request scope (cache smoke)", async () => {
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    const { currentTenantId } = await loadResolver();
    const a = await currentTenantId();
    const b = await currentTenantId();
    expect(a).toBe(b);
    expect(a).toBe("tenant-ritz-founder");
  });
});
