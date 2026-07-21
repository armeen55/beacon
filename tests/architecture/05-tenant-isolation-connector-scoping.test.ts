/**
 * CONSTITUTION §1 — Tenant isolation: connector scoping.
 *
 * Consolidated from connector-token-tenant-scope, connector-store-no-disk-write,
 * and load-gsc-signal-tenant-scope. Pins that:
 *   1. Every connector-store read/write/delete is tenant-scoped (explicit
 *      `tenantId?: string` OR ambient `currentTenantId()`), and every
 *      connector_tokens Supabase chain filters by tenant_id.
 *   2. connector-store never writes tokens to disk (Vercel ENOENT class) —
 *      persistence routes through the Supabase admin client only.
 *   3. The GSC-signal adapter takes an EXPLICIT tenantId, filters its cache
 *      by tenant_id, and never imports a customer-facing surface.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const read = (rel: string) =>
  stripComments(readFileSync(join(REPO_ROOT, rel), "utf-8"));

const STORE_CODE = read("src/lib/connector-store.ts");
const GSC_CODE = read("src/domains/indexability/load-gsc-signal.ts");

describe("connector-store — tenant scope on signatures", () => {
  for (const fn of [
    "getConnectorToken",
    "getGoogleConnectorToken",
    "getYelpConnectorToken",
    "saveConnectorToken",
    "deleteConnectorToken",
    "getConnectorInfo",
  ]) {
    it(`${fn} accepts \`tenantId?: string\``, () => {
      expect(
        new RegExp(`${fn}\\s*\\([^)]*tenantId\\?\\s*:\\s*string`).test(
          STORE_CODE,
        ),
      ).toBe(true);
    });
  }
});

describe("connector-store — Supabase queries are tenant-filtered", () => {
  it('every connector_tokens read passes through eq("tenant_id", ...)', () => {
    const fromChains = STORE_CODE.match(/\.from\(\s*TABLE\s*\)[\s\S]{0,500}/g);
    expect(fromChains).not.toBeNull();
    for (const chain of fromChains ?? []) {
      const tenantScoped =
        /\.eq\(\s*["']tenant_id["']\s*,/.test(chain) ||
        /\bupsert\s*\(\s*\{[\s\S]{0,200}tenant_id\s*:/.test(chain);
      expect(
        tenantScoped,
        "Every connector_tokens query must scope by tenant_id:\n" +
          chain.slice(0, 200),
      ).toBe(true);
    }
  });

  it("resolves ambient tenant via currentTenantId() when explicit arg is omitted", () => {
    expect(/from\s+["']@\/lib\/tenant-context["']/.test(STORE_CODE)).toBe(true);
    expect(/\bcurrentTenantId\s*\(/.test(STORE_CODE)).toBe(true);
  });

  it("ConnectorProvider union is split (google_gsc, google_gbp, yelp); legacy 'google' removed", () => {
    expect(/google_gsc/.test(STORE_CODE)).toBe(true);
    expect(/google_gbp/.test(STORE_CODE)).toBe(true);
    expect(/["']yelp["']/.test(STORE_CODE)).toBe(true);
    expect(/provider\s*:\s*["']google["']/.test(STORE_CODE)).toBe(false);
  });
});

describe("connector-store — no disk writes (Supabase-only persistence)", () => {
  for (const call of [
    "writeFileSync",
    "renameSync",
    "mkdirSync",
    "unlinkSync",
  ]) {
    it(`does NOT call ${call}`, () => {
      expect(new RegExp(`\\b${call}\\s*\\(`).test(STORE_CODE)).toBe(false);
    });
  }

  it("does NOT reference the legacy .data/connector-tokens path", () => {
    expect(/\.data\/connector-tokens/.test(STORE_CODE)).toBe(false);
    expect(/connector-tokens\.json/.test(STORE_CODE)).toBe(false);
  });

  it("imports getSupabaseAdmin and invokes upsert + delete on connector_tokens", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(STORE_CODE) &&
        /\bgetSupabaseAdmin\b/.test(STORE_CODE),
    ).toBe(true);
    expect(/connector_tokens/.test(STORE_CODE)).toBe(true);
    expect(/\.upsert\s*\(/.test(STORE_CODE)).toBe(true);
    expect(/\.delete\s*\(/.test(STORE_CODE)).toBe(true);
  });
});

describe("load-gsc-signal — explicit tenant scope + operator-substrate posture", () => {
  it("loadGscSignal accepts an explicit tenantId; no ambient tenant reads", () => {
    expect(/export\s+async\s+function\s+loadGscSignal\s*\(/.test(GSC_CODE)).toBe(
      true,
    );
    expect(/tenantId\s*:\s*string/.test(GSC_CODE)).toBe(true);
    expect(/\bcurrentTenantSlug\s*\(/.test(GSC_CODE)).toBe(false);
    expect(/\bcurrentTenantId\s*\(/.test(GSC_CODE)).toBe(false);
  });

  it("is server-only, cache-filtered by tenant_id, and site-URL comes from env", () => {
    expect(/import\s+["']server-only["']/.test(GSC_CODE)).toBe(true);
    expect(/gsc_url_inspections/.test(GSC_CODE)).toBe(true);
    expect(/\.eq\(\s*["']tenant_id["']\s*,/.test(GSC_CODE)).toBe(true);
    expect(/BEACON_GSC_SITE_URL/.test(GSC_CODE)).toBe(true);
    expect(
      /export\s+const\s+GSC_INSPECT_PER_RENDER_LIMIT\s*=\s*5\b/.test(GSC_CODE),
    ).toBe(true);
  });

  it("does NOT import any customer-facing surface module", () => {
    const forbidden = [
      /from\s+["']@\/app\//,
      /from\s+["']@\/components\//,
      /from\s+["']@\/domains\/today["']/,
      /from\s+["']@\/domains\/today\//,
      /from\s+["']@\/domains\/recommendations["']/,
      /from\s+["']@\/domains\/recommendations\//,
      /from\s+["']@\/domains\/changes["']/,
      /from\s+["']@\/domains\/changes\//,
      /from\s+["']@\/domains\/prompts["']/,
      /from\s+["']@\/domains\/prompts\//,
      /from\s+["']@\/domains\/local["']/,
      /from\s+["']@\/domains\/local\//,
    ];
    for (const pat of forbidden) {
      expect(pat.test(GSC_CODE), `forbidden import: ${pat.source}`).toBe(false);
    }
  });
});
