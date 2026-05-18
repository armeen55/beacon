/**
 * Architecture invariant — connector-tokens-supabase-and-gsc-scope-split
 * (2026-05-16).
 *
 * Pins that every connector-store read/write/delete on Supabase is
 * tenant-scoped: each operation either threads an explicit `tenantId`
 * parameter through to the query OR resolves the ambient tenant via
 * `currentTenantId()`.
 *
 * Concretely:
 *   • The exported function signatures in `connector-store.ts` accept
 *     `tenantId?: string` for both read AND write paths.
 *   • Every Supabase `.from("connector_tokens")` chain in the same
 *     file pairs `.eq("tenant_id", ...)` OR routes through
 *     `.upsert({ tenant_id, ... })` with the same value source.
 *   • `resolveTenantId` helper either returns the explicit argument
 *     OR awaits `currentTenantId()` — never falls back to a static.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const STORE_PATH = join(
  resolve(__dirname, "../.."),
  "src/lib/connector-store.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const STORE_CODE = stripComments(readFileSync(STORE_PATH, "utf-8"));

describe("connector-store — tenant scope on signatures", () => {
  it("getConnectorToken accepts `tenantId?: string`", () => {
    expect(
      /getConnectorToken\s*\([^)]*tenantId\?\s*:\s*string/.test(STORE_CODE),
    ).toBe(true);
  });

  it("getGoogleConnectorToken accepts `tenantId?: string`", () => {
    expect(
      /getGoogleConnectorToken\s*\([^)]*tenantId\?\s*:\s*string/.test(STORE_CODE),
    ).toBe(true);
  });

  it("getYelpConnectorToken accepts `tenantId?: string`", () => {
    expect(
      /getYelpConnectorToken\s*\([^)]*tenantId\?\s*:\s*string/.test(STORE_CODE),
    ).toBe(true);
  });

  it("saveConnectorToken accepts `tenantId?: string`", () => {
    expect(
      /saveConnectorToken\s*\([^)]*tenantId\?\s*:\s*string/.test(STORE_CODE),
    ).toBe(true);
  });

  it("deleteConnectorToken accepts `tenantId?: string`", () => {
    expect(
      /deleteConnectorToken\s*\([^)]*tenantId\?\s*:\s*string/.test(STORE_CODE),
    ).toBe(true);
  });

  it("getConnectorInfo accepts `tenantId?: string`", () => {
    expect(
      /getConnectorInfo\s*\([^)]*tenantId\?\s*:\s*string/.test(STORE_CODE),
    ).toBe(true);
  });
});

describe("connector-store — Supabase queries are tenant-filtered", () => {
  it("every connector_tokens read passes through eq(\"tenant_id\", ...)", () => {
    // Find every .from("connector_tokens") chain and verify the same
    // chain (within a reasonable window) calls .eq("tenant_id", ...)
    // OR .upsert({ tenant_id }).
    const fromChains = STORE_CODE.match(
      /\.from\(\s*TABLE\s*\)[\s\S]{0,500}/g,
    );
    expect(fromChains).not.toBeNull();
    for (const chain of fromChains ?? []) {
      const tenantScoped =
        /\.eq\(\s*["']tenant_id["']\s*,/.test(chain) ||
        /\bupsert\s*\(\s*\{[\s\S]{0,200}tenant_id\s*:/.test(chain);
      expect(
        tenantScoped,
        "Every connector_tokens query in connector-store.ts must " +
          "scope by tenant_id. Found a chain without an eq('tenant_id',...) " +
          "or upsert({ tenant_id, ... }):\n" +
          chain.slice(0, 200),
      ).toBe(true);
    }
  });

  it("resolves ambient tenant via currentTenantId() when explicit arg is omitted", () => {
    // The internal resolver must consult currentTenantId — pin both
    // the import + a call site.
    expect(/from\s+["']@\/lib\/tenant-context["']/.test(STORE_CODE)).toBe(true);
    expect(/\bcurrentTenantId\s*\(/.test(STORE_CODE)).toBe(true);
  });
});

describe("connector-store — provider enum is split", () => {
  it("ConnectorProvider union contains google_gsc, google_gbp, and yelp", () => {
    expect(/google_gsc/.test(STORE_CODE)).toBe(true);
    expect(/google_gbp/.test(STORE_CODE)).toBe(true);
    expect(/["']yelp["']/.test(STORE_CODE)).toBe(true);
  });

  it("legacy `provider: \"google\"` literal is REMOVED", () => {
    // The A.3.b1.alpha single "google" slot conflated GSC + GBP.
    expect(
      /provider\s*:\s*["']google["']/.test(STORE_CODE),
      "connector-store.ts must NOT carry the legacy provider: 'google' " +
        "literal — both Google scopes now have independent provider keys.",
    ).toBe(false);
  });
});
