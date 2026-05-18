/**
 * Architecture invariant — Phase A.2 Step 3d (2026-05-18).
 *
 * The `@/domains/lifecycle-eligibility/**` modules expose operator
 * vocabulary deliberately: the `LifecycleEligibilityReason` enum
 * values, the `FunnelCounters` field names, and the `detail` strings
 * returned by `deriveLifecycleReason` are all snake_case operator
 * tokens (e.g., `awaiting_operator_acceptance`,
 * `url_canonicalization_mismatch`, "reconciliation pending"). These
 * tokens would leak as raw text on a customer-facing surface and
 * break the locked customer-vocabulary contract.
 *
 * This invariant pins that ONLY operator-substrate surfaces import
 * from `@/domains/lifecycle-eligibility/**`:
 *
 *   Permitted importers:
 *     • `src/app/(shell)/diagnostics/**`
 *     • `src/domains/lifecycle-eligibility/**` (self-references)
 *     • `tests/**` (any test file)
 *
 *   Forbidden importers (customer-facing surfaces):
 *     • `src/app/(shell)/today/**`
 *     • `src/app/(shell)/recommendations/**`
 *     • `src/app/(shell)/changes/**`
 *     • `src/app/(shell)/prompts/**`
 *     • `src/app/(shell)/local/**`
 *     • `src/app/(shell)/competitors/**`
 *     • `src/app/(shell)/settings/**`
 *     • `src/components/today/**`
 *     • `src/components/recommendations/**`
 *     • `src/components/changes/**`
 *     • `src/components/prompts/**`
 *     • `src/components/local/**`
 *
 * Forbidden import patterns:
 *   • `from "@/domains/lifecycle-eligibility"` (the barrel)
 *   • `from "@/domains/lifecycle-eligibility/<anything>"` (any sub-path)
 *
 * Retirement: permanent. Customer surfaces consume the user-facing
 * lifecycle copy from `@/domains/citation-lifecycle/render-copy`, not
 * the operator-side reason taxonomy.
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
  "src/app/(shell)/settings",
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

const FORBIDDEN_IMPORT_PATTERN =
  /from\s+["']@\/domains\/lifecycle-eligibility(?:\/[^"']*)?["']/;

describe("customer surfaces — no @/domains/lifecycle-eligibility imports (Phase A.2 §3d)", () => {
  it("enumerates the customer-surface scan directories (sanity)", () => {
    expect(SCAN_DIRS.length).toBeGreaterThan(0);
  });

  for (const relDir of SCAN_DIRS) {
    const abs = join(REPO_ROOT, relDir);
    it(`scans ${relDir}/** for forbidden @/domains/lifecycle-eligibility imports`, () => {
      const violations: string[] = [];
      for (const file of walk(abs)) {
        const src = stripComments(readFileSync(file, "utf-8"));
        if (FORBIDDEN_IMPORT_PATTERN.test(src)) {
          violations.push(relative(REPO_ROOT, file));
        }
      }
      expect(
        violations,
        `Customer surfaces under ${relDir}/** must not import from ` +
          `@/domains/lifecycle-eligibility/** (operator vocabulary). ` +
          `Use @/domains/citation-lifecycle/render-copy for user-` +
          `facing lifecycle text. Violations:\n${violations.join("\n")}`,
      ).toEqual([]);
    });
  }
});
