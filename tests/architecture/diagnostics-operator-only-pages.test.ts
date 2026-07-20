/**
 * Architecture invariant — operator-only diagnostics page gates
 * (consolidated 2026-07-20 architecture-suite diet).
 *
 * The per-page operator gate on operator-only `/diagnostics/*` surfaces:
 * each page (1) exists at its canonical path, (2) imports
 * `isOperatorModeServer` from `@/lib/operator-mode`, (3) imports +
 * calls `notFound()` from `next/navigation` behind a negated gate,
 * (4) allows `NODE_ENV === "test"` to bypass for render coverage, and
 * (5) is referenced by NO customer-facing nav/layout (URL-only reach).
 *
 * Subsumes (deleted; each page's pins preserved verbatim via the config
 * table below):
 *   • indexability-diagnostics-operator-only  (Phase A.3 §5)
 *   • lifecycle-eligibility-operator-only     (Phase A.2 §3d)
 *
 * NOTE: the whole `/diagnostics` subtree is ALSO gated once at
 * `layout.tsx` (see diagnostics-layout-operator-gate.test.ts, kept
 * separate for its behavioral vi.mock proof). These per-page pins are
 * the belt-and-suspenders page-level shape contract.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const HUB_PAGE = resolve(REPO_ROOT, "src", "app", "(shell)", "diagnostics", "page.tsx");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

type PageGate = {
  label: string;
  route: string; // href substring, e.g. "/diagnostics/indexability"
  pagePath: string; // absolute
  negatedGate: RegExp; // e.g. /!\s*isOperatorMode\s*\(\s*\)/
  allowedReferents: ReadonlyArray<string>; // absolute paths permitted to reference the route
};

const PAGES: ReadonlyArray<PageGate> = [
  {
    label: "/diagnostics/indexability (Phase A.3 §5)",
    route: "/diagnostics/indexability",
    pagePath: resolve(REPO_ROOT, "src", "app", "(shell)", "diagnostics", "indexability", "page.tsx"),
    negatedGate: /!\s*isOperatorMode\s*\(\s*\)/,
    allowedReferents: [resolve(REPO_ROOT, "src", "app", "(shell)", "diagnostics", "indexability", "page.tsx")],
  },
  {
    label: "/diagnostics/lifecycle-eligibility (Phase A.2 §3d)",
    route: "/diagnostics/lifecycle-eligibility",
    pagePath: resolve(REPO_ROOT, "src", "app", "(shell)", "diagnostics", "lifecycle-eligibility", "page.tsx"),
    negatedGate: /!\s*(isAccessAllowed|isOperatorModeServer)\s*\(\s*\)/,
    allowedReferents: [
      HUB_PAGE,
      resolve(REPO_ROOT, "src", "app", "(shell)", "diagnostics", "lifecycle-eligibility", "page.tsx"),
    ],
  },
];

function collectRouteReferents(route: string, allowed: ReadonlyArray<string>): string[] {
  const allowedSet = new Set(allowed);
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
        if (name === "diagnostics") continue; // operator surfaces can cross-reference freely
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
        if (content.includes(route) && !allowedSet.has(full)) matches.push(relative(REPO_ROOT, full));
      }
    }
  }
  walk(resolve(REPO_ROOT, "src", "app"));
  walk(resolve(REPO_ROOT, "src", "components"));
  return matches;
}

describe("diagnostics operator-only page gates", () => {
  for (const p of PAGES) {
    it(`${p.label}: page exists at the canonical path`, () => {
      expect(existsSync(p.pagePath)).toBe(true);
    });
    it(`${p.label}: imports isOperatorModeServer from @/lib/operator-mode`, () => {
      const src = readFileSync(p.pagePath, "utf-8");
      expect(src).toMatch(/from\s+["']@\/lib\/operator-mode["']/);
      expect(stripComments(src)).toMatch(/\bisOperatorModeServer\b/);
    });
    it(`${p.label}: imports notFound from next/navigation`, () => {
      const src = readFileSync(p.pagePath, "utf-8");
      expect(src).toMatch(/from\s+["']next\/navigation["']/);
      expect(stripComments(src)).toMatch(/\bnotFound\b/);
    });
    it(`${p.label}: calls notFound() behind the negated operator gate`, () => {
      const stripped = stripComments(readFileSync(p.pagePath, "utf-8"));
      expect(stripped).toMatch(/notFound\s*\(\s*\)/);
      expect(stripped).toMatch(p.negatedGate);
    });
    it(`${p.label}: allows NODE_ENV === 'test' to bypass the gate`, () => {
      const stripped = stripComments(readFileSync(p.pagePath, "utf-8"));
      expect(stripped).toMatch(/process\.env\.NODE_ENV\s*===\s*["']test["']/);
    });
    it(`${p.label}: no customer-facing nav/layout references ${p.route}`, () => {
      const matches = collectRouteReferents(p.route, p.allowedReferents);
      expect(matches, `customer-facing surfaces reference ${p.route}: ${matches.join(", ")}`).toEqual([]);
    });
  }
});
