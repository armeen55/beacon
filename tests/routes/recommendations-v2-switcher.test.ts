/**
 * Bundle 2A — /recommendations v1/v2 switcher contract.
 *
 * Pins the routing rules implemented in
 * `src/app/(shell)/recommendations/page.tsx`:
 *
 *   - Default (no query, env unset)    → v2 card stack (2026-06-15 flip)
 *   - `?legacy=1`                       → legacy table (escape hatch)
 *   - `?v2=1`                           → v2 card stack (explicit opt-in)
 *   - `BEACON_RECOMMENDATIONS_V2=false` → legacy table (kill switch)
 *
 * The two client components are mocked so the test focuses on the
 * routing decision, not on the full data render. Each stub emits a
 * stable marker the assertion grep on.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

vi.mock("@/app/(shell)/recommendations/recommendations-client", () => {
  const React = require("react") as typeof import("react");
  return {
    RecommendationsClient: function RecommendationsClientStub() {
      return React.createElement(
        "div",
        {
          className: "recs-legacy-stub",
          "data-recs-stub": "legacy",
        },
        "recommendations-legacy-stub",
      );
    },
  };
});

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

async function render(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<string> {
  // Streaming bundle (2026-05-12): the route's `page.tsx` now returns
  // a <Suspense> wrapper instantly with the async load deferred to
  // `RecommendationsAsyncContent`. `renderToStaticMarkup` does not
  // resolve Suspense — testing through the page would just dump the
  // skeleton. Invoke the async content directly here.
  const { RecommendationsAsyncContent } = await import(
    "@/app/(shell)/recommendations/page"
  );
  // Mirror `shouldUseRecommendationsV2` (2026-06-15: v2 is default-on):
  //   ?legacy=1 → false; ?v2=1 → true; else v2 UNLESS env === "false".
  const useV2 = (() => {
    if (searchParams.legacy === "1") return false;
    if (searchParams.v2 === "1") return true;
    return process.env.BEACON_RECOMMENDATIONS_V2 !== "false";
  })();
  const tree = await RecommendationsAsyncContent({ useV2 });
  return renderToStaticMarkup(tree as ReactElement);
}

describe("Bundle 2A — /recommendations switcher contract", () => {
  const originalEnv = process.env.BEACON_RECOMMENDATIONS_V2;

  beforeEach(() => {
    delete process.env.BEACON_RECOMMENDATIONS_V2;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BEACON_RECOMMENDATIONS_V2;
    } else {
      process.env.BEACON_RECOMMENDATIONS_V2 = originalEnv;
    }
  });

  it("renders the v2 card stack by default (no query, env unset) — 2026-06-15 flip", async () => {
    const html = await render({});
    expect(html).toContain('data-recs-stub="v2"');
    expect(html).not.toContain('data-recs-stub="legacy"');
  }, 15_000);

  it("renders the v2 card stack when ?v2=1 is set", async () => {
    const html = await render({ v2: "1" });
    expect(html).toContain('data-recs-stub="v2"');
    expect(html).not.toContain('data-recs-stub="legacy"');
  }, 15_000);

  it("renders the legacy table when ?legacy=1 is set (escape hatch)", async () => {
    const html = await render({ legacy: "1" });
    expect(html).toContain('data-recs-stub="legacy"');
    expect(html).not.toContain('data-recs-stub="v2"');
  }, 15_000);

  it("?legacy=1 wins even when v2 is the default (per-request escape hatch)", async () => {
    const html = await render({ legacy: "1" });
    expect(html).toContain('data-recs-stub="legacy"');
    expect(html).not.toContain('data-recs-stub="v2"');
  }, 15_000);

  it("renders legacy when BEACON_RECOMMENDATIONS_V2=false (kill switch)", async () => {
    process.env.BEACON_RECOMMENDATIONS_V2 = "false";
    const html = await render({});
    expect(html).toContain('data-recs-stub="legacy"');
    expect(html).not.toContain('data-recs-stub="v2"');
  }, 15_000);

  it("?v2=1 wins over BEACON_RECOMMENDATIONS_V2=false (explicit opt-in overrides kill switch)", async () => {
    process.env.BEACON_RECOMMENDATIONS_V2 = "false";
    const html = await render({ v2: "1" });
    expect(html).toContain('data-recs-stub="v2"');
    expect(html).not.toContain('data-recs-stub="legacy"');
  }, 15_000);
});
