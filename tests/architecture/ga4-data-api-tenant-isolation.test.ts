/**
 * Architecture invariant — Slice 9.A2α (2026-05-19).
 *
 * Tenant isolation for the GA4 Data API client. Mirrors the locked
 * `ga4-connector-tenant-isolation` invariant from 9.A1α — both
 * `client.ts` and `data-api.ts` must declare explicit `tenantId:
 * string` parameters on every public function and MUST NOT call
 * ambient `currentTenantSlug()` / `currentTenantId()`.
 *
 * Pins:
 *   1. `runGa4UrlTrafficReport` exported with `tenantId: string`
 *      threaded through args.
 *   2. No ambient `currentTenantSlug` / `currentTenantId` reads in
 *      `data-api.ts`.
 *   3. `data-api.ts` is `import "server-only"`.
 *   4. `data-api.ts` references the `analytics.readonly` scope
 *      literal (positive check: the scope gate is wired).
 *   5. `data-api.ts` references the `analyticsdata.googleapis.com`
 *      Data API host (positive check: endpoint not drifted).
 *   6. `data-api.ts` does NOT import customer-facing surfaces.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const DATA_API_PATH = join(REPO_ROOT, "src/lib/connectors/ga4/data-api.ts");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const DATA_API_CODE = stripComments(readFileSync(DATA_API_PATH, "utf-8"));

describe("ga4 data-api — explicit tenant scope", () => {
  it("runGa4UrlTrafficReport is exported as an async function", () => {
    expect(
      /export\s+async\s+function\s+runGa4UrlTrafficReport/.test(DATA_API_CODE),
      "data-api.ts must export `runGa4UrlTrafficReport` as an async function.",
    ).toBe(true);
  });

  it("runGa4UrlTrafficReport args declare tenantId: string", () => {
    // The args object is a typed parameter (Ga4RunReportArgs). The
    // type declaration lives in types.ts; the impl signature simply
    // destructures `tenantId`. Verify both.
    const collapsed = DATA_API_CODE.replace(/\s+/g, " ");
    expect(
      /runGa4UrlTrafficReport\s*\(\s*args\s*:\s*Ga4RunReportArgs/.test(collapsed),
      "runGa4UrlTrafficReport must take a typed `args: Ga4RunReportArgs` parameter.",
    ).toBe(true);
    expect(
      /const\s*{\s*tenantId\s*,/.test(DATA_API_CODE),
      "runGa4UrlTrafficReport must destructure tenantId from its args.",
    ).toBe(true);
  });

  it("data-api.ts does NOT call ambient currentTenantSlug() / currentTenantId()", () => {
    expect(
      /\bcurrentTenantSlug\s*\(/.test(DATA_API_CODE),
      "data-api.ts must NOT call currentTenantSlug() — explicit tenantId is the only allowed scope.",
    ).toBe(false);
    expect(
      /\bcurrentTenantId\s*\(/.test(DATA_API_CODE),
      "data-api.ts must NOT call currentTenantId() — explicit tenantId is the only allowed scope.",
    ).toBe(false);
  });

  it("data-api.ts is marked server-only", () => {
    expect(
      /import\s+["']server-only["']/.test(DATA_API_CODE),
      "data-api.ts must import 'server-only' so it cannot be bundled into client components.",
    ).toBe(true);
  });

  it("data-api.ts references the analytics.readonly scope literal", () => {
    expect(
      /analytics\.readonly/.test(DATA_API_CODE),
      "data-api.ts must reference the analytics.readonly scope literal when validating the token.",
    ).toBe(true);
  });

  it("data-api.ts targets the analyticsdata.googleapis.com Data API host", () => {
    expect(
      /analyticsdata\.googleapis\.com/.test(DATA_API_CODE),
      "data-api.ts must reference the analyticsdata.googleapis.com host — this is the Data API endpoint locked in 9.A2α.",
    ).toBe(true);
    expect(
      /:runReport/.test(DATA_API_CODE),
      "data-api.ts must call the :runReport endpoint per the locked Section 9.A2α prompt.",
    ).toBe(true);
  });

  it("data-api.ts does NOT import any customer-facing surface module", () => {
    const forbiddenImports = [
      /from\s+["']@\/app\//,
      /from\s+["']@\/components\//,
      /from\s+["']@\/domains\/today["']/,
      /from\s+["']@\/domains\/today\//,
      /from\s+["']@\/domains\/recommendations["']/,
      /from\s+["']@\/domains\/recommendations\//,
      /from\s+["']@\/domains\/changes["']/,
      /from\s+["']@\/domains\/changes\//,
    ];
    for (const pat of forbiddenImports) {
      expect(
        pat.test(DATA_API_CODE),
        `data-api.ts must NOT import customer-facing surfaces. Forbidden import pattern: ${pat.source}`,
      ).toBe(false);
    }
  });
});
