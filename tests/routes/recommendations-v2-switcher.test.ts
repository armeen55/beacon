/**
 * /recommendations — V2-only render contract.
 *
 * Surface collapse (2026-06-15): the legacy table + drawer
 * (`RecommendationsClient`) + the `?legacy=1` / `?v2=1` /
 * `BEACON_RECOMMENDATIONS_V2` switcher were deleted. /recommendations
 * now renders the v2 card stack unconditionally. This test pins that
 * the route renders the v2 client.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

vi.mock("@/app/(shell)/recommendations/recommendations-v2-client", () => {
  const React = require("react") as typeof import("react");
  return {
    RecommendationsV2Client: function RecommendationsV2ClientStub() {
      return React.createElement(
        "div",
        {
          className: "recs-v2-stub",
          "data-recs-stub": "v2",
        },
        "recommendations-v2-stub",
      );
    },
  };
});

async function render(): Promise<string> {
  // Streaming bundle (2026-05-12): the route's `page.tsx` returns a
  // <Suspense> wrapper instantly with the async load deferred to
  // `RecommendationsAsyncContent`. `renderToStaticMarkup` does not
  // resolve Suspense — testing through the page would just dump the
  // skeleton. Invoke the async content directly here.
  const { RecommendationsAsyncContent } = await import(
    "@/app/(shell)/recommendations/page"
  );
  const tree = await RecommendationsAsyncContent();
  return renderToStaticMarkup(tree as ReactElement);
}

describe("/recommendations V2-only render contract", () => {
  it("renders the v2 card stack (the only surface)", async () => {
    const html = await render();
    expect(html).toContain('data-recs-stub="v2"');
    // The deleted legacy table must never render.
    expect(html).not.toContain('data-recs-stub="legacy"');
  }, 15_000);
});
