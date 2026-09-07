import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Existing editorial contracts also exercise the reversible prior bar; #129 enables the new gate below.
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_BEACON_AEO_PACKET", "0"));
afterEach(() => vi.unstubAllEnvs());
const fix = vi.hoisted(() => ({ map: new Map<string, unknown>(), rows: [] as unknown[] })), bodies = fix, facts = fix;
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/evidence/pages/fact-checks", async (o) => ({ ...(await o<Record<string, unknown>>()), readFactChecks: async () => facts.rows }));
vi.mock("@/domains/evidence/pages/owned-context", async (o) => ({ ...(await o<Record<string, unknown>>()), loadOwnedPageBodies: async () => bodies.map }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "t", domain: "fixture.example", growth_goal: null }), basisTag: () => "basis_test" }));
import { applyDraftedCopy, draftFieldForPage, reviewFinishedCopy, staleCopyReasons } from "@/domains/decision/drafted-copy";
import { nextObligation } from "@/domains/decision/obligation"; import { openHold, preferFinished } from "@/domains/decision/completeness";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { editorialStandard, evidenceShortfall, REVIEW_CONTRACT, copyKey } from "@/domains/decision/proof";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { deserializeChangeProposal, serializeChangeProposal, type ChangeProposal } from "@/domains/decision/contracts";

const NOW = new Date("2026-09-05T00:00:00.000Z");
const SITES = [
  { t: "tenant-one", url: "https://alpha.example/tide-pools", label: "Tide Pools", q: "tide pool safety", title: "Tide Pools", h1: "Tide Pools",
    ask: "how cold is the water in tide pools", answer: "The water in a tide pool holds close to the ocean temperature until the sun warms the shallowest of them.",
    figured: "The water in a tide pool holds close to the ocean temperature until the sun warms the shallowest of them, and one shore survey counted 3157 pools along it.",
    narrow: "depth of pools", narrowAnswer: "Most pools along this shore sit under a foot of water at low tide.", word: "Anemone", wrong: "a plant that grows in gardens.", right: "a stinging animal fixed to the rock.",
    heads: ["When to visit", "What lives there", "Tide pool safety"], lines: ["Tide pools open up at low tide and close over again as the water returns.", "Sea stars, anemones and hermit crabs live in the shallow pools along this shore.", "The rocks stay slick for hours after the tide turns, which is when most falls happen."],
    unheld: "Seal pupping closures", section: "Tide pool safety", boast: "This shore has the best tide pools on the coast, and the rock shelves stay slick for hours after the tide turns, which is when nearly every fall happens and when a visitor should take the most care." },
  { t: "tenant-two", url: "https://beta.example/bordado", label: "Bordado", q: "puntadas de bordado", title: "Bordado a mano", h1: "Bordado a mano",
    ask: "cuanto hilo lleva un bastidor de bordado", answer: "Un bastidor mediano lleva alrededor de tres metros de hilo por cada motivo bordado.",
    figured: "Un bastidor mediano lleva alrededor de tres metros de hilo por cada motivo bordado, y un censo del taller conto 3157 madejas en un ano.",
    narrow: "grosor del hilo", narrowAnswer: "El hilo de algodon se separa en seis hebras de grosor parejo.", word: "Bastidor", wrong: "una tela suelta que se borda.", right: "un aro que tensa la tela.",
    heads: ["Materiales", "Puntadas", "Puntadas de bordado"], lines: ["El bordado a mano se trabaja sobre tela tensada en un bastidor.", "La puntada de tallo se usa para contornos y la de nudo frances para los puntos.", "El hilo de algodon se separa en hebras antes de enhebrar la aguja."],
    unheld: "Tension con contrapesos", section: "Puntadas de bordado", boast: "El taller vende la caja que su fabricante llama the best embroidery starter kit, con hilo de algodon, agujas de tres grosores y tela cortada a medida para el primer bastidor." },
];
type Site = (typeof SITES)[number]; const bodyOf = (s: Site) => ({ url: s.url, title: s.title, h1: s.h1, metaDescription: "Old line.", vocabulary: "", headings: s.heads, passages: s.lines, completeness: "complete" as const, contentHash: "h", fetchedAt: NOW.toISOString() });
const snapOf = (s: Site) => ({ ownedPages: [{ url: s.url, content: { wordCount: 400, title: s.title, h1: s.h1, outline: s.heads }, search: null }], research: {}, sources: [], scope: { tenantId: s.t, site: new URL(s.url).host } });
const card = (s: Site, over: Partial<ChangeProposal> = {}): ChangeProposal => ({ id: `${s.t}::${new URL(s.url).pathname}::existing_edit::x`, tenantId: s.t, kind: "existing_edit", pagePath: new URL(s.url).pathname, pageUrl: s.url, pageLabel: s.label,
  primaryQuery: s.q, opportunityType: "Capture clicks", changeFamily: "meta", status: "needs_review", researchOnly: false, recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: "Write a description for this page." },
  whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: s.q, hints: [], evidenceRefCount: 1 }, impactScore: 10, upsidePerMonth: null, modeledOn: "the stored results page for this search", publish: "manual", createdAt: NOW.toISOString(), ...over });
