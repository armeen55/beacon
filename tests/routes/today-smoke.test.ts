import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * Today route smoke.
 *
 * Surface collapse (2026-06-15): /today is V2-only. The page returns a
 * <Suspense> wrapper instantly; renderToStaticMarkup does not resolve
 * Suspense, so the smoke asserts the shell wrapper + the V2 sectioned
 * skeleton fallback render (proving the route wires through to the V2
 * surface without throwing at the frame level). The legacy
 * `TodayLegacyAsyncContent` + `TodayClient` render path was deleted.
 */
describe("Today route smoke", () => {
  it(
    "TodayPage RSC renders the shell wrapper + V2 sectioned skeleton fallback",
    async () => {
      const { default: TodayPage } = await import("@/app/(shell)/page");
      const tree = await TodayPage({ searchParams: Promise.resolve({}) });
      const html = renderToStaticMarkup(tree as ReactElement);

      // Route wrapper class from page.tsx.
      expect(html).toContain("max-w-6xl");
      // The V2 sectioned skeleton (Suspense fallback) renders while the
      // gate loader resolves — pin one of its per-section markers.
      expect(html).toContain('data-today-v2-section-skeleton');
    },
    15_000,
  );
});
