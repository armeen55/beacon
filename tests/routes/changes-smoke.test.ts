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

// 2026-06-12 — `hasActiveExperiment()` gates the page on import-runs
// existing for the CURRENT tenant. It now reads through
// `forTenant(tenantId)` (the unscoped read it replaced bled other
// tenants' import-runs in — the seed-data isolation fix). The lifecycle
// layout under test is downstream of that gate, so force it open; the
// changelog itself still comes from the real `forTenant` read at
// page.tsx:161. Only `hasActiveExperiment` is overridden — getResults /
// getOpportunities keep their real (now tenant-scoped) behavior.
vi.mock("@/lib/seed-data.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/seed-data.server")>();
  return { ...actual, hasActiveExperiment: async () => true };
});

describe("Changes route smoke", () => {
  it("ChangeScorecardPage RSC renders Phase 6A.2 lifecycle layout (legacy branch)", async () => {
    const { default: ChangeScorecardPage } = await import(
      "@/app/(shell)/changes/page"
    );
    // 2026-06-15 — v2 is now the production default, so the unparam'd
    // render produces the proof timeline. This smoke test pins the
    // LEGACY lifecycle layout (strip + at-a-glance + legacy header), so
    // force the legacy branch via the `?legacy=1` escape hatch.
    const tree = await ChangeScorecardPage({
      searchParams: Promise.resolve({ legacy: "1" }),
    });
    const html = renderToStaticMarkup(tree as ReactElement);

    // 2026-05-06 demo-path Phase 3-bis fix 3: header rewritten for
    // customer-mode clarity. renderToStaticMarkup escapes the
    // apostrophe to &#x27;, so we match either the escaped form or
    // the unescaped one (in case the renderer changes). Either way,
    // the surrounding context is unique enough.
    expect(
      html.includes(
        "Every edit you&#x27;ve shipped to your site, with its Google Search + AI impact tracked over time",
      ) ||
        html.includes(
          "Every edit you've shipped to your site, with its Google Search + AI impact tracked over time",
        ),
    ).toBe(true);
    // Structural wrapper from `components/data/page-header.tsx`.
    expect(html).toContain("flex items-start justify-between gap-4 mb-8");
    // Phase 6A.2 at-a-glance now leads with the live-verified count
    // and labels it "live verified" (lowercased from LIFECYCLE_TAB_LABEL).
    expect(html).toContain("live verified");
    // Phase 6A.10 (2026-04-28) — /changes renders the lifecycle strip
    // (same component as /today). Chips deep-link to /changes?tab=...
    // via the Phase 6A.8 deep-link plumbing.
    expect(html).toContain("data-today-lifecycle-strip");
    expect(html).toContain('data-lifecycle-chip="liveVerified"');
    // No tab shell — the old "Outcomes / Attribution / Replicate" tab chrome is gone.
    expect(html).not.toContain(">Outcomes<");
    expect(html).not.toContain(">Attribution<");
    expect(html).not.toContain(">Replicate<");
  });
});
