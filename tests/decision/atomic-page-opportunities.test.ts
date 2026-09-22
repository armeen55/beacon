import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvidenceSnapshot, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import { canonicalQueryKey as canon, topicTokens } from "@/domains/evidence/relevance-gate";
import { answeredIn, substantiveGapOf } from "@/domains/decision/diagnosis";
import { demandOf, writerKindOf } from "@/domains/decision/drafted-copy";
import { footprintKey } from "@/domains/decision/mutation-footprint";
import { deliverableGaps, preferFinished } from "@/domains/decision/completeness";
import { nextObligation } from "@/domains/decision/obligation";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { proposalStoreRpc, supabaseFake, type Row } from "../helpers/supabase-fake";
const db = vi.hoisted(() => ({ rows: [] as Row[], filed: [] as Record<string, unknown>[] }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => client }));
const client = { ...supabaseFake({ rows: () => db.rows, insertDefaults: () => ({ created_at: "2026-08-01T00:00:00.000Z" }),
  clash: (row, rows) => (rows.some((r) => r.id !== row.id && r.terminal_disposition == null
    && ["tenant_id", "case_id", "page_key", "action_family", "mutation_key"].every((c) => r[c] === row[c]))
    ? { message: "duplicate key value violates unique constraint ux_change_proposals_current" } : null) }),
  rpc: (name: string, args: { p_rows?: Record<string, unknown>[] } & Record<string, unknown>) => { if (name === "upsert_ai_case_dispositions") { db.filed.push(...(args.p_rows ?? [])); return Promise.resolve({ data: (args.p_rows ?? []).length, error: null }); } return proposalStoreRpc(() => db.rows)(name, args); } };
const NOW = new Date("2026-08-01T00:00:00.000Z");
const SITES = [
  { t: "tenant-one", path: "/rock-pools", title: "Rock pools of the north coast", subject: "north coast ledges",
    big: "how cold is the winter water", small: "which mussels grow on the ledges", third: "when do the seals return to the point",
    both: "Winter water on these ledges sits near four degrees, and the mussels that grow there stay covered at every tide.",
    onlyBig: "Winter water here sits near four degrees from December to March.",
    passage: "Visitors walk out at low tide and come back before the flats fill again.",
    aiBig: "how deep are the rock pools at low tide", aiSmall: "which mussels grow in the rock pools", aiThird: "when do the seals return to the rock pools",
    topics: ["rock pools", "north coast", "mussels", "seals", "tides"],
    aiAnswered: "Mussels grow in these rock pools on every ledge the water covers." },
  { t: "tenant-two", path: "/bordado", title: "Bordado borders and stitch counts", subject: "bordado borders",
    big: "how many strands does a border take", small: "which loom weaves the widest cloth", third: "how wide is the finished panel",
    both: "A border takes six strands here, and the widest cloth this loom weaves is woven to the same count.",
    onlyBig: "A border takes six strands here, and that count never changes.",
    passage: "Every panel here is worked flat on a frame that keeps the cloth taut.",
    aiBig: "how many strands does a bordado border take", aiSmall: "which loom weaves the widest bordado stitch", aiThird: "when did bordado borders change their stitch counts",
    topics: ["bordado", "borders", "stitch counts", "looms", "strands"],
    aiAnswered: "The widest bordado stitch on this loom is woven to the same count." },
];
type Site = (typeof SITES)[number];
const url = (s: Site): string => `https://${s.t}.example${s.path}`;
const page = (s: Site, rows: Array<[string, number]>): OwnedPageEvidence => ({ url: url(s),
  content: { title: s.title, metaDescription: "d", h1: s.title, h2: [], outline: [], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: NOW.toISOString() },
  search: { clicks90d: 10, impressions90d: 9000, ctr90d: 0.01, position90d: 8, topQueries: rows.map(([query, impressions]) => ({ query, impressions, clicks: 1, position: 8 })) },
  engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } });
const body = (s: Site): unknown => ({ url: url(s), title: s.title, h1: s.title, metaDescription: null, headings: [], passages: [s.passage], vocabulary: "", cardTexts: [], faqs: [], entityNames: [], internalLinks: [], openingSample: s.passage, fetchedAt: NOW.toISOString(), completeness: "complete", version: "current", contentHash: "h", heldNote: null });
const snapshot = (s: Site, pages: OwnedPageEvidence[]): EvidenceSnapshot => ({ scope: { tenantId: s.t, site: `${s.t}.example`, builtAt: NOW.toISOString() },
  aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [],
  cannibalization: [], contentGaps: [], internalLinkOpportunities: [], evidenceHash: "fixture", research: emptyResearchEvidence(), ownedPages: pages });
