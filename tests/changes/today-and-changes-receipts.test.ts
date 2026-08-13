/** CHANGES. The ranked queue explains its own order, and a change detail hands over the whole
 *  investigation, the pieces picker and the override. Every test name states the promise it pins. Fixtures only. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server"; import { createElement, type ReactElement } from "react"; import { readFileSync } from "node:fs";
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

// ── evidence controls an opportunity's STATE, never its existence. Fixtures carry only what the feed reads. ──
const TOPIC = { key: "k1", label: "iranian saffron", demand: { monthlySearchVolume: 2400, gscImpressions: 900, trackedPrompts: 2, fanOuts: 5 }, keywords: [{}, {}], exactSerps: [], serpFreshness: "missing", pageType: "unknown", distinctWinners: 0, currentReadableWinners: 0, answerIntel: { answers: 12, latestObservedAt: null }, missingEvidence: ["I have not looked at Google's results for this yet."], diminishing: false, nextAcquisition: { kind: "buy_serp", subject: "saffron", why: "I have never looked at Google's results for this, so buying that one results page is what changes the answer." } };
const DECAY = { page: "https://site.example/comedians", clicksNow: 12, clicksPrior: 175, impressionsNow: 900, impressionsPrior: 1200, positionNow: 14.2, positionPrior: 8.1, windowNowEnd: "2026-07-09" };
const SHIPPED = { id: "s1", page: "https://site.example/saffron", path: "/saffron", actionType: "edit_title", shippedAt: "2026-07-01T00:00:00.000Z", implementedAt: "2026-07-01T00:00:00.000Z", verdict: "won" }, renderFeed = async (over: Record<string, unknown> = {}): Promise<string> => renderToStaticMarkup(createElement((await import("@/app/(shell)/changes/changes-feed")).ChangesFeed,
  { view: viewOf([]), queue: null, investigations: [], decay: [], declineNotes: [], measuring: [], results: [], ...over } as never));
describe("Changes shows every opportunity, and evidence decides only which lane it sits in", () => {
  it("renders the open topic, every losing page, the ideas I set aside and the ledger, each with its own next step and its own honest count", async () => { // M3: a count computed apart from its own list is a contradiction waiting to ship
    const html = await renderFeed({ investigations: [TOPIC], view: { ...viewOf([]), demotedStaleBasis: 21 }, results: [{ ...SHIPPED, id: "r1" }],
      decay: [DECAY, ...Array.from({ length: 21 }, (_, i) => ({ ...DECAY, page: `https://site.example/p${i}`, clicksPrior: 30 + i }))],
      measuring: Array.from({ length: 9 }, (_, i) => ({ ...SHIPPED, id: `m${i}`, verdict: "measuring" })) });
    for (const s of ["Work happening behind the scenes", "iranian saffron", "2,400 searches a month", "reading Google&#x27;s results page", "/comedians", "lost 163 clicks in 4 weeks", "data through Jul 9", "its results page is read next", "21 earlier ideas that no longer clear it went aside", "Changed the title", "Jul 1", "waiting on the first read (lands Jul 8)", "it worked"]) expect(html, s).toContain(s);
    const n = (re: RegExp) => Number((re.exec(html)?.[1] ?? "0").replace(/,/g, "")), rows = (a: string) => html.split(a).length - 1;
    // The drawer counts what it lists: 1 topic, and 22 declining pages plus the set-aside row = 23, of which 6 + 1 render and 16 are named as more. Measuring 9 and Results 1 = 7 rendered and 3 named.
    expect([n(/\(([\d,]+) topics?,/), n(/, ([\d,]+) pages?\)/), rows('data-watching-row="true"'), n(/">([\d,]+) more pages? (?:is|are) down/), rows('data-researching-card="true"'), rows("data-ledger-row="), n(/See the other ([\d,]+) on Results/), /No changes yet|nothing for you to do/i.test(html)]).toEqual([1, 23, 7, 16, 1, 7, 3, false]); });
  // THE MEASURING LANE IS A LIST, NOT AN ESSAY: one row printed the whole stored argument for the change, and "still measuring" never answered the only question the row is asked, which is when the operator hears back.
  it("a measuring row is a short label, a date and where the reading has got to, never the paragraph behind the change", async () => {
    const why = "The page answers the question in the fourth paragraph while every page beating it answers in the first, and the searches behind it are worth about 2,400 a month, so the answer moves to the top and the rest of the page stays exactly as it is.";
    const html = await renderFeed({ measuring: [
      { ...SHIPPED, id: "m1", actionType: "restructure_page", verdict: "measuring", bundleHypothesis: why, windows: [{ day: 7, ran: true, controlsUsed: 4, adjustedLift: 9 }, { day: 14, ran: false }, { day: 28, ran: false }] },
      { ...SHIPPED, id: "m2", actionType: "restructure_page", verdict: "measuring", bundleHypothesis: why },
    ] });
    expect(html).not.toContain("the rest of the page stays exactly as it is");
    expect(html).toContain("The page answers the question in the fourth paragraph while every page beating it answers...");
    for (const s of ["7 day read done, waiting on the 14 day", "waiting on the first read (lands Jul 8)"]) expect(html, s).toContain(s);
    expect(html).not.toContain("still measuring");
  });
  it("never dresses a one click wobble as a decline, and tells a failed read apart from an account with nothing open or measuring", async () => {
    const quiet = await renderFeed({ decay: [{ ...DECAY, clicksNow: 174 }] }), blind = await renderFeed({ ledgerRead: false });
    expect([/lost 1 click /.test(quiet), quiet.includes("Nothing is measuring yet."), blind.includes("What is measuring could not be read just now"), /Make the top edit/.test(blind), /data-ledger-row/.test(blind)]).toEqual([false, true, true, false, false]);
    // AND THE SAME DISTINCTION IN THE DRAWER: a search read that did not answer emptied both lists in one render and the empty state said I have nothing open.
    const dark = await renderFeed({ evidenceRead: false, investigations: [TOPIC], decay: [DECAY] }), open = await renderFeed({ investigations: [TOPIC], decay: [DECAY] });
    const fixed = await renderFeed({ investigations: [TOPIC], decay: [DECAY], view: { ...viewOf([]), queuedPages: ["/comedians"] } }); // a page whose fix is in the list above names its rank, never "I have no change for it"
    expect([dark.includes("Your Google search data could not be read just now"), dark.includes("No topic is open right now"), /\([\d,]+ topics?,/.test(dark), /data-watching-row/.test(dark),
      open.includes("Your Google search data could not be read just now"), /\(1 topic, 1 page\)/.test(open), open.includes("its results page is read next"),
      fixed.includes("its fix is #1 in the list above"), fixed.includes("its results page is read next")]).toEqual([true, false, false, false, false, true, true, true, false]); }); });

/** TODAY IS WORK, NOT A STATUS REPORT (2026-08-11). The collection chip, the topic counter, the research-pass line and the whole
 *  measuring strip are gone from the page; nothing on it may narrate a pass again, and no first person may come back. */
