/** DECISION kernel outcomes: what the evidence justifies BEFORE anything is drafted, then generate -> validate -> rank -> persist -> REUSE, and fail-closed rejections. Each test name states its promise. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} })); // Budget is not this file's subject: always-allowed, no-op hermetic seam.
const env = vi.hoisted(() => ({ snap: null as unknown, saved: [] as ChangeProposal[], store: new Map<string, ChangeProposal>(), withdrawn: [] as string[], failWrites: false, failIds: new Set<string>(), refuseIds: new Set<string>(), withdrawnIds: new Set<string>(), bundleTarget: null as string | null, bundle: null as unknown, realBundle: false, ledger: [] as unknown[], door: null as { door: string; evidence: { query: string | null } } | null }));
const fenv = vi.hoisted(() => ({ cards: null as null | unknown[], review: null as null | ((c: readonly unknown[]) => readonly unknown[]) })); vi.mock("@/domains/measurement/proof-gsc/load-ledger", () => ({ loadProofLedgerPersisted: async () => env.ledger, loadProofLedgerCached: async () => env.ledger })); // THE SHIPMENT LEDGER BOTH RANKING DOORS EAT, in the test's own hands: the real read reaches Supabase, fails soft to nothing, and would leave this account's track record unpinnable
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...((await orig()) as object), // Keyed the way the producer reads it (canonical, so a stored row and a full address are one page), or the page's own words are silently dropped.
  loadOwnedPageBodies: async (_t: string, urls: string[]) => new Map(urls.filter((u) => !u.includes("unreadable"))
    .flatMap((u) => [u, u.replace(/^https?:\/\//, "").replace(/\/+$/, "")].map((k) => [k, { url: u, title: "T", h1: null, metaDescription: null, headings: [], passages: ["A haft seen table is the spread a household sets out for the new year."], openingSample: "A haft seen table is the spread a household sets out for the new year.", vocabulary: "A haft seen table is the spread a household sets out for the new year.", cardTexts: [], faqs: [], entityNames: [], internalLinks: [], fetchedAt: "2026-07-25T00:00:00.000Z", completeness: "complete", contentHash: null, heldNote: "" }] as const))) }));
vi.mock("@/domains/decision/proposal-store", async () => { const actual = await vi.importActual<typeof import("@/domains/decision/proposal-store")>("@/domains/decision/proposal-store");
  return { ...actual, loadChangeProposals: async () => env.store, withdrawnProposalIds: async () => env.withdrawnIds, // The canonical store's OWN rule, emulated: a proposal identical to the stored row writes nothing at all.
    withdrawChangeProposal: async (p: ChangeProposal) => { env.withdrawn.push(p.id); env.store.delete(p.id); return true; }, saveChangeProposal: async (p: ChangeProposal) => { const prior = env.store.get(p.id); if (prior && actual.proposalFingerprint(prior) === actual.proposalFingerprint(p)) return "unchanged";
    if (env.refuseIds.has(p.id)) return "refused"; env.saved.push(p); if (env.failWrites || env.failIds.has(p.id)) return "failed"; env.store.set(p.id, p); return "saved"; } }; });
vi.mock("@/domains/decision/produce-bundle", async () => { const actual = await vi.importActual<typeof import("@/domains/decision/produce-bundle")>("@/domains/decision/produce-bundle");
  return { ...actual, produceBundleForSnapshot: async (s: never, o: { onlyPageUrl?: string | null; door?: never }) => { env.bundleTarget = o?.onlyPageUrl ?? null; env.door = (o?.door ?? null) as typeof env.door;
    return env.realBundle ? actual.produceBundleForSnapshot(s, o) : env.bundle ?? { status: "none", reason: "pinned in change-bundle.test" }; } }; });
vi.mock("@/domains/decision/producers/factual-defects", async (orig) => { const real = await orig() as typeof import("@/domains/decision/producers/factual-defects");
  return { ...real, FACTUAL_DEFECTS: { cards: async (w: Parameters<typeof real.FACTUAL_DEFECTS.cards>[0]) => fenv.cards ? { cards: fenv.cards as never, complete: true } : real.FACTUAL_DEFECTS.cards(w), review: async (cards: never, w: never) => fenv.review ? fenv.review(cards) as never : real.FACTUAL_DEFECTS.review(cards, w) } }; });
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "fixture-tenant", domain: "fixture-outdoors.example", growth_goal: null }), basisTag: () => "basis_test" }));
import { proposeExistingPageChange } from "@/domains/decision/propose";
import { convertSectionToSchema, validateProposal } from "@/domains/decision/validate-proposal";
import { rankProposals, proposalValueScore } from "@/domains/decision/rank-proposals";
import { actionFamilyOf } from "@/domains/measurement/proof-gsc/change-family";
import { fitTenantCtrCurve, defaultExpectedCtrAt } from "@/domains/evidence/forecast/tenant-ctr-curve";
import { compileCandidates, snapshotToEvidenceInputs } from "@/domains/decision/opportunities"; import { suggestedEdits } from "@/domains/decision/suggested-edits";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals"; import { chooseInvestigation, comparisonForFocus, focusReads } from "@/domains/runtime/ops/investigation-queries";
import { reconcileResearchCases } from "@/domains/evidence/topic-investigation";
const queued = async (tenantId: string, at = 0) => focusReads(await chooseInvestigation(tenantId, null), at, null).queries; const canon = <T extends object>(o: T) => ({ observationId: "obs_fx", promptVersion: 1, reportingDay: "2026-07-01", answerHash: "hx", retrievedResults: null, brandMentions: null, analysis: null, ...o });
import { proposalFingerprint } from "@/domains/decision/proposal-store"; import { ownedCandidatesFor } from "@/domains/decision/owned-coverage"; import { askIdentity } from "@/domains/evidence/page-intersection";
import { buildTopicInvestigations } from "@/domains/evidence/topic-investigation";
import { earnsOwnPage, readCoverage, rankInvestigations } from "@/domains/decision/coverage-pass"; import { openHold } from "@/domains/decision/completeness"; import { loadProposalQueue, pagesUnderMeasurement } from "@/domains/decision/load-proposals"; import { REVIEW_CONTRACT, copyKey } from "@/domains/decision/proof"; import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { emptyResearchEvidence, type FunnelResearchEvidence, type ResearchPageComparison, type WinnerReadOutcome } from "@/domains/evidence/funnel/research-evidence"; import { hashSnapshot } from "@/domains/evidence/snapshot"; import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { serializeChangeProposal, deserializeChangeProposal, type EvidenceInput, type ChangeProposal } from "@/domains/decision/contracts"; import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
/** A completion fn that replays a fixed queue (last response repeats). The seam returns a PARSED structured VALUE (never text); an error carries its retryability. */
function fakeComplete(responses: Array<{ value: unknown } | { error: string; retryable?: boolean }>): CompleteFn { let i = 0; return async () => { const r = responses[Math.min(i++, responses.length - 1)]!; return "error" in r ? { error: r.error, retryable: r.retryable ?? false } : { value: r.value }; };
} const PROOF = { metrics: ["clicks", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" };
const VALID_ATOMIC_EDIT = { field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen", confidence: "high", rationale: "The current title is one word and misses the specific customs searchers ask about.", risks: ["keep the title concise"],
  evidenceRefs: [{ source: "gsc", detail: "many impressions for nowruz traditions with a low click rate" }], operatorSteps: ["Replace the page title field with the new value"], proofPlan: PROOF };
const KEYS = ["demand-exact", "copy-current", "serp1", "serp-owned", "serp-pattern"];
const DIAGNOSED: EvidenceInput["evidence"]["diagnosis"] = { status: "diagnosed", cause: "snippet_intent_mismatch", action: "title", evidenceKeys: KEYS, explanation: "I checked the results page.", alternativesRuledOut: [{ alternative: "Google is already showing the words people search for", reason: "It is not.", evidenceKeys: ["serp-owned"] }] };
const EXISTING_INPUT: EvidenceInput = {
  tenantId: "referencepedia", page: { path: "/nowruz", url: "https://fixture-content.example/nowruz", label: "Nowruz" }, sizing: { impactScore: 80, upsidePerMonth: 45 },
  opportunity: { query: "nowruz traditions", kind: "existing_edit", field: "title", opportunityType: "Capture clicks", currentValue: "Nowruz", intent: "what" }, evidence: { hints: ["Search Console shows strong demand for nowruz traditions, the persian new year customs"], diagnosis: DIAGNOSED, outline: ["History of Nowruz", "Haft-Seen table", "Persian customs and foods"] } };
/** A minimal safe existing-edit proposal, for constructing rejection variants. */
function baseProposal(over: Partial<ChangeProposal> = {}): ChangeProposal { return {
    id: "fixture-tenant::/x::existing_edit::title", tenantId: "fixture-tenant", kind: "existing_edit", pagePath: "/x", pageUrl: "https://fixture-content.example/x",
    pageLabel: "X", primaryQuery: "nowruz traditions", opportunityType: "Capture clicks", changeFamily: "title", status: "ready", evidence: { query: "nowruz traditions", hints: ["gsc demand"], evidenceRefCount: 1 }, recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen" },
    whyItMatters: "The title misses the customs searchers ask about.", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "high", limitations: [], impactScore: 50, upsidePerMonth: 20, publish: "manual", createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), ...over };
} /** The exact-edit rewrite under test, with one field swapped. */
const edited = (field: "title" | "meta", before: string | null, after: string): ChangeProposal => baseProposal({ recommendedChange: { kind: "existing_edit", field, before, after } });
describe("existing-page cold proposal", () => { it("generates, validates, persists (serialize), and re-loads (deserialize)", async () => { const out = await proposeExistingPageChange(EXISTING_INPUT, { complete: fakeComplete([{ value: VALID_ATOMIC_EDIT }]), now: new Date("2026-07-22T00:00:00Z") }); expect(out.status).toBe("ready"); if (out.status !== "ready") return;
    const p = out.proposal; if (p.recommendedChange.kind === "existing_edit") { expect(p.recommendedChange.before).toBe("Nowruz"); expect(p.recommendedChange.after).toContain("Nowruz Traditions"); } else throw new Error("expected an exact edit"); expect(p.whyItMatters).toMatch(/customs/i); expect(p.primaryQuery).toBe("nowruz traditions"); expect(p.opportunityType).toBe("Capture clicks"); expect(p.evidence.evidenceRefCount).toBe(5); expect(out.validation.verdict).toBe("ready"); expect(p.status).toBe("ready"); // the receipt keys the diagnosis cites, and a safe draft is ready, never withdrawn
    expect(deserializeChangeProposal(serializeChangeProposal(p))).toEqual(p); // persisted + loadable: round-trips + re-validates
    expect(deserializeChangeProposal(JSON.stringify({ v: 1, proposal: { ...p, recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "" } } }))).toBeNull(); // a tampered row is never served as trusted
    const brief = { kind: "new_page" as const, proposedTitle: "T", metaDescription: "M", openingAnswer: "A", outline: ["One"], faqQuestions: [], schemaTypes: [] }; // recorded before this kernel stopped writing them
    expect(deserializeChangeProposal(serializeChangeProposal({ ...p, id: "hist", kind: "new_page", pagePath: null, recommendedChange: brief }))?.recommendedChange).toEqual(brief); }); // history still decodes
  it("returns no_draft (fail-closed) when no key or completion transport exists", async () => { expect((await proposeExistingPageChange(EXISTING_INPUT)).status).toBe("no_draft"); });
  it("never calls the drafter for a candidate the results page has not accused", async () => { let called = 0; // no completion call, no copy, no row
    const out = await proposeExistingPageChange({ ...EXISTING_INPUT, evidence: { ...EXISTING_INPUT.evidence, diagnosis: undefined } }, { complete: async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; } }); expect([out.status, called, out.status === "no_draft" && out.reason]).toEqual(["no_draft", 0, "I checked the results page, but it does not yet show that the title is the problem."]); });
}); describe("safety gates reject unsafe drafts", () => { const LONG_META = "Nowruz is the Persian New Year celebrated with the Haft-Seen table, customs, and foods across Iran and the diaspora.";
  it.each([ // one gate per row: the flag it must raise
    ["a placeholder stub", edited("title", "Nowruz", "Nowruz [insert customs here]"), /placeholder|stub/i], ["an em dash in operator copy", edited("title", "Nowruz", "Nowruz Traditions — Persian New Year"), /dash/i], ["a raw uuid leaking into copy", edited("title", "Nowruz", "Nowruz 550e8400-e29b-41d4-a716-446655440000 Guide"), /./],
    ["a destructive edit that guts the current value", edited("meta", LONG_META, "Nowruz."), /destructive/i]] as const)("rejects %s", (_w, p, flag) => {
    const v = validateProposal(p); expect(v.verdict).toBe("rejected"); // a refused draft earns NO lifecycle stage, so it is withdrawn, never a quiet needs_review
    expect([...v.safetyFlags, ...v.reasons].some((f) => flag.test(f))).toBe(true); });
  it("rejects an edit that introduces an ungrounded number or claim", () => {
    const p = edited("meta", "Nowruz is the Persian New Year celebrated across Iran.", "Nowruz is the Persian New Year, first celebrated exactly 3247 years ago in 1223 BCE."); // the grounding carries no such figure
    const v = validateProposal(p, { evidenceText: "nowruz is the persian new year", pageBodyText: "Nowruz is the Persian New Year celebrated across Iran." }); expect(v.verdict).toBe("rejected"); expect(v.factViolations.length).toBeGreaterThan(0); });
}); // ── the diagnosis: only a proven, recoverable gap earns work ──────────────────
function ownedPage(url: string, title: string, totals: { impressions: number; clicks: number }, topQueries: OwnedQuerySignal[], outline: string[] = []): OwnedPageEvidence { return { url, content: { title, metaDescription: null, h1: title, h2: [], outline, schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 800, internalLinks: [], fetchedAt: null },
    search: { clicks90d: totals.clicks, impressions90d: totals.impressions, ctr90d: totals.clicks / totals.impressions, position90d: 4, topQueries }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } };
} function snap(ownedPages: OwnedPageEvidence[], research: FunnelResearchEvidence = emptyResearchEvidence(), keywordDemand: EvidenceSnapshot["keywordDemand"] = []): EvidenceSnapshot { return { scope: { tenantId: "fixture-tenant", site: "fixture-outdoors.example", builtAt: "2026-07-26T00:00:00.000Z" }, sources: [], ownedPages, competitors: [], keywordDemand, questionDemand: [],
    intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, research, evidenceHash: "fixture" };
} /** A live results page observed for these EXACT searches, carrying this page's OWN line on it and two rivals that share wording that line does not: exactly what a diagnosis has to read before it may name the title. */
const looked = (pairs: [string, string][], observedAt: string | null = null): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), serpEvidence: pairs.map(([query, url]) => ({ query, observedAt, aiOverview: [], aiMode: [], paa: [], related: [],
  organic: [{ rank: 1, domain: "rival.example", url: "https://rival.example/a", title: "Nowruz Traditions Explained" },
    { rank: 2, domain: "other.example", url: "https://other.example/b", title: "Persian New Year Traditions and Food" }, { rank: 3, domain: "fixture-outdoors.example", url, title: "Nowruz" }] })) });
/** A big winner: its main searches BEAT the clicks their positions earn, and even counting its one soft search it is ahead. */ const WINNER = ownedPage("fixture-outdoors.example/trail-shoes", "Trail Shoes", { impressions: 75646, clicks: 3246 }, [
  { query: "trail running shoes", impressions: 25000, clicks: 2365, position: 3.96 }, { query: "womens trail shoes", impressions: 12000, clicks: 1012, position: 3.74 }, { query: "trail shoes for women", impressions: 2110, clicks: 209, position: 2.66 }, { query: "trail shoe reviews", impressions: 1331, clicks: 40, position: 3.7 }]);
/** A far smaller page with a REAL gap: 3.0 percent against the 8.0 percent that position usually earns. */ const GAP_URL = "fixture-outdoors.example/nowruz-guide"; const GAP = ownedPage(GAP_URL, "Nowruz", { impressions: 6400, clicks: 190 }, [{ query: "nowruz traditions", impressions: 6000, clicks: 180, position: 4.1 }], ["Persian New Year Customs", "Haft-Seen"]);
const SEEN = () => snap([GAP], looked([["nowruz traditions", GAP_URL]]));
/** THE LIVE PRODUCTION CASE, verified 2026-07-27: 2,451 views and 15 clicks at position 6.1 on one search, a stored title missing the searcher's own word, and a results page where Google already displays that word back to them. */
const ACTORS_URL = "iranopedia.example/iranian-actors-actresses"; const DISPLAYED = "Famous Iranian & Persian Actors, Actresses & Celebrities";
const ACTORS = ownedPage(ACTORS_URL, "Top 20 Famous Persian Actresses and Actors | Iranopedia", { impressions: 2451, clicks: 15 }, [{ query: "iranian actors", impressions: 2451, clicks: 15, position: 6.1 }]);
const actorsSerp = (ownedTitle: string): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), serpEvidence: [{ observedAt: null, query: "iranian actors", aiOverview: [], aiMode: [], paa: [], related: [],
  organic: [{ rank: 1, domain: "imdb.example", url: "https://imdb.example/list", title: "Iranian Actors" }, { rank: 2, domain: "wiki.example", url: "https://wiki.example/list", title: "List of Iranian male actors" },
    { rank: 3, domain: "pantheon.example", url: "https://pantheon.example/iran", title: "Greatest Iranian Actors" }, { rank: 6, domain: "iranopedia.example", url: ACTORS_URL, title: ownedTitle }] }] });
