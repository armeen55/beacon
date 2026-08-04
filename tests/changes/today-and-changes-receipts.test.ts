/** V1 Truth Convergence Phase 8 — TODAY AND CHANGES. Today is in exactly one of four primary states
 *  and never two at once; a screen with pages losing clicks can never read as all clear; the ranked
 *  queue explains its own order; and a change detail hands over the whole investigation, the pieces
 *  picker and the override. Every test name states the promise it pins. Fixtures only. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server"; import { createElement, type ReactElement } from "react";
import { buildTodayCommand, commandAllowsCelebration, type TodayCommandInput, type TodayOpportunity } from "@/domains/measurement/today/today-command";
import type { CauseFinding, ChangeProposal, RankedProposalQueue } from "@/domains/decision";
import type { ChangesView } from "@/app/(shell)/changes-data";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => { const redirected = (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); };
  return { redirect: redirected, permanentRedirect: redirected, notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    usePathname: () => "/changes", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }; });
vi.mock("@/domains/account/lifecycle", () => ({ requireReadyAccount: vi.fn(async () => ({ access: { kind: "ready", account: { status: "active" } } })),
  resolveAccountAccess: vi.fn(async () => ({ kind: "ready", account: { status: "active" } })), AccountUnavailableError: class extends Error {} }));
vi.mock("@/lib/tenant-context", async () => ({ ...(await vi.importActual<typeof import("@/lib/tenant-context")>("@/lib/tenant-context")),
  currentTenantId: vi.fn(async () => "t") }));
vi.mock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
  loadProposalQueue: vi.fn(), loadChangeProposal: vi.fn(), resolveCurrentBasis: vi.fn() }));

// ── Today: the four primary states ───────────────────────────────────────────

const OPP: TodayOpportunity = { changeId: "c1", pageLabel: "/nowruz-guide", recommendation: "Answer the exact question people search",
  opportunityType: "Capture clicks", estimatedEffortMinutes: 4, upside: 210, evidenceStrength: "strong",
  whyRankedAboveNext: "I put this ahead of the change for \"haft seen\" because it wins back more of what you are losing." };
const SECOND: TodayOpportunity = { ...OPP, changeId: "c2", pageLabel: "/haft-seen", recommendation: "Cover the table the winners all cover", whyRankedAboveNext: undefined };
const LOSING = { page: "/famous-iranian-comedians", pageKey: "/famous-iranian-comedians", clicksLost: 163,
  windowLabel: "the previous 4 weeks (data through Jul 9)", sentence: "", href: "/changes", actionLabel: "Open Changes", hasReadyFix: false };
const base: TodayCommandInput = { blockers: [], smokeAlarm: null, scoreboardDeltaPct: null, readyChanges: [], firstReadOn: null, measuringCount: 0 };

describe("Today is in exactly one of four primary states", () => {
  it("a genuine blocker outranks everything, and it is the only thing that does", () => {
    const c = buildTodayCommand({ ...base, blockers: ["I am not tracking any questions for you yet, so my research cannot start."],
      blockerHref: "/settings/config#tracked-ai-prompts", readyChanges: [OPP], measuringCount: 4 });
    expect([c.state, c.why[0]!.includes("I am not tracking any questions for you yet")]).toEqual(["needs_attention", true]);
    expect(c.cta).toEqual({ label: "Fix this now", href: "/settings/config#tracked-ai-prompts" });
    expect(c.ranked).toEqual([]); // a blocked day does not also hand you work
  });
  it("one ready change is act now, and the top three carry the ranker's own reason for the order", () => {
    const c = buildTodayCommand({ ...base, readyChanges: [OPP, SECOND], measuringCount: 9 });
    expect([c.state, c.headline]).toEqual(["act_now", "Do this next: Answer the exact question people search."]);
    expect([c.ranked.map((r) => r.changeId), c.ranked[0]!.whyRankedAboveNext!.includes("I put this ahead of")]).toEqual([["c1", "c2"], true]);
    expect(c.why).toContain("About 4 minutes of work.");
    expect(c.why.some((l) => l.includes("1 more change is ranked under it"))).toBe(true);
  });
  it("a promised retry date is researching, and it names the date instead of claiming to be checking", () => {
    const c = buildTodayCommand({ ...base, waitingUntil: "2026-08-04T18:00:00.000Z", measuringCount: 2 });
    expect([c.state, c.cta]).toEqual(["researching", null]);
    expect([c.headline.includes("waiting until August 4 to try them again"), /checking/i.test(c.headline)]).toEqual([true, false]);
    expect(c.exactAction).toContain("There is nothing for you to do here today");
  });
  it("researching carries the run's own persisted numbers, the open topics, and the drafts I held back", () => {
    const c = buildTodayCommand({ ...base, measuringCount: 3, heldForMeasurement: 2,
      research: { running: true, phaseLabel: "reading the results pages for your strongest topics", checksDone: 7, checksTotal: 12, casesActive: 5 } });
    expect(c.state).toBe("researching");
    expect(c.headline).toBe("I am researching right now: reading the results pages for your strongest topics.");
    expect(c.why).toContain("7 of 12 AI checks done today.");
    expect(c.why).toContain("5 topics are still open.");
    expect(c.why.some((l) => l.includes("holding 2 new ideas back because those pages already carry a change I am measuring"))).toBe(true);
  });
  it("work you applied and nothing stronger is monitoring, and a cold account is never a bare zero", () => {
    const c = buildTodayCommand({ ...base, measuringCount: 6, firstReadOn: "2026-08-12", research: { running: false } });
    expect([c.state, c.headline, c.why[0]]).toEqual(["monitoring", "6 changes are live and measuring.", "The first read lands around August 12."]);
    expect(c.cta).toEqual({ label: "See what's measuring", href: "/results" });
    // Nothing measuring, nothing ready, nothing running: still one state, and still something true.
    const cold = buildTodayCommand(base); expect(cold.state).toBe("researching");
    expect(cold.headline).toBe("I am still gathering evidence, and I will rank your next move here as soon as one earns it.");
    expect(cold.headline).not.toMatch(/\b0\b/);
  });
  it("gives ONE queue ONE number: the card counts what is ranked, never the preview it was cut from", () => {
    const preview = [OPP, SECOND, { ...SECOND, changeId: "c3" }, { ...SECOND, changeId: "c4" }, { ...SECOND, changeId: "c5" }];
    const c = buildTodayCommand({ ...base, readyChanges: preview, readyTotal: 12 });
    expect(c.why.some((l) => l.includes("11 more changes are ranked under it"))).toBe(true);
    expect(c.why.some((l) => l.includes("4 more"))).toBe(false); // the preview length is not a queue size
    expect(c.ranked).toHaveLength(3); // the card may still render three of them
  });
  it("keeps monitoring when nothing is actually running, and says the numbers monitoring owes", () => {
    // A proven loss nobody is working and an idea held back are facts, not present-tense work.
    const held = buildTodayCommand({ ...base, measuringCount: 6, heldForMeasurement: 2, firstReadOn: "2026-08-12", research: { running: false } });
    expect([held.state, held.why[0], held.why.some((l) => l.includes("holding 2 new ideas back"))]).toEqual(["monitoring", "The first read lands around August 12.", true]);
    expect(held.cta).toEqual({ label: "See what's measuring", href: "/results" });
    const watching = buildTodayCommand({ ...base, measuringCount: 6, investigating: 2, research: { running: false } });
    expect([watching.state, watching.why.some((l) => l.includes("I found 2 pages losing clicks"))]).toEqual(["monitoring", true]);
    // A run that IS open is researching, and it still owes the measuring count and the read date.
    const running = buildTodayCommand({ ...base, measuringCount: 4, investigating: 2, firstReadOn: "2026-08-12",
      research: { running: true, phaseLabel: "reading the results pages for your strongest topics" } });
    expect(running.state).toBe("researching");
    expect(running.why).toEqual(expect.arrayContaining(["4 of your changes are still measuring.", "The first read on those lands around August 12."]));
  });
  it("every combination of signals lands on exactly one of the four, and never a fifth", () => {
    const cases: TodayCommandInput[] = [base, { ...base, readyChanges: [OPP] }, { ...base, investigating: 3 },
      { ...base, measuringCount: 5, research: { running: false } }, { ...base, blockers: ["Search Console stopped answering me."] },
      { ...base, measuringCount: 5, research: { running: false }, smokeAlarm: LOSING }];
    const states = cases.map((c) => buildTodayCommand(c).state);
    expect(states).toEqual(["researching", "act_now", "researching", "monitoring", "needs_attention", "monitoring"]);
  });
});

describe("a screen with losses on it never reads as all clear", () => {
  const quiet = { ...base, measuringCount: 6, research: { running: false } };
  it("a losing page is said in the quiet states too, in the kernel's own words when it has them", () => {
    const watching = "Traffic fell here, but its search click-through is healthy, so I am watching it rather than asking you to rewrite a page that is winning.";
    const monitoring = buildTodayCommand({ ...quiet, smokeAlarm: LOSING, declineVerdict: watching });
    expect([monitoring.state, monitoring.losingNote]).toEqual(["monitoring", watching]);
    const researching = buildTodayCommand({ ...base, smokeAlarm: LOSING });
    expect(researching.losingNote).toContain("lost 163 clicks vs the previous 4 weeks (data through Jul 9)");
    expect(researching.losingNote).toContain("I have not found a change on it my evidence supports yet");
    const sitewide = buildTodayCommand({ ...quiet, scoreboardDeltaPct: -14 }); // nobody to blame, still a sentence
    expect(sitewide.losingNote).toMatch(/down 14% vs the week before[\s\S]*no single page took the blame/);
    expect(buildTodayCommand(quiet).losingNote).toBeNull(); // a genuinely clean day claims nothing
  });
  it("the greeting never celebrates on a screen that names a blocker or a loss", () => {
    expect(commandAllowsCelebration(buildTodayCommand(quiet))).toBe(true);
    expect(commandAllowsCelebration(buildTodayCommand({ ...quiet, smokeAlarm: LOSING }))).toBe(false);
    expect(commandAllowsCelebration(buildTodayCommand({ ...base, blockers: ["Search Console stopped answering me."] }))).toBe(false);
  });
});

// ── Changes: the receipts reach the operator ─────────────────────────────────

const ID = "t::/nowruz-guide::existing_edit::bundle";
const FINDING: CauseFinding = {
  cause: "cannibalization", action: "consolidate", evidenceKeys: ["gsc"],
  explanation: "2 of your own pages come up for \"nowruz traditions\", so Google is choosing between them every time somebody searches it.",
  competingExplanations: [{ cause: "ctr_snippet", reason: "a sharper line cannot fix two of your own pages competing for the same search" }],
  falsifier: "If my next look shows only one page of yours coming up for \"nowruz traditions\", this is not the explanation.",
  notConsidered: [{ cause: "technical_indexability", missing: "I do not hold this page's indexing or canonical state." }],
};
const proposal = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: ID, kind: "existing_edit", pagePath: "/nowruz-guide", pageUrl: "https://site.example/nowruz-guide", pageLabel: "Nowruz guide",
  primaryQuery: "nowruz traditions", opportunityType: "Capture clicks", changeFamily: "title", status: "ready",
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" },
  whyItMatters: "This page lost 163 clicks last month.", estimatedEffortMinutes: 6, riskLevel: "low", confidence: "high",
  limitations: [], evidence: { query: "nowruz traditions", hints: ["1,200 impressions and 9 clicks for that search."], evidenceRefCount: 2 },
  impactScore: 163, upsidePerMonth: 210, tenantId: "t", basis: "basis_now::d4", publish: "manual", createdAt: "2026-07-31T00:00:00.000Z",
  whyRankedAboveNext: "I put this ahead of the change for \"haft seen\" because it wins back more of what you are losing: about 163 clicks against about 20 clicks.",
  causeFinding: FINDING, diagnosisCause: "cannibalization",
  rankingReceipt: { score: 512, directional: false, basis: "I ranked this on about 163 clicks I can show are recoverable, 2 pieces of evidence, and what it takes you to do.",
    factors: [{ name: "actionability", input: "this draft passed every safety check", contribution: 500, max: 500 },
      { name: "overlap", input: "this page already has a change I am measuring", contribution: -30, max: 30 },
      { name: "strategic", input: "0 questions your customers actually ask are in scope", contribution: 0, max: 10 }] },
  bundle: { objective: "Settle which page owns that search before changing a word on either of them.",
    metric: "clicks from that search", measurementPlan: "I compare the next 28 days with the last 28.",
    scope: { queries: ["nowruz traditions"], prompts: [] }, confidenceReasons: ["163 clicks lost in 4 weeks"],
    alternatives: [{ option: "Rewrite the title", reason: "it cannot fix two of your pages competing" }], risks: [],
    components: [{ kind: "title", label: "Page title", risk: "safe", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table", evidenceKeys: ["k1"],
      where: "the page title itself", objective: "Say what this page answers.", mechanism: "The line a searcher reads is what wins the click.",
      sourcePack: { sourceRequirements: ["The date needs a source a reader can check."], factRequirements: ["Nowruz falls on the spring equinox."] } },
      { kind: "canonical", label: "Canonical tag", risk: "dangerous", before: null, after: "Point /haft-seen at this page.", evidenceKeys: ["k1"] }],
    receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "1,200 impressions and 9 clicks for that search.", observedAt: "2026-07-25T00:00:00.000Z" }],
      missing: [], freshestObservedAt: "2026-07-25T00:00:00.000Z" } },
  ...over,
} as ChangeProposal);
/** The same change with only its one safe piece: nothing to pick between, and no hold to claim. */
const atomic = (): ChangeProposal => proposal({ bundle: { ...proposal().bundle!, components: [proposal().bundle!.components[0]!] } });