const PASS = { aeoPacket: { leadAnswer: true, groupedH2s: true, defendedClaims: true, entityBlock: true, boundedScope: true, h1QueryAlignment: true }, pageFit: true, resolvesDiagnosis: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "It says what this page answers.", resolution: "none" };
const rule = (cs: readonly { supportedBy: readonly string[] }[]) => cs.map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })), TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" }, rationale: "r", uncertaintyOrOmitted: [], implementationMinutes: 1 };
const run = async (s: Site, c: ChangeProposal, draft: Record<string, unknown>, verdict: Record<string, unknown> | null | "throw" = PASS, rows: unknown[] = [], body: Record<string, unknown> = bodyOf(s), snap: Record<string, unknown> = snapOf(s)) => {
  bodies.map = new Map([[canonicalUrlKey(s.url), body]]); facts.rows = rows; const owed: unknown[] = [], settled = new Map<string, unknown>(), notes: string[] = [], why = new Map<string, string>(), unsettled = new Set<string>(), seen: { kind: string; text: string }[] = [];
  const out = await applyDraftedCopy([c], { tenantId: s.t, snapshot: snap as never, now: NOW, refusals: why, unsettled, owe: (_k: string, n: unknown) => owed.push(n), resolved: settled as never,
    note: (_k: string, o: string, w?: string) => notes.push(`${o}:${w ?? ""}`), budget: DRAFT_BUDGET.plan({ jobs: [{ key: c.pagePath!, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
    complete: async ({ kind, system, user }: { kind: string; system: string; user: string }) => { seen.push({ kind, text: kind === "editor_judgement" ? system : `${system}\n${user}` });
      if (kind !== "editor_judgement") return { value: draft };
      if (verdict === "throw") throw new Error("the reader of meaning never answered");
      return verdict ? { value: { ...verdict, claims: rule((draft.claims ?? []) as never) } } : { error: "no answer", retryable: true }; } } as never);
  return { row: out[0]!, owed, settled: [...settled.values()], notes, why: [...why.values()], unsettled: [...unsettled], judged: seen.filter((x) => x.kind === "editor_judgement").map((x) => x.text), wrote: seen.filter((x) => x.kind !== "editor_judgement").map((x) => x.text) };
};

describe("the editorial standard one edit is judged by", () => {
  for (const s of SITES) {
    it(`${s.t}: a summary that adds no new fact is finished work, and the standard it was judged by is stored on the row`, async () => {
      const r = await run(s, card(s), { field: "meta", before: "Old line.", after: `${s.lines[0]} ${s.lines[1]}`.slice(0, 150), ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: s.lines[0]!, supportedBy: ["page-copy-1"] }] });
      expect([r.row.status, r.why, r.row.assignment?.standard, r.owed.length], "a faithful summary lands, nothing refuses it, the row records the standard it answered to, and no research was bought").toEqual(["ready", [], "summary", 0]);
      expect(r.judged[0]?.includes("SUMMARY LINE") && !r.judged[0]?.includes("DIAGNOSED MISSING ANSWER"), "the reader of meaning is given the summary standard and is never handed the missing-answer rule as well").toBe(true); });

    it(`${s.t}: a verbless noun-phrase title and a question title both pass every door`, async () => {
      const t = (after: string) => run(s, card(s, { changeFamily: "title", recommendedChange: { kind: "existing_edit", field: "title", before: s.title, after: "Write a title." } }),
        { field: "title", before: s.title, after, ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: after, supportedBy: ["page-title"] }] });
      const noun = await t(`${s.title}: ${s.heads[0]} and ${s.heads[1]}`), ask = await t(`${s.title}: ${s.heads[1]}?`);
      expect([noun.row.status, noun.why, ask.row.status, ask.why], "neither the missing verb nor the question mark is a defect at any door Beacon owns").toEqual(["ready", [], "ready", []]); });

    const c = card(s, { changeFamily: "section", primaryQuery: s.q, treatment: "rewrite_existing_section", causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "The answer is spread across three passages.", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.lines[2]!, aeoKind: "scattered_answer" } } as never, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Reorganise what this page already says." },
      assignment: { page: s.url, standard: "restructuring", treatment: "restructure", gapKind: "scattered_answer", propositions: [s.lines[2]!], diagnosedGap: s.lines[2]!, mustLeadWith: s.lines[2]!, opening: "open with the whole answer", format: "one to three sentences", intent: [s.q], supportingFacts: [], pageContext: ["page-copy-1"], forbidden: [], rivals: [], briefing: [], mayReuse: "the page's own words", mustPreserve: "every heading", mustNotRepeat: "the page's own entries", placement: "additive", completionTest: "a reader can lift it whole" } });
    it(`${s.t}: a section on a subject this page carries nothing of owes that source and hires no writer`, async () => {
      const at = `https://rival-${s.t}.example/page`, held = s.lines.join(" ");
      const seen = { url: at, domain: `rival-${s.t}.example`, engines: [], examplePrompts: [], appearances: [{ query: s.q }], extract: { title: "Winner", h1: null, wordCount: 900, headings: [s.unheld], faqCount: 0, entityNames: [], mainText: held, truncated: false, heldChars: held.length, totalChars: held.length } };
      const snap = { ...snapOf(s), ownedPages: [{ ...snapOf(s).ownedPages[0], search: { clicks90d: 1, impressions90d: 900, ctr90d: 0.01, position90d: 8, topQueries: [{ query: s.q, impressions: 900, clicks: 0, position: 8 }] } }], research: { winningPages: [seen], serpEvidence: [{ query: s.q, observedAt: null, organic: [{ rank: 1, url: at, domain: seen.domain, title: null }], aiOverview: [], aiMode: [], paa: [], related: [] }] } };
      const r = await run(s, card(s, { changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." } }), {}, PASS, [], bodyOf(s), snap);
      expect([r.wrote.length > 0, r.wrote.filter((t) => !t.includes("READING two or more web pages side by side")).length, r.owed, r.row.researchOnly, (r.row.obligation as { need?: unknown } | undefined)?.need, r.row.status], "the pass reads the winners once and hires no writer at all for a subject nothing on this page carries and nothing checked answers: the row files that one source as the step it owes, the same object reaches the list the runtime buys from, and it stays research until the reading lands") .toEqual([true, 0, [{ kind: "factual_source", query: `${s.unheld} ${s.q}`.slice(0, 120), url: s.url, missingTopic: s.unheld, rivalUrl: at, reasonCode: "missing_information", reason: expect.stringContaining(s.unheld) }], true, { kind: "factual_source", query: `${s.unheld} ${s.q}`.slice(0, 120), url: s.url, missingTopic: s.unheld, rivalUrl: at, reasonCode: "missing_information" }, "needs_review"]); });
  }

  const S = SITES[0]!;
  const meta = (after: string) => ({ field: "meta", before: "Old line.", after, ...TAIL, placementAnchor: S.h1, naturalHeading: null, measurementTarget: S.q, claims: [{ text: after, supportedBy: ["page-copy-1"] }] });
  it("an editorial weakness buys a revision and never research, while a missing answer really does send the runtime to buy one", async () => {
    const weak = await run(S, card(S), meta(`${S.lines[0]}`), { ...PASS, usefulAndNatural: false, notes: "it reads like a caption, not a description", resolution: "acquire_factual_source" });
    expect([weak.row.status, weak.owed.length, weak.settled.length, weak.why[0]?.includes("it reads like a caption")], "the weakness comes back as the exact objection the next draft writes against, and not one cent of research is minted off a matter of taste").toEqual(["needs_review", 0, 0, true]);
    const gap = card(S, { changeFamily: "section", treatment: "add_answer_section", causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "The page never says how cold the water runs.", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: S.q, missing: "how cold the water runs in winter", aeoKind: "missing_information" } } as never, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
      assignment: { page: S.url, standard: "missing_answer", treatment: "section", gapKind: "missing_answer", propositions: ["how cold the water runs in winter"], diagnosedGap: "how cold the water runs in winter", mustLeadWith: "the water temperature", opening: "open with the answer", format: "a heading, then sentences", intent: [S.q], supportingFacts: [], pageContext: [], forbidden: [], rivals: [], briefing: [], mayReuse: "nothing", mustPreserve: "every heading", mustNotRepeat: "the page's own entries", placement: "additive", completionTest: "a reader knows the temperature" } });
    const owedOne = await run(S, gap, { field: "answer_block", before: null, after: S.lines[1]!, ...TAIL, placementAnchor: S.h1, naturalHeading: "What lives in the pools", measurementTarget: S.q, claims: [{ text: S.lines[1]!, supportedBy: ["page-copy-2"] }] },
      { ...PASS, improvesPage: false, notes: "it names nothing the page does not already say", resolution: "acquire_factual_source" });
    expect([owedOne.row.status, owedOne.owed.length > 0, owedOne.settled.length > 0], "the same failed box on the standard that genuinely owes information does send the runtime to get it").toEqual(["needs_review", true, true]); });

  it("a transport failure is not a verdict: no fault, no research, and the page comes back retryable", async () => {
    for (const v of [null, "throw"] as const) { const r = await run(S, card(S), meta(S.lines[0]!), v);
      expect([r.row.faults ?? [], r.owed.length, r.settled.length, r.unsettled.length > 0, r.notes.some((n) => n.startsWith("retryable_blocked"))], "nothing about the copy is banked, nothing is bought, and the card is filed as work nobody settled rather than work Beacon refused").toEqual([[], 0, 0, true, true]); } });

  it("the standard the writer was briefed with is the one the row stores, the re-read takes and the serving door asks", async () => {
    const r = await run(S, card(S), meta(`${S.lines[0]} ${S.lines[1]}`.slice(0, 150)));
    const stored = r.row; expect(stored.assignment?.standard, "the pass stores it").toBe("summary");
    expect(editorialStandard({ field: "meta", assignment: stored.assignment, changeFamily: stored.changeFamily }), "the typed selector every door calls answers the same thing").toBe("summary");
    bodies.map = new Map([[canonicalUrlKey(S.url), bodyOf(S)]]);
    const seen: string[] = []; const re = await reviewFinishedCopy(stored, { tenantId: S.t, now: NOW, complete: (async ({ system }: { system: string }) => (seen.push(system), { value: { ...PASS, claims: (stored.claims ?? []).map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })) } })) as never });
    expect([seen[0]?.includes("SUMMARY LINE"), re.row?.semanticReview?.version], "the paid re-read is given the same standard, and banks its reading under the contract already on file").toEqual([true, REVIEW_CONTRACT]);
    expect(staleCopyReasons(stored, new Map([[canonicalUrlKey(S.url), bodyOf(S) as never]]), [], { title: S.title, h1: S.h1, metaDescription: "Old line.", outline: S.heads }), "and the serving door, reading the same standard, keeps the words").toEqual([]); });

  it("retires the objection the owner judges for themselves whatever standard wrote it, and leaves every other stored row exactly as it was", () => {
    const RETIRED = "it repeats the search instead of improving the page", REAL = "it lands in the wrong place";
    const stored = (over: Partial<ChangeProposal>) => card(S, { status: "needs_review", recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: "A finished description of this page." }, ...over });
    expect(nextObligation(stored({ faults: [RETIRED] })), "a summary is judged on the line it replaces and can never be handed that sentence again, so it owes no paid rewrite for it").toBeNull();
    expect(nextObligation(stored({ faults: [RETIRED, REAL] }))?.kind, "a real fault standing beside it is untouched").toBe("redraft");
    expect(nextObligation(stored({ faults: [REAL] }))?.kind, "and a row that never carried the retired sentence is not touched at all").toBe("redraft");
    for (const over of [{}, { changeFamily: "section", recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "A finished section.", where: 'A new section headed "H"' } }] as Partial<ChangeProposal>[]) expect([nextObligation(stored({ ...over, faults: [RETIRED] })), openHold(stored({ ...over, faults: [RETIRED] })).advisories.map((a) => a.kind).filter((x) => x === "matches_search")], "REPLACES the standard-by-standard retirement (owner's editorial policy, 2026-09-06): a line that matches the search it answers is advisory at most on every standard there is, so no field, family or persisted assignment can hand it back as a paid rewrite, and the caveat says it instead").toEqual([null, ["matches_search"]]);
    const reviewed = stored({ changeFamily: "factual_correction", claims: [{ text: "c", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "f" }] });
    expect(nextObligation({ ...reviewed, semanticReview: { of: copyKey(reviewed), version: REVIEW_CONTRACT, claims: [{ i: 0, by: ["fact-1"], entailed: true }] } }), "and a reading banked under the contract on file is not re-bought: the editorial rules moved, the evidence contract did not").toBeNull(); });

  it.each(SITES)("retires the promise objection where the row's own record of the page carries the word, keeps it where the page never says it, and asks nothing of a row that holds no record at all, on $t", (s) => {
    const promise = (w: string) => `it calls the subject "${w}", a word this page's own copy never carries, so the line promises a searcher warmth, fame or growth nothing on file backs`;
    const carried = s.heads[0]!.split(" ")[0]!, never = "zzqx", stamp = `${s.title}|${s.h1}|${s.heads[0]}|${s.heads.join(">")}`;
    const held = (over: Partial<ChangeProposal>) => card(s, { status: "needs_review", recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: "A finished description of this page." }, ...over });
    expect(nextObligation(held({ copyStamp: stamp, faults: [promise(carried)] })), "the page's own last-read words carry the word, so the objection is history and no corrective draft is owed for it").toBeNull();
    expect(nextObligation(held({ copyStamp: stamp, faults: [promise(never)] })), "a word the page really never says keeps its objection and its redraft").toEqual({ kind: "redraft", attempt: 1, instruction: promise(never) });
    expect(nextObligation(held({ faults: [promise(carried)] })), "and a row holding no record of the page retires nothing, because a door that has read nothing cannot say what the page never says").toEqual({ kind: "redraft", attempt: 1, instruction: promise(carried) });
    expect(nextObligation(held({ copyStamp: stamp, faults: [promise(carried), "it lands in the wrong place"] }))?.kind, "a real fault standing beside it is untouched").toBe("redraft");
    expect(nextObligation(held({ recommendedChange: { kind: "existing_edit", field: "meta", before: `Old line about ${carried}.`, after: "A finished description." }, faults: [promise(carried)] })), "and the line this change replaces is part of the record too").toBeNull();
    expect(nextObligation(held({ supportFacts: [{ id: "page-copy-1", fact: s.lines[0]! }], faults: [promise(s.lines[0]!.split(" ")[1]!)] })), "as are the passages the row banked as the page's own").toBeNull(); });

  it.each(SITES)("lets a reorganization of the page's own material answer for the passage it replaces, and holds every other replacement to every unit, on $t", (s) => {
    const before = `${s.lines[0]} ${s.lines[1]}`, after = `${s.heads[1]}. ${s.lines[2]}`;
    const reorganized = card(s, { changeFamily: "section", status: "needs_review",
      recommendedChange: { kind: "existing_edit", field: "section", before, after, where: `Replaces the existing passage under "${s.heads[0]}"` },
      claims: [{ text: `The page groups this under ${s.heads[1]}.`, supportedBy: ["page-copy-1", "page-copy-2"] }],
      supportFacts: [{ id: "page-copy-1", fact: s.lines[0]! }, { id: "page-copy-2", fact: s.lines[1]! }],
      informationGain: { adds: "puts the page's own material in one place a reader can scan", by: ["page-copy-1", "page-copy-2"], pageWhole: true } });
    const read = (p: ChangeProposal): ChangeProposal => ({ ...p, semanticReview: { aeoPacket: PASS.aeoPacket, of: copyKey(p), version: REVIEW_CONTRACT, materialChange: true, claims: (p.claims ?? []).map((x, i) => ({ i, by: [...x.supportedBy], entailed: true })) } });
    expect(evidenceShortfall(read(reorganized)), "a gain made only of this page's own units, read against the whole page, answers for the passage it reorganizes").toBeNull();
    const outside = { ...reorganized, claims: [{ text: `The page groups this under ${s.heads[1]}.`, supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: `an encyclopedia says ${s.heads[1]}` }],
      informationGain: { adds: "adds a checked fact the page never carried", by: ["fact-1"], pageWhole: true } } as ChangeProposal;
    expect(evidenceShortfall(read(outside)), "a replacement carrying anything from outside the page still accounts for every unit it drops").toContain("neither says it nor accounts for it");
    expect(evidenceShortfall(read({ ...reorganized, informationGain: { ...reorganized.informationGain!, pageWhole: false } })), "a gain judged against part of the page is refused before the exemption is even asked").toContain("only part of this page");
    const linked = read({ ...reorganized, recommendedChange: { ...reorganized.recommendedChange, linkTo: s.url } as ChangeProposal["recommendedChange"], informationGain: { ...reorganized.informationGain!, pageWhole: false } });
    expect(evidenceShortfall(linked), "and link work skips the gain checks entirely, so the exemption asks the whole-page question itself rather than trusting a door that never ran").toContain("neither says it nor accounts for it");
    expect(evidenceShortfall(read({ ...reorganized, claims: [{ text: "c", supportedBy: ["rival-1"] }], supportFacts: [{ id: "rival-1", fact: "a competing page covers it" }], informationGain: { ...reorganized.informationGain!, by: ["rival-1"] } })), "briefing is not the page's own material and never reaches the exemption").toContain("competes with this one");
    const correction = card(s, { changeFamily: "factual_correction", status: "needs_review", recommendedChange: { kind: "existing_edit", field: "section", before: `${s.word}: ${s.wrong} ${s.heads[2]} today.`, after: `${s.word}: ${s.right}` },
      preservation: [{ text: `${s.word}: ${s.wrong}`, disposition: "corrected", by: ["fact-1"], why: "the source of record says so" }], claims: [{ text: "c", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: `an encyclopedia says ${s.right}` }] });
    expect(evidenceShortfall(read(correction)), "and a correction owes no gain receipt at all, so it never reaches the exemption and still answers for what it drops around the mistake").toContain("neither says it nor accounts for it"); });
});

