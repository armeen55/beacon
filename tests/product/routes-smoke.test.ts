/** Four-surface smoke (Core 100K product contract): Today, Changes, Results, Connections each render their frame without throwing, plus the Today claims a stranger reads first (the ready count, the one CTA, the hero chart sentence). Deep behavior lives in the kept behavioral contract suites. */
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
  phaseLabel: "", stepsDone: 0, stepsTotal: 3, counters: {}, updatedAt: null, completedAt: null })) })); // The smoke suite pins frames; lifecycle gating has its own behavioral tests.
vi.mock("@/domains/account/lifecycle", () => ({ requireReadyAccount: vi.fn(async () => ({ access: { kind: "ready", account: { status: "active" } } })),
  resolveAccountAccess: vi.fn(async () => ({ kind: "ready", account: { status: "active" } })), AccountUnavailableError: class extends Error {} }));

/** THE LEDGER READ, as its two DIFFERENT answers, driven from THE STORE rather than from a stub of the module that decides. It only ever had one answer: every layer swallowed a failed read into an empty list, so a database outage rendered the one sentence that tells an operator to stop expecting measurement ("No changes are being measured yet") over an account with a full ledger. `ledgerError` is what Supabase hands back; every other table reads clean and empty. */
vi.mock("next/server", async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} })); // after() is only legal in a request scope, so the background rebuild it schedules is a no-op here; the RENDER path is what is under test.
const DB = vi.hoisted(() => ({ ledgerError: null as { code: string; message: string } | null }));
vi.mock("@/lib/persistence/supabase", async (orig) => ({ ...(await orig<Record<string, unknown>>()), isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({ from: (table: string) => { const q: Record<string, unknown> = {};
    const answer = () => Promise.resolve(table === "shipped_change_proof" && DB.ledgerError ? { data: null, error: DB.ledgerError } : { data: [], error: null });
    for (const k of ["select", "eq", "in", "not", "is", "gte", "lte", "order", "limit"]) q[k] = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => answer().then(res, rej);
    return q; } }) }));

