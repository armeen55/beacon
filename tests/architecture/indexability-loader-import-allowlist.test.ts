/**
 * Architecture invariant — Phase A.3 Step 3b (2026-05-14).
 *
 * Pins the indexability loader's import surface to a small,
 * explicit allowlist. New imports must be added here AND in the
 * loader together; drift in either direction trips the build.
 *
 * Why this matters: the loader is the first cross-module surface
 * in the indexability domain. Without an allowlist, future refactors
 * could quietly pull in a fetch-bearing helper (re-introducing the
 * fresh-fetch hazard the sibling invariant prevents) OR an unrelated
 * cross-domain coupling (e.g., a brain or LLM module).
 *
 * Allowed import paths:
 *   • `server-only`
 *   • `next/cache`
 *   • Relative siblings within `./types` and `./compute-indexability`
 *   • `@/domains/pages/types` (TYPE-ONLY consumers may import the
 *     `PageSnapshot` / `SitemapReconciliation` shapes; this loader
 *     consumes them via the store wrappers, not directly — but
 *     we allow the path for forward-compat with type-only imports)
 *   • `@/domains/pages/snapshot-store` — getPageSnapshots
 *   • `@/domains/pages/sitemap-reconciliation-store` —
 *     getSitemapReconciliation
 *   • `@/domains/pages/robots-parser` — readRobotsState +
 *     evaluateAiBotAccess + evaluateGooglebotAccess + types
 *   • `@/domains/citation-lifecycle/canonicalize-url`
 *   • `@/lib/business-config`
 *   • `@/lib/tenant-context`
 *
 * Retirement: refines when A.3.b1 lands the GSC connector (the
 * allowlist gains the GSC client path). Permanent otherwise — the
 * indexability domain's read-only loader contract is structural.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOADER_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "indexability",
  "load-indexability.ts",
);

const SRC = readFileSync(LOADER_PATH, "utf-8");
const SRC_STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

const ALLOWED_IMPORT_PATHS: ReadonlySet<string> = new Set([
  "server-only",
  "next/cache",
  "./types",
  "./compute-indexability",
  "@/domains/pages/types",
  "@/domains/pages/snapshot-store",
  "@/domains/pages/sitemap-reconciliation-store",
  "@/domains/pages/robots-parser",
  "@/domains/citation-lifecycle/canonicalize-url",
  "@/lib/business-config",
  "@/lib/tenant-context",
]);

/**
 * Extract every import-from path in the loader source. Covers both
 * `import X from "..."` and `import "..."` (side-effect) shapes.
 * Returns an array preserving source order; consumers compare
 * against the allowlist.
 */
function extractImportPaths(src: string): string[] {
  const paths: string[] = [];
  // Side-effect imports: `import "server-only";`
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']\s*;?/gm)) {
    paths.push(m[1]);
  }
  // Named/default imports: `import ... from "...";`
  for (const m of src.matchAll(
    /^\s*import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']\s*;?/gm,
  )) {
    paths.push(m[1]);
  }
  return paths;
}

describe("Architecture — indexability loader import allowlist (Phase A.3 §3b)", () => {
  it("every import path in the loader matches the allowlist", () => {
    const paths = extractImportPaths(SRC_STRIPPED);
    expect(paths.length, "loader has zero imports — sanity check").toBeGreaterThan(0);
    for (const p of paths) {
      expect(
        ALLOWED_IMPORT_PATHS.has(p),
        `disallowed import path '${p}' in load-indexability.ts — add to ALLOWED_IMPORT_PATHS in this invariant OR remove the import`,
      ).toBe(true);
    }
  });

  it("loader imports 'server-only' (enforces server-side execution)", () => {
    expect(SRC_STRIPPED).toMatch(/^\s*import\s+["']server-only["']/m);
  });

  it("loader imports 'next/cache' (uses unstable_cache for tag-invalidation)", () => {
    expect(SRC_STRIPPED).toMatch(/from\s+["']next\/cache["']/);
  });

  it("loader imports its sibling compute module (the pure verdict computer)", () => {
    expect(SRC_STRIPPED).toMatch(/from\s+["']\.\/compute-indexability["']/);
  });

  it("loader imports the citation-lifecycle canonicalizer (URL normalization parity)", () => {
    expect(SRC_STRIPPED).toMatch(
      /from\s+["']@\/domains\/citation-lifecycle\/canonicalize-url["']/,
    );
  });
});
