/**
 * Architecture invariant — Trust Sprint T7.7 (2026-05-07).
 *
 * Final consolidated sweep of customer-visible default surfaces for
 * scared, methodology-leaking, infrastructure-leaking, and uncertainty
 * language. Caveats live in proof drawers + operator pages, not on
 * default surfaces.
 *
 * Default surfaces this invariant guards:
 *   - src/app/(shell)/today-client.tsx
 *   - src/app/(shell)/changes/scorecard-client.tsx
 *   - src/app/(shell)/recommendations/recommendations-client.tsx
 *   - src/app/(shell)/prompts/page.tsx
 *   - src/app/(shell)/settings/import/import-page.tsx
 *   - src/components/today/*
 *   - src/components/changes/* (excluding why-this-verdict, which is a drawer)
 *   - src/components/recommendations/*
 *
 * Out of scope (proof drawers + operator pages — keep their rigor):
 *   - src/app/(shell)/diagnostics/* (operator-mode-gated)
 *   - src/app/(shell)/changes/truth/* (proof drawer)
 *   - src/app/(shell)/settings/methodology/* (operator-locked)
 *   - src/app/(shell)/settings/health/* (operator)
 *   - src/components/today/why-this-number.tsx (proof drawer; details>)
 *   - src/components/changes/why-this-verdict.tsx (proof drawer; details>)
 *
 * Method: parse each guarded file, strip JSX comments and block
 * comments and line comments, then assert no forbidden phrase appears
 * as a rendered string literal or rendered text node.
 *
 * Forbidden phrases (exec-confidence sweep — default surfaces only):
 *   See FORBIDDEN_PHRASES below.
 *
 * Allowed phrases (preserve operator+drawer rigor) are NOT pinned by
 * this invariant — those surfaces have their own scope.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

/** Files to guard — TRULY customer-facing default surfaces only.
 *
 * `/settings/import/import-page.tsx` is intentionally excluded from
 * this strict guard: it's the legacy Profound CSV import tool the
 * operator deliberately invokes; vendor names there are unavoidable
 * (and per the operator brief, Profound cleanup is out of scope for
 * the trust sprint). Settings tools have their own scope.
 */
const GUARDED_FILES = [
  "src/app/(shell)/today-client.tsx",
  "src/app/(shell)/changes/scorecard-client.tsx",
  "src/app/(shell)/recommendations/recommendations-client.tsx",
  "src/app/(shell)/prompts/page.tsx",
];

/** Component directories to guard (excluding the listed drawers). */
const GUARDED_DIRS = [
  "src/components/today",
  "src/components/recommendations",
];

/** Drawer/operator files explicitly excluded from default-surface scope. */
const DRAWER_EXEMPTIONS = new Set([
  "src/components/today/why-this-number.tsx",
  "src/components/changes/why-this-verdict.tsx",
]);

/**
 * Forbidden phrases that must NOT appear as rendered text on default
 * surfaces. Each entry pins the EXACT phrase that operator brief T7.7
 * called out + the recommended replacement.
 */
const FORBIDDEN_PHRASES: ReadonlyArray<{ phrase: string; replace_with: string; case_sensitive?: boolean }> = [
  // Methodology / infrastructure leaks
  { phrase: "Supabase", replace_with: "(remove — internal infra)", case_sensitive: true },
  { phrase: "Profound", replace_with: "(remove — vendor name)", case_sensitive: true },
  { phrase: "Postgres", replace_with: "(remove — internal infra)", case_sensitive: true },
  // Schema / SQL / RLS leaks (case-sensitive to allow "Schema markup" in legitimate AEO context — but we pin the SQL-context terms)
  { phrase: "schema column", replace_with: "field" },
  { phrase: "schema table", replace_with: "data location" },
  { phrase: "RLS policy", replace_with: "(remove — internal)" },
  { phrase: "SQL query", replace_with: "(remove — internal)" },
  // Uncertainty / "we don't know" framing
  { phrase: "we cannot prove", replace_with: "directional signal" },
  { phrase: "we can't prove", replace_with: "directional signal" },
  { phrase: "we don't know", replace_with: "(remove — confident framing)" },
  // Methodology labels — ALLOWED in proof drawers, not on default surfaces
  { phrase: "Unreliable", replace_with: "Directional" },
  { phrase: "False positive", replace_with: "(remove — internal classification)" },
  { phrase: "Contaminated", replace_with: "(remove — internal classification)" },
  // Grade-D leaks (operator brain only)
  { phrase: "D grade", replace_with: "(remove — internal)" },
  { phrase: "D — blocker", replace_with: "(remove — operator-only label)" },
  // Operator/debug terminology
  { phrase: "debug only", replace_with: "(remove — operator label)" },
  { phrase: "raw UUID", replace_with: "(remove — internal ID)" },
];

