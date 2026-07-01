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

  it("defines an inline CockpitSkeleton loading fallback", () => {
    // Move 5 (2026-07-01): Today is a thin CanonicalChange read model, so its
    // loading fallback is an inline `CockpitSkeleton` component rather than the
    // deleted `today-v2-skeleton` module. The streaming invariant is unchanged —
    // the shell still returns instantly with an accessible skeleton.
    expect(stripped).toMatch(/function\s+CockpitSkeleton\b/);
    expect(stripped).toMatch(/aria-busy="true"/);
  });

  it("renders a <Suspense> with the skeleton as fallback", () => {
    expect(stripped).toMatch(
      /<Suspense[\s\S]*?fallback\s*=\s*\{[\s\S]*?CockpitSkeleton[\s\S]*?\}[\s\S]*?>/,
    );
  });

  it("the top-level page function does NOT await the gate loader", () => {
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
    expect(pageFnBody).not.toMatch(/\bawait\s+loadTodayV2GateData\(/);
  });

  it("a nested async server component (TodayV2SectionedContent) DOES await the gate loader", () => {
    // Surface collapse (2026-06-15): /today is V2-only. The slow await
    // lives in the V2 sectioned content (`loadTodayV2GateData`), not the
    // top-level page export. (The legacy `loadTodayPageData` await was
    // removed with the legacy client; the V2 sections still consume the
    // shared loader internally via today-v2-data.)
    expect(stripped).toMatch(
      /async\s+function\s+\w+[\s\S]*?await[\s\S]{0,200}loadTodayV2GateData\(/,
    );
  });
});

// Move 5 (2026-07-01) consolidation: /recommendations + /experiments were
// duplicate lists of the same prepared/ready moves the canonical Changes list
// (/worklist) already shows, so /recommendations/page.tsx is now a thin
// redirect to /worklist?status=ready. A redirect has no loader + no skeleton to
// stream, so the old streaming/skeleton pins for it are obsolete. The canonical
// worklist surface owns the streamed queue now; we pin the redirect instead.
describe("Streaming bundle: /recommendations/page.tsx is a redirect (consolidated)", () => {
  const src = read("src/app/(shell)/recommendations/page.tsx");
  const stripped = stripComments(src);

  it("redirects to the canonical Changes surface", () => {
    expect(stripped).toMatch(/import\s+\{[\s\S]*?\bredirect\b[\s\S]*?\}\s+from\s+["']next\/navigation["']/);
    expect(stripped).toMatch(/\bredirect\(/);
    expect(stripped).toMatch(/\/worklist\?status=ready/);
  });

  it("does not await a recommendations queue loader (nothing to stream)", () => {
    expect(stripped).not.toMatch(/await\s+loadPersistedRecommendationQueueForPage\(/);
    expect(stripped).not.toMatch(/await\s+loadLiveRecommendationQueueForPage\(/);
  });
});
