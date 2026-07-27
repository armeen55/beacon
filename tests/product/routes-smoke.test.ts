/** Four-surface smoke (Core 100K product contract): Today, Changes, Results, Connections each render
 *  their frame without throwing, plus the Today claims a stranger reads first (the ready count, the one
 *  CTA, the hero chart sentence). Deep behavior lives in the kept behavioral contract suites. */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server"; import type { ReactElement } from "react";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => {
  const redirected = (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); };
  return { permanentRedirect: redirected, redirect: redirected, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(), usePathname: () => "/settings/connectors" }; });
vi.mock("@/lib/connector-store", async () => ({
  ...(await vi.importActual<typeof import("@/lib/connector-store")>("@/lib/connector-store")),
  getConnectorInfo: vi.fn(async () => ({ status: "disconnected" as const, connected_at: null, expires_at: null, last_synced_at: null })),
  getGoogleConnectorToken: vi.fn(async () => null), getYelpConnectorToken: vi.fn(async () => null) }));
vi.mock("@/domains/runtime/ops/refresh-runs-store", () => ({ latestRefreshBySource: vi.fn(async () => ({})) }));
vi.mock("@/domains/runtime/research-run", () => ({ researchRunStatus: vi.fn(async () => ({ state: "none",
  phaseLabel: "", stepsDone: 0, stepsTotal: 3, counters: {}, updatedAt: null, completedAt: null })) }));
// The smoke suite pins frames; lifecycle gating has its own behavioral tests.
vi.mock("@/domains/account/lifecycle", () => ({ requireReadyAccount: vi.fn(async () => ({ access: { kind: "ready", account: { status: "active" } } })),
  resolveAccountAccess: vi.fn(async () => ({ kind: "ready", account: { status: "active" } })), AccountUnavailableError: class extends Error {} }));

