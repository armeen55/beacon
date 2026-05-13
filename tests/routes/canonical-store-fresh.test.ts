import { describe, it, expect, vi, beforeEach } from "vitest";
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
//   (6) today-data.ts source uses it + removed the dynamic imports that
//       previously shadowed the module arrays
// ---------------------------------------------------------------------------

const FILES = {
  canonicalStore: resolve(__dirname, "../../src/storage/canonical-store.ts"),
  recommendations: resolve(
    __dirname,
    "../../src/app/(shell)/recommendations/page.tsx",
  ),
  prompts: resolve(__dirname, "../../src/app/(shell)/prompts/page.tsx"),
  promptDetail: resolve(
    __dirname,
    "../../src/app/(shell)/prompts/[id]/page.tsx",
  ),
  settingsPrompts: resolve(
    __dirname,
    "../../src/app/(shell)/settings/prompts/page.tsx",
  ),
  todayData: resolve(__dirname, "../../src/app/(shell)/today-data.ts"),
};

const SRC = Object.fromEntries(
  Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, "utf8")]),
) as Record<keyof typeof FILES, string>;

describe("Sprint 4 / Phase 4.9 — canonical-store fresh-per-render", () => {
  describe("loadFreshCanonicalData helper", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("fetches all four canonical tables fresh from the repository", async () => {
      const getTrackedPrompts = vi.fn(async () => [
        { id: "p-1", text: "test prompt", is_active: true } as never,
      ]);
      const getPromptAnswerObservations = vi.fn(async () => [
        { id: "o-1", prompt_id: "p-1", observed_at: "2026-04-24T10:00:00Z" } as never,
      ]);
      const getTrackedEntities = vi.fn(async () => [
        { id: "e-1", name: "Ritz Builders" } as never,
      ]);
      const getDailyMetricSnapshots = vi.fn(async () => [
        { id: "s-1", date: "2026-04-24" } as never,
      ]);

      // Sprint 7 Phase 7.5c/2 (2026-04-25) — `loadFreshCanonicalData` now
      // calls Tier A reads via `getRepository().forTenant(tenantId).getX()`.
      // Self-referential mock returns the same repo from `forTenant` so
      // overrides apply to both call shapes.
      vi.doMock("@/lib/persistence/repositories", () => {
        const repo = {
          getTrackedPrompts,
          getPromptAnswerObservations,
          getTrackedEntities,
          getDailyMetricSnapshots,
          forTenant: (_tenantId: string) => repo,
        };
        return { getRepository: () => repo };
      });
      vi.doMock("@/lib/tenant-context", () => ({
        currentTenantId: async () => "tenant-ritz-founder",
        currentTenantSlug: async () => "ritz-builders",
      }));

      const { loadFreshCanonicalData } = await import(
        "@/storage/canonical-store"
      );
      const data = await loadFreshCanonicalData();

      expect(getTrackedPrompts).toHaveBeenCalledTimes(1);
      expect(getPromptAnswerObservations).toHaveBeenCalledTimes(1);
      expect(getTrackedEntities).toHaveBeenCalledTimes(1);
      expect(getDailyMetricSnapshots).toHaveBeenCalledTimes(1);
      expect(data.trackedPrompts).toHaveLength(1);
      expect(data.promptAnswerObservations).toHaveLength(1);
      expect(data.trackedEntities).toHaveLength(1);
      expect(data.dailyMetricSnapshots).toHaveLength(1);
    });

    it("each call triggers a fresh fetch — bypasses the _canonSeeded cache", async () => {
      const getTrackedPrompts = vi.fn(async () => []);
      const getPromptAnswerObservations = vi.fn(async () => []);
      const getTrackedEntities = vi.fn(async () => []);
      const getDailyMetricSnapshots = vi.fn(async () => []);

      // Sprint 7 Phase 7.5c/2 (2026-04-25) — `loadFreshCanonicalData` now
      // calls Tier A reads via `getRepository().forTenant(tenantId).getX()`.
      // Self-referential mock returns the same repo from `forTenant` so
      // overrides apply to both call shapes.
      vi.doMock("@/lib/persistence/repositories", () => {
        const repo = {
          getTrackedPrompts,
          getPromptAnswerObservations,
          getTrackedEntities,
          getDailyMetricSnapshots,
          forTenant: (_tenantId: string) => repo,
        };
        return { getRepository: () => repo };
      });
      vi.doMock("@/lib/tenant-context", () => ({
        currentTenantId: async () => "tenant-ritz-founder",
        currentTenantSlug: async () => "ritz-builders",
      }));

      const { loadFreshCanonicalData } = await import(
        "@/storage/canonical-store"
      );
      await loadFreshCanonicalData();
      await loadFreshCanonicalData();
      await loadFreshCanonicalData();

      // Three calls → three actual Supabase round-trips. No request-level
      // cache, no `_canonSeeded`-style one-shot. This is the whole point
      // of the helper — cross-lambda freshness trumps in-process caching.
      expect(getTrackedPrompts).toHaveBeenCalledTimes(3);
      expect(getPromptAnswerObservations).toHaveBeenCalledTimes(3);
      expect(getTrackedEntities).toHaveBeenCalledTimes(3);
      expect(getDailyMetricSnapshots).toHaveBeenCalledTimes(3);
    });
  });

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
    it("/recommendations delegates canonical-store reads via loadLiveRecommendationQueue (Phase 14 extract)", () => {
      // Sprint 6A.1 Phase 14 (2026-04-24): the page no longer imports
      // canonical-store directly — orchestration moved to
      // `src/domains/recommendations/load-queue.ts`. The Sprint 4
      // contract is preserved one layer down: `loadLiveRecommendationQueue`
      // calls `loadFreshCanonicalData` and the page calls
      // `loadLiveRecommendationQueue`.
      expect(SRC.recommendations).toMatch(/\bloadLiveRecommendationQueue\b/);
      expect(SRC.recommendations).not.toMatch(
        /\b(?:trackedPrompts|promptAnswerObservations|trackedEntities|dailyMetricSnapshots)\b\s*=/,
      );
      const loadQueueSrc = readFileSync(
        resolve(
          __dirname,
          "../../src/domains/recommendations/load-queue.ts",
        ),
        "utf8",
      );
      expect(loadQueueSrc).toMatch(
        /import\s+\{[^}]*loadFreshCanonicalData[^}]*\}\s+from\s+["']@\/storage\/canonical-store["']/,
      );
      // EGRESS-P0 (2026-05-07): load-queue now passes
      // `{ observationsSince, snapshotsSince }`. Loosen the pin to
      // accept any call form (matches the loosening on line ~315).
      expect(loadQueueSrc).toMatch(/loadFreshCanonicalData\(/);
    });

    it("/prompts uses direct tenant-repo reads (emergency P0 2026-05-12)", () => {
      // Emergency P0 fix — `/prompts` no longer reads via
      // `loadFreshCanonicalData` (which fanned out 4 parallel reads
      // including the unused `daily_metric_snapshots`). It reads
      // directly from the tenant repo on a 14-day window. See
      // `tests/architecture/perf-prompts-scoped-reads.test.ts` and
      // `tests/architecture/supabase-egress-windowing.test.ts` for
      // the full new-architecture pin.
      const canonImports = SRC.prompts.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/storage\/canonical-store["']/g,
      );
      expect(canonImports).toBeNull();
      expect(SRC.prompts).toMatch(
        /from\s+["']@\/lib\/persistence\/repositories["']/,
      );
      expect(SRC.prompts).toMatch(/tenantRepo\.getTrackedPrompts\(\)/);
    });

    it("/prompts/[id] uses prompt-scoped tenant-repo reads (emergency P0 2026-05-12)", () => {
      // Emergency P0 fix — `/prompts/[id]` no longer reads via
      // `loadFreshCanonicalData`. It pushes `prompt_id = $1` down
      // to Postgres via the tenant-repo's new `promptId` option, so
      // the row count crossing the wire drops from ~15k to <500.
      const canonImports = SRC.promptDetail.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/storage\/canonical-store["']/g,
      );
      expect(canonImports).toBeNull();
      expect(SRC.promptDetail).toMatch(
        /from\s+["']@\/lib\/persistence\/repositories["']/,
      );
      expect(SRC.promptDetail).toMatch(
        /tenantRepo\.getPromptAnswerObservations\(\s*\{[\s\S]*?promptId/,
      );
    });

    it("/settings/prompts does NOT import canonical-store fan-out APIs (deploy hardening 2026-05-12)", () => {
      // Deploy hardening (2026-05-12) — `/settings/prompts` now reads
      // `tracked_prompts` directly via the tenant repo, skipping the
      // canonical-store fan-out entirely. The page no longer needs to
      // touch the `@/storage/canonical-store` module. Pinned by
      // `tests/architecture/deploy-settings-prompts-dynamic.test.ts`
      // and `tests/architecture/egress-bounded-reads-p0.test.ts`.
      const canonImports = SRC.settingsPrompts.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/storage\/canonical-store["']/g,
      );
      expect(canonImports).toBeNull();
      // Must use the direct tenant-repo reader instead.
      expect(SRC.settingsPrompts).toMatch(
        /from\s+["']@\/lib\/persistence\/repositories["']/,
      );
      expect(SRC.settingsPrompts).toMatch(/\.getTrackedPrompts\(\s*\)/);
    });

    it("today-data.ts imports loadFreshCanonicalData AND does not statically import dailyMetricSnapshots", () => {
      const canonImports = SRC.todayData.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/storage\/canonical-store["']/g,
      );
      expect(canonImports).not.toBeNull();
      const joined = canonImports!.join("\n");
      expect(joined).toMatch(/\bloadFreshCanonicalData\b/);
      expect(joined).not.toMatch(/\bdailyMetricSnapshots\b/);
    });

    it("today-data.ts has NO remaining dynamic imports of canonical-store (all replaced with outer-scope fresh reads)", () => {
      // Dynamic imports like `await import("@/storage/canonical-store")`
      // would shadow the outer fresh locals with stale module references.
      // Must be zero.
      expect(SRC.todayData).not.toMatch(
        /await\s+import\(\s*["']@\/storage\/canonical-store["']\s*\)/,
      );
    });

    it("all five render paths call loadFreshCanonicalData() at render time (directly OR via loadLiveRecommendationQueue)", () => {
      // Phase 14 (2026-04-24): /recommendations no longer calls
      // `loadFreshCanonicalData()` directly — the call moved into
      // `loadLiveRecommendationQueue`.
      //
      // Emergency P0 fix (2026-05-12) — `/prompts` and `/prompts/[id]`
      // were also removed from this list. They now read directly from
      // the tenant repo (with a `since` window + optional `promptId`)
      // because `loadFreshCanonicalData` was a 4-table fan-out costing
      // 8-11 s in production for routes that only needed observations.
      // See `tests/architecture/perf-prompts-scoped-reads.test.ts` for
      // the new-architecture pin.
      //
      // Only today-data.ts still calls `loadFreshCanonicalData` at
      // render time (it consumes all four canonical tables).
      const directTargets = [
        { name: "today-data.ts", src: SRC.todayData },
      ];
      for (const { name, src } of directTargets) {
        expect(src, `${name} must call loadFreshCanonicalData()`).toMatch(
          /loadFreshCanonicalData\(/,
        );
      }
      // /recommendations: page must call loadLiveRecommendationQueue,
      // and load-queue.ts must call loadFreshCanonicalData.
      // Sprint 7 Phase 7.3: page now passes `{ tenantId }`; relaxed
      // from empty-parens to any call form.
      // EGRESS-P0 (2026-05-07): load-queue now passes
      // `{ observationsSince, snapshotsSince }` to bound the read.
      // Loosen this assertion the same way the others were already
      // loosened — accept any call form, not just empty parens.
      expect(SRC.recommendations).toMatch(/loadLiveRecommendationQueue\(/);
      const loadQueueSrc = readFileSync(
        resolve(
          __dirname,
          "../../src/domains/recommendations/load-queue.ts",
        ),
        "utf8",
      );
      expect(loadQueueSrc).toMatch(/loadFreshCanonicalData\(/);
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
