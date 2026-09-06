/** ONE PAGE IS A CONTAINER OF ATOMIC OPPORTUNITIES (Product Truth, one page is never one opportunity). A page that
 *  earns two searches it never answers owes two sections: two changes, each ranked on its own demand, each opening
 *  at its own address. The reader stopped at the biggest unanswered search and the producers named every card after
 *  the PAGE alone, so for as long as the bigger change stood unimplemented the smaller one was invisible. Two
 *  synthetic accounts with unrelated subjects: nothing here names a real customer, language or page family. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvidenceSnapshot, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import { canonicalQueryKey as canon } from "@/domains/evidence/relevance-gate";
import { substantiveGapOf } from "@/domains/decision/diagnosis";
import { demandOf } from "@/domains/decision/drafted-copy";
import { footprintKey } from "@/domains/decision/mutation-footprint";
import { deliverableGaps } from "@/domains/decision/completeness";
import { nextObligation } from "@/domains/decision/obligation";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
const db = vi.hoisted(() => ({ rows: [] as Row[] }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => client }));
/** The live index: `ux_change_proposals_current` is (tenant, case, page, family, mutation_key) over current rows,
 *  so two sections on one page really do stand together only while what they WRITE differs. */
const client = supabaseFake({ rows: () => db.rows, insertDefaults: () => ({ created_at: "2026-08-01T00:00:00.000Z" }),
  clash: (row, rows) => (rows.some((r) => r.id !== row.id && r.terminal_disposition == null
    && ["tenant_id", "case_id", "page_key", "action_family", "mutation_key"].every((c) => r[c] === row[c]))
    ? { message: "duplicate key value violates unique constraint ux_change_proposals_current" } : null) });
const NOW = new Date("2026-08-01T00:00:00.000Z");
/** TWO SEARCHES ONE PAGE EARNS AND NEVER ANSWERS, plus one passage that answers neither, on unrelated subjects. */
const SITES = [
  { t: "tenant-one", path: "/rock-pools", title: "Rock pools of the north coast", subject: "north coast ledges",
    big: "how cold is the winter water", small: "which mussels grow on the ledges",
    passage: "Visitors walk out at low tide and come back before the flats fill again." },
  { t: "tenant-two", path: "/bordado", title: "Bordado borders and stitch counts", subject: "bordado borders",
    big: "how many strands does a border take", small: "which loom weaves the widest cloth",
    passage: "Every panel here is worked flat on a frame that keeps the cloth taut." },
];
type Site = (typeof SITES)[number];
const url = (s: Site): string => `https://${s.t}.example${s.path}`;
const page = (s: Site, rows: Array<[string, number]>): OwnedPageEvidence => ({ url: url(s),
  content: { title: s.title, metaDescription: "d", h1: s.title, h2: [], outline: [], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: NOW.toISOString() },
  search: { clicks90d: 10, impressions90d: 9000, ctr90d: 0.01, position90d: 8, topQueries: rows.map(([query, impressions]) => ({ query, impressions, clicks: 1, position: 8 })) },
  engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } });
const body = (s: Site): unknown => ({ url: url(s), title: s.title, h1: s.title, metaDescription: null, headings: [], passages: [s.passage], vocabulary: "", cardTexts: [], faqs: [], entityNames: [], internalLinks: [], openingSample: s.passage, fetchedAt: NOW.toISOString(), completeness: "complete", contentHash: "h", heldNote: null });
const snapshot = (s: Site, pages: OwnedPageEvidence[]): EvidenceSnapshot => ({ scope: { tenantId: s.t, site: `${s.t}.example`, builtAt: NOW.toISOString() },
  aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [],
  cannibalization: [], contentGaps: [], internalLinkOpportunities: [], evidenceHash: "fixture", research: emptyResearchEvidence(), ownedPages: pages });