const viewOf = (rows: ChangeProposal[]): ChangesView => ({
  proposals: rows, ready: rows, toDo: [], summary: { todo: 0, ready: rows.length, implemented: 0, measuring: 0, results: 0 },
  measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0, readyZeroHint: null, receiptLine: null,
  surfaceComputedAt: "2026-07-31T00:00:00.000Z", surfaceBuilding: false });

async function renderList(view: ChangesView): Promise<string> {
  const { ChangesListClient } = await import("@/app/(shell)/changes-list-client");
  return renderToStaticMarkup(createElement(ChangesListClient, { view }));
}
async function renderDetail(p: ChangeProposal): Promise<string> {
  const { loadChangeProposal, resolveCurrentBasis } = await import("@/domains/decision");
  vi.mocked(loadChangeProposal).mockResolvedValue(p);
  vi.mocked(resolveCurrentBasis).mockResolvedValue(p.basis ?? null);
  const { default: Page } = await import("@/app/(shell)/changes/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: encodeURIComponent(p.id) }) }) as ReactElement);
}

describe("a ranked card explains itself without being opened", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows the shape of the change, the exact action, effort, risk, evidence, and why it outranks the next one", async () => {
    const html = await renderList(viewOf([proposal()]));
    for (const s of ["Bundled change", "Settle which page owns that search", "about 6 min", "Low risk",
      "Strong evidence", "it wins back more of what you are losing", "Put this aside"]) expect(html, s).toContain(s);
    expect(await renderList(viewOf([atomic()]))).toContain("One edit"); // one component is one edit, never a bundle
  });
  // PIN (B, F6): "Implemented 0 · Measuring 0 · Results 0" told a quiet account nothing and asked nothing.
  it("tells a quiet account what is not moving yet, and shows only the counts that exist", async () => {
    const quiet = await renderList(viewOf([proposal()])); const view = viewOf([proposal()]);
    expect(quiet).toContain("Nothing implemented yet. Ship your first ready change and I start measuring it.");
    expect(quiet).not.toMatch(/Implemented 0|Measuring 0|Results 0/);
    const moving = await renderList({ ...view, summary: { ...view.summary, measuring: 2 } });
    expect([moving.includes("Measuring 2"), /Implemented 0|Results 0/.test(moving)]).toEqual([true, false]);
  });
  it("a change that moves or hides a page carries its two-step hold on the card", async () => {
    const html = await renderList(viewOf([proposal()]));
    for (const s of ["Canonical tag", "changes where the page lives or whether people can find it",
      "read once and confirm before you make the change"]) expect(html, s).toContain(s);
    expect(await renderList(viewOf([atomic()]))).not.toContain("changes where the page lives"); // nothing dangerous, no hold
  });
});

