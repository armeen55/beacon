/** ONE EDITORIAL STANDARD PER KIND OF WORK, CHOSEN BY THE PERSISTED ASSIGNMENT (operator, 2026-09-05). The evaluator's system message ordered EVERY edit to name information the page does not already carry and refused any verbless list of phrases, while a treatment table underneath excused a summary from both: an exception in a lower-priority message does not cancel a rule above it, so live descriptions were refused for "adding nothing beyond paraphrase", which is exactly what a description is for. These pin the replacement as customer behaviour, through the pass, the stored re-read, the serving door and the typed next step, on TWO synthetic accounts in different languages, with the provider injected and never a word of source read. */
import { describe, it, expect, vi } from "vitest";
const fix = vi.hoisted(() => ({ map: new Map<string, unknown>(), rows: [] as unknown[] })), bodies = fix, facts = fix;
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/evidence/pages/fact-checks", async (o) => ({ ...(await o<Record<string, unknown>>()), readFactChecks: async () => facts.rows }));
vi.mock("@/domains/evidence/pages/owned-context", async (o) => ({ ...(await o<Record<string, unknown>>()), loadOwnedPageBodies: async () => bodies.map }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "t", domain: "fixture.example", growth_goal: null }), basisTag: () => "basis_test" }));
import { applyDraftedCopy, reviewFinishedCopy, staleCopyReasons } from "@/domains/decision/drafted-copy";
import { nextObligation } from "@/domains/decision/obligation";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { editorialStandard, REVIEW_CONTRACT, copyKey } from "@/domains/decision/proof";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import type { ChangeProposal } from "@/domains/decision/contracts";

const NOW = new Date("2026-09-05T00:00:00.000Z");
/** TWO SYNTHETIC ACCOUNTS, neither a real customer and neither in the same language: every behaviour below is asserted on BOTH, so a rule that only works for one subject, script or page family fails here. */
const SITES = [
  { t: "tenant-one", url: "https://alpha.example/tide-pools", label: "Tide Pools", q: "tide pool safety", title: "Tide Pools", h1: "Tide Pools",
    heads: ["When to visit", "What lives there"], lines: ["Tide pools open up at low tide and close over again as the water returns.", "Sea stars, anemones and hermit crabs live in the shallow pools along this shore.", "The rocks stay slick for hours after the tide turns, which is when most falls happen."] },
  { t: "tenant-two", url: "https://beta.example/bordado", label: "Bordado", q: "puntadas de bordado", title: "Bordado a mano", h1: "Bordado a mano",
    heads: ["Materiales", "Puntadas"], lines: ["El bordado a mano se trabaja sobre tela tensada en un bastidor.", "La puntada de tallo se usa para contornos y la de nudo frances para los puntos.", "El hilo de algodon se separa en hebras antes de enhebrar la aguja."] },
];
type Site = (typeof SITES)[number]; const bodyOf = (s: Site) => ({ url: s.url, title: s.title, h1: s.h1, metaDescription: "Old line.", vocabulary: "", headings: s.heads, passages: s.lines, completeness: "complete" as const, contentHash: "h", fetchedAt: NOW.toISOString() });
const snapOf = (s: Site) => ({ ownedPages: [{ url: s.url, content: { wordCount: 400, title: s.title, h1: s.h1, outline: s.heads }, search: null }], research: {}, sources: [], scope: { tenantId: s.t, site: new URL(s.url).host } });
const card = (s: Site, over: Partial<ChangeProposal> = {}): ChangeProposal => ({ id: `${s.t}::${new URL(s.url).pathname}::existing_edit::x`, tenantId: s.t, kind: "existing_edit", pagePath: new URL(s.url).pathname, pageUrl: s.url, pageLabel: s.label,
  primaryQuery: s.q, opportunityType: "Capture clicks", changeFamily: "meta", status: "needs_review", researchOnly: false, recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: "Write a description for this page." },
  whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: s.q, hints: [], evidenceRefCount: 1 }, impactScore: 10, upsidePerMonth: null, modeledOn: "the stored results page for this search", publish: "manual", createdAt: NOW.toISOString(), ...over });
