/** THE CAUSE PRODUCERS (V1 Closure, launch blocker 9). Beacon could name fifteen reasons a page loses a click
 *  and write copy for exactly one of them. These pin the other half: a named cause reaches a producer, the
 *  producer works off the structure the ladder actually read, every component it emits survives the REAL
 *  validator, a cause with no producer refuses in its own words, a drafter that will not land is a refusal
 *  rather than an empty component, and thin evidence never reaches a drafter at all. The wording cause keeps
 *  the path it has always had, byte for byte. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EvidenceSnapshot, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import type { TopicInvestigation } from "@/domains/evidence/topic-investigation";
import type { OwnedCandidate } from "@/domains/decision/owned-coverage";
import type { DecidedTopic } from "@/domains/decision/coverage-pass";
import type { WinningPattern } from "@/domains/decision/winning-pattern";
import { validateProposal } from "@/domains/decision/validate-proposal";
import { deserializeChangeProposal, serializeChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";

vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
import { produceBundleForSnapshot, type OwnedBody } from "@/domains/decision/produce-bundle";

const TENANT = "fixture-tenant";
const NOW = new Date("2026-08-01T00:00:00.000Z");
const URL = "fixture-content.example/rain-barrels";
const OPENING = "Collecting water at home starts with knowing what one storm actually brings you.";

// ── the drafted answers the seam hands back, each grounded in words the evidence already carries ──
const SECTION = { heading: "Rain barrel overflow",
  body: "Rain barrel sizing comes down to your roof area and how much rain one storm brings. The wider the roof, the faster a barrel fills, so the overflow has to go somewhere before it pools against the house. A hose from the overflow outlet into a second barrel keeps the water off the wall, and you can check it after the first heavy storm.",
  sources: [{ kind: "own_data", detail: "your own search data for this page" }], containsNumber: false };
const ANSWER = "Rain barrel sizing depends on your roof area and the rain one storm brings. The bigger the roof, the faster a barrel fills, so pick one that holds what a heavy storm delivers and plan where the overflow goes.";
const TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Paste the copy"],
  proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };
const TITLE_AFTER = "Rain barrel sizing: gallons per storm by roof area";

/** Records every draft kind bought, so "spent nothing" is provable rather than assumed. */
const bought: string[] = [];
const seam = (over: { section?: unknown; atomic?: unknown } = {}): CompleteFn => async ({ kind }) => {
  bought.push(kind);
  if (kind === "section_draft") return { value: (over.section ?? SECTION) as never };
  return { value: (over.atomic ?? { field: "answer_block", before: null, after: ANSWER, rationale: "The opening never says what the search is about.", ...TAIL }) as never };
};

const page = (over: Partial<OwnedPageEvidence> = {}): OwnedPageEvidence => ({
  url: URL,
  content: { title: "Rain Barrels", metaDescription: null, h1: "Rain Barrels", h2: [], outline: ["Rain barrel sizing", "Roof area and gallons"],
    schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" },
  search: { clicks90d: 120, impressions90d: 9000, ctr90d: 0.013, position90d: 3,
    topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 90, position: 3 }] },
  engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] }, ...over });

const snapshot = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  scope: { tenantId: TENANT, site: "fixture-content.example", builtAt: NOW.toISOString() },
  aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 },
  sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [], contentGaps: [],
  internalLinkOpportunities: [], evidenceHash: "fixture", research: emptyResearchEvidence(), ownedPages: [page()], ...over });

const BODY: ReadonlyMap<string, OwnedBody> = new Map([["fixture-content.example/rain-barrels", {
  openingSample: OPENING, fetchedAt: "2026-07-20T00:00:00.000Z", cardTexts: ["Roof area and gallons"], entityNames: [],
  internalLinks: [], metaDescription: null }]]);

const pattern = (over: Partial<WinningPattern> = {}): WinningPattern => ({
  archetype: "informational_guide", commonHeadings: [{ heading: "Sizing by roof area", seenOn: [0, 1, 2] }], commonEntities: [],
  questionsAnswered: [], openingPattern: "they answer the sizing question in the first line", disagreements: [], ownedGaps: [], uniqueNotCommon: [],
  winners: 3, publishers: ["gardenguide.example", "waterwise.example", "downspout.example"], fingerprint: "abc123", ...over });