/** THE PRODUCER, run with the account's stored rows and stored bodies handed in, exactly as the walk hands them. */
const mintFor = async (s: Site, rows: Array<[string, number]>, standing: unknown[] = []): Promise<ChangeProposal[]> => {
  vi.resetModules();
  vi.doMock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadChangeProposals: async () => new Map((standing as { id: string }[]).map((r) => [r.id, r])) }));
  vi.doMock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadOwnedPageBodies: async () => new Map([[`${s.t}.example${s.path}`, body(s)]]) }));
  const out = await (await import("@/domains/decision/producers/extra")).extraQueueCards({ tenantId: s.t, snapshot: snapshot(s, [page(s, rows)]) as never, now: NOW, reads: { left: 0 }, persist: false });
  return out.cards.filter((c) => c.id.includes("::existing_edit::missing_answer"));
};
const idOf = (s: Site, tail = ""): string => `${s.t}::${s.path}::existing_edit::missing_answer${tail}`;
/** THE WALK OVER THOSE CARDS, with the page's own words in hand and no provider behind it: what it says each card
 *  must BUY is the one observation that proves which search the writer was about to be briefed on. */
const walked = async (s: Site, cards: ChangeProposal[], owed: string[][]): Promise<ChangeProposal[]> => {
  vi.resetModules();
  vi.doMock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadOwnedPageBodies: async () => new Map([[`${s.t}.example${s.path}`, body(s)]]) }));
  const { applyDraftedCopy } = await import("@/domains/decision/drafted-copy"), { DRAFT_BUDGET } = await import("@/domains/decision/draft-budget");
  const budget = DRAFT_BUDGET.plan({ jobs: cards.map((c) => ({ key: DRAFT_BUDGET.keyOf(c), family: "editor" as const, impact: c.impactScore ?? 0, calls: DRAFT_BUDGET.DELIVERABLE_CALLS })), candidates: cards.length, calls: 30 });
  return await applyDraftedCopy(cards as never, { tenantId: s.t, snapshot: snapshot(s, [page(s, [[s.big, 900], [s.small, 300]])]) as never, now: NOW, budget,
    owe: (k: string, need: { query?: string }) => owed.push([k, need.query ?? ""]), complete: async () => ({ value: {} }) } as never) as ChangeProposal[]; };
/** A CARD THE STORE WILL TAKE, carrying the one search it is about, so what it writes is that search's own section. */
const card = (s: Site, id: string, query: string, over: Partial<ChangeProposal> = {}): ChangeProposal => ({ id, tenantId: s.t, kind: "existing_edit", pagePath: s.path, pageUrl: url(s),
  pageLabel: s.title, primaryQuery: query, opportunityType: `An answer to "${query}"`, changeFamily: "section", status: "needs_review",
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: `One section on ${s.path} that answers "${query}" in this page's own voice.` },
  whyItMatters: `Searchers ask "${query}" here and nothing on the page answers it.`, estimatedEffortMinutes: 30, riskLevel: "low", confidence: "medium",
  limitations: [], evidence: { query, hints: [], evidenceRefCount: 1 }, impactScore: 40, upsidePerMonth: null, basis: "basis_today::d6", publish: "manual", createdAt: NOW.toISOString(), ...over });

beforeEach(() => { db.rows = []; vi.doUnmock("@/domains/decision/proposal-store"); vi.doUnmock("@/domains/evidence/pages/owned-context"); vi.resetModules(); });

