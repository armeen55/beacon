/**
 * publish-canary (2026-07-02, master plan item 86).
 *
 * Covers: no token / dead token / empty url-map / dry-run fail / all-clear,
 * the Ritz hard-block skip, and fan-out never-throws behavior. The Wix
 * client + dry-run helper are injected via PublishCanaryDeps (same seam
 * style as warm-caches.test.ts), not vi.mock'd, so the real client/service
 * modules are never touched by this test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let healthStored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => healthStored,
  writeStore: async (_name: string, data: unknown[]) => {
    healthStored = data;
  },
}));

import {
  runPublishCanaryForTenant,
  runPublishCanary,
  type PublishCanaryDeps,
} from "./publish-canary";
import { RITZ_TENANT_ID } from "./push-service";
import type { WixConnectorToken } from "@/lib/connector-store";

const NOW = new Date("2026-07-02T08:51:00.000Z");

function baseDeps(over: Partial<PublishCanaryDeps> = {}): PublishCanaryDeps {
  return {
    now: NOW,
    getWixConnectorToken: vi.fn(async () => ({
      provider: "wix",
      api_key: "k",
      site_id: "s",
      connected_at: "2026-01-01T00:00:00Z",
    })) as unknown as typeof import("@/lib/connector-store").getWixConnectorToken,
    wixListDataCollections: vi.fn(async () => ({ ok: true, value: [] })) as unknown as typeof import("@/lib/connectors/wix/client").wixListDataCollections,
    readUrlMapForTenant: vi.fn(async () => ({ ok: true, rowCount: 3, spotCheckOk: true })),
    runRepresentativeDryRun: vi.fn(async () => true),
    ...over,
  };
}

beforeEach(() => {
  healthStored = [];
});

describe("runPublishCanaryForTenant", () => {
  it("records an honest not-connected state when no token exists", async () => {
    const deps = baseDeps({ getWixConnectorToken: vi.fn(async () => null) });
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.tokenOk).toBeNull();
    expect(row.urlMapOk).toBeNull();
    expect(row.dryRunOk).toBeNull();
    expect(row.fixHint).toMatch(/don't have a site connection/i);
    expect(deps.wixListDataCollections).not.toHaveBeenCalled();
  });

  it("records a dead token when the token is marked disconnected", async () => {
    const deps = baseDeps({
      getWixConnectorToken: vi.fn(async () => ({
        provider: "wix",
        api_key: "k",
        site_id: "s",
        connected_at: "2026-01-01T00:00:00Z",
        disconnected_at: "2026-06-01T00:00:00Z",
      } satisfies WixConnectorToken)),
    });
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.tokenOk).toBe(false);
    expect(row.dryRunOk).toBeNull();
    expect(row.fixHint).toMatch(/reconnect/i);
  });

  it("records a dead token when the cheap READ (list collections) fails", async () => {
    const deps = baseDeps({
      wixListDataCollections: vi.fn(async () => ({ ok: false as const, reason: "api_error" as const, detail: "http_401" })),
    });
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.tokenOk).toBe(false);
    expect(row.urlMapOk).toBeNull();
    expect(row.dryRunOk).toBeNull();
    expect(row.error).toContain("api_error");
    expect(row.fixHint).toMatch(/reconnect/i);
  });

  it("records an empty url-map as a fix-needed state, never a dry-run attempt", async () => {
    const deps = baseDeps({
      readUrlMapForTenant: vi.fn(async () => ({ ok: false, rowCount: 0, spotCheckOk: false })),
    });
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.tokenOk).toBe(true);
    expect(row.urlMapOk).toBe(false);
    expect(row.dryRunOk).toBeNull();
    expect(row.fixHint).toMatch(/page map/i);
    expect(deps.runRepresentativeDryRun).not.toHaveBeenCalled();
  });

  it("records a stale url-map (rows exist but the spot-check item is gone)", async () => {
    const deps = baseDeps({
      readUrlMapForTenant: vi.fn(async () => ({ ok: false, rowCount: 5, spotCheckOk: false })),
    });
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.urlMapOk).toBe(false);
    expect(row.fixHint).toMatch(/no longer exists/i);
  });

  it("proceeds to the dry-run when the url-map probe itself could not run (honest unknown)", async () => {
    const deps = baseDeps({
      readUrlMapForTenant: vi.fn(async () => ({ ok: null, rowCount: 0, spotCheckOk: false, detail: "no_supabase_env" })),
    });
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.urlMapOk).toBeNull();
    expect(row.dryRunOk).toBe(true);
    expect(deps.runRepresentativeDryRun).toHaveBeenCalledWith("tenant-x");
  });

  it("records a dry-run failure with a fix hint", async () => {
    const deps = baseDeps({ runRepresentativeDryRun: vi.fn(async () => false) });
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.tokenOk).toBe(true);
    expect(row.urlMapOk).toBe(true);
    expect(row.dryRunOk).toBe(false);
    expect(row.fixHint).toMatch(/practice run/i);
  });

  it("reports all-clear with no fixHint when every check passes", async () => {
    const deps = baseDeps();
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.tokenOk).toBe(true);
    expect(row.urlMapOk).toBe(true);
    expect(row.dryRunOk).toBe(true);
    expect(row.fixHint).toBeUndefined();
    expect(row.error).toBeUndefined();
  });

  it("never throws when a dependency throws mid-check", async () => {
    const deps = baseDeps({
      wixListDataCollections: vi.fn(async () => {
        throw new Error("network blip");
      }),
    });
    const row = await runPublishCanaryForTenant("tenant-x", deps);
    expect(row.tokenOk).toBe(false);
    expect(row.error).toContain("network blip");
  });
});

describe("Ritz hard-block", () => {
  it("skips the dry-run entirely for tenant-ritz-founder and records an honest off status", async () => {
    const deps = baseDeps();
    const row = await runPublishCanaryForTenant(RITZ_TENANT_ID, deps);
    expect(row.tokenOk).toBeNull();
    expect(row.urlMapOk).toBeNull();
    expect(row.dryRunOk).toBeNull();
    expect(row.fixHint).toMatch(/publishing is off for this site/i);
    expect(deps.getWixConnectorToken).not.toHaveBeenCalled();
    expect(deps.wixListDataCollections).not.toHaveBeenCalled();
    expect(deps.runRepresentativeDryRun).not.toHaveBeenCalled();
  });
});

describe("runPublishCanary (fan-out)", () => {
  it("checks every tenant, persists a row each, and never throws when one tenant errors", async () => {
    const deps = baseDeps({
      getWixConnectorToken: vi.fn(async (tenantId?: string) => {
        if (tenantId === "tenant-broken") throw new Error("boom");
        return {
          provider: "wix",
          api_key: "k",
          site_id: "s",
          connected_at: "2026-01-01T00:00:00Z",
        } as WixConnectorToken;
      }),
    });
    const results = await runPublishCanary(["tenant-a", "tenant-broken", RITZ_TENANT_ID], deps);
    expect(results).toHaveLength(3);
    const a = results.find((r) => r.tenantId === "tenant-a")!;
    expect(a.row.tokenOk).toBe(true);
    const broken = results.find((r) => r.tenantId === "tenant-broken")!;
    expect(broken.row.tokenOk).toBeNull();
    expect(broken.row.error).toContain("boom");
    const ritz = results.find((r) => r.tenantId === RITZ_TENANT_ID)!;
    expect(ritz.row.fixHint).toMatch(/publishing is off/i);
    expect((healthStored as Array<{ tenant_id: string }>).map((r) => r.tenant_id).sort()).toEqual(
      ["tenant-a", "tenant-broken", RITZ_TENANT_ID].sort(),
    );
  });
});