const PASS = { pageFit: true, resolvesDiagnosis: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "It says what this page answers.", resolution: "none" };
const rule = (cs: readonly { supportedBy: readonly string[] }[]) => cs.map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })), TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" }, rationale: "r", uncertaintyOrOmitted: [], implementationMinutes: 1 };
/** ONE PASS, WITH THE WRITER AND THE READER OF MEANING BOTH INJECTED. `owed` and `settled` are what the runtime would go and BUY off the back of this pass, so a test can ask what a refusal actually cost. */
const run = async (s: Site, c: ChangeProposal, draft: Record<string, unknown>, verdict: Record<string, unknown> | null | "throw" = PASS) => {
  bodies.map = new Map([[canonicalUrlKey(s.url), bodyOf(s)]]); facts.rows = [];
  const owed: unknown[] = [], settled = new Map<string, unknown>(), notes: string[] = [], why = new Map<string, string>(), unsettled = new Set<string>(), seen: { kind: string; text: string }[] = [];
  const out = await applyDraftedCopy([c], { tenantId: s.t, snapshot: snapOf(s) as never, now: NOW, refusals: why, unsettled, owe: (_k: string, n: unknown) => owed.push(n), resolved: settled as never,
    note: (_k: string, o: string, w?: string) => notes.push(`${o}:${w ?? ""}`), budget: DRAFT_BUDGET.plan({ jobs: [{ key: c.pagePath!, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
    complete: async ({ kind, system, user }: { kind: string; system: string; user: string }) => { seen.push({ kind, text: kind === "editor_judgement" ? system : `${system}\n${user}` });
      if (kind !== "editor_judgement") return { value: draft };
      if (verdict === "throw") throw new Error("the reader of meaning never answered");
      return verdict ? { value: { ...verdict, claims: rule((draft.claims ?? []) as never) } } : { error: "no answer", retryable: true }; } } as never);
  return { row: out[0]!, owed, settled: [...settled.values()], notes, why: [...why.values()], unsettled: [...unsettled], judged: seen.filter((x) => x.kind === "editor_judgement").map((x) => x.text), wrote: seen.filter((x) => x.kind !== "editor_judgement").map((x) => x.text) };
};

describe("the editorial standard one edit is judged by", () => {
  for (const s of SITES) {
    /** A DESCRIPTION THAT SAYS WHAT THE PAGE ANSWERS IS THE JOB, NOT A SHORTFALL. Live refusals read "the copy adds nothing beyond paraphrase" on exactly this shape. */
    it(`${s.t}: a summary that adds no new fact is finished work, and the standard it was judged by is stored on the row`, async () => {
      const r = await run(s, card(s), { field: "meta", before: "Old line.", after: `${s.lines[0]} ${s.lines[1]}`.slice(0, 150), ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: s.lines[0]!, supportedBy: ["page-copy-1"] }] });
      expect([r.row.status, r.why, r.row.assignment?.standard, r.owed.length], "a faithful summary lands, nothing refuses it, the row records the standard it answered to, and no research was bought").toEqual(["ready", [], "summary", 0]);
      expect(r.judged[0]?.includes("SUMMARY LINE") && !r.judged[0]?.includes("DIAGNOSED MISSING ANSWER"), "the reader of meaning is given the summary standard and is never handed the missing-answer rule as well").toBe(true); });

    /** A NOUN PHRASE HAS NO VERB AND A USEFUL TITLE MAY BE A QUESTION. Both were refused by rules that no longer exist: one in the writer's own clause, one in the evaluator's. */
    it(`${s.t}: a verbless noun-phrase title and a question title both pass every door`, async () => {
      const t = (after: string) => run(s, card(s, { changeFamily: "title", recommendedChange: { kind: "existing_edit", field: "title", before: s.title, after: "Write a title." } }),
        { field: "title", before: s.title, after, ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: after, supportedBy: ["page-title"] }] });
      const noun = await t(`${s.title}: ${s.heads[0]} and ${s.heads[1]}`), ask = await t(`${s.title}: ${s.heads[1]}?`);
      expect([noun.row.status, noun.why, ask.row.status, ask.why], "neither the missing verb nor the question mark is a defect at any door Beacon owns").toEqual(["ready", [], "ready", []]); });

    /** A RESTRUCTURING OWES NO OUTSIDE FACT AND NO NUMBER OF LINES. A three-line floor refused a two-sentence direct answer whose own assignment capped it at two. */
    it(`${s.t}: a restructuring built entirely from the page's own words lands, at any length`, async () => {
      const c = card(s, { changeFamily: "section", primaryQuery: s.q, treatment: "rewrite_existing_section", causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "The answer is spread across three passages.", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.lines[2]!, aeoKind: "scattered_answer" } } as never, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Reorganise what this page already says." },
        assignment: { page: s.url, standard: "restructuring", treatment: "restructure", gapKind: "scattered_answer", propositions: [s.lines[2]!], diagnosedGap: s.lines[2]!, mustLeadWith: s.lines[2]!, opening: "open with the whole answer", format: "one to three sentences", intent: [s.q], supportingFacts: [], pageContext: ["page-copy-1"], forbidden: [], rivals: [], briefing: [], mayReuse: "the page's own words", mustPreserve: "every heading", mustNotRepeat: "the page's own entries", placement: "additive", completionTest: "a reader can lift it whole" } });
      const lifted = s.t === "tenant-one" ? "Low tide is the safe window: the pools open, and the rocks are at their least slick before the water turns." : "El mejor momento es con la tela ya tensada: el hilo se separa en hebras y la aguja entra limpia.";
      const one = await run(s, c, { field: "answer_block", before: null, after: lifted, ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: lifted, supportedBy: ["page-copy-3"] }] });
      expect([one.row.status, one.why, one.owed.length, one.row.assignment?.standard], "one sentence assembled out of the page's own material, cited to the page's own id, is a finished restructuring at any length and buys no research").toEqual(["ready", [], 0, "restructuring"]);
      expect(one.judged[0]?.includes("MATERIALLY EASIER TO FIND") && one.wrote.join(" ").includes("MATERIALLY EASIER TO FIND"), "the writer and the reader of meaning are briefed with the SAME standard, so nobody is marked against a rule they were never given").toBe(true); });
  }

  const S = SITES[0]!;
  const meta = (after: string) => ({ field: "meta", before: "Old line.", after, ...TAIL, placementAnchor: S.h1, naturalHeading: null, measurementTarget: S.q, claims: [{ text: after, supportedBy: ["page-copy-1"] }] });
  /** EDITORIAL WEAKNESS AND A MISSING ANSWER ARE DIFFERENT DEBTS. One is a revision; the other is a reading somebody has to go and buy. They were one boolean, so a description went shopping for facts. */
  it("an editorial weakness buys a revision and never research, while a missing answer really does send the runtime to buy one", async () => {
    const weak = await run(S, card(S), meta(`${S.lines[0]}`), { ...PASS, usefulAndNatural: false, notes: "it reads like a caption, not a description", resolution: "acquire_factual_source" });
    expect([weak.row.status, weak.owed.length, weak.settled.length, weak.why[0]?.includes("it reads like a caption")], "the weakness comes back as the exact objection the next draft writes against, and not one cent of research is minted off a matter of taste").toEqual(["needs_review", 0, 0, true]);
    const gap = card(S, { changeFamily: "section", treatment: "add_answer_section", causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "The page never says how cold the water runs.", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: S.q, missing: "how cold the water runs in winter", aeoKind: "missing_information" } } as never, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
      assignment: { page: S.url, standard: "missing_answer", treatment: "section", gapKind: "missing_answer", propositions: ["how cold the water runs in winter"], diagnosedGap: "how cold the water runs in winter", mustLeadWith: "the water temperature", opening: "open with the answer", format: "a heading, then sentences", intent: [S.q], supportingFacts: [], pageContext: [], forbidden: [], rivals: [], briefing: [], mayReuse: "nothing", mustPreserve: "every heading", mustNotRepeat: "the page's own entries", placement: "additive", completionTest: "a reader knows the temperature" } });
    const owedOne = await run(S, gap, { field: "answer_block", before: null, after: S.lines[1]!, ...TAIL, placementAnchor: S.h1, naturalHeading: "What lives in the pools", measurementTarget: S.q, claims: [{ text: S.lines[1]!, supportedBy: ["page-copy-2"] }] },
      { ...PASS, improvesPage: false, notes: "it names nothing the page does not already say", resolution: "acquire_factual_source" });
    expect([owedOne.row.status, owedOne.owed.length > 0, owedOne.settled.length > 0], "the same failed box on the standard that genuinely owes information does send the runtime to get it").toEqual(["needs_review", true, true]); });

  /** A PROVIDER THAT NEVER ANSWERED HAS SAID NOTHING ABOUT THE WORDS. It used to be written down as a defect and could mint an acquisition. */
  it("a transport failure is not a verdict: no fault, no research, and the page comes back retryable", async () => {
    for (const v of [null, "throw"] as const) { const r = await run(S, card(S), meta(S.lines[0]!), v);
      expect([r.row.faults ?? [], r.owed.length, r.settled.length, r.unsettled.length > 0, r.notes.some((n) => n.startsWith("retryable_blocked"))], "nothing about the copy is banked, nothing is bought, and the card is filed as work nobody settled rather than work Beacon refused").toEqual([[], 0, 0, true, true]); } });

  /** ONE ASSIGNMENT, FIVE DOORS. The writer, the reader of meaning, the stored row, the paid re-read and the serving door each used to work out for themselves what kind of edit this was. */
  it("the standard the writer was briefed with is the one the row stores, the re-read takes and the serving door asks", async () => {
    const r = await run(S, card(S), meta(`${S.lines[0]} ${S.lines[1]}`.slice(0, 150)));
    const stored = r.row; expect(stored.assignment?.standard, "the pass stores it").toBe("summary");
    expect(editorialStandard({ field: "meta", assignment: stored.assignment, changeFamily: stored.changeFamily }), "the typed selector every door calls answers the same thing").toBe("summary");
    bodies.map = new Map([[canonicalUrlKey(S.url), bodyOf(S)]]);
    const seen: string[] = []; const re = await reviewFinishedCopy(stored, { tenantId: S.t, now: NOW, complete: (async ({ system }: { system: string }) => (seen.push(system), { value: { ...PASS, claims: (stored.claims ?? []).map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })) } })) as never });
    expect([seen[0]?.includes("SUMMARY LINE"), re.row?.semanticReview?.version], "the paid re-read is given the same standard, and banks its reading under the contract already on file").toEqual([true, REVIEW_CONTRACT]);
    expect(staleCopyReasons(stored, new Map([[canonicalUrlKey(S.url), bodyOf(S) as never]]), [], { title: S.title, h1: S.h1, metaDescription: "Old line.", outline: S.heads }), "and the serving door, reading the same standard, keeps the words").toEqual([]); });

  /** THE CONTRACT CHANGED FOR THREE STANDARDS, SO IT INVALIDATES WORK ON THREE STANDARDS. Nothing else moves, and no banked reading is re-bought. */
  it("retires only the objections the live doors can no longer write, and leaves every other stored row exactly as it was", () => {
    const RETIRED = "it repeats the search instead of improving the page", REAL = "it lands in the wrong place";
    const stored = (over: Partial<ChangeProposal>) => card(S, { status: "needs_review", recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: "A finished description of this page." }, ...over });
    expect(nextObligation(stored({ faults: [RETIRED] })), "a summary is judged on the line it replaces and can never be handed that sentence again, so it owes no paid rewrite for it").toBeNull();
    expect(nextObligation(stored({ faults: [RETIRED, REAL] }))?.kind, "a real fault standing beside it is untouched").toBe("redraft");
    expect(nextObligation(stored({ faults: [REAL] }))?.kind, "and a row that never carried the retired sentence is not touched at all").toBe("redraft");
    const answer = stored({ changeFamily: "section", faults: [RETIRED], recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A finished section.", where: 'A new section headed "H"' } });
    expect(nextObligation(answer), "and the standard that really does owe information keeps the objection and the redraft").toEqual({ kind: "redraft", attempt: 1, instruction: RETIRED });
    const reviewed = stored({ changeFamily: "factual_correction", claims: [{ text: "c", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "f" }] });
    expect(nextObligation({ ...reviewed, semanticReview: { of: copyKey(reviewed), version: REVIEW_CONTRACT, claims: [{ i: 0, by: ["fact-1"], entailed: true }] } }), "and a reading banked under the contract on file is not re-bought: the editorial rules moved, the evidence contract did not").toBeNull(); });
});