describe("what the evidence justifies before anything is drafted", () => { it("leaves a page that already beats the clicks its positions earn alone, however big it is", () => {
    const c = compileCandidates(snap([WINNER]))[0]!; expect([c.action, c.query, c.recoverableClicks]).toEqual(["watch", "trail shoe reviews", 21]); // one soft search on a winning page is watched, not worked
    expect(c.reason).toContain("1,331"); expect(c.reason).not.toContain("75,646"); expect(c.reason).not.toContain("3,246"); // a page total is never quoted as a query number
    expect(snapshotToEvidenceInputs(snap([WINNER]))).toEqual([]); }); // no title, no description, no work
  it("earns exactly one action from a gap above every floor, carrying that query's own numbers", () => { expect(compileCandidates(SEEN()).map((c) => [c.action, c.gap, c.query, c.recoverableClicks])).toEqual([["act_existing_page", "ctr_deficit", "nowruz traditions", 93]]);
    const inputs = snapshotToEvidenceInputs(SEEN()); expect(inputs.map((i) => i.opportunity.field)).toEqual(["title"]); expect(inputs[0]!.sizing!.impactScore).toBe(93); // ONE field, one horizon: the 28-day-equivalent shortfall and nothing else
    const hint = (inputs[0]!.evidence.hints ?? []).join(" "); expect(hint).toContain("6,000"); expect(hint).toContain("8.0 percent"); expect(hint).toContain("3.0 percent"); expect(hint).not.toContain("6,400"); }); // a page total never stands in for the query
  it("opens an INVESTIGATION on a gap it has never looked at, and sizes it without ever promising the clicks back", () => {
    const blind = compileCandidates(snap([GAP]))[0]!; // the SAME 300-click gap, with no live results page on file
    expect([blind.action, blind.recoverableClicks]).toEqual(["research_needed", 93]); // a gap opens an investigation, never a change
    expect(blind.reason).toContain("This search earns about 93 fewer clicks than pages at a similar position usually get"); expect(blind.reason).toContain("The gap is measured but the live results page for that search has not been read yet. That search is next in line for research"); // names exactly what is missing
    expect(snapshotToEvidenceInputs(snap([GAP]))).toEqual([]); // never drafted, so it can never render Ready
    const seen = compileCandidates(SEEN())[0]!; // confidence follows EVIDENCE, never the draft
    expect(seen.readiness).toEqual({ gsc: true, ownedCopy: true, serp: true, winners: 0, body: false }); // no body store exists, so body is false everywhere
    expect(`${blind.reason} ${seen.reason}`).not.toMatch(/worth about|win back|fastest win|more clicks a month/i); });
  it("refuses the title rewrite Google already performs for you, however badly the stored one reads", () => {
    const c = compileCandidates(snap([ACTORS], actorsSerp(DISPLAYED)))[0]!; // the stored title misses "Iranian"; the line a searcher actually reads does not
    expect([c.action, c.recoverableClicks, c.diagnosis!.cause, c.diagnosis!.action]).toEqual(["research_needed", 33, "google_rewrite_already_matches", null]); expect(c.reason).toContain(`Google already shows this page as "${DISPLAYED}", which carries the words people are searching for, so rewriting the title would not change what a searcher reads.`); expect(snapshotToEvidenceInputs(snap([ACTORS], actorsSerp(DISPLAYED)))).toEqual([]); expect(suggestedEdits(snap([ACTORS], actorsSerp(DISPLAYED)), [c], { now: NOW, basis: null })).toEqual([]); }); // never drafted, and never suggested either: the results page itself cleared the wording
  it("reads one rival as an anecdote and two that agree as the pattern that earns a title", () => { const full = actorsSerp("Persian Screen | Iranopedia"); const lone = { ...full, serpEvidence: [{ ...full.serpEvidence[0]!, organic: full.serpEvidence[0]!.organic.slice(2) }] };
    const anecdote = compileCandidates(snap([ACTORS], lone))[0]!; // one competing page's wording is that page's style, never a rule
    expect([anecdote.action, anecdote.diagnosis!.cause]).toEqual(["research_needed", "ambiguous_search_intent"]); expect(anecdote.reason).toContain("share no wording this page is missing, so the title is not the provable problem"); expect(suggestedEdits(snap([ACTORS], lone), [anecdote], { now: NOW, basis: null })).toEqual([]); // a suggestion here would re-propose the thing I just disproved
    const d = compileCandidates(snap([ACTORS], full))[0]!.diagnosis!; // three of them say it, and this page's own line does not
    expect([d.status, d.cause, d.action, d.evidenceKeys]).toEqual(["diagnosed", "snippet_intent_mismatch", "title", KEYS]);
    expect(d.alternativesRuledOut.map((a) => a.alternative)).toEqual(["Google is already showing the words people search for", "A different page of yours is the one ranking"]);
    expect(d.explanation).toContain('Google shows this page as "Persian Screen | Iranopedia", and the other sites that come up share wording that line does not carry: "iranian", "actor".');
    expect(d.explanation).not.toMatch(/result \d/); }); // rank_absolute counts ads and packs, so it is never printed as a search position
  it("ranks a small page with a real gap above a huge page with none, and ranks every row on worth alone", () => { expect(snapshotToEvidenceInputs(snap([WINNER, GAP], looked([["nowruz traditions", GAP_URL]]))).map((i) => i.page.path)).toEqual(["/nowruz-guide"]);
    const waiting = baseProposal({ id: "waiting", status: "needs_review", impactScore: 9999 });
    expect(rankProposals([baseProposal({ id: "huge-no-gap", impactScore: 0 }), waiting, baseProposal({ id: "small-real-gap", impactScore: 300 })]).map((p) => p.id)).toEqual(["waiting", "small-real-gap", "huge-no-gap"]); expect(proposalValueScore(baseProposal({ impactScore: 300 }))).toBeGreaterThan(proposalValueScore(baseProposal({ impactScore: 0 }))); });
  it("ranks a 539-click title rewrite above a 3-minute answer block on a page shown 300 times, because the KIND of change never decides", () => { const bigTitle = baseProposal({ id: "title-539", changeFamily: "title", impactScore: 539, demandImpressions90d: 30_000, estimatedEffortMinutes: 1 });
    const smallSection = baseProposal({ id: "section-tiny", changeFamily: "section", impactScore: 0, demandImpressions90d: 300, estimatedEffortMinutes: 3, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A short new answer." } });
    expect(rankProposals([smallSection, bigTitle]).map((p) => p.id)).toEqual(["title-539", "section-tiny"]);
    expect(proposalValueScore(bigTitle)).toBeGreaterThan(proposalValueScore(smallSection));
    const history = new Map([[actionFamilyOf("title"), { readings: 3, netLift: -40 }]]);
    // ONE SCORING CONTEXT, ONE NUMBER (measured on 66 live rows, 2026-09-05): the money read no learning and no neighbours while the displayed queue read both, so 29 of 66 positions and 18 of 66 scores disagreed and one card was worth 2.15 to the funder and 71.26 to the operator.
    for (const t of ["tenant-a", "tenant-b"]) { const batch = [{ ...smallSection, tenantId: t, pagePath: "/one" }, { ...bigTitle, tenantId: t, pagePath: "/one" }], ctx = { familyHistory: history, batch };
      expect([rankProposals(batch, ctx).map((p) => [p.id, p.rankingReceipt!.score]), proposalValueScore(batch[1]!, ctx) < proposalValueScore(batch[1]!, { familyHistory: history })], `${t}: the money and the queue read the same context, so one row is worth one number, and the second change on the page really does discount the funding score rather than the two agreeing by accident`).toEqual([rankProposals(batch, ctx).map((p) => [p.id, proposalValueScore(batch.find((r) => r.id === p.id)!, ctx)]), true]); }
    expect(rankProposals([smallSection, bigTitle], { familyHistory: history }).map((p) => p.id)).toEqual(["title-539", "section-tiny"]);
    const at = (netLift: number, readings = 19) => rankProposals([bigTitle], { familyHistory: new Map([[actionFamilyOf("title"), { readings, netLift }]]) })[0]!.rankingReceipt!, none = rankProposals([bigTitle])[0]!.rankingReceipt!, sunk = at(-100_000), won = at(100_000); expect([sunk.score >= none.score * 0.9 && sunk.score > 0, won.score === none.score, at(-100_000, 400).score > 0, sunk.factors.find((f) => f.name === "history")!.input, at(-40, 2).factors.find((f) => f.name === "history")!.input], "A LOSING RECORD NEVER ZEROES A KIND OF CHANGE and a winning one buys nothing: nineteen readings all the way down cost a tenth of what is riding on the change and never the change itself, past twenty the account's own measured share takes over and still floors at 5 percent, and the receipt says how those readings closed rather than calling a 14 day read finished").toEqual([true, true, true, "this kind of change is 100,000 clicks down across 19 readings here, each closed at 14 days or later, which is too few to weigh heavily", "too few readings of this kind of change have closed here to judge it"]); });
  it("hands the click record nothing from a change that was raised to win a citation", async () => { const row = (id: string, judgedMetric: string | null) => ({ id, actionType: "title", after: null, implementedAt: "2026-07-01T00:00:00.000Z", verification: { status: "verified" }, operatorVerdictOverride: null, pinnedRead: null, treatmentStamp: null, componentsApplied: null, judgedMetric, controlsReceipt: [{ path: "/c1", reasons: [] }, { path: "/c2", reasons: [] }], windows: [{ day: 14, ran: true, checkOn: "", adjustedLift: 30, controlsUsed: 2, comparedToSite: false }] }); const taught = async (judgedMetric: string | null) => { env.ledger = ["a", "b", "c"].map((id) => row(id, judgedMetric)); env.store = new Map([["live", baseProposal({ id: "live", basis: "b", status: "needs_review", impactScore: 400 })]]); return (await loadProposalQueue("fixture-tenant", { currentBasis: "b" })).ranked[0]!.rankingReceipt!.factors.find((f) => f.name === "history")!.input; }; expect([await taught("clicks"), await taught("ai_citation")], "the yardstick a change was shipped under decides what it may teach: three citation bets hand the click record no clicks at all").toEqual(["this kind of change is 34 clicks up across 3 readings here, each closed at 14 days or later, which is too few to weigh heavily", "too few readings of this kind of change have closed here to judge it"]); });
  it("funds the body answer worth more before the description, and leaves the description only what the answer did not take", () => { const j = (key: string, impact: number) => ({ key, family: "editor", impact, calls: DRAFT_BUDGET.DELIVERABLE_CALLS, workKey: `${key}::w` }), keys = (calls: number) => DRAFT_BUDGET.plan({ jobs: [j("/p::meta", 2), j("/p2::body::answer", 9)], candidates: 4, calls }).funded.map((f) => f.key);
    /** WHAT A TIGHT CEILING REALLY DOES: it funds the whole ranked line and lets the strongest job SPEND the money, so the next job finds none left rather than being refused before anything ran. */
    const spendsFirst = (calls: number) => { const b = DRAFT_BUDGET.plan({ jobs: [j("/p::meta", 2), j("/p2::body::answer", 9)], candidates: 4, calls }); const lead = b.draw("/p2::body::answer", DRAFT_BUDGET.DELIVERABLE_CALLS)!; lead.left = 0; return [b.funded.map((f) => f.key), b.draw("/p::meta", DRAFT_BUDGET.DELIVERABLE_CALLS)?.left ?? null, b.declined.length]; }; const topicWorth = proposalValueScore(baseProposal({ id: "job::topic:hardest-language", pagePath: "topic:hardest-language", pageUrl: "topic:hardest-language", primaryQuery: "", opportunityType: "", changeFamily: "single", status: "needs_review", researchOnly: true, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "" }, whyItMatters: "", estimatedEffortMinutes: 15, riskLevel: "low", confidence: "low", limitations: [], evidence: { query: "", hints: [], evidenceRefCount: 0 }, impactScore: 27100 / 100, upsidePerMonth: null })); const memory = (key: string, m: { calls: number; last: string; settled: boolean; waited?: number }) => ({ [`${key}::w`]: m }); expect([keys(DRAFT_BUDGET.DELIVERABLE_CALLS * 2), spendsFirst(DRAFT_BUDGET.DELIVERABLE_CALLS / (1 + DRAFT_BUDGET.RETRIES)), topicWorth, DRAFT_BUDGET.plan({ jobs: [j("pattern:hardest-language", topicWorth), j("/p::answer", 2.84)], candidates: 4 }).funded.map((f) => f.key), DRAFT_BUDGET.plan({ jobs: [j("pattern:hardest-language", topicWorth), j("/p::answer", 2.84)], candidates: 1, memory: memory("pattern:hardest-language", { calls: 1, last: "deterministic_refusal", settled: true }) }).funded.map((f) => f.key), DRAFT_BUDGET.plan({ jobs: [j("/hi", 9), j("/lo", 2)], candidates: 1 }).declined.map((d) => d.key), DRAFT_BUDGET.plan({ jobs: [j("/hi", 9), j("/lo", 2)], candidates: 2, memory: memory("/hi", { calls: 1, last: "provider_blocked", settled: false }) }).funded.map((f) => f.key), DRAFT_BUDGET.plan({ jobs: [j("/hi", 9), j("/lo", 2)], candidates: 1, waiting: ["/lo::w"] }).funded.map((f) => f.key), DRAFT_BUDGET.plan({ jobs: [j("/hi", 9), j("/lo", 2)], candidates: 1, waiting: ["/lo::w"], memory: memory("/lo", { calls: 0, last: "not_reached", settled: false, waited: 3 }) }).funded.map((f) => f.key)], "no metadata band and no body band: ONE order, and fast metadata fills what is left over rather than crowding out the section worth more. MONEY IS SPENT, NEVER COMMITTED: a ceiling of one writing round funds BOTH jobs and the answer spends it, so the description draws nothing and is refused by no reservation made before anything ran. ONE VALUE CALCULATION: a topic worth 27,100 searches a month reaches the manifest through the SAME receipt an editor card does, at 5.01 and never at 271, and it still leads the 2.84 answer because 27,100 searches collected at the undiagnosed share is more than 2.84, not because nobody discounted it. A DEPENDENCY BEACON'S OWN RULE ALREADY REFUSED cannot take the one slot again: the answer takes it. AND WORK THE MONEY NEVER REACHED KEEPS ITS PRIORITY across two continuations, while the job that really was attempted and finished nothing is demoted behind it, and the work the last walk funded and never began is the first thing the next one picks up. BUT NOT FOR EVER: funded and never reached three drives running is demoted behind work nobody has tried, so a job the clock or the money cannot reach can never hold the head of the queue against everything behind it.").toEqual([["/p2::body::answer", "/p::meta"], [["/p2::body::answer", "/p::meta"], 0, 0], 5.01, ["pattern:hardest-language", "/p::answer"], ["/p::answer"], ["/lo"], ["/lo", "/hi"], ["/lo"], ["/hi"]]); });
  it("never renders an uncalibrated prior as a measured figure, and says which half is assumed", () => { const card = baseProposal({ impactScore: 400, diagnosisCause: undefined });
    const shown = rankProposals([card])[0]!.rankingReceipt!;
    const vis = shown.factors.find((f) => f.name === "visibility")!.input;
    expect(vis, "the measured half is named first").toContain("400 clicks over 28 days");
    expect(vis, "and the assumed half is named as policy").toContain("this product's policy and not a figure measured here");
    expect(vis).not.toContain("expected");
    expect(shown.basis, "an undiagnosed card says outright it is an order and not a size").toContain("not a promise about size");
    expect(shown.basis).not.toContain("No click figure backs this one");
    expect(shown.basis).toContain("nothing has named the cause yet");
    expect(rankProposals([baseProposal({ impactScore: 400, diagnosisCause: "ctr_snippet", recommendedChange: { kind: "existing_edit", field: "title", before: "a", after: "b" } })])[0]! .rankingReceipt!.basis).toContain("not a forecast");
    const thin = new Map([[actionFamilyOf("title"), { readings: 3, netLift: 900 }]]);
    expect(rankProposals([card], { familyHistory: thin })[0]!.rankingReceipt!.factors
      .find((f) => f.name === "visibility")!.input).toContain("not a figure measured here"); });

  it("changing only the treatment label cannot move the traffic estimate", () => { const same = { impactScore: 400, demandImpressions90d: 9_000 };
    const worth = (family: string): number => rankProposals([baseProposal({ ...same, changeFamily: family })])[0]!
      .rankingReceipt!.factors.find((f) => f.name === "visibility")!.contribution;
    const labels = ["title", "meta", "section", "answer", "new_page", "schema", "full_rewrite"];
    expect(new Set(labels.map(worth)).size, "one traffic figure, whatever the work is called").toBe(1); });

  it("treats nothing worth PAYING for as a quiet day for the drafter, while the $0 queue still works it", async () => {
    reset(snap([WINNER])); let called = 0; const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async () => { called += 1; return { error: "the drafter must never run when nothing earned an action", retryable: false }; } }); // nothing earns a PAID action
    expect([res.actionable, res.candidates.length, called]).toEqual([0, 1, 0]); // the drafter is never called // The early return used to skip the $0 producers entirely (canonical $0 acceptance run, 2026-08-21).
    expect(res.proposals.every((p) => p.researchOnly === true || p.status === "needs_review")).toBe(true); // only $0 work, nothing paid
    expect(env.saved.every((p) => p.researchOnly === true || p.status === "needs_review")).toBe(true); }); // and nothing persisted claims to be drafted copy
  it("changes nothing at all when the search data did not answer, and still publishes when the account genuinely holds none", async () => { const stored = baseProposal({ id: "fixture-tenant::/nowruz-guide::existing_edit::title-family", pagePath: "/nowruz-guide", pageUrl: GAP_URL, basis: "basis_today" });
    const gsc = (status: "failed" | "empty") => ({ ...snap([{ ...GAP, search: null }]), sources: [{ source: "gsc" as const, status, lastSyncedAt: null, rowsSeen: 0, note: "" }] });
    const pass = async (status: "failed" | "empty") => { reset(gsc(status)); env.store = new Map([[stored.id, stored]]); return produceProposalsForTenant("fixture-tenant", { now: NOW }); };
    const dark = await pass("failed"); // nothing judged, nothing taken back, nothing written: the caller keeps the release it already had
    expect([dark.outcome, dark.candidates.length, env.withdrawn, env.saved]).toEqual(["evidence_unreadable", 0, [], []]);
    const genuinely = await pass("empty"); // an account that really holds no search data reads empty, not failed, and publishes exactly as before
    expect([genuinely.outcome, genuinely.candidates.length, env.withdrawn]).toEqual(["proposals_persisted", 1, []]); // footprint-level suppression lets the $0 defect producers mint what the page itself proves (a missing description needs no search row), so an empty-GSC account now persists that real work instead of reporting nothing to do
    expect(env.saved.every((p) => p.researchOnly === true || p.status === "needs_review"), "and nothing minted on an empty account claims to be drafted copy").toBe(true); });
}); // ── one evidence basis, one decision generation, ONE material row ─────────────
const NOW = new Date("2026-07-26T00:00:00.000Z");
/** A REAL but smaller gap (169 clicks) that is listed FIRST, ahead of GAP's 300. */ const WEAK = ownedPage("fixture-outdoors.example/nowruz-food", "Nowruz Food", { impressions: 3000, clicks: 60 }, [{ query: "nowruz food traditions", impressions: 2800, clicks: 55, position: 4.1 }], ["Persian New Year Customs", "Haft-Seen"]);
const BOTH = () => snap([WEAK, GAP], looked([["nowruz food traditions", "fixture-outdoors.example/nowruz-food"], ["nowruz traditions", GAP_URL]]));
const reset = (s: EvidenceSnapshot): void => { env.snap = s; env.saved = []; env.store = new Map(); env.withdrawn = []; env.failWrites = false; env.failIds = new Set(); env.refuseIds = new Set(); env.withdrawnIds = new Set(); env.bundleTarget = null; env.bundle = null; env.realBundle = false; env.door = null; };
/** Count every drafter call a pass made, answering with one valid edit. */
const counting = (): { complete: CompleteFn; calls: () => number } => { let n = 0; return { complete: async () => { n += 1; return { value: VALID_ATOMIC_EDIT }; }, calls: () => n }; };
const run = (complete: CompleteFn) => produceProposalsForTenant("fixture-tenant", { complete, now: NOW, bypassCache: true });
describe("a refresh re-pays nothing, and a pass that saved nothing says so", () => { it("aims the deep change at the STRONGEST gap, drafts and writes ONCE, then does nothing at all on the next pass", async () => { reset(BOTH()); const first = counting(); const one = await run(first.complete);
    expect(one.candidates.filter((c) => c.action === "act_existing_page").map((c) => c.recoverableClicks)).toEqual([53, 93]); // snapshot order puts the weak page first
    expect(env.bundleTarget).toBe("https://fixture-outdoors.example/nowruz-guide"); // the deep work still goes to the 300-click gap
    expect([one.outcome, one.persisted, one.reused, first.calls()]).toEqual(["proposals_persisted", 2, 0, 2]); const second = counting(); env.saved = []; const again = await run(second.complete);
    expect([again.outcome, again.persisted, again.reused, second.calls()]).toEqual(["proposals_persisted", 0, 2, 0]); // zero drafts, zero writes
    expect(env.saved).toEqual([]); expect(again.proposals.map((p) => p.id)).toEqual(one.proposals.map((p) => p.id)); });
  /** A RECEIPT THAT CANNOT SAY WHY IS NOT A RECEIPT (Codex, 2026-08-23). Every settled job carries the words that settled it, and the ones that settled nothing carry no words at all: a produced page inheriting a refusal it never suffered is exactly the false reading this whole chain exists to prevent. */
  it("carries the exact reason into the receipt for a store refusal and an already-withdrawn row, and never onto work that was not refused", async () => { reset(SEEN()); const before = await run(counting().complete), madeIt = before.paid.receipts.filter((r) => r.outcome === "produced");
    // FUNDED MEANS WALKED (operator, 2026-09-02): every key the plan funded ends the pass with a receipt of its own, and `not_reached` is never that ending. A funded key nothing filed used to read "no branch of this pass recorded what happened", a fault sentence standing in for an outcome.
    expect([before.paid.funded.length > 0, before.paid.receipts.map((r) => r.key).sort()], "one receipt per funded key, no key silent").toEqual([true, [...before.paid.funded].sort()]);
    expect([madeIt.length > 0, madeIt.every((r) => r.why === undefined || r.why.includes("already on file")), before.paid.receipts.every((r) => r.outcome !== "not_reached"), before.paid.receipts.every((r) => (r.why ?? "").length > 0 || r.outcome === "produced")]).toEqual([true, true, true, true]); // produced carries no refusal words; the one why it MAY carry is its own reuse sentence, never an inherited gate
    reset(SEEN()); const boxed = await produceProposalsForTenant("fixture-tenant", { complete: counting().complete, now: NOW, bypassCache: true, stopBy: Date.now() - 1 }); // the drive's box already closed: nothing is started, and nothing is written off for it either
    expect([boxed.paid.funded.length > 0, boxed.paid.receipts.every((r) => (r.why ?? "").length > 0 && r.providerCalls === 0), boxed.paid.receipts.every((r) => r.outcome !== "not_reached" || (r.why ?? "").includes("time box ended before this page's turn"))], "a boxed pass files a real still-owed ending for every funded key, charges nothing, and where execution never BEGAN says exactly that: it is no attempt, so the day may not demote it").toEqual([true, true, true]);
    reset(SEEN()); env.refuseIds = new Set(before.proposals.map((p) => p.id)); // A STORE REFUSAL says so, in the store's own words, on exactly the page it refused
    const stored = (await run(counting().complete)).paid.receipts.filter((r) => r.outcome === "deterministic_refusal"); expect([stored.length > 0, stored.every((r) => (r.why ?? "").includes("the store refused this row"))]).toEqual([true, true]);
    reset(SEEN()); const seed = await run(counting().complete); reset(SEEN()); env.withdrawnIds = new Set(seed.proposals.map((p) => p.id)); // work already TAKEN BACK under this evidence says THAT instead, so the two are never confused
    expect((await run(counting().complete)).paid.receipts.filter((r) => (r.why ?? "").includes("already taken back")).every((r) => r.outcome === "deterministic_refusal")).toBe(true); });
  /** SAME PAGE IS NOT SAME WORK (Codex, 2026-08-23), proved through the REAL producer because the planner-only version passed while the integration was dead: any stored bundle on an address satisfied a newly selected job, so the writer was skipped and the receipt then invented "the pass ended before this page was reached" for a page the pass reached in two seconds. THE DAY'S MEMORY REACHING THE PLAN is pinned by the walk's own order proof (change-bundle: "funds the ranked order... and resumes the owed one ahead of the untried one"), which drives the same producer and asserts the resumed order rather than only that the option travelled. */
  /** SAME PAGE IS NOT SAME WORK, AND SAME PAGE WITH THE SAME CAUSE IS NOT EITHER (Codex, 2026-08-23), proved through the REAL producer on the live counterexample: an incomplete title bundle on /iran-flags/iran-islamic-republic-flag-history answered a newly selected rewrite because both said "cannibalization", so the writer was skipped, zero calls were spent, and the receipt said produced for a page the queue could not see. Reuse needs the same page, evidence, family, treatment, cause AND search, and the stored row must be finished work rather than a draft awaiting review. */
  it("never lets another diagnosis's bundle, or the same cause under a different work identity, stand in for a newly selected job", async () => {
    const stored = (over: Partial<ChangeProposal>) => baseProposal({ pagePath: "/nowruz-guide", pageUrl: GAP_URL, basis: "basis_today", status: "needs_review", bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] }, confidenceReasons: [], alternatives: [], risks: [],
      components: [{ kind: "title", label: "T", risk: "safe", before: "a", after: "b", evidenceKeys: ["k1"] }], receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "f", observedAt: NOW.toISOString() }], missing: [], freshestObservedAt: NOW.toISOString() } }, ...over });
    for (const row of [stored({ id: "fixture-tenant::/nowruz-guide::existing_edit::bundle", diagnosisCause: "factual_error" }), stored({ id: "fixture-tenant::/nowruz-guide::existing_edit::title-family", diagnosisCause: "cannibalization", workKey: "a-different-piece-of-work" })]) {
      reset(BOTH()); env.store = new Map([[row.id, row]]);
      const out = await produceProposalsForTenant("fixture-tenant", { complete: counting().complete, now: NOW, bypassCache: true });
      expect(out.paid.receipts.filter((r) => (r.why ?? "").includes("no branch of this pass recorded what happened") || (r.outcome === "produced" && (r.why ?? "").includes("answers this exact diagnosis"))), `${row.id} is different work, so nothing may report it as this job finished`).toEqual([]);
      expect([out.paid.receipts.find((r) => r.key === "/nowruz-guide")?.outcome !== "not_reached", out.paid.receipts.every((r) => (r.why ?? "").length > 0 || r.outcome === "produced")], "and every funded key still ends on a real, stated outcome").toEqual([true, true]); } });
  it("stops drafting a page whose deep door named the reading it is missing, instead of spending on a fallback", async () => { reset(BOTH());
    const out = await produceProposalsForTenant("fixture-tenant", { complete: counting().complete, now: NOW, bypassCache: true });
    for (const owed of out.paid.evidenceOwed ?? []) {
      expect(["serp", "page_source", "competitor_page", "factual_source"]).toContain(owed.kind); // TYPED, so the runtime never parses English
      expect(owed.query.length).toBeGreaterThan(0);
      const spent = out.paid.receipts.find((r) => r.key === owed.key);
      expect(spent?.outcome).toBe("evidence_required");   // the page reports what it needs
    } });
  /** THE METER IS WIRED TO SOMETHING (Codex, 2026-08-23). Every earlier receipt test ran an injected transport that  reported nothing, so a receipt of zeroes could not be told from a meter connected to nothing at all. This one  makes the transport report REAL requests and REAL dollars and follows them to the page's own row. */
  it("carries the transport's own request count and dollars onto the page that spent them", async () => { reset(SEEN());
    let n = 0;
    const paying: CompleteFn = async () => { n += 1; return { value: VALID_ATOMIC_EDIT, httpAttempts: 2, provenance: { costUsd: 0.0125 } } as never; };
    const out = await produceProposalsForTenant("fixture-tenant", { complete: paying, now: NOW, bypassCache: true });
    const spent = out.paid.receipts.filter((r) => r.providerCalls > 0);
    expect(n).toBeGreaterThan(0); expect(spent.length).toBeGreaterThan(0);
    for (const r of spent) {
      expect(r.providerCalls % 2).toBe(0);          // two requests per logical operation, exactly as the transport said
      expect(r.costUsd).toBeCloseTo(0.0125 * (r.providerCalls / 2), 6); // and the dollars follow the same operations
      expect(r.providerAttempted).toBe(true);        // "asked" now MEANS a request left the process
      expect(r.ops).toBeGreaterThan(0);}
    const total = out.paid.receipts.reduce((a, r) => a + r.costUsd, 0);
    expect(total).toBeCloseTo(spent.reduce((a, r) => a + r.costUsd, 0), 6); });
  /** WHAT CANNOT BE DONE IS DECIDED BEFORE THE MONEY IS (Codex, 2026-08-23). Live, three of five funded slots came  back `not_reached` while completable work below them went unfunded, because a page already carrying a change  under measurement was funded first and skipped later. The fact was on file the whole time. */
  it("never funds a page already under measurement, and the slot goes to work that can actually finish", async () => { reset(BOTH());
    const measured = baseProposal({ id: "fixture-tenant::/nowruz-guide::existing_edit::title-family", pagePath: "/nowruz-guide", pageUrl: GAP_URL, basis: "basis_today", status: "implemented_pending_verification" });
    env.store = new Map([[measured.id, measured]]);
    const paid = counting(), out = await produceProposalsForTenant("fixture-tenant", { complete: paid.complete, now: NOW, bypassCache: true, maxDrafts: 1 });
    const guide = "/nowruz-guide", food = "/nowruz-food";
    expect(out.paid.funded.some((k: string) => k === guide || k.startsWith(`${guide}::title`)), "the mutation under measurement is never bought again while its reading runs").toBe(false);
    expect(out.paid.receipts.some((r) => r.key === guide || r.key.startsWith(`${guide}::title`)), "and it owns no funded receipt").toBe(false);
    expect([out.paid.receipts.every((r) => r.outcome !== "not_reached"), out.paid.receipts.map((r) => [r.key, r.outcome, r.why, r.providerCalls]), paid.calls()], "and the ONE slot that did fund on that page bought nothing at all: a finished change on file already writes that mutation, so the walk refuses it in its own words before it hires a writer").toEqual([true, [[`${guide}::meta`, "already_complete", "a finished Ready change already on file writes this exact mutation, so nothing was bought for it", 0]], 0]); }); // A DIFFERENT mutation on the measured page MAY fund (operator, 2026-08-31): a title under measurement never makes the page's missing description wait a month; only overlapping work queues behind the reading.
  /** THE RECEIPT IS PROVED AGAINST THE REAL PRODUCER (Codex, 2026-08-23). The runtime test used to hand-build a  complete receipt inside a mocked `@/domains/decision` and assert on its own fiction, while the real builder  emitted neither treatment, nor family, nor impact, nor allowance, nor operations, nor the store's answer.  This drives `produceProposalsForTenant` itself and reads what it actually returns. */
  it("emits the COMPLETE per-page record for every funded key: family, treatment, impact, allowance, operations, real requests, real dollars, the store's own answer and the whole reason", async () => { reset(SEEN()); const out = await run(counting().complete);
    expect(out.paid.funded.length).toBeGreaterThan(0);
    expect(out.paid.receipts.length).toBe(out.paid.funded.length); expect(out.paid.receipts.map((r) => r.key)).toEqual([...out.paid.funded]); expect(out.paid.receipts.map((r) => r.impact)).toEqual([...out.paid.receipts.map((r) => r.impact)].sort((a, b) => b - a)); // one record per funded key, never fewer, AND THE PASS WALKS THE MONEY'S OWN ORDER, worth first and family nowhere: the walk takes budget.funded as it stands, so the receipt comes back in that order with what each job is worth never rising down the list
    for (const r of out.paid.receipts) { expect(typeof r.key).toBe("string"); expect(r.funded).toBe(true);
      expect(typeof r.family).toBe("string"); expect((r.family ?? "").length).toBeGreaterThan(0); // WHICH producer owns this money
      expect(r).toHaveProperty("treatment"); // present on every row, null where the job declared none
      expect(typeof r.impact).toBe("number"); expect(Number.isFinite(r.impact)).toBe(true);
      expect(typeof r.allowance).toBe("number"); expect(r.allowance).toBeGreaterThan(0); // the whole price this page was funded at
      expect(typeof r.ops).toBe("number"); expect(typeof r.providerCalls).toBe("number"); expect(typeof r.costUsd).toBe("number");
      expect(r).toHaveProperty("persistence"); // the STORE'S OWN WORD, or null where nothing was written
      expect(["produced", "evidence_banked", "deterministic_refusal", "retryable_blocked", "not_reached"]).toContain(r.outcome);}
    const worked = out.paid.receipts.filter((r) => r.outcome === "produced");
    expect(worked.length).toBeGreaterThan(0);
    expect(worked.every((r) => (r.ops > 0 && ["saved", "unchanged", "not_persisted"].includes(r.persistence ?? "")) || (r.why ?? "").includes("already on file"))).toBe(true); // produced means the store took it, this pass or a previous one whose finished row still covers the mutation
    expect(worked.every((r) => r.providerCalls === 0 && r.costUsd === 0 && r.providerAttempted === false)).toBe(true);
    reset(SEEN()); const before2 = await run(counting().complete);
    reset(SEEN()); env.refuseIds = new Set(before2.proposals.map((p) => p.id));
    const refused = (await run(counting().complete)).paid.receipts.filter((r) => r.outcome === "deterministic_refusal");
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((r) => (r.why ?? "").endsWith("to be offered"))).toBe(true); // the sentence ENDS where it ends, not at 200 characters
    expect(refused.every((r) => r.persistence === "refused")).toBe(true); }); /** PRODUCED MEANS A READY ROW IS ON FILE WHEN THE PASS ENDS (live, two answer blocks in one drive, 2026-09-03). The receipt was bound to the SAVE, and a later save in the same pass then put the re-minted brief back on the row: two receipts said produced at 02:11 and 02:32, the ready queue never moved, and the day's memory wrote both keys off as finished work. Every produced claim is re-read against the row that really stands before the receipt leaves the pass. */
  it("never calls work produced that its own final rows cannot show as Ready", async () => { reset(SEEN()); const out = await run(counting().complete);
    const ready = out.proposals.filter((p) => p.status === "ready" && p.researchOnly !== true), produced = out.paid.receipts.filter((r) => r.outcome === "produced"); expect([produced.length > 0, produced.length <= ready.length, produced.every((r) => ["saved", "unchanged"].includes(r.persistence ?? "")), out.paid.receipts.filter((r) => r.outcome === "review_saved").every((r) => (r.why ?? "").includes("so nothing finished reached the queue")), produced.every((r) => [...env.store.values()].some((p) => p.status === "ready" && p.researchOnly !== true && `${r.key}::`.startsWith(`${(p.pagePath ?? "").trim().toLowerCase()}::`)))], "the pass really does finish work, it never claims more finished rows than it hands back, every claim is one the store took, a draft that was written and stored says exactly that whichever door filed it, and every produced claim is re-read against the STORE when the pass ends: the page it names really is carrying a ready row, never a brief the queue cannot show").toEqual([true, true, true, true, true]); });
  it("writes a new generation the moment the material content changes, and ignores a moved clock", () => {
    const p = baseProposal(); expect(proposalFingerprint({ ...p, createdAt: "2026-07-27T09:00:00.000Z" })).toBe(proposalFingerprint(p)); // a new timestamp is not new thinking
    for (const changed of [{ ...p, status: "needs_review" as const }, { ...p, confidence: "low" as const }, { ...p, basis: "after the business changed" }, { ...p, whyItMatters: `${p.whyItMatters} Said again, sharper.` }, { ...p, opportunityType: "A headline that says the thing itself" },
      { ...p, recommendedChange: { kind: "existing_edit" as const, field: "title" as const, before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" } }]) expect(proposalFingerprint(changed)).not.toBe(proposalFingerprint(p)); });
  it("keeps the cause that actually produced the change, and still names one for a change that brought none", async () => {
    reset(SEEN()); // A LANDED BUNDLE THAT BRINGS NO CAUSE OF ITS OWN. A page the deep door selected declares the whole-page rewrite and no shallow draft beside it (paying for the field edit that rewrite replaces funded one page twice), so the rewrite is the change this half is about.
    env.bundle = { status: "bundled", proposal: baseProposal({ id: "fixture-tenant::/nowruz-guide::existing_edit::bundle", pagePath: "/nowruz-guide", pageUrl: "https://fixture-outdoors.example/nowruz-guide" }) };
    const plain = await run(counting().complete); const here = plain.candidates.find((c) => c.action === "act_existing_page")!.cause.cause;
    expect(plain.proposals.find((p) => p.id.endsWith("::bundle"))!.diagnosisCause).toBe(here); expect(here).not.toBe("weak_opening"); // the ladder here reaches a DIFFERENT cause: the whole fixture
    reset(SEEN());
    const own = { cause: "weak_opening" as const, action: null, evidenceKeys: ["demand-exact"], competingExplanations: [], notConsidered: [], falsifier: "If the page already answers the search in its first lines, this is not it.", explanation: "The page takes too long to answer the search." };
    env.bundle = { status: "bundled", proposal: baseProposal({ id: "fixture-tenant::/nowruz-guide::existing_edit::bundle",
      pagePath: "/nowruz-guide", pageUrl: "https://fixture-outdoors.example/nowruz-guide", diagnosisCause: "weak_opening", causeFinding: own }) };
    const res = await run(counting().complete); const bundled = res.proposals.find((p) => p.id.endsWith("::bundle"))!; expect([bundled.diagnosisCause, bundled.causeFinding!.cause]).toEqual(["weak_opening", "weak_opening"]); });
  it("calls a pass that saved nothing a FAILURE, and a real gap with no trusted draft exactly that", async () => { reset(SEEN()); env.failWrites = true; const failed = await run(counting().complete);
    expect([failed.outcome, failed.persisted, env.saved.length]).toEqual(["persistence_failed", 0, 1]); // it tried, and it says so
    expect(failed.paid.receipts.every((r) => r.outcome !== "deterministic_refusal" && (r.outcome !== "produced" || (r.why ?? "").includes("already on file")))).toBe(true); // a failing-writes pass produced nothing NEW; a mutation a stored Ready row already covers is still honestly reported finished
    reset(SEEN()); const first = await run(counting().complete);
    const landed = first.paid.receipts.filter((r) => r.outcome === "produced").map((r) => r.key); expect(landed.length).toBeGreaterThan(0);
    reset(SEEN()); env.failIds = new Set([...env.store.keys(), ...first.proposals.map((x) => x.id)]); const mixed = await run(counting().complete);
    expect(mixed.paid.receipts.filter((r) => landed.includes(r.key) && r.outcome !== "already_complete" && r.outcome !== "superseded").every((r) => r.outcome === "retryable_blocked")).toBe(true); // a stored Ready row that still covers its mutation is not something the store refused, and stays reported finished
    expect(env.store.size).toBe(0); // and nothing the store refused is remembered as if it had landed
    reset(SEEN()); const thin = await run(async () => ({ error: "the drafter is off", retryable: false })); expect([thin.outcome, thin.actionable, thin.noDraft, thin.proposals.every((p) => p.status === "needs_review")]).toEqual(["proposals_persisted", 1, 1, true]);
    expect(thin.paid.funded.length > 0 && thin.paid.receipts.every((r) => r.outcome === "retryable_blocked" || r.outcome === "not_reached")).toBe(true); }); // the strict draft failed and the $0 producers still fill the queue, every row at needs_review
}); // ── research: what the pass is investigating, and what a run buys next ────────
const HAFT = "haft seen table"; const LOOKED_AT = "2026-07-25T00:00:00.000Z"; const RIVAL = (n: number) => `https://r${n}.example/a`; const DEMAND: EvidenceSnapshot["keywordDemand"] = [{ query: HAFT, searchVolume: 900, source: "dataforseo", competition: null, competitionLevel: null, gscImpressions: null }]; const COMPARED = [`https://${GAP_URL}`, RIVAL(1), RIVAL(2), RIVAL(3)].sort();
/** A dated look whose results agree on one meaning and one shape, with an intent on file: everything settled except the pages themselves. */ const GUIDED: FunnelResearchEvidence = { ...emptyResearchEvidence(), retainedKeywords: [{ query: HAFT, searchVolume: 900, competition: null, competitionLevel: null, difficulty: null, intent: "informational", discoveredVia: "gsc", seed: null }],
  serpEvidence: [{ query: HAFT, observedAt: LOOKED_AT, aiOverview: [], aiMode: [], paa: [], related: [], organic: [1, 2, 3].map((rank) => ({ rank, domain: `r${rank}.example`, url: RIVAL(rank), title: `${HAFT} guide` })) }] };
/** Every cheaper check behind me: three publishers, my own page on those results, and the answer to exactly the comparison this pass would buy. */ const READY = (over: Partial<ResearchPageComparison> = {}): FunnelResearchEvidence => ({ ...GUIDED, serpEvidence: [{ ...GUIDED.serpEvidence[0]!, organic: [...GUIDED.serpEvidence[0]!.organic, { rank: 4, domain: "fixture-outdoors.example", url: GAP_URL, title: "Nowruz" }] }], winningPages: [1, 2, 3].map((n) => ({ url: RIVAL(n), domain: `r${n}.example`, engines: [], examplePrompts: [], appearances: [{ kind: "serp_organic" as const, query: HAFT, promptId: null, promptText: null, engine: null, rank: n, citedUrl: RIVAL(n), observedAt: LOOKED_AT, modelServed: null }], extract: { title: "g", h1: "g", wordCount: 900, headings: [], faqCount: 0, fetchedAt: LOOKED_AT } })), pageComparisons: [{ topicKey: "", askKey: askIdentity({ pages: COMPARED, intersection_mode: "union" }), pages: COMPARED, excludePages: [], observedAt: LOOKED_AT, receipt: null, unavailable: null, comparison: { intersectionMode: "union", excludePages: [], pages: COMPARED.map((url, i) => ({ page: i + 1, url })), keywords: ["haft seen table on wikipedia.org", "b", "c"].map((keyword, i) => ({ keyword, searchVolume: 500, competition: null, competitionLevel: null, difficulty: null, mainIntent: "informational", ranks: (i === 2 ? [3, 4] : [2, 3]).map((page) => ({ page, url: COMPARED[page - 1]!, title: null, rank: page })) })) }, ...over }] });
const keyOf = (research: FunnelResearchEvidence): string => buildTopicInvestigations(snap([GAP], research, DEMAND)).find((i) => i.label === HAFT)!.key;
/** One bought comparison, written as which requested page ranks for which search (page 1 is my own). */ const comparisonOf = (rows: Array<[string, number[]]>) => ({ intersectionMode: "union" as const, excludePages: [], pages: COMPARED.map((url, i) => ({ page: i + 1, url })),
  keywords: rows.map(([keyword, ranks]) => ({ keyword, searchVolume: 500, competition: null, competitionLevel: null, difficulty: null, mainIntent: "informational", ranks: ranks.map((page) => ({ page, url: COMPARED[page - 1]!, title: null, rank: page })) })) });
describe("the pass says what it is investigating without turning any of it into work", () => {
  it("carries the research packets, picks the SAME strongest topic from the same evidence, and proposes nothing off them", async () => {
    const world = () => snap([WINNER], looked([["nowruz traditions", GAP_URL]])); // a page with no gap, plus one results page I have read
    let called = 0; const complete: CompleteFn = async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; };
    reset(world()); const first = await produceProposalsForTenant("fixture-tenant", { complete, now: NOW }); reset(world()); const again = await produceProposalsForTenant("fixture-tenant", { complete, now: NOW });
    expect(first.investigations.length).toBeGreaterThan(0); expect(first.coverage).toEqual(again.coverage); // the packet reaches the pass, and the same evidence reaches the same answer every time
    expect([called, first.proposals.every((p) => p.researchOnly === true || p.status === "needs_review")]).toEqual([0, true]); }); // no candidate earns a DRAFT; the $0 queue may still mint research-only work
  it("queues one search per topic and only what buying can actually close", async () => {
    const asked = canon({ promptId: "p1", promptText: "where do I see nowruz fire jumping", engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [], fanOutQueries: ["nowruz fire jumping"], observedAt: LOOKED_AT });
    reset(snap([GAP, WEAK], { ...GUIDED, aiObservations: [asked] }, DEMAND)); // one topic never looked at, one whose winners I have not read, and two searches my own pages are losing that are no topic at all
    expect(await queued("fixture-tenant")).toEqual(["nowruz traditions", "nowruz food traditions", "haft seen table"]); // MY OWN FALLING SEARCHES FIRST, biggest shortfall first, and A SEARCH IS SOMETHING LEFT TO BUY: the researched topic is diminishing on its winner window and still keeps its slot, which is the day 8 to 30 shape a look going stale creates
    reset(snap([GAP], looked([[HAFT, GAP_URL]], LOOKED_AT))); expect(await queued("fixture-tenant")).toEqual(["nowruz traditions"]); }); // the mixed-meaning look settles nothing and releases its slot, so the plan buys the results page my own losing search never had
  it("reaches a final verdict from the comparison it already bought, and refuses one bought for a different topic, a different ask or a basis it cannot read", async () => {
    const key = keyOf(READY()); reset(snap([GAP], READY({ topicKey: key }), DEMAND)); const held = await produceProposalsForTenant("fixture-tenant", { now: NOW });
    expect([held.coverage!.investigation.key, held.coverage!.decision.verdict, held.coverage!.decision.missing]).toEqual([key, "create_new", []]); // nothing injected, and nothing bought twice
    for (const drift of [{ topicKey: "inv_somebody_else" }, { topicKey: key, pages: [...COMPARED, "https://r9.example/a"] }]) { // an answer to another question, and an answer to another set of pages
      const research = READY(drift); const stuck = await readCoverage(snap([GAP], research, DEMAND), "fixture-tenant", { basis: "basis_today", maxQueries: 1 });
      expect([stuck.decided, stuck.needs[0]!.requirement, stuck.needs[0]!.comparison !== null]).toEqual([null, "page_intersection", true]); }
    const blind = await readCoverage(snap([GAP], READY({ topicKey: key }), DEMAND), "fixture-tenant", { basis: null, maxQueries: 1 }); // a basis I cannot read proves nothing current
    expect([blind.decided, blind.needs[0]!.requirement]).toEqual([null, "page_intersection"]);
    const quiet = await readCoverage(snap([GAP], READY({ topicKey: "inv_nobody" }), DEMAND), "fixture-tenant", { basis: "basis_today" }); // asked for no research: none is queued, comparison included
    expect(quiet.needs).toEqual([]); });
  it("keeps ONE identity for a case when a fresh look lands, so a plan frozen mid-run can still reconfirm its own topic", () => {
    const aiObservations = [canon({ promptId: "p9", promptText: HAFT, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [], fanOutQueries: [], observedAt: LOOKED_AT })];
    const at = (r: FunnelResearchEvidence) => buildTopicInvestigations(snap([GAP], { ...r, aiObservations }, DEMAND))[0]!; // the case before I looked at Google at all, then after I bought the very look it was owed
    const one = at(emptyResearchEvidence()), two = at(GUIDED); // before the look, and after it
    expect([two.key, two.queries[0] === one.queries[0]]).toEqual([one.key, true]); }); // the case is never renamed when the look it asked for lands
  it("buys a comparison only for a topic THIS run froze, under the basis it froze it under, even when the plan holds several", async () => {
    const key = keyOf(READY()); reset(snap([GAP], READY({ topicKey: "inv_bought_for_nobody" }), DEMAND)); // the comparison is still owed, and the plan is up to three topics, not one
    const plan = await chooseInvestigation("fixture-tenant", "basis_today"); expect(plan!.topics.length).toBeGreaterThan(0);
    const mixed = { basis: "basis_today", topics: [{ topicKey: "inv_not_this_run", query: "something else", requirement: "exact_search" }, ...plan!.topics] };
    expect([(await comparisonForFocus("fixture-tenant", mixed, "basis_today"))?.topicKey, // the earned one, picked out of a plan holding a stranger
      await comparisonForFocus("fixture-tenant", { basis: "basis_today", topics: mixed.topics.slice(0, 1) }, "basis_today"), // a plan this run froze that never earned this comparison
      await comparisonForFocus("fixture-tenant", mixed, "basis_moved_on")]).toEqual([key, null, null]); }); }); // and one frozen under a basis the account has left
/** A SECOND topic that outranks the one holding the comparison and that no purchase can move: bigger demand, results I have read, and a page of my own that could already be the answer whose words I have never held. */
const PARKED = "nowruz table settings"; const PARK_RIVAL = (n: number) => `https://p${n}.example/a`; const UNREAD_URL = "fixture-outdoors.example/nowruz-table";
const UNREAD: OwnedPageEvidence = { ...ownedPage(UNREAD_URL, "T", { impressions: 10, clicks: 1 }, []), content: null };
const PARKED_DEMAND: EvidenceSnapshot["keywordDemand"] = [{ query: PARKED, searchVolume: 2000, source: "dataforseo", competition: null, competitionLevel: null, gscImpressions: null }];
const withParked = (r: FunnelResearchEvidence): FunnelResearchEvidence => ({ ...r, retainedKeywords: [...r.retainedKeywords, { query: PARKED, searchVolume: 2000, competition: null, competitionLevel: null, difficulty: null, intent: "informational", discoveredVia: "gsc", seed: null }],
  serpEvidence: [...r.serpEvidence, { query: PARKED, observedAt: LOOKED_AT, aiOverview: [], aiMode: [], paa: [], related: [], organic: [...[1, 2, 3].map((rank) => ({ rank, domain: `p${rank}.example`, url: PARK_RIVAL(rank), title: `${PARKED} guide` })), { rank: 4, domain: "fixture-outdoors.example", url: UNREAD_URL, title: "T" }] }],
  winningPages: [...r.winningPages, ...[1, 2, 3].map((n) => ({ url: PARK_RIVAL(n), domain: `p${n}.example`, engines: [], examplePrompts: [], appearances: [{ kind: "serp_organic" as const, query: PARKED, promptId: null, promptText: null, engine: null, rank: n, citedUrl: PARK_RIVAL(n), observedAt: LOOKED_AT, modelServed: null }], extract: { title: "g", h1: "g", wordCount: 900, headings: [], faqCount: 0, fetchedAt: LOOKED_AT } }))] });
/** A brief with no figure, no address and no question the evidence did not supply. */
const BRIEF = { proposedTitle: "The haft seen table, and what belongs on it", metaDescription: "What a haft seen table is, what goes on it, and how families set one out for the new year.", openingAnswer: "A haft seen table is the spread a household sets out for the new year, and each item on it stands for something the family hopes the year will bring.",
  whyExistingPagesLose: "Your page fixture-outdoors.example/nowruz-guide covers the wider holiday and never sets out the table itself, so stretching it would bury the answer people are looking for.", sections: ["What a haft seen table is", "What goes on the table", "How families set the table out"].map((heading) => ({ heading, covers: "Answer this plainly and name what belongs on it.", evidenceKeys: ["verdict"] })),
  sourceRequirements: ["Cite a cultural reference for what each item stands for."], factRequirements: ["Check every item name against a source before this goes out."], internalLinks: [{ url: GAP_URL, anchor: "the wider holiday" }], faqQuestions: [], headKeys: ["verdict"] };
/** THE PAGE'S OWN SECTIONS, through the ONE canonical editor a section of an existing page goes through: a Ready new page carries copy, never a plan, and every section of it declares what it asserts and names the stored id that carries it. `cited` picks whatever the packet really handed over, so a fixture never claims an id nobody gave it. */
const cited = (user: string): string => ["owned-page-1", "page-copy-1", "page-heading-1", "page-title"].find((id) => user.includes(`${id}:`)) ?? "page-title";
const sectionDraft = (user: string, heading = (user.match(/Write the section headed "(.*?)"/) ?? [])[1] ?? "The table") => ({ ...VALID_ATOMIC_EDIT, field: "answer_block", before: null,
  after: `${heading}: a haft seen table is the spread a household sets out for the new year, and every piece on it stands for something the family hopes the year will bring. It says what belongs there and why, in the words a reader looking for ${heading.toLowerCase()} would use.`,
  naturalHeading: heading, placementAnchor: BRIEF.proposedTitle, implementationMinutes: 15, claims: [{ text: "The table is set out.", supportedBy: [cited(user)] }] });
const judged = (user: string) => ({ pageFit: true, resolvesDiagnosis: true, claims: [{ i: 0, by: [cited(user)], entailed: true }], usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "It says what belongs on the table, which nothing else here does.", resolution: "none" });
/** One whole drafting pass for a page: the brief, then every planned section, each read for sense. `sections: false` refuses one. */
const pageSeam = (brief: unknown, sections = true): CompleteFn => async ({ kind, user }) => ({ value: (kind === "new_page_brief" ? brief : kind === "editor_judgement" ? judged(user)
    : kind === "atomic_edit" ? (sections || user.includes('Write the section headed "What a haft seen table is"') ? sectionDraft(user) : {}) : VALID_ATOMIC_EDIT) as never });
const briefSeam = (brief: unknown = BRIEF): { complete: CompleteFn; kinds: string[] } => { const kinds: string[] = []; const inner = pageSeam(brief);
  return { kinds, complete: async (r) => { kinds.push(r.kind); return inner(r); } }; };
describe("a new page needs a positive yes, never just the absence of a no", () => {
  it("authorizes a topic the account's own confirmations or demand tie to, and refuses one nothing ties to", async () => {
    const { topicPositivelyAuthorized } = await import("@/domains/decision/owned-coverage"); const world = snap([GAP], READY(), DEMAND); const tied = buildTopicInvestigations(world).find((i) => i.label === HAFT)!;
    expect(topicPositivelyAuthorized(world, tied, null)).toBe(true); // the operator's own anchors reach it
    const drifted = { ...tied, label: "submarine cable maintenance", queries: ["submarine cable maintenance"] }; expect(topicPositivelyAuthorized(world, drifted, null)).toBe(false);});});
describe("a subject I own no page for becomes ONE researched page, and nothing else does", () => {
  it("reads a page of mine whose words are already stored, decides again in the SAME pass, and still judges the topic that OWNS the comparison", async () => {
    const research = withParked(READY({ topicKey: keyOf(READY()) })); const world = snap([GAP, UNREAD], research, [...DEMAND, ...PARKED_DEMAND]);
    const order = buildTopicInvestigations(world); const parked = order.find((i) => i.label === PARKED)!;
    const read = await readCoverage(world, "fixture-tenant", { basis: "basis_today", maxQueries: 3, now: NOW }); // the clock is injected: the stored body's currency is judged against the fixture's day, never the wall
    expect(rankInvestigations(order)[0]!.key).toBe(parked.key); // it ranks first, and its own page sat unread while its words were already on file
    expect(read.needs.find((n) => n.topicKey === parked.key)?.requirement).toBe("page_intersection"); // one bounded read moved it on without sending the operator away
    expect([read.decided!.investigation.label, read.decided!.decision.verdict]).toEqual([HAFT, "create_new"]); }); // and the comparison I paid for is read for the topic that owns it
  it("NAMES the page of mine it cannot judge without, fetches no website at all doing it, and repeats the stored retry date instead of sliding it", async () => {
    const DARK_URL = "fixture-outdoors.example/nowruz-unreadable"; const HOLD = "2026-07-27T00:00:00.000Z";
    const dark: OwnedPageEvidence = { ...ownedPage(DARK_URL, "T", { impressions: 400, clicks: 4 }, [{ query: PARKED, impressions: 400, clicks: 4, position: 6 }]), content: null };
    const world = (ownedReads: FunnelResearchEvidence["ownedReads"] = []) => snap([GAP, UNREAD, dark], { ...withParked(READY({ topicKey: keyOf(READY()) })), ownedReads }, [...DEMAND, ...PARKED_DEMAND]);
    const read = (w: EvidenceSnapshot) => readCoverage(w, "fixture-tenant", { basis: "basis_today", maxQueries: 6, now: NOW }); const owed = (r: Awaited<ReturnType<typeof readCoverage>>) => r.needs.find((n) => n.requirement === "owned_content");
    const net: string[] = []; const realFetch = globalThis.fetch; // ANY website read, by any module, through the one socket a render could use
    globalThis.fetch = (async (u: RequestInfo | URL) => { net.push(String(u)); throw new Error("a render may never reach a website"); }) as typeof fetch;
    try { const named = await read(world()); reset(world()); const produced = await produceProposalsForTenant("fixture-tenant", { now: NOW });
      expect([owed(named)!.ownedUrl, named.waitingUntil, produced.waitingUntil, net]).toEqual([DARK_URL, null, null, []]); // NAMED as plain data; the coverage pass AND a whole surface build fetch nothing
      const first = await read(world([{ url: DARK_URL, state: "temporarily_unavailable", attemptedAt: "2026-07-26T00:00:00.000Z", retryAfter: HOLD }]));
      const again = await read(world([{ url: DARK_URL, state: "temporarily_unavailable", attemptedAt: "2026-07-26T00:00:00.000Z", retryAfter: HOLD }])); // a second visit, one stored outcome
      expect([owed(first)!.retryAfter, first.waitingUntil, owed(again)!.retryAfter, net]).toEqual([HOLD, HOLD, HOLD, []]); // the date is READ off the row, so it is identical every visit and still costs no fetch
    } finally { globalThis.fetch = realFetch; }
    const plan = { basis: "b", topics: [{ topicKey: "t1", query: "still cooling off", requirement: "owned_content", retryAfter: HOLD, ownedUrl: DARK_URL }, { topicKey: "t2", query: "due now", requirement: "exact_serp", retryAfter: null }] };
    const reads = (at: string, basis: string | null = "b") => focusReads(plan, Date.parse(at), basis);
    expect([reads("2026-07-26T00:00:00Z").queries, reads("2026-07-28T00:00:00Z").queries]).toEqual([["due now"], ["still cooling off", "due now"]]); // no search before its cooldown expires
    expect([reads("2026-07-26T00:00:00Z").ownedUrl, reads("2026-07-28T00:00:00Z").ownedUrl, reads("2026-07-28T00:00:00Z", "moved_on").ownedUrl]).toEqual([null, DARK_URL, null]); }); // not before its date, and never for a basis the account has left
  it("finds the comparison AND the live page filed under an id this case absorbed, so neither is bought or built a second time", async () => {
    const key = keyOf(READY()); const anchors = reconcileResearchCases(snap([GAP], READY(), DEMAND)).find((c) => c.id === key)!.anchors;
    const cases = [{ id: "inv_absorbed", anchors: anchors.slice(0, 1) }, { id: key, anchors }]; // two ids on file for one subject, already merged and SAVED
    const world = () => snap([GAP], { ...READY({ topicKey: "inv_absorbed" }), cases }, DEMAND); // the comparison was paid for under the absorbed id
    reset(world()); const built = await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW });
    expect([built.coverage!.investigation.aliasKeys, built.coverage!.decision.verdict, built.coverage!.decision.missing]).toEqual([["inv_absorbed"], "create_new", []]); // read, not re-bought
    const page = built.proposals.find((p) => p.kind === "new_page")!; const under = { ...page, id: page.id.replace(key, "inv_absorbed") };
    reset(world()); env.store = new Map([[under.id, under]]); const again = briefSeam(); const res = await produceProposalsForTenant("fixture-tenant", { complete: again.complete, now: NOW });
    expect([again.kinds, res.reused, res.proposals.filter((p) => p.kind === "new_page").map((p) => p.id)]).toEqual([[], 1, [under.id]]); }); // zero brief calls, and ONE page for one subject
  it("builds exactly ONE new page from the earned verdict, carrying the WHOLE page, and holds it for the look it owes", async () => {
    const asked = [canon({ promptId: "p9", promptText: HAFT, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [], fanOutQueries: [], observedAt: LOOKED_AT })];
    reset(snap([GAP], { ...READY({ topicKey: keyOf(READY()) }), aiObservations: asked }, DEMAND)); const seam = briefSeam();
    const res = await produceProposalsForTenant("fixture-tenant", { complete: seam.complete, now: NOW });
    expect(seam.kinds).toEqual(["new_page_brief", ...[0, ...BRIEF.sections].flatMap(() => ["atomic_edit", "editor_judgement"])]); // the brief, then the opening and every planned section, each written and read by the ONE canonical editor
    expect(seam.kinds).not.toContain("section_draft"); // the second drafter that declared no claim and named no evidence id is gone
    const pages = res.proposals.filter((p) => p.kind === "new_page"); expect(pages).toHaveLength(1);
    const page = pages[0]!; expect(page.recommendedChange).toEqual({ kind: "new_page", proposedTitle: BRIEF.proposedTitle, metaDescription: BRIEF.metaDescription,
      openingAnswer: expect.stringContaining("a haft seen table is the spread"), outline: BRIEF.sections.map((s) => s.heading), faqQuestions: [], schemaTypes: [] }); // no markup is guessed for a page that does not exist yet // THE OPENING IS WRITTEN AND READ LIKE EVERY OTHER PIECE: the brief's own sentence is nobody's ruled claim, so what ships is the editor's copy, not the plan that asked for it.
    expect([page.status, page.pagePath, page.publish, validateProposal(page).verdict]).toEqual(["needs_review", null, "manual", "ready"]);
    expect(page.bundle!.plan).toBeUndefined(); expect(page.bundle!.receipt.items.some((i) => i.key === "verdict")).toBe(true); // a page that does not exist yet has nothing to keep, change or remove, and the verdict itself is on the receipt
    expect([page.bundle!.receipt.items.find((i) => i.key === "asked")!.fact, page.bundle!.receipt.items.find((i) => i.key === "asked")!.observationId]).toEqual(['No AI engine has shown a search of its own here. What is on file is a question people ask, like "haft seen table".', undefined]); // derived from a question I track, not from any stored answer, so it borrows no answer's identity expect(page.bundle!.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer", "section", "source_pack", "internal_links"]);
    const written = page.bundle!.components.find((c) => c.kind === "section")!.after; for (const s of BRIEF.sections) expect(written).toContain(`${s.heading}: a haft seen table is the spread`);
    expect(written).not.toContain("Answer this plainly"); // the brief's own instruction never ships as the page
    const pack = page.bundle!.components.find((c) => c.kind === "source_pack")!.after; expect(pack).toContain(`${RIVAL(1)}, published by r1.example, read on Jul 25: it is one of the pages that win "${HAFT}"`);
    expect(pack).toContain("Cite a cultural reference for what each item stands for. You pick the exact source for this one");
    expect(page.limitations).toContain("Some of what this page claims still rests on the kind of source it needs rather than a source on file, so you pick those before it goes out.");
    expect([page.claims!.every((c) => c.supportedBy.every((id) => id.startsWith("page-"))), page.informationGain?.pageWhole]).toEqual([true, true]); // A PAGE BUILT ONLY FROM WHAT WINS THIS SEARCH STAYS INTERNAL AND LEAVES NAMED DEBT: coverage adjudication authorized the NEED and the results pages the FORMAT, and neither carries a sentence, so its own words are the only thing under its claims and the door says so and mints the source it is missing.
    expect([openHold(page).blocking, openHold(page).need?.reasonCode]).toEqual([expect.stringContaining("rests on nothing checked"), "claim_unsupported"]);
    const queue = await loadProposalQueue("fixture-tenant", { currentBasis: page.basis!, now: NOW }); expect(queue.toDo.map((p) => p.id)).toContain(page.id); // held for a look, never shown ready. THE CLOCK IS A SEAM AND A FIXED-CLOCK FIXTURE MUST USE IT: without `now` the queue judges this row's receipt against the REAL day, so every "current claim" item read as stale the moment UTC rolled over and the row vanished from every lane. The gate went red at 00:00 on code that had passed all day, which is a date bomb and not a regression.
    const again = await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW }); expect(again.reused).toBe(1); // a refresh re-pays nothing
    const said = { competitors: [{ name: "waterwise", position: 1 }], materialOmissions: ["what it costs currently"] }; // TWO answers say the same thing, and one statement claims the present, which may never be shown on a line I did not read today
    reset(snap([GAP], { ...READY({ topicKey: keyOf(READY()) }), aiObservations: [{ ...asked[0]!, fanOutQueries: [`what goes on a ${HAFT}`], analysis: said }, { ...asked[0]!, observationId: "obs_fx2", promptId: "p10", engine: "gemini", analysis: said }] }, DEMAND));
    const built = (await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW })).proposals.find((p) => p.kind === "new_page")!; const at = (k: string) => built.bundle!.receipt.items.find((i) => i.key === k)!;
    expect([at("asked").fact, at("asked").observationId]).toEqual([`To answer this, an AI engine went and searched 1 thing of its own, like "what goes on a ${HAFT}".`, "obs_fx"]); expect([at("named1").observationIds, at("named1").observationId]).toEqual([["obs_fx", "obs_fx2"], undefined]);
    expect(built.bundle!.receipt.missing).toContain("I withheld 1 time-sensitive statement from these answers because I cannot confirm it is still current."); }); // the page producer obeys the same contract as the repair producer: whole support named, withholding disclosed
  it("proposes NOTHING when a planned section will not write, and holds a page it has no source of its own for", async () => {
    reset(snap([GAP], READY({ topicKey: keyOf(READY()) }), DEMAND)); // one section short is no page at all
    const partial = await produceProposalsForTenant("fixture-tenant", { complete: pageSeam(BRIEF, false), now: NOW });
    expect(partial.proposals.every((p) => p.kind !== "new_page")).toBe(true); expect(env.saved.every((p) => p.kind !== "new_page")).toBe(true);
    const unread = READY({ topicKey: keyOf(READY()) }); // and a page resting on "some source of this kind" is never Ready
    reset(snap([GAP], { ...unread, winningPages: unread.winningPages.map((w) => ({ ...w, extract: { ...w.extract!, fetchedAt: "2026-01-01T00:00:00.000Z" } })) }, DEMAND));
    const held = (await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW })).proposals.find((p) => p.kind === "new_page");
    if (!held) return; // an unread winner can also close the verdict, which is its own honest answer
    expect([held.status, held.bundle!.components.find((c) => c.kind === "source_pack")!.after.includes("You pick the exact source for this one")]).toEqual(["needs_review", true]);
    expect(held.limitations).toContain("I hold no source of my own behind the claims on this page, so you pick every one of them before it goes out."); });
  it.each([["the winners share too little to be a pattern", [["a", [2, 3]], ["b", [2, 3]]], "do_nothing"], ["a page I already have carries the cluster", [["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]], "improve_existing"], ] as Array<[string, Array<[string, number[]]>, string]>)("answers %s without building anything", async (_what, rows, verdict) => {
    const research = READY({ topicKey: keyOf(READY()), comparison: comparisonOf(rows) }); reset(snap([GAP], research, DEMAND)); const seam = briefSeam();
    const res = await produceProposalsForTenant("fixture-tenant", { complete: seam.complete, now: NOW });
    expect(res.coverage!.decision.verdict).toBe(verdict); expect(seam.kinds).not.toContain("new_page_brief"); expect(res.proposals.every((p) => p.kind !== "new_page")).toBe(true); });
  it("proves the gap from addresses, asks for the bodies it can still read, and parks for good when no winner will let me read one", async () => {
    const thin = READY({ topicKey: keyOf(READY()) }); const blind = (readOutcome: WinnerReadOutcome | null) => snap([GAP], { ...thin, winningPages: thin.winningPages.map((w) => ({ ...w, extract: null, readOutcome })) }, DEMAND); reset(blind(null)); const asks = await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW });
    reset(blind({ state: "robots_blocked", attemptedAt: LOOKED_AT, retryAfter: "2099-01-01T00:00:00.000Z" })); const shut = await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW }); reset(blind({ state: "temporarily_unavailable", attemptedAt: LOOKED_AT, retryAfter: "1999-01-01T00:00:00.000Z" })); const due = await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW });
    expect([asks.coverage, due.coverage, shut.coverage!.decision.verdict, shut.proposals.some((p) => p.kind === "new_page")]).toEqual([null, null, "do_nothing", false]); }); // ask while a read is left, park when every winner has refused me
  it("throws away a brief that names a site, a page, a question or a figure nobody gave it", async () => {
    const strays = [{ proposedTitle: "What r9.example says about the haft seen table" }, { internalLinks: [{ url: "fixture-outdoors.example/invented", anchor: "x" }] }, { faqQuestions: ["Where can I buy a haft seen table set"] }, { sections: BRIEF.sections.map((s) => ({ ...s, evidenceKeys: ["made-up"] })) },
      { factRequirements: ["Check this against nowruz.ai before it goes out."] }, { sourceRequirements: ["Check every item name against persianculture.wiki first."] }, // suffixes neither net had heard of
      { openingAnswer: `${BRIEF.openingAnswer} Nine in ten households set one out.` }, { metaDescription: `${BRIEF.metaDescription} I will put this page live for you once you accept.` }, // a proportion with no digit in it, and a promise no draft may make
      { openingAnswer: `${BRIEF.openingAnswer} Around 91% of households set one out.` }, // a figure the evidence never supplied
      { sourceRequirements: ["Cite the 4,500 searches a month this phrase gets."] }, // and one smuggled in as a requirement rather than a claim
      { headKeys: ["made-up"] }];
    for (const stray of strays) { reset(snap([GAP], READY({ topicKey: keyOf(READY()) }), DEMAND));
      const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: pageSeam({ ...BRIEF, ...stray }) });
      expect(res.proposals.every((p) => p.kind !== "new_page")).toBe(true); expect(env.saved.every((p) => p.kind !== "new_page")).toBe(true); }
    reset(snap([GAP], READY({ topicKey: keyOf(READY()) }), DEMAND)); // a question I DID supply survives even though it names a site, because I am the one who showed it
    expect((await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: pageSeam({ ...BRIEF, faqQuestions: ["haft seen table on wikipedia.org"] }) })).proposals.some((p) => p.kind === "new_page")).toBe(true);
    reset(snap([GAP], READY({ topicKey: keyOf(READY()), comparison: comparisonOf([["k1", [1, 2, 3]], ["k2", [2, 3]], ["k3", [3, 4]], ["k4", [2, 3]]]) }), DEMAND));
    const partly = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: briefSeam().complete }); // the SECOND branch that earns a page: I reach some of this, too little to build on
    const obj = partly.proposals.find((p) => p.kind === "new_page")?.bundle?.objective ?? "";
    expect(obj.includes("none of your own pages")).toBe(false); // never the claim and its contradiction on one screen
    let fig = ""; reset(snap([GAP], READY({ topicKey: keyOf(READY()) }), DEMAND)); // and the figure check is not "no digits allowed": one I DID supply survives
    const ok = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async (r) => { if (r.kind === "new_page_brief") fig = (r.user.match(/\d[\d,]*/) ?? [""])[0];
      return pageSeam({ ...BRIEF, openingAnswer: `${BRIEF.openingAnswer} I count ${fig} of them.` })(r); } });
    expect([fig.length > 0, ok.proposals.some((p) => p.kind === "new_page")]).toEqual([true, true]);
    const ghost: ChangeProposal = { ...baseProposal({ id: "ghost", kind: "new_page", pagePath: null, basis: "basis_today", bundle: undefined, // A row that looks current but carries none of that evidence is an older idea, and it stays off the queue.
      recommendedChange: { kind: "new_page", proposedTitle: "T", metaDescription: "M", openingAnswer: "A", outline: ["One"], faqQuestions: [], schemaTypes: [] } }) };
    env.store = new Map([["ghost", ghost]]); const q = await loadProposalQueue("fixture-tenant", { currentBasis: "basis_today" });
    expect([q.ranked, q.ready, q.toDo].map((l) => l.length)).toEqual([0, 0, 0]); expect(q.demotedStaleBasis).toBe(1); });
}); // ── what the winning pages share, computed on the drafting pass ──────────────
const HEADS = ["What a haft seen table is", "Setting out the table", "What each piece stands for"];
const OPENS = "Families set one of these out at the turn of the year, and every piece on it carries a meaning.";
const rich = (w: FunnelResearchEvidence["winningPages"][number], i: number) => ({ ...w, extract: { title: `${HAFT} guide`, h1: `${HAFT} guide`, wordCount: 900 + i, headings: HEADS, faqCount: 2, fetchedAt: LOOKED_AT, openingSample: OPENS, entityNames: ["Nowruz"] } });
/** A FOURTH ranked winner whose read is months old: it ranks, and I do not currently hold its words. */
const STALE = { url: RIVAL(4), domain: "r4.example", engines: [], examplePrompts: [], appearances: [{ kind: "serp_organic" as const, query: HAFT, promptId: null, promptText: null, engine: null, rank: 4, citedUrl: RIVAL(4), observedAt: LOOKED_AT, modelServed: null }], extract: { title: `${HAFT} guide`, h1: null, wordCount: 200, headings: [], faqCount: 0, fetchedAt: "2026-01-04T00:00:00.000Z" } };
const READABLE = (over: Partial<ResearchPageComparison> = {}): FunnelResearchEvidence => { const r = READY(over); return { ...r, winningPages: [...r.winningPages.map(rich), STALE] }; };
/** A reading in its OWN words: it repeats the shape it was handed, names only what every cited page carries, and writes a gap only against a page of mine. */
const PATTERN = (user: string) => ({ archetype: user.match(/SETTLED: (\w+)/)?.[1] ?? "unknown", commonHeadings: [{ heading: "what each piece means", seenOn: [0, 1, 2] }], commonEntities: [{ entity: "Nowruz", seenOn: [0, 1, 2] }],
  questionsAnswered: ["What belongs on it?"], openingPattern: "Each of them answers the question in its first sentence.", disagreements: ["Some of them call it a custom and others call it a shopping list."],
  ownedGaps: user.includes("I hold no page of my own") ? [] : [{ gap: "your page never walks through the pieces one by one", seenOn: [0, 1, 2] }], uniqueNotCommon: [{ detail: "one of them prices the pieces", seenOn: [1] }] });
