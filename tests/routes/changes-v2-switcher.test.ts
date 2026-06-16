/**
 * /changes — V2-only render contract.
 *
 * Surface collapse (2026-06-15): the legacy table (`ScorecardTable`) +
 * the `?legacy=1` / `?v2=1` / `BEACON_CHANGES_V2` switcher were deleted.
 * `/changes` now renders the v2 proof timeline unconditionally. This
 * test pins that the route renders the v2 client.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// The v2 changes client uses next/navigation hooks. The SSR smoke test
// runs outside the App Router context — stub them so the client can
// render to a string.
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
// existing for the CURRENT tenant. Force it open so the render reaches
// the v2 timeline.
vi.mock("@/lib/seed-data.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/seed-data.server")>();
  return { ...actual, hasActiveExperiment: async () => true };
});

vi.mock("@/app/(shell)/changes/changes-v2-client", () => {
  const React = require("react") as typeof import("react");
  return {
    ChangesV2Client: function ChangesV2ClientStub() {
      return React.createElement(
        "div",
        {
          "data-changes-stub": "v2",
        },
        "changes-v2-stub",
      );
    },
  };
});

async function render(): Promise<string> {
  const { default: ChangeScorecardPage } = await import(
    "@/app/(shell)/changes/page"
  );
  const tree = await ChangeScorecardPage();
  return renderToStaticMarkup(tree as ReactElement);
}

describe("/changes V2-only render contract", () => {
  it("renders the v2 timeline (the only surface)", async () => {
    const html = await render();
    expect(html).toContain('data-changes-stub="v2"');
    // The deleted legacy table must never render.
    expect(html).not.toContain('data-changes-stub="legacy"');
  }, 15_000);
});