describe("Today narrates no research and speaks in no first person", () => {
  it("never narrates its own research on Today, in any form", () => { const page = readFileSync("src/app/(shell)/page.tsx", "utf8");
    for (const banned of ["answersReadClosely", "aiChecksAnswered", "answers collected today", "topics under research", "researchStatusLine", "In research"]) expect(page, banned).not.toContain(banned); });
});

// ── Changes: the receipts reach the operator ─────────────────────────────────

const ID = "t::/nowruz-guide::existing_edit::bundle";
/** Relative to now: a hard-coded reading date is a test that fails on a calendar day nobody chose. */
const SEEN = new Date(Date.now() - 5 * 86_400_000).toISOString();
const FINDING: CauseFinding = {
  cause: "cannibalization", action: "consolidate", evidenceKeys: ["k1"],
  explanation: "2 of your own pages come up for \"nowruz traditions\", so Google is choosing between them every time somebody searches it.",
  competingExplanations: [{ cause: "ctr_snippet", reason: "a sharper line cannot fix two of your own pages competing for the same search" }],
  falsifier: "If my next look shows only one page of yours coming up for \"nowruz traditions\", this is not the explanation.",
  notConsidered: [{ cause: "technical_indexability", missing: "I do not hold this page's indexing or canonical state." }],
};
const proposal = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: ID, kind: "existing_edit", pagePath: "/nowruz-guide", pageUrl: "https://site.example/nowruz-guide", pageLabel: "Nowruz guide",
  primaryQuery: "nowruz traditions", opportunityType: "Capture clicks", changeFamily: "title", status: "needs_review",
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" },
  // A bundle carrying a piece that moves or hides the page IS a high-risk change and can never sit in ready.
  whyItMatters: "This page lost 163 clicks last month.", estimatedEffortMinutes: 6, riskLevel: "high", confidence: "high",
  limitations: [], evidence: { query: "nowruz traditions", hints: ["1,200 impressions and 9 clicks for that search."], evidenceRefCount: 2 },
  impactScore: 163, upsidePerMonth: 210, tenantId: "t", basis: "basis_now::d4", publish: "manual", createdAt: "2026-07-31T00:00:00.000Z",
  whyRankedAboveNext: "I put this ahead of the change for \"haft seen\" because it wins back more of what you are losing: about 163 clicks against about 20 clicks.",
  causeFinding: FINDING, diagnosisCause: "cannibalization",
  rankingReceipt: { score: 512, directional: false, basis: "I ranked this on about 163 clicks I can show are recoverable, 2 pieces of evidence, and what it takes you to do.",
    factors: [{ name: "actionability", input: "this draft passed every safety check", contribution: 500, max: 500 },
      { name: "overlap", input: "this page already has a change under measurement", contribution: -30, max: 30 },
      { name: "strategic", input: "0 questions your customers actually ask are in scope", contribution: 0, max: 10 }] },
  bundle: { objective: "Settle which page owns that search before changing a word on either of them.",
    metric: "clicks from that search", measurementPlan: "I compare the next 28 days with the last 28.",
    scope: { queries: ["nowruz traditions"], prompts: [] }, confidenceReasons: ["163 clicks lost in 4 weeks"],
    alternatives: [{ option: "Rewrite the title", reason: "it cannot fix two of your pages competing" }], risks: [],
    components: [{ kind: "title", label: "Page title", risk: "safe", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table", evidenceKeys: ["k1"],
      where: "the page title itself", objective: "Say what this page answers.", mechanism: "The line a searcher reads is what wins the click.",
      sourcePack: { sourceRequirements: ["The date needs a source a reader can check."], factRequirements: ["Nowruz falls on the spring equinox."] } },
      { kind: "canonical", label: "Canonical tag", risk: "dangerous", before: null, after: "Point /haft-seen at this page.", evidenceKeys: ["k1"] }],
    receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "1,200 impressions and 9 clicks for that search.", observedAt: SEEN }],
      missing: [], freshestObservedAt: SEEN } },
  ...over,
} as ChangeProposal);
/** The same change with only its one safe piece: nothing to pick between, and no hold to claim. */
const atomic = (): ChangeProposal => proposal({ status: "ready", riskLevel: "low",
  bundle: { ...proposal().bundle!, components: [proposal().bundle!.components[0]!] } });

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
    for (const s of ["2 edits together", "Settle which page owns that search", "Copy new title · 6 min", "High risk",
      "Proven", "it wins back more of what you are losing", "Skip"]) expect(html, s).toContain(s);
    expect(await renderList(viewOf([atomic()]))).toContain("One edit"); // one component is one edit, never a bundle
  });
  it("a change that moves or hides a page carries its two-step hold on the card", async () => {
    const html = await renderList(viewOf([proposal()]));
    for (const s of ["Canonical tag", "changes where the page lives or whether people can find it",
      "read once and confirm before you make the change"]) expect(html, s).toContain(s);
    expect(await renderList(viewOf([atomic()]))).not.toContain("changes where the page lives"); // nothing dangerous, no hold
  }); });

