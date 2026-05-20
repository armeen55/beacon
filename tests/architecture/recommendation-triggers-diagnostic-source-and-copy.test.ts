/**
 * Architecture invariant — Slice 4.5.B.α₂.1 (2026-05-19):
 * recommendation-triggers diagnostic source + copy guards.
 *
 * The operator-only `/diagnostics/recommendation-triggers` page
 * is the validation surface for every Section-4.5 trigger
 * predicate. Two regression failure modes were observed in
 * production after α₂ landed:
 *
 *   1. SOURCE drift — the α₀ loader reached for the file-only
 *      boundary `@/domains/pages/snapshot-store::getPageSnapshots`
 *      which reads `.data/page-snapshots.json` from disk. Vercel
 *      lambdas have a read-only FS and the file is gitignored, so
 *      the boundary returned `[]` silently, producing the
 *      misleading "Owned snapshots: 0 / No candidate rows produced"
 *      state operator-observed on production. The correct boundary
 *      is the repository pattern (`@/lib/persistence/repositories
 *      ::getRepository().forTenant(tenantId).getPageSnapshots()`)
 *      which routes to Supabase under `DATA_SOURCE=supabase`
 *      and matches the customer Recommendations pipeline
 *      (`src/domains/recommendations/load-queue.ts:287`).
 *
 *   2. COPY drift — the page's prose description was hard-coded
 *      to "Slice 4.5.B.α₀ — operator validation surface for the 2
 *      metadata deterministic trigger predicates." α₁ + α₂ added
 *      5 more predicates without updating the description; the
 *      page kept saying "α₀ / 2 metadata" while the counters
 *      said "Predicates run: 7." Operator triage on production
 *      caught it; the test suite did not.
 *
 * This invariant pins both fixes:
 *
 *   • Loader source: `load-trigger-candidates-for-tenant.ts`
 *     MUST import `getRepository` from `@/lib/persistence/
 *     repositories` AND MUST NOT import `getPageSnapshots`
 *     from `@/domains/pages/snapshot-store`.
 *
 *   • Page copy: `recommendation-triggers/page.tsx` MUST NOT
 *     contain hardcoded slice-version strings matching
 *     /Slice\s+4\.5\.B\.α/ NOR the literal "2 metadata
 *     deterministic trigger predicates" / "2 metadata
 *     predicates" phrases. The description is instead expected
 *     to interpolate `result.meta.predicates_run` so future
 *     predicate additions surface automatically.
 *
 * Pinned source files:
 *   • `src/domains/recommendation-intelligence/load-trigger-
 *      candidates-for-tenant.ts` (source-boundary check)
 *   • `src/app/(shell)/diagnostics/recommendation-triggers/
 *      page.tsx` (copy-drift check)
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const LOADER_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "load-trigger-candidates-for-tenant.ts",
);

const PAGE_PATH = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "recommendation-triggers",
  "page.tsx",
);

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("recommendation-triggers-diagnostic-source-and-copy", () => {
  // ── Loader source boundary ─────────────────────────────────────────

  it("loader imports getRepository from @/lib/persistence/repositories", () => {
    const src = stripComments(read(LOADER_PATH));
    expect(src).toMatch(
      /import\s*\{[^}]*\bgetRepository\b[^}]*\}\s*from\s*["']@\/lib\/persistence\/repositories["']/,
    );
  });

  it("loader does NOT import getPageSnapshots from @/domains/pages/snapshot-store", () => {
    const src = stripComments(read(LOADER_PATH));
    expect(src).not.toMatch(
      /import\s*\{[^}]*\bgetPageSnapshots\b[^}]*\}\s*from\s*["']@\/domains\/pages\/snapshot-store["']/,
    );
  });

  it("loader does NOT call getPageSnapshots() directly (only via the repository pattern)", () => {
    const src = stripComments(read(LOADER_PATH));
    // The file-only boundary's call shape is bare `getPageSnapshots(`.
    // The repository's call shape is `.getPageSnapshots(` (a method
    // on the repo handle). Match the bare form only.
    expect(src).not.toMatch(/(?<![.\w])getPageSnapshots\s*\(/);
  });

  // ── Page copy slice-version drift guards ───────────────────────────

  it("page source does NOT contain a hardcoded 'Slice 4.5.B.α' literal in JSX prose", () => {
    const src = stripComments(read(PAGE_PATH));
    // Match any α-suffixed slice version: α₀ / α₁ / α₂ / α₂.1 / α etc.
    // Forbidding the literal forces future slice additions to land
    // matching copy refreshes (or to use the dynamic interpolation
    // already in place via result.meta.predicates_run).
    expect(src).not.toMatch(/Slice\s+4\.5\.B\.α/);
  });

  it("page source does NOT contain the legacy '2 metadata' phrases", () => {
    const src = stripComments(read(PAGE_PATH));
    expect(src).not.toContain("2 metadata deterministic trigger predicates");
    expect(src).not.toContain("2 metadata predicates");
  });

  it("page source interpolates result.meta.predicates_run in the description", () => {
    const src = stripComments(read(PAGE_PATH));
    // The page must reference the loader meta field by name so the
    // description self-updates as predicates land. Static-only
    // counts in the description body are forbidden by the
    // slice-version test above.
    expect(src).toContain("result.meta.predicates_run");
  });

  // ── Slice 4.5.C.α₂ diagnostic-only bucket contract ─────────────────

  it("(4.5.C.α₂) page source renders the diagnostic-only section so low-confidence Tier-2 candidates stay operator-visible", () => {
    const src = stripComments(read(PAGE_PATH));
    // The page MUST render a section with
    // data-diagnostic-section="diagnostic-only" — otherwise
    // Tier-2 sensitive predicates (which emit at
    // confidence: "low" and route to result.diagnostic_only via
    // applyQueueRules) would never appear on the operator
    // diagnostic surface.
    expect(src).toContain('data-diagnostic-section="diagnostic-only"');
    // The page MUST reference result.diagnostic_only (not just
    // result.candidates) — otherwise the bucket is dropped.
    expect(src).toContain("result.diagnostic_only");
    // The page MUST expose the diagnostic_only_count counter
    // alongside candidate_count so the operator can see the
    // bucket size at a glance.
    expect(src).toContain('data-counter="diagnostic_only_count"');
  });

  it("(4.5.C.α₂) page source includes the operator-locked diagnostic-only header copy", () => {
    const src = stripComments(read(PAGE_PATH));
    expect(src).toContain("Diagnostic-only signals (low-confidence)");
  });
});
