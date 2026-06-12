/**
 * /changes v1/v2 switcher contract.
 *
 * Pins the routing rules implemented in
 * `src/app/(shell)/changes/page.tsx`:
 *
 *   - Default (no query, env unset)   → legacy table (current production)
 *   - `?legacy=1`                      → legacy table (escape hatch)
 *   - `?v2=1`                          → v2 proof timeline (preview hatch)
 *   - `BEACON_CHANGES_V2=true`         → v2 timeline (default flip)
 *
 * Both client surfaces are mocked so the test focuses on the routing
 * decision, not the full data render. Each stub emits a stable marker
 * the assertions grep on.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// The legacy ScorecardTable uses next/navigation hooks. The SSR smoke
// test runs outside the App Router context — stub both hooks so the
// legacy branch can render to a string.
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
// tenants' import-runs in — the seed-data isolation fix). The switcher
// routing under test is downstream of that gate, so force it open; only
// `hasActiveExperiment` is overridden so the rest stays real.
vi.mock("@/lib/seed-data.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/seed-data.server")>();
  return { ...actual, hasActiveExperiment: async () => true };
});

vi.mock("@/app/(shell)/changes/scorecard-client", async () => {
  const actual = await vi.importActual<
    typeof import("@/app/(shell)/changes/scorecard-client")
  >("@/app/(shell)/changes/scorecard-client");
  const React = require("react") as typeof import("react");
  return {
    ...actual,
    ScorecardTable: function ScorecardTableStub() {
      return React.createElement(
        "div",
        {
          "data-changes-stub": "legacy",
        },
        "changes-legacy-stub",
      );
    },
  };
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

async function render(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<string> {
  const { default: ChangeScorecardPage } = await import(
    "@/app/(shell)/changes/page"
  );
  const tree = await ChangeScorecardPage({
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(tree as ReactElement);
}

describe("/changes switcher contract", () => {
  const originalEnv = process.env.BEACON_CHANGES_V2;

  beforeEach(() => {
    delete process.env.BEACON_CHANGES_V2;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BEACON_CHANGES_V2;
    } else {
      process.env.BEACON_CHANGES_V2 = originalEnv;
    }
  });

  it("renders the legacy table by default (no query, env unset)", async () => {
    const html = await render({});
    expect(html).toContain('data-changes-stub="legacy"');
    expect(html).not.toContain('data-changes-stub="v2"');
  }, 15_000);

  it("renders the v2 timeline when ?v2=1 is set", async () => {
    const html = await render({ v2: "1" });
    expect(html).toContain('data-changes-stub="v2"');
    expect(html).not.toContain('data-changes-stub="legacy"');
  }, 15_000);

  it("renders the legacy table when ?legacy=1 is set (escape hatch)", async () => {
    const html = await render({ legacy: "1" });
    expect(html).toContain('data-changes-stub="legacy"');
    expect(html).not.toContain('data-changes-stub="v2"');
  }, 15_000);

  it("?legacy=1 wins over BEACON_CHANGES_V2=true (escape hatch overrides env)", async () => {
    process.env.BEACON_CHANGES_V2 = "true";
    const html = await render({ legacy: "1" });
    expect(html).toContain('data-changes-stub="legacy"');
    expect(html).not.toContain('data-changes-stub="v2"');
  }, 15_000);

  it("renders v2 when BEACON_CHANGES_V2=true (env default flip)", async () => {
    process.env.BEACON_CHANGES_V2 = "true";
    const html = await render({});
    expect(html).toContain('data-changes-stub="v2"');
    expect(html).not.toContain('data-changes-stub="legacy"');
  }, 15_000);
});