describe("the standard says what the work is, and the id says where the words came from", () => {
  const ASSIGN = (over: Record<string, unknown>): ChangeProposal["assignment"] => ({ page: "p", treatment: "section", gapKind: "missing_answer", propositions: ["p"], diagnosedGap: "p", mustLeadWith: "p", opening: "o", format: "f", intent: [], supportingFacts: [], pageContext: [], forbidden: [], rivals: [], briefing: [], mayReuse: "n", mustPreserve: "n", mustNotRepeat: "n", placement: "additive", completionTest: "t", ...over } as ChangeProposal["assignment"]);
  const POINTS = "it points at the page instead of answering";
  it.each(SITES)("lets a page whose title promises what it never delivers say what it does today, and refuses the same sentence from every other kind of body work, on $t", (s) => {
    const body = (standard: string): ChangeProposal => card(s, { changeFamily: "section", claims: [{ text: "c", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: s.lines[0]! }],
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: `This guide covers ${s.heads[1]!.toLowerCase()} and nothing else, so a reader looking for anything wider is in the wrong place.`, where: 'A new section headed "H"' }, assignment: ASSIGN({ standard, gapKind: standard === "repositioning" ? "false_page_promise" : "missing_answer" }) });
    const reasons = (standard: string): string[] => staleCopyReasons(body(standard), new Map([[canonicalUrlKey(s.url), bodyOf(s)]]) as never, [], { title: s.title, h1: s.h1, outline: s.heads } as never, false, []);
    expect([reasons("repositioning").includes(POINTS), reasons("missing_answer").includes(POINTS), reasons("restructuring").includes(POINTS)],
      "the honest treatment of a false promise IS a sentence about what this page delivers, so the container rule is not asked of it, and it is asked of every other body standard exactly as before").toEqual([false, true, true]); });
  it.each(SITES)("refuses copy that presents the page instead of answering, at the writer's door and on the banked row, and takes the same words as a sentence that states the answer, on $t", async (s) => {
    const parts = `${s.heads[0]!.toLowerCase()}, ${s.heads[1]!.toLowerCase()} and ${s.heads[2]!.toLowerCase()}`;
    const narrated = `${s.label} is presented here as a grouped list of ${parts}, with one short entry for each of them.`, answered = `${s.label} includes ${parts}, with one short entry for each of them.`;
    const gap = card(s, { changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
      causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.lines[2]!, aeoKind: "missing_information" } } as never });
    const wrote = async (after: string): Promise<string[]> => (await run(s, gap, { field: "answer_block", before: null, after, ...TAIL, placementAnchor: s.h1, naturalHeading: s.heads[0]!, measurementTarget: s.q, claims: [{ text: after, supportedBy: ["page-copy-3"] }] })).why;
    const stored = (after: string): string[] => staleCopyReasons(card(s, { changeFamily: "section", claims: [{ text: "c", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: s.lines[0]! }],
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after, where: 'A new section headed "H"' }, assignment: ASSIGN({ standard: "missing_answer" }) }), new Map([[canonicalUrlKey(s.url), bodyOf(s)]]) as never, [], { title: s.title, h1: s.h1, outline: s.heads } as never, false, []);
    expect([(await wrote(narrated)).some((r) => r.includes(POINTS)), (await wrote(answered)).some((r) => r.includes(POINTS)), stored(narrated).includes(POINTS), stored(answered).includes(POINTS)],
      "the writer is refused for narrating the page before a cent is spent reading the copy for sense, a stored row of that shape goes back for a corrective redraft instead of standing, and the identical subjects said as an answer pass both doors").toEqual([true, false, true, false]); });
  it.each(SITES)("refuses a sentence whose main clause arranges its subject at both doors, in the present tense or the past, and takes the same subjects stated as a fact, carried inside a quotation, or asked as a question, on $t", async (s) => {
    const parts = `${s.heads[0]!.toLowerCase()}, ${s.heads[1]!.toLowerCase()} and ${s.heads[2]!.toLowerCase()}`;
    const CASES = [`${s.label} groups its items by category, not as one flat list, and each category holds one short entry for the reader.`,
      `${s.label} is divided into four sections, and each one of them holds a short entry a reader can take away.`,
      `${s.label} centres on ${parts}, with one short entry for each of them.`, `${s.label} includes ${parts}, with one short entry for each of them.`,
      `${s.label} carries the survey line "the shore is divided into three shelves" word for word, and every one of them holds ${parts}.`,
      `A reader who asks how to sort the ${s.heads[1]!.toLowerCase()} finds every step in one place. ${s.lines[1]}`,
      `Those items were previously split across separate headings, and each of them now sits in one place.`, `${s.label} was previously grouped, and a reader had to hunt through it.`,
      `${s.heads[2]} is scattered across three sections.`, `${s.label} was spread over several sections before today.`, `${s.label} was divided into four parts until today, and one of them held every entry.`,
      `The paste was spread over the surface and left to dry, which is what gives it the colour.`, `${s.label} was once named after the craft itself, and the name has not changed since.`,
      `The strands are separated by hand before the work begins.`];
    const gap = card(s, { changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
      causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.lines[2]!, aeoKind: "missing_information" } } as never });
    const verdicts: boolean[] = [];
    for (const after of CASES) { const wrote = await run(s, gap, { field: "answer_block", before: null, after, ...TAIL, placementAnchor: s.h1, naturalHeading: s.heads[0]!, measurementTarget: s.q, claims: [{ text: after, supportedBy: ["page-copy-3"] }] });
      verdicts.push(wrote.why.some((r) => r.includes(POINTS)), staleCopyReasons(card(s, { changeFamily: "section", claims: [{ text: "c", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: s.lines[0]! }],
        recommendedChange: { kind: "existing_edit", field: "section", before: null, after, where: 'A new section headed "H"' }, assignment: ASSIGN({ standard: "restructuring" }) }), new Map([[canonicalUrlKey(s.url), bodyOf(s)]]) as never, [], { title: s.title, h1: s.h1, outline: s.heads } as never, false, []).includes(POINTS)); }
    expect(verdicts, "an arrangement statement is refused before a cent is spent on reading it for sense and again on the banked row it was serving from, whatever the subject and whatever tense it narrates in, and a factual verb, a quoted sentence, a reader's own question and a thing genuinely spread over a surface or separated by hand are untouched at both doors").toEqual([true, true, true, true, false, false, false, false, false, false, false, false, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false]); });
  it.each(SITES)("owes the results page for a search whose winners were never read, keeps the settlement where they were read and carry nothing, and hires the writer where one carries something, on $t", async (s) => {
    const W = `https://winner-${s.t}.example/page`, novel = s.t === "tenant-one"
      ? "The water in these tide pools drops to four degrees each February, when the anemones seal themselves shut against the frost."
      : "Un bastidor de veinte centimetros lleva hilo de seda japonesa, tenido en frio antes de enhebrar la aguja.";
    const snap = (mainText: string | null): Record<string, unknown> => ({ ...snapOf(s), research: mainText == null ? {} : { serpEvidence: [{ query: s.ask, observedAt: null, organic: [{ rank: 1, url: W, domain: "winner.example", title: null }], aiOverview: [], aiMode: [], paa: [], related: [] }],
        winningPages: [{ url: W, domain: "winner.example", engines: [], examplePrompts: [], appearances: [{ query: s.ask }], extract: { title: "Winner", h1: null, wordCount: 900, headings: [], faqCount: 0, entityNames: [], mainText, truncated: false, heldChars: mainText.length, totalChars: mainText.length } }] },
      ownedPages: [{ url: s.url, content: { wordCount: 400, title: s.title, h1: s.h1, outline: s.heads }, search: { clicks90d: 1, impressions90d: 900, ctr90d: 0.01, position90d: 8, topQueries: [{ query: s.ask, impressions: 900, clicks: 0, position: 8 }] } }] });
    const lost = (w?: "none" | "unread" | "read"): ChangeProposal => card(s, { changeFamily: "section", primaryQuery: s.ask, researchOnly: true, diagnosisCause: "ranking_loss", evidence: { query: s.ask, hints: [], evidenceRefCount: 1 },
      ...(w ? { winnersOnFile: w } : {}), recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." } });
    const answering = { ...bodyOf(s), passages: [...s.lines, s.answer] };
    const draft = { field: "answer_block", before: null, after: novel, ...TAIL, placementAnchor: s.h1, naturalHeading: s.heads[0]!, measurementTarget: s.ask, claims: [{ text: novel, supportedBy: ["page-copy-1"] }] };
    const none = await run(s, lost("none"), draft, PASS, [], answering, snap(null)), quiet = await run(s, lost("read"), draft, PASS, [], answering, snap(s.answer)), names = await run(s, lost("read"), draft, PASS, [], answering, snap(novel));
    const unstamped = await run(s, lost(), draft, PASS, [], answering, snap(null));
    expect([none.row.obligation, none.owed.map((n) => [(n as { kind: string }).kind, (n as { query: string }).query, (n as { reasonCode: string }).reasonCode]), none.wrote.length,
      quiet.row.obligation, quiet.owed.length, quiet.wrote.length, names.owed.length, names.wrote.length > 0, unstamped.row.obligation, unstamped.owed.length],
      "a search this page still earns whose winners nobody has read owes that reading, on the row and on the pass's own buying list, and spends nothing to say so; the same row with a winner read whole that carries nothing keeps the settlement, which is the truthful refusal; a winner that carries something the page does not buys no reading at all and hires the writer instead; and a row NO PRODUCER STAMPED reaches the same answer here off the account's own research rather than off a stamp it does not carry, because a walk holding the evidence never has to guess what a stored field would have said")
      .toEqual([{ kind: "evidence", need: { kind: "serp", query: s.ask, reasonCode: "no_winner_to_read" } }, [["serp", s.ask, "no_winner_to_read"]], 0,
        { kind: "terminal", reason: "no substantive gap named" }, 0, 0, 0, true, { kind: "evidence", need: { kind: "serp", query: s.ask, reasonCode: "no_winner_to_read" } }, 1]); });
  it.each(SITES)("tells the writer a claim names at most eight ids and only the ones that carry it, and buys one attempt for an answer the schema cannot take, on $t", async (s) => {
    const nine = ["page-copy-1", "page-copy-2", "page-copy-3", "page-copy-4", "page-copy-5", "page-copy-6", "page-copy-7", "page-copy-8", "page-copy-9"];
    const r = await run(s, card(s), { field: "meta", before: "Old line.", after: `${s.lines[0]} ${s.lines[1]}`.slice(0, 150), ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: s.lines[0]!, supportedBy: nine }] });
    bodies.map = new Map([[canonicalUrlKey(s.url), bodyOf(s)]]); const asked: string[] = []; // AND A CALL THAT NEVER CAME BACK IS NOT A BODY THAT CANNOT BE USED: a transport failure keeps every corrective round it has today, so nothing here turns an outage into a settled refusal.
    await applyDraftedCopy([card(s)] as never, { tenantId: s.t, snapshot: snapOf(s) as never, now: NOW, budget: DRAFT_BUDGET.plan({ jobs: [{ key: DRAFT_BUDGET.keyOf(card(s)), family: "editor" as const, impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
      complete: async ({ kind }: { kind: string }) => (kind === "editor_judgement" ? { value: PASS } : (asked.push(kind), { error: "the gateway did not answer", retryable: true })) } as never);
    expect([r.wrote.length, r.wrote[0]!.includes("AT MOST 8 IDS"), r.wrote[0]!.includes("never every id you were handed"), r.wrote[1]!.includes("supportedBy"), r.why[0]!.includes("schema_invalid"), r.row.status, asked.length],
      "the writer is told the cap and told to name the ids that carry the words rather than every id on file; an answer that breaks the cap anyway is asked once and corrected once with the objection itself, and the deliverable then settles instead of buying two more writing rounds of two calls each, while a call that never came back still buys every round it has today")
      .toEqual([2, true, true, true, true, "needs_review", 6]); });
  it.each(SITES)("reads the standard off the persisted assignment and never off the field, the family or which evidence landed, on $t", (s) => {
    const at = (over: Record<string, unknown>): string => editorialStandard({ field: "section", link: false, changeFamily: "factual_correction", assignment: ASSIGN(over), ...(over.field ? { field: over.field as string } : {}) });
    expect([at({ standard: "repositioning" }), at({ standard: "summary" }), at({ standard: "repositioning", field: "meta" }), at({ gapKind: "false_page_promise" }), editorialStandard({ field: "section", link: false, changeFamily: null })],
      "a persisted standard outranks the field name, the change family and the link flag; a row that persisted a gap and no standard is read off that gap; and a body row that types nothing at all is judged on the material the page already has rather than sent shopping for information").toEqual(["repositioning", "summary", "repositioning", "repositioning", "restructuring"]); });
  it.each(SITES)("keeps a page that does not exist yet out of its own observed-page evidence, on $t", async (s) => {
    const asked: string[] = [], drafted = { ...bodyOf(s), contentHash: null, heldNote: "This page does not exist yet." };
    const ask = async (unpublished: boolean): Promise<void> => { await draftFieldForPage({ field: "answer_block", body: drafted as never, query: s.q, ownedPaths: [], minutes: 5, evidenceHints: [], brief: "Write the section.", unpublished }, { tenantId: s.t, now: NOW, complete: async ({ user }: { user: string }) => (asked.push(user), { error: "none", retryable: false }) } as never); };
    await ask(true); const madeUp = asked.join(" "); asked.length = 0; await ask(false); const observed = asked.join(" ");
    expect([madeUp.includes("draft-so-far-1"), madeUp.includes("page-copy-1"), observed.includes("page-copy-1"), madeUp.includes(s.lines[0]!)],
      "a new page's own earlier paragraphs still reach the writer, under the class that says a model wrote them, so no gate can read them as words observed on a live page; a real page's passages are unchanged").toEqual([true, false, true, true]); });
  const HEADWORD = "it opens with the search words as a label and a colon";
  it.each(SITES)("refuses the search phrase used as a label on a missing answer, takes the same content as a reader's sentence, and leaves every other standard's colon alone, on $t", (s) => {
    const said = (standard: string, after: string): string[] => staleCopyReasons(card(s, { changeFamily: "section", claims: [{ text: "c", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: s.lines[0]! }],
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after, where: 'A new section headed "H"' }, assignment: ASSIGN({ standard }) }), new Map([[canonicalUrlKey(s.url), bodyOf(s)]]) as never, [], { title: s.title, h1: s.h1, outline: s.heads } as never, false, []);
    const labelled = `${s.q}: ${s.lines[2]}`, readerly = s.lines[2]!;
    expect([said("missing_answer", labelled).some((r) => r.includes(HEADWORD)), said("missing_answer", readerly).some((r) => r.includes(HEADWORD)), said("restructuring", labelled).some((r) => r.includes(HEADWORD)), said("summary", labelled).some((r) => r.includes(HEADWORD))],
      "the answer is written for a reader, so the search words standing as a label in front of a colon are refused where the missing-answer standard applies and nowhere else").toEqual([true, false, false, false]); });
  it.each(SITES)("hands the same refusal to the writer at the door the next paid redraft is briefed from, on $t", async (s) => {
    const gap = card(s, { changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
      causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.lines[2]!, aeoKind: "missing_information" } } as never });
    const wrote = async (after: string) => (await run(s, gap, { field: "answer_block", before: null, after, ...TAIL, placementAnchor: s.h1, naturalHeading: s.heads[0]!, measurementTarget: s.q, claims: [{ text: after, supportedBy: ["page-copy-3"] }] })).why;
    expect([(await wrote(`${s.q}: ${s.lines[2]}`)).some((r) => r.includes(HEADWORD)), (await wrote(s.lines[2]!)).some((r) => r.includes(HEADWORD))],
      "the writer is refused for it before a cent is spent reading the copy for sense, and the same content in a reader's sentence is not").toEqual([true, false]); });
  it.each(SITES)("keeps the standard the writer was briefed with on the words it was briefed for when a later pass re-mints the same change, and lets no re-mint's brief ride onto finished copy, on $t", async (s) => {
    const line = `${s.lines[0]} ${s.lines[1]}`.slice(0, 150);
    const drafted = (await run(s, card(s), { field: "meta", before: "Old line.", after: line, ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: line, supportedBy: ["page-copy-1"] }] })).row;
    const remint = (row: ChangeProposal): ChangeProposal => ({ ...card(s), researchOnly: true, changeFamily: row.changeFamily, recommendedChange: { ...row.recommendedChange, after: "The exact wording lands on the next funded pass." } as never, research: { missing: "the exact wording", next: "the next funded pass writes it" } });
    const kept = preferFinished(remint(drafted), drafted);
    const answer = card(s, { changeFamily: "section", claims: [{ text: s.lines[2]!, supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: s.lines[0]! }], assignment: ASSIGN({ standard: "missing_answer" }),
      recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: s.lines[2]!, where: 'A new section headed "H"' } });
    const keptAnswer = preferFinished(remint(answer), answer), brief = preferFinished({ ...remint(answer), assignment: answer.assignment }, { ...answer, assignment: undefined });
    expect([drafted.assignment?.standard, kept.recommendedChange.kind === "existing_edit" ? kept.recommendedChange.after : "", kept.assignment?.standard,
      keptAnswer.assignment?.standard, editorialStandard({ field: "answer_block", link: false, assignment: keptAnswer.assignment, changeFamily: keptAnswer.changeFamily }), brief.assignment?.standard ?? "none"],
      "the drafting pass stores the standard it briefed the writer with, the re-mint keeps the finished words, the standard rides with them, a body row keeps the missing-answer standard it was written under, the one typed selector every door calls then answers it off the row instead of guessing from the field, and a brief for words that never landed is dropped rather than stored beside copy that did").toEqual(["summary", line, "summary", "missing_answer", "missing_answer", "none"]); });
  it.each(SITES)("refuses the search words as a label on an answer block under any standard, and keeps the standard's own scope for a section under its own heading, on $t", (s) => {
    const said = (field: "answer_block" | "section", standard: string): string[] => staleCopyReasons(card(s, { changeFamily: "section", claims: [{ text: "c", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: s.lines[0]! }],
      recommendedChange: { kind: "existing_edit", field, before: null, after: `${s.q}: ${s.lines[2]}`, where: 'A new section headed "H"' }, assignment: ASSIGN({ standard }) }), new Map([[canonicalUrlKey(s.url), bodyOf(s)]]) as never, [], { title: s.title, h1: s.h1, outline: s.heads } as never, false, []);
    expect([said("answer_block", "restructuring").some((r) => r.includes(HEADWORD)), said("answer_block", "summary").some((r) => r.includes(HEADWORD)), said("section", "restructuring").some((r) => r.includes(HEADWORD)), said("section", "missing_answer").some((r) => r.includes(HEADWORD))],
      "the field whose whole job is to answer the tracked search may never open with that search as a label, and a section keeps the standard as its only gate").toEqual([true, true, false, true]); });
  const reading = async (s: Site, ask = s.ask, answer = s.answer) => { const { rulesVersionFor } = await import("@/domains/evidence/pages/fact-checks"), { pageHashOf } = await import("@/domains/evidence/pages/fact-check-run"), b = bodyOf(s);
    return { page: new URL(s.url).pathname, statementKey: "asked", subject: ask, current: "", proposed: answer, literal: null, usage: null, sources: [{ url: "https://ref.example/guide", kind: "encyclopedia", says: s.answer }], agreement: "single_source", confidence: "confirmed", verdict: "page_correct", alsoAt: [], note: "",
      pageContentHash: pageHashOf([b.title, b.h1, ...b.headings, ...b.passages].join("\n")), pageLocator: null, sourceReadAt: NOW.toISOString(), state: "checked", rulesVersion: rulesVersionFor({ subject: ask, current: "" }), evidenceBasis: null, checkedAt: NOW.toISOString() }; };
  it.each(SITES)("hands the writer a checked reading as the sentence it is, keeps its search behind that sentence, and tells it to lead with the answer rather than with the source list, on $t", async (s) => {
    const gap = card(s, { changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
      causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.ask, aeoKind: "missing_information" } } as never });
    const wrote = (await run(s, gap, { field: "answer_block", before: null, after: s.answer, ...TAIL, placementAnchor: s.h1, naturalHeading: s.heads[0]!, measurementTarget: s.q, claims: [{ text: s.answer, supportedBy: ["fact-1"] }] }, PASS, [await reading(s)])).wrote.join("\n");
    const leads = wrote.slice(wrote.indexOf("MUST LEAD WITH"), wrote.indexOf("SUPPORTING FACTS"));
    expect([wrote.includes(`${s.ask}: ${s.answer}`), wrote.includes(`${s.answer} This is about "${s.ask}".`), leads.includes(s.answer), leads.includes("https://ref.example/guide"), leads.includes("rated confirmed")],
      "the search words never stand in front of the sentence with a colon, the reading reaches the writer as its own sentence with the search behind it, and the one line telling the writer what to open with carries that sentence and neither a source address nor a confidence rating").toEqual([false, true, true, false, false]); });
  const FIGURE = "3157", NUMBER = `This draft says "${FIGURE}"`;
  const gapCard = (s: Site, explanation: string) => card(s, { changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
    causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation, payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.ask, aeoKind: "missing_information" } } as never });
  const winner = (s: Site) => ({ url: `https://winner.example${new URL(s.url).pathname}`, domain: "winner.example", engines: [], examplePrompts: [], appearances: [{ query: s.q }, { query: s.ask }],
    extract: { title: s.title, h1: null, wordCount: Number(FIGURE), headings: [], faqCount: 0, entityNames: [], openingSample: "", hasList: false } });
  it.each(SITES)("refuses a figure that stands only in the brief or in a rival's briefing line, and takes the same figure where the checked reading the copy cites carries it, on $t", async (s) => {
    const c = gapCard(s, "This page is asked for a search it never answers.");
    const draft = { field: "answer_block", before: null, after: s.figured, ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: s.figured, supportedBy: ["fact-1"] }] }; // the assignment asks for an inline addition, so the words carry no heading of their own
    const asked = { ...snapOf(s), ownedPages: [{ ...snapOf(s).ownedPages[0]!, search: { clicks90d: 0, impressions90d: 0, ctr90d: 0, position90d: 6, topQueries: [{ query: s.ask, impressions: Number(FIGURE), clicks: 0, position: 6 }] } }] };
    const briefed = await run(s, c, draft, PASS, [await reading(s)], bodyOf(s), asked);
    const carried = await run(s, c, draft, PASS, [await reading(s, s.ask, s.figured)], bodyOf(s), asked);
    const rivalled = await run(s, c, draft, PASS, [await reading(s)], bodyOf(s),
      { ...snapOf(s), research: { serpEvidence: [{ query: s.q, organic: [{ rank: 1, url: winner(s).url }] }], winningPages: [winner(s)] } });
    expect([briefed.why.some((w) => w.includes(NUMBER)), rivalled.why.some((w) => w.includes(NUMBER)), carried.why, carried.row.status],
      "a figure only the diagnosis printed and a figure only a rival's line carries are both refused as ungrounded, and the same figure inside the reading the copy cites is the one that stands").toEqual([true, true, [], "ready"]);
    expect(rivalled.wrote.join(" ").includes("rival-1"), "the rival line still reaches the writer as briefing, which is exactly the text that may not ground the claim").toBe(true); });
  it.each(SITES)("keeps every word a bound reading is recognised by, so presenting it as a sentence never sends a writable answer back to buy another source, on $t", async (s) => {
    const { demandOf } = await import("@/domains/decision/drafted-copy"), { topicTokens } = await import("@/domains/evidence/relevance-gate"), r = await reading(s);
    const page = { url: s.url, content: { wordCount: 400, title: s.title, h1: s.h1, outline: s.heads }, search: { clicks90d: 0, impressions90d: 0, ctr90d: 0, position90d: 0, topQueries: [{ query: s.ask, impressions: 120, clicks: 0, position: 6 }] } };
    const one = demandOf(page as never, bodyOf(s) as never, [r] as never, null, s.t).facts[0]!, said = new Set(topicTokens(one.fact));
    expect([one.id, one.fact.startsWith(`${s.ask}:`), one.fact.startsWith(s.answer), topicTokens(s.ask).every((w) => said.has(w))],
      "the id is untouched, the search no longer labels the sentence, the sentence leads, and every word the gap reader asks a bound fact to carry is still in the string, which is why the search rides behind the sentence instead of being dropped").toEqual(["fact-1", false, true, true]); });
  const gloss = async (s: Site) => { const { deriveSupport, claimTypeOf } = await import("@/domains/evidence/pages/claim-support"), { rulesVersionFor } = await import("@/domains/evidence/pages/fact-checks"), { pageHashOf } = await import("@/domains/evidence/pages/fact-check-run"), b = bodyOf(s), page = new URL(s.url).pathname, says = `${s.word}: ${s.right}`;
    const c = { tenantId: s.t, page, statementKey: "gloss", pageLocator: null, subject: s.word, claimKind: claimTypeOf(s.word, s.wrong, null), current: s.wrong, proposed: s.right, url: "https://ref.example/entry", kind: "dictionary" as const, quote: says, titleContext: null };
    return { page, statementKey: "gloss", subject: s.word, current: s.wrong, proposed: s.right, literal: null, usage: null, sources: [{ url: c.url, kind: "dictionary", says, support: deriveSupport(c) }], agreement: "single_source", confidence: "confirmed", verdict: "page_imprecise", alsoAt: [], note: "",
      pageContentHash: pageHashOf([b.title, b.h1, ...b.headings, ...b.passages].join("\n")), pageLocator: null, sourceReadAt: NOW.toISOString(), state: "checked", rulesVersion: rulesVersionFor({ subject: s.word, current: s.wrong }), evidenceBasis: null, checkedAt: NOW.toISOString() }; };
  it.each(SITES)("shows a checked reading as the reader's sentence however few words its search carries, keeps a correction's own subject in front of it, and moves nothing about which version a reading is banked under, on $t", async (s) => {
    const { demandOf } = await import("@/domains/decision/drafted-copy"), { topicTokens } = await import("@/domains/evidence/relevance-gate");
    const { rulesVersionFor, MISSING_ANSWER_RULES_VERSION: RV, VERIFICATION_RULES_VERSION: CV } = await import("@/domains/evidence/pages/fact-checks"), { asksAQuestion } = await import("@/domains/evidence/pages/claim-support");
    const page = { url: s.url, content: { wordCount: 400, title: s.title, h1: s.h1, outline: s.heads }, search: { clicks90d: 0, impressions90d: 0, ctr90d: 0, position90d: 0, topQueries: [{ query: s.narrow, impressions: 120, clicks: 0, position: 6 }] } }, bare = s.right.replace(/\.$/, "");
    const one = async (rows: unknown[]): Promise<string> => demandOf(page as never, bodyOf(s) as never, rows as never, null, s.t).facts[0]?.fact ?? ""; const thin = await one([await reading(s, s.narrow, s.narrowAnswer)]), part = await one([await reading(s, s.word, bare)]), quoted = await one([await reading(s, s.word, `"${bare}."`)]), fixed = await one([await gloss(s)]);
    const gap = card(s, { changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
      causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.narrow, aeoKind: "missing_information" } } as never });
    const wrote = (await run(s, gap, { field: "answer_block", before: null, after: s.narrowAnswer, ...TAIL, placementAnchor: s.h1, naturalHeading: s.heads[0]!, measurementTarget: s.narrow, claims: [{ text: s.narrowAnswer, supportedBy: ["fact-1"] }] }, PASS, [await reading(s, s.narrow, s.narrowAnswer)])).wrote.join("\n");
    const leads = wrote.slice(wrote.indexOf("MUST LEAD WITH"), wrote.indexOf("SUPPORTING FACTS")), said = new Set(topicTokens(thin));
    expect([asksAQuestion(s.narrow), asksAQuestion(s.ask), rulesVersionFor({ subject: s.narrow, current: "" }), rulesVersionFor({ subject: s.ask, current: "" }),
      thin.startsWith(`${s.narrow}:`), thin.startsWith(s.narrowAnswer), thin.includes(`This is about "${s.narrow}".`), topicTokens(s.narrow).every((w) => said.has(w)),
      part.startsWith(`${s.word}: ${bare}`), part.includes("This is about"), quoted.startsWith(`"${bare}."`), quoted.includes(`This is about "${s.word}".`),
      fixed.startsWith(`${s.word}: ${s.right}`), fixed.includes("This is about"), leads.includes(s.narrowAnswer), leads.includes(`${s.narrow}:`)],
      "the width rule still refuses the three-word search and still calls the long one a question, and both are banked under exactly the versions they were, so nothing about banking moved; the narrow search never stands in front of its own answer, the answer leads, the search rides behind it, and every word the gap reader binds a fact by is still in the string; a gloss that only reads behind its headword keeps that headword in front and takes nothing behind it, while the same headword answered by a sentence closing on a quotation mark leads with that sentence; a correction of words this page publishes keeps the page's own name in front; and the one line telling the writer what to open with carries the answer sentence and never the search words").toEqual([false, true, CV, RV, false, true, true, true, true, false, true, true, true, false, true, false]); });
  it.each(SITES)("reads a possessive as the name it possesses, so a draft naming this page's own subject is not refused for a word the page prints, and a name the page never prints is still refused, on $t", async (s) => {
    const { entityGrounded, checkFactualEntailment } = await import("@/domains/decision/drafts/factual-entailment"), head = s.label.split(" ")[0]!, body = `${s.label} ${s.lines.join(" ")}`, seen = body.toLowerCase();
    const kept = checkFactualEntailment({ draftText: `${head}'s water is what a visitor asks about.`, pageBodyText: body, query: s.q }), refused = checkFactualEntailment({ draftText: "Kelp Forest Reserve protects them.", pageBodyText: body, query: s.q });
    expect([entityGrounded(`${head}'s`, seen), entityGrounded(`${head}\u2019s`, seen), entityGrounded(`${s.label}'`, seen), entityGrounded(head, seen), entityGrounded("Kelp Forest Reserve", seen),
      kept.entailed, kept.violations, refused.entailed, refused.violations.length, refused.violations[0]?.includes("Check it before you paste"), /\bI\b|\bmy data\b/.test(refused.violations.join(" "))],
      "a straight apostrophe, a curly one and a plural possessive all name the thing the page names, the bare name is unchanged, and a name this page never prints is still refused; the whole gate lets a possessive of the page's own subject through with nothing to say about it, still refuses an invented name, still tells the operator what to do about it, and says none of it in the first person").toEqual([true, true, true, true, false, true, [], false, 1, true, false]); });
  it.each(SITES)("leaves the exact words a funded pass wrote, the sentence that refused them and the attempt count on the row, keeps the work reachable while attempts are left, and settles it once they are spent, on $t", async (s) => {
    const brief = card(s, { researchOnly: true, changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." },
      causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.narrow, aeoKind: "missing_information" } } as never });
    const invented = `${s.lines[0]} Kelp Forest Reserve keeps a record of it.`, wrote = { field: "section", before: null, after: invented, ...TAIL, placementAnchor: s.h1, naturalHeading: s.heads[0]!, measurementTarget: s.q, claims: [{ text: s.lines[0]!, supportedBy: ["page-copy-1"] }] };
    const r = await run(s, brief, wrote), was = r.row.previousCopy, why = was?.retiredBecause ?? "";
    const spent = { ...r.row, previousCopy: { ...was!, attempts: 2 } } as ChangeProposal, moved = { ...r.row, previousCopy: { ...was!, retiredBecause: "the kind of change moved" } } as ChangeProposal;
    const dead = await run(s, brief, wrote, "throw"); const next = (await run(s, r.row, wrote)).wrote.join("\n");
    expect([was?.after, why.includes("Forest Reserve") && why === r.why[0], was?.attempts, (r.row.faults ?? []).includes(why), nextObligation(r.row)?.kind,
      nextObligation(spent), nextObligation(moved)?.kind, dead.row.previousCopy ?? null, dead.row.faults ?? [], dead.unsettled.length,
      next.includes(invented), next.includes(why)],
      "the row carries the exact words the pass wrote, the sentence a door refused them for and the count of attempts it has now consumed; it owes a corrective draft carrying that sentence while an attempt is left, so the work stays reachable under a moved identity, and the second spent attempt settles it on the same two-attempt rule finished copy answers to; a retirement written for anything but this row's own refusal owes a first draft exactly as before; a reading that never came back banks nothing and leaves the card unsettled; and the next pass is told both the words already retired and the exact objection").toEqual([
        invented, true, 1, true, "redraft",
        { kind: "terminal", reason: "two corrective drafts failed the same gates, so this is settled rather than retried" }, "draft", null, [], 1,
        true, true]); });
  it.each(SITES)("lets a replacement keep the exact ranking word the words it replaces already carry, and refuses every wider one at both doors, on $t", async (s) => {
    const body = { ...bodyOf(s), passages: [...s.lines, `${s.section} ${s.boast}`] }, keeps = `${s.boast} ${s.lines[2] ?? s.lines[0]}`, wider = `${s.lines[0]} It is the leading shore of its kind anywhere.`;
    const rewriting = (over: Record<string, unknown> = {}) => card(s, { primaryQuery: s.section, changeFamily: "section", treatment: "rewrite_existing_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Rewrite the section." },
      causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.section, missing: s.narrow, aeoKind: "missing_information" } } as never, ...over });
    const draft = (after: string) => ({ field: "section", before: null, after, ...TAIL, placementAnchor: s.section, naturalHeading: null, measurementTarget: s.section, claims: [{ text: s.lines[0]!, supportedBy: ["page-copy-1"] }] });
    const kept = await run(s, rewriting(), draft(keeps), PASS, [], body), over = await run(s, rewriting(), draft(wider), PASS, [], body);
    const added = await run(s, rewriting({ treatment: "add_answer_section" }), draft(keeps), PASS, [], body);
    const fw = (x: { why: string[] }) => x.why.some((w) => w.includes("firewall:superlative")), canon = (x: { why: string[] }) => x.why.some((w) => w.includes("superlative claim"));
    expect([fw(kept), canon(kept), kept.wrote.join("\n").includes("keeping that exact word is keeping what the page already says"), fw(over), fw(added)],
      "a replacement keeping the ranking word its own replaced passage carries passes the writer's firewall and the canon's quality gate, and the prompt that orders it to keep that passage's words says so at the line where the order is given; a ranking word that passage does not carry is still refused at the writer's door, and an addition, which replaces nothing, is refused exactly as before").toEqual([false, false, true, true, true]); });
  it.each(SITES)("keeps every sentence one of its own gates wrote out of the operator's caveats while the hold and the obligation still say what is owed, on $t", (s) => {
    const gate = "it did not pass the read of its own words: nothing in it beyond the page heading names something this page's own words carry", note = "Read off the last stored copy of each page, so a description rewritten since that read is not counted here.";
    const held = card(s, { faults: [gate], limitations: [gate, note, "its copy carries no record of what it stands on"], claims: [{ text: s.lines[0]!, supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: `${s.lines[0]} https://example.org says so` }], recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: s.lines[1]! } });
    const hold = openHold(held);
    expect([hold.caveats, hold.why.includes(gate), nextObligation(held)?.kind, (nextObligation(held) as { instruction?: string } | null)?.instruction],
      "what is left for a person to keep in mind is the sentence written for a person and the count of sources behind the words; the gate's own sentence and the store's own record sentence are both gone from it, the hold still names the gate's sentence, and the typed next step still carries it word for word as the objection to write against").toEqual([["Backed by 1 checked source. Add a second before publishing if being wrong here would cost you.", note], true, "redraft", gate]); });
  it.each(SITES)("hands its own family count back to the caller on every branch, including the one where it refuses nothing, on $t", (s) => {
    const at = (slug: string) => `${new URL(s.url).origin}/family/${slug}`, kinBody = (slug: string) => ({ ...bodyOf(s), url: at(slug), title: `${s.title} ${slug}`, h1: `${s.title} ${slug}` });
    const mine = kinBody("self"), sibs = [kinBody("two"), kinBody("three")], inventory = [mine.url, ...sibs.map((b) => b.url)];
    const ask = (held: typeof sibs, inv: readonly string[]): { asked: number; loaded: number } => { const out = { asked: -1, loaded: -1 };
      staleCopyReasons(card(s, { pageUrl: mine.url, pagePath: "/family/self", recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: `${s.lines[1]}` } }), new Map(held.map((b) => [canonicalUrlKey(b.url), b])) as never, [], { title: mine.title, h1: mine.h1, outline: s.heads } as never, false, [], inv, out); return out; };
    expect([ask([mine, sibs[0]!], inventory), ask([mine, ...sibs], inventory), ask([mine, ...sibs], []), ask(sibs, inventory)],
      "a short family reports what the inventory names and what the caller handed over, a complete family reports the same two numbers rather than leaving the caller to recompute them, a caller that cannot say what the family is has its window taken as the whole of it, and a page whose own body was never read asked its family nothing").toEqual([{ asked: 2, loaded: 1 }, { asked: 2, loaded: 2 }, { asked: 2, loaded: 2 }, { asked: 0, loaded: 0 }]); });
  it.each(SITES)("banks each checked reading with the addresses that quoted it and what kind of source each one is, drops the address that quoted nothing, and keeps all of it through the reading that approves the words, on $t", async (s) => {
    const quiet = { ...(await reading(s)), sources: [{ url: "https://ref.example/guide", kind: "encyclopedia", says: s.answer }, { url: "https://quiet.example/x", kind: "publisher", says: "  " }] };
    const gap = card(s, { changeFamily: "section", treatment: "add_answer_section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Add the missing answer." },
      causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.ask, aeoKind: "missing_information" } } as never });
    const row = (await run(s, gap, { field: "answer_block", before: null, after: s.answer, ...TAIL, placementAnchor: s.h1, naturalHeading: s.heads[0]!, measurementTarget: s.q, claims: [{ text: s.answer, supportedBy: ["fact-1"] }] }, PASS, [quiet])).row;
    const banked = (row.supportFacts ?? []).find((f) => f.id === "fact-1");
    expect([banked?.sources, (row.supportFacts ?? []).find((f) => f.id !== "fact-1")?.sources],
      "the reading's own quoting address is banked with the kind of source it is, the address that quoted nothing is not banked at all, and the page's own words carry no publisher")
      .toEqual([[{ url: "https://ref.example/guide", kind: "encyclopedia" }], undefined]);
    const { citedPublishers } = await import("@/domains/decision/completeness");
    const kept = await reviewFinishedCopy({ ...row, claims: undefined, status: "needs_review" } as never, { tenantId: s.t, now: NOW, judge: async () => ({ aeoPacket: PASS.aeoPacket, pageFit: true, claims: [{ i: 0, by: ["fact-1"], entailed: true }], usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "", resolution: { kind: "accepted" } } as never) });
    expect([(kept.row?.supportFacts ?? []).find((f) => f.id === "fact-1")?.sources, citedPublishers(kept.row as never).size, citedPublishers(row).size],
      "a reading that rebuilds the record of what each sentence stands on keeps the provenance the row already held, so the publisher count does not fall back to prose the moment a row is read")
      .toEqual([[{ url: "https://ref.example/guide", kind: "encyclopedia" }], 1, 1]); });
});

