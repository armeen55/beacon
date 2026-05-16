/**
 * Architecture invariant — A.3.b1.alpha (2026-05-16).
 *
 * Tenant isolation for the GSC URL Inspection client.
 *
 * The GSC URL Inspection client at `src/lib/connectors/gsc/client.ts`
 * is operator-substrate only. Its single public function
 * `gscUrlInspect({ tenantId, siteUrl, inspectionUrl, now })` must:
 *
 *   1. Take an EXPLICIT `tenantId` parameter (no ambient
 *      `currentTenantSlug()` / `currentTenantId()` reads).
 *   2. Resolve the tenant slug from the explicit `tenantId` (via
 *      `getTenant(tenantId)` + the `BEACON_TENANT_ID` / `BEACON_TENANT_SLUG`
 *      operator-bootstrap fallback).
 *   3. Use `getDataDir(slug)` to route the cache file path
 *      `.data/tenants/{slug}/gsc-url-inspections.json`. NEVER read or
 *      write the flat `.data/` root directly.
 *   4. NOT import any customer-surface module (no `@/app`,
 *      `@/components`, `@/domains/today`, `@/domains/recommendations`,
 *      `@/domains/indexability`). The client is operator-substrate
 *      only; the A.3.b1.beta slice will wire it into indexability as
 *      a separate trust-boundary review.
 *
 * Mirrors the locked `profound-import-runs-explicit-tenant-scope`
 * invariant pattern: explicit tenantId, NEVER ambient.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const CLIENT_PATH = join(REPO_ROOT, "src/lib/connectors/gsc/client.ts");
const TYPES_PATH = join(REPO_ROOT, "src/lib/connectors/gsc/types.ts");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const CLIENT_SRC = readFileSync(CLIENT_PATH, "utf-8");
const CLIENT_CODE = stripComments(CLIENT_SRC);
const TYPES_SRC = readFileSync(TYPES_PATH, "utf-8");

describe("gsc client — explicit tenant scope", () => {
  it("gscUrlInspect signature accepts an explicit tenantId parameter", () => {
    expect(
      /export\s+async\s+function\s+gscUrlInspect\s*\(/.test(CLIENT_CODE),
      "client.ts must export an async function `gscUrlInspect`.",
    ).toBe(true);
    // The args type must declare tenantId: string.
    expect(
      /tenantId\s*:\s*string/.test(CLIENT_CODE),
      "gscUrlInspect args must declare tenantId: string. Explicit tenant " +
        "scope is the locked invariant — no ambient currentTenantId reads.",
    ).toBe(true);
  });

  it("client.ts does NOT call ambient currentTenantSlug() / currentTenantId()", () => {
    expect(
      /\bcurrentTenantSlug\s*\(/.test(CLIENT_CODE),
      "client.ts must NOT call currentTenantSlug() — the explicit " +
        "tenantId parameter is the only allowed tenant scope.",
    ).toBe(false);
    expect(
      /\bcurrentTenantId\s*\(/.test(CLIENT_CODE),
      "client.ts must NOT call currentTenantId() — the explicit " +
        "tenantId parameter is the only allowed tenant scope.",
    ).toBe(false);
  });

  it("client.ts resolves the slug via getTenant(tenantId)", () => {
    expect(
      /from\s+["']@\/domains\/tenants\/store["']/.test(CLIENT_CODE),
      "client.ts must import getTenant from @/domains/tenants/store " +
        "so slug resolution goes through the tenant registry.",
    ).toBe(true);
    expect(
      /\bgetTenant\s*\(/.test(CLIENT_CODE),
      "client.ts must call getTenant(tenantId) to resolve the slug.",
    ).toBe(true);
  });

  it("client.ts uses getDataDir(slug) for the tenant-scoped cache path", () => {
    expect(
      /from\s+["']@\/lib\/tenant["']/.test(CLIENT_CODE),
      "client.ts must import getDataDir from @/lib/tenant.",
    ).toBe(true);
    expect(
      /\bgetDataDir\s*\(/.test(CLIENT_CODE),
      "client.ts must call getDataDir(slug) to route the cache file " +
        "into the tenant-scoped subdirectory.",
    ).toBe(true);
  });

  it("client.ts does NOT read or write the flat .data/ root", () => {
    // Strip out the env-fallback string literals (BEACON_TENANT_*),
    // then ensure no path string mentions a flat `.data/` not gated by
    // getDataDir.
    // The only allowed `.data` mentions are in JSDoc (already stripped)
    // and the cache filename constant; neither hardcodes the flat root.
    const hasFlatDataRoot = /["']\s*\.data\//.test(CLIENT_CODE);
    expect(
      hasFlatDataRoot,
      "client.ts must NOT hardcode a flat `.data/` path. All disk I/O " +
        "must route through getDataDir(slug) so each tenant gets its " +
        "own subdirectory.",
    ).toBe(false);
  });

  it("client.ts does NOT import any customer-facing surface modules", () => {
    const forbiddenImports = [
      /from\s+["']@\/app\//,
      /from\s+["']@\/components\//,
      /from\s+["']@\/domains\/today["']/,
      /from\s+["']@\/domains\/today\//,
      /from\s+["']@\/domains\/recommendations["']/,
      /from\s+["']@\/domains\/recommendations\//,
      /from\s+["']@\/domains\/indexability["']/,
      /from\s+["']@\/domains\/indexability\//,
    ];
    for (const pat of forbiddenImports) {
      expect(
        pat.test(CLIENT_CODE),
        "client.ts must NOT import customer-facing surfaces. The A.3.b1.alpha " +
          "slice is operator-substrate only; the beta slice wires it into " +
          "indexability as a separate trust-boundary review. Forbidden " +
          "import pattern: " +
          pat.source,
      ).toBe(false);
    }
  });

  it("client.ts is marked server-only", () => {
    expect(
      /import\s+["']server-only["']/.test(CLIENT_CODE),
      "client.ts must import 'server-only' so it cannot be bundled " +
        "into client components.",
    ).toBe(true);
  });

  it("client.ts cache filename is gsc-url-inspections.json", () => {
    expect(
      /gsc-url-inspections\.json/.test(CLIENT_CODE),
      "client.ts must use the locked cache filename " +
        "`gsc-url-inspections.json`. Pinned for future Supabase-migration " +
        "compatibility (A.3.b2).",
    ).toBe(true);
  });

  it("client.ts requires the webmasters.readonly scope before calling the API", () => {
    expect(
      /webmasters\.readonly/.test(CLIENT_CODE),
      "client.ts must reference the webmasters.readonly scope when " +
        "checking the connector token. The fail-soft contract returns " +
        "null when the scope is missing.",
    ).toBe(true);
  });
});

describe("gsc types — operator-substrate posture", () => {
  it("types.ts is marked server-only", () => {
    expect(
      /import\s+["']server-only["']/.test(stripComments(TYPES_SRC)),
      "types.ts must import 'server-only' so the operator-substrate " +
        "types never bundle into client components.",
    ).toBe(true);
  });

  it("client.ts file header declares the operator-substrate posture", () => {
    // The unstripped source must carry the A.3.b1.alpha doc header so
    // future readers know the slice is NOT customer-facing.
    expect(
      /A\.3\.b1\.alpha/.test(CLIENT_SRC),
      "client.ts header must declare A.3.b1.alpha posture explicitly " +
        "so future contributors don't accidentally wire it into a " +
        "customer surface.",
    ).toBe(true);
    expect(
      /operator-substrate/i.test(CLIENT_SRC),
      "client.ts header must declare 'operator-substrate' posture " +
        "(NOT wired into indexability or customer surfaces in this slice).",
    ).toBe(true);
  });
});