const mintFor = async (s: Site, rows: Array<[string, number]>, standing: unknown[] = []): Promise<ChangeProposal[]> => {
  vi.resetModules();
  vi.doMock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadChangeProposals: async () => new Map((standing as { id: string }[]).map((r) => [r.id, r])) }));
  vi.doMock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadOwnedPageBodies: async () => new Map([[`${s.t}.example${s.path}`, body(s)]]) }));
  const out = await (await import("@/domains/decision/producers/extra")).extraQueueCards({ tenantId: s.t, snapshot: snapshot(s, [page(s, rows)]) as never, now: NOW, reads: { left: 0 }, persist: false });
  return out.cards.filter((c) => c.id.includes("::existing_edit::missing_answer"));
};
const idOf = (s: Site, tail = ""): string => `${s.t}::${s.path}::existing_edit::missing_answer${tail}`;
const seatStem = (id: string): string => id.replace(/#[0-9a-f]{64}$/i, "");
const walked = async (s: Site, cards: ChangeProposal[], owed: string[][]): Promise<ChangeProposal[]> => {
  vi.resetModules();
  vi.doMock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadOwnedPageBodies: async () => new Map([[`${s.t}.example${s.path}`, body(s)]]) }));
  const { applyDraftedCopy } = await import("@/domains/decision/drafted-copy"), { DRAFT_BUDGET } = await import("@/domains/decision/draft-budget");
  const budget = DRAFT_BUDGET.plan({ jobs: cards.map((c) => ({ key: DRAFT_BUDGET.keyOf(c), family: "editor" as const, impact: c.impactScore ?? 0, calls: DRAFT_BUDGET.DELIVERABLE_CALLS })), candidates: cards.length, calls: 30 });
  return await applyDraftedCopy(cards as never, { tenantId: s.t, snapshot: snapshot(s, [page(s, [[s.big, 900], [s.small, 300]])]) as never, now: NOW, budget,
    owe: (k: string, need: { query?: string }) => owed.push([k, need.query ?? ""]), complete: async () => ({ value: {} }) } as never) as ChangeProposal[]; };
const card = (s: Site, id: string, query: string, over: Partial<ChangeProposal> = {}): ChangeProposal => ({ id, tenantId: s.t, kind: "existing_edit", pagePath: s.path, pageUrl: url(s),
  pageLabel: s.title, primaryQuery: query, opportunityType: `An answer to "${query}"`, changeFamily: "section", status: "needs_review",
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: `One section on ${s.path} that answers "${query}" in this page's own voice.` },
  whyItMatters: `Searchers ask "${query}" here and nothing on the page answers it.`, estimatedEffortMinutes: 30, riskLevel: "low", confidence: "medium",
  limitations: [], evidence: { query, hints: [], evidenceRefCount: 1 }, impactScore: 40, upsidePerMonth: null, basis: "basis_today::d6", publish: "manual", createdAt: NOW.toISOString(), ...over });

beforeEach(() => { db.rows = []; db.filed = []; vi.doUnmock("@/domains/decision/proposal-store"); vi.doUnmock("@/domains/evidence/pages/owned-context"); vi.resetModules(); });


