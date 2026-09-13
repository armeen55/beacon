/** Real call accounting: cold calls cost attempts; validated cache reuse and pre-network refusal do not. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
const CACHE_ROWS = new Map<string, unknown>();
vi.mock("@/domains/decision/llm/call-cache", async (orig) => {
  const actual = await orig<typeof import("@/domains/decision/llm/call-cache")>();
  return { ...actual, resolveCacheImpl: () => ({
    read: async (_t: string, k: string) => (CACHE_ROWS.get(k) as never ?? null),
    write: async (_t: string, e: { key: string; value: unknown }) => { CACHE_ROWS.set(e.key, e); }, recentTexts: async () => [] }) };
});
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => null, basisTag: () => "basis_test" }));
import { draftFieldForPage } from "@/domains/decision/drafted-copy";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { extractPageFacts, readWinningPattern } from "@/domains/decision/winning-pattern";
import { proposeExistingPageChange } from "@/domains/decision/propose";
import { buildNewPageProposal } from "@/domains/decision/new-page";
import { produceBundleForSnapshot } from "@/domains/decision/produce-bundle";
import type { EvidenceInput } from "@/domains/decision/contracts";
import type { EvidenceSnapshot, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import type { DecidedTopic } from "@/domains/decision/coverage-pass";
import { readComparison } from "@/domains/decision/llm/structured-drafter";
import { jobComparison } from "@/domains/evidence/comparison";
import { FACTUAL_DEFECTS } from "@/domains/decision/producers/factual-defects";
const NOW = new Date("2026-09-06T00:00:00.000Z");
const SITES = [
  { t: "tenant-one", url: "https://alpha.example/rain-barrels", q: "rain barrel sizing", title: "Rain Barrels", h1: "Rain Barrels", heads: ["Sizing a barrel", "Overflow"],
    lines: ["A rain barrel fills from the roof area above it, so a wide roof fills one barrel in a single storm.", "An overflow hose carries the surplus away from the wall once the barrel is full."],
    line: "A rain barrel fills from the roof area above it, and an overflow hose carries the surplus away from the wall.", gap: "Winter storage" },
  { t: "tenant-two", url: "https://beta.example/masa", q: "como se nixtamaliza el maiz", title: "Masa de maiz", h1: "Masa de maiz", heads: ["Nixtamal", "Molienda"],
    lines: ["El maiz se cuece con cal y reposa toda la noche antes de lavarlo y escurrirlo.", "La molienda en piedra deja una masa fina que se amasa a mano."],
    line: "El maiz se cuece con cal y reposa toda la noche, y la molienda en piedra deja una masa fina.", gap: "Conservacion del producto" },
];
type Site = (typeof SITES)[number];
const bodyOf = (s: Site) => ({ url: s.url, title: s.title, h1: s.h1, metaDescription: null, vocabulary: "", headings: s.heads, passages: s.lines, completeness: "complete" as const, contentHash: "h", fetchedAt: NOW.toISOString() });
const TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };
const draft = (s: Site, cites = "page-copy-1") => ({ field: "meta", before: null, after: s.line, rationale: "The page carries no description of its own.", placementAnchor: s.title, naturalHeading: null, claims: [{ text: s.lines[0]!, supportedBy: [cites] }], ...TAIL });
const VERDICT = { pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, contested: false, notes: "it names the roof area and the overflow, which the heading alone does not.", resolution: "none", claims: [{ i: 0, by: ["page-copy-1"], entailed: true }] };
const READING_USD = 0.0091;
const funded = (s: Site) => { const key = DRAFT_BUDGET.keyOf({ pageUrl: s.url }), budget = DRAFT_BUDGET.plan({ jobs: [{ key, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 });
  return { key, budget, allowance: budget.draw(key, DRAFT_BUDGET.DELIVERABLE_CALLS)! }; };
describe("what one attempt pays for", () => {
  const pass = async (s: Site, brief: string, allowance: { left: number }, value: Record<string, unknown>) => { let bought = 0;
    const piece = await draftFieldForPage({ field: "meta", body: bodyOf(s) as never, query: s.q, brief, evidenceHints: [], ownedPaths: [new URL(s.url).pathname], minutes: 3 }, { tenantId: s.t, now: NOW, attempts: allowance as never,
      complete: (async ({ user }: { user: string }) => { const reading = user.includes("THE COPY:"); if (reading) bought += 1; return { value: reading ? VERDICT : value, httpAttempts: 1, provenance: { costUsd: READING_USD } }; }) as never });
    return { piece, readings: bought }; };
  it.each(SITES)("$t: a reading that reached a provider costs one attempt, and the same reading served from the cache costs none", async (s) => {
    CACHE_ROWS.clear();
    const first = funded(s), before = first.allowance.left, real = await pass(s, "Write the description for this page.", first.allowance, draft(s));
    expect([real.piece?.after, real.readings, before - first.allowance.left, first.budget.meterOf(first.key)!.providerCalls],
      "one draft and one reading, both of them calls that left the process, both off this page's own allowance").toEqual([s.line, 1, 2, 2]);
    const second = funded(s), start = second.allowance.left, hit = await pass(s, "Write the description for this page now.", second.allowance, draft(s));
    expect([hit.piece?.after, hit.readings, start - second.allowance.left, second.budget.meterOf(second.key)!.providerCalls],
      "the brief moved so the writing is bought again and the copy did not, so the reading is served from the cache: the row keeps that attempt and its meter records no provider call for it").toEqual([s.line, 0, 1, 1]); });
  it.each(SITES)("$t: a refusal this page's own packet makes for free buys no reading, and the attempt it did not spend still pays for one", async (s) => {
    CACHE_ROWS.clear();
    const { key, budget, allowance } = funded(s), before = allowance.left, refused = await pass(s, "Write the description for this page.", allowance, draft(s, "fact-9"));
    const onWriting = before - allowance.left;
    expect([refused.piece, refused.readings, onWriting > 0, allowance.left > 1],
      "copy citing evidence nobody handed it is refused before any reading, nothing was paid to read it, and the allowance still holds enough to buy one").toEqual([null, 0, true, true]);
    const at = allowance.left, done = await pass(s, "Write the description for this page in one line.", allowance, draft(s));
    expect([done.piece?.after, done.readings, at - allowance.left, budget.meterOf(key)!.providerCalls],
      "the next pass affords the reading it was never charged for: one draft, one reading, and every call that left the process on this page's own meter").toEqual([s.line, 1, 2, onWriting + 2]); });
});

const host = (s: Site): string => new URL(s.url).host, path = (s: Site): string => new URL(s.url).pathname;
const winners = (s: Site) => extractPageFacts([1, 2, 3].map((n) => ({ url: `https://w${n}.example${path(s)}`, domain: `w${n}.example`,
  extract: { title: `${s.q}`, h1: `${s.q}`, wordCount: 1200, headings: [...s.heads, "What to do first"], faqCount: 2, openingSample: s.lines[0]!, entityNames: [s.title], hasList: true, hasTable: false } })) as never);
const PATTERN = (s: Site) => ({ archetype: "informational_guide", commonHeadings: s.heads.map((h) => ({ heading: h, seenOn: [0, 1, 2] })), commonEntities: [{ entity: s.title, seenOn: [0, 1] }],
  questionsAnswered: [s.q], openingPattern: "Each of them answers the question in its first sentence before it explains anything else.", ownedGaps: [], disagreements: [], uniqueNotCommon: [] });
const EDIT = (s: Site) => ({ field: "title", before: s.title, after: `${s.title}: ${s.q}`, confidence: "high", rationale: "The current line never says what the search asks for.",
  risks: ["keep the line short"], evidenceRefs: [{ source: "gsc", detail: "views without clicks on that search" }], operatorSteps: ["Replace the page title"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } });
const BRIEF = (s: Site) => ({ proposedTitle: `${s.title}: ${s.q}`, metaDescription: s.line, openingAnswer: s.lines[0]!, whyExistingPagesLose: `Every page that wins ${s.q} answers it outright and no page of yours does.`,
  sections: [...s.heads, "What to do first"].map((heading) => ({ heading, covers: "Answer this plainly for a reader who has never done it.", evidenceKeys: ["verdict"] })), sourceRequirements: [], factRequirements: [], internalLinks: [], faqQuestions: [], headKeys: ["verdict"] });
const INPUT = (s: Site): EvidenceInput => ({ tenantId: s.t, page: { path: path(s), url: s.url, label: s.title }, sizing: { impactScore: 80, upsidePerMonth: 45 },
  opportunity: { query: s.q, kind: "existing_edit", field: "title", opportunityType: "Capture clicks", currentValue: s.title, intent: "what" },
  evidence: { hints: [`Search Console shows steady demand for ${s.q}`], outline: s.heads, diagnosis: { status: "diagnosed", cause: "snippet_intent_mismatch", action: "title", evidenceKeys: ["demand-exact", "copy-current"],
    explanation: "The results page shows the line does not say what the search asks.", alternativesRuledOut: [{ alternative: "The words are already shown", reason: "They are not.", evidenceKeys: ["copy-current"] }] } } });
const ownedPage = (s: Site): OwnedPageEvidence => ({ url: s.url, content: { title: s.title, metaDescription: null, h1: s.h1, h2: [], outline: s.heads, schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-09-01T00:00:00.000Z" },
  search: { clicks90d: 120, impressions90d: 9000, ctr90d: 0.013, position90d: 3, topQueries: [{ query: s.q, impressions: 6000, clicks: 90, position: 3 }] }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } });
const SNAPSHOT = (s: Site): EvidenceSnapshot => ({ scope: { tenantId: s.t, site: host(s), builtAt: NOW.toISOString() }, aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, sources: [], competitors: [],
  keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], evidenceHash: "fixture", ownedPages: [ownedPage(s)],
  research: { ...emptyResearchEvidence(), retainedKeywords: [{ query: s.q, searchVolume: 4400, competition: 0.2, competitionLevel: "low", difficulty: null, intent: "informational" }],
    serpEvidence: [{ observedAt: READ_ON, query: s.q, organic: [{ rank: 1, domain: "w1.example", url: `https://w1.example${path(s)}`, title: s.q }, { rank: 2, domain: "w2.example", url: `https://w2.example${path(s)}`, title: s.q },
      { rank: 3, domain: host(s), url: s.url, title: s.title }], aiOverview: [], aiMode: [], paa: [], related: [] }] } as never });
const TOPIC = (s: Site): DecidedTopic => ({ investigation: { key: `inv-${s.t}`, aliasKeys: [], label: s.q, demandBasis: "search", groupedBy: [], queries: [s.q], keywords: [],
    demand: { monthlySearchVolume: 900, queriesWithVolume: 1, gscImpressions: null, difficulty: 20, intent: "informational", trackedPrompts: 1, fanOuts: 1, engines: ["chatgpt"] },
    trackedPrompts: [{ promptId: "p1", promptText: s.q, engine: "chatgpt" }], fanOuts: [{ query: s.q, observationId: "obs-1", observedAt: READ_ON }],
    answerIntel: { answers: 0, observationIds: [], latestObservedAt: null, competitors: [], contentTypes: [], omissions: [], sections: [], claims: [], caveats: [] },
    exactSerps: [{ query: s.q, observedAt: READ_ON, freshness: "current", organicResults: 10, distinctDomains: 8, aiOverviewCitations: 0, aiModeCitations: 0, paaQuestions: 3, organicRows: [], aiOverviewRows: [], aiModeRows: [] }],
    serpFreshness: "current", distinctResultDomains: 8, resultDomains: ["w1.example", "w2.example", "w3.example"], pageType: "informational_guide", pageTypeVotes: [], serpCoherence: "coherent",
    winners: [1, 2, 3].map((n) => ({ url: `https://w${n}.example${path(s)}`, domain: `w${n}.example`, extractState: "current", wordCount: 900, headings: 6, fetchedAt: READ_ON, appearances: [] })),
    distinctWinners: 3, currentReadableWinners: 3, missingEvidence: [], nextAcquisition: null, diminishing: false } as never,
  candidates: [], decision: { verdict: "create_new", topicKey: `inv-${s.t}`, ownedUrls: [], evidenceKeys: ["verdict"], missing: [],
    alternativesRuledOut: [{ alternative: "Stretch a page you own", reason: "No page of yours answers this one." }], explanation: `Nothing you own comes up for "${s.q}".` } as never, reading: null });
const READ_ON = "2026-09-01T00:00:00.000Z";
const RIVAL = (s: Site): string => `${s.lines[1]!} ${s.heads[1]!} is the part most pages leave out, and it decides what a reader does next.`;
const COMPARE = (s: Site) => jobComparison({ serpEvidence: [{ query: s.q, observedAt: null, organic: [{ rank: 1, url: `https://w1.example${path(s)}`, domain: "w1.example", title: null }], aiOverview: [], aiMode: [], paa: [], related: [] }],
  winningPages: [{ url: `https://w1.example${path(s)}`, domain: "w1.example", engines: [], examplePrompts: [], appearances: [{ query: s.q }],
    extract: { title: s.q, h1: null, wordCount: 2100, headings: [s.gap], faqCount: 0, entityNames: [], hasList: false, hasTable: false, mainText: RIVAL(s), truncated: false, heldChars: RIVAL(s).length, totalChars: RIVAL(s).length, h3s: [], schemaTypes: [] } }] } as never,
  [s.q], { url: s.url, text: `${s.heads.join(" ")} ${s.lines.join(" ")}`, headings: s.heads, passages: s.lines });
const SEEN = (s: Site) => ({ observations: [{ winner: `https://w1.example${path(s)}`, kind: "covers", text: `it gives ${s.gap} a section and this page has none`, quote: s.gap }] });
const CARD = (s: Site) => ({ id: `${s.t}::${path(s)}::existing_edit::factual`, tenantId: s.t, pagePath: path(s), status: "needs_review",
  recommendedChange: { kind: "existing_edit", field: "section", where: s.heads[0]!, before: s.lines[0]!, after: s.line },
  claims: [{ text: s.line, supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: s.lines[0]! }] }) as never;
const RULED = (_s: Site) => ({ rulings: [{ index: 0, publish: true, reason: "the replacement matches the passage behind it", claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "the passage carries the corrected meaning" }] }] });

const doorSeam = (s: Site, only: string) => { const made: string[] = [];
  return { made, complete: (async ({ kind }: { kind: string }) => { made.push(kind); if (kind !== only) return { error: "not this door", retryable: false };
    return { value: kind === "winning_pattern" ? PATTERN(s) : kind === "new_page_brief" ? BRIEF(s) : kind === "competitor_comparison" ? SEEN(s) : kind === "factual_review" ? RULED(s) : EDIT(s), httpAttempts: 1, provenance: { costUsd: 0.004 } }; }) as never }; };
type Allowance = { left: number; record?: (r: unknown) => void };
const DOORS = [
  { door: "the winners reading", kind: "winning_pattern", cost: 1, run: (s: Site, a: Allowance, c: unknown) => readWinningPattern(winners(s), null, s.t, { complete: c as never, now: NOW, label: s.q, attempts: a }) },
  { door: "the headline draft in propose", kind: "atomic_edit", cost: 1, run: (s: Site, a: Allowance, c: unknown) => proposeExistingPageChange(INPUT(s), { complete: c as never, now: NOW, attempts: a }) },
  { door: "the new page brief", kind: "new_page_brief", cost: 1, run: (s: Site, a: Allowance, c: unknown) => buildNewPageProposal(TOPIC(s), s.t, { complete: c as never, now: NOW, attempts: a, site: host(s) }) },
  { door: "the headline draft in the bundle", kind: "atomic_edit", cost: 1, run: (s: Site, a: Allowance, c: unknown) => produceBundleForSnapshot(SNAPSHOT(s), { complete: c as never, now: NOW, attempts: a }) },
  { door: "the comparison reading", kind: "competitor_comparison", cost: 1, run: (s: Site, a: Allowance, c: unknown) => { a.left -= 1;
    return readComparison(COMPARE(s), { url: s.url, passages: s.lines }, { tenantId: s.t, now: NOW, complete: c as never, attempts: a }); } },
  { door: "the correction review", kind: "factual_review", cost: 1, run: (s: Site, a: Allowance, c: unknown) => FACTUAL_DEFECTS.review([CARD(s)], { tenantId: s.t, now: NOW, complete: c, attempts: a }) },
] as const;
describe("what one attempt pays for at every paid door", () => {
  const twice = async (s: Site, kind: string, run: (s: Site, a: Allowance, c: unknown) => Promise<unknown>) => {
    CACHE_ROWS.clear(); const took = [] as { made: number; attempts: number; calls: number }[];
    for (const _pass of [0, 1]) { const f = funded(s), before = f.allowance.left, seam = doorSeam(s, kind);
      await run(s, f.allowance as Allowance, seam.complete);
      took.push({ made: seam.made.filter((k) => k === kind).length, attempts: before - f.allowance.left, calls: f.budget.meterOf(f.key)?.providerCalls ?? 0 }); }
    return [took[0]!.made, took[1]!.made, took[0]!.attempts - took[1]!.attempts, took[0]!.calls - took[1]!.calls]; };
  it.each(DOORS.flatMap((d) => SITES.map((s) => ({ ...d, ...s }))))(
    "$door, $t: a call that left the process costs one attempt and the same answer served from the cache costs none",
    async (c) => { expect(await twice(c, c.kind, c.run),
      "the cold pass made this door's call and the warm pass was served it at $0, so the warm pass keeps exactly the attempt and the provider call the cache saved").toEqual([c.cost, 0, c.cost, c.cost]); });
});
