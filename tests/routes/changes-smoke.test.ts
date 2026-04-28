import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Phase 6A.8 (2026-04-28) — scorecard-client now uses next/navigation
// hooks (useRouter + useSearchParams) for tab deep-link support. The
// SSR smoke test runs outside the App Router context, so stub both.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/changes",
}));

describe("Changes route smoke", () => {
  it("ChangeScorecardPage RSC renders Phase 6A.2 lifecycle layout", async () => {
    const { default: ChangeScorecardPage } = await import(
      "@/app/(shell)/changes/page"
    );
    const tree = await ChangeScorecardPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    // Phase 6A.2 page description (replaces the pre-6A.2 "Every change
    // you've made" framing — that copy lumped lifecycle truth with
    // imported legacy and scan diffs into one undifferentiated list).
    expect(html).toContain("Verified and tracked changes");
    // Structural wrapper from `components/data/page-header.tsx`.
    expect(html).toContain("flex items-start justify-between gap-4 mb-8");
    // Phase 6A.2 at-a-glance now leads with the live-verified count
    // and labels it "live verified" (lowercased from LIFECYCLE_TAB_LABEL).
    expect(html).toContain("live verified");
    // No tab shell — the old "Outcomes / Attribution / Replicate" tab chrome is gone.
    expect(html).not.toContain(">Outcomes<");
    expect(html).not.toContain(">Attribution<");
    expect(html).not.toContain(">Replicate<");
  });
});