describe("what the winning pages share reaches the operator, and never one of their own sentences", () => {
  it("shows the reading MY OWN page before it may name a gap in it, counts only the winners I currently hold, and carries its lines onto the verdict", async () => {
    const research = READABLE({ topicKey: keyOf(READY()), comparison: comparisonOf([["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]]) });
    reset(snap([GAP], research, DEMAND)); let shown = "";
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async ({ kind, user }) => { if (kind !== "winning_pattern") return { value: VALID_ATOMIC_EDIT as never };
      shown = user; return { value: PATTERN(user) as never }; } });
    const d = res.coverage!.decision; expect(d.verdict).toBe("improve_existing");
    expect(shown).toContain("Persian New Year Customs"); expect(shown).not.toContain("I hold no page of my own"); // the page the gap is about was really put in front of it
    expect(shown).toContain(`SETTLED: ${res.coverage!.investigation.pageType}`); // the shape arrives decided, never as a second vote
    expect([d.pattern!.winners, d.pattern!.publishers]).toEqual([3, ["r1.example", "r2.example", "r3.example"]]); // the months-old fourth read is not one of the pages I read
    expect(d.pattern!.ownedGaps[0]!.gap).toContain("piece"); // and the gap stands only because the page it is about was supplied
    expect(d.evidence!.find((e) => e.id === "gap1")!.fact).toContain("Your own page does not do what 3 of them do"); expect(d.evidence!.find((e) => e.id === "pattern")!.fact).toContain("The 3 pages that win here were read side by side"); });
  it("puts what each winner contributed into the page it drafts, in the verdict's own words", async () => { reset(snap([GAP], READABLE({ topicKey: keyOf(READY()) }), DEMAND));
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async (r) => (r.kind === "winning_pattern" ? { value: PATTERN(r.user) as never } : pageSeam(BRIEF)(r)) });
    const page = res.proposals.find((p) => p.kind === "new_page")!; const keys = page.bundle!.receipt.items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["pattern", "look"])); // the verdict's OWN lines, and ONE check per source read rather than one per row
    expect(keys).not.toContain("gap1"); // no page of this account covers this subject, so none was supplied and no gap was ever written
    expect(page.bundle!.receipt.items.find((i) => i.key === "pattern")!.fact).toContain("3 of the 3 cover what each piece means."); }); }); // ── every door reaches the deep producer, not only a proven click gap ─────────
