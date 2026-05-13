/**
 * Bundle 2A — /recommendations v1/v2 switcher contract.
 *
 * Pins the routing rules implemented in
 * `src/app/(shell)/recommendations/page.tsx`:
 *
 *   - Default (no query, env unset)   → legacy table (current production)
 *   - `?legacy=1`                      → legacy table (escape hatch)
 *   - `?v2=1`                          → v2 card stack (preview hatch)
 *   - `BEACON_RECOMMENDATIONS_V2=true` → v2 card stack (default flip)
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
  const { default: RecommendationsPage } = await import(
    "@/app/(shell)/recommendations/page"
  );
  const tree = await RecommendationsPage({
    searchParams: Promise.resolve(searchParams),
  });
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

  it("renders the legacy table by default (no query, env unset)", async () => {
    const html = await render({});
    expect(html).toContain('data-recs-stub="legacy"');
    expect(html).not.toContain('data-recs-stub="v2"');
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

  it("?legacy=1 wins over BEACON_RECOMMENDATIONS_V2=true (escape hatch overrides env)", async () => {
    process.env.BEACON_RECOMMENDATIONS_V2 = "true";
    const html = await render({ legacy: "1" });
    expect(html).toContain('data-recs-stub="legacy"');
    expect(html).not.toContain('data-recs-stub="v2"');
  }, 15_000);

  it("renders v2 when BEACON_RECOMMENDATIONS_V2=true (env default flip)", async () => {
    process.env.BEACON_RECOMMENDATIONS_V2 = "true";
    const html = await render({});
    expect(html).toContain('data-recs-stub="v2"');
    expect(html).not.toContain('data-recs-stub="legacy"');
  }, 15_000);
});
