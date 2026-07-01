import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * Today route smoke.
 *
 * Move 5 (2026-07-01): /today is a thin CanonicalChange read model. The page
 * returns a <Suspense> wrapper instantly; renderToStaticMarkup does not resolve
 * Suspense, so the smoke asserts the shell wrapper + the inline CockpitSkeleton
 * fallback render (proving the route wires through without throwing at the frame
 * level). The old V2 sectioned-skeleton render path was removed with the fold.
 */
describe("Today route smoke", () => {
  it(
    "TodayPage RSC renders the shell wrapper + Cockpit skeleton fallback",
    async () => {
      const { default: TodayPage } = await import("@/app/(shell)/page");
      const tree = await TodayPage({ searchParams: Promise.resolve({}) });
      const html = renderToStaticMarkup(tree as ReactElement);

      // Route wrapper class from page.tsx (Move 5 focused-slice width).
      expect(html).toContain("max-w-3xl");
      // The inline CockpitSkeleton (Suspense fallback) renders while the loader
      // resolves — pin its accessible loading marker.
      expect(html).toContain('aria-label="Loading today"');
    },
    15_000,
  );
});
