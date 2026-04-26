/**
 * Sprint 7 Phase 7.8b-1 (2026-04-25) — dotdata-json runtime routing.
 *
 * Tests the per-tenant / global / flat-fallback path-resolution behavior
 * introduced when readDotDataJson / writeDotDataJson became async +
 * tenant-aware. Uses a tmpdir as the project root and `process.chdir()`
 * to redirect `process.cwd()`, so no real `.data/` is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock currentTenantSlug so the tests don't depend on the tenant store
// being seeded. The vitest env sets BEACON_TENANT_ID=tenant-ritz-founder;
// the slug here matches the runtime value used by the migration script.
vi.mock("@/lib/tenant-context", () => ({
  currentTenantSlug: vi.fn(async () => "ritz-builders"),
}));

// `getDataDir(slug)` is sync (Phase 7.3) — leave un-mocked but route
// through the same helper so the dirs live under our tmpdir cwd.

import {
  readDotDataJson,
  writeDotDataJson,
} from "@/lib/persistence/dotdata-json";
import { currentTenantSlug } from "@/lib/tenant-context";

let tmpRoot: string;
let originalCwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "beacon-7.8b1-"));
  mkdirSync(join(tmpRoot, ".data"), { recursive: true });
  mkdirSync(join(tmpRoot, ".data", "global"), { recursive: true });
  mkdirSync(join(tmpRoot, ".data", "tenants", "ritz-builders"), {
    recursive: true,
  });
  originalCwd = process.cwd();
  process.chdir(tmpRoot);
  // Default mock — tests can override per-case.
  (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
    "ritz-builders",
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ── Read routing ─────────────────────────────────────────────────────

describe("Phase 7.8b-1 — readDotDataJson per-tenant routing", () => {
  it("reads per-tenant store from .data/tenants/{slug}/{name}.json", async () => {
    // `page-snapshots` is in TENANT_SCOPED_STORES.
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "page-snapshots.json",
    );
    writeFileSync(tenantPath, JSON.stringify([{ id: "tenant-row" }]));

    const result = await readDotDataJson<{ id: string }[]>("page-snapshots");
    expect(result).toEqual([{ id: "tenant-row" }]);
  });

  it("reads singleton store from .data/tenants/{slug}/{name}.json", async () => {
    // `citation-evidence-index` is in SINGLETON_STORES.
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "citation-evidence-index.json",
    );
    writeFileSync(tenantPath, JSON.stringify({ built_at: "2026-01-01" }));

    const result = await readDotDataJson<{ built_at: string }>(
      "citation-evidence-index",
    );
    expect(result).toEqual({ built_at: "2026-01-01" });
  });

  it("does not see another tenant's data (isolation)", async () => {
    // Write to a different tenant's subdir; reading from ritz must NOT
    // pull it in.
    mkdirSync(join(tmpRoot, ".data", "tenants", "other"), { recursive: true });
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "other", "page-snapshots.json"),
      JSON.stringify([{ id: "other-row" }]),
    );
    // Ritz's per-tenant subdir is empty.

    const result = await readDotDataJson<{ id: string }[]>("page-snapshots");
    // No fallback to flat — known store with no routed file returns null.
    expect(result).toBeNull();
  });
});

describe("Phase 7.8b-1 — readDotDataJson global routing", () => {
  it("reads global store from .data/global/{name}.json", async () => {
    // `business-config` is in GLOBAL_STORES.
    const globalPath = join(
      tmpRoot,
      ".data",
      "global",
      "business-config.json",
    );
    writeFileSync(globalPath, JSON.stringify({ siteDomain: "ritzbuilders.com" }));

    const result = await readDotDataJson<{ siteDomain: string }>(
      "business-config",
    );
    expect(result).toEqual({ siteDomain: "ritzbuilders.com" });
  });

  it("global store is visible regardless of which tenant context", async () => {
    const globalPath = join(
      tmpRoot,
      ".data",
      "global",
      "business-config.json",
    );
    writeFileSync(globalPath, JSON.stringify({ siteDomain: "x.com" }));

    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
      "ritz-builders",
    );
    const a = await readDotDataJson<{ siteDomain: string }>("business-config");

    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    const b = await readDotDataJson<{ siteDomain: string }>("business-config");

    expect(a).toEqual(b);
    expect(a).toEqual({ siteDomain: "x.com" });
  });
});

describe("Phase 7.8d-1 — flat fallback removed", () => {
  it("does NOT fall back to flat for a per-tenant store when the routed file is missing", async () => {
    const flatPath = join(tmpRoot, ".data", "page-snapshots.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "flat-row" }]));

    const result = await readDotDataJson<{ id: string }[]>("page-snapshots");
    expect(result).toBeNull();
  });

  it("does NOT fall back to flat for a global store when the routed file is missing", async () => {
    const flatPath = join(tmpRoot, ".data", "business-config.json");
    writeFileSync(flatPath, JSON.stringify({ siteDomain: "flat.com" }));

    const result = await readDotDataJson<{ siteDomain: string }>(
      "business-config",
    );
    expect(result).toBeNull();
  });

  it("returns null when routed file is missing for a known store", async () => {
    const result = await readDotDataJson<{ id: string }[]>("page-snapshots");
    expect(result).toBeNull();
  });

  it("does NOT log a flat-fallback warning when a known routed file is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flatPath = join(tmpRoot, ".data", "page-snapshots.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "flat-row" }]));

    await readDotDataJson<{ id: string }[]>("page-snapshots");

    const fallbackWarns = warnSpy.mock.calls.filter((args) =>
      args.some(
        (a) => typeof a === "string" && a.includes("flat-fallback"),
      ),
    );
    expect(fallbackWarns).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe("Phase 7.8d-1 — unknown stores throw fail-loud", () => {
  it("throws when reading an unclassified store name", async () => {
    await expect(
      readDotDataJson("brand-new-unclassified-blob"),
    ).rejects.toThrow(
      /unknown store 'brand-new-unclassified-blob'.*store-classification\.ts/,
    );
  });

  it("throw message names the three Sets the operator must update", async () => {
    await expect(
      readDotDataJson("another-mystery-blob"),
    ).rejects.toThrow(
      /TENANT_SCOPED_STORES[\s\S]*SINGLETON_STORES[\s\S]*GLOBAL_STORES/,
    );
  });

  it("known stores still read routed paths without throwing", async () => {
    const globalPath = join(
      tmpRoot,
      ".data",
      "global",
      "business-config.json",
    );
    writeFileSync(globalPath, JSON.stringify({ siteDomain: "ritzbuilders.com" }));

    await expect(
      readDotDataJson<{ siteDomain: string }>("business-config"),
    ).resolves.toEqual({ siteDomain: "ritzbuilders.com" });
  });
});

// ── Write routing ────────────────────────────────────────────────────

describe("Phase 7.8b-1 — writeDotDataJson", () => {
  it("writes per-tenant store to .data/tenants/{slug}/{name}.json", async () => {
    await writeDotDataJson("page-snapshots", [{ id: "wrote-tenant" }]);

    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "page-snapshots.json",
    );
    expect(existsSync(tenantPath)).toBe(true);
    const written = JSON.parse(readFileSync(tenantPath, "utf8"));
    expect(written).toEqual([{ id: "wrote-tenant" }]);

    // Flat path NOT written.
    const flatPath = join(tmpRoot, ".data", "page-snapshots.json");
    expect(existsSync(flatPath)).toBe(false);
  });

  it("writes global store to .data/global/{name}.json", async () => {
    await writeDotDataJson("business-config", { siteDomain: "x.com" });

    const globalPath = join(
      tmpRoot,
      ".data",
      "global",
      "business-config.json",
    );
    expect(existsSync(globalPath)).toBe(true);
    expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({
      siteDomain: "x.com",
    });

    // Per-tenant path NOT written for a global store.
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "business-config.json",
    );
    expect(existsSync(tenantPath)).toBe(false);
  });

  it("creates the destination directory if it doesn't exist", async () => {
    // Remove pre-created tenants subdir.
    rmSync(join(tmpRoot, ".data", "tenants"), { recursive: true });

    await writeDotDataJson("page-snapshots", [{ id: "auto-mkdir" }]);

    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "page-snapshots.json",
    );
    expect(existsSync(tenantPath)).toBe(true);
  });

  it("does NOT fall back to flat — writes always go to the routed subdir", async () => {
    // Pre-existing flat file should remain unchanged.
    const flatPath = join(tmpRoot, ".data", "page-snapshots.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "preexisting-flat" }]));

    await writeDotDataJson("page-snapshots", [{ id: "new-tenant-write" }]);

    // Flat unchanged.
    expect(JSON.parse(readFileSync(flatPath, "utf8"))).toEqual([
      { id: "preexisting-flat" },
    ]);
    // Tenant subdir got the new write.
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "page-snapshots.json",
    );
    expect(JSON.parse(readFileSync(tenantPath, "utf8"))).toEqual([
      { id: "new-tenant-write" },
    ]);
  });
});

// ── Phase 7.8d-1: writes throw on unknown ────────────────────────────

describe("Phase 7.8d-1 — writeDotDataJson throws on unknown", () => {
  it("throws when writing an unclassified store name", async () => {
    await expect(
      writeDotDataJson("brand-new-unclassified-blob", { x: 42 }),
    ).rejects.toThrow(
      /unknown store 'brand-new-unclassified-blob'.*store-classification\.ts/,
    );
    // Confirm no file landed at the (now-stale) flat path.
    const flatPath = join(tmpRoot, ".data", "brand-new-unclassified-blob.json");
    expect(existsSync(flatPath)).toBe(false);
  });
});
