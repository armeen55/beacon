/** THE CAUSE PRODUCERS. A named cause reaches a producer, it works off the structure the ladder read, every component survives the REAL validator, a cause with no producer refuses in its own words, a drafter that will not land is a refusal, thin evidence never reaches a drafter, and wording keeps its own path. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EvidenceSnapshot, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import { answerIntelOf } from "@/domains/evidence/answer-intel"; import type { TopicInvestigation } from "@/domains/evidence/topic-investigation";
import type { OwnedCandidate } from "@/domains/decision/owned-coverage";
import type { DecidedTopic } from "@/domains/decision/coverage-pass";
import type { WinningPattern } from "@/domains/decision/winning-pattern";
import { validateProposal } from "@/domains/decision/validate-proposal"; import { provenSurvivor } from "@/domains/decision/split"; import { componentIdOf } from "@/domains/decision/contracts"; import { copyKey } from "@/domains/decision/proof"; import { openHold } from "@/domains/decision/completeness";
import { deserializeChangeProposal, serializeChangeProposal } from "@/domains/decision/contracts"; import { researchingCards } from "@/domains/decision/authorization"; import type { CauseFinding } from "@/domains/decision/diagnosis";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
import { produceBundleForSnapshot, type OwnedBody } from "@/domains/decision/produce-bundle"; import { buildNewPageProposal } from "@/domains/decision/new-page"; import { evidenceShortfall } from "@/domains/decision/proof";
const TENANT = "fixture-tenant"; const NOW = new Date("2026-08-01T00:00:00.000Z"); const URL = "fixture-content.example/rain-barrels";
const OPENING = "Collecting water at home starts with knowing what one storm actually brings you.";
// ── the drafted answers the seam hands back, each grounded in words the evidence already carries ──
/** WHAT A SECTION AND AN OPENING NOW COME BACK CARRYING: the claim it makes, the stored id that carries it, and the reviewer's ruling on exactly that claim. A bundle's substantive pieces go through the ONE canonical editor, so a fixture that answered a second section drafter is answering a question nobody asks any more. */
const cited = (user: string): string => (user.includes("owned-page-1") ? "owned-page-1" : "page-heading-1"); // the sibling page where this account holds one, and the page's own heading where it does not
const JUDGED = (id: string) => ({ pageFit: true, claims: [{ i: 0, by: [id], entailed: true }], usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "It says where a full barrel's overflow goes, which this page never said.", resolution: "none" });
const ANSWER = "Rain barrel sizing depends on your roof area and the rain one storm brings. The bigger the roof, the faster a barrel fills, so pick one that holds what a heavy storm delivers and plan where the overflow goes.";
const TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Paste the copy"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };
const TITLE_AFTER = "Rain barrel sizing: gallons per storm by roof area";
/** Records every draft kind bought, so "spent nothing" is provable rather than assumed. */
const bought: string[] = [];
const seam = (over: { atomic?: unknown; judged?: unknown } = {}): CompleteFn => async ({ kind, user }) => { bought.push(kind);
  if (kind === "editor_judgement") return { value: (over.judged ?? JUDGED(cited(user))) as never };
  return { value: (over.atomic ?? { field: "answer_block", before: null, after: ANSWER, naturalHeading: (/under the heading "(.*?)"/.exec(user) ?? [])[1] ?? "Where the overflow goes",
    placementAnchor: "Rain Barrels", claims: [{ text: "Barrel sizes vary.", supportedBy: [cited(user)] }], implementationMinutes: 15, rationale: "The opening never says what the search is about.", ...TAIL }) as never };};
const page = (over: Partial<OwnedPageEvidence> = {}): OwnedPageEvidence => ({ url: URL, content: { title: "Rain Barrels", metaDescription: null, h1: "Rain Barrels", h2: [], outline: ["Rain barrel sizing", "Roof area and gallons"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" },
  search: { clicks90d: 120, impressions90d: 9000, ctr90d: 0.013, position90d: 3, topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 90, position: 3 }] }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] }, ...over });
const snapshot = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({ scope: { tenantId: TENANT, site: "fixture-content.example", builtAt: NOW.toISOString() }, aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [], contentGaps: [],
  internalLinkOpportunities: [], evidenceHash: "fixture", research: emptyResearchEvidence(), ownedPages: [page(), page({ url: SIBLING, content: { ...page().content!, title: "Gutter guards", h1: "Gutter guards", outline: ["Gutter guards"] }, search: { clicks90d: 5, impressions90d: 100, ctr90d: 0.05, position90d: 4, topQueries: [{ query: "gutter guards", impressions: 100, clicks: 5, position: 4 }] } })], ...over });
