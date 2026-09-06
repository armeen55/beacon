/** THE NEW-PAGE PATHWAY, EXERCISED END TO END ON INJECTED EVIDENCE. Live research justified no new page during this campaign, so the whole pathway is proved here on a TYPED verdict and a TYPED writer: a justified opportunity becomes a stored proposal carrying a title, a description, an opening and an outline, its own earlier paragraphs reach the writer of the next one under the class that says a model wrote them, an unwritten section stops the page rather than shipping part of one, the canon passes the finished page, the row reaches Ready and the store keeps it byte-stable on a second unchanged pass. INJECTED, never a live finished new page, and the test titles say so. Two synthetic accounts, neither a real customer and neither on the same subject. */
import { describe, it, expect, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], client: {} as Record<string, unknown> }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "t", domain: "alpha.example", growth_goal: null }), basisTag: () => "basis_test" }));
import { buildNewPageProposal } from "@/domains/decision/new-page";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { openHold } from "@/domains/decision/completeness";
import { nextObligation } from "@/domains/decision/obligation";
import { proposalFingerprint, saveChangeProposal } from "@/domains/decision/proposal-store";
import { validateProposal } from "@/domains/decision/validate-proposal";
import { supabaseFake } from "../helpers/supabase-fake";
import type { DecidedTopic } from "@/domains/decision/coverage-pass";
Object.assign(db.client, supabaseFake({ rows: () => db.rows }), { rpc: async () => ({ data: "saved", error: null }) });

const NOW = new Date("2026-09-05T08:00:00.000Z"), READ_ON = "2026-09-01T00:00:00.000Z";
const SITES = [
  { t: "tenant-one", host: "alpha.example", key: "tide-pool-safety", label: "tide pool safety", own: "/shore-walks", ownTitle: "Shore walks", ownSample: "Shore walks run along the same coast at low tide.",
    title: "Tide pool safety, and how to read the water before you go", meta: "What makes a tide pool dangerous, when the rocks are worst, and how to read the water before you walk out.",
    opening: "A tide pool is safe to walk when the water is going out and the rock is dry, and it turns dangerous the moment the tide turns back.", tail: "whether the rock underfoot stays dry, and a walker who reads the water before stepping out already knows which of the two they are getting that morning.", heads: ["When the rocks turn slick", "What to watch on the way out", "What to do when the tide turns"], winner: "Tide pool safety depends on the swell forecast, on the barnacle crust underfoot, and on the anemone beds that walkers crush without noticing.", echo: ["swell forecast", "barnacle crust", "anemone beds"] },
  { t: "tenant-two", host: "beta.example", key: "bordado-a-mano", label: "puntadas de bordado a mano", own: "/telas", ownTitle: "Telas para bordar", ownSample: "Las telas para bordar se tensan en un bastidor antes de empezar.",
    title: "Puntadas de bordado a mano, y cuando se usa cada una", meta: "Que puntadas de bordado se usan para contornos, cuales para rellenos y como se prepara el hilo antes de enhebrar la aguja.",
    opening: "Una puntada de bordado a mano se elige por lo que tiene que hacer en la tela, y la de tallo sirve para contornos mientras la de nudo marca los puntos.", tail: "cuantas hebras de hilo se separan antes de enhebrar la aguja, y quien lo prepara asi termina la labor sin deshacer ni una vuelta.", heads: ["Puntadas para contornos", "Puntadas para rellenos", "Como preparar el hilo"], winner: "Las puntadas de bordado a mano se agrupan por densidad y por grosor, por el tejido que recibe cada trazo, y por el remate que cierra la costura.", echo: ["densidad grosor", "tejido trazo", "remate costura"] },
] as const;
type Site = (typeof SITES)[number];

