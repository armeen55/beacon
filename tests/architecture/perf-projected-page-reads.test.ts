/**
 * Perf+egress bundle 2 (2026-05-12) — column projection for page reads.
 *
 * Pins the additive `getPageSummaries` projection that lets routes
 * which only need (id, url, canonical_url, is_owned, page_type,
 * primary_topic, tenant_id) skip the full ~20-field PageEntity
 * payload. The first migrated customer call site is the legacy
 * branch on `/changes/[id]` (only id + url are read).
 *
 * The full-payload `getOwnedPages` reader stays alive — most
 * consumers (today-data → recommendation engine, recommendation
 * generation, attribution candidates, competitors/diagnostics)
 * legitimately need the full row.
 *
 * Source-level checks — they survive JSX refactors and don't need
 * to run with Supabase credentials.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Projected page reads: PageSummary type", () => {
  const src = read("src/domains/pages/types.ts");

  it("exports a narrow PageSummary type with the projected fields", () => {
    expect(src).toMatch(/export\s+type\s+PageSummary\s*=\s*\{/);
    // Pin each projected field individually so a future refactor
    // that drops one doesn't slip past the contract.
    expect(src).toMatch(/PageSummary\s*=\s*\{[\s\S]*?\bid:\s*string/);
    expect(src).toMatch(/PageSummary\s*=\s*\{[\s\S]*?\burl:\s*string/);
    expect(src).toMatch(
      /PageSummary\s*=\s*\{[\s\S]*?\bcanonical_url:\s*string/,
    );
    expect(src).toMatch(/PageSummary\s*=\s*\{[\s\S]*?\bis_owned:\s*boolean/);
    expect(src).toMatch(/PageSummary\s*=\s*\{[\s\S]*?\bpage_type:\s*PageType/);
    expect(src).toMatch(
      /PageSummary\s*=\s*\{[\s\S]*?\bprimary_topic:\s*string\s*\|\s*null/,
    );
    // tenant_id is REQUIRED on the summary — the file-backend's
    // in-memory filterByTenantId predicate keys on it, and removing
    // it would silently break multi-tenant correctness in tests/dev.
    expect(src).toMatch(/PageSummary\s*=\s*\{[\s\S]*?\btenant_id:\s*string/);
  });
});

describe("Projected page reads: Supabase backend projection", () => {
  const src = read("src/lib/persistence/repositories/supabase-backend.ts");

  it("pins PAGE_SUMMARY_COLUMNS to exactly the 7 projected columns", () => {
    // The Postgres-side projection is the egress lever. Pin the
    // exact column list so a future "let me also grab metadata"
    // edit shows up as a test failure.
    expect(src).toMatch(
      /const\s+PAGE_SUMMARY_COLUMNS\s*=\s*"id, url, canonical_url, is_owned, page_type, topics, tenant_id"/,
    );
  });

  it("never selects '*' or fetches the full PageEntity payload via the summaries path", () => {
    const stripped = stripComments(src);
    // Within both helpers, the .select call must use the pinned
    // column constant — never '*' and never an inline column list.
    expect(stripped).toMatch(
      /async\s+function\s+queryPageSummariesUnscoped[\s\S]*?\.select\(\s*PAGE_SUMMARY_COLUMNS\s*\)/,
    );
    expect(stripped).toMatch(
      /async\s+function\s+queryPageSummariesScoped[\s\S]*?\.select\(\s*PAGE_SUMMARY_COLUMNS\s*\)/,
    );
  });

  it("scoped helper filters by tenant_id (multi-tenant correctness)", () => {
    expect(src).toMatch(
      /async\s+function\s+queryPageSummariesScoped\([\s\S]*?\.eq\(\s*"tenant_id"\s*,\s*tenantId\s*\)/,
    );
  });

  it("base backend wires getPageSummaries to the unscoped helper", () => {
    expect(src).toMatch(
      /getPageSummaries:\s*\(\)\s*=>\s*queryPageSummariesUnscoped\(\)/,
    );
  });

  it("tenant-scoped backend wires getPageSummaries to the scoped helper", () => {
    expect(src).toMatch(
      /getPageSummaries:\s*\(\)\s*=>\s*queryPageSummariesScoped\(tenantId\)/,
    );
  });

  it("both helpers log egress with row counts (observability preserved)", () => {
    // Pre-bundle every page read logged egress; the projection
    // path must do the same so we can see the savings.
    const stripped = stripComments(src);
    expect(stripped).toMatch(
      /async\s+function\s+queryPageSummariesUnscoped[\s\S]*?logEgress\(\s*\{[\s\S]*?table:\s*"pages\[summaries-paged\]"/,
    );
    expect(stripped).toMatch(
      /async\s+function\s+queryPageSummariesScoped[\s\S]*?logEgress\(\s*\{[\s\S]*?tenantId/,
    );
  });
});

describe("Projected page reads: file backend + tenant-repo wrapper", () => {
  const fileBackend = read(
    "src/lib/persistence/repositories/file-backend.ts",
  );
  const tenantRepo = read("src/lib/persistence/repositories/tenant-repo.ts");

  it("file backend implements getPageSummaries by projecting in-memory", () => {
    // File backend reads the full PageEntity from disk (arrays are
    // hot in process anyway) then projects at the boundary so
    // callers see the same PageSummary shape both backends expose.
    expect(fileBackend).toMatch(
      /getPageSummaries:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?readStore<PageEntity>\(\s*"pages"\s*\)[\s\S]*?map\(\s*\(p\)[\s\S]*?=>\s*\(\{[\s\S]*?primary_topic:\s*p\.topics\.length\s*>\s*0\s*\?\s*p\.topics\[0\]\s*:\s*null/,
    );
  });

  it("tenant-repo wrapper threads getPageSummaries through filterByTenantId", () => {
    expect(tenantRepo).toMatch(
      /getPageSummaries:\s*async\s*\(\)\s*=>[\s\S]*?filterByTenantId\(\s*await\s+base\.getPageSummaries\(\)\s*,\s*tenantId\s*\)/,
    );
  });
});

describe("Projected page reads: repository interface contract", () => {
  const src = read("src/lib/persistence/repositories/types.ts");

  it("SeedDataRepository declares getPageSummaries(): Promise<PageSummary[]>", () => {
    expect(src).toMatch(/PageSummary/);
    expect(src).toMatch(
      /getPageSummaries\(\):\s*Promise<\s*PageSummary\[\]\s*>/,
    );
  });

  it("getOwnedPages stays on the interface (full-payload consumers preserved)", () => {
    // Negative pin: the bundle must not have removed the full
    // reader — recommendation engine, attribution candidates,
    // and competitor/diagnostics paths all need the full row.
    expect(src).toMatch(/getPages\(\):\s*Promise<\s*PageEntity\[\]\s*>/);
  });
});

describe("Projected page reads: page-store cached helper", () => {
  const src = read("src/domains/pages/page-store.ts");

  it("exports getOwnedPageSummaries wrapped in React.cache", () => {
    expect(src).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
    expect(src).toMatch(
      /export\s+const\s+getOwnedPageSummaries\s*=\s*cache\(\s*async\s*\(\s*\)\s*:\s*Promise<PageSummary\[\]>\s*=>/,
    );
  });

  it("resolves currentTenantId INSIDE the cached body (tenant-safe)", () => {
    // React.cache is per-request. Resolving tenantId at module
    // init (top-level await) would freeze the first-import tenant
    // into a global — the exact bug Sprint 7.5c/3 fixed for
    // getOwnedPages.
    //
    // Pin the call shape: `getOwnedPageSummaries = cache(...)` and
    // somewhere inside that block, `currentTenantId()` is awaited.
    // Don't pin the exact closing punctuation — prettier rewraps it.
    expect(src).toMatch(
      /getOwnedPageSummaries\s*=\s*cache\(\s*async[\s\S]*?await\s+currentTenantId\(\)/,
    );
    const stripped = stripComments(src);
    // No module-level top-level await of currentTenantId — that
    // would freeze the first-import tenant into a global.
    expect(stripped).not.toMatch(
      /^const\s+\w*Tenant\w*\s*=\s*await\s+currentTenantId/m,
    );
  });

  it("getOwnedPages remains exported for full-payload consumers", () => {
    // The bundle is additive — removing getOwnedPages would break
    // today-data, recommendations load-queue, attribution
    // candidates, competitors, diagnostics, and the rec engine.
    expect(src).toMatch(
      /export\s+const\s+getOwnedPages\s*=\s*cache\(\s*async\s*\(\s*\)\s*:\s*Promise<PageEntity\[\]>\s*=>/,
    );
  });
});

describe("Projected page reads: migrated call site /changes/[id]", () => {
  const src = read("src/app/(shell)/changes/[id]/page.tsx");

  it("imports getOwnedPageSummaries (the projected helper)", () => {
    expect(src).toMatch(
      /import\s*\{\s*getOwnedPageSummaries\s*\}\s*from\s*["']@\/domains\/pages\/page-store["']/,
    );
  });

  it("no longer imports getOwnedPages on this route (single migrated site)", () => {
    // Negative pin: if a future edit re-introduces getOwnedPages
    // here, this test fails so the author has to justify the full
    // payload (today-data, rec engine, etc. genuinely need it;
    // this route does not).
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(
      /import\s*\{\s*getOwnedPages\s*\}\s*from\s*["']@\/domains\/pages\/page-store["']/,
    );
    expect(stripped).not.toMatch(/\bawait\s+getOwnedPages\(\)/);
  });

  it("calls getOwnedPageSummaries() exactly once for the url→id map", () => {
    expect(src).toMatch(/const\s+allPages\s*=\s*await\s+getOwnedPageSummaries\(\)/);
  });
});
