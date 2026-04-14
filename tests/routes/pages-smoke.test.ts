import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * PagesClient is a client component (hooks). Same pattern as Today smoke:
 * stub preserves the route slot without executing client hooks in Vitest.
 */
vi.mock("@/app/(shell)/pages/pages-client", () => {
  const React = require("react") as typeof import("react");
  return {
    PagesClient: function PagesClientSmokeStub() {
      return React.createElement("div", { className: "pages-smoke-stub" });
    },
  };
});

describe("Pages route smoke", () => {
  it("PagesPage RSC loads data and renders the shell wrapper plus Pages client slot", async () => {
    const { default: PagesPage } = await import("@/app/(shell)/pages/page");
    const tree = await PagesPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    // Stable class from `src/app/(shell)/pages/page.tsx` (demo + full paths).
    expect(html).toContain("max-w-5xl");
    // Route header copy from same file — not row counts or timestamps.
    expect(html).toContain(
      "Health, citations, and the next step for each URL.",
    );
  });
});