/** A page the click door can NEVER select: about 27 clicks short of the 50 a change owes, and its displayed line already carries the searcher's words. */
const WHOLE = ownedPage(GAP_URL, `${HAFT} guide for Nowruz`, { impressions: 900, clicks: 45 }, [{ query: HAFT, impressions: 900, clicks: 45, position: 4.1 }], ["Persian New Year Customs", "what each piece means"]);
const SPLIT_URL = "fixture-outdoors.example/haft-seen-table";
const ASKED = canon({ promptId: "p8", promptText: `what goes on a ${HAFT}`, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [{ url: RIVAL(1), domain: "r1.example", title: "g" }], fanOutQueries: [HAFT], observedAt: LOOKED_AT });
const doorWorld = (over: Partial<FunnelResearchEvidence> = {}, pages: OwnedPageEvidence[] = [WHOLE], can: EvidenceSnapshot["cannibalization"] = []): EvidenceSnapshot => {
  const r = READABLE({ comparison: comparisonOf([["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]]) });
  const research = { ...r, serpEvidence: [{ ...r.serpEvidence[0]!, organic: [...GUIDED.serpEvidence[0]!.organic, { rank: 4, domain: "fixture-outdoors.example", url: GAP_URL, title: `${HAFT} guide` }] }], ...over };
  const world = { ...snap(pages, research, DEMAND), cannibalization: can };
  const key = buildTopicInvestigations(world).find((i) => i.label === HAFT)?.key ?? ""; // The comparison is pinned to the case THIS world actually builds, so an extra answer in the evidence never orphans it.
  return { ...world, research: { ...research, pageComparisons: (research.pageComparisons ?? []).map((c) => ({ ...c, topicKey: key })) } };};
/** The REAL producer, through the REAL pass: nothing about the deep change is stubbed here. */
const doorRun = (world: EvidenceSnapshot, read: (u: string) => unknown = PATTERN) => { reset(world); env.realBundle = true;
  return produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: async (r) => (r.kind === "winning_pattern" ? { value: read(r.user) as never } : pageSeam(BRIEF)(r)) }); };
describe("a page earns the deep read through the door its own evidence opens", () => {
  it("acts on a page with ZERO recoverable clicks because my comparison named it, off the comparison's own search", async () => { const res = await doorRun(doorWorld());
    expect(res.candidates.every((c) => c.action !== "act_existing_page")).toBe(true); // no click gap anywhere: the old pass stopped here
    expect([env.door!.door, env.door!.evidence.query]).toEqual(["coverage_verdict", HAFT]); const deep = res.proposals.find((p) => p.bundle)!;
    expect(deep.primaryQuery).toBe(HAFT); // the door's own search, never a gap query that does not exist
    expect(deep.bundle!.components.every((c) => c.kind !== "title")).toBe(true);
    expect(deep.impactScore).toBeNull(); // no proven size, so it ranks as a direction and claims no clicks
  });
  it("never opens a second deep door on AI evidence: the comparison's own door holds, and the staged case path owns AEO (2026-08-19)", async () => {
    const noGaps = (u: string) => ({ ...PATTERN(u), ownedGaps: [], openingPattern: "" });
    const res = await doorRun(doorWorld({ aiObservations: [ASKED] }), noGaps); expect([env.door!.door, env.door!.evidence.query]).toEqual(["coverage_verdict", HAFT]); const deep = res.proposals.find((p) => p.bundle)!;
    expect(deep.bundle!.components.every((c) => c.kind !== "title")).toBe(true); // still never a reworded title
  });
  /** WHAT A REFUSAL COSTS AND WHAT IT SETTLES: the sentence reaches the operator's receipt, and a stored change whose claims stopped resolving is re-judged and TAKEN BACK rather than quietly kept on their list. */
  it("carries a refusal onto the candidate line, and takes back the stored change whose evidence stopped resolving", async () => {
    const owed = "I could write 1 of the 3 sections this rebuild needs and 2 are still owed, so I am not handing you half a page.";
    reset(doorWorld()); env.bundle = { status: "none", reason: owed };
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: pageSeam(BRIEF) }); expect(res.candidates.some((c) => c.reason.includes(owed))).toBe(true);
    const kept = (await doorRun(doorWorld({ aiObservations: [ASKED] }), (u: string) => ({ ...PATTERN(u), ownedGaps: [], openingPattern: "" }))).proposals.find((p) => p.bundle)!;
    env.store.set(kept.id, { ...kept, causeFinding: { ...kept.causeFinding!, evidenceKeys: [...kept.causeFinding!.evidenceKeys, "demand-competing"] } });
    env.realBundle = false; env.bundle = { status: "none", reason: owed }; env.saved = []; env.withdrawn = [];
    const again = await produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: pageSeam(BRIEF) }); expect([env.withdrawn, again.proposals.some((p) => p.id === kept.id)]).toEqual([[kept.id], false]); });
  it("never rewords one of two pages fighting over one search: it settles the split or it refuses", async () => {
    const split = ownedPage(SPLIT_URL, `${HAFT} table`, { impressions: 900, clicks: 30 }, [{ query: HAFT, impressions: 900, clicks: 30, position: 9 }]);
    const res = await doorRun(doorWorld({}, [WHOLE, split], [{ query: HAFT, note: "two of your own pages", competingUrls: [GAP_URL, SPLIT_URL] }]));
    const deep = res.proposals.find((p) => p.bundle); expect(res.proposals.every((p) => p.bundle?.components.some((c) => c.kind === "title") !== true)).toBe(true);
    if (deep) expect(deep.bundle!.components.map((c) => c.kind)).toEqual(["consolidation"]); });
}); // ── do I already have the right page for what I investigated? ────────────────
const FOOD = "fixture-outdoors.example/nowruz-food"; const cands = (s: EvidenceSnapshot) => ownedCandidatesFor(s, buildTopicInvestigations(s)[0]!);
const UBIQUITOUS = ["food", "music", "gifts", "fire", "dance", "poetry", "cards", "tables", "flowers", "travel"].map((w) => ({ query: `nowruz ${w}`, searchVolume: null, competition: null, competitionLevel: null, difficulty: null, intent: null })); const LOOKALIKE = ownedPage("fixture-outdoors.example/nowruz-gifts", "Nowruz Traditions and Gifts", { impressions: 400, clicks: 8 }, [{ query: "nowruz gifts", impressions: 400, clicks: 8, position: 9 }]); // every phrase this account owns carries one word, so that word proves nothing here
describe("do I already have the right page for what I investigated", () => { it("treats an exact Search Console query as proof of coverage and matching wording as only a hint", () => {
    const out = cands(snap([GAP, LOOKALIKE], looked([["nowruz traditions", GAP_URL]]))); expect(out.map((c) => [c.url, c.strongSignals])).toEqual([[GAP_URL, 2], ["fixture-outdoors.example/nowruz-gifts", 0]]); // the page Google serves beats the page that only reads like the topic
    expect(out[0]!.signals.map((s) => s.kind)).toEqual(["gsc_exact_query", "ranks_for_query"]); expect(out[1]!.signals.every((s) => s.strength !== "strong")).toBe(true);
    expect(out[0]!.signals[0]!.detail).toContain('Google already shows this page for "nowruz traditions": 6,000 views and 180 clicks.'); });
  it("maps no page at all on one word this account puts on everything", () => { // the whole topic IS that one word, so nothing about it is distinguishing
    expect(cands(snap([GAP, LOOKALIKE], { ...looked([["nowruz", GAP_URL]]), retainedKeywords: UBIQUITOUS })).map((c) => [c.url, c.signals.map((s) => s.strength)])).toEqual([[GAP_URL, ["strong"]]]); }); // only the page Google actually returns
  it("never turns a rival's page into a page of mine", () => { expect(cands(SEEN()).map((c) => c.url)).toEqual([GAP_URL]); });
  it("reads a page whose words I do not hold as unknown coverage, never as no coverage", () => {
    const unread = "fixture-outdoors.example/nowruz-unread"; const page = cands(snap([GAP], looked([["nowruz traditions", unread]]))).find((c) => c.url === unread)!;
    expect([page.bodyHeld, page.strongSignals]).toEqual([false, 1]); expect(page.signals.find((s) => s.strength === "unknown")!.detail).toBe("This page's words are not on file, so whether it already covers this is unknown."); });
  it("surfaces BOTH of my pages when both already cover the topic", () => { expect(cands(BOTH()).map((c) => [c.url, c.strongSignals])).toEqual([[GAP_URL, 2], [FOOD, 2]]); });
}); // ── WHY this page loses the click: one named cause, or none ─────────────────
/** The reading the drafting pass hands the verdict: what the winners share, and what MY page does not do. */
const PATTERN_HELD = { archetype: "informational_guide" as const, commonHeadings: [{ heading: "what each piece means", seenOn: [0, 1, 2] }], commonEntities: [], questionsAnswered: [], openingPattern: "Each of them answers the question in its first sentence.", disagreements: [], uniqueNotCommon: [],
  ownedGaps: [{ gap: "your page never walks through the pieces one by one", seenOn: [0, 1, 2] }], winners: 3, publishers: ["r1.example", "r2.example", "r3.example"], fingerprint: "fixture" };
