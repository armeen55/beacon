/**
 * Architecture invariant — A.3.b1.beta (2026-05-17).
 *
 * `src/domains/indexability/load-gsc-signal.ts` is an operator-
 * substrate adapter between the GSC URL Inspection client and the
 * indexability verdict pipeline. It must:
 *
 *   1. Take an EXPLICIT `tenantId` parameter (no ambient
 *      `currentTenantSlug()` / `currentTenantId()` reads).
 *   2. Read the GSC site URL via `BEACON_GSC_SITE_URL` env var —
 *      NEVER hardcoded.
 *   3. Reference the locked `GSC_INSPECT_PER_RENDER_LIMIT = 5`
 *      constant.
 *   4. Import `gscUrlInspect` from `@/lib/connectors/gsc/client` —
 *      the operator-substrate cache + API client.
 *   5. Import `getSupabaseAdmin` from `@/lib/persistence/supabase`
 *      for cache-peek reads.
 *   6. NOT import any customer-surface module (no `@/app`,
 *      `@/components`, `@/domains/today`, `@/domains/recommendations`,
 *      `@/domains/changes`, `@/domains/prompts`, `@/domains/local`).
 *      The adapter is operator-substrate only; customer-facing
 *      callers reach the indexability loader WITHOUT enableGsc.
 *
 * Mirrors the locked `profound-import-runs-explicit-tenant-scope`
 * (explicit tenantId) AND `gsc-client-tenant-isolation` patterns.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ADAPTER_PATH = join(
  resolve(__dirname, "../.."),
  "src/domains/indexability/load-gsc-signal.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const ADAPTER_SRC = readFileSync(ADAPTER_PATH, "utf-8");
const ADAPTER_CODE = stripComments(ADAPTER_SRC);

describe("load-gsc-signal — explicit tenant scope", () => {
  it("loadGscSignal signature accepts an explicit tenantId parameter", () => {
    expect(
      /export\s+async\s+function\s+loadGscSignal\s*\(/.test(ADAPTER_CODE),
    ).toBe(true);
    expect(
      /tenantId\s*:\s*string/.test(ADAPTER_CODE),
      "loadGscSignal args must declare tenantId: string. Explicit " +
        "tenant scope is the locked invariant.",
    ).toBe(true);
  });

  it("does NOT call ambient currentTenantSlug() / currentTenantId()", () => {
    expect(/\bcurrentTenantSlug\s*\(/.test(ADAPTER_CODE)).toBe(false);
    expect(/\bcurrentTenantId\s*\(/.test(ADAPTER_CODE)).toBe(false);
  });

  it("is marked server-only", () => {
    expect(/import\s+["']server-only["']/.test(ADAPTER_CODE)).toBe(true);
  });
});

describe("load-gsc-signal — required imports + constants", () => {
  it("imports gscUrlInspect from @/lib/connectors/gsc/client", () => {
    expect(
      /from\s+["']@\/lib\/connectors\/gsc\/client["']/.test(ADAPTER_CODE) &&
        /\bgscUrlInspect\b/.test(ADAPTER_CODE),
    ).toBe(true);
  });

  it("imports getSupabaseAdmin from @/lib/persistence/supabase", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(ADAPTER_CODE) &&
        /\bgetSupabaseAdmin\b/.test(ADAPTER_CODE),
    ).toBe(true);
  });

  it("references the gsc_url_inspections cache table", () => {
    expect(/gsc_url_inspections/.test(ADAPTER_CODE)).toBe(true);
  });

  it("filters cache queries by tenant_id", () => {
    expect(/\.eq\(\s*["']tenant_id["']\s*,/.test(ADAPTER_CODE)).toBe(true);
  });

  it("references BEACON_GSC_SITE_URL env var (the SOLE site-URL source)", () => {
    expect(/BEACON_GSC_SITE_URL/.test(ADAPTER_CODE)).toBe(true);
  });

  it("exports GSC_INSPECT_PER_RENDER_LIMIT = 5", () => {
    expect(
      /export\s+const\s+GSC_INSPECT_PER_RENDER_LIMIT\s*=\s*5\b/.test(
        ADAPTER_CODE,
      ),
      "GSC_INSPECT_PER_RENDER_LIMIT must be exported as literal 5 — " +
        "the locked per-render fresh-fetch cap.",
    ).toBe(true);
  });
});

describe("load-gsc-signal — operator-substrate posture", () => {
  it("does NOT import any customer-facing surface modules", () => {
    const forbiddenImports = [
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
    for (const pat of forbiddenImports) {
      expect(
        pat.test(ADAPTER_CODE),
        "load-gsc-signal.ts must NOT import customer-facing surfaces. " +
          "Forbidden import pattern: " +
          pat.source,
      ).toBe(false);
    }
  });

  it("file header declares A.3.b1.beta + operator-substrate posture", () => {
    expect(/A\.3\.b1\.beta/.test(ADAPTER_SRC)).toBe(true);
    expect(/operator-substrate/i.test(ADAPTER_SRC)).toBe(true);
  });
});
