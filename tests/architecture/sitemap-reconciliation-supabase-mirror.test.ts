/**
 * Architecture invariant — Phase A.3 post-A.3.5 second-stage
 * (2026-05-15).
 *
 * Sitemap-reconciliation is mirrored to Supabase
 * (`public.sitemap_reconciliation`) as a per-tenant singleton row,
 * retiring the GLOBAL `.data/global/sitemap-reconciliation.json`
 * file that returned null on Vercel's read-only lambda FS AND
 * inherited a cross-tenant hazard.
 *
 * This invariant pins, at the source-text level:
 *   1. `store-classification.ts` lists `sitemap-reconciliation` in
 *      `TENANT_SCOPED_STORES` (no longer in `GLOBAL_STORES`).
 *   2. `TenantRepository` declares both `getSitemapReconciliation`
 *      and `setSitemapReconciliation` (paired read/write).
 *   3. The indexability loader (`load-indexability.ts`) reads
 *      sitemap-reconciliation via `repo.getSitemapReconciliation()`
 *      (NOT the standalone `@/domains/pages/sitemap-reconciliation-store`
 *      import).
 *   4. The operator diagnostics page does the same.
 *   5. `scripts/scan-owned-pages.ts`'s `saveReconciliation` is
 *      async and routes through `repo.setSitemapReconciliation`.
 *   6. supabase-backend's `getSitemapReconciliation` (tenant-scoped)
 *      soft-fails to null on Postgres error 42P01 (sequencing
 *      model A — code safe to deploy before migration applies).
 *   7. supabase-backend's `setSitemapReconciliation` UPSERTs on
 *      `tenant_id` (fail-loud on missing table).
 *
 * Retirement: refines when the schema evolves a v2 shape.
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
    .replace(/^\s*\/\/.*$/gm, "");
}

const STORE_CLASSIFICATION = read("src/lib/persistence/store-classification.ts");
const REPO_TYPES = stripComments(read("src/lib/persistence/repositories/types.ts"));
const SUPABASE_BACKEND = stripComments(
  read("src/lib/persistence/repositories/supabase-backend.ts"),
);
const LOADER = stripComments(read("src/domains/indexability/load-indexability.ts"));
const PAGE = stripComments(
  read("src/app/(shell)/diagnostics/indexability/page.tsx"),
);
const SCAN_SCRIPT = stripComments(read("scripts/scan-owned-pages.ts"));

describe("Architecture — sitemap-reconciliation Supabase mirror (Phase A.3 post-A.3.5)", () => {
  it("`sitemap-reconciliation` is in TENANT_SCOPED_STORES (classification flipped from GLOBAL)", () => {
    // Slice the file from the TENANT_SCOPED_STORES declaration to
    // the next `]);` closing pair; that range contains every entry
    // declared in the set body.
    const startIdx = STORE_CLASSIFICATION.indexOf(
      "export const TENANT_SCOPED_STORES",
    );
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const endIdx = STORE_CLASSIFICATION.indexOf("]);", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const body = STORE_CLASSIFICATION.slice(startIdx, endIdx);
    expect(body).toContain('"sitemap-reconciliation"');
  });

  it("`sitemap-reconciliation` is NOT in GLOBAL_STORES (entry retired with explanatory comment)", () => {
    const startIdx = STORE_CLASSIFICATION.indexOf(
      "export const GLOBAL_STORES",
    );
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const endIdx = STORE_CLASSIFICATION.indexOf("]);", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const body = STORE_CLASSIFICATION.slice(startIdx, endIdx);
    // Strip line comments first so a documenting line about the
    // move ("NOTE: sitemap-reconciliation was moved to ...") does
    // not trip the executable-entry check.
    const stripped = body.replace(/\/\/[^\n]*/g, "");
    // Executable list entries are quoted bare strings; verify
    // there's no `"sitemap-reconciliation"` left in the executable
    // body.
    expect(stripped).not.toContain('"sitemap-reconciliation"');
  });

  it("TenantRepository declares getSitemapReconciliation + setSitemapReconciliation", () => {
    expect(REPO_TYPES).toMatch(
      /getSitemapReconciliation\s*\(\s*\)\s*:\s*Promise<SitemapReconciliation\s*\|\s*null>/,
    );
    expect(REPO_TYPES).toMatch(
      /setSitemapReconciliation\s*\(\s*recon\s*:\s*SitemapReconciliation\s*\)\s*:\s*Promise<void>/,
    );
  });

  it("indexability loader reads sitemap-reconciliation via repo.getSitemapReconciliation()", () => {
    expect(LOADER).toMatch(/repo\.getSitemapReconciliation\s*\(/);
  });

  it("indexability loader no longer imports the standalone sitemap-reconciliation-store", () => {
    expect(LOADER).not.toMatch(
      /from\s+["']@\/domains\/pages\/sitemap-reconciliation-store["']/,
    );
  });

  it("operator diagnostics page reads sitemap-reconciliation via repo.getSitemapReconciliation()", () => {
    expect(PAGE).toMatch(/repo\.getSitemapReconciliation\s*\(/);
  });

  it("operator diagnostics page no longer imports the standalone sitemap-reconciliation-store", () => {
    expect(PAGE).not.toMatch(
      /from\s+["']@\/domains\/pages\/sitemap-reconciliation-store["']/,
    );
  });

  it("scan-owned-pages.ts saveReconciliation is async + writes via repo.setSitemapReconciliation", () => {
    expect(SCAN_SCRIPT).toMatch(
      /\basync\s+function\s+saveReconciliation\s*\(/,
    );
    expect(SCAN_SCRIPT).toMatch(
      /saveReconciliation\s*\([\s\S]*?tenantId\s*:\s*string[\s\S]*?\)\s*:\s*Promise<void>/,
    );
    expect(SCAN_SCRIPT).toMatch(/setSitemapReconciliation\s*\(/);
  });

  it("supabase-backend tenant-scoped getSitemapReconciliation soft-fails on 42P01 undefined_table", () => {
    // Locate the tenant-scoped impl (inside the forTenant block —
    // signaled by the surrounding repo.getSitemapReconciliation
    // shape that selects by tenant_id).
    const match = SUPABASE_BACKEND.match(
      /getSitemapReconciliation\s*:\s*async[\s\S]{0,1200}?42P01/,
    );
    expect(
      match,
      "supabase-backend tenant-scoped getSitemapReconciliation missing 42P01 soft-fail",
    ).toBeTruthy();
  });

  it("supabase-backend setSitemapReconciliation UPSERTs on tenant_id (fail-loud on missing table)", () => {
    expect(SUPABASE_BACKEND).toMatch(/setSitemapReconciliation\s*:\s*async/);
    // The UPSERT body must reference tenant_id as the conflict key.
    const match = SUPABASE_BACKEND.match(
      /setSitemapReconciliation\s*:\s*async[\s\S]{0,1500}?onConflict\s*:\s*["']tenant_id["']/,
    );
    expect(match).toBeTruthy();
  });
});