/** ANOTHER PAGE OF THIS ACCOUNT, WITH ITS WORDS ON FILE: the one thing a page cannot say about itself, and the id a body claim may actually stand on. */
const SIBLING = "fixture-content.example/gutter-guards";
const BODY: ReadonlyMap<string, OwnedBody> = new Map([["fixture-content.example/rain-barrels", { openingSample: OPENING, fetchedAt: "2026-07-20T00:00:00.000Z", cardTexts: ["Roof area and gallons"], entityNames: [], headings: ["Barrel sizes", "Winter care"], completeness: "complete", internalLinks: [], metaDescription: null }],
  [SIBLING, { openingSample: "Gutter guards keep leaves out of a downspout.", fetchedAt: "2026-07-20T00:00:00.000Z", cardTexts: [], entityNames: [], headings: ["Gutter guards"], passages: ["Gutter guards keep leaves out of the downspout, so a barrel fills with water rather than debris."], completeness: "complete", internalLinks: [], metaDescription: null }]]);
const pattern = (over: Partial<WinningPattern> = {}): WinningPattern => ({ archetype: "informational_guide", commonHeadings: [{ heading: "Sizing by roof area", seenOn: [0, 1, 2] }], commonEntities: [], questionsAnswered: [], openingPattern: "they answer the sizing question in the first line", disagreements: [], ownedGaps: [], uniqueNotCommon: [],
  winners: 3, publishers: ["gardenguide.example", "waterwise.example", "downspout.example"], fingerprint: "abc123", ...over });
const candidate = (): OwnedCandidate => ({ url: URL, path: "/rain-barrels", title: "Rain Barrels", h1: "Rain Barrels", wordCount: 900,
  outlineLength: 2, openingSample: OPENING, entities: [], fetchedAt: null, bodyHeld: true, strongSignals: 1,
  signals: [{ kind: "gsc_exact_query", strength: "strong", basis: "rain barrel sizing", detail: "Google already shows this page for that search." }] });
const investigation = (): TopicInvestigation => ({ key: "inv_rain", aliasKeys: [], label: "rain barrel sizing", demandBasis: "search", groupedBy: [],
  queries: ["rain barrel sizing"], keywords: [], trackedPrompts: [], fanOuts: [], answerIntel: answerIntelOf([]), exactSerps: [], serpFreshness: "current",
  demand: { monthlySearchVolume: 4400, queriesWithVolume: 1, gscImpressions: 6000, difficulty: null, intent: "informational", trackedPrompts: 0, fanOuts: 0, engines: [] },
  distinctResultDomains: 8, resultDomains: [], pageType: "informational_guide", pageTypeVotes: [], serpCoherence: "coherent",
  winners: [], distinctWinners: 3, currentReadableWinners: 3, missingEvidence: [], nextAcquisition: null, diminishing: false });
const decided = (p: WinningPattern | null): DecidedTopic => ({
  investigation: investigation(), candidates: [candidate()], reading: null,
  decision: { verdict: "improve_existing", topicKey: "inv_rain", ownedUrls: [URL], evidenceKeys: ["demand"], missing: [],
    alternativesRuledOut: [{ alternative: "Write a new page for this", reason: "Your own page already answers this search." }],
    explanation: "I would sharpen the page you already have rather than add another that competes with it.", ...(p ? { pattern: p } : {}) } });