/** The typed verdict a coverage pass hands over: create_new, no owned page named as the answer, nothing owed, and the alternatives ruled out in writing. Injected here rather than derived from a snapshot, which is what makes this a contract and not a live acceptance. */
const decided = (s: Site): DecidedTopic => ({
  investigation: { key: s.key, aliasKeys: [s.key], label: s.label, demandBasis: "search", groupedBy: [], queries: [s.label], keywords: [],
    demand: { monthlySearchVolume: 900, queriesWithVolume: 1, gscImpressions: null, difficulty: 20, intent: "informational", trackedPrompts: 1, fanOuts: 1, engines: ["chatgpt"] },
    trackedPrompts: [{ promptId: "p1", promptText: s.label, engine: "chatgpt" }], fanOuts: [{ query: s.label, observationId: "obs-1", observedAt: READ_ON }],
    answerIntel: { answers: 0, observationIds: [], latestObservedAt: null, competitors: [], contentTypes: [], omissions: [], sections: [], claims: [], caveats: [] },
    exactSerps: [{ query: s.label, observedAt: READ_ON, freshness: "current", organicResults: 10, distinctDomains: 8, aiOverviewCitations: 0, aiModeCitations: 0, paaQuestions: 3, organicRows: [], aiOverviewRows: [], aiModeRows: [] }],
    serpFreshness: "current", distinctResultDomains: 8, resultDomains: ["r1.example", "r2.example", "r3.example"], pageType: "informational_guide", pageTypeVotes: [], serpCoherence: "coherent",
    winners: [1, 2, 3].map((n) => ({ url: `https://r${n}.example/${s.key}`, domain: `r${n}.example`, extractState: "current", wordCount: 900, headings: 6, fetchedAt: READ_ON, appearances: [] })),
    distinctWinners: 3, currentReadableWinners: 3, missingEvidence: [], nextAcquisition: null, diminishing: false } as never,
  candidates: [{ url: `https://${s.host}${s.own}`, path: s.own, title: s.ownTitle, h1: s.ownTitle, wordCount: 400, outlineLength: 3, openingSample: s.ownSample, entities: [], fetchedAt: READ_ON, bodyHeld: true, signals: [], strongSignals: 0 }],
  decision: { verdict: "create_new", topicKey: s.key, ownedUrls: [], evidenceKeys: ["verdict"], missing: [], alternativesRuledOut: [{ alternative: `Stretch ${s.own} to cover it`, reason: "that page answers a different question and burying this one in it helps nobody" }],
    explanation: `Nothing you own comes up for "${s.label}", and the three pages that win it agree on what one has to cover.` } as never,
  reading: null,
});

/** The brief the outline model returns, and the sections the ONE canonical editor writes. Every claim cites the account's OWN other page, which is the only class a new page may stand on: its own drafted paragraphs are context, never authority. */
const brief = (s: Site) => ({ proposedTitle: s.title, metaDescription: s.meta, openingAnswer: s.opening,
  whyExistingPagesLose: `Your page ${s.host}${s.own} covers the wider subject and never answers this one, so stretching it would bury the answer people are looking for.`,
  sections: s.heads.map((heading) => ({ heading, covers: "Answer this plainly for a reader who has never done it.", evidenceKeys: ["verdict"] })),
  sourceRequirements: [], factRequirements: [], internalLinks: [{ url: `https://${s.host}${s.own}`, anchor: s.ownTitle }], faqQuestions: [], headKeys: ["verdict"] });
