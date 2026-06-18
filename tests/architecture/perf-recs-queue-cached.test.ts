/**
 * Emergency P0 v4 (2026-05-12) — source-level pin for the cached
 * `loadLiveRecommendationQueueForPage` wrapper + tag invalidation from
 * every mutation server action.
 *
 * Background: production trace measured `loadLiveRecommendationQueue`
 * at ~33 s cold. The whole pipeline is deterministic per-tenant in
 * mutation-free intervals — wrapping the page-render call in
 * `unstable_cache` with a 60 s TTL + tag `recs-queue:<tenantId>` cuts
 * warm-path render to ~50 ms (cache hit). Mutations call
 * `updateTag(buildRecQueueCacheTag(tenantId))` so accept / defer /
 * dismiss / shipped / restore (undo) propagate immediately — no stale
 * action state.
 *
 * Pinned:
 *   1. `load-queue.ts` exports `loadLiveRecommendationQueueForPage` +
 *      `buildRecQueueCacheTag` and uses `unstable_cache` with the
 *      tag + a finite TTL.
 *   2. Both `/recommendations/page.tsx` and `/recommendations/[id]/page.tsx`
 *      call the cached wrapper, NOT the raw loader.
 *   3. Every mutation in `actions.ts` calls `updateTag(buildRecQueueCacheTag(tenantId))`.
 *   4. The raw `loadLiveRecommendationQueue` is still exported (tests +
 *      CLI use it directly).
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

describe("Emergency P0 v4: /recommendations cached wrapper", () => {
  const loadQueueSrc = read("src/domains/recommendations/load-queue.ts");
  const loadQueueStripped = stripComments(loadQueueSrc);

  it("exports loadLiveRecommendationQueueForPage + buildRecQueueCacheTag", () => {
    expect(loadQueueStripped).toMatch(
      /export\s+async\s+function\s+loadLiveRecommendationQueueForPage\b/,
    );
    expect(loadQueueStripped).toMatch(
      /export\s+function\s+buildRecQueueCacheTag\s*\(\s*tenantId\s*:\s*string\s*\)\s*:\s*string/,
    );
  });

  it("buildRecQueueCacheTag is tenant-scoped (no cross-tenant bleed)", () => {
    expect(loadQueueStripped).toMatch(
      /return\s+`recs-queue:\$\{tenantId\}`/,
    );
  });

  it("wraps the loader with unstable_cache", () => {
    // Don't pin the exact tuple format — but require unstable_cache
    // import + invocation inside the wrapper.
    expect(loadQueueStripped).toMatch(/unstable_cache/);
    // The cache call must include the loader, invoked with tenantId (plus any
    // additional render-only options like leanObservations).
    expect(loadQueueStripped).toMatch(
      /loadLiveRecommendationQueue\(\s*\{[\s\S]*?\btenantId\b/,
    );
  });

  it("cache options include a finite revalidate TTL + the tenant-scoped tag", () => {
    expect(loadQueueStripped).toMatch(/revalidate\s*:\s*REC_QUEUE_CACHE_TTL_SECONDS/);
    // quota/waste pass 2026-06-17: 60s → 1800s idle TTL (operator actions bust
    // the layout cache; the TTL only governs idle auto-refresh of an open tab).
    expect(loadQueueStripped).toMatch(/REC_QUEUE_CACHE_TTL_SECONDS\s*=\s*1800\b/);
    expect(loadQueueStripped).toMatch(/tags\s*:\s*\[\s*buildRecQueueCacheTag\(\s*tenantId\s*\)\s*\]/);
  });

  it("keeps the raw loadLiveRecommendationQueue exported (tests + CLI)", () => {
    expect(loadQueueStripped).toMatch(
      /export\s+async\s+function\s+loadLiveRecommendationQueue\b/,
    );
  });

  it("strips competitorPageSnapshotsByUrl Map for cache serialization safety", () => {
    // Map isn't safe to round-trip through Next's cache; the page
    // doesn't use the Map (only the CLI does). Pin the strip.
    expect(loadQueueStripped).toMatch(
      /competitorPageSnapshotsByUrl\s*:\s*_drop/,
    );
  });
});

describe("Emergency P0 v4/v5: page callers use a cached loader (full OR persisted)", () => {
  // After v4, both callers used loadLiveRecommendationQueueForPage (full
  // pipeline, cached). After v5 (2026-05-12), v2-default callers
  // moved to loadPersistedRecommendationQueueForPage (persisted-only,
  // also cached, much faster cold-path). Either is acceptable here —
  // both are tag-invalidated by mutations via the same buildRecQueueCacheTag.
  it("/recommendations/page.tsx imports + calls SOME cached loader at its v2 loader callsite", () => {
    const src = read("src/app/(shell)/recommendations/page.tsx");
    const stripped = stripComments(src);
    expect(stripped).toMatch(
      /import\s+\{[\s\S]*?\b(loadLiveRecommendationQueueForPage|loadPersistedRecommendationQueueForPage)\b[\s\S]*?\}\s+from\s+["']@\/domains\/recommendations\/load-queue["']/,
    );
    expect(stripped).toMatch(
      /(loadLiveRecommendationQueueForPage|loadPersistedRecommendationQueueForPage)\(\s*\{\s*tenantId\s*\}\s*\)/,
    );
  });

  it("/recommendations/[id]/page.tsx imports + calls SOME cached loader at its loader callsite", () => {
    const src = read("src/app/(shell)/recommendations/[id]/page.tsx");
    const stripped = stripComments(src);
    expect(stripped).toMatch(
      /import\s+\{[\s\S]*?\b(loadLiveRecommendationQueueForPage|loadPersistedRecommendationQueueForPage)\b[\s\S]*?\}\s+from\s+["']@\/domains\/recommendations\/load-queue["']/,
    );
    expect(stripped).toMatch(
      /(loadLiveRecommendationQueueForPage|loadPersistedRecommendationQueueForPage)\(\s*\{\s*tenantId\s*\}\s*\)/,
    );
  });
});

describe("Emergency P0 v4: mutation actions invalidate the cache tag", () => {
  const src = read("src/app/(shell)/recommendations/actions.ts");
  const stripped = stripComments(src);

  it("imports updateTag + buildRecQueueCacheTag", () => {
    expect(stripped).toMatch(/import\s+\{[^}]*\bupdateTag\b[^}]*\}\s+from\s+["']next\/cache["']/);
    expect(stripped).toMatch(/import\s+\{\s*buildRecQueueCacheTag\s*\}\s+from\s+["']@\/domains\/recommendations\/load-queue["']/);
  });

  it("every revalidatePath('/recommendations') call is paired with updateTag(buildRecQueueCacheTag(tenantId))", () => {
    const revalidatePathCount = (
      stripped.match(/revalidatePath\(\s*["']\/recommendations["']/g) ?? []
    ).length;
    const updateTagCount = (
      stripped.match(/updateTag\(\s*buildRecQueueCacheTag\(\s*tenantId\s*\)\s*\)/g) ?? []
    ).length;
    // Every list-page revalidatePath must have a paired cache-tag invalidation.
    expect(revalidatePathCount).toBeGreaterThanOrEqual(5);
    expect(updateTagCount).toBeGreaterThanOrEqual(revalidatePathCount);
  });
});
