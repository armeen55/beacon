/**
 * Today perf cleanup (2026-05-12) — pin the `resolveFirstReadingState`
 * short-circuit + silent fail-soft.
 *
 * Background: `.data/global/tenants.json` is gitignored and absent on
 * Vercel runtime. The prior `resolveFirstReadingState` ALWAYS called
 * `currentTenant()` before checking observation count, so every /today
 * render on production threw inside `getTenantOrThrow()`, the catch
 * returned `{ isFirstReading: false }`, and a noisy
 * `[today] firstReading: currentTenant() threw — defaulting to
 * isFirstReading=false Error: Unknown tenant: tenant-ritz-founder.
 * Available: (none)` warning was emitted on every page load. Mature
 * tenants (with observations) can never be in first-reading state
 * regardless of tenant data — the detector returns `false` on
 * `observationCount > 0` anyway.
 *
 * Fix: short-circuit BEFORE the `currentTenant()` call when the
 * detector's pure logic guarantees `isFirstReading: false`. Also drop
 * the `console.warn` from the catch — the throw is the documented
 * production path, not an exceptional condition.
 *
 * Pinned:
 *   1. `resolveFirstReadingState` returns `{ isFirstReading: false }`
 *      WITHOUT calling `currentTenant()` when `observationCount > 0`
 *      OR `activePromptCount === 0`.
 *   2. The catch block does NOT call `console.warn` — the prior log
 *      noise is gone.
 *   3. The try/catch around `currentTenant()` is still present (the
 *      existing onboard-first-reading-contract.test.ts pins this).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Today perf: resolveFirstReadingState short-circuit + silent fail-soft", () => {
  const src = read("src/app/(shell)/today-data.ts");
  const stripped = stripComments(src);

  // Extract the resolveFirstReadingState function body for scoped checks.
  const fnMatch = stripped.match(
    /async function resolveFirstReadingState[\s\S]*?\n\}\n/,
  );
  const body = fnMatch ? fnMatch[0] : "";

  it("the resolver function exists in today-data.ts", () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it("short-circuits when observationCount > 0 OR activePromptCount === 0", () => {
    // Pin the EARLY-RETURN guard that runs before currentTenant().
    // Either two separate checks OR a combined expression is fine; we
    // pin the semantic shape with a flexible regex.
    expect(body).toMatch(
      /if\s*\([^)]*args\.observationCount\s*>\s*0[^)]*\|\|[^)]*args\.activePromptCount\s*===\s*0[^)]*\)/,
    );
    // And the early-return must return `{ isFirstReading: false }`.
    const earlyReturnIdx = body.search(
      /if\s*\([^)]*args\.observationCount\s*>\s*0/,
    );
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    const afterIf = body.slice(earlyReturnIdx, earlyReturnIdx + 400);
    expect(afterIf).toMatch(/return\s*\{\s*isFirstReading:\s*false\s*\}/);
  });

  it("the short-circuit guard runs BEFORE currentTenant() is called", () => {
    const guardIdx = body.search(
      /if\s*\([^)]*args\.observationCount\s*>\s*0/,
    );
    const tenantIdx = body.indexOf("currentTenant()");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(tenantIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(tenantIdx);
  });

  it("the catch block does NOT emit a console.warn", () => {
    // Prior version emitted a noisy warn on every production render
    // because the gitignored .data/global/tenants.json file means
    // currentTenant() always throws on Vercel. Pin its absence.
    const catchMatch = body.match(/catch[\s\S]{0,300}?\}\n/);
    expect(catchMatch).toBeTruthy();
    if (!catchMatch) return;
    const catchBlock = catchMatch[0];
    expect(catchBlock).not.toMatch(/console\.(warn|log|error)/);
    expect(catchBlock).toMatch(/return\s*\{\s*isFirstReading:\s*false\s*\}/);
  });

  it("no '[today] firstReading' string remains in today-data.ts", () => {
    // Negative pin: the prior log string lived ONLY in the warn() call
    // that we just removed. Its absence is the cleanest assertion that
    // the noise is gone.
    expect(stripped).not.toMatch(/\[today\]\s+firstReading/);
  });
});
