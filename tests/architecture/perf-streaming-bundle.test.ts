/**
 * Streaming bundle (2026-05-12) — source-level pins for the perceived-
 * speed refactor of /today and /recommendations.
 *
 * Before this bundle, both routes' `page.tsx` files awaited the slow
 * data loader BEFORE returning JSX. Effect: the generic `loading.tsx`
 * showed for the entire data load (cold ~10s for /today; cold ~500ms
 * for /recommendations v2; cold ~30s for /recommendations legacy),
 * then the page snapped to fully-rendered. Users felt "blank waiting"
 * even when the actual data load was fast.
 *
 * Fix: `page.tsx` now returns instantly with a `<Suspense>` boundary
 * around an async server component. The skeleton fallback (Today v2
 * hero/chart/leaderboard/cards layout, Recommendations v2 card stack
 * + working rail layout) shows where the real content will go. Next
 * streams in the real client when the async component resolves.
 *
 * Pinned:
 *   1. `/page.tsx` imports `Suspense` from "react" and renders one.
 *   2. `/page.tsx` does NOT await `loadTodayPageData` at top level —
 *      the await lives inside a nested async server component.
 *   3. `/recommendations/page.tsx` imports `Suspense` and renders one.
 *   4. `/recommendations/page.tsx` does NOT await
 *      `loadPersistedRecommendationQueueForPage` or
 *      `loadLiveRecommendationQueueForPage` at top level.
 *   5. Skeleton components exist + match the layout structure.
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

describe("Streaming bundle: /page.tsx is Suspense-shelled", () => {
  const src = read("src/app/(shell)/page.tsx");
  const stripped = stripComments(src);

  it("imports Suspense from react", () => {
    expect(stripped).toMatch(
      /import\s+\{[\s\S]*?\bSuspense\b[\s\S]*?\}\s+from\s+["']react["']/,
    );
  });

  it("imports SOME skeleton from today-v2-skeleton (legacy OR per-section)", () => {
    // After the section-streaming bundle (2026-05-12), the v2 path
    // imports per-section skeletons (TodayV2VisibilityGroupSkeleton +
    // TodayV2ActionCardsSkeleton + TodayV2DescriptorsSkeleton) instead
    // of the composite TodayV2Skeleton. Either name is acceptable
    // here; what matters is that page.tsx pulls a skeleton from the
    // skeleton module to use as a Suspense fallback.
    expect(stripped).toMatch(
      /import\s+\{[\s\S]*?\bTodayLegacySkeleton\b[\s\S]*?\}\s+from\s+["']\.\/today-v2-skeleton["']/,
    );
    expect(stripped).toMatch(
      /(TodayV2Skeleton|TodayV2VisibilityGroupSkeleton|TodayV2ActionCardsSkeleton|TodayV2DescriptorsSkeleton)/,
    );
  });

  it("renders a <Suspense> with one of the skeletons as fallback", () => {
    expect(stripped).toMatch(
      /<Suspense[\s\S]*?fallback\s*=\s*\{[\s\S]*?(TodayV2Skeleton|TodayV2VisibilityGroupSkeleton|TodayV2ActionCardsSkeleton|TodayV2DescriptorsSkeleton|TodayLegacySkeleton)[\s\S]*?\}[\s\S]*?>/,
    );
  });

  it("the top-level page function does NOT await loadTodayPageData", () => {
    // Scope: the default-exported page function only. The data load
    // should live in a separate async server component nested inside
    // the Suspense boundary.
    const pageFnIdx = stripped.indexOf("export default async function TodayPage");
    expect(pageFnIdx).toBeGreaterThan(-1);
    // Find the next top-level function declaration to scope the body.
    const tail = stripped.slice(pageFnIdx);
    const closingBraceIdx = tail.indexOf("\n}\n");
    expect(closingBraceIdx).toBeGreaterThan(0);
    const pageFnBody = tail.slice(0, closingBraceIdx);
    expect(pageFnBody).not.toMatch(/\bawait\s+loadTodayPageData\(/);
  });

  it("a nested async server component (TodayAsyncContent or similar) DOES await loadTodayPageData", () => {
    // The slow await must live in SOME async function in this file —
    // just not the top-level page export. We look for an `async function`
    // that calls `loadTodayPageData`.
    expect(stripped).toMatch(
      /async\s+function\s+\w+[\s\S]*?await[\s\S]{0,200}loadTodayPageData\(/,
    );
  });
});

describe("Streaming bundle: /recommendations/page.tsx is Suspense-shelled", () => {
  const src = read("src/app/(shell)/recommendations/page.tsx");
  const stripped = stripComments(src);

  it("imports Suspense from react", () => {
    expect(stripped).toMatch(
      /import\s+\{[\s\S]*?\bSuspense\b[\s\S]*?\}\s+from\s+["']react["']/,
    );
  });

  it("imports the RecommendationsV2 + Legacy skeletons", () => {
    expect(stripped).toMatch(
      /import\s+\{[\s\S]*?\bRecommendationsV2Skeleton\b[\s\S]*?\bRecommendationsLegacySkeleton\b[\s\S]*?\}\s+from\s+["']\.\/recommendations-v2-skeleton["']/,
    );
  });

  it("renders a <Suspense> with one of the skeletons as fallback", () => {
    expect(stripped).toMatch(
      /<Suspense[\s\S]*?fallback\s*=\s*\{[\s\S]*?(RecommendationsV2Skeleton|RecommendationsLegacySkeleton)[\s\S]*?\}[\s\S]*?>/,
    );
  });

  it("the top-level page function does NOT await either loader", () => {
    const pageFnIdx = stripped.indexOf(
      "export default async function RecommendationsPage",
    );
    expect(pageFnIdx).toBeGreaterThan(-1);
    const tail = stripped.slice(pageFnIdx);
    const closingBraceIdx = tail.indexOf("\n}\n");
    expect(closingBraceIdx).toBeGreaterThan(0);
    const pageFnBody = tail.slice(0, closingBraceIdx);
    expect(pageFnBody).not.toMatch(/\bawait\s+loadPersistedRecommendationQueueForPage\(/);
    expect(pageFnBody).not.toMatch(/\bawait\s+loadLiveRecommendationQueueForPage\(/);
  });

  it("a nested async server component DOES await one of the loaders", () => {
    expect(stripped).toMatch(
      /async\s+function\s+\w+[\s\S]*?await[\s\S]{0,400}(loadPersistedRecommendationQueueForPage|loadLiveRecommendationQueueForPage)\(/,
    );
  });

  it("preserves the v2/legacy switching contract", () => {
    // Both ?legacy=1 + ?v2=1 escape hatches must still be reachable
    // through the same shouldUseRecommendationsV2 helper.
    expect(stripped).toMatch(/shouldUseRecommendationsV2/);
  });
});

describe("Streaming bundle: skeleton components exist + sketch the layout", () => {
  it("today-v2-skeleton.tsx exports TodayV2Skeleton + TodayLegacySkeleton", () => {
    const src = read("src/app/(shell)/today-v2-skeleton.tsx");
    expect(src).toMatch(/export\s+function\s+TodayV2Skeleton\b/);
    expect(src).toMatch(/export\s+function\s+TodayLegacySkeleton\b/);
  });

  it("TodayV2Skeleton sketches hero / trend / leaderboard / 3 cards / descriptors", () => {
    const src = read("src/app/(shell)/today-v2-skeleton.tsx");
    expect(src).toMatch(/data-today-v2-skeleton-section="hero"/);
    expect(src).toMatch(/data-today-v2-skeleton-section="trend"/);
    expect(src).toMatch(/data-today-v2-skeleton-section="leaderboard"/);
    // Three placeholder cards rendered via `[0, 1, 2].map(...)`. We pin
    // the data attribute + the 3-element iteration so a future edit
    // that drops to 1 or 2 cards trips this check.
    expect(src).toMatch(/data-today-v2-skeleton-card/);
    expect(src).toMatch(/\[0,\s*1,\s*2\]\.map/);
    expect(src).toMatch(/data-today-v2-skeleton-section="descriptors"/);
  });

  it("recommendations-v2-skeleton.tsx exports both skeletons", () => {
    const src = read("src/app/(shell)/recommendations/recommendations-v2-skeleton.tsx");
    expect(src).toMatch(/export\s+function\s+RecommendationsV2Skeleton\b/);
    expect(src).toMatch(/export\s+function\s+RecommendationsLegacySkeleton\b/);
  });

  it("RecommendationsV2Skeleton sketches header / suggested stack / working rail", () => {
    const src = read("src/app/(shell)/recommendations/recommendations-v2-skeleton.tsx");
    expect(src).toMatch(/data-recommendations-v2-skeleton="true"/);
    expect(src).toMatch(/data-recommendations-v2-skeleton-section="suggested"/);
    expect(src).toMatch(/data-recommendations-v2-skeleton-section="working"/);
    // 5 placeholder cards (rendered via `[0, 1, 2, 3, 4].map(...)`).
    expect(src).toMatch(/data-recommendations-v2-skeleton-card/);
    expect(src).toMatch(/\[0,\s*1,\s*2,\s*3,\s*4\]\.map/);
  });

  it("skeletons render the aria-busy hint so screen readers know it's loading", () => {
    const today = read("src/app/(shell)/today-v2-skeleton.tsx");
    const recs = read("src/app/(shell)/recommendations/recommendations-v2-skeleton.tsx");
    expect(today).toMatch(/aria-busy="true"/);
    expect(recs).toMatch(/aria-busy="true"/);
  });
});
