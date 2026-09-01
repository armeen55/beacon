/** CHANGES. The ranked queue explains its own order, and a change detail hands over the whole investigation, the pieces picker and the override. Every test name states the promise it pins. Fixtures only. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server"; import { createElement, type ReactElement } from "react";
import type { CauseFinding, ChangeProposal, RankedProposalQueue } from "@/domains/decision";
import { proofOf } from "@/domains/decision/proof";
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
const ID = "t::/nowruz-guide::existing_edit::bundle"; // ── Changes: the receipts reach the operator ─────────────────────────────────
/** Relative to now: a hard-coded reading date is a test that fails on a calendar day nobody chose. */
const SEEN = new Date(Date.now() - 5 * 86_400_000).toISOString();
const FINDING: CauseFinding = {
  cause: "cannibalization", action: "consolidate", evidenceKeys: ["k1"],
  explanation: "2 of your own pages come up for \"nowruz traditions\", so Google is choosing between them every time somebody searches it.",
  competingExplanations: [{ cause: "ctr_snippet", reason: "a sharper line cannot fix two of your own pages competing for the same search" }],
  falsifier: "If my next look shows only one page of yours coming up for \"nowruz traditions\", this is not the explanation.",
  notConsidered: [{ cause: "technical_indexability", missing: "I do not hold this page's indexing or canonical state." }],};
const proposal = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: ID, kind: "existing_edit", pagePath: "/nowruz-guide", pageUrl: "https://site.example/nowruz-guide", pageLabel: "Nowruz guide",
  primaryQuery: "nowruz traditions", opportunityType: "Capture clicks", changeFamily: "title", status: "needs_review",
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" },
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
      missing: [], freshestObservedAt: SEEN } }, ...over,
} as ChangeProposal);
/** The same change with only its one safe piece: nothing to pick between, and no hold to claim. */
const SHAPE = "the stored results page for this search, whose top titles share this shape";
const atomic = (): ChangeProposal => proposal({ status: "ready", riskLevel: "low", modeledOn: SHAPE,
  causeFinding: { ...FINDING, cause: "ctr_snippet", action: "title", explanation: "The line Google shows misses the words people search for.", competingExplanations: [{ cause: "cannibalization", reason: "only one page of yours comes up for this search" }] }, diagnosisCause: "ctr_snippet",
  bundle: { ...proposal().bundle!, components: [proposal().bundle!.components[0]!] } });
const viewOf = (rows: ChangeProposal[]): ChangesView => ({
  proposals: rows, ready: rows, toDo: [], research: [], laneById: Object.fromEntries(rows.filter((r) => r.status === "ready").map((r) => [r.id, "ready" as const])), aiCases: { state: "read" as const, rows: [] }, summary: { todo: 0, ready: rows.length, research: 0, implemented: 0, measuring: 0, results: 0 },
  measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0, readyZeroHint: null, receiptLine: null,
  surfaceComputedAt: "2026-07-31T00:00:00.000Z", surfaceBuilding: false });
async function renderList(view: ChangesView): Promise<string> {
  const { ChangesListClient } = await import("@/app/(shell)/changes-list-client");
  return renderToStaticMarkup(createElement(ChangesListClient, { view }));}
