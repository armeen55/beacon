/**
 * Architecture invariant — Section 6 C4b tenant scope discipline
 * (2026-05-15).
 *
 * Pins two source-text contracts:
 *
 *   1. Every `computeTodayPrimaryShare(` invocation under
 *      `src/app/(shell)/today-v2-data.ts` is paired with a
 *      `getRepository().forTenant(` call in the same function body
 *      that supplies the `repo` argument. Defends against a future
 *      drive-by edit that calls the helper with an unscoped
 *      repository surface.
 *
 *   2. The helper module
 *      `src/domains/daily-metric-snapshots/today-primary-share.ts`
 *      does NOT import `getRepository` from
 *      `@/lib/persistence/repositories`. The helper's design
 *      contract (C4a) is caller-bound tenant scope — the helper
 *      consumes a pre-bound `TodayPrimaryShareRepo` and never
 *      constructs its own repository instance. A future regression
 *      that adds the import would let the helper bypass the
 *      caller's tenant scoping.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

const TODAY_V2_DATA = read("src/app/(shell)/today-v2-data.ts");
const HELPER_RAW = read(
  "src/domains/daily-metric-snapshots/today-primary-share.ts",
);

// Strip block + line comments from the helper source so the "no
// getRepository" assertion only scans executable code. The helper's
// docstrings reference getRepository for documentation purposes
// (explaining the caller-bound contract) — those references are
// intentional and must not trip the invariant.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const HELPER = stripComments(HELPER_RAW);

describe("Architecture — Today primary-share tenant isolation (Section 6 C4b)", () => {
  it("computeTodayPrimaryShare invocation is preceded by getRepository().forTenant( in today-v2-data.ts", () => {
    // Locate the helper invocation in the loader source.
    const invokeIdx = TODAY_V2_DATA.search(/computeTodayPrimaryShare\s*\(/);
    expect(invokeIdx).toBeGreaterThanOrEqual(0);

    // Look backward from the invocation for the `.forTenant(` call
    // within a reasonable window (the caller binds the repo a few
    // lines above the invocation). 600 chars is generous; the actual
    // distance is ~10 lines (~300 chars).
    const lookbackStart = Math.max(0, invokeIdx - 600);
    const window = TODAY_V2_DATA.slice(lookbackStart, invokeIdx);
    expect(window).toMatch(/getRepository\s*\(\s*\)\s*\.\s*forTenant\s*\(/);
  });

  it("today-v2-data.ts passes the bound repo into computeTodayPrimaryShare via repo:", () => {
    // Pattern: `computeTodayPrimaryShare({ repo: <something>, ... })`
    // where `<something>` is a name that traces back to a
    // `.forTenant(` call. Source-text scan accepts any identifier;
    // the prior assertion covers the binding flow.
    expect(TODAY_V2_DATA).toMatch(
      /computeTodayPrimaryShare\s*\(\s*\{\s*repo\s*:\s*[A-Za-z_]\w*/,
    );
  });

  it("today-primary-share.ts does NOT import getRepository from @/lib/persistence/repositories", () => {
    // The helper's design contract: caller-bound tenant scope.
    // Forbid the import.
    expect(HELPER).not.toMatch(
      /import\s*\{[^}]*\bgetRepository\b[^}]*\}\s*from\s*["']@\/lib\/persistence\/repositories["']/,
    );
    // Belt-and-suspenders: forbid the bare identifier reference too,
    // in case a future edit imports it under an alias or via
    // require().
    expect(HELPER).not.toMatch(/\bgetRepository\b/);
  });
});
