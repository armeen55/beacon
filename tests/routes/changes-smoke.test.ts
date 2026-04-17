import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Changes route smoke", () => {
  it("ChangeScorecardPage RSC renders single-list layout with newest-first headline", async () => {
    const { default: ChangeScorecardPage } = await import(
      "@/app/(shell)/changes/page"
    );
    const tree = await ChangeScorecardPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    // Single-list page description (replaces the old tabbed page's description).
    expect(html).toContain(
      "Every change you",
    );
    // Structural wrapper from `components/data/page-header.tsx`.
    expect(html).toContain("flex items-start justify-between gap-4 mb-8");
    // "changes tracked" total appears in the at-a-glance strip.
    expect(html).toContain("changes tracked");
    // No tab shell — the old "Outcomes / Attribution / Replicate" tab chrome is gone.
    expect(html).not.toContain(">Outcomes<");
    expect(html).not.toContain(">Attribution<");
    expect(html).not.toContain(">Replicate<");
  });
});