describe("a change detail hands over the whole investigation and the controls to act on it", () => {
  beforeEach(() => vi.clearAllMocks());
  it("the investigation carries the cause, what it beat, what would kill it, and what could not be tested", async () => {
    const html = await renderDetail(proposal());
    for (const s of ["How this was worked out", "two of your own pages competing for one search",
      "so Google is choosing between them every time somebody searches it", "What else was considered and why it lost",
      "a sharper line cannot fix two of your own pages", "What would overturn this", "this is not the explanation",
      "What could not be tested, and why", "I do not hold this page&#x27;s indexing or canonical state."]) expect(html, s).toContain(s);
    // Not one raw slug reaches the screen.
    for (const slug of ["cannibalization", "ctr_snippet", "technical_indexability"]) expect(html, slug).not.toContain(slug); });
  it("the piece to paste says where it goes, why it works, and which sources are still owed", async () => {
    const html = await renderDetail(proposal());
    for (const s of ["Where it goes", "the page title itself", "What it does", "Why it works", "wins the click", "Sources to add before this goes out",
      "The date needs a source a reader can check.", "Check these lines against the source you pick", "Nowruz falls on the spring equinox."]) expect(html).toContain(s); });
  it("the ranking receipt names each input and how far it could ever move the order", async () => {
    const html = await renderDetail(proposal());
    // A factor that changed nothing says so; it never prints a bare zero. NO RANKER ARITHMETIC ON THE SCREEN: how hard a factor pushed is the fact; "1.2 of a possible 3" is not.
    for (const s of ["Why this one ranks where it does", "this draft passed every safety check (a strong push)",
      "this page already has a change under measurement (held it back)", "did not move this one either way",
      "I ranked this on about 163 clicks I can show are recoverable"]) expect(html, s).toContain(s); });
  it("the operator can say which pieces they applied, what they actually wrote, or put the change away", async () => {
    const html = await renderDetail(proposal());
    // PIN (B): the control asks what they wrote; it never offers to skip the check.
    for (const s of ["Which pieces did you apply?", "Page title", "Canonical tag", "Only the pieces you tick get measured",
      "Wrote it your own way? Add what you put there", "Skip"]) expect(html, s).toContain(s);
    expect(html).not.toContain("do not check the page");
    // Every piece starts ticked: applying all of them is the normal case.
    expect(html.match(/type="checkbox" checked=""/g)?.length).toBe(2);
    expect(await renderDetail(atomic())).not.toContain("Which pieces did you apply?"); // one edit, nothing to pick
    // TWO PIECES OF THE SAME KIND ARE STILL TWO PIECES: a shared React key collapsed them into one row, so an operator could not say they applied one section and skipped
    // the other.
    const twin = (label: string) => ({ ...proposal().bundle!.components[0]!, kind: "section" as const, label });
    const twins = await renderDetail(proposal({ bundle: { ...proposal().bundle!, components: [twin("The opening section"), twin("The sizing section")] } }));
    expect([twins.includes("The opening section"), twins.includes("The sizing section"), twins.match(/type="checkbox" checked=""/g)?.length]).toEqual([true, true, 2]); });
  // A MERGE IS THE ONE CHANGE THAT CANNOT BE TAKEN BACK BY RETYPING A SENTENCE. Everything it does to the page has to be on the screen before the operator confirms it,
  // and confirming it has to be a real act.
  it("a change that moves a page shows what moves, what survives, where it forwards, and how to undo it", async () => {
    const b = proposal().bundle!;
    const html = await renderDetail(proposal({ bundle: { ...b, risks: ["The old address stops answering the moment you publish this."],
      components: [{ kind: "consolidation", label: "Merge the thin page into this one", risk: "dangerous", before: null,
        after: "Move the sizing table off /haft-seen onto this page and retire /haft-seen.", evidenceKeys: ["k1"],
        redirectTo: "https://site.example/nowruz-guide",
        preserves: { keeps: ["The sizing table"], losses: [{ what: "The 2019 photo gallery", why: "nothing links to it and nobody searches for it" }] } }] } }));
    for (const s of ["Merge the thin page into this one", "retire /haft-seen", "https://site.example/nowruz-guide",
      "The sizing table", "The 2019 photo gallery", "nothing links to it", "The old address stops answering",
      "To undo it"]) expect(html, s).toContain(s);
    // A piece that RETIRES a page is not a page that happens to have nothing today.
    expect(html).not.toContain("This page has none today.");
    expect(html).toContain("Confirmed: this moves or hides a page"); });
  it("opens the investigation only when it holds one, never onto a line the card above already said", async () => {
    expect(await renderDetail(proposal({ causeFinding: undefined, rankingReceipt: undefined }))).not.toContain("How this was worked out");
    expect(await renderDetail(proposal({ causeFinding: undefined }))).toContain("How this was worked out"); // a ranking receipt is reasoning too
  }); });
