import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Sprint 4 / Phase 4.9 regression tests — canonical-store fresh-per-render.
//
// The module-level arrays in src/storage/canonical-store.ts are seeded
// exactly once per Vercel lambda behind `_canonSeeded`. After the 07:00 UTC
// poll writes fresh observations/snapshots to Supabase, already-warm
// lambdas kept serving yesterday's data for Today, Recommendations,
// Prompts, Prompt-detail, Settings/prompts.
//
// Phase 4.9 adds `loadFreshCanonicalData()` — a Supabase-bypass helper
// that pulls all four canonical tables fresh every render. Render paths
// use it; non-render consumers (prompt-library, url-citation-history,
// poll pipeline) still read the module-level arrays.
//
// These tests prove:
//   (1) `loadFreshCanonicalData` fetches all four tables fresh via the
//       repository abstraction (bypasses `_canonSeeded`)
//   (2) /recommendations source uses it + doesn't import the module
//       arrays directly
//   (3) /prompts source uses it + doesn't import the module arrays
//   (4) /prompts/[id] source uses it
//   (5) /settings/prompts source uses it
//   (6) [retired 2026-07-21, Lane S] the /today section loaders that read
//       the canonical bundle fresh per render (today-v2-data.ts) were dead
//       code and were deleted; NO render path calls loadFreshCanonicalData
//       any more, which is pinned as a stronger invariant below and in
//       tests/architecture/13-egress-boundary.test.ts.
// ---------------------------------------------------------------------------

const FILES = {
  canonicalStore: resolve(__dirname, "../../src/storage/canonical-store.ts"),
  recommendations: resolve(
    __dirname,
    "../../src/app/(shell)/recommendations/page.tsx",
  ),
  // Surface-collapse (2026-07-21): the standalone /prompts + /prompts/[id]
  // render paths AND the /settings/prompts management UI were deleted; their
  // fresh-per-render pins went with them. Lane S then deleted the dead
  // today-v2-data.ts loaders; the surviving /today gate loader is pinned below.
  todayGate: resolve(__dirname, "../../src/app/(shell)/today-gate-data.ts"),
};

const SRC = Object.fromEntries(
  Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, "utf8")]),
) as Record<keyof typeof FILES, string>;

