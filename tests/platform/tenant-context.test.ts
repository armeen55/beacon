/**
 * PLATFORM — tenant-context resolver (Core 100K terminal suite; merged from
 * tests/lib/tenant-context and tests/lib/tenant-context-slug-fallback).
 *
 * Pins: header > env resolution, fail-loud when neither exists,
 * runWithTenant override wins without memo bleed, and the slug resolver's
 * registry-first / env-fallback contract (the Vercel build path).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockState = vi.hoisted(() => ({ headers: new Map<string, string>(), headersThrow: false }));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (mockState.headersThrow) throw new Error("headers() called outside a request context");
    return { get: (key: string) => mockState.headers.get(key.toLowerCase()) ?? null };
  },
}));

const getTenantMock = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
vi.mock("@/domains/tenants/store", () => ({
  getTenant: getTenantMock,
  getTenantOrThrow: vi.fn(async () => {
    throw new Error("not used in these tests");
  }),
}));

async function loadResolver() {
  vi.resetModules();
  return await import("@/lib/tenant-context");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockState.headers = new Map();
  mockState.headersThrow = false;
  getTenantMock.mockReset();
  getTenantMock.mockResolvedValue({ id: "any", slug: "stub" });
  process.env = { ...ORIGINAL_ENV };
  delete process.env.BEACON_TENANT_ID;
  delete process.env.BEACON_TENANT_SLUG;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("currentTenantId resolution order", () => {
  it("the x-beacon-tenant header wins over the env var", async () => {
    mockState.headers = new Map([["x-beacon-tenant", "tenant-acme"]]);
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    const { currentTenantId } = await loadResolver();
    expect(await currentTenantId()).toBe("tenant-acme");
  });

  it("falls back to BEACON_TENANT_ID when no header, and is stable across calls", async () => {
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    const { currentTenantId } = await loadResolver();
    expect(await currentTenantId()).toBe("tenant-ritz-founder");
    expect(await currentTenantId()).toBe("tenant-ritz-founder");
  });

  it("throws fail-loud when neither header nor env is set", async () => {
    const { currentTenantId } = await loadResolver();
    await expect(currentTenantId()).rejects.toThrow(/no x-beacon-tenant header and no BEACON_TENANT_ID/);
  });
});

describe("runWithTenant explicit override", () => {
  it("the override wins over BOTH header and env, and clears outside the scope", async () => {
    mockState.headers = new Map([["x-beacon-tenant", "tenant-ritz-founder"]]);
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    const { currentTenantId, runWithTenant } = await loadResolver();
    await runWithTenant("tenant-iranopedia", async () => {
      expect(await currentTenantId()).toBe("tenant-iranopedia");
    });
    expect(await currentTenantId()).toBe("tenant-ritz-founder");
  });

  it("warming tenant A then tenant B in one request resolves EACH correctly (no memo bleed)", async () => {
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    const { currentTenantId, runWithTenant } = await loadResolver();
    const seen: string[] = [];
    for (const id of ["tenant-ritz-founder", "tenant-iranopedia"]) {
      await runWithTenant(id, async () => {
        seen.push(await currentTenantId());
      });
    }
    expect(seen).toEqual(["tenant-ritz-founder", "tenant-iranopedia"]);
  });
});

describe("currentTenantSlug registry-first with env fallback (the Vercel path)", () => {
  beforeEach(() => {
    mockState.headersThrow = true; // CLI/build context: headers() throws
  });

  it("returns the registry slug when the registry has the tenant (env slug ignored)", async () => {
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    process.env.BEACON_TENANT_SLUG = "WRONG-IF-USED";
    getTenantMock.mockResolvedValue({ id: "tenant-ritz-founder", slug: "ritz-builders" });
    const { currentTenantSlug } = await loadResolver();
    expect(await currentTenantSlug()).toBe("ritz-builders");
  });

  it("falls back to BEACON_TENANT_SLUG when the registry misses and the ids match", async () => {
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    process.env.BEACON_TENANT_SLUG = "ritz-builders";
    getTenantMock.mockResolvedValue(null);
    const { currentTenantSlug } = await loadResolver();
    expect(await currentTenantSlug()).toBe("ritz-builders");
  });

  it("throws naming BEACON_TENANT_SLUG when the registry misses and no env slug exists", async () => {
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    getTenantMock.mockResolvedValue(null);
    const { currentTenantSlug } = await loadResolver();
    await expect(currentTenantSlug()).rejects.toThrow(/BEACON_TENANT_SLUG/);
  });
});

describe("slugForTenantId (explicit-id sibling for background writers)", () => {
  beforeEach(() => {
    mockState.headersThrow = true;
  });

  it("resolves the registry slug for the given id without ambient resolution", async () => {
    getTenantMock.mockResolvedValue({ id: "tenant-b", slug: "acme" });
    const { slugForTenantId } = await loadResolver();
    expect(await slugForTenantId("tenant-b")).toBe("acme");
    expect(getTenantMock).toHaveBeenCalledWith("tenant-b");
  });

  it("falls back to env ONLY when the GIVEN id matches BEACON_TENANT_ID; otherwise throws", async () => {
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    process.env.BEACON_TENANT_SLUG = "ritz-builders";
    getTenantMock.mockResolvedValue(null);
    const { slugForTenantId } = await loadResolver();
    expect(await slugForTenantId("tenant-ritz-founder")).toBe("ritz-builders");
    await expect(slugForTenantId("tenant-unrelated")).rejects.toThrow(/tenant-unrelated/);
  });
});