const candidate = (): OwnedCandidate => ({ url: URL, path: "/rain-barrels", title: "Rain Barrels", h1: "Rain Barrels", wordCount: 900,
  outlineLength: 2, openingSample: OPENING, entities: [], fetchedAt: null, bodyHeld: true, strongSignals: 1,
  signals: [{ kind: "gsc_exact_query", strength: "strong", basis: "rain barrel sizing", detail: "Google already shows this page for that search." }] });

const investigation = (): TopicInvestigation => ({ key: "inv_rain", aliasKeys: [], label: "rain barrel sizing", demandBasis: "search", groupedBy: [],
  queries: ["rain barrel sizing"], keywords: [], trackedPrompts: [], fanOuts: [], exactSerps: [], serpFreshness: "current",
  demand: { monthlySearchVolume: 4400, queriesWithVolume: 1, gscImpressions: 6000, difficulty: null, intent: "informational", trackedPrompts: 0, fanOuts: 0, engines: [] },
  distinctResultDomains: 8, resultDomains: [], pageType: "informational_guide", pageTypeVotes: [], serpCoherence: "coherent",
  winners: [], distinctWinners: 3, currentReadableWinners: 3, missingEvidence: [] });

const decided = (p: WinningPattern | null): DecidedTopic => ({
  investigation: investigation(), candidates: [candidate()], reading: null,
  decision: { verdict: "improve_existing", topicKey: "inv_rain", ownedUrls: [URL], evidenceKeys: ["demand"], missing: [],
    alternativesRuledOut: [{ alternative: "Write a new page for this", reason: "Your own page already answers this search." }],
    explanation: "I would sharpen the page you already have rather than add another that competes with it.",
    ...(p ? { pattern: p } : {}) } });

const OPTS = { now: NOW, bypassCache: true, bodyByUrl: BODY };
beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; bought.length = 0; });
afterEach(() => { delete process.env.OPENAI_API_KEY; });

