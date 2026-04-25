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

      vi.doMock("@/lib/persistence/repositories", () => ({
        getRepository: () => ({
          getTrackedPrompts,
          getPromptAnswerObservations,
          getTrackedEntities,
          getDailyMetricSnapshots,
        }),
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

      vi.doMock("@/lib/persistence/repositories", () => ({
        getRepository: () => ({
          getTrackedPrompts,
          getPromptAnswerObservations,
          getTrackedEntities,
          getDailyMetricSnapshots,
        }),
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
      expect(loadQueueSrc).toMatch(/loadFreshCanonicalData\(\s*\)/);
    });

    it("/prompts imports loadFreshCanonicalData AND does not import the module arrays", () => {
      const canonImports = SRC.prompts.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/storage\/canonical-store["']/g,
      );
      expect(canonImports).not.toBeNull();
      const joined = canonImports!.join("\n");
      expect(joined).toMatch(/\bloadFreshCanonicalData\b/);
      expect(joined).not.toMatch(
        /\b(?:trackedPrompts|promptAnswerObservations|trackedEntities)\b/,
      );
    });

    it("/prompts/[id] imports loadFreshCanonicalData AND does not import the module arrays", () => {
      const canonImports = SRC.promptDetail.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/storage\/canonical-store["']/g,
      );
      expect(canonImports).not.toBeNull();
      const joined = canonImports!.join("\n");
      expect(joined).toMatch(/\bloadFreshCanonicalData\b/);
      expect(joined).not.toMatch(
        /\b(?:trackedPrompts|promptAnswerObservations|trackedEntities)\b/,
      );
    });

    it("/settings/prompts imports loadFreshCanonicalData AND does not import trackedPrompts", () => {
      const canonImports = SRC.settingsPrompts.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/storage\/canonical-store["']/g,
      );
      expect(canonImports).not.toBeNull();
      const joined = canonImports!.join("\n");
      expect(joined).toMatch(/\bloadFreshCanonicalData\b/);
      expect(joined).not.toMatch(/\btrackedPrompts\b/);
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
      // `loadLiveRecommendationQueue`. The other four render paths
      // still call it directly.
      const directTargets = [
        { name: "/prompts", src: SRC.prompts },
        { name: "/prompts/[id]", src: SRC.promptDetail },
        { name: "/settings/prompts", src: SRC.settingsPrompts },
        { name: "today-data.ts", src: SRC.todayData },
      ];
      for (const { name, src } of directTargets) {
        expect(src, `${name} must call loadFreshCanonicalData()`).toMatch(
          /loadFreshCanonicalData\(\s*\)/,
        );
      }
      // /recommendations: page must call loadLiveRecommendationQueue,
      // and load-queue.ts must call loadFreshCanonicalData.
      expect(SRC.recommendations).toMatch(
        /loadLiveRecommendationQueue\(\s*\)/,
      );
      const loadQueueSrc = readFileSync(
        resolve(
          __dirname,
          "../../src/domains/recommendations/load-queue.ts",
        ),
        "utf8",
      );
      expect(loadQueueSrc).toMatch(/loadFreshCanonicalData\(\s*\)/);
    });
  });

  describe("non-render callers preserved", () => {
    it("canonical-store.ts still exports module-level arrays for non-render consumers", () => {
      // prompt-library, url-citation-history, poll pipeline, import-orchestrator,
      // build-from-observations, and orchestrate-scan all read these.
      // Phase 4.9 must NOT remove the exports — only render paths migrate.
      expect(SRC.canonicalStore).toMatch(
        /export\s+const\s+trackedPrompts\s*:\s*TrackedPrompt\[\]/,
      );
      expect(SRC.canonicalStore).toMatch(
        /export\s+const\s+promptAnswerObservations\s*:/,
      );
      expect(SRC.canonicalStore).toMatch(
        /export\s+const\s+trackedEntities\s*:/,
      );
      expect(SRC.canonicalStore).toMatch(
        /export\s+const\s+dailyMetricSnapshots\s*:/,
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
