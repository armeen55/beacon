/** TODAY ANSWERS TWO QUESTIONS AND NOTHING ELSE: the one thing to do, and whether the last thing worked, both off the SAME ledger rows Results reads.
 *  Rendered through the real page component, so what is pinned here is what a customer sees rather than what a helper returns. Three promises the
 *  live screen broke: only a WIN was ever reported, so an account whose newest finished reading came in level or behind read a blank space as
 *  "nothing has happened"; the page it names was a raw address; and a finished reading the live page has never confirmed was offered as a result. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const LEDGER = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-one" }));
vi.mock("@/domains/account", () => ({ requireReadyAccount: async () => ({ access: { kind: "ready" } }) }));
vi.mock("@/domains/measurement", () => ({ loadProofLedgerCached: async () => LEDGER.rows }));
vi.mock("@/components/today/data-sources-strip", () => ({ countConnectedDataSources: async () => 2 }));
vi.mock("@/components/today/refresh-my-data-button", () => ({ RefreshMyDataButton: () => null }));
vi.mock("@/app/(shell)/scoreboard-section", () => ({ ScoreboardSection: () => null }));
vi.mock("@/app/(shell)/today-gate-data", () => ({ loadTodayV2GateData: async () => ({ unreadable: false, isDemoMode: false, firstReading: { isFirstReading: false, context: {} } }) }));
vi.mock("@/app/(shell)/today-view-data", () => ({ loadTodayView: async () => ({ today: { headerSentence: "One finished change is waiting.", nextOpportunities: [], readyTotal: 0 }, hasChanges: true }) }));
vi.mock("@/lib/perf-trace", () => ({ createPerfTrace: () => ({ time: async (_n: string, f: () => unknown) => f(), flush: () => {} }), readPerfTraceIdFromHeaders: async () => null }));
vi.mock("@/lib/load-with-deadline", () => ({ loadWithDeadline: async (p: Promise<unknown>) => ({ timedOut: false, data: await p }), valueWithDeadline: async (p: Promise<unknown>) => p }));

/** One ledger row in the shape Today's own loader hands over, with every window closed forty days back so the reading is mature whenever this runs. */
const day = (back: number): string => new Date(Date.now() - back * 86_400_000).toISOString();
const win = (lift: number) => [7, 14, 28].map((d) => ({ day: d, ran: true, controlsUsed: 3, adjustedLift: lift, adjustedCtrLift: lift / 2_000, adjustedImpressionsLift: 120, treatedPostImpressions: 5_000 })); // the click rate moves the way the clicks do, or a fixture claims one direction and is read in the other
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "s1", page: "https://own.example/california-persian-cities/beverly-hills", path: "/california-persian-cities/beverly-hills",
  actionType: "meta", verdict: "won", shippedAt: day(40), implementedAt: day(40),
  verification: { status: "verified", checkedAt: day(39) }, baseline: { clicks: 200, impressions: 9_100 }, windows: win(40), ...over });

/** The page wraps its own body in a Suspense boundary, and the static renderer paints the fallback rather than the async child, so the child is taken from the tree the page returned and awaited here. Nothing is stubbed in: this is the real component. */
async function today(): Promise<string> {
  const Page = (await import("@/app/(shell)/page")).default;
  const shell = await Page({ searchParams: Promise.resolve({}) }) as { props: { children: Array<{ props: { fallback?: unknown; children?: { type: (p: unknown) => Promise<ReactElement>; props: unknown } } }> } };
  const inner = shell.props.children.find((c) => c?.props?.fallback != null)!.props.children!;
  return renderToStaticMarkup(await inner.type(inner.props));
}

