/**
 * Architecture invariant — operator surface prerender safety (2026-05-15).
 *
 * The operator-only `/diagnostics` page family executes tenant-scoped
 * Supabase reads at render time (e.g.,
 * `src/app/(shell)/diagnostics/page.tsx:261` calls
 * `repo.getPageSnapshots()` on a ≥ 1,367-row table). Without an
 * `export const dynamic = "force-dynamic"` directive, Next.js's
 * Turbopack build attempts to statically prerender the page during
 * `next build`, which executes the server-component body — and on
 * slow Supabase responses the read exceeds the statement_timeout,
 * producing nondeterministic deployment failures (e.g., commit
 * 730a6de's Vercel build on 2026-05-15 hit:
 *
 *     Error: Supabase query failed on page_snapshots:
 *     canceling statement due to statement timeout
 *
 * even though the C4a code change had nothing to do with the
 * diagnostics page).
 *
 * Three sibling pages under `/diagnostics/*` (brain, spikes,
 * indexability) already declare the directive; this invariant
 * extends the contract to the index page AND pins the existing
 * siblings so a future drive-by edit can't drop the directive from
 * any of them.
 *
 * Defense-in-depth pin (3rd assertion): the operator gate on the
 * index page (`isOperatorMode()` + `notFound()`) MUST remain
 * intact. This guarantees the dynamic-directive fix doesn't
 * accidentally remove the gate while replacing the file body.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────
// The full diagnostics page family that must declare the directive.
// Add new diagnostics sub-pages here when they land.
// ─────────────────────────────────────────────────────────────────────

const DIAGNOSTICS_PAGES = [
  "src/app/(shell)/diagnostics/page.tsx",
  "src/app/(shell)/diagnostics/brain/page.tsx",
  "src/app/(shell)/diagnostics/spikes/page.tsx",
  "src/app/(shell)/diagnostics/indexability/page.tsx",
  "src/app/(shell)/diagnostics/rank-revenue/page.tsx",
] as const;

describe("Architecture — operator-only diagnostics pages declare force-dynamic", () => {
  for (const rel of DIAGNOSTICS_PAGES) {
    it(`${rel} declares export const dynamic = "force-dynamic"`, () => {
      const src = read(rel);
      // Whitespace-tolerant: allow `dynamic = 'force-dynamic'` or
      // `dynamic = "force-dynamic"` (both quoting styles).
      expect(src).toMatch(
        /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
      );
    });
  }
});

describe("Architecture — /diagnostics index operator gate remains intact", () => {
  // Defense-in-depth: pin that the dynamic-directive fix didn't
  // accidentally remove the operator-mode gate while editing the
  // file body.
  const SRC = read("src/app/(shell)/diagnostics/page.tsx");

  it("references isOperatorMode()", () => {
    expect(SRC).toMatch(/isOperatorMode\s*\(\s*\)/);
  });

  it("calls notFound() when not in operator mode", () => {
    expect(SRC).toMatch(/notFound\s*\(\s*\)/);
  });

  it("imports the operator-mode helper from @/lib/operator-mode", () => {
    expect(SRC).toMatch(
      /from\s+["']@\/lib\/operator-mode["']/,
    );
  });
});
