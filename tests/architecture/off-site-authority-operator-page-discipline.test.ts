/**
 * Architecture invariant — Section 7 C7a operator-page discipline
 * (2026-05-16).
 *
 * Pins on `src/app/(shell)/diagnostics/off-site-authority/page.tsx`:
 *
 *   1. Declares `export const dynamic = "force-dynamic"` so Vercel
 *      never statically prerenders the read (the loader touches
 *      process-global helpers + per-tenant per-request data).
 *   2. Imports `isOperatorModeServer` from `@/lib/operator-mode`.
 *   3. Imports `notFound` from `next/navigation`.
 *   4. Active source contains an `isOperatorModeServer(` invocation
 *      AND a `notFound(` invocation.
 *   5. The operator gate fires BEFORE the loader invocation: the
 *      first `isOperatorModeServer(` index is less than the first
 *      `loadOffSitePresenceSnapshot(` index.
 *   6. The page does NOT import `@/lib/business-config` directly —
 *      brand name + placeholder state must flow through the loader's
 *      snapshot (operator instruction).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE = "src/app/(shell)/diagnostics/off-site-authority/page.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE = stripComments(read(PAGE));

describe("Architecture — Section 7 C7a operator-page discipline", () => {
  it("declares export const dynamic = 'force-dynamic'", () => {
    expect(ACTIVE).toMatch(
      /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
    );
  });

  it("imports isOperatorModeServer from @/lib/operator-mode", () => {
    expect(ACTIVE).toMatch(
      /import\s*\{[^}]*\bisOperatorModeServer\b[^}]*\}\s*from\s*["']@\/lib\/operator-mode["']/,
    );
  });

  it("imports notFound from next/navigation", () => {
    expect(ACTIVE).toMatch(
      /import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/,
    );
  });

  it("contains both isOperatorModeServer(...) and notFound(...) invocations", () => {
    expect(ACTIVE).toMatch(/\bisOperatorModeServer\s*\(/);
    expect(ACTIVE).toMatch(/\bnotFound\s*\(/);
  });

  it("operator gate appears BEFORE the loader invocation", () => {
    const gateIdx = ACTIVE.indexOf("isOperatorModeServer(");
    const loaderIdx = ACTIVE.indexOf("loadOffSitePresenceSnapshot(");
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(loaderIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeLessThan(loaderIdx);
  });

  it("does NOT import from @/lib/business-config directly", () => {
    expect(ACTIVE).not.toMatch(
      /from\s+["']@\/lib\/business-config["']/,
    );
  });
});