describe("a page carries as many changes as it has searches it never answers", () => {
  it("joins explicit transliteration separators without rewriting ordinary English", () => { const s = { ...SITES[0]!, path: "/winter-festival", title: "Winter festival", passage: "Families gather around a table and share fruit." }, demand = demandOf(page(s, [["what is shabe yalda", 40], ["what is shab-e yalda", 35]]), body(s) as never, [], null, s.t), gap = substantiveGapOf({}, demand as never); expect([topicTokens.sameQuery("what is shabe yalda", "what is shab-e yalda"), topicTokens.sameQuery("what is shab e yalda", "what is shab-e yalda"), topicTokens.sameQuery("plan e ticket", "plane ticket"), topicTokens.sameQuery("plan-e ticket", "plane ticket"), answeredIn("what is shab-e yalda", "Shabe Yalda is a winter-solstice celebration."), answeredIn("architecture history", "Architecture is the art of building, and its history spans centuries."), answeredIn("unique questions", "Unique and meaningful questions are listed here."), answeredIn("change request", "A change is made after each request."), answeredIn("architecture quiz", "Architecture is taught through a short quiz."), answeredIn("plane ticket", "Plan your ticket before travel."), gap?.impressions, gap?.queries?.length]).toEqual([true, true, false, false, true, true, true, true, true, false, 75, 2]); });
  it("keeps an answered transliteration group as honest SERP research, never a falsely diagnosed edit", async () => { const s = { ...SITES[0]!, path: "/shabe-yalda", title: "Shabe Yalda", passage: "Shabe Yalda, also known as Yalda Night, is an ancient winter-solstice celebration observed by Iranian families." }, cards = await mintFor(s, [["shab e yalda", 103], ["shab-e yalda", 42], ["shabe yalda", 18]]); expect(cards.map((c) => [c.primaryQuery, c.researchOnly, c.obligation, c.causeFinding ?? null, c.operatorSteps, c.estimatedEffortMinutes, c.limitations.some((line) => line.includes("No content gap is diagnosed yet")), c.recommendedChange.kind === "existing_edit" ? c.recommendedChange.after : ""]), "one semantic audience may owe the exact results and winner reading, but an answered page carries no incomplete-coverage claim, edit instructions or paid editorial work").toEqual([["shab e yalda", true, { kind: "evidence", need: { kind: "serp", query: "shab e yalda", reasonCode: "no_winner_to_read" } }, null, [], 0, true, "The exact wording has not been written yet."]]); });
  it("keeps finished copy only inside one semantic query and typed diagnosis epoch", () => { const s = SITES[0]!, old = { diagnosedGap: "old assignment" } as never, current = { diagnosedGap: "current assignment" } as never, finding = { cause: "incomplete_coverage", action: "add a section", payload: { cause: "incomplete_coverage", absentHeadings: ["Origin"], absentEntities: [] } };
    const prior = card(s, "epoch", "what is shab e yalda", { status: "ready", researchOnly: false, mutationScope: "topic", demandImpressions90d: 103, diagnosisCause: "incomplete_coverage", causeFinding: finding as never, copyStamp: "page-1", factIdentity: "facts-1", workKey: "job-1", assignment: old, limitations: ["old 103"], claims: [{ text: "Shabe Yalda is a winter-solstice celebration.", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "Shabe Yalda is a winter-solstice celebration." }], recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Shabe Yalda is a winter-solstice celebration.", where: "After the opening paragraph" } });
    const incoming = { ...prior, primaryQuery: "what is shab-e yalda", assignment: current, limitations: ["current 103"] }, stable = preferFinished(incoming, prior), movedDemand = preferFinished({ ...incoming, demandImpressions90d: 104, limitations: ["current 104"] }, prior), movedDiagnosis = preferFinished({ ...incoming, causeFinding: { ...finding, action: "rewrite the section" } as never }, prior); expect([stable.assignment, stable.limitations, movedDemand.assignment, movedDemand.limitations, movedDiagnosis.assignment, movedDiagnosis.limitations]).toEqual([old, ["old 103"], old, ["old 103"], current, ["current 103"]]);
  });
  it.each(SITES)("$t: reads the second search this page never answers, with its own verdict and its own owed step", (s) => {
    const demand = demandOf(page(s, [[s.big, 900], [s.small, 300]]), body(s) as never, [], null, s.t);
    const lead = substantiveGapOf({}, demand as never), behind = substantiveGapOf({}, demand as never, canon(lead?.query ?? ""));
    const alone = substantiveGapOf({}, demandOf(page(s, [[s.big, 900]]), body(s) as never, [], null, s.t) as never), asked = (g: typeof lead): unknown => (g?.owed as { need?: { query?: string } } | undefined)?.need?.query;
    expect([lead?.kind, lead?.query, asked(lead), behind?.kind, behind?.query, asked(behind), JSON.stringify(alone) === JSON.stringify(lead)],
      "the biggest unanswered search is read exactly as it always was, the next one behind it is its own missing answer about ITS OWN search rather than the first one, and each owed step carries the exact question its downstream operator must answer")
      .toEqual(["missing_answer", s.big, s.big, "missing_answer", s.small, s.small, true]);
    expect([behind?.propositions[0]?.includes(s.small), behind?.propositions[0] === lead?.propositions[0]],
      "the second change is about the second search in its own words, never the first search said again").toEqual([true, false]);
  });
  /** Stable base address for the largest search; each additional search carries its own canonical key. */
  it.each(SITES)("$t: offers two changes for two unanswered searches, and one change where there is one", async (s) => {
    const two = await mintFor(s, [[s.big, 900], [s.small, 300]]), one = await mintFor(s, [[s.big, 900]]);
    expect([two.map((c) => seatStem(c.id)), two.map((c) => c.primaryQuery), one.map((c) => seatStem(c.id)), one.map((c) => c.primaryQuery)],
      "the page's biggest unanswered search keeps the address it always had, the next one opens at its own, and a page with one unanswered search still offers exactly one change under the old address")
      .toEqual([[idOf(s), idOf(s, `@${canon(s.small)}`)], [s.big, s.small], [idOf(s)], [s.big]]);
    expect([new Set(two.map((c) => footprintKey(c))).size, two.map((c) => footprintKey(c).includes("::body::")), two.map((c) => c.changeFamily)],
      "two answers to two questions write two different things, so neither can quietly retire the other, and both are the same kind of work").toEqual([2, [true, true], ["answer_block", "answer_block"]]);
  });
  it("reads a five-letter spelling of the page's own subject as the subject, so no answer is bought to define an Iranian singer as an Iranian singer", async () => {
    const singers = { ...SITES[0]!, t: "tenant-one", path: "/famous-iranian-singers", title: "Famous Iranian Singers", passage: "These famous Iranian singers have left a lasting impact on Persian music, blending traditional and modern styles, making them some of the most popular Iranian (Persian) singers of all time." };
    expect((await mintFor(singers, [["irani singer", 290], ["irani singers", 120]])).map((c) => [c.primaryQuery, c.researchOnly, c.obligation?.kind, c.opportunityType.startsWith("A read of what wins")]), "the first funded answer (2026-09-15) was minted because \"irani\" carries five letters and no rule joined it to \"iranian\"; the page answers its own subject, so the only card left is the reading of what wins it, never a draft").toEqual([["irani singer", true, "evidence", true]]); });
  /** AND THE WRITER IS SENT TO THE RIGHT QUESTION. The walk reads the page's demand for itself and used to take
   *  the page's leading gap for whatever card it held, so the second change would have been researched, briefed and
   *  judged against the FIRST change's search: one row, two subjects, and money spent on a question that card was
   *  never about. A card wearing its own search key takes the gap that names it, and takes nothing where this pass's
   *  demand no longer names it at all. */
  it.each(SITES)("$t: keeps each change on its OWN search, reads that search's winners before a writer is hired with nothing on file, and settles a search this page no longer asks", async (s) => {
    const cards = await mintFor(s, [[s.big, 900], [s.small, 300]]), owed: string[][] = [];
    await walked(s, cards, owed); const away: string[][] = [], gone = await walked(s, [{ ...cards[1]!, primaryQuery: "which ferry crosses the sound", evidence: { query: "which ferry crosses the sound", hints: [], evidenceRefCount: 1 } }], away);
    const twice = await walked(s, await walked(s, cards, []), []); expect([twice.map((r) => r.limitations.includes(r.whyItMatters)), twice.map((r) => r.limitations)], "the diagnosis sentence is the row's own reason and is never appended to it as a limitation, so a walked tick and a held tick write the same row (101 rows re-versioned every ten minutes, production 2026-09-17)").toEqual([[false, false], (await walked(s, cards, [])).map((r) => r.limitations)]);
    expect([cards.map((c) => c.primaryQuery), owed, away, gone.map((r) => (r.obligation as { kind: string } | undefined)?.kind)],
      "each change stays named after its own search; with no checked fact and no winner's words on file the only ground is the page itself, so each card files the reading of its OWN search's winners (operator, 2026-09-15: the first funded answer restated the page to itself), never a fact check; a card whose search the demand no longer names buys nothing and says it has no gap rather than borrowing the other change's question")
      .toEqual([[s.big, s.small], [[`${s.path}::body::${canon(s.big)}`, s.big], [`${s.path}::body::${canon(s.small)}`, s.small]], [], ["terminal"]]);
  });
  /** COVERAGE IS THE ARBITER, NOT THE PRODUCER. A finished change on file already writing that section takes the
   *  opportunity off the list; a finished change about the OTHER search takes nothing off it. */
  it.each(SITES)("$t: holds the second change back while a finished change on file already writes that section", async (s) => {
    const held = await mintFor(s, [[s.big, 900], [s.small, 300]], [card(s, `${s.t}::${s.path}::existing_edit::ai_answer_gap`, s.small, { status: "ready", researchOnly: false })]);
    const other = await mintFor(s, [[s.big, 900], [s.small, 300]], [card(s, `${s.t}::${s.path}::existing_edit::ai_answer_gap`, "which tide covers the flats first", { status: "ready", researchOnly: false })]);
    expect([held.map((c) => c.primaryQuery), other.map((c) => c.primaryQuery)],
      "a change already writing that section is the opportunity, so it is not offered twice, and a change about a different search on the same page suppresses nothing").toEqual([[s.big], [s.big, s.small]]);
  });
  /** A GROUP THE WORK ALREADY ON FILE ANSWERS IS NOT A SECOND OPPORTUNITY (production 02:30Z, 2026-09-06). A page
   *  holding a Ready sentence for one phrasing of a question was given a SECOND Ready change for another phrasing of
   *  the same question, carrying that identical sentence: two phrasings tokenize differently, so they are two groups,
   *  and the page's own passages answer neither until the words are published. The copy a live change would publish
   *  is read by the SAME rule the page's own passages are read by. */
  it.each(SITES)("$t: reads a search a change on file already answers as answered, and never moves the biggest one", (s) => {
    const rows: Array<[string, number]> = [[s.big, 900], [s.small, 300], [s.third, 150]];
    const of = (r: Array<[string, number]>, copy: string | null): ReturnType<typeof demandOf> =>
      demandOf(page(s, r), body(s) as never, [], null, s.t, undefined, null, copy == null ? [] : [{ query: s.big, copy }]);
    const lead = (d: ReturnType<typeof demandOf>): unknown => substantiveGapOf({}, d as never);
    const behind = (d: ReturnType<typeof demandOf>): { query?: string } | null => substantiveGapOf({}, d as never, canon(s.big));
    expect([behind(of(rows.slice(0, 2), s.both)), behind(of(rows, s.both))?.query, behind(of(rows, s.onlyBig))?.query, behind(of(rows, null))?.query],
      "a page whose live change already answers the second search owes nothing more for it, reads the third search behind it where there is one, and still owes the second search where the words on file do not answer it")
      .toEqual([null, s.third, s.small, s.small]);
    expect(JSON.stringify([lead(of(rows, s.both)), lead(of(rows, s.onlyBig))]) === JSON.stringify([lead(of(rows, null)), lead(of(rows, null))]),
      "and the biggest search this page does not answer is read exactly as it was, so the change already on file never changes what it is about").toBe(true);
  });
  /** THE SAME RULE AT THE MINT: the producer reads the queue it already holds, so the second card is never minted to
   *  say what a live change on this page already says. */
  it.each(SITES)("$t: mints no second change for a search the live change on this page already answers, and still mints one for a search it does not", async (s) => {
    const rows: Array<[string, number]> = [[s.big, 900], [s.small, 300], [s.third, 150]];
    const live = (copy: string): ChangeProposal => card(s, idOf(s), s.big, { status: "ready", researchOnly: false,
      recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: copy } });
    const covered = await mintFor(s, rows, [live(s.both)]), open = await mintFor(s, rows, [live(s.onlyBig)]);
    expect([covered.map((c) => seatStem(c.id)), covered.map((c) => c.primaryQuery), open.map((c) => c.primaryQuery)],
      "the change already writing that answer keeps the address it has, the search its own words already answer is not offered a second time, and EVERY remaining search nothing on file answers earns its own change now that a page carries up to four a pass (operator, 2026-09-11, unlimited changes)")
      .toEqual([[idOf(s), idOf(s, `@${canon(s.third)}`)], [s.big, s.third], [s.big, s.small, s.third]]);
  });
});

describe("two sections on one page stand together, and each opens at its own address", () => {
  /** THE ID IS THE URL (`/changes/[id]`), so an address carrying its search key has to survive the store, the list
   *  and the detail read, and the second change has to be judged by the same doors as the first. */
  it.each(SITES)("$t: files both changes as current work, serves both, and judges the second by the same doors", async (s) => {
    const { saveChangeProposal, loadChangeProposal, loadChangeProposals } = await import("@/domains/decision/proposal-store");
    const first = card(s, idOf(s), s.big), second = card(s, idOf(s, `@${canon(s.small)}`), s.small);
    expect([await saveChangeProposal(first), await saveChangeProposal(second), db.rows.filter((r) => r.terminal_disposition == null).length],
      "the second section is saved beside the first rather than over it, so one page holds two current rows").toEqual(["saved", "saved", 2]);
    const served = await loadChangeProposals(s.t), opened = await loadChangeProposal(s.t, second.id);
    expect([[...served.keys()].sort(), opened?.id, opened?.primaryQuery, decodeURIComponent(encodeURIComponent(second.id)) === second.id],
      "the list serves both rows and the second opens at its own address, which survives being carried in a link")
      .toEqual([[first.id, second.id].sort(), second.id, s.small, true]);
    expect([deliverableGaps(opened as ChangeProposal), nextObligation(opened as ChangeProposal), deliverableGaps(first).length > 0],
      "the same doors ask the same questions of both, and they really do answer: what the second still owes before it is a deliverable, and what it owes next, are read exactly as the first's are rather than waved through on the shape of its address")
      .toEqual([deliverableGaps(first), nextObligation(first), true]);
  });
  /** THE STORE IS THE ARBITER OF OVERLAP, AND MERGING IS THE ONLY COMBINATION (Product Truth): a change writing
   *  PART of what a live change already writes is not saved beside it, whatever its id says. */
  it.each(SITES)("$t: refuses a second section that writes part of what a live change on this page already writes", async (s) => {
    const { saveChangeProposal } = await import("@/domains/decision/proposal-store");
    const wide = card(s, idOf(s, "@wide"), s.small, { bundle: { objective: `Answer "${s.small}" and show the counts beside it.`, metric: "clicks on this page for this search",
      scope: { queries: [s.small], prompts: [] },
      components: [{ kind: "section", label: "The answer", before: null, after: `A section answering "${s.small}" for a reader who asked exactly that.`, evidenceKeys: ["k1"], risk: "safe" },
        { kind: "table_or_list_add", label: "The counts", before: null, after: "A short table of the counts beside it.", evidenceKeys: ["k1"], risk: "safe" }],
      receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: `300 impressions for ${s.small}.`, observedAt: NOW.toISOString() }], missing: [], freshestObservedAt: NOW.toISOString() },
      alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "Clicks for this search are read after 14 days." } });
    const narrow = card(s, idOf(s, `@${canon(s.small)}`), s.small);
    expect([await saveChangeProposal(wide), await saveChangeProposal(narrow), db.rows.filter((r) => r.terminal_disposition == null).map((r) => r.id)],
      "the narrower section writes part of what the live change writes, so it is blocked rather than stood beside it, and the live change keeps every piece of its work").toEqual(["saved", "blocked", [wide.id]]);
  });
});

