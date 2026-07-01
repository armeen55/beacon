/**
 * Emergency P0 v3 (2026-05-12) — source-level pin for `prefetch={false}`
 * on every shell-nav Link.
 *
 * The v2 emergency fix turned off prefetch on list→detail Links, which
 * eliminated the per-card prefetch storm on /recommendations etc.
 * Production Vercel logs from a logged-in operator showed that visiting
 * one page (e.g. /recommendations) still triggered background server
 * GETs for the OTHER top-level routes: /, /changes, /prompts, /settings.
 *
 * Root cause: the sidebar + header still used default Next/Link
 * prefetch. On every shell hydration, every nav link prefetched its
 * target route. With 5 top-level routes that all call expensive
 * loaders (loadTodayPageData / loadLiveRecommendationQueue / change
 * scorecard / prompt drilldowns / settings sub-routes), one click on
 * any shell tab triggered 5 parallel server functions — same
 * multiplier problem at a different layer.
 *
 * Fix: prefetch={false} on every Link inside the shell chrome — the
 * desktop sidebar (used as `<AppSidebar>` AND inside `<MobileSidebar>`),
 * the header breadcrumb, the demo banner, and the evidence-freshness
 * banner. Click navigation is unchanged; prefetch on visibility is off.
 *
 * Architecture pins below grep the source files directly so any new
 * shell Link added without prefetch={false} fails this test in CI.
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

/**
 * Count occurrences of <Link in source (after stripping comments).
 * Used to assert that EVERY Link in the file carries prefetch={false}
 * — not just one of them.
 */
function countLinkOpenTags(src: string): number {
  const stripped = stripComments(src);
  return (stripped.match(/<Link(\s|>)/g) ?? []).length;
}

function countPrefetchFalse(src: string): number {
  const stripped = stripComments(src);
  return (stripped.match(/prefetch=\{false\}/g) ?? []).length;
}

describe("Emergency P0 v3: shell nav Link prefetch disabled", () => {
  it("AppSidebar — every Link has prefetch={false} (covers desktop + MobileSidebar via SidebarContent)", () => {
    const src = read("src/components/shell/app-sidebar.tsx");
    const linkCount = countLinkOpenTags(src);
    const prefetchFalseCount = countPrefetchFalse(src);
    expect(linkCount, "expected the sidebar to render Link components").toBeGreaterThanOrEqual(2);
    expect(prefetchFalseCount, "every <Link in the sidebar must carry prefetch={false}").toBe(linkCount);
  });

  it("AppHeader — breadcrumb parent Link has prefetch={false}", () => {
    const src = read("src/components/shell/app-header.tsx");
    const linkCount = countLinkOpenTags(src);
    const prefetchFalseCount = countPrefetchFalse(src);
    expect(linkCount).toBeGreaterThanOrEqual(1);
    expect(prefetchFalseCount).toBe(linkCount);
  });

  it("DemoBanner — /settings/import Link has prefetch={false}", () => {
    const src = read("src/components/shell/demo-banner.tsx");
    const linkCount = countLinkOpenTags(src);
    const prefetchFalseCount = countPrefetchFalse(src);
    expect(linkCount).toBeGreaterThanOrEqual(1);
    expect(prefetchFalseCount).toBe(linkCount);
  });

  it("EvidenceFreshnessBanner — methodologyHref Links have prefetch={false}", () => {
    const src = read("src/components/shell/evidence-freshness-banner.tsx");
    const linkCount = countLinkOpenTags(src);
    const prefetchFalseCount = countPrefetchFalse(src);
    expect(linkCount).toBeGreaterThanOrEqual(2);
    expect(prefetchFalseCount).toBe(linkCount);
  });

  it("Navigation registry still ships the core top-level routes", () => {
    const src = read("src/lib/navigation.ts");
    expect(src).toMatch(/href:\s*["']\/["']/);
    // 2026-07-01 one-workflow consolidation: "Changes" (/worklist) is the core
    // ranked-list route; "Drafts" (/recommendations) is now a redirect stage,
    // no longer a top-level nav item.
    expect(src).toMatch(/href:\s*["']\/worklist["']/);
    expect(src).toMatch(/href:\s*["']\/prompts["']/);
    // IA consolidation (2026-06-23): Changes merged into Results (/proof) and is
    // no longer a primary nav item; Results is the one "did it work" route.
    expect(src).toMatch(/href:\s*["']\/proof["']/);
    expect(src).toMatch(/href:\s*["']\/settings["']/);
  });
});