/** The five causes nothing in this generation can test, which must therefore never be guessed at. */
/** Causes NOT CONSIDERED when this caller holds none of their evidence. demand_decline and ranking_loss are a RULE now (the two four week windows), so they are named here for the same honest reason as the rest: nobody handed this pass the windows. retrieved_not_cited went live when the projection began carrying the retrieval list. */
const NEVER_HELD = ["demand_decline", "ranking_loss", "technical_indexability", "measuring_change"];
/** An engine answering this page's own search and naming everybody except this page. */
const CITED_ELSEWHERE = (): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), aiObservations: [canon({ promptId: "p1", promptText: "nowruz traditions explained", engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true,
  citations: [{ url: "https://rival.example/a", domain: "rival.example", title: null }], fanOutQueries: ["nowruz traditions"], observedAt: LOOKED_AT })] });
const ACTORS_SEEN = () => snap([ACTORS], actorsSerp("Persian Screen | Iranopedia"));
describe("why this page loses the click, one named cause at a time", () => { it("blames the wording only where the results page accuses it, and says what it beat and what would kill it", () => {
    const c = compileCandidates(ACTORS_SEEN())[0]!;
    expect([c.action, c.cause.cause, c.cause.action]).toEqual(["act_existing_page", "ctr_snippet", "title"]); // one cause, and it is the one the results page proved
    expect(c.cause.competingExplanations.map((x) => x.cause)).toEqual(["competitor_content_gap"]); expect(c.cause.falsifier).toContain("wording");
    expect(c.cause.notConsidered.map((n) => n.cause)).toEqual(expect.arrayContaining([...NEVER_HELD, "cannibalization", "competitor_content_gap"])); }); // absent evidence is named, never guessed
  it("calls two of my own pages on one search what it is, above the wording that would otherwise be blamed", () => {
    const world = { ...ACTORS_SEEN(), cannibalization: [{ query: "iranian actors", competingUrls: [ACTORS_URL, "iranopedia.example/actors"], note: "" }] };
    const c = compileCandidates(world)[0]!; expect([c.action, c.cause.cause, c.cause.action]).toEqual(["consolidate", "cannibalization", "consolidate"]);
    expect(c.cause.competingExplanations.map((x) => x.cause)).toContain("ctr_snippet"); // the wording read fired and lost to the stronger evidence
    expect(c.reason).toContain('2 of your own pages come up for "iranian actors"'); expect(snapshotToEvidenceInputs(world)).toEqual([]); // self-competition is never a copy rewrite
    const supported = { ...ACTORS_SEEN(), research: { ...actorsSerp("Persian Screen | Iranopedia"), retainedKeywords: [{ query: "iranian actors", searchVolume: null, competition: null, competitionLevel: null, difficulty: null, intent: null, supports: "consolidation" as const }] } };
    expect(compileCandidates(supported)[0]!.cause.cause).not.toBe("cannibalization"); });
  it("names what the winning pages do that mine does not, citing the verdict's own receipt lines", async () => {
    const world = snap([GAP], READABLE({ topicKey: keyOf(READY()), comparison: comparisonOf([["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]]) }), DEMAND);
    const read = await readCoverage(world, "fixture-tenant", { basis: "basis_today", now: NOW, patternFor: { topicKey: keyOf(READY()), pattern: PATTERN_HELD } });
    expect([read.decided!.decision.verdict, read.decided!.decision.ownedUrls]).toEqual(["improve_existing", [GAP_URL]]); const c = compileCandidates(world, { coverage: read.decided })[0]!;
    expect([c.action, c.cause.cause, c.cause.evidenceKeys]).toEqual(["watch", "competitor_content_gap", ["pattern", "gap1"]]); // the ids the verdict wrote its own receipt under
    expect(c.reason).toContain("walks through the pieces one by one"); expect(snapshotToEvidenceInputs(world)).toEqual([]); // a subject the page never covers is not a title rewrite
    const blind = compileCandidates(world)[0]!; // the same page with no verdict in hand
    expect([blind.action, blind.cause.cause]).toEqual(["research_needed", "no_problem"]); // NOT considered rather than guessed at
    expect(blind.cause.notConsidered.map((n) => n.cause)).toContain("competitor_content_gap"); });
  it("walks down to the next cause when the one above it does not fire, and stops rather than guessing", async () => {
    const laddered = async (page: OwnedPageEvidence, pattern: typeof PATTERN_HELD) => {
      const world = snap([page], READABLE({ topicKey: keyOf(READY()), comparison: comparisonOf([["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]]) }), DEMAND);
      const read = await readCoverage(world, "fixture-tenant", { basis: "basis_today", now: NOW, patternFor: { topicKey: keyOf(READY()), pattern } });
      return compileCandidates(world, { coverage: read.decided })[0]!;};
    const noGaps = { ...PATTERN_HELD, ownedGaps: [] }; const bare = { ...noGaps, commonHeadings: [], commonEntities: [] };
    expect((await laddered(GAP, noGaps)).cause.cause).not.toBe("incomplete_coverage"); // ABSENCE IS PROVEN OFF THE PAGE'S OWN WORDS, NEVER ASSUMED (operator, 2026-09-01): this compile path holds no body, so it cannot name what the page lacks and walks on; the bundle path diagnoses with the held body
    const listy = ownedPage(GAP_URL, "Top 10 Nowruz Traditions", { impressions: 6400, clicks: 190 }, [{ query: "nowruz traditions", impressions: 6000, clicks: 180, position: 4.1 }]);
    expect((await laddered(listy, bare)).cause.cause).toBe("serp_shape_shift"); // and the kind of page that wins is asked after that
    const stopped = await laddered(GAP, bare); expect([stopped.action, stopped.cause.cause]).toEqual(["research_needed", "no_problem"]);
    expect(stopped.cause.notConsidered.map((n) => n.cause)).toEqual(expect.arrayContaining(["weak_opening", "serp_shape_shift", "internal_link_weakness", "ai_citation_gap"])); }); // each one named, none of them guessed
  it("says when an engine cites everybody but this page, and only where an answer with its sources is on file", () => { const c = compileCandidates(snap([GAP], CITED_ELSEWHERE()))[0]!;
    expect([c.action, c.cause.cause]).toEqual(["watch", "ai_citation_gap"]); expect(c.reason).toContain("chatgpt answered"); expect(c.reason).toContain("named 1 other site without"); // one site is one site, never "1 other sites"
    expect(compileCandidates(snap([GAP]))[0]!.cause.notConsidered.find((n) => n.cause === "ai_citation_gap")!.missing).toContain("No AI answer"); });
  it("tells a page the engine READ and passed over from one it never found, and only when the retrieval list was recorded", () => {
    const seen = { ...CITED_ELSEWHERE(), aiObservations: CITED_ELSEWHERE().aiObservations.map((o) => ({ ...o,
      retrievedResults: [{ url: `https://${GAP_URL}`, domain: "fixture-outdoors.example", title: null }] })) };
    const c = compileCandidates(snap([GAP], seen))[0]!;
    expect([c.cause.cause, c.reason.includes("passed over")]).toEqual(["retrieved_not_cited", true]); // read, judged, declined: a content verdict, not a wording one
    expect(compileCandidates(snap([GAP], CITED_ELSEWHERE()))[0]!.cause.cause).toBe("ai_citation_gap"); }); // no retrieval list recorded: the harder claim is never made
  it("answers a page that is losing nothing with no problem, and still says what it ruled out", () => {
    const c = compileCandidates(snap([WINNER]))[0]!; expect([c.action, c.cause.cause]).toEqual(["watch", "no_problem"]);
    expect(c.cause.competingExplanations.map((x) => x.cause)).toEqual(["ctr_snippet"]); expect(c.cause.falsifier).toContain("click rate"); });
  it("accuses THIS page of being read and passed over, never the page next door on the same site", () => { const retrieved = (url: string): FunnelResearchEvidence => ({ ...CITED_ELSEWHERE(), aiObservations: CITED_ELSEWHERE().aiObservations.map((o) => ({ ...o, retrievedResults: [{ url, domain: "fixture-outdoors.example", title: null }] })) });
    expect(compileCandidates(snap([GAP], retrieved("https://fixture-outdoors.example/nowruz-food")))[0]!.cause.cause).toBe("ai_citation_gap"); // a hit on another page of mine proves nothing about this one
    const mine = compileCandidates(snap([GAP], retrieved(`https://www.${GAP_URL}/`)))[0]!; // and a www or trailing-slash spelling of THIS page still is this page
    expect([mine.cause.cause, mine.reason.includes("cited 1 other site instead")]).toEqual(["retrieved_not_cited", true]); });
  it("leaves a pair of my pages splitting a DIFFERENT search as not considered, never as ruled out", () => {
    const elsewhere = { ...ACTORS_SEEN(), cannibalization: [{ query: "persian actresses", competingUrls: ["iranopedia.example/a", "iranopedia.example/b"], note: "" }] };
    const c = compileCandidates(elsewhere)[0]!; expect(c.cause.cause).toBe("ctr_snippet"); // the search I measured was never checked for competing pages of mine
    expect(c.cause.notConsidered.find((n) => n.cause === "cannibalization")!.missing).toContain("that exact search"); expect(c.cause.competingExplanations.map((x) => x.cause)).not.toContain("cannibalization"); });
  it("stops recommending a page whose last change is still being measured, and admits when nobody told it", () => {
    const measuring = compileCandidates(ACTORS_SEEN(), { measuringPagePaths: ["/iranian-actors-actresses"] })[0]!; expect([measuring.action, measuring.cause.cause, measuring.cause.action]).toEqual(["watch", "measuring_change", null]);
    expect(measuring.cause.explanation).toContain("still being measured, so nothing is stacked on top of it");
    const quiet = compileCandidates(ACTORS_SEEN(), { measuringPagePaths: ["/somewhere-else"] })[0]!; // told, and this page is not one of them
    expect([quiet.action, quiet.cause.cause]).toEqual(["act_existing_page", "ctr_snippet"]);
    expect(compileCandidates(ACTORS_SEEN())[0]!.cause.notConsidered.find((n) => n.cause === "measuring_change")!.missing).toContain("Which of your pages already carry a change under measurement"); });
  it("counts the decline the ladder attributes to the change being read, and STILL works the page", async () => {
    reset(ACTORS_SEEN()); let called = 0; // MEASUREMENT IS NEVER A REASON TO SUPPRESS WORK (operator, 2026-08-29): the ladder may explain a DECLINE as the change being read, and the page still receives candidates, drafts and rows
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, measuringPagePaths: ["/iranian-actors-actresses"], complete: async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; } });
    expect([res.heldForMeasurement, res.proposals.length > 0, env.saved.length > 0], "the diagnosis is counted AND the page is worked").toEqual([1, true, true]); void called;
    expect(await produceProposalsForTenant("fixture-tenant", { now: NOW, measuringPagePaths: ["/somewhere-else"], complete: async () => ({ value: VALID_ATOMIC_EDIT }) })
      .then((r) => r.heldForMeasurement)).toBe(0); }); // and a page nothing is measuring on is never counted as held
  it("counts a consolidation it cannot draft as work, and never reports a quiet day over it", async () => {
    const world = { ...ACTORS_SEEN(), cannibalization: [{ query: "iranian actors", competingUrls: [ACTORS_URL, "iranopedia.example/actors"], note: "" }] };
    reset(world); let called = 0;
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; } });
    expect([res.outcome, res.actionable, res.proposals.filter((p) => p.id.endsWith("::missing_description")).length, res.proposals.filter((p) => p.id.endsWith("::ownership")).length, called, res.held.some((h) => h.reason.includes("two of your own pages competing for one search"))]).toEqual(["proposals_persisted", 1, 0, 1, 0, true]); // the description errand on a page splitting a search is WITHHELD with its reason on the receipt, never paid for and never offered, and ONE family card for the split takes its place
    expect(res.candidates.find((c) => c.action === "consolidate")!.cause.cause).toBe("cannibalization"); });
  it("ranks a 15-view description under a 10,000-view rebuild, and calls views an audience rather than a recovery", () => {
    const card = (id: string, minutes: number, views: number): ChangeProposal => baseProposal({ id, pagePath: `/${id}`, status: "needs_review", impactScore: null, upsidePerMonth: null, demandImpressions90d: views, estimatedEffortMinutes: minutes });
    const ranked = rankProposals([card("meta", 1, 15), card("thin", 30, 10_000)]); // the description is a one minute paste; the rebuild is half an hour
    expect(ranked.map((p) => p.id)).toEqual(["thin", "meta"]); expect(ranked.every((p) => !!p.rankingReceipt)).toBe(true);
    expect(ranked[0]!.rankingReceipt!.factors.find((f) => f.name === "visibility")!.input).toBe("shown 10,000 times in 90 days, an audience size rather than a proven recovery");
    expect(ranked[0]!.whyRankedAboveNext).toContain("more is riding on it");
    expect(rankProposals([card("a", 1, 0), card("b", 30, 0)])[0]!.id).toBe("a"); }); // with no audience at all the quick paste still leads: the fallback adds a fact, it never inverts the rule
  it("promotes a search no page of this account is for only once it has recurred and a page of theirs was refused", () => {
    expect(earnsOwnPage({ passes: 1, refusedPages: ["/guide"] }, 0)).toBe(false); // seen once, and no stored answer says it matters either
    expect(earnsOwnPage({ passes: 2, refusedPages: [] }, 9)).toBe(false); // no page was ever read and refused, so nothing proves none of them fits
    expect(earnsOwnPage({ passes: 2, refusedPages: ["/guide"] }, 0)).toBe(true); // the same search came back across two passes
    expect(earnsOwnPage({ passes: 1, refusedPages: ["/guide"] }, 3)).toBe(true); }); // or three stored answers handed it to somebody else
  it("discounts a page only while its applied change is still being measured", async () => { const day = 24 * 60 * 60 * 1000; const applied = (ageDays: number): ChangeProposal => baseProposal({ id: "applied", status: "implemented_pending_verification", basis: "b", createdAt: new Date(Date.now() - ageDays * day).toISOString() });
    expect(pagesUnderMeasurement([applied(10), applied(180)].map((p, i) => ({ ...p, pagePath: `/p${i}` })), new Date())).toEqual(["/p0"]);
    const overlapOf = async (ageDays: number) => { env.store = new Map([["live", baseProposal({ id: "live", basis: "b" })], ["applied", applied(ageDays)]]);
      return (await loadProposalQueue("fixture-tenant", { currentBasis: "b" })).ranked[0]!.rankingReceipt!.factors.find((f) => f.name === "overlap")!; };
    const fresh = await overlapOf(10); const stale = await overlapOf(180); // the production read, not an injected context
    expect(Math.abs(fresh.contribution), "RECORDED, NEVER A DISCOUNT (operator, 2026-08-29): overlap is context for the reading, and a card loses no rank for standing beside a measured change").toBe(0);
    expect([Math.abs(stale.contribution), stale.input]).toEqual([0, "nothing is being measured on this page"]);
    expect(fresh.input).toBe("this page already has a change under measurement, noted for the reading"); });
  /** THE SAFETY NET ON BOTH SIDES OF THE STORE: a stored change whose claims stopped resolving may not RENDER, and the next canonical pass takes it back even when nothing re-selects that page for a deep read. */
  it("neither renders nor keeps a stored change whose claims no longer resolve, without waiting to be re-selected", async () => {
    const bad = (basis: string): ChangeProposal => baseProposal({ id: "fixture-tenant::/split::existing_edit::bundle", pagePath: "/split", basis, status: "needs_review", riskLevel: "high", bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] }, alternatives: [], risks: [], confidenceReasons: [],
        receipt: { items: [{ key: "demand-exact", kind: "gsc_demand", fact: "f", observedAt: null }], missing: [], freshestObservedAt: null }, components: [{ kind: "consolidation", label: "Settle which page owns this search", before: null, after: "Keep one of these pages.", evidenceKeys: ["demand-competing"], risk: "dangerous", where: "across both", objective: "o", mechanism: "m", measurementPlan: "p" }] } });
    env.store = new Map([["good", baseProposal({ id: "good", basis: "b" })], [bad("b").id, bad("b")]]);
    expect((await loadProposalQueue("fixture-tenant", { currentBasis: "b" })).ranked.map((p) => p.id)).toEqual(["good"]); // it never reaches the screen
    reset(snap([WINNER])); env.store = new Map([[bad("basis_test").id, bad("basis_test")]]); // and no door opens on that page at all
    await produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: async () => ({ value: VALID_ATOMIC_EDIT }) }); expect(env.withdrawn).toEqual([bad("b").id]); });
  /** AND THE SAME NET CATCHES A ROW THAT WENT COLD. Refused at every door but never taken back, it sits in its own slot forever: an identical redraft answers "unchanged", so nothing fresh can replace it. */
  it("takes back a change whose readings went cold, so a redraft off fresh evidence can take its slot", async () => {
    const aged = (observedAt: string): ChangeProposal => baseProposal({ id: "fixture-tenant::/aged::existing_edit::bundle", pagePath: "/aged", basis: "basis_test", status: "ready", bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] }, alternatives: [], risks: [], confidenceReasons: [],
        receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "f", observedAt }], missing: [], freshestObservedAt: observedAt }, components: [{ kind: "title", label: "Title", before: "a", after: "b", evidenceKeys: ["k1"], risk: "safe" }] } });
    for (const [at, taken] of [[new Date(NOW.getTime() - 200 * 86_400_000).toISOString(), [aged("x").id]], [NOW.toISOString(), []]] as const) { // Cold goes back; a receipt whose readings still stand is left exactly where it is.
      reset(snap([WINNER])); env.store = new Map([[aged(at).id, aged(at)]]);
      await produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: async () => ({ value: VALID_ATOMIC_EDIT }) }); expect(env.withdrawn, at).toEqual(taken);
    } });
  it("never emits a diagnosis without a competing explanation, a falsifier, and every unheld cause named", () => { for (const world of [snap([WINNER]), SEEN(), snap([GAP]), snap([ACTORS], actorsSerp(DISPLAYED)), snap([GAP], CITED_ELSEWHERE()), BOTH()]) { for (const c of compileCandidates(world)) {
        expect(c.cause.competingExplanations.length).toBeGreaterThan(0); expect(c.cause.competingExplanations.length).toBeLessThanOrEqual(3);
        expect(c.cause.competingExplanations.every((x) => x.reason.length > 0)).toBe(true); expect(c.cause.falsifier.length).toBeGreaterThan(0);
        expect(c.cause.notConsidered.map((n) => n.cause)).toEqual(expect.arrayContaining(NEVER_HELD)); expect(c.cause.notConsidered.every((n) => n.missing.length > 0)).toBe(true);
        expect(`${c.cause.explanation} ${c.cause.falsifier}`).not.toMatch(/[–—]|SERP|experiment|baseline/); } } }); });