async function renderDetail(p: ChangeProposal): Promise<string> {
  const { loadChangeProposal, resolveCurrentBasis } = await import("@/domains/decision");
  vi.mocked(loadChangeProposal).mockResolvedValue(p);
  vi.mocked(resolveCurrentBasis).mockResolvedValue(p.basis ?? null);
  const { default: Page } = await import("@/app/(shell)/changes/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: encodeURIComponent(p.id) }) }) as ReactElement);}
/** THE TWO ANSWERS, AND THE WALL BETWEEN THEM. "Backed by 3 checks" was the whole argument on five of seven live  finished cards: a count that reads the same whether it stands on a 90-day search record or one look at the page.  Search demand may never be offered as proof of WORDING, and a source proving a fact may never be offered as proof  of TRAFFIC. Every clause is composed from a typed field, so an absent field prints nothing at all. */
describe("a card says why this opportunity and why these words, and never trades one for the other", () => {
  const rank = (directional: boolean) => ({ score: 5, factors: [], directional, basis: "b" });
  const P = (over: Partial<ChangeProposal>): ChangeProposal => ({ ...proposal(), status: "ready", bundle: undefined, claims: undefined, supportFacts: undefined, ...over } as ChangeProposal);
  const NEVER = ["will earn", "will recover", "guarantee", "expect to gain", "sources agree", "Backed by"];

  it("search-backed: names the search and BOTH windows, states the diagnosed defect, promises no traffic", () => {
    const r = proofOf(P({ demandImpressions90d: 30423, impactScore: 76, primaryQuery: "iran flag", rankingReceipt: rank(false),
      causeFinding: { ...FINDING, explanation: "Two of your own pages come up for this search" } }));
    expect(r.ranksHere).toBe('This page had 30,423 impressions for "iran flag" over 90 days and is short about 76 clicks in the last 28. Two of your own pages come up for this search.');
    for (const n of NEVER) expect(r.ranksHere!, n).not.toContain(n); });

  it("AEO: names the question and the exact citation stage, and never invents a gap nobody measured", () => {
    const ai = (stage: NonNullable<ChangeProposal["aiImpact"]>["stage"]) => proofOf(P({ primaryQuery: "basic Persian phrases", rankingReceipt: rank(true),
      aiImpact: { answers: 3, mentionRate: 0, citedRivals: 8, audienceWeight: 1011, days: 3, engines: 1, stage } })).ranksHere!;
    expect(ai("owned_retrieved_not_cited")).toBe('Assistants answered "basic Persian phrases" 3 times on 3 separate days, and assistants read this page and quoted somebody else.');
    expect(ai("rivals_cited_own_not_retrieved")).toContain("never reached this page and quoted 8 other sites");
    const unreported = ai("citations_unreported");
    expect(unreported).toContain("do not report which sources they used");
    for (const n of ["quoted somebody else", "never reached", "not among the sources"]) expect(unreported, n).not.toContain(n); });

  it("a claim shows the evidence IT names and never another claim's source", () => {
    const r = proofOf(P({ claims: [{ text: "The flag changed in July 1980.", supportedBy: ["fact-1"] }, { text: "The Lion and Sun is older.", supportedBy: ["owned-page-1"] }],
      supportFacts: [{ id: "fact-1", fact: "Wikipedia, Flag of Iran: adopted 1980." }, { id: "owned-page-1", fact: "/iran-flags: standardised under the Pahlavi era." }] }));
    expect(r.wording).toEqual([{ claim: "The flag changed in July 1980.", because: ["Wikipedia, Flag of Iran: adopted 1980."] }, { claim: "The Lion and Sun is older.", because: ["/iran-flags: standardised under the Pahlavi era."] }]);
    expect(JSON.stringify(r.wording)).not.toContain("30,423");
    expect(proofOf(P({ claims: [{ text: "x", supportedBy: ["page-copy-9"] }], supportFacts: [] })).wording).toEqual([]); });

  it("page-only repair: explains the defect, invents no demand, and apologises for nothing", () => {
    const r = proofOf(P({ demandImpressions90d: null, impactScore: 4, primaryQuery: "/persian-rugs/kerman-rug factual accuracy",
      pagePath: "/persian-rugs/kerman-rug", causeFinding: undefined, rankingReceipt: rank(true) }));
    expect(r.ranksHere).toBe("About 4 clicks over 28 days are missing here. No cause is named for it yet, so this is the order to work in, not a promise about size.");
    expect(r.ranksHere!).not.toContain("factual accuracy"); });

  it("a sparse row renders what it has, omits what it lacks, and invents no zero", () => {
    const r = proofOf(P({ demandImpressions90d: null, impactScore: null, aiImpact: undefined, causeFinding: undefined, rankingReceipt: undefined, evidence: undefined }));
    expect(r.ranksHere).toBeNull(); expect(r.wording).toEqual([]); expect(r.opportunity).toEqual([]);
    expect(r.limits).toEqual([]); expect(r.shape).toBeNull();
    expect(r.queryEcho).toBe('"nowruz traditions" is the search already bringing people to this page, and the new wording uses it.');
    expect(proofOf(P({ recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Nothing relevant." } })).queryEcho).toBeNull(); });

  it("evidence that disagrees is stated as a limit and never upgraded into confidence about the words", () => {
    const r = proofOf(P({ limitations: ["Two sources give different dates for the 1980 change."] }));
    expect(r.limits).toContain("Two sources give different dates for the 1980 change.");
    expect(JSON.stringify(r)).not.toContain("agree"); });

  it("an answer that narrates page furniture is refused: the reader wanted the answer, not a tour", async () => {
    const { staleCopyReasons } = await import("@/domains/decision/drafted-copy");
    const P = (after: string) => ({ ...proposal(), status: "ready", bundle: undefined,
      claims: [{ text: "x.", supportedBy: ["f1"] }], supportFacts: [{ id: "f1", fact: "banked." }],
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after } } as ChangeProposal);
    const long = " The rest of this answer carries enough real words to clear the section floor on its own merit for the test.";
    expect(staleCopyReasons(P("Common phrases are hello and thanks, with pronunciations shown beside each." + long), new Map(), []).join(" ")).toContain("points at the page instead of answering");
    expect(staleCopyReasons(P("Anzali sits beside the Caspian Sea and is Iran's busiest northern port." + long), new Map(), []).join(" ")).not.toContain("points at the page");
    for (const shipped of ["Iranian names here are Persian first names and surnames, grouped as girl names, boy names, and last names with meanings." + long, "The basic Persian phrases to start with here are hello, thank you, yes, no, help, and nice to meet you." + long, "The most famous Iranians are organized by field. The page also calls out Rumi and Hafez. Use the category links for the deeper lists." + long])
      expect(staleCopyReasons(P(shipped), new Map(), []).join(" "), "the three container narrations that shipped Ready on 2026-09-01 are refused: page-deictic here, the page as agent, and use-the-links").toContain("points at the page instead of answering");
    expect(staleCopyReasons(P("Goodbye is a listed topic, but its Persian wording is not shown." + long), new Map(), []).join(" "), "telling a reader what the page does NOT say is the diagnosis leaking into customer copy").toContain("points at the page instead of answering"); });

  it("a replacement names what it removes, and a lost link refuses Ready outright", async () => {
    const P = (before: string | null, after: string) => ({ ...proposal(), status: "ready", bundle: undefined,
      claims: [{ text: "Persian statements.", supportedBy: ["f1"] }], supportFacts: [{ id: "f1", fact: "banked." }],
      recommendedChange: { kind: "existing_edit", field: "section", before, after } } as ChangeProposal);
    const lossy = proofOf(P("Persian has 32 letters. Start with the basics at /learn/lesson-one and Try Lesson 1 Free today.", "Persian is written right to left."));
    expect(lossy.losses).toEqual(["the link /learn/lesson-one", "the figure 32", '"Try Lesson 1 Free"']);
    expect(proofOf(P("Persian has 32 letters.", "Persian has 32 letters, written right to left.")).losses).toEqual([]);
    expect(proofOf(P(null, "Anything new.")).losses, "adding deletes nothing").toEqual([]);
    const { staleCopyReasons } = await import("@/domains/decision/drafted-copy");
    const gated = staleCopyReasons(P("Read more at https://x.example/lessons today.", "Read on."), new Map(), []);
    expect(gated.join(" ")).toContain("it removes the link https://x.example/lessons");
    expect(staleCopyReasons(P("See https://x.example/a.", "Still see https://x.example/a."), new Map(), []).join(" ")).not.toContain("removes the link"); });

  it("Ready is one sequence, 1..N with no hidden-lane gaps, and Show more pages finished work only", async () => {
    const mk = (n: number, lane: "ready" | "todo") => ({ ...atomic(), id: `t::/p${n}::existing_edit::title`, pagePath: `/p${n}`,
      ...(lane === "todo" ? { status: "needs_review" as const } : {}) } as ChangeProposal);
    const rows = [mk(1, "ready"), mk(2, "todo"), mk(3, "ready"), mk(4, "todo"), mk(5, "ready")];
    const view = { ...viewOf(rows), proposals: rows, ready: rows.filter((_, i) => i % 2 === 0),
      laneById: Object.fromEntries(rows.map((p, i) => [p.id, i % 2 === 0 ? "ready" as const : "research" as const])),
      summary: { todo: 0, ready: 40, research: 2, implemented: 0, measuring: 0, results: 0 } };
    const html = await renderList(view);
    const seq = [...html.matchAll(/tabular-nums text-muted-foreground"[^>]*>(\d+)</g)].map((m) => m[1]);
    expect(seq, "finished cards count themselves").toEqual(["1", "2", "3"]);
    expect(html).toContain("Show 37 more finished changes"); // all 37 behind the page fit one press now that the page holds 100
    expect(html, "internal work never shares the finished lane's pagination").not.toMatch(/Show \d+ more of/);
    const many = Array.from({ length: 500 }, (_, i) => mk(i + 1, "ready"));
    const big = await renderList({ ...viewOf(many), summary: { todo: 0, ready: 500, research: 0, implemented: 0, measuring: 0, results: 0 } });
    const bigSeq = [...big.matchAll(/tabular-nums text-muted-foreground"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
    expect(bigSeq.length).toBe(500); expect(bigSeq[0]).toBe(1); expect(bigSeq[499]).toBe(500);
    expect(big).not.toContain("Show "); });

  it("attention, treatment and wording are three separately earned answers, never one leap", async () => {
    const P = (over: Partial<ChangeProposal>) => ({ ...proposal(), status: "ready", bundle: undefined, claims: undefined, supportFacts: undefined, causeFinding: undefined, ...over } as ChangeProposal);
    const title = proofOf(P({ demandImpressions90d: 8112, impactScore: 74, primaryQuery: "onager" }));
    expect(title.whyAction).toBeNull(); expect(title.wordingBasis).toContain("not as proven better");
    expect(JSON.stringify(title)).not.toMatch(/proven best|better CTR|beats the/i);
    const withSerp = proofOf(P({ recommendedChange: { kind: "existing_edit", field: "meta", before: "Old.", after: "New description." },
      bundle: { ...proposal().bundle!, receipt: { items: [{ key: "k1", kind: "serp", fact: "The results page for this search leads with 1979.", observedAt: null }], missing: [], freshestObservedAt: null } } }));
    expect(withSerp.wordingBasis).toBeNull();
    expect(proofOf(P({ changeFamily: "factual_correction", recommendedChange: { kind: "existing_edit", field: "meta", before: "x ,", after: "x," } })).wordingBasis).toBeNull();
    const diagnosed = proofOf(P({ causeFinding: { ...FINDING, cause: "retrieved_not_cited", action: "section",
      explanation: "Assistants read this page and quote somebody else.", competingExplanations: [{ cause: "ctr_snippet", reason: "the line a searcher reads cannot fix an answer assistants never lift" }] } }));
    expect(diagnosed.whyAction).toBe("The diagnosis that named this cause also named the treatment: a section change.");
    expect(diagnosed.alternative).toContain("the line a searcher reads cannot fix");
    expect(diagnosed.alternative).not.toContain("ctr_snippet");
    const b = proofOf(P({ bundle: { ...proposal().bundle!, alternatives: [{ option: "Rewrite the title", reason: "it cannot fix two of your pages competing" }],
      components: [{ kind: "title", label: "Page title", risk: "safe", before: "a", after: "b", evidenceKeys: ["k1"], objective: "Say what this page answers." },
        { kind: "h1", label: "Heading", risk: "safe", before: "c", after: "d", evidenceKeys: ["k2"], objective: "Match the heading to it." }],
      receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "1,200 impressions for that search.", observedAt: null },
        { key: "k2", kind: "page_extract", fact: "The page's own heading says otherwise.", observedAt: null }], missing: [], freshestObservedAt: null } } }));
    expect(b.whyAction).toBe(proposal().bundle!.objective);
    expect(b.alternative).toBe("Considered instead: Rewrite the title. It lost because it cannot fix two of your pages competing.");
    expect(b.wording).toEqual([{ claim: "Say what this page answers.", because: ["1,200 impressions for that search."] },
      { claim: "Match the heading to it.", because: ["The page's own heading says otherwise."] }]); });

  it("the rendered card leads with the proof line and no bare check count survives anywhere", async () => {
    const html = await renderList(viewOf([{ ...atomic(), demandImpressions90d: 30423, impactScore: 76, primaryQuery: "iran flag" } as ChangeProposal]));
    expect(html).toContain("Why this ranks here:");
    expect(html).toContain("30,423 impressions for &quot;iran flag&quot; over 90 days and is short about 76 clicks in the last 28");
    for (const n of ["Backed by", "Who beats you today", "Strongest reason"]) expect(html, n).not.toContain(n); }); });

describe("a ranked card explains itself without being opened", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows the shape of the change, the exact action, effort, risk, evidence, and why it outranks the next one", async () => {
    const ready = await renderList(viewOf([atomic()])); // one component is one edit, never a bundle
    for (const s of ["Replace title", "Copy title", "Mark done", "Skip"]) expect(ready, s).toContain(s);
    const held = await renderList(viewOf([proposal({ modeledOn: SHAPE })]));
    for (const s of ["2 edits together", "Settle which page owns that search", "High risk", "it wins back more of what you are losing", "Needs your decision", "What you are deciding", "moves or hides a page", "Page title", "Nowruz Traditions and the Haft-Seen Table", "Canonical tag", "Point /haft-seen at this page."]) expect(held, s).toContain(s);
    for (const s of ["Copy title", "Mark done", "Needs your review", "Why it is held", "A draft, not finished work"]) expect(held, s).not.toContain(s);
    for (const s of ["Proven", "Page-only", "Source-backed", "Search-results-backed"]) expect(ready, s).not.toContain(s);
    expect(ready, "the row says what backs it").toContain("Why this ranks here:");
    const bad = await renderList(viewOf([{ ...proposal(), limitations: ["it repeats what stays on the page below it, so a reader gets the same thing twice"] }]));
    expect(bad, "no card").not.toContain('data-change-card="true"');
    expect(bad, "background").toContain("Beacon is working on 1 more opportunity");
    for (const never of ["Beacon must improve", "it repeats what stays on the page below it", "Needs your decision"]) expect(bad, never).not.toContain(never);});
  it("every Ready card is impossible to misunderstand: action, target, current, new, location, untouched, named button", async () => {
    const shape = (over: Partial<ChangeProposal>) => ({ ...atomic(), bundle: undefined, ...over } as ChangeProposal);
    const title = await renderList(viewOf([shape({})]));
    for (const said of ["Replace title", "Copy title", "Nowruz", "Nowruz Traditions and the Haft-Seen Table", "Only the title tag changes. The heading and page text stay as they are."]) expect(title, said).toContain(said);
    const section = await renderList(viewOf([shape({ recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The ranking is top heavy. Tehran holds 8,693,700 people.", where: "As the final paragraph of the lead, directly above the H2." } })]));
    for (const said of ["Add section", "Copy section", "Where it goes: As the final paragraph of the lead", "This adds new copy. Nothing on the page is deleted."]) expect(section, said).toContain(said);
    expect(section).not.toContain("There is no");
    const meta = await renderList(viewOf([shape({ recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: "An onager is a wild ass native to Iran's deserts." } })]));
    for (const said of ["Replace meta description", "Copy meta description", "Only the meta description changes. Nothing on the page itself changes."]) expect(meta, said).toContain(said);
    expect(meta).not.toContain("Copy section");
    expect([(meta.match(/data-pick-done="true"/g) ?? []).length, meta.includes('data-bulk-bar')], "one checkbox per ready card, no bar unticked").toEqual([1, false]); // BULK MARK DONE offers a checkbox per Ready card (ticking claims nothing; the batch press records), and no bar until something is ticked.
    const two = atomic(); two.id = "t::/nowruz-guide::existing_edit::title-family";
    two.bundle = { ...two.bundle!, components: [two.bundle!.components[0]!,
      { kind: "h1", label: "Page heading", risk: "safe", before: "Old H", after: "New H", evidenceKeys: ["k1"], where: "the page heading" }] };
    const bundled = await renderList(viewOf([two]));
    expect(bundled).toContain("2 edits together");
    const fam = await renderList(viewOf([{ ...atomic(), id: "t::/basic-persian::existing_edit::ai_answer_gap",
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A finished forty word answer block for this fixture, complete and pasteable, standing in for real copy that satisfies the section band by carrying enough words to pass every length check applied to it.", where: "After the intro." } } as ChangeProposal]));
    expect(fam).toContain("Add section"); expect(fam).not.toContain("AI answer gap");
    const passage = await renderList(viewOf([shape({ recommendedChange: { kind: "existing_edit", field: "section", before: "Tehran is by far the biggest city.", after: "Cities like Yazd and Kerman are globally known.", where: "The paragraph immediately below the table." } })]));
    for (const said of ["Replace section", "Only this passage changes. Everything around it stays."]) expect(passage, said).toContain(said); });

  it("a change that moves or hides a page carries its two-step hold on the card", async () => {
    const html = await renderList(viewOf([proposal({ modeledOn: SHAPE })]));
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
    for (const slug of ["cannibalization", "ctr_snippet", "technical_indexability"]) expect(html, slug).not.toContain(slug); }); // Not one raw slug reaches the screen.
  it("the piece to paste says where it goes, why it works, and which sources are still owed", async () => {
    const html = await renderDetail(proposal());
    for (const s of ["Where it goes", "the page title itself", "What it does", "Why it works", "wins the click", "Sources to add before this goes out",
      "The date needs a source a reader can check.", "Check these lines against the source you pick", "Nowruz falls on the spring equinox."]) expect(html).toContain(s); });
  it("the ranking receipt names each input and how far it could ever move the order", async () => {
    const html = await renderDetail(proposal());
    for (const s of ["Why this one ranks where it does", "this draft passed every safety check (a strong push)", // A factor that changed nothing says so; it never prints a bare zero. NO RANKER ARITHMETIC ON THE SCREEN: how hard a factor pushed is the fact; "1.2 of a possible 3" is not.
      "this page already has a change under measurement (held it back)", "did not move this one either way",
      "I ranked this on about 163 clicks I can show are recoverable"]) expect(html, s).toContain(s); });
  it("the operator can say which pieces they applied, what they actually wrote, or put the change away", async () => {
    const twin = (label: string) => ({ ...proposal().bundle!.components[0]!, kind: "internal_links" as const, label }); // READY IS THE ONLY LANE THAT CARRIES CONTROLS, so the picker is exercised on the shape that really has one. TWO PIECES OF THE SAME KIND ARE STILL TWO PIECES: a shared React key collapsed them into one row, so an operator could not say they applied one section and skipped the other. PIN (B): the control asks what they wrote; it never offers to skip the check.
    const html = await renderDetail(proposal({ status: "ready", riskLevel: "medium", modeledOn: SHAPE, bundle: { ...proposal().bundle!, components: [twin("The opening section"), twin("The sizing section")] } }));
    for (const s of ["Which pieces did you apply?", "The opening section", "The sizing section", "Only the pieces you tick get measured",
      "Wrote it your own way? Add what you put there", "Skip"]) expect(html, s).toContain(s);
    expect(html).not.toContain("do not check the page");
    expect(html.match(/type="checkbox" checked=""/g)?.length).toBe(2); // Every piece starts ticked: applying all of them is the normal case.
    expect(await renderDetail(atomic())).not.toContain("Which pieces did you apply?"); // one edit, nothing to pick
    const review = await renderDetail(proposal()); expect([review.includes("Which pieces did you apply?"), review.includes("still being reviewed")]).toEqual([false, true]); }); // AND A CARD STILL IN REVIEW HANDS OVER NOTHING TO PRESS, however complete its pieces are and whatever a direct link says: the lane is the rule, on this page exactly as in the list and in the mutation behind it.
  it("a change that moves a page shows what moves, what survives, where it forwards, and how to undo it", async () => { // A MERGE IS THE ONE CHANGE THAT CANNOT BE TAKEN BACK BY RETYPING A SENTENCE. Everything it does to the page has to be on the screen before the operator confirms it, and confirming it has to be a real act.
    const b = proposal().bundle!;
    const html = await renderDetail(proposal({ bundle: { ...b, risks: ["The old address stops answering the moment you publish this."],
      components: [{ kind: "consolidation", label: "Merge the thin page into this one", risk: "dangerous", before: null,
        after: "Move the sizing table off /haft-seen onto this page and retire /haft-seen.", evidenceKeys: ["k1"],
        redirectTo: "https://site.example/nowruz-guide",
        preserves: { keeps: ["The sizing table"], losses: [{ what: "The 2019 photo gallery", why: "nothing links to it and nobody searches for it" }] } }] } }));
    for (const s of ["Merge the thin page into this one", "retire /haft-seen", "https://site.example/nowruz-guide",
      "The sizing table", "The 2019 photo gallery", "nothing links to it", "The old address stops answering",
      "To undo it"]) expect(html, s).toContain(s);
    expect(html).not.toContain("This page has none today."); // A piece that RETIRES a page is not a page that happens to have nothing today.
    expect([html.includes("Confirmed: this moves or hides a page"), html.includes("still being reviewed")]).toEqual([false, true]); }); // AND NOTHING TO CONFIRM WHILE IT IS IN REVIEW: a piece that moves or hides a page is graded dangerous, the canon refuses a dangerous piece in the ready lane, so this change can only ever be read here, never recorded.
  it("opens the investigation only when it holds one, never onto a line the card above already said", async () => {
    expect(await renderDetail(proposal({ causeFinding: undefined, rankingReceipt: undefined }))).not.toContain("How this was worked out");
    expect(await renderDetail(proposal({ causeFinding: undefined }))).toContain("How this was worked out"); // a ranking receipt is reasoning too
  }); });
