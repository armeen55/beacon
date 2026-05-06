/**
 * Architecture invariant — `loadFreshCanonicalData()` must never call
 * the unscoped `repo.getTrackedPrompts()` / `repo.getTrackedEntities()`.
 *
 * Background (operator audit, 2026-05-06): the customer-2 onboarding
 * audit found that `loadFreshCanonicalData()` was reading
 * `tracked_prompts` and `tracked_entities` via the BASE
 * `SeedDataRepository.getTrackedPrompts()` / `.getTrackedEntities()`
 * methods — the unscoped global reads. With customer-2 onboarding
 * imminent, that would silently mix Ritz's prompts + competitors
 * into customer-2's /today leaderboard. Both stores are
 * TENANT_SCOPED in `store-classification.ts`; the schema-level filter
 * column is `account_id` (the slug) on Supabase, and rows on disk
 * already carry `tenant_id` + `account_id` for the file backend.
 *
 * The fix routed both reads through `tenantRepo.forTenant(tenantId)`,
 * adding the two methods to `TenantRepository`. This invariant pins
 * the fix forward — the negative invariant fails the build if a
 * future PR re-introduces an unscoped read in the canonical fresh-
 * load path.
 *
 * SCOPE — what's checked here:
 *   • `src/storage/canonical-store.ts` source: no `repo.getTrackedPrompts(`
 *     or `repo.getTrackedEntities(` outside a `tenantRepo.` chain.
 *   • The two call paths inside `loadFreshCanonicalData` and
 *     `loadFromDiskAndMerge` use `tenantRepo.getTrackedPrompts/Entities`.
 *   • `TenantRepository` interface declares the two methods.
 *   • Both backends (file + supabase) implement them.
 *
 * NOT in scope (separate invariants / tests cover these):
 *   • Behavioral cross-tenant isolation (covered by the sibling
 *     test `tenant-isolation-behavioral.test.ts`).
 *   • Other callers of the unscoped base-repo methods elsewhere in
 *     the codebase (intentional — the canonical fresh-load path is
 *     the one customer-facing surface that mattered for customer-2).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const CANONICAL_STORE_PATH = join(
  REPO_ROOT,
  "src/storage/canonical-store.ts",
);
const REPO_TYPES_PATH = join(
  REPO_ROOT,
  "src/lib/persistence/repositories/types.ts",
);
const TENANT_REPO_PATH = join(
  REPO_ROOT,
  "src/lib/persistence/repositories/tenant-repo.ts",
);
const SUPABASE_BACKEND_PATH = join(
  REPO_ROOT,
  "src/lib/persistence/repositories/supabase-backend.ts",
);

/**
 * Strip TypeScript comments. Order matters: line comments FIRST, then
 * block comments. Otherwise a single-line // comment containing a
 * literal slash-star sequence gets interpreted as a block-comment START
 * by the block regex, consuming code through the next star-slash it
 * finds — which can be hundreds of lines later. The 2026-05-06 audit
 * caught this bug when the Supabase-merge block in canonical-store.ts
 * silently disappeared from the stripped source. Always line-comments
 * first.
 */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const CANONICAL_STORE_CODE = stripComments(
  readFileSync(CANONICAL_STORE_PATH, "utf-8"),
);
const REPO_TYPES_CODE = stripComments(readFileSync(REPO_TYPES_PATH, "utf-8"));
const TENANT_REPO_CODE = stripComments(
  readFileSync(TENANT_REPO_PATH, "utf-8"),
);
const SUPABASE_BACKEND_CODE = stripComments(
  readFileSync(SUPABASE_BACKEND_PATH, "utf-8"),
);