/** THE BAR EVERY GAP IS MEASURED AGAINST (2026-08-12). fitTenantCtrCurve was named in this module's own header and never existed, so every account was judged by an industry table promising 28 percent at position 1 while this one earns 1.34, and every card in the queue was sized about twenty times too big. */
describe("the click curve is fitted to the account it judges", () => {
  const rows = (ctrByBand: Record<number, number>, per = 40) => Object.entries(ctrByBand).flatMap(([band, ctr]) => Array.from({ length: per }, (_, i) => ({ query: `q${band}x${i}`, position: Number(band), impressions: 500, clicks: Math.round(500 * ctr) })));
  it("learns this account's own rate, holds the curve decreasing, and keeps the industry table for the bands it never saw", () => {
    const curve = fitTenantCtrCurve(rows({ 1: 0.014, 2: 0.02, 3: 0.008 })); // band 2 out-earns band 1: real data, and never a curve that pays MORE for a worse position
    expect(curve.source).toBe("tenant");
    expect([curve.expectedCtrAt(1), curve.expectedCtrAt(2)]).toEqual([0.017, 0.017]);
    expect(curve.expectedCtrAt(1)).toBeGreaterThan(0.014); // never dictated by band 1 alone, and the better position is never worth less
    for (const p of [2, 3, 4, 5, 10, 15, 20, 30]) expect(curve.expectedCtrAt(p), `position ${p}`).toBeLessThanOrEqual(curve.expectedCtrAt(p - 1));
    expect(curve.expectedCtrAt(4)).toBeLessThan(defaultExpectedCtrAt(4)); expect(curve.expectedCtrAt(4)).toBeGreaterThan(0); });
  it("refuses to call one busy search a curve, and never lets a brand search set the bar", () => {
    const one = fitTenantCtrCurve([{ query: "big", position: 1, impressions: 90_000, clicks: 30_000 }]); // views enough, sample of one
    expect([one.source, one.expectedCtrAt(1)]).toEqual(["default", defaultExpectedCtrAt(1)]);
    const brandy = [...rows({ 1: 0.01 }), ...Array.from({ length: 40 }, (_, i) => ({ query: `iranopedia ${i}`, position: 1, impressions: 500, clicks: 450 }))];
    expect(fitTenantCtrCurve(brandy, { brandTokens: ["iranopedia"] }).expectedCtrAt(1)).toBeCloseTo(0.01, 3); });
  /** THE FITTED CURVE MUST NOT LOCK THE PASS SHUT. A flat 0.02 deficit floor is unclearable once the curve says the best position on this account pays 0.9 percent: a search earning ZERO clicks on 60,000 views sits 0.0035 under its curve, fails a 0.02 bar, and the kernel calls a page that never earns a click healthy. */
  it("a search earning nothing at all still earns work, and the refusal names the floor that actually bound it", () => {
    const curve = fitTenantCtrCurve(Array.from({ length: 40 }, (_, i) => ({ query: `q${i}`, position: 1, impressions: 5_000, clicks: 45 })));
    expect(curve.expectedCtrAt(1)).toBeCloseTo(0.009, 4); // the whole account tops out under 1 percent
    const page = (clicks: number) => ownedPage("own.example/flag", "Iran flag", { impressions: 60_000, clicks }, [{ query: "iran flag", impressions: 60_000, clicks, position: 3 }]); const dead = compileCandidates(snap([page(0)]), { curve })[0]!;
    expect([dead.action, dead.recoverableClicks]).toEqual(["research_needed", 66]); // NOT watch: zero clicks on 60,000 views is the clearest gap there is
    const near = compileCandidates(snap([page(200)]), { curve })[0]!; // AND THE FLOOR THAT REFUSED IT IS THE ONE NAMED, in its own unit: a search worth 539 clicks used to read "under the 50 clicks on 500 searches that earn a change".
    expect([near.action, /under the 50 clicks/.test(near.reason)]).toEqual(["watch", false]); expect(near.reason).toContain("which is most of what that position gives, so its wording is not visibly costing you the click"); }); }); // ── work identity is the JOB'S OWN evidence, never the account's ──────────────
