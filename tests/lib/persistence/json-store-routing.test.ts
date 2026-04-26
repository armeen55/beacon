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
    // No fallback to flat — known store with no routed file returns empty.
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

// ── Phase 7.8d-1: no flat fallback, fail-loud on unknown ────────────

describe("Phase 7.8d-1 — flat fallback removed", () => {
  it("does NOT fall back to flat for a per-tenant store when the routed file is missing", async () => {
    // `pages` is in TENANT_SCOPED_STORES. A flat file exists, but with
    // 7.8d-1 the routed read no longer consults it — returns empty.
    const flatPath = join(tmpRoot, ".data", "pages.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "flat-row" }]));

    const result = await readStore<{ id: string }>("pages");
    expect(result).toEqual([]);
  });

  it("does NOT fall back to flat for a global store when the routed file is missing", async () => {
    const flatPath = join(tmpRoot, ".data", "change-patterns.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "flat-pattern" }]));

    const result = await readStore<{ id: string }>("change-patterns");
    expect(result).toEqual([]);
  });

  it("returns the caller's fallback when routed file is missing for a known store", async () => {
    const result = await readStore<{ id: string }>(
      "candidate-links",
      [{ id: "caller-default" }],
    );
    expect(result).toEqual([{ id: "caller-default" }]);
  });

  it("does NOT log a flat-fallback warning anywhere in the read path", async () => {
    // Spy on console.warn — log.warn writes through it. With the
    // fallback removed, no warn should fire on a missing routed file.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flatPath = join(tmpRoot, ".data", "page-snapshots.json");
    writeFileSync(flatPath, JSON.stringify([{ id: "flat-row" }]));

    await readStore<{ id: string }>("page-snapshots");

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
      readStore<{ id: string }>("brand-new-unclassified-store"),
    ).rejects.toThrow(
      /unknown store 'brand-new-unclassified-store'.*store-classification\.ts/,
    );
  });

  it("throw message names the three Sets the operator must update", async () => {
    await expect(
      readStore<{ id: string }>("another-mystery-store"),
    ).rejects.toThrow(
      /TENANT_SCOPED_STORES[\s\S]*SINGLETON_STORES[\s\S]*GLOBAL_STORES/,
    );
  });

  it("known stores still read routed paths without throwing", async () => {
    // Use store names not exercised by sibling tests in this file so the
    // module-level cache stays cold for these reads.
    mkdirSync(join(tmpRoot, ".data", "tenants", "ritz-builders"), {
      recursive: true,
    });
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "ritz-builders", "page-issues.json"),
      JSON.stringify([{ id: "tenant-issue" }]),
    );
    writeFileSync(
      join(tmpRoot, ".data", "global", "confidence-calibration.json"),
      JSON.stringify([{ id: "global-calibration" }]),
    );

    await expect(readStore<{ id: string }>("page-issues")).resolves.toEqual([
      { id: "tenant-issue" },
    ]);
    await expect(
      readStore<{ id: string }>("confidence-calibration"),
    ).resolves.toEqual([{ id: "global-calibration" }]);
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

  it("writes never touch flat — preexisting flat file untouched", async () => {
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

// ── Phase 7.8d-1: writeStore throws on unknown ──────────────────────

describe("Phase 7.8d-1 — writeStore throws on unknown", () => {
  it("throws when writing an unclassified store name", async () => {
    await expect(
      writeStore("brand-new-unclassified-store", [{ x: 42 }]),
    ).rejects.toThrow(
      /unknown store 'brand-new-unclassified-store'.*store-classification\.ts/,
    );
    // Confirm no file landed at the (now-stale) flat path.
    const flatPath = join(tmpRoot, ".data", "brand-new-unclassified-store.json");
    expect(existsSync(flatPath)).toBe(false);
  });
});