describe("Customer-2 isolation — canonical-store.ts uses tenant-scoped reads", () => {
  it("loadFreshCanonicalData() does NOT call raw repo.getTrackedPrompts()", () => {
    // Negative invariant: bare repo.getTrackedPrompts in this file
    // means an unscoped global read snuck back in. The post-fix shape
    // is tenantRepo.getTrackedPrompts.
    expect(
      /\brepo\.getTrackedPrompts\s*\(/.test(CANONICAL_STORE_CODE),
      "canonical-store.ts must NOT call repo.getTrackedPrompts() — the " +
        "unscoped global read is the customer-2 data-leak path. The " +
        "post-fix shape is tenantRepo.getTrackedPrompts() so each " +
        "tenant gets only its own prompts.",
    ).toBe(false);
  });

  it("loadFreshCanonicalData() does NOT call raw repo.getTrackedEntities()", () => {
    expect(
      /\brepo\.getTrackedEntities\s*\(/.test(CANONICAL_STORE_CODE),
      "canonical-store.ts must NOT call repo.getTrackedEntities() — the " +
        "unscoped global read is the customer-2 data-leak path. The " +
        "post-fix shape is tenantRepo.getTrackedEntities() so each " +
        "tenant gets only its own entities.",
    ).toBe(false);
  });

  it("the canonical fresh-load path uses tenantRepo.getTrackedPrompts()", () => {
    expect(
      /tenantRepo\.getTrackedPrompts\s*\(/.test(CANONICAL_STORE_CODE),
      "canonical-store.ts must call tenantRepo.getTrackedPrompts() in " +
        "the fresh-load path so each tenant's /today leaderboard reads " +
        "only their own prompts.",
    ).toBe(true);
  });

  it("the canonical fresh-load path uses tenantRepo.getTrackedEntities()", () => {
    expect(
      /tenantRepo\.getTrackedEntities\s*\(/.test(CANONICAL_STORE_CODE),
      "canonical-store.ts must call tenantRepo.getTrackedEntities() in " +
        "the fresh-load path so each tenant's competitor list is isolated.",
    ).toBe(true);
  });

  it("BOTH call sites use tenantRepo (Supabase merge + fresh-load)", () => {
    // Two call sites must use the tenant-scoped form: line ~134 inside
    // loadFromDiskAndMerge (Supabase merge path) and line ~301 inside
    // loadFreshCanonicalData. Count occurrences to defend both paths.
    const promptsCalls = (
      CANONICAL_STORE_CODE.match(/tenantRepo\.getTrackedPrompts\s*\(/g) ?? []
    ).length;
    const entitiesCalls = (
      CANONICAL_STORE_CODE.match(/tenantRepo\.getTrackedEntities\s*\(/g) ?? []
    ).length;
    expect(
      promptsCalls,
      "expected at least 2 tenantRepo.getTrackedPrompts() call sites in " +
        "canonical-store.ts (Supabase merge + fresh-load); found " +
        promptsCalls +
        ".",
    ).toBeGreaterThanOrEqual(2);
    expect(
      entitiesCalls,
      "expected at least 2 tenantRepo.getTrackedEntities() call sites in " +
        "canonical-store.ts (Supabase merge + fresh-load); found " +
        entitiesCalls +
        ".",
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("Customer-2 isolation — TenantRepository interface declares tenant-scoped methods", () => {
  it("TenantRepository interface declares getTrackedPrompts(): Promise<TrackedPrompt[]>", () => {
    expect(
      /interface\s+TenantRepository[\s\S]{0,2000}getTrackedPrompts\s*\(\s*\)\s*:\s*Promise<TrackedPrompt\[\]>/.test(
        REPO_TYPES_CODE,
      ),
      "TenantRepository interface must declare getTrackedPrompts() so " +
        "callers get a tenant-scoped read at the type level.",
    ).toBe(true);
  });

  it("TenantRepository interface declares getTrackedEntities(): Promise<TrackedEntity[]>", () => {
    expect(
      /interface\s+TenantRepository[\s\S]{0,2000}getTrackedEntities\s*\(\s*\)\s*:\s*Promise<TrackedEntity\[\]>/.test(
        REPO_TYPES_CODE,
      ),
      "TenantRepository interface must declare getTrackedEntities() so " +
        "callers get a tenant-scoped read at the type level.",
    ).toBe(true);
  });
});

describe("Customer-2 isolation — both backends implement tenant-scoped methods", () => {
  it("file-backend tenant-repo facade implements getTrackedPrompts via filterByTenantId", () => {
    expect(
      /getTrackedPrompts:\s*async\s*\(\)\s*=>\s*\n?\s*filterByTenantId\(\s*await\s+base\.getTrackedPrompts\(\)/.test(
        TENANT_REPO_CODE,
      ),
      "tenant-repo.ts must implement getTrackedPrompts() by calling " +
        "filterByTenantId(await base.getTrackedPrompts(), tenantId). " +
        "Rows on disk carry tenant_id; this works without schema changes.",
    ).toBe(true);
  });

  it("file-backend tenant-repo facade implements getTrackedEntities via filterByTenantId", () => {
    expect(
      /getTrackedEntities:\s*async\s*\(\)\s*=>\s*\n?\s*filterByTenantId\(\s*await\s+base\.getTrackedEntities\(\)/.test(
        TENANT_REPO_CODE,
      ),
      "tenant-repo.ts must implement getTrackedEntities() via filterByTenantId.",
    ).toBe(true);
  });

  it("supabase-backend forTenant block implements getTrackedPrompts via account_id filter", () => {
    // The Supabase schema uses account_id (the slug), NOT tenant_id.
    // The implementation resolves the slug from the tenants registry and
    // filters with .eq("account_id", tenant.slug).
    expect(
      /getTrackedPrompts:[\s\S]{0,500}\.from\(\s*["']tracked_prompts["']\s*\)[\s\S]{0,200}\.eq\(\s*["']account_id["']\s*,\s*tenant\.slug\s*\)/.test(
        SUPABASE_BACKEND_CODE,
      ),
      "supabase-backend.ts forTenant block must implement getTrackedPrompts " +
        "by filtering on account_id = tenant.slug. The 2026-05-06 audit " +
        "verified the Supabase schema uses account_id, not tenant_id, on " +
        "this table.",
    ).toBe(true);
  });

  it("supabase-backend forTenant block implements getTrackedEntities via account_id filter", () => {
    expect(
      /getTrackedEntities:[\s\S]{0,500}\.from\(\s*["']tracked_entities["']\s*\)[\s\S]{0,200}\.eq\(\s*["']account_id["']\s*,\s*tenant\.slug\s*\)/.test(
        SUPABASE_BACKEND_CODE,
      ),
      "supabase-backend.ts forTenant block must implement getTrackedEntities " +
        "by filtering on account_id = tenant.slug.",
    ).toBe(true);
  });

  it("supabase-backend resolves the slug via getTenant(tenantId) before filtering", () => {
    // The slug resolution is the only correct way to map tenant_id → slug
    // for these two tables. Pin the import + the call.
    expect(
      /import\s*\{\s*getTenant\s*\}\s*from\s*["']@\/domains\/tenants\/store["']/.test(
        SUPABASE_BACKEND_CODE,
      ),
      "supabase-backend.ts must import getTenant from @/domains/tenants/store",
    ).toBe(true);
    expect(
      /const\s+tenant\s*=\s*await\s+getTenant\(\s*tenantId\s*\)/.test(
        SUPABASE_BACKEND_CODE,
      ),
      "supabase-backend.ts forTenant block must resolve the tenant slug via " +
        "getTenant(tenantId) before filtering tracked_prompts / tracked_entities.",
    ).toBe(true);
  });

  it("supabase-backend gracefully returns [] for unknown tenant", () => {
    // If getTenant(tenantId) returns null (unknown tenant), the
    // implementation must NOT throw — it returns an empty array,
    // matching the file-backend filterByTenantId behavior.
    expect(
      /if\s*\(\s*!tenant\s*\)[\s\S]{0,80}return\s*\[\]/.test(
        SUPABASE_BACKEND_CODE,
      ),
      "supabase-backend.ts must early-return [] when getTenant(tenantId) " +
        "returns null (unknown tenant). Mirrors the file-backend " +
        "filterByTenantId returning [] for non-existent tenants.",
    ).toBe(true);
  });
});
