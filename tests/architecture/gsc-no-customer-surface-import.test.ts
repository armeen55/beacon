/**
 * Architecture invariant — A.3.b1.beta (2026-05-17).
 *
 * Customer-facing surfaces MUST NOT import the GSC URL Inspection
 * client (`@/lib/connectors/gsc/**`) or the GSC signal adapter
 * (`@/domains/indexability/load-gsc-signal`). The GSC pipeline is
 * operator-substrate only; the indexability loader's opt-in flag
 * (`enableGsc?: boolean`, default false) is the structural gate
 * preventing customer surfaces from ever loading GSC data.
 *
 * Scanned directories (recursive):
 *   • `src/app/(shell)/today/**`
 *   • `src/app/(shell)/recommendations/**`
 *   • `src/app/(shell)/changes/**`
 *   • `src/app/(shell)/prompts/**`
 *   • `src/app/(shell)/local/**`
 *   • `src/app/(shell)/competitors/**`
 *   • `src/components/today/**`
 *   • `src/components/recommendations/**`
 *   • `src/components/changes/**`
 *   • `src/components/prompts/**`
 *   • `src/components/local/**`
 *
 * Forbidden import patterns in those directories:
 *   • `from "@/lib/connectors/gsc/..."` (any sub-path)
 *   • `from "@/domains/indexability/load-gsc-signal"`
 *   • `gscUrlInspect` identifier reference
 *   • `loadGscSignal` identifier reference
 *
 * Permitted operator-only surfaces:
 *   • `src/app/(shell)/diagnostics/**`
 *   • `src/domains/indexability/**` (load-indexability.ts is the
 *     opt-in caller; verdict computer reads the signal but doesn't
 *     import the client)
 *   • `src/lib/connectors/gsc/**` itself
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const SCAN_DIRS = [
  "src/app/(shell)/today",
  "src/app/(shell)/recommendations",
  "src/app/(shell)/changes",
  "src/app/(shell)/prompts",
  "src/app/(shell)/local",
  "src/app/(shell)/competitors",
  "src/components/today",
  "src/components/recommendations",
  "src/components/changes",
  "src/components/prompts",
  "src/components/local",
];

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      yield full;
    }
  }
}

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  {
    pattern: /from\s+["']@\/lib\/connectors\/gsc(?:\/|["'])/,
    label: "@/lib/connectors/gsc/* import",
  },
  {
    pattern: /from\s+["']@\/domains\/indexability\/load-gsc-signal["']/,
    label: "@/domains/indexability/load-gsc-signal import",
  },
];

const FORBIDDEN_IDENTIFIER_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  { pattern: /\bgscUrlInspect\b/, label: "gscUrlInspect identifier" },
  { pattern: /\bloadGscSignal\b/, label: "loadGscSignal identifier" },
];

describe("customer surfaces — no GSC client or adapter imports", () => {
  it("enumerates the customer-surface scan directories (sanity)", () => {
    expect(SCAN_DIRS.length).toBeGreaterThan(0);
  });

  for (const relDir of SCAN_DIRS) {
    const abs = join(REPO_ROOT, relDir);
    it(`scans ${relDir}/** for forbidden GSC imports`, () => {
      const violations: string[] = [];
      for (const file of walk(abs)) {
        const src = stripComments(readFileSync(file, "utf-8"));
        for (const { pattern, label } of FORBIDDEN_IMPORT_PATTERNS) {
          if (pattern.test(src)) {
            violations.push(`${relative(REPO_ROOT, file)} — ${label}`);
          }
        }
        for (const { pattern, label } of FORBIDDEN_IDENTIFIER_PATTERNS) {
          if (pattern.test(src)) {
            violations.push(`${relative(REPO_ROOT, file)} — ${label}`);
          }
        }
      }
      expect(
        violations,
        `Customer surfaces under ${relDir}/** must not reference the GSC ` +
          `pipeline. GSC is operator-substrate only; the indexability ` +
          `loader's enableGsc opt-in (default off) is the structural gate. ` +
          `Violations:\n${violations.join("\n")}`,
      ).toEqual([]);
    });
  }
});
