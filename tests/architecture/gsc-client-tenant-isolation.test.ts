/**
 * Architecture invariant — A.3.b1.alpha (2026-05-16) + A.3.b2 (2026-05-17).
 *
 * Tenant isolation for the GSC URL Inspection client.
 *
 * The GSC URL Inspection client at `src/lib/connectors/gsc/client.ts`
 * is operator-substrate only. Its single public function
 * `gscUrlInspect({ tenantId, siteUrl, inspectionUrl, now })` must:
 *
 *   1. Take an EXPLICIT `tenantId` parameter (no ambient
 *      `currentTenantSlug()` / `currentTenantId()` reads).
 *   2. Read + write the cache through the Supabase admin client
 *      (`getSupabaseAdmin()`) against the `gsc_url_inspections`
 *      table, filtered by `tenant_id` on the composite PK
 *      `(tenant_id, inspection_url)`. The A.3.b1.alpha disk-cache
 *      path is RETIRED — no `getDataDir(slug)`, no
 *      `.data/tenants/{slug}/gsc-url-inspections.json`.
 *   3. NOT import any customer-surface module (no `@/app`,
 *      `@/components`, `@/domains/today`, `@/domains/recommendations`,
 *      `@/domains/indexability`). The client is operator-substrate
 *      only; the A.3.b1.beta slice will wire it into indexability as
 *      a separate trust-boundary review.
 *
 * Mirrors the locked `profound-import-runs-explicit-tenant-scope`
 * pattern (explicit tenantId beats ambient) PLUS the locked
 * `connector-store-no-disk-write` discipline (durable storage in
 * Supabase, not on Vercel's read-only lambda FS).
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

  it("client.ts is marked server-only", () => {
    expect(
      /import\s+["']server-only["']/.test(CLIENT_CODE),
      "client.ts must import 'server-only' so it cannot be bundled " +
        "into client components.",
    ).toBe(true);
  });
});

describe("gsc client — Supabase-backed cache (post-A.3.b2)", () => {
  it("imports getSupabaseAdmin from @/lib/persistence/supabase", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(CLIENT_CODE) &&
        /\bgetSupabaseAdmin\b/.test(CLIENT_CODE),
      "client.ts must import + use getSupabaseAdmin() — the cache lives " +
        "in Supabase, not on disk.",
    ).toBe(true);
  });

  it("references the gsc_url_inspections cache table", () => {
    expect(
      /gsc_url_inspections/.test(CLIENT_CODE),
      "client.ts must reference the locked cache table " +
        "`gsc_url_inspections`. Pinned by the A.3.b2 migration.",
    ).toBe(true);
  });

  it("filters cache queries by tenant_id", () => {
    expect(
      /\.eq\(\s*["']tenant_id["']\s*,/.test(CLIENT_CODE),
      "client.ts must filter Supabase queries by .eq('tenant_id', ...). " +
        "Composite-PK isolation is structural — every read + write must " +
        "scope by tenant_id.",
    ).toBe(true);
  });

  it("upserts with onConflict='tenant_id,inspection_url' (composite PK)", () => {
    expect(
      /onConflict\s*:\s*["']tenant_id,inspection_url["']/.test(CLIENT_CODE),
      "client.ts must upsert with onConflict='tenant_id,inspection_url' so " +
        "the composite-PK row is updated in place per tenant + per URL.",
    ).toBe(true);
  });

  it("does NOT call getDataDir (disk-path helper is RETIRED)", () => {
    expect(
      /\bgetDataDir\s*\(/.test(CLIENT_CODE),
      "client.ts must NOT call getDataDir() — the A.3.b1.alpha disk cache " +
        "is RETIRED. The cache lives in Supabase under " +
        "public.gsc_url_inspections.",
    ).toBe(false);
  });

  it("does NOT import @/lib/tenant (no path-tenant routing)", () => {
    expect(
      /from\s+["']@\/lib\/tenant["']/.test(CLIENT_CODE),
      "client.ts must NOT import from @/lib/tenant — the disk-path " +
        "tenant routing is RETIRED. Supabase composite-PK is the " +
        "tenant-isolation gate.",
    ).toBe(false);
  });

  it("does NOT resolve a slug via getTenant() (no longer needed for the cache path)", () => {
    expect(
      /from\s+["']@\/domains\/tenants\/store["']/.test(CLIENT_CODE),
      "client.ts must NOT import getTenant from @/domains/tenants/store — " +
        "the Supabase cache uses the raw tenantId, not the slug. The " +
        "A.3.b1.alpha slug-resolution helper is RETIRED.",
    ).toBe(false);
  });
});

describe("gsc client — operator-substrate posture", () => {
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
        "client.ts must NOT import customer-facing surfaces. The client is " +
          "operator-substrate only; the A.3.b1.beta slice wires it into " +
          "indexability as a separate trust-boundary review. Forbidden " +
          "import pattern: " +
          pat.source,
      ).toBe(false);
    }
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
    // The unstripped source must carry the A.3.b2 doc header so future
    // readers know the slice is operator-substrate only.
    expect(
      /A\.3\.b2/.test(CLIENT_SRC),
      "client.ts header must declare A.3.b2 posture explicitly so future " +
        "contributors see the Supabase-cache migration.",
    ).toBe(true);
    expect(
      /operator-substrate/i.test(CLIENT_SRC),
      "client.ts header must declare 'operator-substrate' posture " +
        "(NOT wired into indexability or customer surfaces in this slice).",
    ).toBe(true);
  });
});