/** The audited defect this pins: every fixture in this suite hardcodes `evidenceHash: "fixture"`, so an entire  class of account-wide identity bugs was invisible to the suite BY CONSTRUCTION (627 versions on one live row,  a finished answer overwritten by a worse redraft, twelve-call rewrites re-bought). These tests use the REAL  `hashSnapshot`, move an UNRELATED page's Google figures between passes, and hold the identity still. */
describe("work identity survives unrelated drift and moves with the job's own evidence", () => {
  const AT = ownedPage("fixture-outdoors.example/hiking-socks", "Hiking Socks", { impressions: 9000, clicks: 700 }, [{ query: "hiking socks", impressions: 9000, clicks: 700, position: 1.2 }]);
  /** Healthy on every axis (a description on file, clicks at position), so no producer mints work for it: its ONLY role is to drift. */
  const UNRELATED: OwnedPageEvidence = { ...AT, content: { ...AT.content!, metaDescription: "Socks for hiking, sized and rated for every season." } };
  const real = (s: EvidenceSnapshot): EvidenceSnapshot => ({ ...s, evidenceHash: hashSnapshot(s) });
  it("an unrelated page's ordinary Google drift re-mints no identity, re-buys nothing, rewrites no row, and leaves finished copy byte-identical", async () => { reset(real(snap([WEAK, GAP, UNRELATED], looked([["nowruz food traditions", "fixture-outdoors.example/nowruz-food"], ["nowruz traditions", GAP_URL]]))));
    const first = counting(); const one = await run(first.complete);
    expect([one.persisted > 0, first.calls() > 0]).toEqual([true, true]);
    const before = new Map([...env.store].map(([id, p]) => [id, [p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.after : "", p.workKey ?? ""] as const]));
    const base = env.snap as EvidenceSnapshot;
    const drifted = real({ ...base, ownedPages: base.ownedPages.map((p) => p.url.includes("hiking-socks")
      ? { ...p, search: { ...p.search!, clicks90d: p.search!.clicks90d + 37, impressions90d: p.search!.impressions90d + 911 } } : p) });
    expect(drifted.evidenceHash).not.toBe(base.evidenceHash); // the ACCOUNT hash moved, which is exactly what must no longer matter
    env.snap = drifted; env.saved = [];
    const second = counting(); const again = await run(second.complete);
    expect([again.reused > 0, second.calls(), env.saved.map((p) => p.id)]).toEqual([true, 0, []]); // no redraft, no provider attempt, not one row rewritten
    for (const [id, [after, workKey]] of before) { const now = env.store.get(id)!;
      expect([now.recommendedChange.kind === "existing_edit" ? now.recommendedChange.after : "", now.workKey ?? ""]).toEqual([after, workKey]); } });
  it("the job's OWN page moving does move the identity, so the stored row re-stamps once instead of standing on stale evidence", async () => { reset(real(snap([WEAK, GAP, UNRELATED], looked([["nowruz food traditions", "fixture-outdoors.example/nowruz-food"], ["nowruz traditions", GAP_URL]]))));
    await run(counting().complete);
    const guideId = [...env.store.keys()].find((id) => id.includes("/nowruz-guide"))!; const heldKey = env.store.get(guideId)!.workKey!;
    const base = env.snap as EvidenceSnapshot;
    env.snap = real({ ...base, ownedPages: base.ownedPages.map((p) => p.url === GAP_URL
      ? { ...p, search: { ...p.search!, impressions90d: p.search!.impressions90d + 4000, clicks90d: p.search!.clicks90d + 5 } } : p) });
    env.saved = []; await run(counting().complete);
    const moved = env.store.get(guideId)!;
    expect(moved.workKey).not.toBe(heldKey); // the identity follows the job's own evidence
    expect(env.saved.some((p) => p.id === guideId)).toBe(true); }); // one re-stamp, which is the honest churn a real movement earns
});
describe("canonical bundle status", () => { // ── the re-read sweep reconciles bundles, and the stored status agrees with the rendered lane ─
  const BUNDLE = { objective: "Tell the two flag pages apart", metric: "clicks", measurementPlan: "read at 7, 14, 28 days", risks: [], confidenceReasons: ["r"], alternatives: [], scope: { queries: ["iran flag"], prompts: [] }, components: [{ kind: "title" as const, label: "Title", before: "Iran Flag", after: "The national flag of Iran, explained", where: null, page: "/flags", risk: "safe" as const, evidenceKeys: [] }],
    dispositions: [], receipt: { items: [{ key: "k1", kind: "serp" as const, fact: "Observed on the results page for iran flag.", observedAt: "2026-07-20T00:00:00.000Z" }], missing: [], freshestObservedAt: "2026-07-20T00:00:00.000Z" } };
  const bundleRow = (over: Partial<ChangeProposal> = {}): ChangeProposal => baseProposal({ id: "fixture-tenant::/flags::existing_edit::title-family", pagePath: "/flags", pageUrl: "https://fixture-outdoors.example/flags",
    basis: "basis_test::d8", changeFamily: "title-family", status: "ready", bundle: BUNDLE as never, modeledOn: "the stored results page for this search, whose top titles share this shape", recommendedChange: { kind: "existing_edit", field: "title", before: "Iran Flag", after: "The national flag of Iran, explained" }, ...over });
  it("a claim rule cannot fire vacuously on a bundle that carries no claims by construction, and the lane agrees with the store", async () => { reset(SEEN()); const row = bundleRow(); env.store = new Map([[row.id, row]]);
    await produceProposalsForTenant("fixture-tenant", { now: NOW, maxDrafts: 0, zeroSpend: true });
    expect(env.store.get(row.id)!.status).toBe("ready"); // the national-symbol rule no longer holds a row that cannot declare claims
    const q = await loadProposalQueue("fixture-tenant", { currentBasis: "basis_test::d8", now: NOW });
    expect(q.ready.some((p) => p.id === row.id)).toBe(true); }); // stored ready = rendered ready: one canonical status
  it("a REAL blocker demotes the stored bundle with a typed fault, so the store says what every screen shows", async () => { reset(SEEN()); const row = bundleRow({ diagnosisCause: "cannibalization", whyItMatters: "This search comes up about 176 clicks short beside its sibling." });
    env.store = new Map([[row.id, row]]);
    await produceProposalsForTenant("fixture-tenant", { now: NOW, maxDrafts: 0, zeroSpend: true });
    const now = env.store.get(row.id)!;
    expect(now.status).toBe("needs_review"); // the sweep no longer skips `row.bundle`, so the verdict is written back
    expect((now.faults ?? []).some((f) => /promises clicks/.test(f))).toBe(true); // and the reason is TYPED, owned by Beacon, not read back out of prose
    const q = await loadProposalQueue("fixture-tenant", { currentBasis: "basis_test::d8", now: NOW });
    expect(q.ready.some((p) => p.id === row.id)).toBe(false); }); // demoted in the store AND off the ready lane: no split brain
});
describe("a synthesis replacement is not demoted for standing on the page's own words", () => { // ── the sweep's thin-coverage rule and the synthesis charter agree ─────────────
  const COPY = "Funny Persian phrases are everyday slang and insults, and the clearest examples are the playful ones that follow, each carrying the meaning a reader needs to use it well in ordinary conversation with friends and family members across generations of speakers.";
  const row = (where: string, id: string): ChangeProposal => baseProposal({ id, pagePath: "/funny", pageUrl: "https://fixture-outdoors.example/funny", basis: "basis_test::d8",
    changeFamily: "section", primaryQuery: "funny persian phrases", status: "ready", claims: [{ text: COPY, supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: `${COPY} the anchor heading stays here` }],
    recommendedChange: { kind: "existing_edit", field: "section", before: "Funny Persian phrases are everyday slang and insults.", after: COPY, where } });
  it("the replace-marked row stays ready while the add-shaped twin is demoted with a typed fault", async () => { reset(SEEN());
    const keep0 = row('Replaces the existing passage under "Popular Phrases"', "fixture-tenant::/funny::existing_edit::ai_answer_gap");
    const keep = { ...keep0, semanticReview: { of: copyKey(keep0), version: REVIEW_CONTRACT, claims: (keep0.claims ?? []).map((x, n) => ({ i: n, by: [...x.supportedBy], entailed: true })) }, informationGain: { adds: "puts every phrase and its meaning in one liftable block", by: ["page-copy-1"], pageWhole: true } } as ChangeProposal;
    const demote = row('A new section headed "Meanings", placed after "the anchor heading"', "fixture-tenant::/funny2::existing_edit::engine_followup");
    env.store = new Map([[keep.id, keep], [demote.id, { ...demote, pagePath: "/funny2", pageUrl: "https://fixture-outdoors.example/funny2" }]]);
    await produceProposalsForTenant("fixture-tenant", { now: NOW, maxDrafts: 0, zeroSpend: true });
    expect(env.store.get(keep.id)!.status).toBe("ready"); // the synthesis charter: its whole gain is FORM, so the page's own words are its legal ground
    expect([env.store.get(demote.id)!.status, (env.store.get(demote.id)!.faults ?? []).join(" ")]).toEqual(["needs_review", expect.stringContaining("what a reader gains")]); });});