describe("two audiences losing clicks on one page are two rows", () => {
  /** EVERY RECOVERY CARD WAS NAMED AFTER ITS PAGE, so two lost audiences on one page wore ONE id and the dedupe
   *  behind the producer kept the larger and dropped the rest. The largest recoverable loss keeps the row already
   *  on file; the audience behind it carries its own canonical search key. */
  const unit = (label: string, recoverable: number, home: string) => ({ label, vocabulary: [label], queries: [], pages: [home],
    history: { earlyClicksPerDay: 4, recentClicksPerDay: 1, lostClicksPerMonth: 90, earlyImpressions: 4000, recentImpressions: 900,
      priorTopPage: home, currentTopPage: home, pageSwapped: false, earlyPosition: 4, recentPosition: 9,
      pageEarlyPosition: 4, pageRecentPosition: 9, pageShareEarly: 1, pageShareRecent: 1 },
    volume: null, serp: null, prompts: [], fanouts: [], winningPages: [], recoverableClicks: recoverable, tensions: [],
    audience: { impressions90d: 4000, aiAnswers: 0, lostClicksPerMonth: 90 }, seededBy: "search" as const });
  it.each(SITES)("$t: mints one row per lost audience, and the biggest loss keeps the row already on file", async (s) => {
    const { demandRecoveryCards } = await import("@/domains/decision/producers/demand-recovery"); const preloaded = { units: [unit(s.small, 20, url(s)), unit(s.big, 60, url(s))], historyWindow: { earlyDays: 120, earlyFrom: "2026-04-01", earlyTo: "2026-07-01" } };
    const both = await demandRecoveryCards({ tenantId: s.t, snapshot: snapshot(s, [page(s, [[s.big, 900]])]) as never, now: NOW, preloaded: preloaded as never });
    const alone = await demandRecoveryCards({ tenantId: s.t, snapshot: snapshot(s, [page(s, [[s.big, 900]])]) as never, now: NOW, preloaded: { ...preloaded, units: [unit(s.big, 60, url(s))] } as never });
    const base = `${s.t}::${s.path}::existing_edit::demand_recovery`;
    expect([both.cards.map((c) => c.id), both.cards.map((c) => c.primaryQuery), alone.cards.map((c) => c.id), new Set(both.cards.map((c) => footprintKey(c))).size],
      "the audience with the most recoverable clicks keeps the address the row already has whatever order the losses arrive in, the smaller one opens at its own, and the two write two different sections")
      .toEqual([[`${base}@${canon(s.small)}`, base], [s.small, s.big], [base], 2]);
  });
  it.each(SITES)("$t: never gives a retired base seat to the different query that ranks first today", async (s) => {
    const { demandRecoveryCards } = await import("@/domains/decision/producers/demand-recovery");
    const recovery = `${s.t}::${s.path}::existing_edit::demand_recovery`, answer = `${s.t}::${s.path}::existing_edit::missing_answer`, oldKey = `${s.path}::body::${canon(s.big)}`;
    db.rows.push({ tenant_id: s.t, page_key: s.path, id: recovery, mutation_key: oldKey, terminal_disposition: "withdrawn" }, { tenant_id: s.t, page_key: s.path, id: answer, mutation_key: oldKey, terminal_disposition: "dismissed" });
    const recovered = await demandRecoveryCards({ tenantId: s.t, snapshot: snapshot(s, [page(s, [[s.small, 900]])]) as never, now: NOW, preloaded: { units: [unit(s.small, 60, url(s))], historyWindow: { earlyDays: 120, earlyFrom: "2026-04-01", earlyTo: "2026-07-01" } } as never }), unanswered = await mintFor(s, [[s.small, 900]]);
    expect([recovered.cards[0]!.id, seatStem(unanswered[0]!.id)]).toEqual([`${recovery}@${canon(s.small)}`, `${answer}@${canon(s.small)}`]);
  });
  /** A SETTLEMENT NOBODY READ THE WINNERS FOR IS NOT A SETTLEMENT, AND THE STORE'S OWN RECOMPUTE IS WHERE IT IS ASKED (production 09:03:46Z, 2026-09-06). Four hub rows were re-saved `terminal: no substantive gap named` by the release sweep on searches no results page had ever been bought for: the rule that answered lived at the walk, a terminal row is never funded, so it could not reach that door and the sweep wrote the settlement back every pass. The comparison rides the card as `winnersOnFile` and the ladder owns the rule, so the mint, the sweep's re-mint and the walk give one answer. */
  it.each(SITES)("$t: a settled row whose winners nobody has read is re-minted owing that reading, and one whose winners were read and carry nothing stays settled", async (s) => {
    const { demandRecoveryCards } = await import("@/domains/decision/producers/demand-recovery"), { preferFinished } = await import("@/domains/decision/completeness");
    const W = `https://winner-${s.t}.example/page`, seen = (q: string, read = true) => ({ ...emptyResearchEvidence(), serpEvidence: [{ query: q, observedAt: null, organic: [{ rank: 1, url: W, domain: "winner.example", title: null }], aiOverview: [], aiMode: [], paa: [], related: [] }],
      winningPages: read ? [{ url: W, domain: "winner.example", engines: [], examplePrompts: [], appearances: [{ query: q }], extract: { title: "W", h1: null, wordCount: 900, headings: [], faqCount: 0, entityNames: [], mainText: s.passage, truncated: false, heldChars: 40, totalChars: 40 } }] : [] });
    const mint = async (on: string | null, read = true): Promise<ChangeProposal> => (await demandRecoveryCards({ tenantId: s.t, now: NOW, snapshot: { ...snapshot(s, [page(s, [[s.big, 900]])]), research: on == null ? emptyResearchEvidence() : seen(on, read) } as never,
      preloaded: { units: [{ ...unit(s.big, 60, url(s)), vocabulary: [s.big, s.small], ...(on == null ? {} : { serp: { winners: [], paa: [], related: [], observedAt: null } }) }], historyWindow: { earlyDays: 120, earlyFrom: "2026-04-01", earlyTo: "2026-07-01" } } as never })).cards[0]!;
    const owes = { kind: "evidence", need: { kind: "serp", query: s.big, reasonCode: "no_winner_to_read" } }, reads = { kind: "evidence", need: { kind: "competitor_page", query: s.big, reasonCode: "no_winner_to_read" } }, stands = { kind: "terminal", reason: "no substantive gap named" };
    const nothing = await mint(null), sibling = await mint(s.small), unreadOwn = await mint(s.big, false), own = await mint(s.big), settled = (c: ChangeProposal): ChangeProposal => ({ ...c, researchOnly: true, obligation: stands as never });
    /* Settlement expiry reopens evaluation, never writing authority for a historical investigation. */
    const young = (c: ChangeProposal): ChangeProposal => ({ ...c, createdAt: new Date().toISOString() });
    const expired = JSON.parse(JSON.stringify({ ...preferFinished(own, settled(own)), createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(), previousCopy: undefined })); expect([nextObligation(expired), writerKindOf(expired)], "expiry can reopen evaluation but never fund a historical-loss writer").toEqual([{ kind: "draft" }, null]);
    expect([[nothing.winnersOnFile, sibling.winnersOnFile, unreadOwn.winnersOnFile, own.winnersOnFile], nextObligation(young(preferFinished(nothing, settled(nothing)))), nextObligation(young(preferFinished(sibling, settled(sibling)))), nextObligation(young(preferFinished(unreadOwn, settled(unreadOwn)))), nextObligation(young(preferFinished(own, settled(own)))), nextObligation(young(preferFinished({ ...nothing, winnersOnFile: undefined, obligation: undefined }, settled(nothing))))],
      "the mint says what is on file for THIS row's own search: nothing at all, a results page bought for a sibling phrasing of the group and none for this search, this search's own results page with nothing off it read, or a page winning this very search read whole. The sweep re-mints the settled row through that same comparison and the store's own recompute turns the first three settlements into the reading each one owes, named by what is already on file for THIS search: the results page where none was ever bought for it, and the winners themselves where that page is on file and nothing off it has been read, while the last keeps its honest refusal, and a row no producer ever stamped is left exactly as it was because absent decides nothing")
      .toEqual([["none", "none", "unread", "read"], owes, owes, reads, stands, stands]);
  });
});

