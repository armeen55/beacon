/**
 * Four-surface smoke (Core 100K product contract): Today, Changes, Results, Connections each
 * render their frame without throwing, plus the two Today claims a stranger reads first (the
 * ready count and the one CTA). Deep behavior lives in the kept behavioral contract suites.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server"; import type { ReactElement } from "react";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => {
  const redirected = (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); };
  return { permanentRedirect: redirected, redirect: redirected, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(), usePathname: () => "/settings/connectors" };
});
vi.mock("@/lib/connector-store", async () => ({
  ...(await vi.importActual<typeof import("@/lib/connector-store")>("@/lib/connector-store")),
  getConnectorInfo: vi.fn(async () => ({ status: "disconnected" as const, connected_at: null, expires_at: null, last_synced_at: null })),
  getGoogleConnectorToken: vi.fn(async () => null), getYelpConnectorToken: vi.fn(async () => null),
}));
vi.mock("@/domains/runtime/ops/refresh-runs-store", () => ({ latestRefreshBySource: vi.fn(async () => ({})) }));
vi.mock("@/domains/runtime/research-run", () => ({
  researchRunStatus: vi.fn(async () => ({ state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: 3, counters: {}, updatedAt: null, completedAt: null })),
}));
// The smoke suite pins frames; lifecycle gating has its own behavioral tests.
vi.mock("@/domains/account/lifecycle", () => ({ requireReadyAccount: vi.fn(async () => ({ access: { kind: "ready", account: { status: "active" } } })),
  resolveAccountAccess: vi.fn(async () => ({ kind: "ready", account: { status: "active" } })), AccountUnavailableError: class extends Error {} }));

describe("Today route smoke", () => {
  it("TodayPage RSC renders the shell wrapper + Cockpit skeleton fallback", async () => {
    const { default: TodayPage } = await import("@/app/(shell)/page");
    const html = renderToStaticMarkup((await TodayPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toContain("max-w-3xl"); expect(html).toContain('aria-label="Loading today"');
  }, 15_000);
});

describe("Today tells the truth about its own queue", () => {
  const readyView = (n: number, measuring: number) => ({
    ready: Array.from({ length: n }, (_, i) => ({ id: `t::/p${i}::existing_edit::title`, pagePath: `/p${i}`, pageUrl: null, pageLabel: `P${i}`, primaryQuery: "q",
      opportunityType: "Sharpen the title", estimatedEffortMinutes: 2, upsidePerMonth: null, confidence: "high", recommendedChange: { kind: "existing_edit", field: "title" } })),
    toDo: [], measuringCountCanonical: measuring,
  } as unknown as import("@/app/(shell)/changes-data").ChangesView);

  it("counts EVERY ready change and says the five it previews are a preview", async () => {
    const { buildTodayViewFromChanges } = await import("@/app/(shell)/today-view-data");
    const view = buildTodayViewFromChanges(readyView(12, 3));
    expect(view.headerSentence).toBe("You have 12 changes ready; here are the five strongest. 3 more are still measuring.");
    expect(view.nextOpportunities).toHaveLength(5);
    expect(view.readyFixes).toHaveLength(12); // every ready page is linkable, not just the previewed five
    expect(buildTodayViewFromChanges(readyView(1, 0)).headerSentence).toBe("You have 1 change ready to apply.");
  });

  it("points a bleeding page at its own ready fix, and never at a route that does not exist", async () => {
    const { buildTodaySmokeAlarm } = await import("@/components/today/today-smoke-alarm");
    const decay = [{ page: "https://site.example/nowruz", clicksNow: 10, clicksPrior: 60 }];
    const fixed = buildTodaySmokeAlarm({ decay, readyFixes: new Map([["/nowruz", "t::/nowruz::existing_edit::title"]]) })!;
    const bare = buildTodaySmokeAlarm({ decay, readyFixes: new Map() })!;
    expect(fixed.href).toBe(`/changes/${encodeURIComponent("t::/nowruz::existing_edit::title")}`);
    expect(fixed.actionLabel).toBe("See the fix"); expect(fixed.sentence).toContain("I have a fix ready.");
    expect(bare.href).toBe("/changes"); expect(bare.actionLabel).toBe("Open Changes"); expect(bare.sentence).not.toContain("fix ready");
    for (const href of [fixed.href, bare.href]) expect(href.startsWith("/page/")).toBe(false);
  });
});

describe("Changes route smoke", () => {
  it("WorklistPage renders the Changes frame + list fallback", async () => {
    const { default: ChangesPage } = await import("@/app/(shell)/changes/page");
    const html = renderToStaticMarkup((await ChangesPage()) as ReactElement);
    expect(html).toContain("Changes"); expect(html).toContain("ranked execution queue");
  });
});

describe("Results route smoke", () => {
  it("ProofPage RSC renders the Results frame (empty-state is honest, never a bare zero)", async () => {
    const { default: ResultsPage } = await import("@/app/(shell)/results/page");
    const html = renderToStaticMarkup((await ResultsPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toContain("Results"); expect(html).toContain("7, 14, and 28 days");
  }, 15_000);
});

describe("Connectors settings route smoke", () => {
  it("renders the connector page with the shipped cards + the one summary strip", async () => {
    const { default: ConnectorsPage } = await import("@/app/(shell)/settings/connectors/page");
    const html = renderToStaticMarkup((await ConnectorsPage()) as ReactElement);
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
      const on = provider === "google_gsc" || provider === "wix";
      return { status: on ? "connected" : "disconnected", connected_at: on ? "2026-06-01T00:00:00.000Z" : null,
        expires_at: null, last_synced_at: on ? "2026-07-01T09:00:00.000Z" : null };
    });
    const { default: ConnectorsPage } = await import("@/app/(shell)/settings/connectors/page");
    expect(renderToStaticMarkup((await ConnectorsPage()) as ReactElement)).toContain("2 of 4 connected");
  });
});
