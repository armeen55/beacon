/**
 * Route smoke - merged suite (Core 100K Phase 6).
 * Absorbs: routes/today-smoke, routes/changes-smoke (FP4 redirects),
 * routes/competitors-redirect-smoke, routes/connectors-smoke, api/version.
 * One frame-level render or redirect pin per route; deep behavior lives in
 * the per-surface suites.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
vi.mock("@/domains/ops/refresh-runs-store", () => ({
  latestRefreshBySource: vi.fn(async () => ({})),
}));
vi.mock("@/domains/ops/warm-receipt-store", () => ({
  readLastWarmReceipt: vi.fn(async () => ({
    tenant_id: "tenant-iranopedia",
    date: "2026-07-17",
    ran_at: "2026-07-18T05:30:00.000Z",
    ok: true,
    totalMs: 1200,
    trigger: "visit",
    steps: [],
  })),
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

describe("FP4 route redirects smoke", () => {
  it("/worklist permanently redirects to /changes, preserving the query string", async () => {
    const { default: WorklistRedirect } = await import("@/app/(shell)/worklist/page");
    await expect(WorklistRedirect({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT:/changes",
    );
    await expect(
      WorklistRedirect({ searchParams: Promise.resolve({ status: "ready" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/changes?status=ready");
  });

  it("/proof permanently redirects to /results (query preserved)", async () => {
    const { default: ProofRedirect } = await import("@/app/(shell)/proof/page");
    await expect(
      ProofRedirect({ searchParams: Promise.resolve({ page: "/cheetah" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/results?page=%2Fcheetah");
  });

  it("/competitors redirects to /changes (competitor intelligence feeds the queue)", async () => {
    const { default: CompetitorsPageRedirect } = await import("@/app/(shell)/competitors/page");
    expect(() => CompetitorsPageRedirect()).toThrow("NEXT_REDIRECT:/changes");
  });

  it("the /changes index is the real Changes list, not a redirect", () => {
    const src = readFileSync(resolve(process.cwd(), "src/app/(shell)/changes/page.tsx"), "utf8");
    expect(src).not.toMatch(/permanentRedirect|\bredirect\(/);
    expect(src).toContain('title="Changes"');
  });
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
    expect(html).toContain("Automatic upkeep:");
    expect(html).toContain("The only thing I never do on my own is change your live site");
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
    expect(html).toContain("Automatic upkeep: last finished");
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
