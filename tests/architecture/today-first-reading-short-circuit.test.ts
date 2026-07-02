/**
 * Today first-reading short-circuit (rewritten 2026-07-01, FINAL PREMIUM
 * PLAN item 101).
 *
 * This file originally pinned `resolveFirstReadingState` inside the legacy
 * /today loader (`today-data.ts`). That loader was deleted; the live
 * first-reading decision now runs in `loadTodayV2GateData` in
 * `today-v2-data.ts`. The invariant it protected is still load-bearing,
 * so it is re-pinned against the live gate:
 *
 *   `.data/global/tenants.json` is gitignored and absent on Vercel, so
 *   `currentTenant()` THROWS on every production render. Mature tenants
 *   (observations present) can never be in first-reading state, so the
 *   gate must short-circuit to `{ isFirstReading: false }` BEFORE any
 *   `currentTenant()` call, and the cold-tenant fallback must fail soft
 *   (no log noise, no throw) when the tenant record is unreadable.
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

describe("Today V2 gate: first-reading short-circuit + silent fail-soft", () => {
  const src = read("src/app/(shell)/today-v2-data.ts");
  const stripped = stripComments(src);

  // Extract the loadTodayV2GateData function body for scoped checks.
  const start = stripped.indexOf("export async function loadTodayV2GateData");
  const tail = start >= 0 ? stripped.slice(start) : "";
  const next = tail.search(/\nexport\s+(async\s+function|function|const|type)\s/);
  const body = next > 0 ? tail.slice(0, next) : tail;

  it("the gate function exists in today-v2-data.ts", () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it("short-circuits when observationCount > 0 OR activePromptCount === 0", () => {
    expect(body).toMatch(
      /if\s*\(\s*observationCount\s*>\s*0\s*\|\|\s*activePromptCount\s*===\s*0\s*\)/,
    );
    const guardIdx = body.search(
      /if\s*\(\s*observationCount\s*>\s*0\s*\|\|\s*activePromptCount\s*===\s*0\s*\)/,
    );
    const afterIf = body.slice(guardIdx, guardIdx + 400);
    expect(afterIf).toMatch(/isFirstReading:\s*false/);
  });

  it("the short-circuit guard runs BEFORE currentTenant() is called", () => {
    const guardIdx = body.search(
      /if\s*\(\s*observationCount\s*>\s*0\s*\|\|\s*activePromptCount\s*===\s*0\s*\)/,
    );
    const tenantIdx = body.indexOf("currentTenant()");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(tenantIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(tenantIdx);
  });

  it("the cold-tenant fallback catch is silent and returns isFirstReading: false", () => {
    // The catch wrapping the currentTenant() + detectFirstReadingState
    // path must not log (the throw is the documented production path)
    // and must fail soft.
    const tenantIdx = body.indexOf("currentTenant()");
    const afterTenant = body.slice(tenantIdx);
    const catchMatch = afterTenant.match(/catch[\s\S]{0,300}?\}/);
    expect(catchMatch).toBeTruthy();
    if (!catchMatch) return;
    const catchBlock = catchMatch[0];
    expect(catchBlock).not.toMatch(/console\.(warn|log|error)/);
    expect(catchBlock).toMatch(/isFirstReading:\s*false/);
  });
});
