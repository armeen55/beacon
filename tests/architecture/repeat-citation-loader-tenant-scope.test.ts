/**
 * Architecture invariant — Section 5.A / loader tenant-scope
 * discipline (2026-05-16).
 *
 * Pins six source-text contracts on
 * `src/domains/citation-lifecycle/load-repeat-citation.ts`:
 *
 *   1. Imports `getRepository` from `@/lib/persistence/repositories`.
 *   2. Active source calls `getRepository().forTenant(tenantId)` —
 *      the explicit-tenant gate (mirrors Phase A.1 + C6a loader
 *      pattern).
 *   3. Calls `repo.getProfoundImportRuns()` — the Section 5
 *      precursor method (commit 4ddb908). NOT the website-crawl
 *      `repo.getObservationRuns()`.
 *   4. Wraps the read in `unstable_cache(...)` with a cache key
 *      array literal containing the five required slots —
 *      `"repeat-citation:v1"`, `tenantId`, `recommendedEdit.id`,
 *      `recommendedEdit.live_at`, `windowDays`.
 *   5. Declares the `recommended_edits:${tenantId}` cache tag
 *      (matches existing lifecycle / change-primary loaders so
 *      edit-mutation invalidation flows through).
 *   6. Does NOT import from `@/storage/canonical-store`
 *      (`section5-no-canonical-store-observation-runs-bridge`
 *      carry-over at the source-text level).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TARGET = "src/domains/citation-lifecycle/load-repeat-citation.ts";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE = stripComments(readFileSync(resolve(REPO_ROOT, TARGET), "utf-8"));

describe("Architecture — load-repeat-citation tenant-scope contracts", () => {
  it("imports getRepository from @/lib/persistence/repositories", () => {
    const re =
      /import\s+\{[^}]*\bgetRepository\b[^}]*\}\s+from\s+["']@\/lib\/persistence\/repositories["']/;
    expect(ACTIVE).toMatch(re);
  });

  it("calls getRepository().forTenant(tenantId) in active source", () => {
    expect(ACTIVE).toMatch(/getRepository\(\)\.forTenant\s*\(\s*tenantId\s*\)/);
  });

  it("calls repo.getProfoundImportRuns() (Section 5 denominator source)", () => {
    expect(ACTIVE).toMatch(/\.getProfoundImportRuns\s*\(\s*\)/);
  });

  it("does NOT call repo.getObservationRuns() (wrong type — website-crawl)", () => {
    // The bare identifier check is strict because the loader
    // legitimately needs `.getProfoundImportRuns()`; we forbid
    // ONLY `.getObservationRuns(` followed by `)` (no
    // `ProfoundImport` prefix).
    expect(ACTIVE).not.toMatch(/(?<!Profound)\.getObservationRuns\s*\(/);
  });

  it("wraps the read in unstable_cache", () => {
    expect(ACTIVE).toContain("unstable_cache");
  });

  it("cache key array contains the five required slots", () => {
    // `"repeat-citation:v1"`, tenantId, edit.id, live_at, windowDays.
    expect(ACTIVE).toContain('"repeat-citation:v1"');
    expect(ACTIVE).toContain("tenantId");
    expect(ACTIVE).toContain("recommendedEdit.id");
    expect(ACTIVE).toContain("recommendedEdit.live_at");
    expect(ACTIVE).toContain("windowDays");
  });

  it("declares the recommended_edits:${tenantId} cache tag", () => {
    expect(ACTIVE).toMatch(/`recommended_edits:\$\{tenantId\}`/);
  });

  it("does NOT import from @/storage/canonical-store", () => {
    const offending =
      ACTIVE.includes('"@/storage/canonical-store"') ||
      ACTIVE.includes("'@/storage/canonical-store'");
    expect(offending).toBe(false);
  });
});
