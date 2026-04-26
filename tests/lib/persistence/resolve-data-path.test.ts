/**
 * Sprint 7 Phase 7.8b-2-a (2026-04-25) — unit tests for the shared
 * `.data` path resolver.
 *
 * Covers the four-way classification dispatch and the cache-key shape
 * contract. The dotdata-json + json-store routing tests cover the
 * end-to-end disk-routing behavior; this file pins the resolver
 * itself in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@/lib/tenant-context", () => ({
  currentTenantSlug: vi.fn(async () => "ritz-builders"),
}));

import { resolveDataPath } from "@/lib/persistence/resolve-data-path";
import { currentTenantSlug } from "@/lib/tenant-context";

let tmpRoot: string;
let originalCwd: string;

beforeEach(() => {
  // realpathSync to canonicalize macOS /var → /private/var symlink so
  // process.cwd() and the test's expected paths line up.
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "beacon-7.8b2a-")));
  mkdirSync(join(tmpRoot, ".data"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(tmpRoot);
  (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
    "ritz-builders",
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ── Routing ──────────────────────────────────────────────────────────

describe("Phase 7.8b-2-a — resolveDataPath routing", () => {
  it("per-tenant array store routes to .data/tenants/{slug}/{name}.json", async () => {
    // `imported-results` is in TENANT_SCOPED_STORES.
    const r = await resolveDataPath("imported-results");
    expect(r.scope).toBe("per-tenant");
    expect(r.routedDir).toBe(
      join(tmpRoot, ".data", "tenants", "ritz-builders"),
    );
    expect(r.routedPath).toBe(
      join(tmpRoot, ".data", "tenants", "ritz-builders", "imported-results.json"),
    );
    expect(r.flatPath).toBe(
      join(tmpRoot, ".data", "imported-results.json"),
    );
  });

  it("singleton store routes to .data/tenants/{slug}/{name}.json (same as per-tenant)", async () => {
    // `citation-evidence-index` is in SINGLETON_STORES.
    const r = await resolveDataPath("citation-evidence-index");
    expect(r.scope).toBe("singleton");
    expect(r.routedPath).toBe(
      join(
        tmpRoot,
        ".data",
        "tenants",
        "ritz-builders",
        "citation-evidence-index.json",
      ),
    );
  });

  it("global store routes to .data/global/{name}.json", async () => {
    // `business-config` is in GLOBAL_STORES.
    const r = await resolveDataPath("business-config");
    expect(r.scope).toBe("global");
    expect(r.routedDir).toBe(join(tmpRoot, ".data", "global"));
    expect(r.routedPath).toBe(
      join(tmpRoot, ".data", "global", "business-config.json"),
    );
    expect(r.flatPath).toBe(
      join(tmpRoot, ".data", "business-config.json"),
    );
  });

  it("unknown store stays at .data/{name}.json (flat)", async () => {
    const r = await resolveDataPath("brand-new-store-xyz");
    expect(r.scope).toBe("unknown");
    expect(r.routedDir).toBe(join(tmpRoot, ".data"));
    expect(r.routedPath).toBe(
      join(tmpRoot, ".data", "brand-new-store-xyz.json"),
    );
    expect(r.routedPath).toBe(r.flatPath);
  });
});

// ── Cache-key contract ──────────────────────────────────────────────

describe("Phase 7.8b-2-a — resolveDataPath cache-key shapes", () => {
  it("per-tenant cache key is `${name}::tenant:${slug}`", async () => {
    const r = await resolveDataPath("imported-results");
    expect(r.cacheKey).toBe("imported-results::tenant:ritz-builders");
  });

  it("singleton cache key is `${name}::tenant:${slug}` (same shape as per-tenant)", async () => {
    const r = await resolveDataPath("citation-evidence-index");
    expect(r.cacheKey).toBe("citation-evidence-index::tenant:ritz-builders");
  });

  it("global cache key is `${name}::global`", async () => {
    const r = await resolveDataPath("business-config");
    expect(r.cacheKey).toBe("business-config::global");
  });

  it("unknown cache key is `${name}::flat`", async () => {
    const r = await resolveDataPath("brand-new-store-xyz");
    expect(r.cacheKey).toBe("brand-new-store-xyz::flat");
  });

  it("different tenants produce different cache keys for the same store", async () => {
    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
      "ritz-builders",
    );
    const a = await resolveDataPath("imported-results");

    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    const b = await resolveDataPath("imported-results");

    expect(a.cacheKey).not.toBe(b.cacheKey);
    expect(a.cacheKey).toBe("imported-results::tenant:ritz-builders");
    expect(b.cacheKey).toBe("imported-results::tenant:acme");
  });

  it("global cache key is identical regardless of tenant context", async () => {
    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
      "ritz-builders",
    );
    const a = await resolveDataPath("business-config");

    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    const b = await resolveDataPath("business-config");

    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.cacheKey).toBe("business-config::global");
  });
});

// ── tenantSlug usage gate ────────────────────────────────────────────

describe("Phase 7.8b-2-a — currentTenantSlug only called for per-tenant/singleton", () => {
  it("global resolution does NOT call currentTenantSlug", async () => {
    const slugSpy = currentTenantSlug as ReturnType<typeof vi.fn>;
    slugSpy.mockClear();
    await resolveDataPath("business-config");
    expect(slugSpy).not.toHaveBeenCalled();
  });

  it("unknown resolution does NOT call currentTenantSlug", async () => {
    const slugSpy = currentTenantSlug as ReturnType<typeof vi.fn>;
    slugSpy.mockClear();
    await resolveDataPath("brand-new-store-xyz");
    expect(slugSpy).not.toHaveBeenCalled();
  });

  it("per-tenant resolution calls currentTenantSlug exactly once", async () => {
    const slugSpy = currentTenantSlug as ReturnType<typeof vi.fn>;
    slugSpy.mockClear();
    await resolveDataPath("imported-results");
    expect(slugSpy).toHaveBeenCalledTimes(1);
  });

  it("singleton resolution calls currentTenantSlug exactly once", async () => {
    const slugSpy = currentTenantSlug as ReturnType<typeof vi.fn>;
    slugSpy.mockClear();
    await resolveDataPath("citation-evidence-index");
    expect(slugSpy).toHaveBeenCalledTimes(1);
  });
});