describe("a change detail hands over the whole investigation and the controls to act on it", () => {
  beforeEach(() => vi.clearAllMocks());
  it("the investigation carries the cause, what it beat, what would kill it, and what could not be tested", async () => {
    const html = await renderDetail(proposal());
    for (const s of ["Show me how you worked this out", "two of your own pages competing for one search",
      "so Google is choosing between them every time somebody searches it", "What else I considered and why it lost",
      "a sharper line cannot fix two of your own pages", "What would change my mind", "this is not the explanation",
      "What I could not test, and why", "I do not hold this page&#x27;s indexing or canonical state."]) expect(html, s).toContain(s);
    // Not one raw slug reaches the screen.
    for (const slug of ["cannibalization", "ctr_snippet", "technical_indexability"]) expect(html, slug).not.toContain(slug);
  });
  it("the piece to paste says where it goes, why it works, and which sources are still owed", async () => {
    const html = await renderDetail(proposal());
    for (const s of ["Where it goes", "the page title itself", "What it does", "Why it works", "wins the click", "Sources to add before this goes out",
      "The date needs a source a reader can check.", "Check these lines against the source you pick", "Nowruz falls on the spring equinox."]) expect(html).toContain(s); });
  it("the ranking receipt names each input and how far it could ever move the order", async () => {
    const html = await renderDetail(proposal());
    // A factor that changed nothing says so; it never prints a bare zero.
    for (const s of ["Why this one ranks where it does", "this draft passed every safety check (moved it up 500 of a possible 500)",
      "this page already has a change I am measuring (moved it down 30 of a possible 30)", "did not move this one either way",
      "I ranked this on about 163 clicks I can show are recoverable"]) expect(html, s).toContain(s);
  });
  it("the operator can say which pieces they applied, what they actually wrote, or put the change away", async () => {
    const html = await renderDetail(proposal());
    // PIN (B): the control asks what they wrote; it never offers to skip the check.
    for (const s of ["Which pieces did you apply?", "Page title", "Canonical tag", "I only measure the pieces you tick",
      "Wrote it your own way? Tell me what you put there", "Put this aside"]) expect(html, s).toContain(s);
    expect(html).not.toContain("do not check the page");
    // Every piece starts ticked: applying all of them is the normal case.
    expect(html.match(/type="checkbox" checked=""/g)?.length).toBe(2);
    expect(await renderDetail(atomic())).not.toContain("Which pieces did you apply?"); // one edit, nothing to pick
    // TWO PIECES OF THE SAME KIND ARE STILL TWO PIECES: a shared React key collapsed them into one
    // row, so an operator could not say they applied one section and skipped the other.
    const twin = (label: string) => ({ ...proposal().bundle!.components[0]!, kind: "section" as const, label });
    const twins = await renderDetail(proposal({ bundle: { ...proposal().bundle!, components: [twin("The opening section"), twin("The sizing section")] } }));
    expect([twins.includes("The opening section"), twins.includes("The sizing section"), twins.match(/type="checkbox" checked=""/g)?.length]).toEqual([true, true, 2]);
  });
  it("opens the investigation only when it holds one, never onto a line the card above already said", async () => {
    expect(await renderDetail(proposal({ causeFinding: undefined, rankingReceipt: undefined }))).not.toContain("Show me how you worked this out");
    expect(await renderDetail(proposal({ causeFinding: undefined }))).toContain("Show me how you worked this out"); // a ranking receipt is reasoning too
  });
});
