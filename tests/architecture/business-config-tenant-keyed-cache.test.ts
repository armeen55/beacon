/**
 * Architecture invariant — MT-1 Tenant-keyed business-config core
 * (2026-05-22).
 *
 * The multi-tenant-store prerequisite preflight found that the ONLY
 * genuine process-global blocker for Section 7 customer surfaces (and
 * Customer 2 readiness) is `src/lib/business-config.ts` — it cached the
 * resolved config in a single module-level `_cached` singleton, so the
 * first request's tenant config poisoned every later request in the same
 * lambda. MT-1 replaces that singleton with a tenant-keyed cache.
 *
 * This invariant pins the MT-1 contract:
 *   1. NO `let _cached: BusinessConfig | null` singleton remains
 *      (comment-stripped source — the JSDoc may mention it historically).
 *   2. A tenant-keyed `Map` cache exists (`_cacheByTenant = new Map`).
 *   3. The deprecated no-arg overload is explicitly `@deprecated` (raw
 *      source) and present as an overload signature.
 *   4. `getBusinessConfig` + `getBusinessConfigForCurrentTenant` are both
 *      exported functions.
 *   5. Behavioral — the cache key is the canonical tenantId, NOT a slug:
 *      a `BEACON_BUSINESS_CONFIG_JSON_BY_TENANT` entry keyed by tenantId
 *      is found via the tenantId and MISSED via the bare slug.
 *   6. Customer-surface containment — MT-1 wires the new multi-tenant
 *      entry into NO rendered customer-surface component. Rendered
 *      surfaces receive config via props from loaders; they must never
 *      call the business-config resolver directly. (Customer-facing
 *      adoption of `getBusinessConfigForCurrentTenant` happens in the
 *      loaders during MT-2; this guard keeps render components clean and
 *      proves MT-1 stayed out of customer surfaces.)
 *
 * Protects Customer 2: a regression that reintroduces a process-global
 * singleton — or wires the resolver into a render component — trips here
 * before it can bleed one tenant's brand into another's surface.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  getBusinessConfig,
  getBusinessConfigForCurrentTenant,
  isPlaceholderConfig,
  __resetBusinessConfigCacheForTests,
} from "@/lib/business-config";

const REPO_ROOT = resolve(__dirname, "..", "..");
const BUSINESS_CONFIG_PATH = resolve(REPO_ROOT, "src", "lib", "business-config.ts");
const RAW_SRC = readFileSync(BUSINESS_CONFIG_PATH, "utf-8");

/** Strip block + single-line comments so historical mentions in JSDoc
 *  don't trip the active-source assertions. */
const ACTIVE_SRC = RAW_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^[ \t]*\/\/.*$/gm,
  "",
);

// Customer-surface render trees. Rendered components receive config via
// props from loaders; they must never call the business-config resolver.
const CUSTOMER_COMPONENT_DIRS = [
  "today",
  "recommendations",
  "changes",
  "prompts",
  "local",
].map((d) => resolve(REPO_ROOT, "src", "components", d));

function walkTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("business-config-tenant-keyed-cache (MT-1)", () => {
  afterEach(() => {
    delete process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT;
    __resetBusinessConfigCacheForTests();
  });

  it("the process-global `let _cached` singleton is removed (comment-stripped)", () => {
    expect(
      /\blet\s+_cached\b/.test(ACTIVE_SRC),
      "business-config.ts must NOT reintroduce the `let _cached` process-global singleton — it poisons one tenant's config across all tenants in a shared lambda.",
    ).toBe(false);
  });

  it("a tenant-keyed Map cache exists", () => {
    expect(
      /const\s+_cacheByTenant\s*=\s*new\s+Map</.test(ACTIVE_SRC),
      "business-config.ts must cache configs in a tenant-keyed `_cacheByTenant = new Map<...>()`.",
    ).toBe(true);
  });

  it("the deprecated no-arg overload is explicitly marked @deprecated and present", () => {
    // @deprecated lives in a JSDoc comment — assert on RAW source.
    expect(RAW_SRC.includes("@deprecated")).toBe(true);
    // The no-arg overload signature must exist in active source.
    expect(
      /export function getBusinessConfig\(\):\s*BusinessConfig;/.test(ACTIVE_SRC),
      "business-config.ts must keep the deprecated no-arg overload signature for MT-1 back-compat.",
    ).toBe(true);
  });

  it("the tenant-aware overload signature exists", () => {
    expect(
      /export function getBusinessConfig\(tenantId:\s*string\):\s*BusinessConfig;/.test(
        ACTIVE_SRC,
      ),
      "business-config.ts must expose `getBusinessConfig(tenantId: string)`.",
    ).toBe(true);
  });

  it("getBusinessConfig and getBusinessConfigForCurrentTenant are exported functions", () => {
    expect(typeof getBusinessConfig).toBe("function");
    expect(typeof getBusinessConfigForCurrentTenant).toBe("function");
  });

  it("the cache key is the canonical tenantId, NOT a slug", () => {
    process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT = JSON.stringify({
      "tenant-arch-acme": { name: "Arch Acme", domain: "arch-acme.test" },
    });
    __resetBusinessConfigCacheForTests();

    // Canonical tenantId resolves the entry.
    const byId = getBusinessConfig("tenant-arch-acme");
    expect(byId.name).toBe("Arch Acme");
    expect(isPlaceholderConfig(byId)).toBe(false);

    // The bare slug is NOT a key → placeholder (proves tenantId keying).
    const bySlug = getBusinessConfig("arch-acme");
    expect(isPlaceholderConfig(bySlug)).toBe(true);
  });

  it("MT-1 wires the new multi-tenant entry into NO rendered customer-surface component", () => {
    const offenders: string[] = [];
    for (const dir of CUSTOMER_COMPONENT_DIRS) {
      for (const file of walkTsFiles(dir)) {
        const src = readFileSync(file, "utf-8");
        if (
          src.includes("getBusinessConfigForCurrentTenant") ||
          /from\s+["']@\/lib\/business-config["']/.test(src)
        ) {
          offenders.push(file.replace(REPO_ROOT + "/", ""));
        }
      }
    }
    expect(
      offenders,
      `Rendered customer-surface components must receive config via props from loaders, never call the business-config resolver. MT-1 must not wire it into customer surfaces (loaders migrate in MT-2). Offending files:\n${offenders.map((f) => `  - ${f}`).join("\n")}`,
    ).toEqual([]);
  });
});