const RULED = { pageFit: true, resolvesDiagnosis: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, resolution: "none" };
const section = (s: Site, user: string) => { const heading = (user.match(/Write the section headed "(.*?)"/) ?? [])[1] ?? s.title;
  return { field: "answer_block", before: null, after: `${s.ownSample} ${heading} decides ${s.tail}`,
    naturalHeading: heading, placementAnchor: s.title, measurementTarget: s.label, implementationMinutes: 15, evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "medium",
    rationale: `Nothing this account owns answers "${s.label}", so this section says it outright.`, risks: ["read it once before it goes out"], operatorSteps: ["Paste this section under its own heading"], proofPlan: { metrics: ["clicks", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
    claims: [{ text: `${s.ownSample} ${heading} follows from that.`, supportedBy: ["owned-page-1"] }] }; };
/** ONE injected drafting pass: the brief, then the opening and every planned section, each read for sense. `sections: false` refuses the last one, which is how the pathway proves it hands over no part of a page. */
const seam = (s: Site, sections = true) => { const asked: string[] = [], kinds: string[] = [];
  return { asked, kinds, complete: async ({ kind, user }: { kind: string; user: string }) => { kinds.push(kind); asked.push(user);
    if (kind === "new_page_brief") return { value: brief(s) as never };
    if (kind === "editor_judgement") return { value: { ...RULED, notes: `It answers "${s.label}", which nothing here does yet.`, claims: [{ i: 0, by: ["owned-page-1"], entailed: true }] } as never };
    return sections || !user.includes(`Write the section headed "${s.heads[2]}"`) ? { value: section(s, user) as never } : { error: "no answer", retryable: true }; } }; };

describe("the injected new-page contract, end to end", () => {
  it.each(SITES)("builds one whole page from an injected verdict, keeps its own drafted paragraphs out of its evidence about a page, passes the canon and reaches Ready, on $t", async (s) => {
    db.rows = [];
    const wire = seam(s), out = await buildNewPageProposal(decided(s), s.t, { complete: wire.complete as never, now: NOW });
    expect(out.status, `an injected create_new verdict builds a page: ${out.status === "none" ? out.reason : ""}`).toBe("built");
    const page = out.status === "built" ? out.proposal : null as never;
    expect([page.recommendedChange.kind === "new_page" && page.recommendedChange.proposedTitle, page.recommendedChange.kind === "new_page" && page.recommendedChange.metaDescription,
      page.recommendedChange.kind === "new_page" && page.recommendedChange.outline, page.pageLabel],
      "the stored page carries a title, a description and the outline it was planned with, and its label is the title a reader will see").toEqual([s.title, s.meta, [...s.heads], s.title]);
    expect((page.recommendedChange.kind === "new_page" ? page.recommendedChange.openingAnswer : "").length > 40, "and an opening written and read like every other piece, never the plan's own sentence shipped unread").toBe(true);
    const wrote = wire.asked.join(" ");
    expect([/\bdraft-so-far-1:/.test(wrote), /\bpage-copy-\d:/.test(wrote), (page.claims ?? []).every((c) => c.supportedBy.every((id) => /^owned-page/.test(id)))],
      "the page's own earlier paragraphs reach the writer of the next section under the class that says a model wrote them, no gate is handed them as words observed on a live page, and every claim stands on another page this account owns").toEqual([true, false, true]);
    expect([validateProposal(page).verdict, page.status, openHold(page).blocking, nextObligation(page)], "the canon passes the finished page, the row reaches Ready, the one servability verdict holds nothing back, and the ladder that owed every section until it was written now owes nothing").toEqual(["ready", "ready", null, null]);
    expect(await saveChangeProposal(page), "the store takes it").toBe("saved");
    expect([await saveChangeProposal(page), db.rows.length], "and a second unchanged pass writes nothing at all: one row, byte for byte the row already on file").toEqual(["unchanged", 1]);
    const again = await buildNewPageProposal(decided(s), s.t, { complete: seam(s).complete as never, now: new Date("2026-09-05T09:00:00.000Z") });
    expect(proposalFingerprint(again.status === "built" ? again.proposal : page), "a second build of the same verdict hashes to the same work, so nothing re-derived re-writes the row").toBe(proposalFingerprint(page));
  });

  /** A PIECE OF THIS PAGE GOT ONE ATTEMPT AND NO CORRECTION (production, topic inv_3446de602284, 2026-09-06). Every piece here goes through the ONE canonical editor, but only the existing-page caller ran its corrective rounds, so any refusal at all discarded the piece with the writer never told what the gate objected to, and a refused OPENING broke the section loop before it began: the account's highest ranked job spent 3 of its 12 funded calls on every pass and filed "0 of the 4 sections this page needs are written and 4 are still owed" for ever. */
  it.each(SITES)("buys a refused piece the corrective round the policy already prices, tells it the exact objection, and stops at that number, on $t", async (s) => {
    const flaky = (fails: (heading: string) => number) => { const wrote: string[] = [], seen = new Map<string, number>(); return { wrote, complete: async ({ kind, user }: { kind: string; user: string }) => {
        if (kind === "new_page_brief") return { value: brief(s) as never }; if (kind === "editor_judgement") return { value: { ...RULED, notes: `It answers "${s.label}".`, claims: [{ i: 0, by: ["owned-page-1"], entailed: true }] } as never };
        wrote.push(user); const head = (user.match(/Write the section headed "(.*?)"/) ?? [])[1] ?? s.title, nth = (seen.get(head) ?? 0) + 1; seen.set(head, nth); const good = section(s, user); return { value: (nth <= fails(head) ? { ...good, claims: [{ text: good.claims[0]!.text, supportedBy: ["an-id-nobody-banked"] }] } : good) as never }; } }; };
    db.rows = []; const once = flaky((h) => (h === s.title ? 1 : 0)), built = await buildNewPageProposal(decided(s), s.t, { complete: once.complete as never, now: NOW }); const never0 = flaky((h) => (h === s.heads[2] ? 99 : 0)), stuck = await buildNewPageProposal(decided(s), s.t, { complete: never0.complete as never, now: NOW });
    const asks = (w: string[], head: string): string[] => w.filter((u) => u.includes(`Write the section headed "${head}"`)); // the opening is written under the page's own title, every section under its own heading
    expect([built.status, built.status === "built" && (built.proposal.recommendedChange.kind === "new_page" ? built.proposal.recommendedChange.outline : []), asks(once.wrote, s.title).length, asks(once.wrote, s.title)[1]?.includes("an-id-nobody-banked"), stuck.status, stuck.status === "none" && stuck.reason.includes(s.heads[2]!), asks(never0.wrote, s.heads[2]!).length],
      "an opening refused once is written on the round the twelve-call price already pays for, so the sections behind it are written and the whole page is handed over instead of nothing; the corrective round is handed the gate's own objection rather than asked again; and a piece that will not write stops at one attempt plus the retries the policy prices, leaving the honest sentence naming what is still owed")
      .toEqual(["built", [...s.heads], 2, true, "none", true, 1 + DRAFT_BUDGET.RETRIES]);
  });

  it.each(SITES)("hands over no part of a page when a planned section will not write, and names what is still owed, on $t", async (s) => {
    db.rows = [];
    const out = await buildNewPageProposal(decided(s), s.t, { complete: seam(s, false).complete as never, now: NOW });
    expect([out.status, out.status === "none" && out.reason.includes(s.heads[2])], "part of a page is not worth handing over, and the reason names the section the next attempt picks up").toEqual(["none", true]);
    expect(db.rows.length, "and nothing was stored").toBe(0);
  });
});

/** THE PAGES THAT ALREADY WIN THESE SEARCHES, ON FILE AND READ, exactly as an account holding seven winners for one topic holds them: one results page ranking one winner, and that winner's own main text. `carries` false is a winner read whole that says only what this page already plans, which is the case that owes a source rather than a writer. */ const research = (s: Site, carries: boolean) => ({ serpEvidence: [{ query: s.label, organic: [{ url: `https://w1.example/${s.key}` }] }], winningPages: [{ url: `https://w1.example/${s.key}`, domain: "w1.example", appearances: [{ kind: "serp_organic", query: s.label }], extract: { title: s.title, h1: s.title, wordCount: 900, headings: [s.title], h3s: [], entityNames: [], faqCount: 0, truncated: false, mainText: carries ? s.winner : `${s.ownSample} ${s.title} decides ${s.tail}` } }] }) as never;
/** The same injected writer, with the copy a section written FROM the winners' reading looks like (it says two of the winner's own words in its own sentence) or the copy that narrates the plan back (nothing but the page's own drafted words, cited as such). */ const off = (s: Site, user: string, kind: "reads" | "narrates") => { const good = section(s, user), heading = good.naturalHeading; return { ...good, after: kind === "reads" ? `${s.echo[Math.max(0, (s.heads as readonly string[]).indexOf(heading ?? ""))]} come first for anyone doing this. ${s.opening}` : `${s.ownSample} ${s.title} decides ${s.tail} ${heading} follows from that.`, claims: [{ text: `${s.title} decides ${s.tail}`, supportedBy: ["draft-so-far-1"] }] }; };
const wired = (s: Site, kind: "reads" | "narrates", held = false) => { const asked: string[] = [], kinds: string[] = []; let by: string[] = ["owned-page-1"]; return { asked, kinds, complete: async ({ kind: k, user }: { kind: string; user: string }) => { kinds.push(k); asked.push(user); if (k === "new_page_brief") return held ? { error: "the brief must not be bought again", retryable: false } : { value: brief(s) as never }; if (k === "editor_judgement") return { value: { ...RULED, notes: `It answers "${s.label}".`, claims: [{ i: 0, by, entailed: true }] } as never }; const draft = user.includes(`Write the section headed "${s.title}"`) ? section(s, user) : off(s, user, kind); by = [...draft.claims[0]!.supportedBy]; return { value: draft as never }; } }; };

describe("a new page's sections are written from the winners' words, or the source they owe is filed", () => {
  it.each(SITES)("writes a section from what the winners answer and refuses one that narrates the plan back, telling the next round exactly that, on $t", async (s) => { db.rows = []; const w = wired(s, "reads"), out = await buildNewPageProposal(decided(s), s.t, { complete: w.complete as never, now: NOW, research: research(s, true) }); const wrote = w.asked.filter((u) => u.includes(`Write the section headed "${s.heads[0]}"`)).join(" ");
    expect([out.status, wrote.includes("rival-1: w1.example is "), wrote.includes("STATE THOSE IN YOUR OWN WORDS"), wrote.includes(s.echo[0]!.split(" ")[0]!), out.status === "built" && (out.proposal.recommendedChange.kind === "new_page" ? out.proposal.recommendedChange.outline : [])],
      "every winner reaches the section writer under the one id class no claim may name, carrying its publisher class and its own quoted words with the order to answer in its own words, and a section that says what they answer stands, so every planned section is written").toEqual(["built", true, true, true, [...s.heads]]); const n = wired(s, "narrates"), back = await buildNewPageProposal(decided(s), s.t, { complete: n.complete as never, now: NOW, research: research(s, true) }); const rounds = n.asked.filter((u) => u.includes(`Write the section headed "${s.heads[0]}"`));
    expect([back.status, back.status === "none" && back.reason.includes(s.heads[0]!), rounds.length > 1, rounds[1]?.includes("so a reader already on the page learns nothing"), db.rows.length],
      "and copy that says only what the plan already said is refused however clean it is, the corrective round is handed that exact objection, no part of the page is handed over and nothing is stored").toEqual(["none", true, true, true, 0]); });

  it.each(SITES)("files the source a section owes as a factual_source proposition and buys no draft for it, then finishes the page on the next pass at no brief and no rewrite, on $t", async (s) => { db.rows = []; const w = wired(s, "reads"); const owed = await buildNewPageProposal(decided(s), s.t, { complete: w.complete as never, now: NOW, research: research(s, false) }); const row = owed.status === "built" ? owed.proposal : null as never;
    expect([owed.status, row?.researchOnly, row?.obligation?.kind === "evidence" && row.obligation.need.kind, row?.obligation?.kind === "evidence" && row.obligation.need.missingTopic, w.asked.filter((u) => s.heads.some((h) => u.includes(`Write the section headed "${h}"`))).length, nextObligation(row)?.kind], "a winner read whole that carries nothing this page does not already plan buys no section: the heading itself is filed as the proposition to go and source, on the row and through the one ladder every buying loop reads") .toEqual(["built", true, "factual_source", s.heads[0], 0, "evidence"]);
    expect([row.newPageDraft!.pieces.length, (row.newPageDraft!.brief as { proposedTitle: string }).proposedTitle], "and the opening it did write, and the brief it planned from, are kept on that row").toEqual([1, s.title]); const back = wired(s, "reads", true); const done = await buildNewPageProposal(decided(s), s.t, { complete: back.complete as never, now: NOW, research: research(s, true), held: row });
    expect([done.status, back.kinds.filter((k) => k === "new_page_brief").length, back.asked.filter((u) => u.includes(`Answer "${s.label}" outright`)).length, done.status === "built" && (done.proposal.recommendedChange.kind === "new_page" ? done.proposal.recommendedChange.outline : [])], "and the next pass buys neither the brief nor the opening again: it writes the sections that were owed and hands the whole page over").toEqual(["built", 0, 0, [...s.heads]]); });
});