describe("the deadline the editor asks before it starts a call", () => {
  for (const s of SITES) {
    const draft = { field: "meta", before: "Old line.", after: `${s.lines[0]} ${s.lines[1]}`.slice(0, 150), ...TAIL, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, claims: [{ text: s.lines[0]!, supportedBy: ["page-copy-1"] }] };
    const drive = async (stopBy: number, jump: number | null) => {
      bodies.map = new Map([[canonicalUrlKey(s.url), bodyOf(s)]]); facts.rows = [];
      const c = card(s), kinds: string[] = [], unsettled = new Set<string>(), why = new Map<string, string>();
      await applyDraftedCopy([c], { tenantId: s.t, snapshot: snapOf(s) as never, now: NOW, stopBy, unsettled, refusals: why,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: c.pagePath!, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async ({ kind }: { kind: string }) => { kinds.push(kind); if (jump != null && kinds.length === 1) vi.setSystemTime(jump);
          return kind === "editor_judgement" ? { value: { ...PASS, claims: rule(draft.claims) } } : { value: draft }; } } as never);
      return { kinds, unsettled: [...unsettled], why: [...why.values()].join(" ") };
    };
    it(`${s.t}: a box that closes while the writer is in flight buys no reading of the words, and the card is owed rather than refused`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] }); const at = Date.now();
      const cut = await drive(at + 300_000, at + 600_000); vi.setSystemTime(at); const ran = await drive(at + 600_000, null); vi.useRealTimers();
      expect([cut.kinds, cut.unsettled.length, cut.why.includes("time box ended before this call could start")],
        "the writer's call finished and the reading of meaning was never started, so nothing was bought past the box and the card is owed again at its own rank").toEqual([["atomic_edit"], 1, true]);
      expect([ran.kinds, ran.unsettled], "a box with room ahead of it starts both calls exactly as before").toEqual([["atomic_edit", "editor_judgement"], []]);
    });
  }
});

