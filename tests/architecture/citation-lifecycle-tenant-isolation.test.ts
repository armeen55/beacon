/**
 * Architecture invariant — Phase A.1 §2.18 (2026-05-13).
 *
 * Tenant isolation for the citation-lifecycle module.
 *
 * Every server-side read in `src/domains/citation-lifecycle/` must
 * route through a tenant-scoped repository (`getRepository().forTenant
 * (tenantId)`) — never the unscoped `getRepository()` directly. The
 * pure compute modules (`thresholds`, `eligibility`, `canonicalize-url`,
 * `compute-time-to-citation`, `lifecycle-stage`, `render-copy`) take
 * tenant-scoped data as INPUT and don't touch the repository at all;
 * only the loaders do I/O.
 *
 * This invariant pins:
 *   1. No file in `src/domains/citation-lifecycle/` calls the unscoped
 *      `getRepository()` helper.
 *   2. Any file that imports `getRepository` MUST also call
 *      `.forTenant(...)` on its return value in the same file. The
 *      pair-import check catches `const repo = getRepository();
 *      const rows = await repo.getRecommendedEdits();` — the
 *      cross-tenant leak that has historically cost Beacon time.
 *   3. Pure compute modules don't import the persistence repository
 *      at all (they receive their data as arguments).
 *
 * If a future phase needs to expose a global / cross-tenant aggregate
 * (e.g., the brain in Section 3), the new file must explicitly add
 * itself to ALLOWED_CROSS_TENANT_FILES below AND register the
 * exception in docs/ARCHITECTURE_INVARIANTS_CATALOG.md per Section
 * 12 N1.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const DOMAIN_DIR = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "domains",
  "citation-lifecycle",
);

/**
 * Pure compute modules that MUST NOT import the persistence layer at
 * all — they receive their data via argument. Adding a new module
 * here is the explicit signal that the module is pure.
 */
const PURE_MODULES: ReadonlySet<string> = new Set([
  "thresholds.ts",
  "eligibility.ts",
  "canonicalize-url.ts",
  "compute-time-to-citation.ts",
  "lifecycle-stage.ts",
  "render-copy.ts",
]);

/**
 * Files allowed to perform server-side I/O. Each must route through
 * `.forTenant(tenantId)`. Adding a new file here means a new
 * cross-tenant exposure surface — opt in explicitly.
 */
const ALLOWED_LOADER_FILES: ReadonlySet<string> = new Set([
  "load-lifecycle.ts",
]);

/**
 * Files explicitly cleared to read cross-tenant data. EMPTY in
 * Phase A.1 — the brain (Section 3) will be the first to need an
 * entry, gated on the privacy + scrubbing contract. Adding here
 * REQUIRES a matching catalog entry per Section 12 N1.
 */
const ALLOWED_CROSS_TENANT_FILES: ReadonlySet<string> = new Set([]);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = listTsFiles(DOMAIN_DIR);

describe("Architecture — citation-lifecycle tenant isolation (Phase A.1 §2.18)", () => {
  it("emits at least one source file (sanity check)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("pure compute modules NEVER import the persistence repository", () => {
    for (const file of files) {
      const basename = file.split("/").pop()!;
      if (!PURE_MODULES.has(basename)) continue;
      const src = readFileSync(file, "utf-8");
      // Forbid both the canonical import path and the legacy short
      // alias. Pure compute modules should be argument-fed.
      expect(src, `${basename} must be pure (no repository imports)`).not.toMatch(
        /from\s+["']@\/lib\/persistence\/repositories["']/,
      );
      expect(src, `${basename} must be pure (no getRepository usage)`).not.toMatch(
        /\bgetRepository\s*\(/,
      );
    }
  });

  it("every file that imports getRepository also routes through .forTenant in the same file", () => {
    for (const file of files) {
      const basename = file.split("/").pop()!;
      const src = readFileSync(file, "utf-8");
      const importsRepo =
        /import\s+\{[^}]*\bgetRepository\b[^}]*\}\s+from\s+["']@\/lib\/persistence\/repositories["']/.test(
          src,
        );
      if (!importsRepo) continue;

      // Tenant gate: must call .forTenant(...) somewhere in the file.
      const usesForTenant = /\.forTenant\s*\(/.test(src);
      if (ALLOWED_CROSS_TENANT_FILES.has(basename)) {
        // Explicitly allowed to skip the tenant gate — catalog
        // registration is the human contract. Nothing to assert
        // here at the test level.
        continue;
      }
      expect(
        usesForTenant,
        `${basename} imports getRepository but doesn't pair it with .forTenant — cross-tenant leak risk`,
      ).toBe(true);
    }
  });

  it("only the allowlisted loader file performs I/O in citation-lifecycle", () => {
    // Any file that imports getRepository (and isn't an
    // explicitly-allowed cross-tenant module) must be in
    // ALLOWED_LOADER_FILES. Catches a future "let's add a quick
    // helper" file that bypasses the loader's caching + tenant
    // scope.
    for (const file of files) {
      const basename = file.split("/").pop()!;
      const src = readFileSync(file, "utf-8");
      const importsRepo =
        /import\s+\{[^}]*\bgetRepository\b[^}]*\}\s+from\s+["']@\/lib\/persistence\/repositories["']/.test(
          src,
        );
      if (!importsRepo) continue;
      if (ALLOWED_CROSS_TENANT_FILES.has(basename)) continue;
      expect(
        ALLOWED_LOADER_FILES.has(basename),
        `${basename} performs persistence I/O but isn't in ALLOWED_LOADER_FILES — add it explicitly`,
      ).toBe(true);
    }
  });
});
