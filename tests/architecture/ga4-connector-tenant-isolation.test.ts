/**
 * Architecture invariant — Slice 9.A1 (2026-05-18).
 *
 * Tenant isolation for the GA4 connector. Mirrors the locked GSC
 * client pattern (`tests/architecture/gsc-client-tenant-isolation.test.ts`).
 *
 * Contract:
 *   1. `listGa4PropertiesForTenant(tenantId: string)` is an exported
 *      function — explicit tenant parameter.
 *   2. `ga4ApiFetch({ tenantId, ... })` is an exported function —
 *      explicit tenant parameter.
 *   3. No file under `src/lib/connectors/ga4/` calls ambient
 *      `currentTenantSlug()` / `currentTenantId()` — the explicit
 *      parameter is the ONLY allowed tenant scope.
 *   4. The client module references the `analytics.readonly` scope
 *      string (positive invariant: scope check is wired).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CLIENT_PATH = join(REPO_ROOT, "src/lib/connectors/ga4/client.ts");
const PROP_PATH = join(REPO_ROOT, "src/lib/connectors/ga4/property-selection.ts");
const TYPES_PATH = join(REPO_ROOT, "src/lib/connectors/ga4/types.ts");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const CLIENT_CODE = stripComments(readFileSync(CLIENT_PATH, "utf-8"));
const PROP_CODE = stripComments(readFileSync(PROP_PATH, "utf-8"));
const TYPES_CODE = stripComments(readFileSync(TYPES_PATH, "utf-8"));

describe("ga4 connector — explicit tenant scope", () => {
  it("ga4ApiFetch declares tenantId: string in its args", () => {
    expect(
      /export\s+async\s+function\s+ga4ApiFetch/.test(CLIENT_CODE),
      "client.ts must export `ga4ApiFetch`.",
    ).toBe(true);
    expect(
      /tenantId\s*:\s*string/.test(CLIENT_CODE),
      "ga4ApiFetch args must declare tenantId: string.",
    ).toBe(true);
  });

  it("listGa4PropertiesForTenant takes a tenantId: string parameter", () => {
    expect(
      /export\s+async\s+function\s+listGa4PropertiesForTenant/.test(PROP_CODE),
      "property-selection.ts must export listGa4PropertiesForTenant.",
    ).toBe(true);
    // Multi-line signature: collapse whitespace via replace before matching
    // so the regex doesn't need the `s` flag (which requires ES2018+ target).
    const collapsed = PROP_CODE.replace(/\s+/g, " ");
    expect(
      /listGa4PropertiesForTenant\s*\(\s*tenantId\s*:\s*string/.test(collapsed),
      "listGa4PropertiesForTenant signature must declare tenantId: string as the first parameter.",
    ).toBe(true);
  });

  it("no GA4 connector file calls ambient currentTenantSlug() / currentTenantId()", () => {
    for (const [label, code] of [
      ["client.ts", CLIENT_CODE],
      ["property-selection.ts", PROP_CODE],
      ["types.ts", TYPES_CODE],
    ] as const) {
      expect(
        /\bcurrentTenantSlug\s*\(/.test(code),
        `${label} must NOT call currentTenantSlug() — explicit tenantId is the only allowed scope.`,
      ).toBe(false);
      expect(
        /\bcurrentTenantId\s*\(/.test(code),
        `${label} must NOT call currentTenantId() — explicit tenantId is the only allowed scope.`,
      ).toBe(false);
    }
  });

  it("client.ts references the analytics.readonly scope literal", () => {
    expect(
      /analytics\.readonly/.test(CLIENT_CODE),
      "client.ts must reference the analytics.readonly scope when validating the token.",
    ).toBe(true);
  });

  it("property-selection.ts targets the Analytics Admin accountSummaries endpoint", () => {
    expect(
      /analyticsadmin\.googleapis\.com\/v1beta\/accountSummaries/.test(PROP_CODE),
      "property-selection.ts must call analyticsadmin.googleapis.com/v1beta/accountSummaries — the Admin API account/property summary endpoint.",
    ).toBe(true);
  });
});