describe("a page carries as many changes as it has searches it never answers", () => {
  /** THE READER USED TO STOP AT THE BIGGEST ONE. `demandGap` took the largest group this page's passages do not
   *  answer and returned; asked again with that group's own key, it answers for the next one, with its own verdict,
   *  its own proposition and its own owed step, and the first group's verdict is byte for byte what it was. */
  it.each(SITES)("$t: reads the second search this page never answers, with its own verdict and its own owed step", (s) => {
    const demand = demandOf(page(s, [[s.big, 900], [s.small, 300]]), body(s) as never, [], null, s.t);
    const lead = substantiveGapOf({}, demand as never), behind = substantiveGapOf({}, demand as never, canon(lead?.query ?? ""));
    const alone = substantiveGapOf({}, demandOf(page(s, [[s.big, 900]]), body(s) as never, [], null, s.t) as never), asked = (g: typeof lead): unknown => (g?.owed as { need?: { query?: string } } | undefined)?.need?.query;
    expect([lead?.kind, lead?.query, asked(lead), behind?.kind, behind?.query, asked(behind), JSON.stringify(alone) === JSON.stringify(lead)],
      "the biggest unanswered search is read exactly as it always was, the next one behind it is its own missing answer buying a source for ITS OWN search rather than for the first one, and a page with only the big search on it reads identically")
      .toEqual(["missing_answer", s.big, s.big, "missing_answer", s.small, s.small, true]);
    expect([behind?.propositions[0]?.includes(s.small), behind?.propositions[0] === lead?.propositions[0]],
      "the second change is about the second search in its own words, never the first search said again").toEqual([true, false]);
  });
  /** THE ID IS THE ADDRESS, so the change already on file may never be renamed: the biggest search keeps the id it
   *  has always had and the one behind it carries its own canonical search key, the way a link card carries its
   *  destination. Two ids, two mutations, two rows the ranking can compare against everything else. */
  it.each(SITES)("$t: offers two changes for two unanswered searches, and one change where there is one", async (s) => {
    const two = await mintFor(s, [[s.big, 900], [s.small, 300]]), one = await mintFor(s, [[s.big, 900]]);
    expect([two.map((c) => c.id), two.map((c) => c.primaryQuery), one.map((c) => c.id), one.map((c) => c.primaryQuery)],
      "the page's biggest unanswered search keeps the address it always had, the next one opens at its own, and a page with one unanswered search still offers exactly one change under the old address")
      .toEqual([[idOf(s), idOf(s, `@${canon(s.small)}`)], [s.big, s.small], [idOf(s)], [s.big]]);
    expect([new Set(two.map((c) => footprintKey(c))).size, two.map((c) => footprintKey(c).includes("::body::")), two.map((c) => c.changeFamily)],
      "two answers to two questions write two different things, so neither can quietly retire the other, and both are the same kind of work").toEqual([2, [true, true], ["answer_block", "answer_block"]]);
  });
  /** AND THE WRITER IS SENT TO THE RIGHT QUESTION. The walk reads the page's demand for itself and used to take
   *  the page's leading gap for whatever card it held, so the second change would have been researched, briefed and
   *  judged against the FIRST change's search: one row, two subjects, and money spent on a question that card was
   *  never about. A card wearing its own search key takes the gap that names it, and takes nothing where this pass's
   *  demand no longer names it at all. */
  it.each(SITES)("$t: sends each change to buy the source for its OWN search, and buys nothing for a search this page no longer asks", async (s) => {
    const cards = await mintFor(s, [[s.big, 900], [s.small, 300]]), owed: string[][] = [];
    await walked(s, cards, owed); const away: string[][] = [], gone = await walked(s, [{ ...cards[1]!, primaryQuery: "which ferry crosses the sound", evidence: { query: "which ferry crosses the sound", hints: [], evidenceRefCount: 1 } }], away);
    expect([cards.map((c) => c.primaryQuery), owed, away, gone.map((r) => (r.obligation as { kind: string } | undefined)?.kind)],
      "each change buys the source for the search it is named after, on the funding key that same search computes, and a change whose search this page's demand no longer names buys nothing at all and says it has no gap, rather than borrowing the other change's question")
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
    const { demandRecoveryCards } = await import("@/domains/decision/producers/demand-recovery");
    const preloaded = { units: [unit(s.small, 20, url(s)), unit(s.big, 60, url(s))], historyWindow: { earlyDays: 120, earlyFrom: "2026-04-01", earlyTo: "2026-07-01" } };
    const both = await demandRecoveryCards({ tenantId: s.t, snapshot: snapshot(s, [page(s, [[s.big, 900]])]) as never, now: NOW, preloaded: preloaded as never });
    const alone = await demandRecoveryCards({ tenantId: s.t, snapshot: snapshot(s, [page(s, [[s.big, 900]])]) as never, now: NOW, preloaded: { ...preloaded, units: [unit(s.big, 60, url(s))] } as never });
    const base = `${s.t}::${s.path}::existing_edit::demand_recovery`;
    expect([both.cards.map((c) => c.id), both.cards.map((c) => c.primaryQuery), alone.cards.map((c) => c.id), new Set(both.cards.map((c) => footprintKey(c))).size],
      "the audience with the most recoverable clicks keeps the address the row already has whatever order the losses arrive in, the smaller one opens at its own, and the two write two different sections")
      .toEqual([[`${base}@${canon(s.small)}`, base], [s.small, s.big], [base], 2]);
  });
});
