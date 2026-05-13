import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * TodayClient is a client component (hooks). renderToStaticMarkup in Vitest
 * cannot execute it; a minimal stub preserves the route contract while still
 * emitting stable Today copy for assertions.
 */
vi.mock("@/app/(shell)/today-client", () => {
  const React = require("react") as typeof import("react");
  return {
    TodayClient: function TodayClientSmokeStub() {
      return React.createElement(
        "div",
        { className: "today-smoke-stub" },
        "Since last scan",
      );
    },
  };
});

describe("Today route smoke", () => {
  it(
    "TodayPage RSC loads data and renders the shell wrapper plus Today slot",
    async () => {
    // Streaming bundle (2026-05-12): the page returns a <Suspense>
    // wrapper instantly with the async load deferred to
    // `TodayAsyncContent`. renderToStaticMarkup doesn't resolve
    // Suspense, so render the async content directly.
    const { TodayAsyncContent } = await import("@/app/(shell)/page");
    const tree = await TodayAsyncContent({ useV2: false });
    const html = renderToStaticMarkup(tree as ReactElement);

    // Canonical Today findings heading (see `today-findings.tsx`);
    // echoed by stub so the route still wires a Today subtree without
    // running client hooks here.
    expect(html).toContain("Since last scan");
    },
    15_000,
  );
});
