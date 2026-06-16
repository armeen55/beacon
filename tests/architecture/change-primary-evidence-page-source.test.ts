/**
 * Architecture invariant — Section 6 C6b page-source contract
 * (2026-05-15).
 *
 * Pins seven source-text contracts on
 * `src/app/(shell)/changes/[id]/page.tsx`:
 *
 *   1. Imports `loadChangePrimaryEvidence` from the C6a loader module.
 *   2. Imports `getBusinessConfig` from `@/lib/business-config`.
 *   3. Contains EXACTLY ONE active-source invocation of
 *      `loadChangePrimaryEvidence(`.
 *   4. The invocation site appears AFTER the v2-branch opener
 *      (`if (useV2)` … `{`) AND BEFORE the v2-branch JSX return
 *      (`<ChangeDetailV2Client`). v1 (legacy) branch never invokes
 *      the loader.
 *   5. The invocation is wrapped in a `try { … } catch (error) { … }`
 *      block — additive-safety contract carries from C5.
 *   6. The catch block emits the locked structured-warning shape:
 *        prefix `"[section6-c6] change primary evidence failed"`,
 *        keys `tenantId`, `changeId`, `recommendedEditId`,
 *        narrowed `error: error instanceof Error ? error.message : String(error)`.
 *   7. The catch block does NOT leak the raw error binding, stack, or
 *      Supabase service-role key into logs.
 *
 * Companion render contracts live in
 * `tests/app/changes/change-detail-v2-primary-evidence.test.tsx`
 * and client-boundary contracts in
 * `tests/architecture/change-primary-evidence-client-boundary.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE_PATH = "src/app/(shell)/changes/[id]/page.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const RAW = read(PAGE_PATH);
const ACTIVE = stripComments(RAW);

describe("Architecture — Section 6 C6b page source contract", () => {
  it("page.tsx imports loadChangePrimaryEvidence from the C6a loader module", () => {
    expect(ACTIVE).toMatch(
      /import\s*\{[^}]*\bloadChangePrimaryEvidence\b[^}]*\}\s*from\s*["']@\/domains\/citation-lifecycle\/load-change-primary-evidence["']/,
    );
  });

  it("page.tsx imports getBusinessConfig from @/lib/business-config", () => {
    expect(ACTIVE).toMatch(
      /import\s*\{[^}]*\bgetBusinessConfig\b[^}]*\}\s*from\s*["']@\/lib\/business-config["']/,
    );
  });

  it("page.tsx invokes loadChangePrimaryEvidence exactly once", () => {
    const matches = ACTIVE.match(/loadChangePrimaryEvidence\s*\(/g);
    expect(matches?.length ?? 0).toBe(1);
  });
});

describe("Architecture — Section 6 C6b invocation before the v2 brief", () => {
  it("loadChangePrimaryEvidence invocation appears BEFORE the v2 ChangeDetailV2Client return", () => {
    // Surface collapse (2026-06-15): /changes/[id] is V2-only — the
    // `if (useV2)` switcher was removed, so the loader now runs
    // unconditionally before the v2 brief renders.
    const invokeIdx = ACTIVE.search(/loadChangePrimaryEvidence\s*\(/);
    const jsxIdx = ACTIVE.search(/<\s*ChangeDetailV2Client\b/);

    expect(invokeIdx, "page.tsx must invoke loadChangePrimaryEvidence").toBeGreaterThanOrEqual(0);
    expect(jsxIdx, "page.tsx must render <ChangeDetailV2Client>").toBeGreaterThanOrEqual(0);
    expect(
      invokeIdx,
      "loadChangePrimaryEvidence invocation must appear BEFORE the v2-branch <ChangeDetailV2Client return",
    ).toBeLessThan(jsxIdx);
  });
});

describe("Architecture — Section 6 C6b try/catch + structured-warning contract", () => {
  // Slice from the loader invocation to a generous trailing window
  // so the catch block (which always follows immediately) is in view.
  const invokeIdx = ACTIVE.indexOf("loadChangePrimaryEvidence(");
  const trailingSlice = invokeIdx >= 0 ? ACTIVE.slice(invokeIdx) : "";

  it("the loader invocation is wrapped in a try { ... } catch (error) { ... } block", () => {
    // The `try {` opener appears BEFORE the invocation in the source.
    // The `} catch (error) {` follows the invocation closure.
    const tryIdx = ACTIVE.lastIndexOf("try {", invokeIdx);
    expect(
      tryIdx,
      "the loader invocation must be preceded by a `try {` opener",
    ).toBeGreaterThanOrEqual(0);
    expect(trailingSlice).toMatch(/\}\s*catch\s*\(\s*error\s*\)\s*\{/);
  });

  it("the catch block emits console.warn with the locked [section6-c6] prefix", () => {
    expect(trailingSlice).toMatch(
      /console\.warn\s*\(\s*"\[section6-c6\] change primary evidence failed"/,
    );
  });

  it("the warn payload includes tenantId, changeId, recommendedEditId, and a narrowed error.message", () => {
    expect(trailingSlice).toMatch(/tenantId\s*,/);
    expect(trailingSlice).toMatch(/changeId\s*:/);
    expect(trailingSlice).toMatch(/recommendedEditId\s*:/);
    expect(trailingSlice).toMatch(
      /error\s*:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(\s*error\s*\)/,
    );
  });

  it("the catch block sets primaryEvidenceLines to the null-fallback shape", () => {
    // The catch body must contain an assignment that clears
    // primaryEvidenceLines to null so the client renders nothing.
    expect(trailingSlice).toMatch(/primaryEvidenceLines\s*=\s*null/);
  });

  it("the catch block does NOT leak the raw error binding, stack, or Supabase key to logs", () => {
    const catchIdx = trailingSlice.search(/\}\s*catch\s*\(\s*error\s*\)\s*\{/);
    expect(catchIdx).toBeGreaterThanOrEqual(0);
    const catchBody = trailingSlice.slice(catchIdx);
    // Forbid `console.X(..., error)` — would dump the full object.
    expect(catchBody).not.toMatch(/console\.\w+\([^)]*,\s*error\s*\)/);
    expect(catchBody).not.toMatch(/error\.stack/);
    expect(catchBody).not.toMatch(/\bSUPABASE_SERVICE_ROLE_KEY\b/);
  });
});
