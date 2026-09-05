/** THE NEW-PAGE PATHWAY, EXERCISED END TO END ON INJECTED EVIDENCE. Live research justified no new page during this campaign, so the whole pathway is proved here on a TYPED verdict and a TYPED writer: a justified opportunity becomes a stored proposal carrying a title, a description, an opening and an outline, its own earlier paragraphs reach the writer of the next one under the class that says a model wrote them, an unwritten section stops the page rather than shipping part of one, the canon passes the finished page, the row reaches Ready and the store keeps it byte-stable on a second unchanged pass. INJECTED, never a live finished new page, and the test titles say so. Two synthetic accounts, neither a real customer and neither on the same subject. */
import { describe, it, expect, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], client: {} as Record<string, unknown> }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "t", domain: "alpha.example", growth_goal: null }), basisTag: () => "basis_test" }));
import { buildNewPageProposal } from "@/domains/decision/new-page";
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
    opening: "A tide pool is safe to walk when the water is going out and the rock is dry, and it turns dangerous the moment the tide turns back.", tail: "whether the rock underfoot stays dry, and a walker who reads the water before stepping out already knows which of the two they are getting that morning.", heads: ["When the rocks turn slick", "What to watch on the way out", "What to do when the tide turns"] },
  { t: "tenant-two", host: "beta.example", key: "bordado-a-mano", label: "puntadas de bordado a mano", own: "/telas", ownTitle: "Telas para bordar", ownSample: "Las telas para bordar se tensan en un bastidor antes de empezar.",
    title: "Puntadas de bordado a mano, y cuando se usa cada una", meta: "Que puntadas de bordado se usan para contornos, cuales para rellenos y como se prepara el hilo antes de enhebrar la aguja.",
    opening: "Una puntada de bordado a mano se elige por lo que tiene que hacer en la tela, y la de tallo sirve para contornos mientras la de nudo marca los puntos.", tail: "cuantas hebras de hilo se separan antes de enhebrar la aguja, y quien lo prepara asi termina la labor sin deshacer ni una vuelta.", heads: ["Puntadas para contornos", "Puntadas para rellenos", "Como preparar el hilo"] },
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

  it.each(SITES)("hands over no part of a page when a planned section will not write, and names what is still owed, on $t", async (s) => {
    db.rows = [];
    const out = await buildNewPageProposal(decided(s), s.t, { complete: seam(s, false).complete as never, now: NOW });
    expect([out.status, out.status === "none" && out.reason.includes(s.heads[2])], "part of a page is not worth handing over, and the reason names the section the next attempt picks up").toEqual(["none", true]);
    expect(db.rows.length, "and nothing was stored").toBe(0);
  });
});