describe("#129 full AEO packet acceptance", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_BEACON_AEO_PACKET", "1"));
  for (const people of [false, true]) {
  const s = people ? { ...SITES[0]!, url: "https://alpha.example/people", label: "Notable people", q: "notable people from the region", title: "Notable people", h1: "Notable people", heads: ["Poetry", "Painting"], lines: ["Mira is a poet born in the region.", "Dara is a painter born in the region.", "These examples concern people born in the region whose poetry or painting appears in the archive."] } : { ...SITES[0]!, url: "https://alpha.example/wildlife", label: "Wildlife", q: "which animals live in the reserve", title: "Reserve wildlife", h1: "Reserve wildlife", heads: ["Mammals", "Birds"],
    lines: ["Otters are mammals recorded in the reserve rivers.", "Herons are birds recorded in the reserve wetlands.", "These records concern wild animals observed inside the reserve during the survey."] };
  const lead = people ? "Notable people born in the region include Mira in poetry and Dara in painting, selected here for work held in the archive." : "Wild animals recorded inside the reserve during the survey include river mammals such as otters and wetland birds such as herons.";
  const answer = people ? `${lead}\n## Poetry in the archive\nMira is a poet born in the region.\n## Painting in the archive\nDara is a painter born in the region.\n- Mira: poet born in the region.\n- Dara: painter born in the region.` : `${lead}\n## River mammals\nOtters are mammals recorded in the reserve rivers.\n## Wetland birds\nHerons are birds recorded in the reserve wetlands.\n- Otter: mammal recorded in reserve rivers.\n- Heron: bird recorded in reserve wetlands.`;
  const c = card(s, { changeFamily: "section", treatment: "rewrite_existing_section", primaryQuery: s.q, recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "Write the answer." },
    causeFinding: { cause: "retrieved_not_cited", action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "The answer is scattered.", payload: { cause: "retrieved_not_cited", engine: "chatgpt", promptText: s.q, missing: s.lines[2], aeoKind: "scattered_answer" } } as never });
  const write = (after: string, verdict: Record<string, unknown> = PASS, uncertaintyOrOmitted: string[] = []) => run(s, c, { ...TAIL, field: "answer_block", before: null, after, placementAnchor: s.h1, naturalHeading: null, measurementTarget: s.q, risks: uncertaintyOrOmitted,
    claims: [{ text: after, supportedBy: ["page-copy-1", "page-copy-2", "page-copy-3"] }] }, verdict);
  it(`${people ? "Famous-Iranians-class" : "Animals-class"}: offers a supported scoped packet; refuses dumps, unresolved accuracy and a failed semantic rubric`, async () => {
    const good = await write(answer);
    expect([good.row.status, good.row.semanticReview?.aeoPacket?.h1QueryAlignment, openHold(good.row).defects]).toEqual(["ready", true, []]);
    for (const [copy, verdict, doubts] of [["- Otters\n- Herons", PASS, []], [answer, PASS, ["May be incomplete; check every word; overreads native status."]], [answer, { ...PASS, aeoPacket: { ...PASS.aeoPacket, groupedH2s: false }, notes: "Inclusion criteria are not supported." }, []]] as const) {
      const bad = await write(copy, verdict, [...doubts]); expect(bad.row.status).toBe("needs_review"); }
    const banked = deserializeChangeProposal(serializeChangeProposal(good.row))!;
    expect([banked.semanticReview?.aeoPacket, openHold(banked).defects]).toEqual([PASS.aeoPacket, []]);
    const link = { ...good.row, semanticReview: undefined, recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "The preceding dynasty established the capital.", linkTo: "/preceding-dynasty", anchorText: "preceding dynasty", where: "After the opening" } };
    expect(openHold(link).defects.some((d) => d.includes("AEO packet"))).toBe(false);
    for (const criterion of Object.keys(PASS.aeoPacket)) expect((await write(answer, { ...PASS, aeoPacket: { ...PASS.aeoPacket, [criterion]: false } })).row.status).toBe("needs_review");
    expect(openHold({ ...good.row, primaryQuery: "unrelated intent" }).defects.join(" ")).toContain("answer rubric");
    expect((await write(answer.replace(/## /g, "### "))).row.status).toBe("needs_review");
    expect((await write(answer.replace(/^- .*$/gm, ""))).row.status).toBe("needs_review");
    expect(openHold({ ...good.row, semanticReview: undefined }).defects.join(" ")).toContain("answer rubric");
    expect(openHold({ ...good.row, recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "- Otters\n- Herons", where: "After the opening" } }).defects.join(" ")).toContain("answer paragraph");
    expect(nextObligation({ ...good.row, semanticReview: undefined })?.kind).toBe("review");
    bodies.map = new Map([[canonicalUrlKey(s.url), { ...bodyOf(s), h1: null }]]);
    const reread = await reviewFinishedCopy(good.row, { tenantId: s.t, now: NOW, judge: async () => ({ ...PASS, claims: rule(good.row.claims ?? []) }) as never });
    expect(reread.row?.faults?.join(" ")).toContain("H1 and query are required");
  });
  it("fails closed on an omitted rubric ruling or an undefended claim, and supports rollback", async () => {
    const { aeoPacket: _bar, ...old } = PASS; expect((await write(answer, old)).row.status).toBe("needs_review");
    expect((await write(answer, { ...PASS, contested: true, notes: "Native status is not established." })).row.status).toBe("needs_review");
    vi.stubEnv("NEXT_PUBLIC_BEACON_AEO_PACKET", "0");
    try { expect((await write(lead, old)).row.status).toBe("ready"); } finally { vi.unstubAllEnvs(); }
  });
  }
});
