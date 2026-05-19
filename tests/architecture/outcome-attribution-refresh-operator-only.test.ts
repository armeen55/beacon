/**
 * Architecture invariant — Slice 9.A2γ (2026-05-19).
 *
 * The operator-only GA4 traffic refresh server action MUST gate by
 * `isOperatorModeServer()` BEFORE any downstream work (token read,
 * tenant context resolution, persist call, GA4 Data API HTTP).
 *
 * Pins:
 *   1. `refreshTenantGa4Traffic` is exported as an async function
 *      from `src/app/(shell)/diagnostics/outcome-attribution/actions.ts`.
 *   2. The actions file declares `"use server"` at the top.
 *   3. The actions file imports `isOperatorModeServer` from
 *      `@/lib/operator-mode`.
 *   4. The first non-comment, non-import statement inside
 *      `refreshTenantGa4Traffic` references `isOperatorModeServer()`
 *      and returns `not_operator` on failure (gate-first).
 *   5. The actions file imports `revalidatePath` from `next/cache`
 *      (positive sanity: re-render is wired).
 *   6. The actions file imports `persistGa4UrlTraffic` (positive
 *      sanity: the only allowed Data API entry point is wired).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const ACTIONS_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/diagnostics/outcome-attribution/actions.ts",
);

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const RAW = readFileSync(ACTIONS_PATH, "utf-8");
const CODE = stripComments(RAW);

describe("outcome-attribution refresh action — operator-only gate", () => {
  it("declares 'use server' at the top", () => {
    expect(
      /^['"]use server['"]\s*;/.test(RAW.trimStart()),
      "actions.ts must start with `'use server';` directive.",
    ).toBe(true);
  });

  it("exports refreshTenantGa4Traffic as an async function", () => {
    expect(
      /export\s+async\s+function\s+refreshTenantGa4Traffic\s*\(/.test(CODE),
      "actions.ts must export `refreshTenantGa4Traffic` as an async function.",
    ).toBe(true);
  });

  it("imports isOperatorModeServer from @/lib/operator-mode", () => {
    expect(
      /from\s+["']@\/lib\/operator-mode["']/.test(CODE),
      "actions.ts must import from @/lib/operator-mode.",
    ).toBe(true);
    expect(
      /isOperatorModeServer/.test(CODE),
      "actions.ts must reference isOperatorModeServer.",
    ).toBe(true);
  });

  it("checks isOperatorModeServer() inside refreshTenantGa4Traffic BEFORE any other work", () => {
    // Isolate the function body from the export to the first
    // top-level `}` (function close). Verify isOperatorModeServer()
    // appears before getGoogleConnectorToken / persistGa4UrlTraffic.
    const match = CODE.match(
      /export\s+async\s+function\s+refreshTenantGa4Traffic\s*\([^)]*\)\s*:\s*[^\{]+\{([\s\S]*)$/,
    );
    expect(match, "Could not locate refreshTenantGa4Traffic body.").not.toBe(
      null,
    );
    const body = match![1]!;
    const gateIdx = body.indexOf("isOperatorModeServer(");
    const tokenIdx = body.indexOf("getGoogleConnectorToken");
    const persistIdx = body.indexOf("persistGa4UrlTraffic");
    expect(
      gateIdx >= 0,
      "isOperatorModeServer() call missing from refreshTenantGa4Traffic body.",
    ).toBe(true);
    if (tokenIdx >= 0) {
      expect(
        gateIdx < tokenIdx,
        "isOperatorModeServer() must run BEFORE getGoogleConnectorToken.",
      ).toBe(true);
    }
    if (persistIdx >= 0) {
      expect(
        gateIdx < persistIdx,
        "isOperatorModeServer() must run BEFORE persistGa4UrlTraffic.",
      ).toBe(true);
    }
  });

  it("returns the 'not_operator' discriminator on gate failure", () => {
    expect(
      /reason\s*:\s*["']not_operator["']/.test(CODE),
      "actions.ts must return { ok: false, reason: 'not_operator' } " +
        "when isOperatorModeServer() is false.",
    ).toBe(true);
  });

  it("imports revalidatePath from next/cache (positive sanity)", () => {
    expect(
      /from\s+["']next\/cache["']/.test(CODE),
      "actions.ts must import from next/cache.",
    ).toBe(true);
    expect(
      /revalidatePath/.test(CODE),
      "actions.ts must reference revalidatePath.",
    ).toBe(true);
  });

  it("imports persistGa4UrlTraffic (positive sanity: Data API seam wired)", () => {
    expect(
      /from\s+["']@\/lib\/connectors\/ga4\/persist-url-traffic["']/.test(CODE),
      "actions.ts must import from @/lib/connectors/ga4/persist-url-traffic — " +
        "this is the only allowed entry point for the Data API.",
    ).toBe(true);
    expect(
      /persistGa4UrlTraffic/.test(CODE),
      "actions.ts must reference persistGa4UrlTraffic.",
    ).toBe(true);
  });
});