describe("the unruled review pass", () => { // ── a pass whose review never ruled keeps its hands off a banked reading ───────
  const mint = (): ChangeProposal => baseProposal({ id: "fixture-tenant::/x::existing_edit::fact-noor", changeFamily: "factual_correction", status: "needs_review", diagnosisCause: "factual_error", primaryQuery: "noor meaning", impactScore: 400, upsidePerMonth: 120,
    claims: [{ text: "Noor means light.", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "encyclopedia: the name Noor means light." }], recommendedChange: { kind: "existing_edit", field: "section", where: 'The "Noor" entry', before: "Meaning:Bright, radiant, or glowing.", after: "Meaning:Light." },
    limitations: ["Beacon's own sense review has not read this correction yet, so it waits for that reading rather than for the operator to do Beacon's checking."] });
  it("rewrites no reviewed row, and still lands the owed card where nothing is on file", async () => { reset(SEEN());
    const reviewed0 = { ...mint(), status: "ready" as const, limitations: ["Beacon's own reviewer read this correction for grammar, source fit and contradictions before it was offered."] };
    const reviewed = { ...reviewed0, semanticReview: { of: copyKey(reviewed0), version: REVIEW_CONTRACT, claims: [{ i: 0, by: ["fact-1"], entailed: true }] } };
    env.store = new Map([[reviewed.id, reviewed]]);
    fenv.cards = [mint()]; fenv.review = (cards) => cards; // declined or failed: the review never ruled, the same reference comes back
    const out = await produceProposalsForTenant("fixture-tenant", { complete: counting().complete, now: NOW, bypassCache: true, maxDrafts: 5 });
    const writes = env.saved.filter((p) => p.id === reviewed.id);
    expect(writes.every((w) => !!w.semanticReview), "no write of this pass strips the banked reading").toBe(true); // the defect wrote the mint copy, review gone
    const kept = env.store.get(reviewed.id)!;
    expect([kept.semanticReview?.of === copyKey(kept), kept.semanticReview?.version]).toEqual([true, REVIEW_CONTRACT]); // The reading survives the whole pass wherever the row ends: a later gate may hold the row with its own typed reason, but only a ruling review may replace or remove the receipt itself.
    const rx = out.paid.receipts.find((r) => r.key === "/x" || r.key.startsWith("/x::")); expect([rx?.outcome, rx?.why ?? ""], "the receipt names the row's real remaining debt, not a review the row already banks").toEqual(["evidence_required", expect.stringContaining("glued phrase")]); reset(SEEN()); fenv.cards = [mint()]; fenv.review = (cards) => cards; // THE SIBLING: the same unruled pass still lands the owed card on a page with nothing on file.
    await produceProposalsForTenant("fixture-tenant", { complete: counting().complete, now: NOW, bypassCache: true, maxDrafts: 5 });
    expect(env.store.get(mint().id)?.status).toBe("needs_review");
    fenv.cards = null; fenv.review = null; }); });
/** SPENDING AND AUTHORIZATION ARE TWO QUESTIONS (operator, 2026-08-31). Six finished descriptions with positive readings sat at needs_review while the results pages their gate asked for landed the same day: the same-day stop refused the re-buy, which is its job, and nothing else could re-read the stored work, which is nobody's. Ready means safe to try: complete, placed, reasonably better, reversible, no known material defect. The $0 replay re-reads stored finished copy against today's full deterministic authorization, attaches newly landed shape backing, calls no provider, and a materially defective sibling in the same pass stays held with every word intact. */
describe("the $0 replay: a held finished draft promotes when its evidence lands, with no provider call", () => {
  const gateLine = "it replaces the description this page already has on demand evidence alone: demand proves the page matters, never that these words beat the current ones, so it is held until a diagnosis names what is wrong with the current description or a stored results page backs this shape";
  const meta = (id: string, after: string, over: Partial<ChangeProposal> = {}): ChangeProposal => baseProposal({
    id: `fixture-tenant::${id}::existing_edit::replay-fixture`, pagePath: id, pageUrl: `https://${GAP_URL}`, changeFamily: "meta", status: "needs_review",
    primaryQuery: "nowruz traditions", limitations: [gateLine], basis: "basis_test::d8", recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line about the holiday.", after }, ...over });
  it("promotes the exact stored copy at $0, and holds the malformed sibling with its reasons intact", async () => {
    const page = { ...GAP, content: { ...GAP.content!, metaDescription: "Old line about the holiday." } };
    reset(snap([page], looked([["nowruz traditions", GAP_URL]])));
    const good = meta("/nowruz-guide", "Nowruz traditions explained: the customs, the Haft-Seen table and the spring timing of Persian New Year, in plain language.");
    const bad = meta("/nowruz-guide-2", "Nowruz traditions - the customs and the Haft-Seen table — explained.", { id: "fixture-tenant::/nowruz-guide-2::existing_edit::replay-fixture", pagePath: "/nowruz-guide" }); // an em dash is a house-rule material defect the canon owns
    env.store = new Map([[good.id, good], [bad.id, bad]]);
    let paidCalls = 0; const out = await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true, complete: (async () => { paidCalls += 1; return { error: "no provider may be reached", retryable: false }; }) as never });
    const promoted = [...env.store.values()].find((p) => p.id === good.id)!, held = [...env.store.values()].find((p) => p.id === bad.id)!;
    expect([promoted.status, promoted.recommendedChange.kind === "existing_edit" && promoted.recommendedChange.after, !!promoted.modeledOn], "the stored copy promotes byte-identical, wearing the results-page backing the gate asked for").toEqual(["ready", good.recommendedChange.kind === "existing_edit" ? good.recommendedChange.after : "", true]);
    expect([held.status, held.limitations.includes(gateLine)], "the defective sibling stays held with every word and reason").toEqual(["needs_review", true]);
    expect([paidCalls, out.outcome !== "evidence_unreadable"], "no provider was called for any of it").toEqual([0, true]); });
  const OBJECTION = "the evaluator's exact objection: this reads as a list of searches rather than a sentence";
  /** A RESULTS PAGE THAT DOES NOT BACK THE SHAPE IS AN ANSWER, NOT A WAIT (falsifier, 2026-09-02): eight held descriptions had their results page on file, `shapeBackingOf` found fewer than two ranked titles leading with the copy's first token, and the row still answered `{evidence: serp}` for ever. */
  it("turns a results page that refuses the shape into the redraft instruction that would earn it", async () => { reset(snap([{ ...GAP, content: { ...GAP.content!, metaDescription: "Old line about the holiday." } }], looked([["nowruz traditions", GAP_URL]])));
    const off = meta("/nowruz-guide", "Haft-Seen table customs and the spring timing of the Persian new year, described in plain language for a first visit.", { modeledOn: undefined });
    env.store = new Map([[off.id, off]]); await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true });
    const out = env.store.get(off.id)!;
    expect([out.obligation?.kind, out.obligation?.kind === "redraft" ? out.obligation.instruction : ""], "the page on file is the answer: it says which word the ranked titles lead with, and that is what the next draft owes").toEqual(["redraft", 'the ranked titles for this search lead with "nowruz"; lead with it or this line has no backing']); });
  it("never promotes a row carrying a reading no rule of ours can re-derive, and drops the stale ones it can", async () => { reset(snap([{ ...GAP, content: { ...GAP.content!, metaDescription: "Old line about the holiday." } }], looked([["nowruz traditions", GAP_URL]])));
    const COPY = "Nowruz traditions explained: the customs, the Haft-Seen table and the spring timing of Persian New Year, in plain language.";
    const judged = meta("/nowruz-guide", COPY, { faults: [OBJECTION] });
    // AND A DETERMINISTIC FAULT IS A PAST READING (falsifier, 2026-09-02): the rule that wrote "it uses words this account does not publish: Farsi" was withdrawn by the demand-vocabulary exemption, and nothing re-asked it, so the row could never replay. It is dropped and re-earned, or not, by the re-read.
    const stale = meta("/nowruz-guide-2", COPY, { id: "fixture-tenant::/nowruz-guide-2::existing_edit::replay-fixture", pagePath: "/nowruz-guide", faults: ["it uses words this account does not publish: Farsi"] });
    env.store = new Map([[judged.id, judged], [stale.id, stale]]); await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true });
    expect([env.store.get(judged.id)!.status, env.store.get(judged.id)!.faults], "the paid reader's own objection is not ours to re-derive, so it still holds the row").toEqual(["needs_review", [OBJECTION]]);
    const out = env.store.get(stale.id)!;
    expect([out.status, out.faults ?? [], !!out.modeledOn], "and the withdrawn rule's line leaves with it, the results page on file backing the shape").toEqual(["ready", [], true]); });
});
/** RAW MARKUP IS NOT PASTE COPY (operator, 2026-08-31). A stored link row from before the typed-anchor contract carried an <a> tag in a section body and the $0 replay promoted it: nothing typed owned the rule that operator copy is text. The canon owns it now, so every door that mints or replays Ready refuses it. */
describe("the canon refuses raw HTML in operator copy", () => {
  it("holds the stored row that carries a tag, at $0, while its clean sibling still promotes", async () => {
    const gateLine = "it replaces the description this page already has on demand evidence alone: demand proves the page matters, never that these words beat the current ones, so it is held until a diagnosis names what is wrong with the current description or a stored results page backs this shape";
    const page = { ...GAP, content: { ...GAP.content!, metaDescription: "Old line about the holiday." } };
    reset(snap([page], looked([["nowruz traditions", GAP_URL]])));
    const mk = (id: string, after: string): ChangeProposal => baseProposal({ id: `fixture-tenant::${id}::existing_edit::replay-fixture`, pagePath: "/nowruz-guide", pageUrl: `https://${GAP_URL}`, changeFamily: "meta", status: "needs_review", primaryQuery: "nowruz traditions", limitations: [gateLine], basis: "basis_test::d8", recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line about the holiday.", after } });
    const tagged = mk("/nowruz-guide-3", 'Nowruz traditions explained, with the <a href="/haft-seen">Haft-Seen table</a> and the spring timing of Persian New Year.');
    const clean = mk("/nowruz-guide-4", "Nowruz traditions explained: the customs, the Haft-Seen table and the spring timing of Persian New Year, in plain language.");
    env.store = new Map([[tagged.id, tagged], [clean.id, clean]]);
    await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true });
    expect([env.store.get(tagged.id)!.status, env.store.get(clean.id)!.status], "the tag is a material defect and the clean line is safe to try").toEqual(["needs_review", "ready"]);
    const standing = { ...mk("/nowruz-guide-5", 'Standing copy with a <a href="/x">tag</a> that predates the rule.'), status: "ready" as const, limitations: [] }; // AND THE RULE REACHES A ROW ALREADY WEARING READY: the sweep demotes it in the canon's own sentence, because a rule added today reaches finished rows exactly as a rule withdrawn today does.
    env.store = new Map([[standing.id, standing]]);
    await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true });
    const demoted = env.store.get(standing.id)!;
    expect([demoted.status, demoted.limitations.some((l) => l.startsWith("it did not pass the re-read of a stored change against the rules that stand today: Contains raw HTML markup"))], "demoted with the canon's own reason on the row, and through the ONE composer, so the gate opener is there for the next promotion candidate to strip and re-earn instead of the raw sentence standing as a customer caveat for ever").toEqual(["needs_review", true]); });
  /** A VERDICT THAT DEPENDS ON A PAGE'S TEMPLATE SIBLINGS IS ASKED OF THE WHOLE FAMILY, NEVER OF THE ROWS THAT HAPPENED TO BE HELD (measured live, 2026-09-05): /california-persian-cities/beverly-hills was promoted in one hosted pass one second before the same rule refused a sibling, because each pass asked the rule against whatever window was open. The sweep reads the family out of the account's OWN page inventory now, whether or not a sibling carries a row, and the pass receipt says how much of it came back, so a reader can tell a whole-family verdict from a partial one. */
  it.each(["tenant-one", "tenant-two"])("reads a candidate page's whole family out of the page inventory rather than the held rows, and says on the receipt how much of it came back [%s]", async () => {
    const kin = (slug: string) => ownedPage(`fixture-outdoors.example/cities/${slug}`, slug, { impressions: 900, clicks: 20 }, [{ query: `${slug} guide`, impressions: 900, clicks: 20, position: 6 }]);
    const held = baseProposal({ researchOnly: false, id: "fixture-tenant::/cities/one::existing_edit::missing_description", pagePath: "/cities/one", pageUrl: "https://fixture-outdoors.example/cities/one", changeFamily: "meta", status: "needs_review", primaryQuery: "one guide", basis: "basis_test::d8", recommendedChange: { kind: "existing_edit", field: "meta", before: "Old line.", after: "A line about the first city and the spread a household sets out for the new year." } });
    reset(snap([kin("one"), kin("two"), kin("three")])); env.store = new Map([[held.id, held]]);
    const whole = await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true });
    expect(whole.paid.familyRead, "TWO SIBLINGS ARE ASKED FOR AND TWO COME BACK, though neither of them carries a row of its own: the held rows are not the family").toEqual({ asked: 2, loaded: 2 });
    reset(snap([kin("one"), kin("two"), kin("unreadable-three")])); env.store = new Map([[held.id, held]]);
    const partial = await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true });
    expect(partial.paid.familyRead, "and a family the store could not hand over whole says so on the receipt instead of the pass quietly deciding on the part of it that answered").toEqual({ asked: 2, loaded: 1 }); });
});
/** A PRODUCER THAT READ NOTHING CANNOT CLAIM THE PAGE MOVED (operator, 2026-08-31). Live, the $0 re-mint of a description card arrived with no copyStamp over a finished promoted meta carrying the page as the drafting pass read it; null against that stamp broke copy identity, and the template replaced the finished description whole, words to a receipt, backing and status gone. */
describe("a stampless re-mint never replaces finished work", () => {
  it("keeps the finished copy, the backing and the status under the re-minted template", async () => {
    const { preferFinished } = await import("@/domains/decision/completeness");
    const finished = baseProposal({ id: "fixture-tenant::/w::existing_edit::missing_description", pagePath: "/w", changeFamily: "meta", status: "ready", copyStamp: "T|H|D|O", workKey: "wk-meta-1", modeledOn: "the results page for \"persian wolf\": 3 ranked titles read", claims: [{ text: "The page is about the Persian Wolf.", supportedBy: ["page-h1"] }], supportFacts: [{ id: "page-h1", fact: "Persian Wolf" }],
      recommendedChange: { kind: "existing_edit", field: "meta", before: "Old.", after: "Persian Wolf explained: habitat, diet and lifespan in plain language, from the page itself." } });
    const remint = baseProposal({ id: finished.id, pagePath: "/w", changeFamily: "meta", status: "needs_review", researchOnly: true, recommendedChange: { kind: "existing_edit", field: "meta", before: "Old.", after: "Write a description of about 150 characters." } });
    const kept = preferFinished(remint, finished);
    expect([kept.status, kept.researchOnly, (kept.recommendedChange as { after: string }).after, kept.modeledOn ?? null], "the finished words, the earned backing and Ready all survive a template that read nothing").toEqual(["ready", false, (finished.recommendedChange as { after: string }).after, finished.modeledOn]);
    const rewrite = { ...remint, copyStamp: "T2|H2|D2|O2" }; // a producer that DID re-read the page and saw it move still replaces, with the retirement receipt
    const moved = preferFinished(rewrite, finished);
    expect([(moved.recommendedChange as { after: string }).after.startsWith("Write a description"), moved.previousCopy?.after], "a real page change still retires the old words onto a receipt").toEqual([true, (finished.recommendedChange as { after: string }).after]); });
});
/** THE $0 RELEASE LOOP RE-READS WHAT IS ON FILE, AND ONLY WHAT IT MAY TOUCH. STRUCTURED DATA FILED AS A SECTION IS STILL STRUCTURED DATA (Codex, 2026-09-02): a JSON-LD block stored under `section` was read as prose by every gate, so two live rows carried seven refusals about wording no reader ever sees, and the prose re-read had no length band for it at all. AND A CHANGE THE OPERATOR ALREADY MARKED DONE IS NOT WALKED BACK TO A BRIEF (falsifier, 2026-09-02): the contaminated-support sweep demoted any row at all, so a shipped change under measurement could be re-minted as research and its measurement orphaned. */
describe("the $0 release loop converts what it can, and never touches what is being measured", () => {
  const Q = "What is a haft seen table?", ANSWER = "A haft seen table is the spread a household sets out for the new year.";
  const FAQ = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: Q, acceptedAnswer: { "@type": "Answer", text: ANSWER } }] });
  const block = (status: "ready" | "needs_review") => baseProposal({ id: "fixture-tenant::/nowruz-guide::existing_edit::faq_schema", pagePath: "/nowruz-guide", pageUrl: `https://${GAP_URL}`, changeFamily: "section", status, basis: "basis_test::d8", primaryQuery: "nowruz traditions",
    supportFacts: [{ id: "page-copy-1", fact: `${Q} ${ANSWER}` }], recommendedChange: { kind: "existing_edit", field: "section", before: null, after: `<script type="application/ld+json">${FAQ}</script>` } });
  const shipped = baseProposal({ id: "fixture-tenant::/nowruz-food::existing_edit::title", pagePath: "/nowruz-food", pageUrl: "https://fixture-outdoors.example/nowruz-food", status: "implemented_pending_verification", basis: "basis_test::d8",
    claims: [{ text: "This search is asked 1,200 times a month.", supportedBy: ["demand-exact"] }], supportFacts: [{ id: "demand-exact", fact: "1,200 impressions for nowruz food traditions" }] });
  const pass = async (row: ChangeProposal) => { reset(snap([{ ...GAP, content: { ...GAP.content!, outline: [...(GAP.content!.outline ?? []), Q, ANSWER] } }], looked([["nowruz traditions", GAP_URL]])));
    env.store = new Map([[row.id, row], [shipped.id, shipped]]); let paid = 0;
    await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true, complete: (async () => { paid += 1; return { error: "no provider may be reached", retryable: false }; }) as never });
    return { row: env.store.get(row.id)!, done: env.store.get(shipped.id)!, paid }; };
  it("files a stored JSON-LD block under its own typed field at $0, refuses it as no kind of prose, and never walks an implemented row back to a brief", async () => {
    const out = await pass(block("ready")); const c = out.row.recommendedChange as { field: string; after: string; where?: string };
    expect([c.field, c.after.startsWith("{"), (c.where ?? "").length > 0, out.row.limitations.some((l) => /^Contains raw HTML markup/.test(l)), validateProposal(out.row, { pageBodyText: `${Q} ${ANSWER}` }).verdict, out.paid], "the block is filed as structured data with its wrapper off and its placement stated, no rule written for sentences refuses it as markup, the canon's own JSON-LD gate passes it, and none of it costs a call").toEqual(["schema", true, true, false, "ready", 0]);
    expect([out.done.status, out.done.researchOnly ?? false, out.done.limitations], "and a change the operator already marked done is never re-minted as research, whatever its claims lean on").toEqual(["implemented_pending_verification", false, shipped.limitations]); });
  // A STORED BLOCK THAT ALREADY WEARS READY STAYS THERE: `deliverableGaps` reads a schema field as JSON rather than as prose now, so no rule written for sentences can demote finished markup.
  /** THE REPLAY READS THE WHOLE PAGE FOR A SCHEMA ROW (falsifier, 2026-09-02): the canon proves structured data against what the page VISIBLY carries, and the candidate was judged against the four stored fields plus whatever the sweep window held, so an answer the page really carries read as absent off a 160-character excerpt. */
  it("proves a schema block against the page's own body, clearing an answer it carries and refusing one it invents", async () => {
    reset(snap([GAP], looked([["nowruz traditions", GAP_URL]]))); // Q and ANSWER are NOT among this page's four stored fields: only its body carries the answer
    const carried = block("ready");
    env.store = new Map([[carried.id, carried]]);
    await produceProposalsForTenant("fixture-tenant", { now: NOW, zeroSpend: true });
    const out = env.store.get(carried.id)!;
    expect([out.status, (out.recommendedChange as { field: string }).field], "the page's own body carries this answer, so the canon's visible-content proof is satisfied off the whole page rather than a stored excerpt").toEqual(["ready", "schema"]); });
  it("leaves a stored JSON-LD block that already wears Ready exactly where it stands", async () => {
    const out = await pass(block("ready"));
    expect([out.row.status, out.row.faults ?? []], "structured data is not prose, so no rule about unwritten copy may touch it").toEqual(["ready", []]); });});
