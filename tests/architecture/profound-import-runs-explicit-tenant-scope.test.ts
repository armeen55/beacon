/**
 * Architecture invariant — Section 5 precursor / explicit-tenant
 * `getProfoundImportRuns()` scoping (2026-05-16).
 *
 * Pins that the new Section-5 denominator reader on `forTenant(
 * tenantId)` scopes by the explicit `tenantId` argument, NOT by
 * ambient `currentTenantSlug()` routing.
 *
 * The temptation when adding a disk-backed read to the
 * TenantRepository is to call `readStore("observation-runs")` or
 * `readDotDataJson("observation-runs")`, both of which route
 * through `resolveDataPath` → `currentTenantSlug()`. That makes
 * the method scope by AMBIENT request slug rather than by the
 * explicit `tenantId` captured in the closure. A caller running
 * `forTenant("tenant-a").getProfoundImportRuns()` while the active
 * request is for tenant-b would silently leak tenant-b's rows.
 *
 * Single-helper design: the explicit-tenant disk-read helper
 * lives in `tenant-repo.ts` (as `readProfoundImportRunsForTenant`)
 * and is RE-USED by `supabase-backend.ts`'s `forTenant` block via
 * a direct import. This consolidation preserves the existing
 * `canonical-store-tenant-isolation` invariant that forbids
 * `supabase-backend.ts` from importing `getTenant` directly (the
 * resolver lives one layer up in tenant-repo).
 *
 * Pins:
 *   • tenant-repo.ts declares the explicit-tenant helper.
 *   • Helper accepts `tenantId: string`, resolves slug via
 *     `getTenant(tenantId)` with operator-bootstrap env fallback,
 *     reads via `getDataDir(slug)` + `readFileSync`.
 *   • Helper does NOT call `readStore("observation-runs")` or
 *     `readDotDataJson("observation-runs")` (both ambient-routed).
 *   • supabase-backend.ts re-uses the same helper (one source of
 *     truth) by importing it from `./tenant-repo`.
 *   • Neither file imports `getObservationRuns` from
 *     `@/storage/canonical-store`.
 *
 * Currently GREEN by construction. Retires never — the
 * explicit-tenant-vs-ambient distinction is structural.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TENANT_REPO = "src/lib/persistence/repositories/tenant-repo.ts";
const SUPABASE_BACKEND = "src/lib/persistence/repositories/supabase-backend.ts";

describe("Architecture — getProfoundImportRuns scopes by explicit tenantId (tenant-repo)", () => {
  const active = stripComments(read(TENANT_REPO));

  it("declares the explicit-tenant disk-read helper", () => {
    expect(active).toContain("function readProfoundImportRunsForTenant");
  });

  it("helper accepts tenantId: string as the first parameter", () => {
    const re =
      /function\s+readProfoundImportRunsForTenant\s*\(\s*\n?\s*tenantId:\s*string/;
    expect(active).toMatch(re);
  });

  it("helper resolves slug via getTenant(tenantId)", () => {
    expect(active).toContain("getTenant(tenantId)");
  });

  it("helper honors BEACON_TENANT_ID / BEACON_TENANT_SLUG bootstrap fallback", () => {
    expect(active).toContain("BEACON_TENANT_ID");
    expect(active).toContain("BEACON_TENANT_SLUG");
  });

  it("helper uses getDataDir(slug) for the per-tenant path", () => {
    expect(active).toContain("getDataDir(slug)");
  });

  it("helper reads the disk file directly via readFileSync", () => {
    expect(active).toContain("readFileSync");
  });

  it("getProfoundImportRuns method body does NOT call readStore(\"observation-runs\")", () => {
    const callRe =
      /readStore\s*(?:<[^>]*>\s*)?\(\s*["']observation-runs["']\s*\)/;
    expect(active).not.toMatch(callRe);
  });

  it("getProfoundImportRuns method body does NOT call readDotDataJson(\"observation-runs\")", () => {
    const callRe =
      /readDotDataJson\s*(?:<[^>]*>\s*)?\(\s*["']observation-runs["']\s*\)/;
    expect(active).not.toMatch(callRe);
  });

  it("source does NOT import from @/storage/canonical-store", () => {
    const offending =
      active.includes('"@/storage/canonical-store"') ||
      active.includes("'@/storage/canonical-store'");
    expect(offending).toBe(false);
  });
});

describe("Architecture — supabase-backend re-uses the same helper (single source of truth)", () => {
  const active = stripComments(read(SUPABASE_BACKEND));

  it("imports readProfoundImportRunsForTenant from ./tenant-repo", () => {
    const re =
      /import\s*\{[^}]*readProfoundImportRunsForTenant[^}]*\}\s*from\s*["']\.\/tenant-repo["']/;
    expect(active).toMatch(re);
  });

  it("forTenant.getProfoundImportRuns delegates to the shared helper", () => {
    // The method body must consist of a single call passing the
    // captured tenantId — no inline disk read, no duplicate resolver.
    const re =
      /getProfoundImportRuns:\s*async\s*\(\s*\)\s*=>\s*\n?\s*readProfoundImportRunsForTenant\s*\(\s*tenantId\s*\)/;
    expect(active).toMatch(re);
  });

  it("does NOT call readStore(\"observation-runs\") (ambient-routed)", () => {
    const callRe =
      /readStore\s*(?:<[^>]*>\s*)?\(\s*["']observation-runs["']\s*\)/;
    expect(active).not.toMatch(callRe);
  });

  it("does NOT call readDotDataJson(\"observation-runs\") (ambient-routed)", () => {
    const callRe =
      /readDotDataJson\s*(?:<[^>]*>\s*)?\(\s*["']observation-runs["']\s*\)/;
    expect(active).not.toMatch(callRe);
  });

  it("does NOT import from @/storage/canonical-store", () => {
    const offending =
      active.includes('"@/storage/canonical-store"') ||
      active.includes("'@/storage/canonical-store'");
    expect(offending).toBe(false);
  });
});