describe("Today renders, and tells the truth about its own queue", () => {
  it.each([["@/app/(shell)/page", ["max-w-3xl", 'aria-label="Loading today"']], ["@/app/(shell)/changes/page", ["Changes", "ranked execution queue"]],
    ["@/app/(shell)/results/page", ["Results", "7, 14, and 28 days"]]] as const)("renders the %s frame without throwing", async (mod, claims) => {
    const { default: Page } = await import(mod) as { default: (a?: unknown) => Promise<ReactElement> };
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    for (const claim of claims) expect(html).toContain(claim);
  }, 15_000);

  const readyView = (n: number, measuring: number) => ({
    ready: Array.from({ length: n }, (_, i) => ({ id: `t::/p${i}::existing_edit::title`, pagePath: `/p${i}`, pageUrl: null, pageLabel: `P${i}`, primaryQuery: "q",
      opportunityType: "Sharpen the title", estimatedEffortMinutes: 2, upsidePerMonth: null, confidence: "high", recommendedChange: { kind: "existing_edit", field: "title" } })),
    toDo: [], measuringCountCanonical: measuring,
  } as unknown as import("@/app/(shell)/changes-data").ChangesView);

  it("counts EVERY ready change and says the five it previews are a preview", async () => {
    const { buildTodayViewFromChanges } = await import("@/app/(shell)/today-view-data");
    const view = buildTodayViewFromChanges(readyView(12, 3));
    expect(view.headerSentence).toBe("You have 12 changes ready; here are the five strongest. 3 more are still measuring.");
    const { buildScoreboard } = await import("@/domains/measurement"); // ONE COUNT RULE: the header owns "N measuring", the chart never repeats it
    expect(buildScoreboard([{ date: "2026-07-01", clicks: 10, impressions: 0 }, { date: "2026-07-20", clicks: 20, impressions: 0 }], [], new Date("2026-07-21T00:00:00Z"))?.verdictLine ?? "").not.toMatch(/measuring/i);
    expect(view.nextOpportunities).toHaveLength(5);
    expect(view.readyFixes).toHaveLength(12); // every ready page is linkable, not just the previewed five
    expect(buildTodayViewFromChanges(readyView(1, 0)).headerSentence).toBe("You have 1 change ready to apply.");
  });

  const STILL_CHECKING = "I found meaningful traffic gaps, but I am still checking the results pages and competing pages before asking you to change anything.";
  const alarm = (actionLabel: string, href: string) => ({ page: "/famous-iranian-comedians", pageKey: "/famous-iranian-comedians", clicksLost: 163,
    windowLabel: "the previous 4 weeks", sentence: "", href, actionLabel, hasReadyFix: actionLabel === "See the fix" });
  const command = (over: Record<string, unknown>) => ({ pipelineAlarms: [], smokeAlarm: null, scoreboardDeltaPct: -12, topOpportunity: null, firstReadOn: null, measuringCount: 0, ...over });

  it("never sends you to fix a page the decision resolved to watch, and says plainly that it is still checking", async () => {
    const { buildTodayCommand } = await import("@/domains/measurement");
    const watching = "Traffic fell here, but its search click-through is healthy, so I am watching it rather than asking you to rewrite a page that is winning.";
    const held = buildTodayCommand(command({ smokeAlarm: alarm("Open Changes", "/changes"), declineVerdict: watching }));
    expect(held.headline).toBe(STILL_CHECKING); expect(held.why[0]).toBe(watching); expect(held.cta).toBeNull(); // no "Open Changes" for a page with no fix
    const ready = buildTodayCommand(command({ smokeAlarm: alarm("See the fix", "/changes/abc") })); // a decline WITH a ready fix still takes over
    expect(ready.kind).toBe("respond_to_loss"); expect(ready.exactAction).toContain("apply the fix"); expect(ready.cta).toEqual({ label: "See the fix", href: "/changes/abc" });
    const { buildTodayViewFromChanges } = await import("@/app/(shell)/today-view-data");
    const empty = { ready: [], toDo: [], measuringCountCanonical: 0, proposals: [] } as unknown as import("@/app/(shell)/changes-data").ChangesView;
    expect(buildTodayViewFromChanges(empty, { outcome: "actionable_but_no_trusted_draft" }).headerSentence).toBe(STILL_CHECKING);
    expect(buildTodayViewFromChanges(empty).headerSentence).toContain("Nothing needs a decision today."); }); // a genuinely quiet day still reads quiet

  it("points a bleeding page at its own ready fix, and never at a route that does not exist", async () => {
    const { buildTodaySmokeAlarm } = await import("@/components/today/today-smoke-alarm");
    const decay = [{ page: "https://site.example/nowruz", clicksNow: 10, clicksPrior: 60 }];
    const fixed = buildTodaySmokeAlarm({ decay, readyFixes: new Map([["/nowruz", "t::/nowruz::existing_edit::title"]]) })!;
    const bare = buildTodaySmokeAlarm({ decay, readyFixes: new Map() })!;
    expect(fixed.href).toBe(`/changes/${encodeURIComponent("t::/nowruz::existing_edit::title")}`);
    expect(fixed.actionLabel).toBe("See the fix"); expect(fixed.sentence).toContain("I have a fix ready.");
    expect(bare.href).toBe("/changes"); expect(bare.actionLabel).toBe("Open Changes"); expect(bare.sentence).not.toContain("fix ready");
    for (const href of [fixed.href, bare.href]) expect(href.startsWith("/page/")).toBe(false); // never a route that does not exist
    const long = "/" + "a".repeat(60); // the DISPLAY label truncates; the key any lookup matches on must not
    const wide = buildTodaySmokeAlarm({ decay: [{ page: `https://site.example${long}`, clicksNow: 10, clicksPrior: 60 }], readyFixes: new Map() })!;
    expect(wide.page.endsWith("...")).toBe(true); expect(wide.pageKey).toBe(long); });

});

describe("Connectors settings route smoke", () => {
  it("renders the connector page with the shipped cards + the one summary strip", async () => {
    const { default: ConnectorsPage } = await import("@/app/(shell)/settings/connectors/page");
    const html = renderToStaticMarkup((await ConnectorsPage()) as ReactElement);
    for (const claim of ["Connect your tools", "Connect Google Search Console", 'data-connector-card="google-ga4"',
      'data-connector-card="clarity"', 'data-connectors-summary-strip="true"', "I never touch your live site"]) expect(html).toContain(claim);
    expect(html).not.toContain("Enter Yelp API Key");
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
