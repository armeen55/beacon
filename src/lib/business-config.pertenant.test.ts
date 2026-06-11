/**
 * North-star onboarding (2026-06-11) — per-tenant config persistence.
 *
 * Pins the "later MT slice" that makes a stranger's saved config real:
 *   - saveBusinessConfig(tenantId, …) for a NON-env tenant writes
 *     .data/tenants/<tenantId>/business-config.json (pre-fix: cache-only,
 *     evaporated on restart) and dual-writes the per-tenant Supabase row
 *     (pre-fix: every tenant clobbered the id="current" singleton).
 *   - getBusinessConfigForCurrentTenant() falls through to the per-tenant
 *     Supabase row when env+files miss (the Vercel path), and memoizes a
 *     miss so placeholder renders don't hammer the table.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";

vi.mock("server-only", () => ({}));

const syncTenantMock = vi.hoisted(() => vi.fn(async () => {}));
const syncLegacyMock = vi.hoisted(() => vi.fn(async () => {}));
const maybeSingleMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/dual-write", () => ({
  syncBusinessConfig: syncLegacyMock,
  syncTenantBusinessConfig: syncTenantMock,
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantIdMock(),
}));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: maybeSingleMock }),
      }),
    }),
  }),
}));

import {
  saveBusinessConfig,
  getBusinessConfig,
  getBusinessConfigForCurrentTenant,
  isPlaceholderConfig,
  __resetBusinessConfigCacheForTests,
} from "./business-config";

const TENANT = "tenant-test-pertenant-cfg";
const TENANT_FILE = join(
  process.cwd(),
  ".data",
  "tenants",
  TENANT,
  "business-config.json",
);

beforeEach(() => {
  __resetBusinessConfigCacheForTests();
  syncTenantMock.mockClear();
  syncLegacyMock.mockClear();
  maybeSingleMock.mockReset();
  tenantIdMock.mockReset();
});

afterEach(() => {
  // Remove ONLY the test tenant's fixture dir (never real tenant data).
  rmSync(join(process.cwd(), ".data", "tenants", TENANT), {
    recursive: true,
    force: true,
  });
  __resetBusinessConfigCacheForTests();
});

describe("saveBusinessConfig — per-tenant persistence (non-env tenant)", () => {
  it("writes .data/tenants/<tenantId>/business-config.json and a fresh cache resolves from it", () => {
    saveBusinessConfig(TENANT, { name: "Taco Cielo", domain: "tacocielo.com" });
    expect(existsSync(TENANT_FILE)).toBe(true);
    const onDisk = JSON.parse(readFileSync(TENANT_FILE, "utf-8"));
    expect(onDisk.name).toBe("Taco Cielo");

    // Survives a "restart": clear the in-memory cache, resolve again.
    __resetBusinessConfigCacheForTests();
    const resolved = getBusinessConfig(TENANT);
    expect(resolved.name).toBe("Taco Cielo");
    expect(isPlaceholderConfig(resolved)).toBe(false);
  });

  it("dual-writes the PER-TENANT row (and NOT the legacy singleton) for a non-env tenant", () => {
    saveBusinessConfig(TENANT, { name: "Taco Cielo" });
    expect(syncTenantMock).toHaveBeenCalledTimes(1);
    expect(syncTenantMock).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ name: "Taco Cielo" }),
    );
    expect(syncLegacyMock).not.toHaveBeenCalled(); // singleton stays env-tenant-only
  });
});

describe("getBusinessConfigForCurrentTenant — Supabase hydrate fallback", () => {
  it("resolves the per-tenant Supabase row when env+files miss (the Vercel path)", async () => {
    tenantIdMock.mockResolvedValue(TENANT);
    maybeSingleMock.mockResolvedValue({
      data: { data: { name: "Hosted Taqueria", domain: "hosted.mx" } },
      error: null,
    });
    const cfg = await getBusinessConfigForCurrentTenant();
    expect(cfg.name).toBe("Hosted Taqueria");
    expect(isPlaceholderConfig(cfg)).toBe(false);
  });

  it("memoizes a miss — placeholder renders don't re-query the table", async () => {
    tenantIdMock.mockResolvedValue(TENANT);
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const first = await getBusinessConfigForCurrentTenant();
    const second = await getBusinessConfigForCurrentTenant();
    expect(isPlaceholderConfig(first)).toBe(true);
    expect(isPlaceholderConfig(second)).toBe(true);
    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
  });

  it("a save clears the miss-memo so the next hydrate sees the new row", async () => {
    tenantIdMock.mockResolvedValue(TENANT);
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    await getBusinessConfigForCurrentTenant(); // memoized miss
    saveBusinessConfig(TENANT, { name: "Now Exists" });
    __resetBusinessConfigCacheForTests(); // simulate a fresh lambda
    rmSync(join(process.cwd(), ".data", "tenants", TENANT), {
      recursive: true,
      force: true,
    }); // Vercel: no files
    maybeSingleMock.mockResolvedValue({
      data: { data: { name: "Now Exists", domain: "now.mx" } },
      error: null,
    });
    const cfg = await getBusinessConfigForCurrentTenant();
    expect(cfg.name).toBe("Now Exists");
  });
});
