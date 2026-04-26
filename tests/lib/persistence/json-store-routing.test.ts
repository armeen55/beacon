/**
 * Sprint 7 Phase 7.8b-2-b (2026-04-25) — json-store runtime routing.
 *
 * Tests the per-tenant / global / flat-fallback path-resolution +
 * cache-key behavior introduced when `readStore` became async +
 * tenant-aware. Uses tmpdir + `process.chdir()` to redirect cwd; no
 * real `.data/` is touched.
 *
 * The most-likely-bug-class for this commit is cache-key collision
 * across tenants: a flat-fallback read served to tenant A, then
 * served from cache to tenant B. The "cross-tenant cache isolation"
 * test below pins that behavior.
 *
 * Phase 7.8b-2-c will cascade `await` through ~89 caller sites; this
 * file proves the helper itself is correct in isolation before that
 * larger-blast-radius work ships.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@/lib/tenant-context", () => ({
  currentTenantSlug: vi.fn(async () => "ritz-builders"),
}));

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantSlug } from "@/lib/tenant-context";

let tmpRoot: string;
let originalCwd: string;

beforeEach(async () => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "beacon-7.8b2b-")));
  mkdirSync(join(tmpRoot, ".data"), { recursive: true });
  mkdirSync(join(tmpRoot, ".data", "global"), { recursive: true });
  mkdirSync(join(tmpRoot, ".data", "tenants", "ritz-builders"), {
    recursive: true,
  });
  originalCwd = process.cwd();
  process.chdir(tmpRoot);
  (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
    "ritz-builders",
  );
  // Reset internal cache + writeLocks state between tests by reloading
  // the module (vitest re-imports per-test file isolation; no extra
  // work needed at the test level — but just in case, do a no-op
  // re-import path).
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.clearAllMocks();
  // Module-level cache + writeLocks persist across tests in the same
  // file. We use distinct store names per test so cache keys don't
  // collide across cases.
});

// ── Per-tenant routing ──────────────────────────────────────────────

describe("Phase 7.8b-2-b — readStore per-tenant routing", () => {
  it("reads per-tenant store from .data/tenants/{slug}/{name}.json", async () => {
    // `imported-results` is in TENANT_SCOPED_STORES.
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "imported-results.json",
    );
    writeFileSync(tenantPath, JSON.stringify([{ id: "tenant-row" }]));

    const result = await readStore<{ id: string }[]>("imported-results");
    expect(result).toEqual([{ id: "tenant-row" }]);
  });

  it("reads global store from .data/global/{name}.json", async () => {
    // `business-config` is in GLOBAL_STORES.
    const globalPath = join(
      tmpRoot,
      ".data",
      "global",
      "business-config.json",
    );
    writeFileSync(globalPath, JSON.stringify([{ siteDomain: "x.com" }]));

    const result = await readStore<{ siteDomain: string }>("business-config");
    expect(result).toEqual([{ siteDomain: "x.com" }]);
  });

  it("does not see another tenant's data (isolation)", async () => {
    mkdirSync(join(tmpRoot, ".data", "tenants", "other"), { recursive: true });
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "other", "imported-changes.json"),
      JSON.stringify([{ id: "other-row" }]),
    );
    // ritz-builders' subdir doesn't have the file.

    const result = await readStore<{ id: string }>("imported-changes");
    // No flat fallback either — empty array.
    expect(result).toEqual([]);
  });

  it("global store is visible regardless of tenant context", async () => {
    const globalPath = join(
      tmpRoot,
      ".data",
      "global",
      "triage-rules.json",
    );
    writeFileSync(globalPath, JSON.stringify([{ id: "rule-1" }]));

    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
      "ritz-builders",
    );
    const a = await readStore<{ id: string }>("triage-rules");

    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    const b = await readStore<{ id: string }>("triage-rules");

    expect(a).toEqual(b);
    expect(a).toEqual([{ id: "rule-1" }]);
  });
});

// ── Flat fallback ───────────────────────────────────────────────────

describe("Phase 7.8b-2-b — flat-fallback read", () => {
  it("falls back to .data/{name}.json when the per-tenant file is missing", async () => {
    // `pages` is in TENANT_SCOPED_STORES.
    const flatPath = join(tmpRoot, ".data", "pages.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "flat-row" }]));

    const result = await readStore<{ id: string }>("pages");
    expect(result).toEqual([{ id: "flat-row" }]);
  });

  it("falls back to flat for a global store too", async () => {
    const flatPath = join(tmpRoot, ".data", "change-patterns.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "flat-pattern" }]));

    const result = await readStore<{ id: string }>("change-patterns");
    expect(result).toEqual([{ id: "flat-pattern" }]);
  });

  it("routed file wins over flat fallback when both exist", async () => {
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "scan-findings.json",
    );
    const flatPath = join(tmpRoot, ".data", "scan-findings.json");
    writeFileSync(tenantPath, JSON.stringify([{ id: "tenant-wins" }]));
    writeFileSync(flatPath, JSON.stringify([{ id: "flat-loses" }]));

    const result = await readStore<{ id: string }>("scan-findings");
    expect(result).toEqual([{ id: "tenant-wins" }]);
  });

  it("returns empty array (or fallback) when both routed and flat are missing", async () => {
    const result = await readStore<{ id: string }>(
      "candidate-links",
      [{ id: "fallback" }],
    );
    expect(result).toEqual([{ id: "fallback" }]);
  });

  it("flat-fallback caches under the resolved key — tenant A reading flat doesn't pollute tenant B", async () => {
    // Use a unique store name so this test's cache state doesn't
    // collide with sibling tests in the same file.
    const flatPath = join(tmpRoot, ".data", "tracked-prompts.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "shared-flat-row" }]));

    // Tenant A reads — gets flat-fallback. (tracked-prompts is global per
    // GLOBAL_STORES, but routed file isn't there yet.)
    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
      "ritz-builders",
    );
    const a = await readStore<{ id: string }>("tracked-prompts");
    expect(a).toEqual([{ id: "shared-flat-row" }]);

    // tracked-prompts is global, so tenant context shouldn't matter at
    // all — both tenants see the same cached value under
    // `tracked-prompts::global`.
    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    const b = await readStore<{ id: string }>("tracked-prompts");
    expect(b).toEqual(a);
  });

  it("per-tenant flat fallback is cache-keyed per tenant — A's flat row not served to B", async () => {
    // Both tenants would resolve `event-decisions` to a per-tenant
    // path; both would fall back to the same flat file (because no
    // tenant subdir has the file yet). The cache key is per-tenant,
    // so even though the same flat file is read, each tenant's cache
    // entry is independent.
    //
    // (Uses `event-decisions` instead of `imported-changes` because
    // module-level cache state persists across tests in this file —
    // an earlier test reads `imported-changes` for ritz-builders and
    // populates an empty-array cache entry under that resolved key.)
    const flatPath = join(tmpRoot, ".data", "event-decisions.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "shared-flat" }]));

    // Tenant A reads, populates cache key `event-decisions::tenant:ritz-builders`.
    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue(
      "ritz-builders",
    );
    const a = await readStore<{ id: string }>("event-decisions");
    expect(a).toEqual([{ id: "shared-flat" }]);

    // Now tenant B's per-tenant subdir has its own data. The cache for
    // tenant A is `event-decisions::tenant:ritz-builders`; tenant B's
    // cache key is `event-decisions::tenant:acme` and is empty/cold.
    mkdirSync(join(tmpRoot, ".data", "tenants", "acme"), { recursive: true });
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "acme", "event-decisions.json"),
      JSON.stringify([{ id: "acme-only" }]),
    );

    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    const b = await readStore<{ id: string }>("event-decisions");
    // Tenant B sees its OWN data — not tenant A's cached flat row.
    expect(b).toEqual([{ id: "acme-only" }]);
  });
});

// ── Write routing ───────────────────────────────────────────────────

describe("Phase 7.8b-2-b — writeStore", () => {
  it("writes per-tenant store to .data/tenants/{slug}/{name}.json", async () => {
    await writeStore("imported-results", [{ id: "wrote-tenant" }]);

    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "imported-results.json",
    );
    expect(existsSync(tenantPath)).toBe(true);
    const written = JSON.parse(readFileSync(tenantPath, "utf8"));
    expect(written).toEqual([{ id: "wrote-tenant" }]);

    // Flat path NOT written.
    const flatPath = join(tmpRoot, ".data", "imported-results.json");
    expect(existsSync(flatPath)).toBe(false);
  });

  it("writes global store to .data/global/{name}.json", async () => {
    await writeStore("change-patterns", [{ id: "global-pattern" }]);

    const globalPath = join(
      tmpRoot,
      ".data",
      "global",
      "change-patterns.json",
    );
    expect(existsSync(globalPath)).toBe(true);

    // Per-tenant path NOT written for a global store.
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "change-patterns.json",
    );
    expect(existsSync(tenantPath)).toBe(false);
  });

  it("writes do NOT fall back to flat — preexisting flat file untouched", async () => {
    const flatPath = join(tmpRoot, ".data", "scan-runs.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "preexisting-flat" }]));

    await writeStore("scan-runs", [{ id: "new-tenant-write" }]);

    // Flat unchanged.
    expect(JSON.parse(readFileSync(flatPath, "utf8"))).toEqual([
      { id: "preexisting-flat" },
    ]);
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "scan-runs.json",
    );
    expect(JSON.parse(readFileSync(tenantPath, "utf8"))).toEqual([
      { id: "new-tenant-write" },
    ]);
  });
});

// ── import-runs anti-race guard ─────────────────────────────────────

describe("Phase 7.8b-2-b — import-runs anti-race guard", () => {
  it("refuses to overwrite a non-empty per-tenant import-runs.json with []", async () => {
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "import-runs.json",
    );
    writeFileSync(tenantPath, JSON.stringify([{ id: "preexisting-run" }]));

    // Try to overwrite with []. Guard must refuse.
    await writeStore("import-runs", [] as unknown[]);

    // File contents preserved.
    const after = JSON.parse(readFileSync(tenantPath, "utf8"));
    expect(after).toEqual([{ id: "preexisting-run" }]);
  });

  it("does NOT block writes for a different tenant when this tenant has data", async () => {
    // Tenant ritz-builders has rows; tenant acme is empty.
    const ritzPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "import-runs.json",
    );
    writeFileSync(ritzPath, JSON.stringify([{ id: "ritz-run" }]));

    // Switch to tenant acme. The guard should evaluate against acme's
    // file (which doesn't exist yet) — overwrite-with-[] is fine
    // because there's nothing to overwrite.
    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    mkdirSync(join(tmpRoot, ".data", "tenants", "acme"), { recursive: true });
    await writeStore("import-runs", [{ id: "acme-run" }]);

    // Acme got its row.
    const acmePath = join(
      tmpRoot,
      ".data",
      "tenants",
      "acme",
      "import-runs.json",
    );
    expect(JSON.parse(readFileSync(acmePath, "utf8"))).toEqual([
      { id: "acme-run" },
    ]);
    // Ritz untouched.
    expect(JSON.parse(readFileSync(ritzPath, "utf8"))).toEqual([
      { id: "ritz-run" },
    ]);
  });

  it("does NOT block when same-tenant existing file is empty", async () => {
    // No preexisting import-runs.json. writeStore([]) should succeed
    // (creates empty file) — the guard only fires when existing.length > 0.
    await writeStore("import-runs", [] as unknown[]);

    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "import-runs.json",
    );
    expect(existsSync(tenantPath)).toBe(true);
    expect(JSON.parse(readFileSync(tenantPath, "utf8"))).toEqual([]);
  });

  it("Phase 7.7b connector-test cleanup pattern still works (unlink + writeStore([]))", async () => {
    const { unlinkSync } = await import("node:fs");
    const tenantPath = join(
      tmpRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "import-runs.json",
    );

    // Existing pollution-style row.
    writeFileSync(tenantPath, JSON.stringify([{ tenant_id: "tenant-other" }]));

    // Connector-test cleanup pattern: unlink first, then writeStore([])
    // succeeds because the guard's `existsSync` is now false.
    unlinkSync(tenantPath);
    await writeStore("import-runs", [] as unknown[]);

    expect(existsSync(tenantPath)).toBe(true);
    expect(JSON.parse(readFileSync(tenantPath, "utf8"))).toEqual([]);
  });
});

// ── Unknown stores ──────────────────────────────────────────────────

describe("Phase 7.8b-2-b — unknown stores keep using flat path", () => {
  it("readStore reads .data/{name}.json directly for unknown stores", async () => {
    const flatPath = join(tmpRoot, ".data", "brand-new-store.json");
    writeFileSync(flatPath, JSON.stringify([{ x: 1 }]));

    const result = await readStore<{ x: number }>("brand-new-store");
    expect(result).toEqual([{ x: 1 }]);
  });

  it("writeStore writes .data/{name}.json for unknown stores", async () => {
    await writeStore("brand-new-store", [{ x: 42 }]);

    const flatPath = join(tmpRoot, ".data", "brand-new-store.json");
    expect(existsSync(flatPath)).toBe(true);
    expect(JSON.parse(readFileSync(flatPath, "utf8"))).toEqual([{ x: 42 }]);
  });
});
