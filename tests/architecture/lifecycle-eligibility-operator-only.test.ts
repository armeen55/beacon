/**
 * Architecture invariant — Phase A.2 Step 3d (2026-05-18).
 *
 * The `/diagnostics/lifecycle-eligibility` page is an operator-only
 * surface. It exposes the raw lifecycle reason taxonomy (snake_case
 * enum values like `awaiting_operator_acceptance`,
 * `accepted_not_live`, `url_canonicalization_mismatch`), raw
 * implementation_status values, raw rec_id strings, and operator-
 * readable diagnostic copy — never intended for an end customer. This
 * invariant pins the gating boundary at the source-text level:
 *
 *   1. The page lives at the canonical diagnostics path
 *      (`src/app/(shell)/diagnostics/lifecycle-eligibility/page.tsx`).
 *   2. The page imports `isOperatorModeServer` from
 *      `@/lib/operator-mode`.
 *   3. The page imports `notFound` from `next/navigation` AND calls
 *      it (i.e., uses the gate to short-circuit).
 *   4. The page allows `NODE_ENV === "test"` to bypass the gate for
 *      render-test coverage (mirrors indexability + brain
 *      diagnostics).
 *   5. The diagnostics hub page (`/diagnostics`) links to the page
 *      and the link target carries the `data-diagnostics-hub-link`
 *      attribute (matches existing hub-link convention).
 *   6. NO customer-facing layout/nav file references the page —
 *      the only reachable path is via the operator-gated hub link
 *      OR via a direct URL bar visit (which the gate handles).
 *
 * Retirement: permanent. Operator-only diagnostic surfaces stay
 * operator-only — this invariant has no exit path.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE_PATH = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "lifecycle-eligibility",
  "page.tsx",
);
const HUB_PAGE_PATH = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "page.tsx",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("Architecture — /diagnostics/lifecycle-eligibility operator-only gate (Phase A.2 §3d)", () => {
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
    // Structural shape: a call to notFound() must appear inside an
    // `!isAccessAllowed()` / `!isOperatorModeServer()` short-circuit.
    expect(stripped).toMatch(/notFound\s*\(\s*\)/);
    // Either the access-helper or the raw operator-mode call is
    // acceptable; the page wraps both. Match the negated-call shape.
    expect(stripped).toMatch(/!\s*(isAccessAllowed|isOperatorModeServer)\s*\(\s*\)/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 4: NODE_ENV === "test" extension
  // ─────────────────────────────────────────────────────────────────

  it("page allows NODE_ENV === 'test' to bypass the gate (render-coverage extension)", () => {
    const stripped = stripComments(readFileSync(PAGE_PATH, "utf-8"));
    expect(stripped).toMatch(/process\.env\.NODE_ENV\s*===\s*["']test["']/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 5: diagnostics hub page links to the surface
  // ─────────────────────────────────────────────────────────────────

  it("diagnostics hub page links to /diagnostics/lifecycle-eligibility with the hub-link data-attr", () => {
    const src = readFileSync(HUB_PAGE_PATH, "utf-8");
    expect(src).toContain("/diagnostics/lifecycle-eligibility");
    expect(src).toContain(
      'data-diagnostics-hub-link="lifecycle-eligibility"',
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 6: no customer-facing nav/layout references the page
  // ─────────────────────────────────────────────────────────────────

  it("no customer-facing nav/layout references /diagnostics/lifecycle-eligibility outside operator-gated surfaces", () => {
    const allowedReferents = new Set<string>([
      HUB_PAGE_PATH,
      PAGE_PATH, // self-reference inside the page
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
            content.includes("/diagnostics/lifecycle-eligibility") &&
            !allowedReferents.has(full)
          ) {
            matches.push(relative(REPO_ROOT, full));
          }
        }
      }
    }
    walk(resolve(REPO_ROOT, "src", "app"));
    walk(resolve(REPO_ROOT, "src", "components"));
    expect(
      matches,
      `customer-facing surfaces reference /diagnostics/lifecycle-eligibility outside the operator-gated hub link: ${matches.join(", ")}`,
    ).toEqual([]);
  });
});
