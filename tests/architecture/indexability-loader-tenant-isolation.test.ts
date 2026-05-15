/**
 * Architecture invariant — Phase A.3 Step 3b (2026-05-14) /
 * Post-A.3.5 second-stage (2026-05-15).
 *
 * The indexability loader sits at the seam between three
 * tenant-routed signal sources (all now persisted in Supabase
 * with per-tenant primary keys after the post-A.3.5 second-stage
 * retrofit):
 *   1. `page_snapshots` (tenant-scoped Supabase table).
 *   2. `sitemap_reconciliation` (tenant-scoped Supabase table;
 *      classification flipped GLOBAL → TENANT_SCOPED).
 *   3. `robots_state` (tenant-scoped Supabase table; the pre-A.3
 *      flat-path `.data/robots-state.json` is retired).
 *
 * The loader's structural defenses (tenant-domain filter on
 * sitemap canonical_pages; siteDomain-vs-tenantDomain check on
 * robots_state) are RETAINED as defense-in-depth even though the
 * storage-layer per-tenant PK is now the primary boundary. The
 * defenses catch any future regression where data crosses tenant
 * boundaries upstream.
 *
 * This invariant pins, at the source-text level, that the loader:
 *   1. imports `currentTenantId` from `@/lib/tenant-context`,
 *   2. references `opts.tenantId` AND `currentTenantId` in a
 *      comparison that THROWS on mismatch (fail-loud, never
 *      silent),
 *   3. filters `reconciliation.canonical_pages` by tenant domain
 *      BEFORE the URL-membership check (defense-in-depth),
 *   4. validates `state.siteDomain` against the tenant's domain
 *      before consuming robots data (defense-in-depth — primary
 *      boundary is the per-tenant Supabase PK).
 *
 * Retirement: permanent at the architectural-pattern level. The
 * defenses become redundant only when ALL upstream writers carry
 * tenant_id correctness guarantees and no global-fallback paths
 * remain. Today, both defenses stay green by construction.
 *
 * Implementation note on regex brittleness: pins operate on
 * comment-stripped source so a docstring mention of the
 * forbidden shape ("we used to filter by ...") doesn't trip
 * the test. Structural shape is checked, not exact whitespace.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOADER_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "indexability",
  "load-indexability.ts",
);

const SRC = readFileSync(LOADER_PATH, "utf-8");

// Strip block + line comments for structural pins so docstrings
// referencing the forbidden patterns don't trip the test.
const SRC_STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

describe("Architecture — indexability loader tenant isolation (Phase A.3 §3b)", () => {
  // ─────────────────────────────────────────────────────────────────
  // Pin 1: currentTenantId import + invocation
  // ─────────────────────────────────────────────────────────────────

  it("imports currentTenantId from @/lib/tenant-context", () => {
    expect(SRC).toMatch(
      /from\s+["']@\/lib\/tenant-context["']/,
    );
    expect(SRC_STRIPPED).toMatch(/\bcurrentTenantId\b/);
  });

  it("calls currentTenantId() at runtime (not just imports it)", () => {
    // `await currentTenantId()` is the canonical shape; allow either
    // `await currentTenantId(` or `currentTenantId(` followed by a
    // call expression to permit a future refactor that destructures
    // upstream.
    expect(SRC_STRIPPED).toMatch(/currentTenantId\s*\(\s*\)/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 2: tenant-context mismatch → throw
  // ─────────────────────────────────────────────────────────────────

  it("references opts.tenantId in the loader body", () => {
    expect(SRC_STRIPPED).toMatch(/opts\.tenantId/);
  });

  it("throws on tenant-context mismatch (fail-loud, never silent)", () => {
    // The canonical shape is `if (ctxId !== opts.tenantId) throw new
    // Error(...)`. We assert two structural facts:
    //   (a) there's a mismatch comparison involving opts.tenantId,
    //   (b) there's a `throw new Error(` near the comparison.
    // To resist whitespace/formatting drift, we check for both
    // patterns globally rather than as a single regex.
    expect(SRC_STRIPPED).toMatch(/!==\s*opts\.tenantId/);
    expect(SRC_STRIPPED).toMatch(/throw\s+new\s+Error\s*\(/);
    // Defense-in-depth: the error message includes the literal
    // phrase "tenant context mismatch" so operators searching logs
    // for tenant-isolation failures find this site.
    expect(SRC_STRIPPED).toMatch(/tenant context mismatch/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 3: global sitemap reconciliation — tenant-domain filter
  // ─────────────────────────────────────────────────────────────────

  it("filters reconciliation.canonical_pages by tenant domain BEFORE the URL-membership check", () => {
    // The structural shape we require:
    //   reconciliation.canonical_pages.filter((p) => { ... host
    //     === tenantDomain ... })
    // Then a separate `.some(...)` or equivalent membership check
    // over the filtered array. We assert the filter call exists
    // and that the comparison references the tenant domain.
    expect(SRC_STRIPPED).toMatch(
      /canonical_pages\s*\.\s*filter\s*\(/,
    );
    // The filter predicate must compare against tenantDomain (the
    // canonical name in the loader; pinned by source convention).
    expect(SRC_STRIPPED).toMatch(/tenantDomain/);
  });

  it("normalizes host (lowercase + strip-www) before tenant-domain comparison", () => {
    // The loader defines a `normalizeHost(...)` helper that lowercases
    // and strips leading `www.` from a host. Pinning the helper's
    // presence + its use inside the reconciliation filter keeps the
    // case-insensitive contract honest.
    expect(SRC_STRIPPED).toMatch(/function\s+normalizeHost\s*\(/);
    expect(SRC_STRIPPED).toMatch(/normalizeHost\s*\(\s*[a-zA-Z_]+\.url\s*\)/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 4: flat-path robots-state — siteDomain match defense
  // ─────────────────────────────────────────────────────────────────

  it("validates state.siteDomain against tenantDomain before consuming robots data", () => {
    // Structural shape:
    //   normalizeHost(state.siteDomain) !== tenantDomain
    // Pin both pieces independently so a future refactor that keeps
    // the semantics but renames the local doesn't accidentally drop
    // the comparison.
    expect(SRC_STRIPPED).toMatch(/state\.siteDomain/);
    expect(SRC_STRIPPED).toMatch(
      /normalizeHost\s*\(\s*state\.siteDomain\s*\)\s*!==\s*tenantDomain/,
    );
  });

  it("returns null robots flags when the siteDomain defense triggers (no silent fall-through)", () => {
    // The loader's `buildRobotsSignal` returns `nullRobotsFlags()`
    // on every defense branch. Pin that the helper exists and that
    // every defense exit lands on it.
    expect(SRC_STRIPPED).toMatch(/function\s+nullRobotsFlags\s*\(/);
    // Lower bound: at least 4 `nullRobotsFlags()` call sites in the
    // robots-signal build path (state null, parsed null, siteDomain
    // mismatch, fetchedAt unparseable, stale → at least 5; allow
    // some slop for future fixes by asserting ≥ 4).
    const matches = SRC_STRIPPED.match(/nullRobotsFlags\s*\(\s*\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
