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
// ── Changes: the receipts reach the operator ─────────────────────────────────
const ID = "t::/nowruz-guide::existing_edit::bundle";
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
// SERVABLE BY THE ONE VERDICT: a ready-lane fixture must pass unsettledCause too, exactly as the release lanes it. A cannibalization finding on a title edit is an UNSETTLED split (a wording change settles nothing about which page owns the search), so the atomic ready card carries a cause its own lever treats.
const atomic = (): ChangeProposal => proposal({ status: "ready", riskLevel: "low",
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
/** THE TWO ANSWERS, AND THE WALL BETWEEN THEM. "Backed by 3 checks" was the whole argument on five of seven live
 *  finished cards: a count that reads the same whether it stands on a 90-day search record or one look at the page.
 *  Search demand may never be offered as proof of WORDING, and a source proving a fact may never be offered as proof
 *  of TRAFFIC. Every clause is composed from a typed field, so an absent field prints nothing at all. */
describe("a card says why this opportunity and why these words, and never trades one for the other", () => {
  const rank = (directional: boolean) => ({ score: 5, factors: [], directional, basis: "b" });
  const P = (over: Partial<ChangeProposal>): ChangeProposal => ({ ...proposal(), status: "ready", bundle: undefined, claims: undefined, supportFacts: undefined, ...over } as ChangeProposal);
  const NEVER = ["will earn", "will recover", "guarantee", "expect to gain", "sources agree", "Backed by"];

  it("search-backed: names the search and BOTH windows, states the diagnosed defect, promises no traffic", () => {
    const r = proofOf(P({ demandImpressions90d: 30423, impactScore: 76, primaryQuery: "iran flag", rankingReceipt: rank(false),
      causeFinding: { ...FINDING, explanation: "Two of your own pages come up for this search" } }));
    expect(r.ranksHere).toBe('This page was shown 30,423 times for "iran flag" over 90 days and is short about 76 clicks in the last 28. Two of your own pages come up for this search.');
    for (const n of NEVER) expect(r.ranksHere!, n).not.toContain(n); });

  it("AEO: names the question and the exact citation stage, and never invents a gap nobody measured", () => {
    const ai = (stage: NonNullable<ChangeProposal["aiImpact"]>["stage"]) => proofOf(P({ primaryQuery: "basic Persian phrases", rankingReceipt: rank(true),
      aiImpact: { answers: 3, mentionRate: 0, citedRivals: 8, audienceWeight: 1011, days: 3, engines: 1, stage } })).ranksHere!;
    expect(ai("owned_retrieved_not_cited")).toBe('Assistants answered "basic Persian phrases" 3 times on 3 separate days, and assistants read this page and quoted somebody else.');
    // NEVER REACHED is not READ AND PASSED OVER, and an engine that does not report its sources measured nothing.
    expect(ai("rivals_cited_own_not_retrieved")).toContain("never reached this page and quoted 8 other sites");
    const unreported = ai("citations_unreported");
    expect(unreported).toContain("do not report which sources they used");
    for (const n of ["quoted somebody else", "never reached", "not among the sources"]) expect(unreported, n).not.toContain(n); });

  it("a claim shows the evidence IT names and never another claim's source", () => {
    const r = proofOf(P({ claims: [{ text: "The flag changed in July 1980.", supportedBy: ["fact-1"] }, { text: "The Lion and Sun is older.", supportedBy: ["owned-page-1"] }],
      supportFacts: [{ id: "fact-1", fact: "Wikipedia, Flag of Iran: adopted 1980." }, { id: "owned-page-1", fact: "/iran-flags: standardised under the Pahlavi era." }] }));
    expect(r.wording).toEqual([{ claim: "The flag changed in July 1980.", because: ["Wikipedia, Flag of Iran: adopted 1980."] },
      { claim: "The Lion and Sun is older.", because: ["/iran-flags: standardised under the Pahlavi era."] }]);
    // A SOURCE PROVES ITS FACT, NEVER THE TRAFFIC: the demand figure never appears beside the words it did not write.
    expect(JSON.stringify(r.wording)).not.toContain("30,423");
    // A named id nothing carries is dropped, never printed as a bare symbol.
    expect(proofOf(P({ claims: [{ text: "x", supportedBy: ["page-copy-9"] }], supportFacts: [] })).wording).toEqual([]); });

  it("page-only repair: explains the defect, invents no demand, and apologises for nothing", () => {
    const r = proofOf(P({ demandImpressions90d: null, impactScore: 4, primaryQuery: "/persian-rugs/kerman-rug factual accuracy",
      pagePath: "/persian-rugs/kerman-rug", causeFinding: undefined, rankingReceipt: rank(true) }));
    // The synthetic label a correction is filed under is NOT a search, so it is never quoted as one.
    expect(r.ranksHere).toBe("About 4 clicks over 28 days are missing here. No cause is named for it yet, so this is the order to work in, not a promise about size.");
    expect(r.ranksHere!).not.toContain("factual accuracy"); });

  it("a sparse row renders what it has, omits what it lacks, and invents no zero", () => {
    const r = proofOf(P({ demandImpressions90d: null, impactScore: null, aiImpact: undefined, causeFinding: undefined, rankingReceipt: undefined, evidence: undefined }));
    expect(r.ranksHere).toBeNull(); expect(r.wording).toEqual([]); expect(r.opportunity).toEqual([]);
    expect(r.limits).toEqual([]); expect(r.shape).toBeNull();
    // A row with NO evidence at all can still honestly say where its words came from: the copy really does
    // carry the search this page already appears for, and that is checked against the copy, not assumed.
    expect(r.queryEcho).toBe('"nowruz traditions" is the search already bringing people to this page, and the new wording uses it.');
    expect(proofOf(P({ recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Nothing relevant." } })).queryEcho).toBeNull(); });

  it("evidence that disagrees is stated as a limit and never upgraded into confidence about the words", () => {
    const r = proofOf(P({ limitations: ["Two sources give different dates for the 1980 change."] }));
    expect(r.limits).toContain("Two sources give different dates for the 1980 change.");
    expect(JSON.stringify(r)).not.toContain("agree"); });

  it("the rendered card leads with the proof line and no bare check count survives anywhere", async () => {
    const html = await renderList(viewOf([{ ...atomic(), demandImpressions90d: 30423, impactScore: 76, primaryQuery: "iran flag" } as ChangeProposal]));
    expect(html).toContain("Why this ranks here:");
    expect(html).toContain("shown 30,423 times for &quot;iran flag&quot; over 90 days and is short about 76 clicks in the last 28");
    for (const n of ["Backed by", "Who beats you today", "Strongest reason"]) expect(html, n).not.toContain(n); });
});

describe("a ranked card explains itself without being opened", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows the shape of the change, the exact action, effort, risk, evidence, and why it outranks the next one", async () => {
    const ready = await renderList(viewOf([atomic()])); // one component is one edit, never a bundle
    // THE CHIP AND THE BUTTON NAME THE REAL OBJECT (operator contract, 2026-08-27): "One edit" and "Copy new
    // title" both made the operator work out what they were holding.
    for (const s of ["Replace title", "Copy title", "Mark done", "Skip"]) expect(ready, s).toContain(s);
    // NEEDS_REVIEW NEVER WEARS READY'S CONTROLS. The lanes were merged into one flat list and the card offered Copy and Mark done on every row, so a change waiting on a human look presented as a paste-ready deliverable. It says everything it always said, in its own labelled area, with nothing to press.
    const held = await renderList(viewOf([proposal()]));
    // A dangerous consolidation is complete work awaiting the operator's own authority: the ONE lane that is
    // genuinely theirs, framed as the decision rather than as Beacon's internal hold.
    for (const s of ["2 edits together", "Settle which page owns that search", "High risk", "it wins back more of what you are losing", "Needs your decision", "What you are deciding", "moves or hides a page", "Page title", "Nowruz Traditions and the Haft-Seen Table", "Canonical tag", "Point /haft-seen at this page."]) expect(held, s).toContain(s);
    for (const s of ["Copy title", "Mark done", "Needs your review", "Why it is held", "A draft, not finished work"]) expect(held, s).not.toContain(s);
    // "PROVEN" IS A CLAIM ABOUT EVIDENCE, NEVER ABOUT BEING FINISHED. The ready lane passed a bare `proven` on every row, so the Asiatic cheetah card said "Proven" beside "Backed by 1 check" while carrying no receipt at all. This row is Ready and has none either, so it may not wear the chip that says its argument was checked outside this account.
    expect(ready, "proven").not.toContain("Proven"); expect(ready, "tier").toContain("Page-only");
    // AND A DRAFT BEACON'S OWN GATES ALREADY REFUSED IS BEACON'S PROBLEM, never the operator's: it renders only
    // as the compact background status, with no card, no controls and no internal refusal text, even when the
    // same row also carries a safety decision, because nobody is asked to authorize known-defective work.
    const bad = await renderList(viewOf([{ ...proposal(), limitations: ["it repeats what stays on the page below it, so a reader gets the same thing twice"] }]));
    expect(bad, "no card").not.toContain('data-change-card="true"');
    expect(bad, "background").toContain("Beacon is working on 1 more opportunity");
    for (const never of ["Beacon must improve", "it repeats what stays on the page below it", "Needs your decision"]) expect(bad, never).not.toContain(never);});
  it("every Ready card is impossible to misunderstand: action, target, current, new, location, untouched, named button", async () => {
    // THE ZERO-INTERPRETATION CONTRACT (operator, 2026-08-27): at ten to thirty applied changes a day, "does
    // this replace something? where does it go?" is the product's whole cost. Four representative shapes, each
    // read off the CANONICAL recommendedChange and never off prose.
    const shape = (over: Partial<ChangeProposal>) => ({ ...atomic(), bundle: undefined, ...over } as ChangeProposal);
    // 1. A title REPLACEMENT: old words shown struck through, new words beside a button naming the object.
    const title = await renderList(viewOf([shape({})]));
    for (const said of ["Replace title", "Copy title", "Nowruz", "Nowruz Traditions and the Haft-Seen Table", "Only the title tag changes. The heading and page text stay as they are."]) expect(title, said).toContain(said);
    // 2. An ADDED section: no false absence claim, and the untouched line says nothing is deleted.
    const section = await renderList(viewOf([shape({ recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The ranking is top heavy. Tehran holds 8,693,700 people.", where: "As the final paragraph of the lead, directly above the H2." } })]));
    for (const said of ["Add section", "Copy section", "Where it goes: As the final paragraph of the lead", "This adds new copy. Nothing on the page is deleted."]) expect(section, said).toContain(said);
    expect(section).not.toContain("There is no");
    // 3. A description replacement names ITS object, never "section".
    const meta = await renderList(viewOf([shape({ recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: "An onager is a wild ass native to Iran's deserts." } })]));
    for (const said of ["Replace description", "Copy description", "Only the description changes. Nothing on the page itself changes."]) expect(meta, said).toContain(said);
    expect(meta).not.toContain("Copy section");
    // 4. A multi-piece bundle is named by its size, never by one piece's family word: the live queue held a
    // three-edit bundle across two pages wearing the chip "Title" because its id ended ::title-family.
    const two = atomic(); two.id = "t::/nowruz-guide::existing_edit::title-family";
    two.bundle = { ...two.bundle!, components: [two.bundle!.components[0]!,
      { kind: "h1", label: "Page heading", risk: "safe", before: "Old H", after: "New H", evidenceKeys: ["k1"], where: "the page heading" }] };
    const bundled = await renderList(viewOf([two]));
    expect(bundled).toContain("2 edits together");
    // 5. A replaced passage: the untouched line bounds the blast radius.
    const passage = await renderList(viewOf([shape({ recommendedChange: { kind: "existing_edit", field: "section", before: "Tehran is by far the biggest city.", after: "Cities like Yazd and Kerman are globally known.", where: "The paragraph immediately below the table." } })]));
    for (const said of ["Replace section", "Only this passage changes. Everything around it stays."]) expect(passage, said).toContain(said); });

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
    // READY IS THE ONLY LANE THAT CARRIES CONTROLS, so the picker is exercised on the shape that really has one. TWO PIECES OF THE SAME KIND ARE STILL TWO PIECES: a shared React key collapsed them into one row, so an operator could not say they applied one section and skipped the other. PIN (B): the control asks what they wrote; it never offers to skip the check.
    const twin = (label: string) => ({ ...proposal().bundle!.components[0]!, kind: "internal_links" as const, label });
    const html = await renderDetail(proposal({ status: "ready", riskLevel: "medium", bundle: { ...proposal().bundle!, components: [twin("The opening section"), twin("The sizing section")] } }));
    for (const s of ["Which pieces did you apply?", "The opening section", "The sizing section", "Only the pieces you tick get measured",
      "Wrote it your own way? Add what you put there", "Skip"]) expect(html, s).toContain(s);
    expect(html).not.toContain("do not check the page");
    // Every piece starts ticked: applying all of them is the normal case.
    expect(html.match(/type="checkbox" checked=""/g)?.length).toBe(2);
    expect(await renderDetail(atomic())).not.toContain("Which pieces did you apply?"); // one edit, nothing to pick
    // AND A CARD STILL IN REVIEW HANDS OVER NOTHING TO PRESS, however complete its pieces are and whatever a direct link says: the lane is the rule, on this page exactly as in the list and in the mutation behind it.
    const review = await renderDetail(proposal()); expect([review.includes("Which pieces did you apply?"), review.includes("still being reviewed")]).toEqual([false, true]); });
  // A MERGE IS THE ONE CHANGE THAT CANNOT BE TAKEN BACK BY RETYPING A SENTENCE. Everything it does to the page has to be on the screen before the operator confirms it, and confirming it has to be a real act.
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
    // AND NOTHING TO CONFIRM WHILE IT IS IN REVIEW: a piece that moves or hides a page is graded dangerous, the canon refuses a dangerous piece in the ready lane, so this change can only ever be read here, never recorded.
    expect([html.includes("Confirmed: this moves or hides a page"), html.includes("still being reviewed")]).toEqual([false, true]); });
  it("opens the investigation only when it holds one, never onto a line the card above already said", async () => {
    expect(await renderDetail(proposal({ causeFinding: undefined, rankingReceipt: undefined }))).not.toContain("How this was worked out");
    expect(await renderDetail(proposal({ causeFinding: undefined }))).toContain("How this was worked out"); // a ranking receipt is reasoning too
  }); });
