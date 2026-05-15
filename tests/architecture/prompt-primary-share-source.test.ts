/**
 * Architecture invariant — Section 6 C5 source + tenant-isolation
 * contract (2026-05-15).
 *
 * Pins three source-text contracts on the Prompts detail v2 surface:
 *
 *   1. `src/app/(shell)/prompts/[id]/page.tsx` imports
 *      `computePromptPrimaryShare` from the C5 helper module.
 *
 *   2. The helper invocation is paired with a
 *      `getRepository().forTenant(` call in the same function body
 *      that supplies the `repo` argument. Defends against a future
 *      drive-by edit that calls the helper with an unscoped
 *      repository surface.
 *
 *   3. The helper module
 *      `src/domains/daily-metric-snapshots/prompt-primary-share.ts`
 *      does NOT import `getRepository` from
 *      `@/lib/persistence/repositories`. The helper's design
 *      contract (Section 6 C5 + carry-over from C4a) is caller-bound
 *      tenant scope — the helper consumes a pre-bound
 *      `PromptPrimaryShareRepo` and never constructs its own
 *      repository instance.
 *
 * Companion runtime tests:
 *   - `tests/domains/daily-metric-snapshots/prompt-primary-share.test.ts`
 *     (helper math + filter discipline + aggregate semantic)
 *   - `tests/components/prompts/prompt-detail-v2-primary-share.test.tsx`
 *     (rendered HTML for each sample-status branch)
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

const PAGE_SRC = read("src/app/(shell)/prompts/[id]/page.tsx");
const HELPER_RAW = read(
  "src/domains/daily-metric-snapshots/prompt-primary-share.ts",
);

// Strip block + line comments so the "does NOT import getRepository"
// assertion only scans executable code. The helper's docstrings
// reference getRepository for documentation purposes (explaining
// the caller-bound contract); those references are intentional and
// must NOT trip the invariant.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const HELPER = stripComments(HELPER_RAW);

describe("Architecture — Section 6 C5 source contract", () => {
  it("page.tsx imports computePromptPrimaryShare from the C5 helper module", () => {
    expect(PAGE_SRC).toMatch(
      /import\s*\{[^}]*\bcomputePromptPrimaryShare\b[^}]*\}\s*from\s*["']@\/domains\/daily-metric-snapshots\/prompt-primary-share["']/,
    );
  });

  it("page.tsx invokes computePromptPrimaryShare exactly once", () => {
    const matches = PAGE_SRC.match(/computePromptPrimaryShare\s*\(/g);
    expect(matches?.length ?? 0).toBe(1);
  });
});

describe("Architecture — Section 6 C5 tenant-isolation contract", () => {
  it("computePromptPrimaryShare invocation is preceded by getRepository().forTenant( in page.tsx", () => {
    const invokeIdx = PAGE_SRC.search(/computePromptPrimaryShare\s*\(/);
    expect(invokeIdx).toBeGreaterThanOrEqual(0);

    // Look backward from the invocation for the `.forTenant(` call.
    // Use a generous 1500-char window — the binding sits a few lines
    // above the invocation in the v2 branch, but the inline try/catch
    // doc comments around the helper invocation add real distance.
    // The pin is "same function body, reachable by reading
    // upward"; the exact distance is bounded but not minimized.
    const lookbackStart = Math.max(0, invokeIdx - 1500);
    const window = PAGE_SRC.slice(lookbackStart, invokeIdx);
    expect(window).toMatch(/getRepository\s*\(\s*\)\s*\.\s*forTenant\s*\(/);
  });

  it("helper module does NOT import getRepository from @/lib/persistence/repositories", () => {
    expect(HELPER).not.toMatch(
      /import\s*\{[^}]*\bgetRepository\b[^}]*\}\s*from\s*["']@\/lib\/persistence\/repositories["']/,
    );
    // Belt-and-suspenders: forbid the bare identifier reference in
    // active source so a future edit can't import it under an alias
    // or via require().
    expect(HELPER).not.toMatch(/\bgetRepository\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Operator-debug fallback contract (Section 6 C5 — hardening).
//
// The page wraps `computePromptPrimaryShare` in a try/catch so a
// transient Supabase error or a stale repo mock degrades to the
// null-result render path instead of crashing the page. That
// fallback must NOT be silent — the catch block emits a structured
// `console.warn` with operator-actionable context (tenantId +
// promptId + error.message) and explicitly avoids leaking Supabase
// keys, answer text, raw prompt bodies, or stack traces.
// ─────────────────────────────────────────────────────────────────────

describe("Architecture — Section 6 C5 fallback warning contract", () => {
  // Slice the page source from `computePromptPrimaryShare({` (the
  // try-block call) through the next `}` at the same brace depth as
  // the surrounding await closure. The catch body always sits inside
  // that closure.
  const tryBlockStart = PAGE_SRC.indexOf("computePromptPrimaryShare({");
  const trailingSlice = tryBlockStart >= 0 ? PAGE_SRC.slice(tryBlockStart) : "";

  it("the source contains a catch block adjacent to the helper invocation", () => {
    expect(tryBlockStart).toBeGreaterThanOrEqual(0);
    expect(trailingSlice).toMatch(/\}\s*catch\s*\(\s*error\s*\)\s*\{/);
  });

  it("the catch block emits console.warn with the locked [section6-c5] prefix", () => {
    expect(trailingSlice).toMatch(
      /console\.warn\s*\(\s*"\[section6-c5\] prompt primary share failed"/,
    );
  });

  it("the warn payload includes tenantId, promptId, and a narrowed error.message", () => {
    // All three keys must appear in the second-arg object literal.
    expect(trailingSlice).toMatch(/tenantId\s*,/);
    expect(trailingSlice).toMatch(/promptId\s*,/);
    // error narrowed to a string via instanceof Error check (avoids
    // logging the full Error object / stack / supabase-client
    // internals).
    expect(trailingSlice).toMatch(
      /error\s*:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(\s*error\s*\)/,
    );
  });

  it("the catch block returns the null-fallback shape so the page renders", () => {
    expect(trailingSlice).toMatch(
      /return\s*\{\s*chatgpt\s*:\s*null\s*,\s*perplexity\s*:\s*null\s*\}/,
    );
  });

  it("the catch block does NOT leak the raw error object, stack, or supabase client to logs", () => {
    // Forbid `console.warn(...err)` / `console.warn(..., err)` / `error: err`
    // forms that would dump the full object. The narrowed-message
    // form pinned above is the only allowed shape.
    const catchIdx = trailingSlice.search(/}\s*catch\s*\(\s*error\s*\)\s*\{/);
    expect(catchIdx).toBeGreaterThanOrEqual(0);
    const catchBody = trailingSlice.slice(catchIdx);
    // Forbid logging the raw error binding (would expose stack /
    // Supabase client internals); the `error: error instanceof ...`
    // ternary that narrows to .message is allowed.
    expect(catchBody).not.toMatch(/console\.\w+\([^)]*,\s*error\s*\)/);
    expect(catchBody).not.toMatch(/error\.stack/);
    expect(catchBody).not.toMatch(/\bSUPABASE_SERVICE_ROLE_KEY\b/);
  });
});
