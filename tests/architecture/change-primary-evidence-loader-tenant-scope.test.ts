/**
 * Architecture invariant — Section 6 C6a loader tenant-scope contract
 * (2026-05-15).
 *
 * Pins six source-text contracts on
 * `src/domains/citation-lifecycle/load-change-primary-evidence.ts`:
 *
 *   1. Imports `getRepository` from `@/lib/persistence/repositories`.
 *   2. Active (comment-stripped) source contains the
 *      `getRepository().forTenant(tenantId)` binding pattern.
 *   3. Active source contains an `unstable_cache(` invocation.
 *   4. Cache key array literal includes the four required slots:
 *      "change-primary-evidence:v1", tenantId, recommendedEdit.id,
 *      and a reference to recommendedEdit.live_at.
 *   5. Active source contains `revalidate: 60 * 60 * 6` (or the literal
 *      `21600`) — H7 6h TTL pin.
 *   6. Active source contains the `recommended_edits:${tenantId}` tag
 *      literal.
 *
 * Plus a negative guard:
 *   - No `createServiceClient(` direct call.
 *   - No module-level repo cache (loader resolves the repo inside the
 *     cache body, not at module scope).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOADER_PATH =
  "src/domains/citation-lifecycle/load-change-primary-evidence.ts";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const RAW = read(LOADER_PATH);
const ACTIVE = stripComments(RAW);

describe("Architecture — Section 6 C6a loader tenant-scope", () => {
  it("imports getRepository from @/lib/persistence/repositories", () => {
    expect(ACTIVE).toMatch(
      /import\s*\{[^}]*\bgetRepository\b[^}]*\}\s*from\s*["']@\/lib\/persistence\/repositories["']/,
    );
  });

  it("calls getRepository().forTenant(tenantId) inside active source", () => {
    expect(ACTIVE).toMatch(
      /getRepository\s*\(\s*\)\s*\.\s*forTenant\s*\(\s*tenantId\s*\)/,
    );
  });

  it("contains an unstable_cache invocation", () => {
    expect(ACTIVE).toMatch(/\bunstable_cache\s*\(/);
  });

  it("cache key includes all four required slots in active source", () => {
    // The cache key is an array literal; check all four anchor slots
    // appear in the active source. Order is not asserted here (the
    // implementation is expected to put them in order, but this test
    // remains stable across cosmetic re-orderings).
    expect(ACTIVE).toContain('"change-primary-evidence:v1"');
    expect(ACTIVE).toMatch(/\btenantId\b/);
    expect(ACTIVE).toMatch(/recommendedEdit\.id\b/);
    expect(ACTIVE).toMatch(/recommendedEdit\.live_at\b/);
  });

  it("declares revalidate at 60 * 60 * 6 (or 21600)", () => {
    expect(ACTIVE).toMatch(/revalidate:\s*(60\s*\*\s*60\s*\*\s*6|21600)\b/);
  });

  it("uses the tag `recommended_edits:${tenantId}`", () => {
    expect(ACTIVE).toMatch(/recommended_edits:\$\{tenantId\}/);
  });

  it("does NOT call createServiceClient directly (single repo acquisition pattern)", () => {
    expect(ACTIVE).not.toMatch(/\bcreateServiceClient\s*\(/);
  });

  it("does NOT cache the repo at module scope (binding lives inside cache body)", () => {
    // Heuristic: a module-level cached repo would look like
    //   const _repo = getRepository();   (at column 0 — no indent)
    // The legitimate getRepository call lives inside the cache body
    // and is indented; the regex requires ZERO leading whitespace so
    // it only matches genuine top-level declarations.
    expect(ACTIVE).not.toMatch(
      /^(?:export\s+)?(const|let|var)\s+\w+\s*=\s*getRepository\s*\(/m,
    );
  });
});
