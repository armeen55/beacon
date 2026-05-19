/**
 * Architecture invariant — Slice 9.A2γ (2026-05-19).
 *
 * Customer surfaces MUST NEVER import the operator-only GA4 traffic
 * refresh path. Mirrors `ga4-no-page-load-call`'s scan pattern.
 *
 * Two forbidden imports for customer surfaces:
 *   • `refreshTenantGa4Traffic` (the server action at
 *     `@/app/(shell)/diagnostics/outcome-attribution/actions`)
 *   • `persistGa4UrlTraffic` / `computeRefreshDateRange` (the persist
 *     helper at `@/lib/connectors/ga4/persist-url-traffic`)
 *
 * Both modules are operator-substrate only. The architecture invariant
 * `ga4-no-page-load-call` already forbids customer surfaces from
 * importing `@/lib/connectors/ga4/*` directly; this invariant adds a
 * NAMED check on the persist + action exports so a future refactor
 * that adds a re-export anywhere doesn't bypass the directory scan.
 *
 * Pinned customer surfaces:
 *   src/app/(shell)/today/**
 *   src/app/(shell)/recommendations/**
 *   src/app/(shell)/changes/**
 *   src/app/(shell)/prompts/**
 *   src/app/(shell)/local/**
 *   src/app/(shell)/competitors/**
 *   src/components/{today,recommendations,changes,prompts,local}/**
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const SCAN_ROOTS = [
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

const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  // Action import (relative + alias forms).
  /from\s+["']@\/app\/\(shell\)\/diagnostics\/outcome-attribution\/actions["']/,
  // Persist helper import (only operator paths may import this).
  /from\s+["']@\/lib\/connectors\/ga4\/persist-url-traffic["']/,
  // Named identifiers (defense in depth in case of dynamic import).
  // `refreshTenantGa4Traffic` matches both the structured action AND
  // its form-binding wrapper `refreshTenantGa4TrafficFromForm` (the
  // wrapper has the action name as a prefix; this match is broader
  // than `\b` would allow on the wrapper but tightens defense in
  // depth — neither name belongs on a customer surface).
  /refreshTenantGa4Traffic/,
  /\bpersistGa4UrlTraffic\b/,
  /\bcomputeRefreshDateRange\b/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...walk(full));
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

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("outcome-attribution refresh — no customer-surface import", () => {
  it("no customer surface imports refreshTenantGa4Traffic / persistGa4UrlTraffic / computeRefreshDateRange", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = join(REPO_ROOT, root);
      for (const path of walk(abs)) {
        const code = stripComments(readFileSync(path, "utf-8"));
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(code)) {
            offenders.push(
              `${path.replace(REPO_ROOT + "/", "")} (matched ${pat.source})`,
            );
            break;
          }
        }
      }
    }
    expect(
      offenders,
      "These customer-surface files reference operator-only GA4 traffic " +
        "refresh names. The refresh action + persist helper are operator-" +
        "substrate only:\n" +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("operator diagnostic page is the only consumer of the refresh action (positive sanity)", () => {
    // The /diagnostics/outcome-attribution page IS the allowed
    // consumer of the action. Positive sanity check ensures a future
    // refactor doesn't accidentally drop the form import.
    const pagePath = join(
      REPO_ROOT,
      "src/app/(shell)/diagnostics/outcome-attribution/page.tsx",
    );
    const code = readFileSync(pagePath, "utf-8");
    expect(
      code.includes("refreshTenantGa4Traffic"),
      "diagnostic page.tsx must import refreshTenantGa4Traffic — this is " +
        "the only allowed consumer of the operator-only refresh action.",
    ).toBe(true);
  });

  it("persist helper module declares 'server-only'", () => {
    const persistPath = join(
      REPO_ROOT,
      "src/lib/connectors/ga4/persist-url-traffic.ts",
    );
    const code = readFileSync(persistPath, "utf-8");
    expect(
      /^import\s+["']server-only["']/m.test(code),
      "persist-url-traffic.ts must declare `import \"server-only\";` to " +
        "prevent accidental client-bundle inclusion.",
    ).toBe(true);
  });
});
