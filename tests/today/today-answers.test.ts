import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SHIPMENT_PROOF } from "@/domains/measurement/proof-gsc/shipment-proof";
const LEDGER = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-one" }));
vi.mock("@/domains/account", () => ({ requireReadyAccount: async () => ({ access: { kind: "ready" } }), getTenant: vi.fn() }));
vi.mock("@/domains/measurement", async () => ({ loadProofLedgerCached: async () => LEDGER.rows, treatmentLearning: (await import("@/domains/measurement/treatment-learning")).treatmentLearning }));
vi.mock("@/components/today/data-sources-strip", () => ({ countConnectedDataSources: async () => 2 }));
vi.mock("@/components/today/refresh-my-data-button", () => ({ RefreshMyDataButton: () => null }));
vi.mock("@/app/(shell)/scoreboard-section", () => ({ ScoreboardSection: () => null }));
vi.mock("@/app/(shell)/today-gate-data", () => ({ loadTodayV2GateData: async () => ({ unreadable: false, isDemoMode: false, firstReading: { isFirstReading: false, context: {} } }) }));
vi.mock("@/app/(shell)/today-view-data", () => ({ loadTodayView: async () => ({ today: { headerSentence: "One finished change is waiting.", nextOpportunities: [], readyTotal: 0, preparing: { written: 19, researching: 90 } }, hasChanges: true, researchPaused: true }) }));
vi.mock("@/lib/perf-trace", () => ({ createPerfTrace: () => ({ time: async (_n: string, f: () => unknown) => f(), flush: () => {} }), readPerfTraceIdFromHeaders: async () => null }));
vi.mock("@/lib/load-with-deadline", () => ({ loadWithDeadline: async (p: Promise<unknown>) => ({ timedOut: false, data: await p }), valueWithDeadline: async (p: Promise<unknown>) => p }));

/** One ledger row in the shape Today's own loader hands over, with every window closed forty days back so the reading is mature whenever this runs. */
const day = (back: number): string => new Date(Date.now() - back * 86_400_000).toISOString();
const win = (lift: number) => [7, 14, 28].map((d) => ({ day: d, ran: true, controlsUsed: 3, adjustedLift: lift, adjustedCtrLift: lift / 2_000, adjustedImpressionsLift: 120, treatedPostImpressions: 5_000 })); // the click rate moves the way the clicks do, or a fixture claims one direction and is read in the other
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => { const r = {
  id: "s1", page: "https://own.example/california-persian-cities/beverly-hills", path: "/california-persian-cities/beverly-hills",
  actionType: "meta", verdict: "won", shippedAt: day(40), implementedAt: day(40),
  after: "The updated description.", controlsReceipt: [{ path: "/a" }, { path: "/b" }, { path: "/c" }], baseline: { clicks: 200, impressions: 9_100 }, windows: win(40), ...over };
  return { ...r, verification: "verification" in over ? over.verification : { status: "verified", checkedAt: day(39), checkerContract: SHIPMENT_PROOF.contract, proof: SHIPMENT_PROOF.of(r, "Inspected page"), components: [{ kind: "meta", state: "verified", note: null }] } }; };

/** The page wraps its own body in a Suspense boundary, and the static renderer paints the fallback rather than the async child, so the child is taken from the tree the page returned and awaited here. Nothing is stubbed in: this is the real component. */
async function today(): Promise<string> {
  const Page = (await import("@/app/(shell)/page")).default;
  const shell = await Page({ searchParams: Promise.resolve({}) }) as { props: { children: Array<{ props: { fallback?: unknown; children?: { type: (p: unknown) => Promise<ReactElement>; props: unknown } } }> } };
  const inner = shell.props.children.find((c) => c?.props?.fallback != null)!.props.children!;
  return renderToStaticMarkup(await inner.type(inner.props));
}

describe("Today says whether the last recorded change worked", () => {
  it("distinguishes a win, loss, level result, unconfirmed reading and no record", async () => {
    for (const [input, expected] of [
      [row(), /Beverly hills earned 40 more clicks/],
      [row({ windows: win(-12) }), /Beverly hills finished 12 clicks behind/],
      [row({ windows: win(0) }), /Beverly hills finished level/],
      [row({ verification: null }), /live page has not confirmed the change yet, so it is not counted as a win/],
      [row({ verification: null, windows: win(-12) }), /read 12 clicks behind.*live page has not confirmed/],
    ] as const) { LEDGER.rows = [input]; const html = await today(); expect(html).toMatch(expected); expect(html).not.toContain("/california-persian-cities/beverly-hills earned"); expect(html).toContain("19 changes have draft copy but are not ready to apply, and 90 opportunities do not yet have a finished change."); expect(html).toContain("Research is paused, so no new opportunity is being worked on"); }
    LEDGER.rows = []; expect(await today()).not.toContain("Your last change to");
  });
});

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
      supportFacts: [{ id: "fact-1", fact: `encyclopedia says: "Tide pools track the ocean temperature closely." ${"Admitted at the confidence bar this reading was banked under. ".repeat(9)}`, sources: [{ url: "https://source.example/a", kind: "encyclopedia" }] },
        { id: "page-copy-1", fact: dump }, { id: "page-copy-2", fact: dump }] }) as never } as never) as ReactElement);
    expect(html, "the checked reading is quoted to the sentence it was checked on").toContain("Tide pools track the ocean temperature closely.");
    expect(html.includes("Table of Contents") || html.includes("Admitted at the confidence bar"), "and neither the page's own body nor the rest of the banked entry is reprinted at the customer").toBe(false);
    expect(html, "the page's own words are named as what they are").toContain("the words already on this page");
    expect(html.split("the words already on this page").length - 1, "once, however many of the page's own ids a line cites").toBe(1);
    expect(html, "and an id with nothing banked behind it is still shown as unquoted rather than dressed up as evidence").toContain("the words behind this were not banked with the copy");
    expect([html.includes("temperature..") || html.includes("evidence.."), html.includes('href="https://source.example/a"'), html.includes("encyclopedia source")], "the line has clean punctuation and keeps the exact publisher link and source class").toEqual([false, true, true]);
  });
  it("gives an atomic edit the same diagnosis, falsifier and ranking investigation as a deep bundle", async () => { const { SimpleDetail } = await import("@/app/(shell)/changes/[id]/bundle-detail"), html = renderToStaticMarkup(SimpleDetail({ proposal: card({ causeFinding: { cause: "ranking_loss", action: "act_existing_page", evidenceKeys: ["gsc"], competingExplanations: [{ cause: "ctr_snippet", reason: "the click rate held while the position fell" }], notConsidered: [], explanation: "This page lost ground while people kept searching.", falsifier: "If its position recovers without the section, this diagnosis is wrong." }, rankingReceipt: { score: 44, directional: false, basis: "current evidence", factors: [{ name: "visibility", input: "This page lost 44 clicks in the measured window.", contribution: 30, max: 40 }] } }) as never } as never) as ReactElement); for (const line of ["How this was worked out", "This page lost ground while people kept searching.", "the click rate held while the position fell", "If its position recovers without the section, this diagnosis is wrong.", "No attributable click figure backs this saved ranking receipt."]) expect(html).toContain(line); expect(html).not.toContain("This page lost 44 clicks in the measured window."); });
});