describe("a named cause produces the change that fixes it", () => {
  it("writes the opening the page never had, and it survives the real validator", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam(), coverage: decided(pattern()) });
    expect(out.status).toBe("bundled");
    if (out.status !== "bundled") return;
    const p = out.proposal; const b = p.bundle!;
    expect(p.diagnosisCause).toBe("weak_opening"); // the REAL fired cause, never the hardcoded wording one
    expect(b.components.map((c) => c.kind)).toEqual(["opening_answer"]);
    expect(b.components[0]!.before).toBe(OPENING);
    expect(b.components[0]!.after).toBe(ANSWER);
    expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "answer_block", before: OPENING, after: ANSWER });
    expect(p.opportunityType).toBe("Answer the search in the page's first lines");
    // every cited key is a receipt line the operator can actually read
    const keys = new Set(b.receipt.items.map((i) => i.key));
    expect(b.components[0]!.evidenceKeys.length).toBeGreaterThan(0);
    for (const k of b.components[0]!.evidenceKeys) expect(keys.has(k)).toBe(true);
    // THROUGH THE REAL VALIDATOR, not a mock of it, and a round trip through the one decoder
    expect(validateProposal(p, { evidenceText: b.receipt.items.map((i) => i.fact).join(" ") }).verdict).not.toBe("rejected");
    expect(deserializeChangeProposal(serializeChangeProposal(p))).toEqual(p);
    expect([b.objective, b.measurementPlan, ...b.risks, ...b.components.map((c) => `${c.label} ${c.after} ${c.where} ${c.objective} ${c.mechanism}`)].join(" ")).not.toMatch(/[–—]|experiment|control group|baseline|SERP/i);
  });

  it("writes one section per subject the winning pages agree on and this page leaves out, each answering for itself", async () => {
    const p2 = pattern({ commonHeadings: [{ heading: "Overflow hoses in a storm", seenOn: [0, 1, 2] }, { heading: "Chaining a container", seenOn: [0, 1] }] });
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam(), coverage: decided(p2) });
    expect(out.status).toBe("bundled");
    if (out.status !== "bundled") return;
    const b = out.proposal.bundle!;
    expect(out.proposal.diagnosisCause).toBe("incomplete_coverage");
    expect(b.components.map((c) => c.kind)).toEqual(["section_add", "section_add"]);
    // section_add is OUTSIDE the grandfathered kinds, so all four answers are owed or the validator rejects the whole change
    for (const c of b.components) {
      expect(c.where).toBeTruthy(); expect(c.objective).toBeTruthy(); expect(c.mechanism).toBeTruthy(); expect(c.measurementPlan).toBeTruthy();
      expect(c.after).toContain(SECTION.body);
    }
    expect(validateProposal(out.proposal, { evidenceText: b.receipt.items.map((i) => i.fact).join(" ") }).verdict).not.toBe("rejected");
    expect(bought.filter((k) => k === "section_draft")).toHaveLength(2); // one call per section, never a third
  });

  it("refuses honestly when the drafter will not land, and ships no empty component", async () => {
    const blind = seam({ atomic: {} });
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: blind, coverage: decided(pattern()) });
    expect(out.status).toBe("none");
    if (out.status !== "none") return;
    expect(out.reason).toBe("I could not write an opening for this page that passes my own checks, so I am handing you nothing rather than filler.");
    expect(bought).toEqual(["atomic_edit", "atomic_edit"]); // it tried, and the retry is the drafter's own, not a second change
  });

  it("says why it is producing nothing for a cause no copy can fix, in the ladder's own words", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam(), coverage: decided(pattern()), measuringPagePaths: ["/rain-barrels"] });
    expect(out.status).toBe("none");
    if (out.status !== "none") return;
    expect(out.reason).toBe("The change you applied here is still being measured, so I am not stacking another one on top of it.");
    expect(bought).toEqual([]); // a cause with no producer costs nothing
  });

  it("never reaches a drafter on evidence too thin to name a cause", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { ...OPTS, complete: seam() });
    expect(out.status).toBe("none");
    if (out.status !== "none") return;
    expect(bought).toEqual([]); // no pattern, so no cause that needs one is even considered
    expect(out.reason).toContain("I have not looked at the results page for that search yet");
  });
});

describe("the wording cause keeps the path it has always had", () => {
  const SERP = { ...emptyResearchEvidence(), serpEvidence: [{ observedAt: null, query: "rain barrel sizing", aiOverview: [], aiMode: [], paa: [], related: [],
    organic: [{ rank: 1, domain: "gardenguide.example", url: "https://gardenguide.example/a", title: "Rain barrel sizing guide" },
      { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "Sizing a rain barrel by roof area" },
      { rank: 3, domain: "fixture-content.example", url: "https://fixture-content.example/rain-barrels", title: "Rain Barrels" }] }] };
  const titleSeam: CompleteFn = async ({ kind }) => { bought.push(kind); return { value: { field: "title", before: null, after: TITLE_AFTER, rationale: "The current copy does not say what the page answers.", ...TAIL } as never }; };

  it("produces the same title change, the same label, the same effort and the same risk as before", async () => {
    const out = await produceBundleForSnapshot(snapshot({ research: SERP }), { now: NOW, bypassCache: true, complete: titleSeam });
    expect(out.status).toBe("bundled");
    if (out.status !== "bundled") return;
    const p = out.proposal;
    expect(p.bundle!.components.map((c) => c.kind)).toEqual(["title"]);
    expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "title", before: "Rain Barrels", after: TITLE_AFTER });
    expect(p.opportunityType).toBe("Rewrite the page that already has the demand");
    expect([p.diagnosisCause, p.estimatedEffortMinutes, p.riskLevel, p.status]).toEqual(["ctr_snippet", 1, "low", "proposed"]);
    expect(p.bundle!.risks[0]).toBe("Changing a title moves where the page ranks while search engines re-read it, so give this the full 28 days before you judge it.");
    expect(p.bundle!.risks[1]).toBe("I do not hold this page's full body text, so read each line once before you paste it.");
    expect(bought).toEqual(["atomic_edit"]);
  });
});