/** THE SAME RULE ON THE OTHER BODY PRODUCER: two AI answer cases landing on one page wore ONE id, spelled out of the
 *  page alone in five places, so the second card, the hold that keeps its writer waiting and the durable verdict all
 *  pointed at the first card's address and the smaller question was lost with no verdict anywhere. */
describe("two questions the assistants answer elsewhere on one page are two changes", () => {
  const site = (s: Site): string => `${s.t}.example`;
  /** ONE STORED ANSWER that credits somebody else, in the shape the snapshot carries it. */
  const answer = (prompt: string, promptId: string, i: number): unknown => ({ observationId: `${promptId}-${i}`, promptId, promptVersion: 1, promptText: prompt,
    engine: "chatgpt", modelRequested: null, modelServed: null, observationMode: "grounded", reportingDay: "2026-07-31", observedAt: null, answerHash: `h${promptId}${i}`,
    webSearchReported: null, citationsObserved: true, fanOutQueries: null, citations: [{ url: "https://rival.example/answer", domain: "rival.example", title: "A rival answer" }],
    retrievedResults: null, brandMentions: null, analysis: null });
  /** The account's stored answers, biggest question first: the order the producer decides seats in. */
  const answersFor = (s: Site): unknown[] => [...[0, 1].map((i) => answer(s.aiBig, "p-big", i)), answer(s.aiSmall, "p-small", 0)];
  /** THE READING OF THE PAGE the producer places a card on, handed in whole: no reading is bought here and none is faked away. */
  const understanding = (s: Site): unknown => { const job = { url: url(s), job: `What ${s.subject} is and what lives on it.`, pageType: "hub", audience: "readers new to it",
    topics: s.topics, commercial: false, promise: s.title, missing: "nothing yet", sells: [] };
    return { corpus: new Map([[`${site(s)}${s.path}`, job]]), held: [], hold: () => undefined, of: async () => ({ job, reason: "read" }) }; };
  /** The real producer, its stores faked and its purse EMPTY, so every case is diagnosed by nobody and no provider is reached. */
  const casesFor = async (s: Site, written?: Map<string, { query: string; copy: string }[]>, questions = answersFor(s)): Promise<{ drafts: { slug: string; query: string }[]; hold: string[]; filed: Record<string, unknown>[] }> => {
    vi.resetModules();
    vi.doMock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadOwnedPageBodies: async () => new Map([[`${site(s)}${s.path}`, body(s)]]) }));
    vi.doMock("@/domains/evidence/ai-visibility/answer-journeys", async (orig) => ({ ...(await orig<Record<string, unknown>>()), readAnswerJourneys: async () => [] }));
    const { aiCaseCards, AI_CASE_COPY } = await import("@/domains/decision/producers/ai-cases");
    const shot = snapshot(s, [page(s, [[s.big, 900]])]) as unknown as { research: { aiObservations: unknown[] } };
    shot.research = { ...shot.research, aiObservations: questions };
    const earned = new Map([[url(s), new Set(topicTokens(s.topics.join(" ")))]]); // the words this page has EARNED the right to be asked about, read the one way every door reads them
    const out = await aiCaseCards([], shot as never, [page(s, [[s.big, 900]])], new Set(), earned, new Map(), understanding(s) as never, s.t, [], [], NOW, true,
      AI_CASE_COPY.aeoMeter(0) as never, null, written);
    return { drafts: out.drafts.map((d) => ({ slug: d.slug, query: d.query })), hold: [...out.hold], filed: db.filed };
  };
  const aiId = (s: Site, tail = ""): string => `${s.t}::${s.path}::existing_edit::ai_answer_gap${tail}`;
  it.each(SITES)("$t: opens a change for each question, and the one the assistants answer most keeps the address it already had", async (s) => {
    const out = await casesFor(s);
    expect([out.drafts.map((d) => d.query), out.drafts.map((d) => `${s.t}::${s.path}::existing_edit::${d.slug}`), out.hold],
      "the page's strongest question keeps the id every row on file already wears and the one behind it opens at its own search, and the hold that keeps each writer waiting names the card it is actually about")
      .toEqual([[s.aiBig, s.aiSmall], [aiId(s, `@${canon(s.aiBig)}`), aiId(s, `@${canon(s.aiSmall)}`)], [aiId(s, `@${canon(s.aiBig)}`), aiId(s, `@${canon(s.aiSmall)}`)]]);
  });
  it.each(SITES)("$t: files the verdict on each question against the id its own card carries", async (s) => {
    const out = await casesFor(s);
    expect(out.filed.filter((r) => r.state === "actionable").map((r) => [r.query, r.proposalId]),
      "a verdict on file points at a change the operator can open, so the second question's row never names the first question's card")
      .toEqual([[s.aiBig, aiId(s, `@${canon(s.aiBig)}`)], [s.aiSmall, aiId(s, `@${canon(s.aiSmall)}`)]]);
  });
  it.each(SITES)("$t: opens no second change for a question the words of a change already on file answer", async (s) => {
    const out = await casesFor(s, new Map([[s.path.toLowerCase(), [{ query: s.aiBig, copy: s.aiAnswered }]]]));
    expect([out.drafts.map((d) => d.query), out.filed.filter((r) => r.state === "covered").map((r) => r.query), out.filed.find((r) => r.state === "covered")?.reason],
      "the change already on file publishes the answer, so the second question is covered there and says so instead of being minted again or dropped in silence")
      .toEqual([[s.aiBig], [s.aiSmall], `A change already on file for ${s.path} carries words that answer this search, so no second section is opened to say it again. Ship that change and the next answers get checked against it.`]);
  });
  it.each(SITES)("$t: opens two changes a page a pass and says where the third question stands", async (s) => {
    const out = await casesFor(s, undefined, [...answersFor(s), answer(s.aiThird, "p-third", 0)]);
    const waiting = out.filed.filter((r) => r.state === "covered");
    expect([out.drafts.length, out.drafts.map((d) => d.query).includes(s.aiBig), waiting.map((r) => r.reason), out.drafts.some((d) => d.query === waiting[0]?.query)],
      "a page opens the two changes one pass gives it, the question the assistants answer most is one of them, and the one left over is picked up next pass in a sentence rather than left silent")
      .toEqual([2, true, [`${s.path} already carries the 2 changes one pass opens for a single page, so this search is picked up on the next pass.`], false]);
  });
});
describe("historical recovery does not authorize copy changes", () => {
  it.each(["no results", "matching title", "missing title words", "AI overview", "ranking fell"])("%s: preserves the loss without inventing its cause, draft or promised recovery", async (variant) => { const s = SITES[0]!, hist = { earlyClicksPerDay: 1.9, recentClicksPerDay: 0.67, lostClicksPerMonth: 37, earlyImpressions: 9000, recentImpressions: 2000, priorTopPage: url(s), currentTopPage: url(s), pageSwapped: false, earlyPosition: 3, recentPosition: variant === "ranking fell" ? 5 : 4, pageEarlyPosition: 3, pageRecentPosition: variant === "ranking fell" ? 5 : 4, pageShareEarly: 1, pageShareRecent: 1 };
    const unit = { label: s.big, vocabulary: [s.big], queries: [], pages: [url(s)], history: hist, volume: null, serp: null, prompts: [], fanouts: [], winningPages: [], recoverableClicks: 0, tensions: [], audience: { impressions90d: 9000, aiAnswers: 0, lostClicksPerMonth: 37 }, seededBy: "search" as const };
    const snap = snapshot(s, [page(s, [[s.big, 900]])]); if (variant !== "no results") { snap.research!.serpEvidence = [{ query: s.big, observedAt: NOW.toISOString(), organic: [{ rank: 3, url: url(s), domain: `${s.t}.example`, title: variant === "missing title words" ? "Local guide" : s.big }, ...[1, 2].map((rank) => ({ rank, url: `https://winner${rank}.example/`, domain: `winner${rank}.example`, title: s.big }))], aiOverview: variant === "AI overview" ? ["An answer displayed before organic results."] : [], aiMode: [], paa: [], related: [] }] as never; unit.serp = { winners: [], paa: [], related: [], observedAt: NOW.toISOString() } as never; } const out = await (await import("@/domains/decision/producers/demand-recovery")).demandRecoveryCards({ tenantId: s.t, snapshot: snap, now: new Date(), preloaded: { units: [unit as never], historyWindow: { earlyDays: 390, recentDays: 90, earlyFrom: "2025-05-26", earlyTo: "2026-06-20" } } as never });
    const c = out.cards[0]!; expect([out.losses[0]?.lostPerMonth, c.opportunityType, c.pageLabel, c.whyItMatters.startsWith(`Searches for ${s.big} brought this site about 57 clicks a month from May 2025 to June 2026 and bring about 20 now, down 37 a month.`), c.causeFinding?.action, c.diagnosisCause, c.recommendedChange.kind === "existing_edit" && c.recommendedChange.field, c.researchOnly, nextObligation(c)?.kind, c.estimatedEffortMinutes]).toEqual([37, `Explain the "${s.big}" decline on ${s.title}: down 37 clicks a month and the cause is not yet separable`, s.title, true, null, "no_problem", "section", true, "evidence", 0]); for (const researchOnly of [false, true]) { const prior = card(s, c.id, s.big, { status: "ready", researchOnly, diagnosisCause: "ranking_loss", causeFinding: { cause: "ranking_loss", action: "section", evidenceKeys: [], explanation: "Positions fell so write a section.", competingExplanations: [], notConsidered: [], falsifier: "Clicks do not return." }, claims: [{ text: s.onlyBig, supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: s.onlyBig }], recommendedChange: { kind: "existing_edit", field: "section", before: null, after: s.onlyBig, where: "After the opening paragraph" } }), replay = preferFinished(JSON.parse(JSON.stringify(c)), JSON.parse(JSON.stringify(prior))), silent = preferFinished({ ...c, diagnosisCause: undefined, causeFinding: undefined }, prior); expect([replay.researchOnly, replay.diagnosisCause, replay.causeFinding?.action, replay.assignment, replay.recommendedChange, nextObligation(replay)?.kind, replay.previousCopy?.after, silent.diagnosisCause, writerKindOf(replay)]).toEqual([true, "no_problem", null, undefined, c.recommendedChange, "evidence", researchOnly ? undefined : s.onlyBig, "ranking_loss", null]); } });
});