describe("Today says the one thing to do and whether the last thing worked", () => {
  it.each(["tenant-one", "tenant-two"])("names the page the way a person says it, never as an address, and reports a win with the number the ledger stored [%s]", async () => {
    LEDGER.rows = [row()];
    const html = await today();
    expect(html, "the page is NAMED, and its address never reaches the screen: Results has said the page this way since it was built and Today printed the slug beside it").toContain("Your last change to Beverly hills earned 40 more clicks than the pages that were not changed.");
    expect(html).not.toContain("/california-persian-cities/beverly-hills earned");
  });

  it.each(["tenant-one", "tenant-two"])("answers for a finished reading that did not win instead of saying nothing at all, and never calls an unconfirmed reading a result [%s]", async () => {
    LEDGER.rows = [row({ windows: win(-12) })];
    expect(await today(), "SILENCE IS NOT AN ANSWER: only a win was ever printed, so a reading that finished behind left the screen blank and the operator read that as nothing having happened").toContain("Your last change to Beverly hills finished 12 clicks behind the pages that were not changed.");
    LEDGER.rows = [row({ windows: win(0) })];
    expect(await today(), "and a reading that moved nothing says exactly that rather than printing a bare zero").toContain("Your last change to Beverly hills finished level with the pages that were not changed.");
    LEDGER.rows = [row({ verification: null })];
    expect(await today(), "AND A READING THE LIVE PAGE NEVER CONFIRMED IS NOT A RESULT: it carries the number it read and the reason it is not a win, in one sentence").toContain("read 40 clicks ahead of the pages that were not changed, and the live page has not confirmed the change yet, so it is not counted as a win.");
    LEDGER.rows = [];
    expect(await today(), "and an account with nothing settled prints no sentence at all rather than a zero").not.toContain("Your last change to");
  });
});

/** AND THE CARD THE OPERATOR OPENS BEFORE PASTING SAYS WHAT A LINE STANDS ON, IN WORDS (measured on a live account, 2026-09-05). "Stands on" printed the whole banked entry behind every cited id: 157 of 409 banked facts run past 400 characters and 142 past 800, the longest is 1,000, and 90 of 171 rows handed the operator a raw chunk of their own page's body, climate readings and bridge names included, under the one heading that is supposed to make a draft checkable. Across the account's 350 rendered claim lines that is 347,094 characters of evidence text, and the worst single line is 5,074. */
describe("the card says what a line stands on in words a person can check", () => {
  const card = (over: Record<string, unknown>) => ({ id: "tenant-one::/p::existing_edit::x", tenantId: "tenant-one", kind: "existing_edit", pagePath: "/p", pageUrl: "https://alpha.example/p", pageLabel: "P",
    primaryQuery: "tide pool safety", opportunityType: "Capture clicks", changeFamily: "section", status: "needs_review",
    recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Tide pools hold close to the ocean temperature until the sun warms the shallowest of them.", where: 'Under the heading "Tide pool safety"' },
    whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: "tide pool safety", hints: [], evidenceRefCount: 1 },
    impactScore: 10, upsidePerMonth: null, basis: "b", publish: "manual", createdAt: "2026-09-01T00:00:00.000Z", ...over });
  it.each(["tenant-one", "tenant-two"])("quotes a checked reading to the sentence that was checked, names the page's own words instead of reprinting them, and says an id once, on %s", async (t) => {
    const { SimpleDetail } = await import("@/app/(shell)/changes/[id]/bundle-detail");
    const dump = `top of page< BackTide PoolsTable of Contents${"A pool holds close to the ocean temperature until the sun warms it. ".repeat(14)}`;
    const html = renderToStaticMarkup(SimpleDetail({ proposal: card({ tenantId: t,
      claims: [{ text: "The pools hold close to the ocean temperature.", supportedBy: ["fact-1", "page-copy-1", "page-copy-2"] }, { text: "A second line stands on an id nobody banked." , supportedBy: ["fact-9"] }],
      supportFacts: [{ id: "fact-1", fact: `encyclopedia https://source.example/a says: "Tide pools track the ocean temperature closely." ${"Admitted at the confidence bar this reading was banked under. ".repeat(9)}` },
        { id: "page-copy-1", fact: dump }, { id: "page-copy-2", fact: dump }] }) as never } as never) as ReactElement);
    expect(html, "the checked reading is quoted to the sentence it was checked on").toContain("Tide pools track the ocean temperature closely.");
    expect(html.includes("Table of Contents") || html.includes("Admitted at the confidence bar"), "and neither the page's own body nor the rest of the banked entry is reprinted at the customer").toBe(false);
    expect(html, "the page's own words are named as what they are").toContain("the words already on this page");
    expect(html.split("the words already on this page").length - 1, "once, however many of the page's own ids a line cites").toBe(1);
    expect(html, "and an id with nothing banked behind it is still shown as unquoted rather than dressed up as evidence").toContain("the words behind this were not banked with the copy");
    expect(html.includes("temperature..") || html.includes("evidence.."), "no claim reaches the screen with two full stops").toBe(false);
  });
});
