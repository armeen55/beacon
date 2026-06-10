/**
 * Architecture invariant — MT-3B deep-runtime business-config
 * tenant-aware resolution (2026-05-22).
 *
 * MT-1 made business-config tenant-keyed; MT-2 migrated customer
 * surfaces; MT-3A migrated operator surfaces; MT-3B migrated the
 * remaining DEEP domain/lib runtime callers (recommendation-intelligence
 * promotion + trigger loaders, indexability loaders, the competitor
 * classifier + its caller chain, the GA4 + Yelp connector syncs, the
 * page-verify action, and the Profound import adapter).
 *
 * Result: ZERO active no-arg `getBusinessConfig()` CALLS remain anywhere
 * in `src/` runtime code. The ONLY no-arg references left are:
 *   • the 5 pure-helper fallbacks inside `src/lib/business-config.ts`
 *     itself (`config ?? getBusinessConfig()`) — removed in MT-3C;
 *   • the deprecated no-arg overload SIGNATURE in that same file —
 *     removed (with a global ban) in MT-5.
 *
 * This invariant scans EVERY `.ts`/`.tsx` under `src/` EXCEPT
 * `src/lib/business-config.ts` (which legitimately defines the overload
 * + the pure-helper fallbacks until MT-3C/MT-5) and asserts no
 * comment-stripped source contains a no-arg `getBusinessConfig()` call.
 * `typeof getBusinessConfig` (type usage) is NOT a call and is allowed.
 *
 * Protects Customer 2: a regression that reintroduces a process-global /
 * env-default no-arg read into ANY runtime path trips here immediately.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SRC_DIR = resolve(REPO_ROOT, "src");

// The one file allowed to reference no-arg getBusinessConfig() — it
// DEFINES the deprecated overload + the pure-helper fallbacks. Removed
// from this allowlist when MT-3C (fallbacks) + MT-5 (overload) land.
const ALLOWED_FILES = new Set<string>([
  resolve(SRC_DIR, "lib", "business-config.ts"),
]);

/** Line comments stripped FIRST, then block comments — survives a line
 *  comment that legitimately contains a block-open marker. */
function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

const NO_ARG_CALL = /getBusinessConfig\(\s*\)/;

const ALL_SRC_FILES = walkTsFiles(SRC_DIR).filter((f) => !ALLOWED_FILES.has(f));

describe("business-config-deep-runtime-tenant-aware (MT-3B)", () => {
  it("scans a non-trivial number of source files (sanity)", () => {
    expect(ALL_SRC_FILES.length).toBeGreaterThan(100);
  });

  it("ZERO runtime files outside business-config.ts call no-arg getBusinessConfig()", () => {
    const offenders: string[] = [];
    for (const file of ALL_SRC_FILES) {
      const active = stripComments(readFileSync(file, "utf-8"));
      if (NO_ARG_CALL.test(active)) {
        offenders.push(file.replace(REPO_ROOT + "/", ""));
      }
    }
    expect(
      offenders,
      `These runtime files still call no-arg getBusinessConfig() — migrate to getBusinessConfig(tenantId) or getBusinessConfigForCurrentTenant():\n${offenders.map((f) => `  - ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("business-config.ts still defines the deprecated overload (NOT globally removed — MT-5)", () => {
    const core = readFileSync(
      resolve(SRC_DIR, "lib", "business-config.ts"),
      "utf-8",
    );
    // Deprecated overload signature still present (MT-5 removes it).
    expect(
      /export function getBusinessConfig\(\):\s*BusinessConfig;/.test(core),
    ).toBe(true);
    // MT-3C.2 (2026-05-23) — ALL pure-helper `?? getBusinessConfig()`
    // fallbacks are now removed (the last 2, getLocationRegex /
    // getServiceRegex, were tightened once the page extractor injected
    // its per-tenant config). The deprecated overload itself remains for
    // back-compat until MT-5. `business-config-pure-helpers-require-config`
    // pins the require-config signatures.
    expect(core.includes("?? getBusinessConfig()")).toBe(false);
  });
});