const OPTS = { now: NOW, bypassCache: true, bodyByUrl: BODY };
beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; bought.length = 0; });
afterEach(() => { delete process.env.OPENAI_API_KEY; });
describe("a named cause produces the change that fixes it", () => {
  it("writes the opening the page never had, and it survives the real validator", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam(), coverage: decided(pattern()) }); expect(out.status).toBe("bundled"); if (out.status !== "bundled") return; const p = out.proposal; const b = p.bundle!;
    expect(p.diagnosisCause).toBe("weak_opening"); // the REAL fired cause, never the hardcoded wording one
    expect(b.components.map((c) => c.kind)).toEqual(["opening_answer"]); expect(b.components[0]!.before).toBe(OPENING);     expect(b.components[0]!.after).toBe(ANSWER);
    expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "answer_block", before: OPENING, after: ANSWER }); expect(p.opportunityType).toBe("Answer the search in the page's first lines");
    const keys = new Set(b.receipt.items.map((i) => i.key)); expect(b.components[0]!.evidenceKeys.length).toBeGreaterThan(0); // every cited key is a receipt line the operator can actually read
    for (const k of b.components[0]!.evidenceKeys) expect(keys.has(k)).toBe(true);
    expect(validateProposal(p, { evidenceText: b.receipt.items.map((i) => i.fact).join(" ") }).verdict).not.toBe("rejected"); expect(deserializeChangeProposal(serializeChangeProposal(p))).toEqual(p); // THROUGH THE REAL VALIDATOR, not a mock of it, and a round trip through the one decoder
    expect([b.objective, b.measurementPlan, ...b.risks, ...b.components.map((c) => `${c.label} ${c.after} ${c.where} ${c.objective} ${c.mechanism}`)].join(" ")).not.toMatch(/[–—]|experiment|control group|baseline|SERP/i); });
  it("writes one section per subject the winning pages agree on and this page leaves out, each answering for itself", async () => {
    const p2 = pattern({ commonHeadings: [{ heading: "Gutter guards keep debris out", seenOn: [0, 1, 2] }, { heading: "Chaining a container", seenOn: [0, 1] }] });
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam(), coverage: decided(p2) }); expect(out.status).toBe("bundled"); if (out.status !== "bundled") return; const b = out.proposal.bundle!;
    expect(out.proposal.diagnosisCause).toBe("incomplete_coverage"); expect(b.components.map((c) => c.kind)).toEqual(["section_add", "section_add"]);
    for (const c of b.components) { // section_add is OUTSIDE the grandfathered kinds, so all four answers are owed or the validator rejects the whole change
      expect(c.where).toBeTruthy(); expect(c.objective).toBeTruthy(); expect(c.mechanism).toBeTruthy(); expect(c.measurementPlan).toBeTruthy(); expect(c.after).toContain(ANSWER);}
    expect(validateProposal(out.proposal, { evidenceText: b.receipt.items.map((i) => i.fact).join(" ") }).verdict).not.toBe("rejected");
    expect(bought.filter((k) => k === "atomic_edit")).toHaveLength(2); // one call per section, never a third, and every one of them through the ONE canonical editor
    expect(out.proposal.claims!.map((x) => x.of)).toEqual(b.components.map((c, i) => componentIdOf(c, i))); // AND EACH PIECE CARRIES ITS OWN AUTHORIZATION, named by the piece it belongs to: one section's ruling can never stand in for the next one's.
    expect(out.proposal.semanticReview!.of).toBe(copyKey(out.proposal)); expect(openHold(out.proposal).blocking).toBeNull();
  });
  it("never calls a subject absent that the held page carries in a later passage", async () => {
    const deep = new Map([[URL, { ...BODY.get(URL)!, passages: [...Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1} of ordinary prose.`), "Gutter guards keep debris out, and chaining a container carries the overflow away."] }]]);
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, bodyByUrl: deep, complete: seam(), coverage: decided(pattern({ commonHeadings: [{ heading: "Gutter guards keep debris out", seenOn: [0, 1, 2] }, { heading: "Chaining a container", seenOn: [0, 1] }] })) });
    expect(out.status === "bundled" && out.proposal.diagnosisCause).toBe("weak_opening"); }); // both are on the page, so nothing accuses it of leaving them out
  it("refuses honestly when the drafter will not land, and ships no empty component", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam({ atomic: {} }), coverage: decided(pattern()) }); expect(out.status).toBe("none"); if (out.status !== "none") return;
    expect(out.reason).toBe("No opening for this page passed its own checks, so nothing is handed over rather than filler.");
    expect(bought).toEqual(["atomic_edit", "atomic_edit"]); // it tried, and the retry is the drafter's own, not a second change
  });
  it("says why it is producing nothing for a cause no copy can fix, in the ladder's own words", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam(), coverage: decided(pattern()), measuringPagePaths: ["/rain-barrels"] }); expect(out.status).toBe("none"); if (out.status !== "none") return;
    expect(out.reason).toBe("The change you applied here is still being measured, so nothing is stacked on top of it.");
    expect(bought).toEqual([]); // a cause with no producer costs nothing
  });
  /** A REBUILD IS EARNED BY CAUSES THAT FIRED, never by ones checked and RULED OUT: counting the whole list told the operator "2 separate things are wrong" where the second clause contradicted the evidence. */
  describe("a rebuild is earned by what fired", () => {
    const REBUILT = ANSWER.replace("a heavy storm delivers", "a heavy storm brings"); const rebuildSeam: CompleteFn = async ({ kind, user }) => { bought.push(kind); // The cause's OWN producer can write nothing, so the rebuild is reachable; the rebuild's own sections do land, because a rebuild that cannot write the whole page now emits nothing at all. No superlative in the rebuilt copy: this fixture supplies no opening pattern, so "the first" would be an ungrounded claim and the factual firewall would rightly refuse the whole rebuild.
      if (kind === "editor_judgement") return { value: JUDGED(cited(user)) as never };
      if (user.includes("Rewrite the first lines")) return { value: { field: "answer_block", before: null, after: ANSWER, naturalHeading: "Where the overflow goes", placementAnchor: "Rain Barrels", claims: [{ text: "Barrel sizes vary.", supportedBy: [cited(user)] }], implementationMinutes: 15, rationale: "The opening never says what the search is about.", ...TAIL } as never };
      return user.includes("being rebuilt") ? { value: { field: "answer_block", before: null, after: REBUILT, naturalHeading: (/under the heading "(.*?)"/.exec(user) ?? [])[1] ?? "Overflow", placementAnchor: "Rain Barrels", claims: [{ text: "Barrel sizes vary.", supportedBy: [cited(user)] }], implementationMinutes: 15, rationale: "The page is being rebuilt.", ...TAIL } as never } : { value: {} as never }; };
    const gaps = { ownedGaps: [{ gap: "None of this page covers overflow", seenOn: [0, 1] }], openingPattern: "" };
    const rebuildOf = async (...heads: string[]) => produceBundleForSnapshot(snapshot(), { ...OPTS, complete: rebuildSeam,
      coverage: decided(pattern({ ...gaps, commonHeadings: heads.map((heading) => ({ heading, seenOn: [0, 1, 2] })) })) });
    it("rebuilds when a SECOND structural cause genuinely fired, and ships the whole page or nothing", async () => {
      const out = await rebuildOf("Chaining a second container", "Gutter guards keep debris out"); // subjects this page carries none of: it fires
      expect(out.status).toBe("bundled"); if (out.status !== "bundled") return; const b = out.proposal.bundle!; const c = b.components[0]!; expect(b.components.map((x) => x.kind)).toEqual(["full_rewrite"]);
      // THE COPY, NOT A PLAN: the page's own opening, then every section the winners agree on, in order.
      expect(c.after.startsWith(ANSWER)).toBe(true); expect(c.after).toContain(REBUILT);
      expect(c.mechanism).toContain("2 things are wrong at once");
      // BOTH SECTIONS THE WINNERS AGREE ON were bought, and neither was shipped as an unwritten heading.
      expect(bought.filter((k) => k === "editor_judgement")).toHaveLength(3); // the opening and the two sections the rebuild wrote, each read for sense by the ONE evaluator
      // A REBUILD ASSEMBLED FROM SEVERAL AUTHORIZED PIECES IS NOT ITSELF AUTHORIZED: its own copy is nobody's ruled claim, so the door holds it and says so instead of letting the pieces vouch for the whole.
      expect(out.proposal.status).toBe("needs_review"); expect(openHold(out.proposal).blocking).toContain("have not been read against the sources they name");
    });
    it("never rebuilds when every competing explanation was RULED OUT", async () => {
      const out = await rebuildOf("Rain barrel sizing"); // a subject this page already covers: it does not fire
      expect(out.status).toBe("none"); if (out.status !== "none") return; expect(out.reason).toBe("No section that would close the gap on the winning pages passed its own checks, so nothing is handed over rather than filler."); }); });
  /** A SPLIT IS AN INVESTIGATION UNTIL THE EVIDENCE NAMES THE SURVIVOR, and the merge that does ship names it, names what moves, and keeps the two-step hold: downgrading a merge's danger took that hold off the one change that needs it AND made the stored row fail re-validation as mislabelled. */
  it("writes no merge while the survivor is unproven, then hands over the proven one and holds it for review", async () => {
    const RIVAL = "fixture-content.example/rain-barrel-guide";
    const world = (rival: OwnedPageEvidence[]) => snapshot({ ownedPages: [page(), ...rival], cannibalization: [{ query: "rain barrel sizing", note: "two of your own pages", competingUrls: [URL, RIVAL] }] });
    // THE EARNINGS ARE ALREADY ON FILE, so the survivor is decided from them and never deferred: the page I hold figures for is kept, an equal pair is settled by position, and a page I hold nothing for settles nothing.
    const split = (a: [number | null, number | null], b: [number | null, number | null]) => provenSurvivor([{ url: URL, clicks: a[0], impressions: 900, position: a[1] }, { url: RIVAL, clicks: b[0], impressions: 400, position: b[1] }]);
    expect([split([12, 4], [3, 2]), split([0, 4], [0, 9]), split([12, 4], [null, null]), split([4, 3], [4, 3]), split([null, null], [null, null])]).toEqual([URL, URL, null, null, null]);
    const unproven = await produceBundleForSnapshot(world([]), { ...OPTS, complete: seam(), coverage: decided(pattern()) }); // ONE-SIDED KNOWLEDGE SETTLES NOTHING: a page I hold no row for is unmeasured, not behind, and sending it away for good on my ignorance is the one mistake here I could not undo
    expect([unproven.status, unproven.status === "none" && unproven.reason.includes("not proof that either takes the other's clicks")]).toEqual(["none", true]);
    // PROVEN: both pages' own figures for that exact search, and both pages' current words on file.
    const rival = page({ url: RIVAL, content: { ...page().content!, title: "Rain barrel guide", h1: "Rain barrel guide", outline: ["Barrel sizes", "Winter care"] },
      search: { clicks90d: 20, impressions90d: 900, ctr90d: 0.02, position90d: 9, topQueries: [{ query: "rain barrel sizing", impressions: 900, clicks: 20, position: 9 }] } });
    const out = await produceBundleForSnapshot(world([rival]), { ...OPTS, complete: seam(), coverage: decided(pattern()),
      bodyByUrl: new Map([...BODY, [RIVAL, { ...BODY.get(URL)!, headings: ["Barrel sizes", "Winter care"] }]]) });
    expect(out.status).toBe("bundled"); if (out.status !== "bundled") return; const p = out.proposal; const b = p.bundle!; const c = b.components[0]!;
    expect([p.diagnosisCause, p.status, p.riskLevel]).toEqual(["cannibalization", "needs_review", "high"]); // a question, never a paste, priced as the lever it is
    expect([c.kind, c.risk, c.redirectTo]).toEqual(["consolidation", "dangerous", "/rain-barrels"]); expect(c.after).toContain("/rain-barrels earns 90 clicks from that search against 20 on /rain-barrel-guide");
    expect(p.operatorSteps).toEqual(["Check /rain-barrels already says everything /rain-barrel-guide says: nothing on file there is missing from it", "Redirect /rain-barrel-guide to /rain-barrels for good", 'Come back here and mark it done, about 90 minutes of work in all, and clicks and average position for "rain barrel sizing" get read across all 2 addresses']);
    // the comparison that proves it is a line the operator can read, and the component cites it
    expect(b.receipt.items.find((i) => i.key === "demand-competing")!.fact).toContain("/rain-barrel-guide takes 20 clicks from 900 views at about position 9"); expect(c.evidenceKeys).toContain("demand-competing");
    // AND THROUGH THE VALIDATOR AGAIN on exactly the shape stored: an unmarked lever is rejected as mislabelled.
    const again = validateProposal(p, { evidenceText: b.receipt.items.map((i) => i.fact).join(" ") });
    expect([again.verdict, again.reasons.join(" ").includes("confirm it before you make the change"), bought]).toEqual(["needs_review", true, []]); });
  /** THE ASSEMBLED ROW IS GATED, NOT ONLY ITS PIECES: the per-component gate reads a synthetic proposal that carries no cause and no limitations, so a cause pointing at a receipt line nobody wrote sailed past it. */
  it("refuses to ship an assembled change whose cause points at a receipt line the receipt never carried", async () => {
    // No body on file, so the opening this cause read came off the comparison and the receipt has no line for it.
    const { bodyByUrl: _drop, ...noBody } = OPTS; void _drop; const out = await produceBundleForSnapshot(snapshot(), { ...noBody, complete: seam(), coverage: decided(pattern()) });
    // AND A PAGE WHOSE OWN WORDS ARE NOT ON FILE BUYS NO BODY COPY AT ALL (2026-08-30): the canonical editor judges what a section adds against the page it lands on, so with no page in hand there is nothing to judge against and nothing is written rather than written blind.
    expect([out.status, out.status === "none" && out.reason.includes("No opening for this page passed its own checks"), bought]).toEqual(["none", true, []]); });
  it("never reaches a drafter on evidence too thin to name a cause", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam() }); // no pattern, so no cause that needs one is even considered
    expect([out.status, bought, out.status === "none" && out.reason.includes("The results page for that search has not been read yet")]).toEqual(["none", [], true]); }); });
/** A DOOR ANSWERS FOR ITS OWN CASE: a page selected because an engine skipped it, whose answer I no longer hold, is refused in that door's words. The wrong reason is worse than no reason, and neither is drafted. */
/** A NEW PAGE EARNS THE SAME AUTHORIZATION AS A SECTION, OR IT STAYS INTERNAL. Coverage adjudication authorizes the NEED and the results pages the FORMAT; neither authorizes a sentence, so every piece of the finished page is written and ruled by the ONE canonical editor and every material claim rests on a checked source or another page this account owns. */
describe("a researched new page is authorized piece by piece", () => {
  const HEADS = ["Sizing a barrel to a roof", "Where the overflow goes", "Chaining a second barrel"];
  const BRIEF = { proposedTitle: "How rain barrel sizing works", metaDescription: "What size rain barrel a roof needs, and where the overflow goes once a storm has filled it right up.",
    openingAnswer: "A rain barrel is sized to the roof that feeds it, and the overflow needs somewhere to go once a storm fills it.",
    whyExistingPagesLose: `Your page ${URL} covers barrels in general and never sizes one, so stretching it would bury the answer.`,
    sections: HEADS.map((heading) => ({ heading, covers: "Answer this plainly for a reader.", evidenceKeys: ["demand"] })),
    sourceRequirements: [], factRequirements: [], internalLinks: [], faqQuestions: [], headKeys: ["demand"] };
  const pageSeam = (write = true): CompleteFn => async ({ kind, user }) => { bought.push(kind);
    if (kind === "new_page_brief") return { value: BRIEF as never };
    if (kind === "editor_judgement") return { value: JUDGED(cited(user)) as never };
    const heading = (/Write the section headed "(.*?)"/.exec(user) ?? [])[1] ?? BRIEF.proposedTitle;
    return { value: (write || heading !== HEADS[2] ? { field: "answer_block", before: null, after: ANSWER, naturalHeading: heading, placementAnchor: BRIEF.proposedTitle, claims: [{ text: "Barrel sizes vary.", supportedBy: [cited(user)] }], implementationMinutes: 15, rationale: "The page owes this section.", ...TAIL } : {}) as never }; };
  const topic: DecidedTopic = { investigation: investigation(), candidates: [candidate()], reading: null,
    decision: { verdict: "create_new", topicKey: "inv_rain", ownedUrls: [], evidenceKeys: ["demand"], missing: [],
      alternativesRuledOut: [{ alternative: "Strengthen a page you already have", reason: "No page of yours comes up for this at all." }], explanation: "No page of yours answers this, and the pages that win it agree on what one has to cover." } };
  it("writes and rules every piece against another page of this account, and refuses to hand over part of a page", async () => {
    const built = await buildNewPageProposal(topic, TENANT, { complete: pageSeam(), now: NOW, bypassCache: true });
    expect(built.status).toBe("built"); if (built.status !== "built") return; const p = built.proposal;
    expect(bought.filter((k) => k === "atomic_edit")).toHaveLength(4); // the opening and all three sections, through the ONE canonical editor and never a second drafter
    const kinds = p.bundle!.components.map((c) => c.kind), pieces = new Set(p.claims!.map((c) => c.of));
    expect([kinds, pieces.size]).toEqual([["title", "meta", "opening_answer", "section"], 2]); // the opening answers for the opening piece, every section for the section piece, and neither for the other
    expect(p.claims!.every((c) => c.supportedBy.every((id) => id.startsWith("owned-page")))).toBe(true);
    expect([evidenceShortfall(p), openHold(p).blocking], "a complete page whose every claim is carried earns the same verdict a section earns").toEqual([null, null]);
    const own = { ...p, claims: p.claims!.map((c) => ({ ...c, supportedBy: ["page-copy-1"] })) }; // the same page, every claim standing on the page's own drafted words, read and ruled exactly as it stands
    const unsupported = { ...own, semanticReview: { ...p.semanticReview!, of: copyKey(own), claims: p.semanticReview!.claims.map((r) => ({ ...r, by: ["page-copy-1"] })) } };
    expect(openHold(unsupported).blocking, "and a page standing on its own words alone stays internal").toContain("rests on nothing checked");
    expect(openHold(unsupported).need?.reasonCode, "carrying the exact source requirement the runtime already fetches").toBe("claim_unsupported");
    const partial = await buildNewPageProposal(topic, TENANT, { complete: pageSeam(false), now: NOW, bypassCache: true });
    expect([partial.status, partial.status === "none" && partial.reason.includes("still owed")]).toEqual(["none", true]); }); // part of a page is not worth handing over
});
describe("every door answers for its own evidence", () => {
  const DOOR = { door: "cannibalization" as "coverage_verdict" | "cannibalization" | "recent_decline", entry: "I gave this page my deepest read because two of your own pages come up for it.",
    evidence: { query: "rain barrel sizing", engine: null as string | null, promptText: null as string | null, competingUrls: [] as string[], window: null as string | null } };
  const refused = async (over: Partial<typeof DOOR>): Promise<string> => {
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam(), door: { ...DOOR, ...over } });
    return out.status === "none" ? out.reason : `expected a refusal, got ${JSON.stringify(out)}`;};
  it("names what THAT door is missing and never falls back to the click sentence", async () => {
    expect(await refused({ door: "cannibalization" })).toContain("which pages those are is not settled"); expect(await refused({ door: "recent_decline" })).toContain("one 90 day total");
    expect(await refused({ door: "coverage_verdict" })).toContain("named it as the page of yours to improve"); expect(await refused({ evidence: { ...DOOR.evidence, query: " " } })).toContain("no longer names the search it was about");
    for (const door of ["cannibalization", "recent_decline", "coverage_verdict"] as const) {
      expect(await refused({ door })).not.toMatch(/losing enough clicks|[–—]|experiment|control group|baseline|SERP/i);}
    expect(bought).toEqual([]); // a door that cannot show its own case never reaches a drafter
  }); });
describe("the wording cause keeps the path it has always had", () => {
  const SERP = { ...emptyResearchEvidence(), serpEvidence: [{ observedAt: null, query: "rain barrel sizing", aiOverview: [], aiMode: [], paa: [], related: [],
    organic: [{ rank: 1, domain: "gardenguide.example", url: "https://gardenguide.example/a", title: "Rain barrel sizing guide" },
      { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "Sizing a rain barrel by roof area" },
      { rank: 3, domain: "fixture-content.example", url: "https://fixture-content.example/rain-barrels", title: "Rain Barrels" }] }] };
  const titleSeam: CompleteFn = async ({ kind }) => { bought.push(kind); return { value: { field: "title", before: null, after: TITLE_AFTER, rationale: "The current copy does not say what the page answers.", ...TAIL } as never }; };
  it("produces the same title change, the same label, the same effort and the same risk as before", async () => {
    const out = await produceBundleForSnapshot(snapshot({ research: SERP }), { now: NOW, bypassCache: true, complete: titleSeam }); expect(out.status).toBe("bundled");
    if (out.status !== "bundled") return;
    const p = out.proposal; expect(p.bundle!.components.map((c) => c.kind)).toEqual(["title"]);
    expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "title", before: "Rain Barrels", after: TITLE_AFTER }); expect(p.opportunityType).toBe("Rewrite the page that already has the demand");
    expect([p.diagnosisCause, p.estimatedEffortMinutes, p.riskLevel, p.status]).toEqual(["ctr_snippet", 1, "low", "ready"]);
    expect(p.bundle!.risks[0]).toBe("Changing a title moves where the page ranks while search engines re-read it, so give this the full 28 days before you judge it.");
    expect(p.bundle!.risks[1]).toBe("This page's full body text is not on file, so read each line once before you paste it."); expect(bought).toEqual(["atomic_edit"]); });
  it("refuses a headline for a door that never measured a click, and buys nothing writing it", async () => {
    const door = { door: "coverage_verdict" as const, entry: "I gave this page my deepest read because my comparison named it.", evidence: { query: "rain barrel sizing", engine: null, promptText: null, competingUrls: [] as string[], window: null } };
    const out = await produceBundleForSnapshot(snapshot({ research: SERP }), { ...OPTS, complete: titleSeam, door, coverage: decided(pattern({ commonHeadings: [{ heading: "Rain barrel sizing", seenOn: [0, 1, 2] }], openingPattern: "" })) });
    expect(out.status === "none" && out.reason).toContain("coverage of what it is missing, not a new headline"); expect(bought).toEqual([]); }); });
/** A FALL IS A SIZE, NOT A LEVER (2026-08-13). The deep read never handed the ladder the two windows, so the ONE door opened on a fall re-diagnosed every fallen page as if nothing about it had been measured, and the cause it names carried a refusal where its producer belongs. Every lever is asked BY NAME now, nothing falls through to more copy, and the research card standing in for the change survives its own results page arriving instead of leaving the queue the day the evidence lands. */
describe("a page that slipped down the results", () => {
  const DECLINE = { clicksNow: 60, clicksPrior: 300, positionNow: 9.4, positionPrior: 4.1, impressionsNow: 6100, impressionsPrior: 6200 };
  const DOOR = { door: "recent_decline" as const, entry: "e", evidence: { query: "rain barrel sizing", engine: null, promptText: null, competingUrls: [] as string[], window: "the four weeks to 2026-07-28, against the four weeks before" } };
  const RES = { ...emptyResearchEvidence(), serpEvidence: [{ observedAt: null, query: "rain barrel sizing", aiOverview: [], aiMode: [], paa: [], related: [], organic: [{ rank: 1, domain: "gardenguide.example", url: "https://gardenguide.example/a", title: "Sizing a rain barrel" }, { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "Rain barrel sizing" }] }] };
  const fall = (over: Record<string, unknown> = {}) => produceBundleForSnapshot(snapshot({ research: RES }), { ...OPTS, complete: seam(), door: DOOR, decline: DECLINE, ...over });
  const FELL: CauseFinding = { cause: "ranking_loss", action: null, evidenceKeys: ["demand-exact"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "This page fell from position 4.1 to 9.4." };
  it("names the ONE page above it whose words are not on file, having ruled out every other lever, and the card for it outlives the results page landing", async () => {
    const out = await fall(); expect(out.status).toBe("none"); if (out.status !== "none") return;
    expect(out.reason).toBe('gardenguide.example sits at position 1 for "rain barrel sizing", above this page, and none of its words are on file, so what it does that this page does not cannot be named. Read https://gardenguide.example/a and the exact change lands here.');
    expect((out.considered ?? []).map((c) => c.option)).toEqual(["Settle which of your pages owns this search", "A sharper title or description", "Rebuild this page for what people searching it want", "Cover what the winning pages all cover", "Answer the search in this page's first lines"]);
    expect([out.considered!.map((c) => c.reason).join(" "), bought]).toEqual([expect.not.stringMatching(/write more|add more copy|[–—]/i), []]); // no lever the evidence could pick, so no drafter was ever paid
    // THE CARD SURVIVES THE EVIDENCE ARRIVING: it is gated on there being no card for this page, never on nobody having bought that search's results page.
    const cards = researchingCards({ tenantId: TENANT, now: NOW, basis: null, pages: [page()], judged: [{ cause: FELL, recoverableClicks: 240, pageUrl: URL, query: "rain barrel sizing", gap: "recent_decline" }], queryKeyOf: (q) => q, skip: new Set<string>(), serpQueryKeys: new Set(["rain barrel sizing"]), blocked: new Map([[URL, { reason: out.reason, considered: out.considered }]]) });
    expect([cards.length, cards[0]!.recommendedChange, cards[0]!.limitations[0], cards[0]!.operatorSteps![0]]).toEqual([1, { kind: "existing_edit", field: "section", before: null, after: out.reason }, "Nothing here is ready to paste: this card is research, not an edit.", out.reason]); });
  it("never requires a reading of a robots-blocked winner: the requirement moves to the next unread page instead of minting the same impossible acquisition forever", async () => {
    const RES2 = { ...RES, winningPages: [{ url: "https://gardenguide.example/a", domain: "gardenguide.example", engines: [], examplePrompts: [], appearances: [], extract: null,
      readOutcome: { state: "robots_blocked" as const, at: "2026-07-01T00:00:00.000Z", retryAfter: "2036-07-01T00:00:00.000Z" } }] };
    const out = await produceBundleForSnapshot(snapshot({ research: RES2 as never }), { ...OPTS, complete: seam(), door: DOOR, decline: DECLINE }); expect(out.status).toBe("none"); if (out.status !== "none") return;
    expect(out.requirement).toEqual({ kind: "competitor_page", query: "rain barrel sizing", url: "https://waterwise.example/b", reasonCode: "winner_unread" }); });
  it("writes the subject the winning pages agree on rather than refusing the fall, and the rejected levers travel with it", async () => {
    const out = await fall({ coverage: decided(pattern({ commonHeadings: [{ heading: "Gutter guards keep debris out", seenOn: [0, 1, 2] }] })) }); expect(out.status).toBe("bundled"); if (out.status !== "bundled") return;
    expect([out.proposal.diagnosisCause, out.proposal.bundle!.components.map((c) => c.kind)]).toEqual(["ranking_loss", ["section_add"]]);
    expect(out.proposal.bundle!.alternatives.map((a) => a.option)).toContain("A sharper title or description"); }); });
/** THIN IS RELATIVE TO THE AUDIENCE (operator, 2026-08-31). A flat 200-word line called /cities fine at 500 words on 28,847 impressions and /famous-iranian-comedians fine at 324 on 22,509: the two biggest content opportunities on the site, invisible because a constant said a stub is 200 words wherever it sits. Nothing here loosens the evidence floors that keep "add 1,200 words" from being advice: the stored results page is still required, and a quiet page still owes only the old floor. */
describe("a page owes the copy the search it already earns asks for, not a fixed word count", () => {
  const short = (url: string, imps: number, query: string): OwnedPageEvidence => ({
    url, content: { title: "Iranian comedians", metaDescription: null, h1: "Iranian comedians", h2: [], outline: ["Iranian comedians"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 324, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" },
    search: { clicks90d: 10, impressions90d: imps, ctr90d: 0.01, position90d: 8, topQueries: [{ query, impressions: imps, clicks: 10, position: 8 }] }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } });
  const serpFor = (queries: string[]) => ({ ...emptyResearchEvidence(), serpEvidence: queries.map((query) => ({ observedAt: null, query, aiOverview: [], aiMode: [], paa: [], related: [], organic: [{ rank: 1, domain: "rival.example", url: "https://rival.example/a", title: "Comedians" }] })) });
  const run = async (over: Partial<EvidenceSnapshot>) => { vi.resetModules();
    vi.doMock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadChangeProposals: async () => new Map() })); // an EMPTY queue, not an unreadable one: this producer emits nothing at all when it cannot see what the account already holds
    return (await import("@/domains/decision/producers/extra")).extraQueueCards({ tenantId: TENANT, snapshot: snapshot(over) as never, now: NOW, reads: { left: 0 }, persist: false }); };
  it("names the 324-word page a heavy search already found, leaves the quiet one alone, and still refuses both without a stored results page", async () => {
    const heavy = short("https://fixture-content.example/comedians", 22_509, "iranian comedians"), quiet = short("https://fixture-content.example/philosophers", 400, "iranian philosophers");
    const out = await run({ ownedPages: [heavy, quiet], research: serpFor(["iranian comedians", "iranian philosophers"]) as never });
    const thin = out.cards.filter((c) => c.id.endsWith("thin_page")).map((c) => c.pagePath);
    expect(thin, "324 words is a stub under a search seen 22,509 times and an ordinary page under one seen 400 times, and only the first is offered").toEqual(["/comedians"]);
    const blind = await run({ ownedPages: [heavy, quiet], research: emptyResearchEvidence() as never });
    expect(blind.cards.filter((c) => c.id.endsWith("thin_page")), "with no results page on file there is no shape to hand over, so the higher floor buys nothing: 'add more words' stays unsayable").toEqual([]); });
});
