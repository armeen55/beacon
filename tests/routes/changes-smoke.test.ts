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
  it("ChangeScorecardPage RSC renders the v2 proof timeline (the only surface)", async () => {
    const { default: ChangeScorecardPage } = await import(
      "@/app/(shell)/changes/page"
    );
    // Surface collapse (2026-06-15): /changes is V2-only. The unparam'd
    // render produces the proof timeline; the route no longer accepts a
    // searchParams arg. This smoke exercises the real data path through
    // to the v2 client.
    const tree = await ChangeScorecardPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    // The v2 proof-timeline container renders (PageHeader title + the
    // v2 layout marker). Either the timeline (when there's activity) or
    // the calm empty state — both live inside the v2 client, which
    // stamps the layout marker.
    expect(html).toContain('data-changes-layout="v2-proof-timeline"');
    // The v2 header copy (NOT the deleted legacy header).
    expect(html).toContain("Changes");
    // The deleted legacy lifecycle strip + tab chrome must NOT render.
    expect(html).not.toContain("data-today-lifecycle-strip");
    expect(html).not.toContain(">Outcomes<");
    expect(html).not.toContain(">Attribution<");
    expect(html).not.toContain(">Replicate<");
  });
});