describe("Today renders, and tells the truth about its own queue", () => {
  it.each([["@/app/(shell)/page", ["max-w-3xl", 'aria-label="Loading today"']], ["@/app/(shell)/changes/page", ["Changes", "Finished changes first"]],
    ["@/app/(shell)/results/page", ["Results", "7, 14 and 28 days"]]] as const)("renders the %s frame without throwing", async (mod, claims) => {
    const { default: Page } = await import(mod) as { default: (a?: unknown) => Promise<ReactElement> };
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    for (const claim of claims) expect(html).toContain(claim);
  }, 15_000);
  it("says it could not read the measured changes, and never that there are none, when THE STORE itself errors", async () => {
    const { default: Page } = await import("@/app/(shell)/results/page") as { default: (a?: unknown) => Promise<ReactElement> };
    DB.ledgerError = { code: "PGRST301", message: "JWT expired" }; // The failure enters where it really enters: Supabase hands the ledger table back an error, three layers under the page.
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Your measured changes could not be read just now, so none is not the answer.");
    expect(html).not.toContain("No changes are being measured yet");
    DB.ledgerError = { code: "PGRST205", message: "Could not find the table in the schema cache" }; // AND THE MISSING-TABLE CASE IS STILL A VALID EMPTY: the file fallback is how a pre-migration deploy reads, not an outage.
    const fallback = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(fallback).not.toContain("could not be read just now");
    DB.ledgerError = null; }, 15_000);
  const readyView = (n: number, measuring: number) => ({
    ready: Array.from({ length: n }, (_, i) => ({ id: `t::/p${i}::existing_edit::title`, pagePath: `/p${i}`, pageUrl: null, pageLabel: `P${i}`, primaryQuery: "q",
      opportunityType: "Sharpen the title", recommendedChange: { kind: "existing_edit", field: "title" } })),
    toDo: [], measuringCountCanonical: measuring,
  } as unknown as import("@/app/(shell)/changes-data").ChangesView);
  const NO_WORK = "No finished change is ready today. The next one lands here the moment the exact work is written.";
  // EVERY CHANGE THE HEADER COUNTS IS FINISHED WORK, three of them are previewed, and an empty day says which empty it is: a quiet queue is not a quiet account and not a report either, and an unfinished opportunity is a status count, never an edit.
  it("counts every finished change, previews three, and says no finished change is ready when there are none", async () => {
    const { buildTodayViewFromChanges } = await import("@/app/(shell)/today-view-data");
    const view = buildTodayViewFromChanges(readyView(12, 3));
    const empty = { ready: [], toDo: [], measuringCountCanonical: 0, proposals: [] } as unknown as import("@/app/(shell)/changes-data").ChangesView;
    // PRODUCTION, 2026-08-15: three ready and one in review, and this sentence said "You have 4 finished changes ready to make". FINISHED COUNTS FINISHED. The review card is counted in its own clause, is never previewed, and is never the edit Today leads with: a card the queue holds back cannot be the thing to do first.
    const live = { ...readyView(3, 0), toDo: [readyView(1, 0).ready[0]!], summary: { ready: 3, todo: 1 } } as unknown as import("@/app/(shell)/changes-data").ChangesView;
    const mixed = buildTodayViewFromChanges(live), reviewOnly = buildTodayViewFromChanges({ ...live, ready: [], summary: { ready: 0, todo: 1 } } as never);
    expect([mixed.headerSentence, mixed.readyTotal, mixed.toDoTotal, mixed.nextOpportunities.length, reviewOnly.headerSentence, reviewOnly.topEdit])
      .toEqual(["You have 3 finished changes ready to make, best first.", 3, 1, 3,
        "No finished change is ready today. The next one lands here the moment the exact work is written.", undefined]);
    expect([view.headerSentence, view.nextOpportunities.length, buildTodayViewFromChanges(readyView(1, 0)).headerSentence,
      buildTodayViewFromChanges(empty, { outcome: "actionable_but_no_trusted_draft" }).headerSentence, buildTodayViewFromChanges(empty).headerSentence,
      buildTodayViewFromChanges({ ...empty, summary: { ...empty.summary, research: 7 } }).headerSentence])
      .toEqual(["You have 12 finished changes ready to make, best first.", 3, "You have 1 finished change ready to make, best first.", NO_WORK, NO_WORK,
        NO_WORK]);
    // TODAY NEVER LEADS WITH RESEARCH WHILE ANY FINISHED CHANGE EXISTS (operator, 2026-08-22): a research row outranking the one ready change globally still cedes the top slot to the finished work.
    const rv = readyView(1, 0), research = { ...rv.ready[0]!, id: "t::/r::existing_edit::researching", researchOnly: true };
    const led = buildTodayViewFromChanges({ ...rv, research: [research], proposals: [research, rv.ready[0]!],
      summary: { ready: 1, todo: 0, research: 1 } } as never);
    expect(led.nextOpportunities[0]!.lane).toBe("ready");
    const { buildScoreboard } = await import("@/domains/measurement"); // ONE COUNT RULE: the header owns "N measuring", the chart never repeats it
    expect(buildScoreboard([{ date: "2026-07-01", clicks: 10, impressions: 0 }, { date: "2026-07-20", clicks: 20, impressions: 0 }], [], new Date("2026-07-21T00:00:00Z"))?.verdictLine ?? "").not.toMatch(/measuring/i); });
});

describe("Connectors settings route smoke", () => {
  it("renders the connector page with the shipped cards + the one summary strip", async () => {
    const { default: ConnectorsPage } = await import("@/app/(shell)/settings/connectors/page");
    const html = renderToStaticMarkup((await ConnectorsPage()) as ReactElement);
    for (const claim of ["Connect your tools", "Connect Google Search Console", 'data-connector-card="google-ga4"',
      'data-connector-card="clarity"', 'data-connectors-summary-strip="true"', "Your live site is never touched"]) expect(html).toContain(claim);
    expect(html).not.toContain("Enter Yelp API Key"); expect(html).not.toContain("Wix"); // Wix left the customer product
  });
  it("computes 'N of M connected' from provider reads and surfaces the on-use receipt", async () => {
    const { getConnectorInfo } = await import("@/lib/connector-store");
    vi.mocked(getConnectorInfo).mockImplementation(async (provider: string) => {
      const on = provider === "google_gsc" || provider === "clarity";
      return { status: on ? "connected" : "disconnected", connected_at: on ? "2026-06-01T00:00:00.000Z" : null,
        expires_at: null, last_synced_at: on ? "2026-07-01T09:00:00.000Z" : null };
    });
    const { default: ConnectorsPage } = await import("@/app/(shell)/settings/connectors/page");
    expect(renderToStaticMarkup((await ConnectorsPage()) as ReactElement)).toContain("2 of 3 connected");
  });
});