function stripCommentsAndJsxComments(src: string): string {
  // Strip /* ... */ block comments (including multi-line).
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip // line comments.
  s = s.replace(/^\s*\/\/.*$/gm, "");
  // Strip JSX comments {/* ... */}
  s = s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
  // T7.7 — strip module-level import/export-from lines so identifier
  // names that happen to share substrings with forbidden phrases
  // (e.g., `importProfoundData` from @/adapters/profound) don't
  // false-positive. Imports are never rendered text; only their
  // EFFECT can be — and that's caught by the rendered-text check.
  s = s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
  s = s.replace(/^\s*import\s+[^;]+;?\s*$/gm, "");
  s = s.replace(/^\s*export\s*\{\s*[^}]+\s*\}\s*from\s+["'][^"']+["'];?\s*$/gm, "");
  return s;
}

function listFilesIn(dir: string): string[] {
  const abs = join(REPO_ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const fullPath = join(abs, name);
    const rel = `${dir}/${name}`;
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      out.push(...listFilesIn(rel));
    } else if (
      st.isFile() &&
      (name.endsWith(".tsx") || name.endsWith(".ts")) &&
      !name.endsWith(".test.tsx") &&
      !name.endsWith(".test.ts") &&
      !DRAWER_EXEMPTIONS.has(rel)
    ) {
      out.push(rel);
    }
  }
  return out;
}

function targetFiles(): string[] {
  const out: string[] = [];
  for (const f of GUARDED_FILES) {
    if (existsSync(join(REPO_ROOT, f))) out.push(f);
  }
  for (const d of GUARDED_DIRS) {
    out.push(...listFilesIn(d));
  }
  return out.filter((f) => !DRAWER_EXEMPTIONS.has(f));
}

describe("T7.7 — main product final confidence sweep (default surfaces)", () => {
  const files = targetFiles();

  it("found at least 5 default-surface files to guard", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    describe(`default surface: ${file}`, () => {
      const raw = readFileSync(join(REPO_ROOT, file), "utf-8");
      const code = stripCommentsAndJsxComments(raw);
      for (const { phrase, replace_with, case_sensitive } of FORBIDDEN_PHRASES) {
        it(`does not render the phrase "${phrase}"`, () => {
          const re = new RegExp(
            phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            case_sensitive ? "" : "i",
          );
          if (re.test(code)) {
            // Find the offending line for a useful failure message.
            const lines = code.split("\n");
            const offender = lines.findIndex((l) => re.test(l));
            const ctx = offender >= 0 ? lines[offender].trim().slice(0, 120) : "(unknown line)";
            expect.fail(
              `${file} renders "${phrase}" on a default surface (line ${offender + 1}: "${ctx}"). Replace with: ${replace_with}. If the phrase belongs in a proof drawer, move it to a drawer file (which is exempt from this invariant).`,
            );
          }
          expect(true).toBe(true);
        });
      }
    });
  }

  it("trust drawer exemptions are real files (sanity check)", () => {
    for (const ex of DRAWER_EXEMPTIONS) {
      expect(existsSync(join(REPO_ROOT, ex))).toBe(true);
    }
  });
});
