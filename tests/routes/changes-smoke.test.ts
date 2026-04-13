import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * ChangesTabShell is a client component (useState + useSearchParams).
 * Same pattern as Today / Pages smoke tests.
 */
vi.mock("@/app/(shell)/changes/changes-tab-shell", () => {
  const React = require("react") as typeof import("react");
  return {
    ChangesTabShell: function ChangesTabShellSmokeStub() {
      return React.createElement("div", { className: "changes-tab-smoke-stub" });
    },
  };
});

describe("Changes route smoke", () => {
  it("ChangeScorecardPage RSC loads data and renders PageHeader plus tab shell slot", async () => {
    const { default: ChangeScorecardPage } = await import(
      "@/app/(shell)/changes/page"
    );
    const tree = await ChangeScorecardPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    // Stable description from `PageHeader` on both demo and full paths (`page.tsx`).
    expect(html).toContain(
      "What worked. What to scale. Why visibility moved.",
    );
    // Structural wrapper from `components/data/page-header.tsx` (not dynamic data).
    expect(html).toContain("flex items-start justify-between gap-4 mb-8");
  });
});
