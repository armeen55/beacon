/**
 * Architecture invariant — Section 7 C7b LLM-exclusion contract
 * (2026-05-16).
 *
 * Pins that the 7 off-site/manual action types added in C7b NEVER
 * reach the LLM specific-edit provider:
 *
 *   1. Runtime: every off-site type carries `generatorActive: false`
 *      in `ACTION_TYPE_REGISTRY`.
 *   2. Runtime: `listActiveActionTypes()` (exported) — which uses the
 *      same `ACTION_TYPES.filter(t => ACTION_TYPE_REGISTRY[t].generatorActive)`
 *      shape as the non-exported `defaultAllowedActionTypes()` in
 *      `specific-edit-evidence.ts` — returns none of the 7.
 *   3. Source-text: `specific-edit-evidence.ts` builds its default
 *      LLM allowlist via the same `generatorActive` filter (the
 *      single canonical filter shape — no parallel allowlist
 *      elsewhere in `src/domains/recommendations/`).
 *   4. Source-text: no off-site action-type string literal appears
 *      inside any `allowedActionTypes:` construction across the
 *      recommendations domain.
 *
 * (3) is checked by source-text on `specific-edit-evidence.ts`
 * because `defaultAllowedActionTypes` is intentionally not exported.
 * The pre-flight rule "do not widen exports for tests" is honored
 * here — we prove the filter shape via the function's source text,
 * not by importing it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  listActiveActionTypes,
  type ActionType,
} from "@/domains/recommendations/action-types";

const REPO_ROOT = resolve(__dirname, "..", "..");

const OFF_SITE_ACTION_TYPES: ReadonlyArray<ActionType> = [
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
];

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("Architecture — Section 7 C7b off-site types are NOT LLM-allowed", () => {
  it("every off-site type has generatorActive: false", () => {
    for (const t of OFF_SITE_ACTION_TYPES) {
      expect(ACTION_TYPE_REGISTRY[t].generatorActive).toBe(false);
    }
  });

  it("listActiveActionTypes() excludes all 7 off-site types", () => {
    const active = new Set(listActiveActionTypes());
    for (const t of OFF_SITE_ACTION_TYPES) {
      expect(active.has(t)).toBe(false);
    }
  });

  it("ACTION_TYPES.filter(generatorActive=true) excludes all 7 off-site types (parallel proof to listActiveActionTypes)", () => {
    const active = ACTION_TYPES.filter(
      (t) => ACTION_TYPE_REGISTRY[t].generatorActive,
    );
    for (const t of OFF_SITE_ACTION_TYPES) {
      expect(active).not.toContain(t);
    }
  });

  it("specific-edit-evidence.ts:defaultAllowedActionTypes filters on generatorActive (source-text shape pin)", () => {
    const active = stripComments(
      read("src/domains/recommendations/specific-edit-evidence.ts"),
    );
    // Pin the canonical filter shape so a future drive-by that
    // introduces a parallel LLM allowlist would have to do so
    // visibly. The exact text below is the function body of
    // `defaultAllowedActionTypes()`.
    expect(active).toMatch(
      /function\s+defaultAllowedActionTypes\s*\(\s*\)\s*:\s*ActionType\[\]\s*\{\s*return\s+ACTION_TYPES\.filter\(\s*\([^)]*\)\s*=>\s*ACTION_TYPE_REGISTRY\[[a-zA-Z_]+\]\.generatorActive\s*,?\s*\)\s*;\s*\}/,
    );
  });
});

describe("Architecture — Section 7 C7b off-site type literals never appear in allowedActionTypes constructions", () => {
  const domainFiles = listTsFiles(
    resolve(REPO_ROOT, "src/domains/recommendations"),
  );

  it("scanned a non-trivial number of recommendation-domain files", () => {
    expect(domainFiles.length).toBeGreaterThan(10);
  });

  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`no "${t}" string literal appears inside any allowedActionTypes: array/property construction`, () => {
      for (const f of domainFiles) {
        const active = stripComments(readFileSync(f, "utf-8"));
        // Walk every `allowedActionTypes` mention and scan a small
        // window after it for an inline array containing the off-site
        // literal. This catches both `allowedActionTypes: [...]`
        // object-property constructions and `allowedActionTypes = [...]`
        // assignments.
        const re = /allowedActionTypes\s*[:=]\s*(\[[\s\S]*?\])/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(active)) !== null) {
          const literal = m[1];
          const needle = `"${t}"`;
          if (literal.includes(needle)) {
            const file = f.replace(REPO_ROOT + "/", "");
            throw new Error(
              `${file}: off-site action type "${t}" appears inside an allowedActionTypes construction:\n` +
                `  ${literal.replace(/\s+/g, " ").slice(0, 200)}`,
            );
          }
        }
        // Always at least one expect call so vitest registers this
        // test (even when the file under inspection has no match).
        expect(true).toBe(true);
      }
    });
  }
});
