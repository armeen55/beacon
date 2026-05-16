/**
 * Architecture invariant — Section 7 C7a loader-allowed-imports
 * contract (2026-05-16).
 *
 * Pins that `src/domains/off-site-authority/load-snapshot.ts` imports
 * ONLY from this explicit allowlist:
 *   - @/lib/business-config        (PROCESS-GLOBAL — documented)
 *   - @/lib/local-reviews-store    (request-scoped per tenant — OK)
 *   - @/lib/connector-store        (PROCESS-GLOBAL — documented)
 *   - @/lib/tenant-context         (request-scoped — OK)
 *   - ./types
 *   - ./compute-snapshot
 *   - server-only                  (Next.js side-effect-only marker)
 *
 * Specifically forbids:
 *   - any import from @/lib/persistence/repositories
 *     (no getRepository — C7a doesn't bridge multi-tenant gaps via
 *      the Supabase repository pattern; that fix is the multi-tenant
 *      prerequisite workstream)
 *   - any import from @/lib/connectors/*
 *     (no new connector wiring in C7a)
 *   - any HTTP-client identifier (`fetch(`, `axios`, `httpsAgent`)
 *
 * The catalog row `off-site-authority-multi-tenant-prerequisite`
 * documents the underlying limitation that motivates this strict
 * import boundary.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOADER = "src/domains/off-site-authority/load-snapshot.ts";

const ALLOWED_PATHS: ReadonlyArray<string> = [
  "server-only",
  "@/lib/business-config",
  "@/lib/local-reviews-store",
  "@/lib/connector-store",
  "@/lib/tenant-context",
  "./types",
  "./compute-snapshot",
];

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE = stripComments(read(LOADER));

/**
 * Extract every `from "..."` import path in the active (comment-
 * stripped) source. Side-effect imports (`import "server-only"`) are
 * matched separately below.
 */
function extractFromPaths(src: string): string[] {
  const out: string[] = [];
  const re = /\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function extractSideEffectImports(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*import\s+["']([^"']+)["'];?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1]);
  }
  return out;
}

describe("Architecture — Section 7 C7a loader allowed-imports", () => {
  it("every `from \"...\"` import path is in the allowlist", () => {
    const paths = extractFromPaths(ACTIVE);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(
        ALLOWED_PATHS.includes(p),
        `Loader imports '${p}' which is NOT in the allowlist.\n` +
          `Allowed: ${ALLOWED_PATHS.join(", ")}`,
      ).toBe(true);
    }
  });

  it("every side-effect import is in the allowlist", () => {
    const paths = extractSideEffectImports(ACTIVE);
    for (const p of paths) {
      expect(
        ALLOWED_PATHS.includes(p),
        `Loader has a side-effect import for '${p}' which is NOT in the allowlist.`,
      ).toBe(true);
    }
  });

  it("does NOT import getRepository", () => {
    expect(ACTIVE).not.toMatch(/\bgetRepository\b/);
  });

  it("does NOT import from @/lib/persistence/repositories", () => {
    expect(ACTIVE).not.toMatch(/from\s+["']@\/lib\/persistence\/repositories["']/);
  });

  it("does NOT import from @/lib/connectors/*", () => {
    expect(ACTIVE).not.toMatch(/from\s+["']@\/lib\/connectors\/[^"']+["']/);
  });

  it("does NOT contain HTTP-client identifiers", () => {
    expect(ACTIVE).not.toMatch(/\bfetch\s*\(/);
    expect(ACTIVE).not.toMatch(/\baxios\b/);
    expect(ACTIVE).not.toMatch(/\bhttpsAgent\b/);
  });
});
