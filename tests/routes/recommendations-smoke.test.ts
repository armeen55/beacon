import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

/**
 * RecommendationsClient is a client component (hooks + server actions). The
 * stub preserves the route contract: the RSC should build the matrix, run
 * the generator + prioritizer, join operator responses, and hand off to the
 * client without throwing. The stub echoes a stable string so we can assert
 * the RSC reached the hand-off.
 */
vi.mock("@/app/(shell)/recommendations/recommendations-client", () => {
  const React = require("react") as typeof import("react");
  return {
    RecommendationsClient: function RecommendationsClientStub() {
      return React.createElement(
        "div",
        { className: "recs-smoke-stub" },
        "recommendations-client-stub",
      );
    },
  };
});

describe("/recommendations route smoke", () => {
  it(
    "RecommendationsPage RSC runs the full generate → prioritize pipeline and renders the shell",
    async () => {
      // Streaming bundle (2026-05-12): the page returns a <Suspense>
      // wrapper instantly with the async load deferred to
      // `RecommendationsAsyncContent`. renderToStaticMarkup doesn't
      // resolve Suspense, so render the async content directly with
      // `useV2=false` (the legacy smoke path).
      const { RecommendationsAsyncContent } = await import(
        "@/app/(shell)/recommendations/page"
      );
      const tree = await RecommendationsAsyncContent({ useV2: false });
      const html = renderToStaticMarkup(tree as ReactElement);

      // Route wrapper class from page.tsx — pinned at the same
      // shell-width-or-wider that the table layout requires. W3 Step
      // 3.5e (2026-05-03) widened to max-w-5xl so the action table
      // fits without horizontal scroll.
      expect(html).toMatch(/max-w-(?:4xl|5xl)/);
      // PageHeader renders "Recommendations".
      expect(html).toContain("Recommendations");
      // Client stub reached (i.e. server load path didn't throw).
      expect(html).toContain("recommendations-client-stub");
    },
    15_000,
  );
});
