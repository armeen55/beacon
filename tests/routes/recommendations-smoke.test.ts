import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

/**
 * Surface collapse (2026-06-15) — /recommendations is now V2-only. The
 * V2 card stack is a client component (hooks + server actions); the stub
 * preserves the route contract: the RSC should run the persisted loader,
 * join operator responses, and hand off to the client without throwing.
 * The stub echoes a stable string so we can assert the RSC reached the
 * hand-off.
 */
vi.mock("@/app/(shell)/recommendations/recommendations-v2-client", () => {
  const React = require("react") as typeof import("react");
  return {
    RecommendationsV2Client: function RecommendationsV2ClientStub() {
      return React.createElement(
        "div",
        { className: "recs-smoke-stub" },
        "recommendations-v2-client-stub",
      );
    },
  };
});

describe("/recommendations route smoke", () => {
  it(
    "RecommendationsPage RSC runs the persisted loader pipeline and renders the shell",
    async () => {
      // Streaming bundle (2026-05-12): the page returns a <Suspense>
      // wrapper instantly with the async load deferred to
      // `RecommendationsAsyncContent`. renderToStaticMarkup doesn't
      // resolve Suspense, so render the async content directly.
      const { RecommendationsAsyncContent } = await import(
        "@/app/(shell)/recommendations/page"
      );
      const tree = await RecommendationsAsyncContent();
      const html = renderToStaticMarkup(tree as ReactElement);

      // Route wrapper class from page.tsx.
      expect(html).toMatch(/max-w-(?:4xl|5xl)/);
      // Client stub reached (i.e. server load path didn't throw).
      expect(html).toContain("recommendations-v2-client-stub");
    },
    15_000,
  );
});
