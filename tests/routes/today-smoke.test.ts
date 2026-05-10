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
    const { default: TodayPage } = await import("@/app/(shell)/page");
    // Bundle 1 (2026-05-10): page.tsx now reads searchParams to switch
    // between v1/v2 layouts. Pass an empty Promise so the smoke test
    // exercises the v1 default path (BEACON_TODAY_V2 unset).
    const tree = await TodayPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(tree as ReactElement);

    // Stable class from `src/app/(shell)/page.tsx` — not copy-dependent.
    expect(html).toContain("max-w-6xl");
    // Canonical Today findings heading (see `today-findings.tsx`); echoed by stub
    // so the route still wires a Today subtree without running client hooks here.
    expect(html).toContain("Since last scan");
    },
    15_000,
  );
});
