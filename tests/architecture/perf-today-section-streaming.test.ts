/**
 * Today section-streaming bundle (2026-05-12) — source-level pins for
 * the per-section streaming refactor of `/page.tsx` v2 path.
 *
 * Before this bundle, the v2 path mounted one Suspense boundary
 * around one async server component that awaited the full
 * `loadTodayPageData()`. Effect: the whole v2 layout waited for the
 * 30-field monolithic loader before any content appeared.
 *
 * After: the v2 path mounts THREE independent Suspense boundaries —
 * Visibility group, Action cards, Descriptors. The descriptors
 * section has its own NARROW loader that bypasses the legacy
 * pipeline; it streams first. The visibility + action cards sections
 * still share `loadTodayPageData()` via React.cache while the heavy
 * extraction is deferred to a follow-up bundle.
 *
 * Pinned:
 *   1. `today-v2-data.ts` exports the gate + section loaders.
 *   2. `today-v2-sections.tsx` exports the three section server
 *      components.
 *   3. `page.tsx` v2 path mounts the gate, then 3 Suspense
 *      boundaries (visibility / action cards / descriptors).
 *   4. The legacy `?legacy=1` path is unchanged single-Suspense.
 *   5. The narrow descriptors loader does NOT call
 *      `loadTodayPageData` — uses domain-level functions directly.
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

describe("Today section streaming: today-v2-data.ts loaders", () => {
  const src = read("src/app/(shell)/today-v2-data.ts");
  const stripped = stripComments(src);

  it("exports loadTodayV2DescriptorsData (narrow loader)", () => {
    expect(stripped).toMatch(
      /export\s+async\s+function\s+loadTodayV2DescriptorsData\b/,
    );
  });

  it("exports loadTodayV2VisibilityData (narrow loader, replaces the shared shape)", () => {
    expect(stripped).toMatch(
      /export\s+async\s+function\s+loadTodayV2VisibilityData\b/,
    );
  });

  it("exports loadTodayV2ActionCardsData (narrow loader, replaces the shared shape)", () => {
    expect(stripped).toMatch(
      /export\s+async\s+function\s+loadTodayV2ActionCardsData\b/,
    );
  });

  it("exports loadTodayV2GateData (cheap demo + firstReading gate)", () => {
    expect(stripped).toMatch(
      /export\s+async\s+function\s+loadTodayV2GateData\b/,
    );
  });

  it("memoizes shared canonical via React.cache", () => {
    expect(stripped).toMatch(/import\s+\{[\s\S]*?\bcache\b[\s\S]*?\}\s+from\s+["']react["']/);
    expect(stripped).toMatch(/export\s+const\s+loadCachedFreshCanonical\s*=\s*cache\(/);
  });

  function scopeBody(src: string, fnName: string): string {
    const start = src.indexOf(`function ${fnName}`);
    if (start < 0) return "";
    const tail = src.slice(start);
    const next = tail.search(/\nexport\s+(async\s+function|function|const|type)\s/);
    return next > 0 ? tail.slice(0, next) : tail;
  }

  it("narrow descriptors loader does NOT call loadTodayPageData", () => {
    const body = scopeBody(stripped, "loadTodayV2DescriptorsData");
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/\bloadTodayPageData\(/);
    expect(body).not.toMatch(/\bloadCachedTodayPageData\(/);
  });

  it("narrow visibility loader does NOT call loadTodayPageData OR the 60d canonical / obs-compute helpers (Phase 2B swap)", () => {
    const body = scopeBody(stripped, "loadTodayV2VisibilityData");
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/\bloadTodayPageData\(/);
    expect(body).not.toMatch(/\bloadCachedTodayPageData\(/);
    // Phase 2B (2026-05-13) flipped this loader off raw observations:
    // the chart series, leaderboards, by-platform, and competitor
    // series are now sourced from daily_metric_snapshots via
    // `loadVisibilityReadModelFromSnapshots`. The 60d obs pull
    // (`loadCachedFreshCanonical`) and obs-compute helpers
    // (`computeVisibilityTimeSeries` / `computeLeaderboard` /
    // `computeCompetitorSeries`) MUST NOT appear in the visibility
    // loader's body. The 14d sibling `loadCachedFreshCanonical14d`
    // is permitted for the hero's enrichmentV2 sparklines build
    // (primary_recommendation rate lives on raw obs, not snapshots).
    expect(body).toMatch(/\bloadVisibilityReadModelFromSnapshots\(/);
    expect(body).not.toMatch(/\bloadCachedFreshCanonical(?!14d)\s*\(/);
    expect(body).not.toMatch(/\bcomputeVisibilityTimeSeries\(/);
    expect(body).not.toMatch(/\bcomputeLeaderboard\(/);
    expect(body).not.toMatch(/\bcomputeCompetitorSeries\(/);
  });

  it("narrow action-cards loader does NOT call loadTodayPageData", () => {
    const body = scopeBody(stripped, "loadTodayV2ActionCardsData");
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/\bloadTodayPageData\(/);
    expect(body).not.toMatch(/\bloadCachedTodayPageData\(/);
    // Reuses the EXISTING buildTodayLifecycleSummary helper so the
    // Working card stays byte-equivalent to legacy.
    expect(body).toMatch(/\bbuildTodayLifecycleSummary\(/);
    // Derives hurting + winning from url-change-outcomes — small read,
    // not the full legacy pipeline.
    expect(body).toMatch(/\bgetUrlChangeOutcomes\(\)/);
  });
});

// Move 5 (2026-07-01): the homepage was folded into a single CanonicalChange
// read model (page.tsx → one <Suspense><Cockpit/></Suspense>), replacing the
// old three-section V2 streaming layout. `today-v2-sections.tsx` and
// `today-v2-skeleton.tsx` were deleted, so the per-section pins here (sections
// component, page v2-path 3-Suspense mount, per-section skeletons) are obsolete
// contracts and were removed. The narrow today-v2-data.ts loaders above are
// still exercised where they survive; the new single-shell streaming + skeleton
// invariant is pinned by perf-streaming-bundle.test.ts and today-smoke.test.ts.
