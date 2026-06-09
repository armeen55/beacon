/**
 * Architecture invariant — Section 7 C7a operator-page discipline
 * (2026-05-16).
 *
 * Pins on `src/app/(shell)/diagnostics/off-site-authority/page.tsx`:
 *
 *   1. Declares `export const dynamic = "force-dynamic"` so Vercel
 *      never statically prerenders the read (the loader touches
 *      tenant-keyed business-config + per-tenant per-request data).
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

  it("operator gate appears BEFORE the first off-site data loader invocation", () => {
    // The real contract is "operator gate must happen before ANY
    // off-site authority data load." C7a's original literal check
    // hard-coded `loadOffSitePresenceSnapshot(`. Section 7 C7c
    // (2026-05-16) introduces `loadOffSiteRecommendationPreview()`
    // as a thin server wrapper that itself calls
    // `loadOffSitePresenceSnapshot()`. The page now invokes the
    // preview wrapper instead of the raw snapshot loader. This
    // updated check keeps the safety contract — operator gate is
    // still before any off-site data load — by detecting the
    // EARLIEST allowed loader invocation among the known
    // safe-wrapper set, and asserting at least one is present.
    const ALLOWED_LOADER_INVOCATIONS = [
      "loadOffSitePresenceSnapshot(",
      "loadOffSiteRecommendationPreview(",
    ];

    const gateIdx = ACTIVE.indexOf("isOperatorModeServer(");
    expect(gateIdx).toBeGreaterThanOrEqual(0);

    const loaderIndices = ALLOWED_LOADER_INVOCATIONS.map((needle) =>
      ACTIVE.indexOf(needle),
    ).filter((idx) => idx >= 0);

    expect(
      loaderIndices.length,
      `Operator page must invoke at least one allowed off-site loader from: ${ALLOWED_LOADER_INVOCATIONS.join(", ")}`,
    ).toBeGreaterThan(0);

    const firstLoaderIdx = Math.min(...loaderIndices);
    expect(gateIdx).toBeLessThan(firstLoaderIdx);
  });

  it("does NOT import from @/lib/business-config directly", () => {
    expect(ACTIVE).not.toMatch(
      /from\s+["']@\/lib\/business-config["']/,
    );
  });
});