describe("Sprint 4 / Phase 4.9 — canonical-store fresh-per-render", () => {
  // The "loadFreshCanonicalData helper" describes were retired 2026-07-21
  // (CORE 100K): the helper was deleted after its last render-time callers
  // died with the today-v2 loader family. The tenant-scoping invariants on
  // the surviving seeding path stay below.

  describe("Sprint 7 Phase 7.5c/2 — canonical-store tenant-scoping invariants", () => {
    const CANONICAL_STORE_PATH = resolve(
      __dirname,
      "../../src/storage/canonical-store.ts",
    );
    const CANONICAL_STORE_SOURCE = readFileSync(CANONICAL_STORE_PATH, "utf8");

    it("Tier A reads (getPromptAnswerObservations + getDailyMetricSnapshots) go through .forTenant(...)", () => {
      // The canonical-store.ts source must contain a `forTenant` chain that
      // covers both Tier A methods. We don't anchor the exact line because
      // the file has 2 functions doing this; we just assert the patterns
      // exist somewhere in the file.
      expect(CANONICAL_STORE_SOURCE).toMatch(
        /tenantRepo\.getPromptAnswerObservations\(/,
      );
      expect(CANONICAL_STORE_SOURCE).toMatch(
        /tenantRepo\.getDailyMetricSnapshots\(/,
      );
      // The construction must come from forTenant.
      expect(CANONICAL_STORE_SOURCE).toMatch(
        /const\s+tenantRepo\s*=\s*repo\.forTenant\(/,
      );
    });

    it("Tier A reads are NEVER called on the unscoped repo (must go through tenantRepo)", () => {
      // The unscoped form on Tier A methods is the leak path. Catches drift.
      expect(CANONICAL_STORE_SOURCE).not.toMatch(
        /\brepo\.getPromptAnswerObservations\(/,
      );
      expect(CANONICAL_STORE_SOURCE).not.toMatch(
        /\brepo\.getDailyMetricSnapshots\(/,
      );
      expect(CANONICAL_STORE_SOURCE).not.toMatch(
        /getRepository\(\)\.getPromptAnswerObservations\(/,
      );
      expect(CANONICAL_STORE_SOURCE).not.toMatch(
        /getRepository\(\)\.getDailyMetricSnapshots\(/,
      );
    });

    it("tracked_prompts + tracked_entities go through the tenant-scoped facade (customer-2 isolation fix, 2026-05-06)", () => {
      // FLIP of the pre-2026-05-06 invariant. Earlier the Phase 7.5a audit
      // claimed tracked_* tables had no tenant_id column and so could only
      // be read unscoped on the plain repo. The 2026-05-06 customer-2
      // onboarding audit re-checked this and found:
      //   - Both stores are TENANT_SCOPED in store-classification.ts.
      //   - Rows on disk carry tenant_id (operator's stamping migration).
      //   - The Supabase schema scopes via account_id (the slug), not
      //     tenant_id. The fix resolves the slug via getTenant(tenantId).
      // Both backends now implement tenant-scoped getTrackedPrompts /
      // getTrackedEntities, and the canonical fresh-load path reads them
      // through tenantRepo to keep customer-2 isolated from Ritz.
      // Sibling guard: tests/architecture/canonical-store-tenant-isolation.test.ts
      expect(CANONICAL_STORE_SOURCE).toMatch(
        /tenantRepo\.getTrackedPrompts\s*\(/,
      );
      expect(CANONICAL_STORE_SOURCE).toMatch(
        /tenantRepo\.getTrackedEntities\s*\(/,
      );
      // Negative invariant: no raw repo.getTracked* in the canonical
      // fresh-load path. Falls back to the architecture-invariant check.
      expect(CANONICAL_STORE_SOURCE).not.toMatch(
        /\brepo\.getTrackedEntities\s*\(/,
      );
      expect(CANONICAL_STORE_SOURCE).not.toMatch(
        /\brepo\.getTrackedPrompts\s*\(/,
      );
    });
  });

  describe("render-path structural invariants", () => {
    it("/recommendations index redirects; the persisted loader never touches the canonical fan-out", () => {
      // Move 5 (2026-07-01): the /recommendations index is now a redirect to
      // /changes?status=ready (a duplicate of the canonical Changes list).
      // CORE 100K Lane A (2026-07-21): the dead in-file LLM queue builder
      // (`loadLiveRecommendationQueue`) was the ONLY load-queue caller of
      // `loadFreshCanonicalData`; it was deleted. The surviving persisted
      // loader reads the tenant repo directly, so the STRONGER guarantee is
      // that load-queue never performs the 4-table canonical fan-out at all
      // (also pinned by tests/architecture/13-egress-boundary).
      expect(SRC.recommendations).toMatch(/\bredirect\(/);
      const loadQueueSrc = readFileSync(
        resolve(
          __dirname,
          "../../src/domains/recommendations/load-queue.ts",
        ),
        "utf8",
      );
      expect(loadQueueSrc).not.toMatch(/loadFreshCanonicalData/);
    });

    // Surface-collapse (2026-07-21): the "/prompts" and "/prompts/[id]"
    // direct-tenant-repo-read pins were removed with those deleted render
    // paths. Their scoped-read perf invariants covered pages that no longer
    // exist; the tenant-repo read patterns they exercised remain pinned by
    // the surviving settings/prompts + today-v2-data assertions here and by
    // tests/architecture/*scoped-reads*.

    it("the /today gate loader never imports canonical-store (statically or dynamically)", () => {
      // Lane S (2026-07-21): the dead today-v2-data.ts section loaders were
      // the LAST render-time callers of `loadFreshCanonicalData`. The
      // surviving gate loader reads only lean tenant-scoped repo projections,
      // so the render path must not regrow a canonical-store dependency.
      expect(SRC.todayGate).not.toMatch(/@\/storage\/canonical-store/);
      expect(SRC.todayGate).not.toMatch(/loadFreshCanonicalData/);
      expect(SRC.recommendations).toMatch(/\bredirect\(/);
    });
  });

  describe("non-render callers preserved", () => {
    it("canonical-store.ts exports cached async getters for non-render consumers", () => {
      // Phase 7.8e-2 (2026-04-26): the module-level mutable-array exports
      // were lifted to cached async getters. Non-render consumers
      // (url-citation-history, import-orchestrator, scanning, etc.) now
      // call `await getX()` instead of importing the array reference.
      expect(SRC.canonicalStore).toMatch(
        /export\s+const\s+getTrackedPrompts\s*=\s*cache\(/,
      );
      expect(SRC.canonicalStore).toMatch(
        /export\s+const\s+getPromptAnswerObservations\s*=\s*cache\(/,
      );
      expect(SRC.canonicalStore).toMatch(
        /export\s+const\s+getTrackedEntities\s*=\s*cache\(/,
      );
      expect(SRC.canonicalStore).toMatch(
        /export\s+const\s+getDailyMetricSnapshots\s*=\s*cache\(/,
      );
    });

    it("canonical-store.ts still exports ensureCanonicalStoresSeeded", () => {
      // Non-render consumers still call this at their boundary. Phase 4.9
      // does NOT deprecate it — the render paths moved to fresh reads,
      // but the seed function is still active for module-array consumers.
      expect(SRC.canonicalStore).toMatch(
        /export\s+async\s+function\s+ensureCanonicalStoresSeeded/,
      );
    });
  });
});
