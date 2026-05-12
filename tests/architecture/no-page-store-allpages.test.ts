/**
 * Sprint 7 Phase 7.5c/3 (2026-04-25) — architectural invariant.
 *
 * Pre-7.5c: `src/domains/pages/page-store.ts` exported a top-level-await
 * `allPages` array. That snapshot was keyed at module init with whatever
 * env tenant the runtime had on first import — wrong for multi-tenant.
 *
 * Post-7.5c: page-store exports `getOwnedPages()` (lazy + tenant-scoped).
 * The `allPages` const must NOT exist as an export, and no file under
 * `src/**` should `import { allPages } from "@/domains/pages/page-store"`.
 *
 * Allowlist: `src/app/(shell)/diagnostics/page.tsx` declares its own
 * module-level `let allPages: PageEntity[] = []` — set by the page render
 * to thread data into helper React components defined later in the same
 * file. That declaration is internal to diagnostics; it is NOT an import
 * from page-store. The invariant scans for the IMPORT pattern, not bare
 * variable names.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC_ROOT = resolve(__dirname, "../../src");
const PAGE_STORE_PATH = resolve(
  __dirname,
  "../../src/domains/pages/page-store.ts",
);

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const s = statSync(path);
    if (s.isDirectory()) yield* walkFiles(path);
    else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      yield path;
    }
  }
}

describe("Sprint 7 Phase 7.5c/3 — page-store allPages lift", () => {
  it("page-store.ts does NOT export `allPages`", () => {
    const src = readFileSync(PAGE_STORE_PATH, "utf8");
    // Forbidden: any `export const allPages` or `export let allPages` or
    // `export var allPages`. Allow either of:
    //   • `export async function getOwnedPages(...)` (pre-2026-05-12 form)
    //   • `export const getOwnedPages = cache(async (...) => {...})`
    //     (post perf+egress bundle, 2026-05-12 — wrapped in
    //     `React.cache` for per-request dedup).
    expect(src).not.toMatch(/export\s+(?:const|let|var)\s+allPages\b/);
    const exportsGetOwnedPages =
      /export\s+async\s+function\s+getOwnedPages\b/.test(src) ||
      /export\s+const\s+getOwnedPages\s*=\s*cache\(/.test(src);
    expect(exportsGetOwnedPages).toBe(true);
  });

  it("page-store.ts uses tenant-scoped fetch (forTenant + currentTenantId)", () => {
    const src = readFileSync(PAGE_STORE_PATH, "utf8");
    expect(src).toMatch(/currentTenantId\(\)/);
    expect(src).toMatch(/forTenant\([^)]*\)/);
  });

  it("no file imports `allPages` from page-store", () => {
    const violations: { file: string; line: number; text: string }[] = [];
    // Match any import that pulls `allPages` from @/domains/pages/page-store
    // (or relative paths that resolve to the same module).
    const reImport =
      /import\s+\{[^}]*\ballPages\b[^}]*\}\s+from\s+["'][^"']*\/page-store["']/;
    for (const file of walkFiles(SRC_ROOT)) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (reImport.test(lines[i])) {
          violations.push({
            file: file.replace(SRC_ROOT, "src"),
            line: i + 1,
            text: lines[i].trim().slice(0, 120),
          });
        }
      }
    }
    expect(
      violations,
      `Sprint 7 Phase 7.5c/3 invariant: forbidden \`import { allPages } from "@/domains/pages/page-store"\` matches:\n` +
        violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n"),
    ).toEqual([]);
  });
});
