/**
 * Architecture invariant — Phase A.3 Step 5 (2026-05-14).
 *
 * The `/diagnostics/indexability` page is an operator-only surface.
 * It surfaces raw signals (snake_case enum verdicts, verbatim
 * robots_meta values, HTTP status codes) intended only for the
 * operator running Beacon — never for an end customer. This
 * invariant pins the gating boundary at the source-text level:
 *
 *   1. The page lives at the canonical diagnostics path
 *      (`src/app/(shell)/diagnostics/indexability/page.tsx`).
 *   2. The page imports `isOperatorModeServer` from
 *      `@/lib/operator-mode` (the locked operator-gate helper).
 *   3. The page calls `notFound()` (from `next/navigation`) when
 *      the gate is false — Next.js renders a 404 with no error
 *      surface, no operator-only string leak.
 *   4. The page allows `NODE_ENV === "test"` to bypass the gate
 *      for render-test coverage (mirrors the brain-diagnostics
 *      pattern).
 *   5. The Command Center operator-link to the page is gated by
 *      the `isOperator` prop AND carries the
 *      `data-command-center-operator-link` data-attr (matches
 *      existing brain-diagnostics-link convention).
 *   6. NO customer-facing nav/layout file references the page
 *      directly — the only path to it is the operator-link in
 *      Command Center (which itself is operator-gated).
 *
 * Retirement: permanent. Operator-only diagnostic surfaces stay
 * operator-only — this invariant has no exit path.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE_PATH = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "indexability",
  "page.tsx",
);
const COMMAND_CENTER_PATH = resolve(
  REPO_ROOT,
  "src",
  "components",
  "today",
  "command-center.tsx",
);

// Comment-stripped source so a docstring discussion of the forbidden
// shape doesn't trip the test.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("Architecture — /diagnostics/indexability operator-only gate (Phase A.3 §5)", () => {
  // ─────────────────────────────────────────────────────────────────
  // Pin 1: canonical page path
  // ─────────────────────────────────────────────────────────────────

  it("page exists at the canonical diagnostics path", () => {
    expect(existsSync(PAGE_PATH)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 2 + 3: operator-mode import + notFound() call
  // ─────────────────────────────────────────────────────────────────

  it("page imports isOperatorModeServer from @/lib/operator-mode", () => {
    const src = readFileSync(PAGE_PATH, "utf-8");
    expect(src).toMatch(/from\s+["']@\/lib\/operator-mode["']/);
    expect(stripComments(src)).toMatch(/\bisOperatorModeServer\b/);
  });

  it("page imports notFound from next/navigation", () => {
    const src = readFileSync(PAGE_PATH, "utf-8");
    expect(src).toMatch(/from\s+["']next\/navigation["']/);
    expect(stripComments(src)).toMatch(/\bnotFound\b/);
  });

  it("page calls notFound() when the operator gate is false", () => {
    const stripped = stripComments(readFileSync(PAGE_PATH, "utf-8"));
    // Structural shape: a call to notFound() must appear at module
    // scope inside the gate branch. We pin both the call AND the
    // surrounding `!isOperatorMode()` check.
    expect(stripped).toMatch(/notFound\s*\(\s*\)/);
    expect(stripped).toMatch(/!\s*isOperatorMode\s*\(\s*\)/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 4: NODE_ENV === "test" extension
  // ─────────────────────────────────────────────────────────────────

  it("page allows NODE_ENV === 'test' to bypass the gate (render-coverage extension)", () => {
    const stripped = stripComments(readFileSync(PAGE_PATH, "utf-8"));
    expect(stripped).toMatch(/process\.env\.NODE_ENV\s*===\s*["']test["']/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 5: Command Center link is operator-gated
  // ─────────────────────────────────────────────────────────────────

  it("Command Center operator-link to /diagnostics/indexability carries the operator-link data-attr", () => {
    const src = readFileSync(COMMAND_CENTER_PATH, "utf-8");
    expect(src).toContain('href="/diagnostics/indexability"');
    expect(src).toContain('data-command-center-operator-link="true"');
    // The link target marker for the indexability variant.
    expect(src).toContain(
      'data-command-center-operator-link-target="indexability"',
    );
  });

  it("Command Center operator-link block is gated by isOperator (matches existing brain-link pattern)", () => {
    const stripped = stripComments(readFileSync(COMMAND_CENTER_PATH, "utf-8"));
    // The locked Command Center pattern wraps every operator-only
    // link in a single `{isOperator ? (...) : null}` block. Pin
    // both that the page reference and the gate appear together.
    expect(stripped).toMatch(/isOperator\s*\?/);
    // The indexability href must NOT appear outside the
    // `isOperator ?` block. Cheap structural check: the file
    // should NOT contain the href before the first `isOperator ?`
    // ternary marker.
    const hrefIdx = stripped.indexOf('href="/diagnostics/indexability"');
    const gateIdx = stripped.indexOf("isOperator");
    expect(hrefIdx).toBeGreaterThan(gateIdx);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 6: no customer-facing nav/layout references the page
  // ─────────────────────────────────────────────────────────────────

  it("no customer-facing nav/layout references /diagnostics/indexability outside operator-gated surfaces", () => {
    // Walk src/app/(shell)/layout*.tsx and src/components/nav* (if
    // present) and assert none of them mention the page href. The
    // ONLY allowed reference is in command-center.tsx (which we
    // already pinned as operator-gated above).
    const allowedReferents = new Set<string>([
      COMMAND_CENTER_PATH,
      PAGE_PATH, // self-reference inside the page (filter chips)
    ]);
    const matches: string[] = [];
    function walk(dir: string): void {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
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
          // Skip the diagnostics directory itself — operator surfaces
          // can cross-reference each other freely.
          if (name === "diagnostics") continue;
          walk(full);
        } else if (
          (name.endsWith(".tsx") || name.endsWith(".ts")) &&
          !name.endsWith(".test.tsx") &&
          !name.endsWith(".test.ts")
        ) {
          let content;
          try {
            content = readFileSync(full, "utf-8");
          } catch {
            continue;
          }
          if (
            content.includes("/diagnostics/indexability") &&
            !allowedReferents.has(full)
          ) {
            matches.push(full.slice(REPO_ROOT.length + 1));
          }
        }
      }
    }
    walk(resolve(REPO_ROOT, "src", "app"));
    walk(resolve(REPO_ROOT, "src", "components"));
    expect(
      matches,
      `customer-facing surfaces reference /diagnostics/indexability outside the operator-gated link: ${matches.join(", ")}`,
    ).toEqual([]);
  });
});
