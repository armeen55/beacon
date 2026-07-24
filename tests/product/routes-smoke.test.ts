/**
 * Four-surface smoke (Core 100K product contract). The four operator surfaces -
 * Today, Changes, Results, Connections - each render their frame without throwing.
 * One frame-level render per surface; deep behavior lives in the kept behavioral
 * contract suites. Also pins GET /api/version.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const permanentRedirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirectMock(url),
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/connectors",
}));

vi.mock("@/lib/connector-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/connector-store")>("@/lib/connector-store");
  return {
    ...actual,
    getConnectorInfo: vi.fn(async () => ({
      status: "disconnected" as const,
      connected_at: null,
      expires_at: null,
      last_synced_at: null,
    })),
    getGoogleConnectorToken: vi.fn(async () => null),
    getYelpConnectorToken: vi.fn(async () => null),
  };
});
vi.mock("@/domains/runtime/ops/refresh-runs-store", () => ({
  latestRefreshBySource: vi.fn(async () => ({})),
}));
vi.mock("@/domains/runtime/research-run", () => ({
  researchRunStatus: vi.fn(async () => ({ state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: 3, counters: {}, updatedAt: null, completedAt: null })),
}));

describe("Today route smoke", () => {
  it("TodayPage RSC renders the shell wrapper + Cockpit skeleton fallback", async () => {
    const { default: TodayPage } = await import("@/app/(shell)/page");
    const tree = await TodayPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain("max-w-3xl");
    expect(html).toContain('aria-label="Loading today"');
  }, 15_000);
});

describe("Changes route smoke", () => {
  it("WorklistPage renders the Changes frame + list fallback", async () => {
    const { default: ChangesPage } = await import("@/app/(shell)/changes/page");
    const html = renderToStaticMarkup(ChangesPage() as ReactElement);
    expect(html).toContain("Changes");
    expect(html).toContain("ranked execution queue");
  });
});

describe("Results route smoke", () => {
  it("ProofPage RSC renders the Results frame (empty-state is honest, never a bare zero)", async () => {
    const { default: ResultsPage } = await import("@/app/(shell)/results/page");
    const tree = await ResultsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain("Results");
    expect(html).toContain("7, 14, and 28 days");
  }, 15_000);
});

describe("Connectors settings route smoke", () => {
  it("renders the connector page with the shipped cards + the one summary strip", async () => {
    const { default: ConnectorsPage } = await import("@/app/(shell)/settings/connectors/page");
    const tree = await ConnectorsPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Connect your tools");
    expect(html).toContain("Connect Google Search Console");
    expect(html).toContain('data-connector-card="google-ga4"');
    expect(html).toContain('data-connector-card="clarity"');
    expect(html).not.toContain("Enter Yelp API Key");
    expect(html).toContain('data-connectors-summary-strip="true"');
    expect(html).toContain("I never touch your live site");
  });

  it("computes 'N of M connected' from provider reads and surfaces the on-use receipt", async () => {
    const { getConnectorInfo } = await import("@/lib/connector-store");
    vi.mocked(getConnectorInfo).mockImplementation(async (provider: string) => {
      const connected = provider === "google_gsc" || provider === "wix";
      return {
        status: connected ? "connected" : "disconnected",
        connected_at: connected ? "2026-06-01T00:00:00.000Z" : null,
        expires_at: null,
        last_synced_at: connected ? "2026-07-01T09:00:00.000Z" : null,
      };
    });

    const { default: ConnectorsPage } = await import("@/app/(shell)/settings/connectors/page");
    const tree = await ConnectorsPage();
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain("2 of 4 connected");
  });
});

describe("GET /api/version", () => {
  const KEYS = ["VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF", "VERCEL_DEPLOYMENT_ID"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns nulls when deploy env vars are unset, reflects them when present", async () => {
    const { GET } = await import("@/app/api/version/route");
    const empty = GET();
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ sha: null, ref: null, deployedId: null });

    process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_xyz";
    expect(await GET().json()).toEqual({ sha: "abc123", ref: "main", deployedId: "dpl_xyz" });
  });
});
