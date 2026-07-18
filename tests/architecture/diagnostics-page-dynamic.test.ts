/**
 * Architecture invariant — operator surface prerender safety (2026-05-15).
 *
 * The operator-only `/diagnostics` deep-page family executes tenant-scoped
 * Supabase reads at render time. Without an
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
 * The index itself is now a deliberately tiny redirect to Today; it must not
 * regain the retired all-in-one diagnostics implementation.
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

describe("Architecture — /diagnostics index remains a tiny customer redirect", () => {
  const SRC = read("src/app/(shell)/diagnostics/page.tsx");

  it("redirects to Today", () => {
    expect(SRC).toContain('redirect("/")');
  });

  it("does not import data, operator, or diagnostics engines", () => {
    expect(SRC).not.toMatch(/@\/domains\//);
    expect(SRC).not.toMatch(/seed-data|operator-mode|persistence/);
    expect(SRC.split("\n").length).toBeLessThanOrEqual(20);
  });
});
