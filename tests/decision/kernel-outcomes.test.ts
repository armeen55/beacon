/** DECISION kernel outcomes: what the evidence justifies BEFORE anything is drafted, then generate -> validate -> rank -> persist -> REUSE, and fail-closed rejections.
 *  Each test name states its promise. */
import { describe, it, expect, vi } from "vitest";
// Budget is not this file's subject: always-allowed, no-op hermetic seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
const env = vi.hoisted(() => ({ snap: null as unknown, saved: [] as ChangeProposal[], store: new Map<string, ChangeProposal>(), withdrawn: [] as string[], failWrites: false, bundleTarget: null as string | null, bundle: null as unknown, realBundle: false, door: null as { door: string; evidence: { query: string | null } } | null }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
// Keyed the way the producer reads it (canonical, so a stored row and a full address are one page), or the page's own words are silently dropped.
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...((await orig()) as object),
  loadOwnedPageBodies: async (_t: string, urls: string[]) => new Map(urls.filter((u) => !u.includes("unreadable"))
    .flatMap((u) => [u, u.replace(/^https?:\/\//, "").replace(/\/+$/, "")].map((k) => [k, { url: u, title: "T", metaDescription: null, openingSample: "A haft seen table is the spread a household sets out for the new year.", cardTexts: [], entityNames: [], internalLinks: [], fetchedAt: "2026-07-25T00:00:00.000Z" }] as const))) }));
// The REAL fingerprint is under test; only the two I/O calls are seams. The deep bundle has its own suite, so here it only reports WHICH page it was aimed at.
vi.mock("@/domains/decision/proposal-store", async () => { const actual = await vi.importActual<typeof import("@/domains/decision/proposal-store")>("@/domains/decision/proposal-store");
  // The canonical store's OWN rule, emulated: a proposal identical to the stored row writes nothing at all.
  return { ...actual, loadChangeProposals: async () => env.store, withdrawnProposalIds: async () => new Set<string>(),
    withdrawChangeProposal: async (p: ChangeProposal) => { env.withdrawn.push(p.id); env.store.delete(p.id); return true; }, saveChangeProposal: async (p: ChangeProposal) => {
    const prior = env.store.get(p.id); if (prior && actual.proposalFingerprint(prior) === actual.proposalFingerprint(p)) return "unchanged";
    env.saved.push(p); if (env.failWrites) return "failed"; env.store.set(p.id, p); return "saved"; } }; });
// A PASSTHROUGH, NOT A STAND-IN: it records which page and which DOOR the pass aimed at, then replays a pinned answer or runs the REAL producer.
vi.mock("@/domains/decision/produce-bundle", async () => { const actual = await vi.importActual<typeof import("@/domains/decision/produce-bundle")>("@/domains/decision/produce-bundle");
  return { ...actual, produceBundleForSnapshot: async (s: never, o: { onlyPageUrl?: string | null; door?: never }) => {
    env.bundleTarget = o?.onlyPageUrl ?? null; env.door = (o?.door ?? null) as typeof env.door;
    return env.realBundle ? actual.produceBundleForSnapshot(s, o) : env.bundle ?? { status: "none", reason: "pinned in change-bundle.test" }; } }; });
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "fixture-tenant", domain: "fixture-outdoors.example", growth_goal: null }), basisTag: () => "basis_test" }));
import { proposeExistingPageChange } from "@/domains/decision/propose";
import { validateProposal } from "@/domains/decision/validate-proposal";
import { rankProposals, proposalValueScore } from "@/domains/decision/rank-proposals";
import { compileCandidates, snapshotToEvidenceInputs } from "@/domains/decision/opportunities";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { chooseInvestigation, comparisonForFocus, focusReads } from "@/domains/runtime/ops/investigation-queries";
import { reconcileResearchCases } from "@/domains/evidence/topic-investigation";
const queued = async (tenantId: string, at = 0) => focusReads(await chooseInvestigation(tenantId, null), at, null).queries; const canon = <T extends object>(o: T) => ({ observationId: "obs_fx", promptVersion: 1, reportingDay: "2026-07-01", answerHash: "hx", retrievedResults: null, brandMentions: null, analysis: null, ...o });
import { proposalFingerprint } from "@/domains/decision/proposal-store"; import { ownedCandidatesFor } from "@/domains/decision/owned-coverage"; import { askIdentity } from "@/domains/evidence/page-intersection";
import { buildTopicInvestigations } from "@/domains/evidence/topic-investigation";
import { readCoverage, rankInvestigations } from "@/domains/decision/coverage-pass"; import { loadProposalQueue, pagesUnderMeasurement } from "@/domains/decision/load-proposals";
import { emptyResearchEvidence, type FunnelResearchEvidence, type ResearchPageComparison, type WinnerReadOutcome } from "@/domains/evidence/funnel/research-evidence";
import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { serializeChangeProposal, deserializeChangeProposal, type EvidenceInput, type ChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
/** A completion fn that replays a fixed queue (last response repeats). The seam returns a PARSED structured VALUE (never text); an error carries its retryability. */
function fakeComplete(responses: Array<{ value: unknown } | { error: string; retryable?: boolean }>): CompleteFn {
  let i = 0; return async () => { const r = responses[Math.min(i++, responses.length - 1)]!; return "error" in r ? { error: r.error, retryable: r.retryable ?? false } : { value: r.value }; };
} const PROOF = { metrics: ["clicks", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" };
const VALID_ATOMIC_EDIT = { field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen", confidence: "high",
  rationale: "The current title is one word and misses the specific customs searchers ask about.", risks: ["keep the title concise"],
  evidenceRefs: [{ source: "gsc", detail: "many impressions for nowruz traditions with a low click rate" }], operatorSteps: ["Replace the page title field with the new value"], proofPlan: PROOF };
const KEYS = ["demand-exact", "copy-current", "serp1", "serp-owned", "serp-pattern"];
const DIAGNOSED: EvidenceInput["evidence"]["diagnosis"] = { status: "diagnosed", cause: "snippet_intent_mismatch", action: "title", evidenceKeys: KEYS, explanation: "I checked the results page.",
  alternativesRuledOut: [{ alternative: "Google is already showing the words people search for", reason: "It is not.", evidenceKeys: ["serp-owned"] }] };
const EXISTING_INPUT: EvidenceInput = {
  tenantId: "referencepedia", page: { path: "/nowruz", url: "https://fixture-content.example/nowruz", label: "Nowruz" }, sizing: { impactScore: 80, upsidePerMonth: 45 },
  opportunity: { query: "nowruz traditions", kind: "existing_edit", field: "title", opportunityType: "Capture clicks", currentValue: "Nowruz", intent: "what" },
  evidence: { hints: ["Search Console shows strong demand for nowruz traditions, the persian new year customs"], diagnosis: DIAGNOSED, outline: ["History of Nowruz", "Haft-Seen table", "Persian customs and foods"] } };
/** A minimal safe existing-edit proposal, for constructing rejection variants. */
function baseProposal(over: Partial<ChangeProposal> = {}): ChangeProposal { return {
    id: "fixture-tenant::/x::existing_edit::title", tenantId: "fixture-tenant", kind: "existing_edit", pagePath: "/x", pageUrl: "https://fixture-content.example/x",
    pageLabel: "X", primaryQuery: "nowruz traditions", opportunityType: "Capture clicks", changeFamily: "title", status: "ready", evidence: { query: "nowruz traditions", hints: ["gsc demand"], evidenceRefCount: 1 },
    recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen" },
    whyItMatters: "The title misses the customs searchers ask about.", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "high", limitations: [],
    impactScore: 50, upsidePerMonth: 20, publish: "manual", createdAt: "2026-07-22T00:00:00.000Z", ...over };
} /** The exact-edit rewrite under test, with one field swapped. */
const edited = (field: "title" | "meta", before: string | null, after: string): ChangeProposal => baseProposal({ recommendedChange: { kind: "existing_edit", field, before, after } });
describe("existing-page cold proposal", () => { it("generates, validates, persists (serialize), and re-loads (deserialize)", async () => {
    const out = await proposeExistingPageChange(EXISTING_INPUT, { complete: fakeComplete([{ value: VALID_ATOMIC_EDIT }]), now: new Date("2026-07-22T00:00:00Z") });
    expect(out.status).toBe("ready"); if (out.status !== "ready") return;
    const p = out.proposal; if (p.recommendedChange.kind === "existing_edit") { expect(p.recommendedChange.before).toBe("Nowruz"); expect(p.recommendedChange.after).toContain("Nowruz Traditions"); } else throw new Error("expected an exact edit");
    expect(p.whyItMatters).toMatch(/customs/i); expect(p.primaryQuery).toBe("nowruz traditions"); expect(p.opportunityType).toBe("Capture clicks");
    expect(p.evidence.evidenceRefCount).toBe(5); expect(out.validation.verdict).toBe("ready"); expect(p.status).toBe("ready"); // the receipt keys the diagnosis cites, and a safe draft is ready, never withdrawn
    expect(deserializeChangeProposal(serializeChangeProposal(p))).toEqual(p); // persisted + loadable: round-trips + re-validates
    expect(deserializeChangeProposal(JSON.stringify({ v: 1, proposal: { ...p, recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "" } } }))).toBeNull(); // a tampered row is never served as trusted
    const brief = { kind: "new_page" as const, proposedTitle: "T", metaDescription: "M", openingAnswer: "A", outline: ["One"], faqQuestions: [], schemaTypes: [] }; // recorded before this kernel stopped writing them
    expect(deserializeChangeProposal(serializeChangeProposal({ ...p, id: "hist", kind: "new_page", pagePath: null, recommendedChange: brief }))?.recommendedChange).toEqual(brief); }); // history still decodes
  it("returns no_draft (fail-closed) when no key or completion transport exists", async () => { expect((await proposeExistingPageChange(EXISTING_INPUT)).status).toBe("no_draft"); });
  it("never calls the drafter for a candidate the results page has not accused", async () => { let called = 0; // no completion call, no copy, no row
    const out = await proposeExistingPageChange({ ...EXISTING_INPUT, evidence: { ...EXISTING_INPUT.evidence, diagnosis: undefined } }, { complete: async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; } });
    expect([out.status, called, out.status === "no_draft" && out.reason]).toEqual(["no_draft", 0, "I checked the results page, but it does not yet show that the title is the problem."]); });
}); describe("safety gates reject unsafe drafts", () => { const LONG_META = "Nowruz is the Persian New Year celebrated with the Haft-Seen table, customs, and foods across Iran and the diaspora.";
  it.each([ // one gate per row: the flag it must raise
    ["a placeholder stub", edited("title", "Nowruz", "Nowruz [insert customs here]"), /placeholder|stub/i],
    ["an em dash in operator copy", edited("title", "Nowruz", "Nowruz Traditions — Persian New Year"), /dash/i],
    ["a raw uuid leaking into copy", edited("title", "Nowruz", "Nowruz 550e8400-e29b-41d4-a716-446655440000 Guide"), /./],
    ["a destructive edit that guts the current value", edited("meta", LONG_META, "Nowruz."), /destructive/i]] as const)("rejects %s", (_w, p, flag) => {
    const v = validateProposal(p); expect(v.verdict).toBe("rejected"); // a refused draft earns NO lifecycle stage, so it is withdrawn, never a quiet needs_review
    expect([...v.safetyFlags, ...v.reasons].some((f) => flag.test(f))).toBe(true); });
  it("rejects an edit that introduces an ungrounded number or claim", () => {
    const p = edited("meta", "Nowruz is the Persian New Year celebrated across Iran.", "Nowruz is the Persian New Year, first celebrated exactly 3247 years ago in 1223 BCE."); // the grounding carries no such figure
    const v = validateProposal(p, { evidenceText: "nowruz is the persian new year", pageBodyText: "Nowruz is the Persian New Year celebrated across Iran." }); expect(v.verdict).toBe("rejected"); expect(v.factViolations.length).toBeGreaterThan(0); });
}); // ── the diagnosis: only a proven, recoverable gap earns work ──────────────────
function ownedPage(url: string, title: string, totals: { impressions: number; clicks: number }, topQueries: OwnedQuerySignal[], outline: string[] = []): OwnedPageEvidence {
  return { url, content: { title, metaDescription: null, h1: title, h2: [], outline, schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 800, internalLinks: [], fetchedAt: null },
    search: { clicks90d: totals.clicks, impressions90d: totals.impressions, ctr90d: totals.clicks / totals.impressions, position90d: 4, topQueries }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } };
} function snap(ownedPages: OwnedPageEvidence[], research: FunnelResearchEvidence = emptyResearchEvidence(), keywordDemand: EvidenceSnapshot["keywordDemand"] = []): EvidenceSnapshot {
  return { scope: { tenantId: "fixture-tenant", site: "fixture-outdoors.example", builtAt: "2026-07-26T00:00:00.000Z" }, sources: [], ownedPages, competitors: [], keywordDemand, questionDemand: [],
    intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, research, evidenceHash: "fixture" };
} /** A live results page observed for these EXACT searches, carrying this page's OWN line on it and two rivals that share wording
 *  that line does not: exactly what a diagnosis has to read before it may name the title. */
const looked = (pairs: [string, string][], observedAt: string | null = null): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), serpEvidence: pairs.map(([query, url]) => ({ query, observedAt, aiOverview: [], aiMode: [], paa: [], related: [],
  organic: [{ rank: 1, domain: "rival.example", url: "https://rival.example/a", title: "Nowruz Traditions Explained" },
    { rank: 2, domain: "other.example", url: "https://other.example/b", title: "Persian New Year Traditions and Food" }, { rank: 3, domain: "fixture-outdoors.example", url, title: "Nowruz" }] })) });
/** A big winner: its main searches BEAT the clicks their positions earn, and even counting its one soft search it is ahead. */
const WINNER = ownedPage("fixture-outdoors.example/trail-shoes", "Trail Shoes", { impressions: 75646, clicks: 3246 }, [
  { query: "trail running shoes", impressions: 25000, clicks: 2365, position: 3.96 }, { query: "womens trail shoes", impressions: 12000, clicks: 1012, position: 3.74 },
  { query: "trail shoes for women", impressions: 2110, clicks: 209, position: 2.66 }, { query: "trail shoe reviews", impressions: 1331, clicks: 40, position: 3.7 }]);
/** A far smaller page with a REAL gap: 3.0 percent against the 8.0 percent that position usually earns. */
const GAP_URL = "fixture-outdoors.example/nowruz-guide"; const GAP = ownedPage(GAP_URL, "Nowruz", { impressions: 6400, clicks: 190 }, [{ query: "nowruz traditions", impressions: 6000, clicks: 180, position: 4.1 }], ["Persian New Year Customs", "Haft-Seen"]);
const SEEN = () => snap([GAP], looked([["nowruz traditions", GAP_URL]]));
/** THE LIVE PRODUCTION CASE, verified 2026-07-27: 2,451 views and 15 clicks at position 6.1 on one search, a stored title missing the searcher's own word, and a results
 *  page where Google already displays that word back to them. */
const ACTORS_URL = "iranopedia.example/iranian-actors-actresses"; const DISPLAYED = "Famous Iranian & Persian Actors, Actresses & Celebrities";
const ACTORS = ownedPage(ACTORS_URL, "Top 20 Famous Persian Actresses and Actors | Iranopedia", { impressions: 2451, clicks: 15 }, [{ query: "iranian actors", impressions: 2451, clicks: 15, position: 6.1 }]);
const actorsSerp = (ownedTitle: string): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), serpEvidence: [{ observedAt: null, query: "iranian actors", aiOverview: [], aiMode: [], paa: [], related: [],
  organic: [{ rank: 1, domain: "imdb.example", url: "https://imdb.example/list", title: "Iranian Actors" }, { rank: 2, domain: "wiki.example", url: "https://wiki.example/list", title: "List of Iranian male actors" },
    { rank: 3, domain: "pantheon.example", url: "https://pantheon.example/iran", title: "Greatest Iranian Actors" }, { rank: 6, domain: "iranopedia.example", url: ACTORS_URL, title: ownedTitle }] }] });
describe("what the evidence justifies before anything is drafted", () => { it("leaves a page that already beats the clicks its positions earn alone, however big it is", () => {
    const c = compileCandidates(snap([WINNER]))[0]!; expect([c.action, c.query, c.recoverableClicks]).toEqual(["watch", "trail shoe reviews", 66]); // one soft search on a winning page is watched, not worked
    expect(c.reason).toContain("1,331"); expect(c.reason).not.toContain("75,646"); expect(c.reason).not.toContain("3,246"); // a page total is never quoted as a query number
    expect(snapshotToEvidenceInputs(snap([WINNER]))).toEqual([]); }); // no title, no description, no work
  it("earns exactly one action from a gap above every floor, carrying that query's own numbers", () => {
    expect(compileCandidates(SEEN()).map((c) => [c.action, c.gap, c.query, c.recoverableClicks])).toEqual([["act_existing_page", "ctr_deficit", "nowruz traditions", 300]]);
    const inputs = snapshotToEvidenceInputs(SEEN()); expect(inputs.map((i) => i.opportunity.field)).toEqual(["title"]); expect(inputs[0]!.sizing!.impactScore).toBe(300); // ONE field, and recoverable clicks is the only value scalar
    const hint = (inputs[0]!.evidence.hints ?? []).join(" "); expect(hint).toContain("6,000"); expect(hint).toContain("8.0 percent"); expect(hint).toContain("3.0 percent"); expect(hint).not.toContain("6,400"); }); // a page total never stands in for the query
  it("opens an INVESTIGATION on a gap it has never looked at, and sizes it without ever promising the clicks back", () => {
    const blind = compileCandidates(snap([GAP]))[0]!; // the SAME 300-click gap, with no live results page on file
    expect([blind.action, blind.recoverableClicks]).toEqual(["research_needed", 300]); // a gap opens an investigation, never a change
    expect(blind.reason).toContain("This search earns about 300 fewer clicks than pages at a similar position usually get");
    expect(blind.reason).toContain("I can see the gap but I have not looked at the live results page for that search yet, so I cannot tell you what to change."); // names exactly what is missing
    expect(snapshotToEvidenceInputs(snap([GAP]))).toEqual([]); // never drafted, so it can never render Ready
    const seen = compileCandidates(SEEN())[0]!; // confidence follows EVIDENCE, never the draft
    expect(seen.readiness).toEqual({ gsc: true, ownedCopy: true, serp: true, winners: 0, body: false }); // no body store exists, so body is false everywhere
    expect(`${blind.reason} ${seen.reason}`).not.toMatch(/worth about|win back|fastest win|more clicks a month/i); });
  it("refuses the title rewrite Google already performs for you, however badly the stored one reads", () => {
    const c = compileCandidates(snap([ACTORS], actorsSerp(DISPLAYED)))[0]!; // the stored title misses "Iranian"; the line a searcher actually reads does not
    expect([c.action, c.recoverableClicks, c.diagnosis!.cause, c.diagnosis!.action]).toEqual(["research_needed", 108, "google_rewrite_already_matches", null]);
    expect(c.reason).toContain(`Google already shows this page as "${DISPLAYED}", which carries the words people are searching for, so rewriting the title would not change what a searcher reads.`);
    expect(snapshotToEvidenceInputs(snap([ACTORS], actorsSerp(DISPLAYED)))).toEqual([]); }); // never drafted, so it can never render Ready
  it("reads one rival as an anecdote and two that agree as the pattern that earns a title", () => {
    const full = actorsSerp("Persian Screen | Iranopedia"); const lone = { ...full, serpEvidence: [{ ...full.serpEvidence[0]!, organic: full.serpEvidence[0]!.organic.slice(2) }] };
    const anecdote = compileCandidates(snap([ACTORS], lone))[0]!; // one competing page's wording is that page's style, never a rule
    expect([anecdote.action, anecdote.diagnosis!.cause]).toEqual(["research_needed", "ambiguous_search_intent"]);
    expect(anecdote.reason).toContain("they share no wording this page is missing, so the title is not the problem I can prove");
    const d = compileCandidates(snap([ACTORS], full))[0]!.diagnosis!; // three of them say it, and this page's own line does not
    expect([d.status, d.cause, d.action, d.evidenceKeys]).toEqual(["diagnosed", "snippet_intent_mismatch", "title", KEYS]);
    expect(d.alternativesRuledOut.map((a) => a.alternative)).toEqual(["Google is already showing the words people search for", "A different page of yours is the one ranking"]);
    expect(d.explanation).toContain('Google shows this page as "Persian Screen | Iranopedia", and the other sites that come up share wording that line does not carry: "iranian", "actor".');
    expect(d.explanation).not.toMatch(/result \d/); }); // rank_absolute counts ads and packs, so it is never printed as a search position
  it("ranks a small page with a real gap above a huge page with none, and sinks a rejected row", () => {
    expect(snapshotToEvidenceInputs(snap([WINNER, GAP], looked([["nowruz traditions", GAP_URL]]))).map((i) => i.page.path)).toEqual(["/nowruz-guide"]);
    const rejected = baseProposal({ id: "rej", status: "needs_review", impactScore: 9999 }); // a row still waiting on review never outranks a ready one on clicks alone
    expect(rankProposals([baseProposal({ id: "huge-no-gap", impactScore: 0 }), rejected, baseProposal({ id: "small-real-gap", impactScore: 300 })]).map((p) => p.id)).toEqual(["small-real-gap", "huge-no-gap", "rej"]); expect(proposalValueScore(baseProposal({ impactScore: 300 }))).toBeGreaterThan(proposalValueScore(rejected)); });
  it("treats nothing worth doing as a SUCCESS with no proposals, and never calls the drafter", async () => {
    reset(snap([WINNER])); let called = 0; const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async () => { called += 1; return { error: "the drafter must never run when nothing earned an action", retryable: false }; } }); // nothing earns an action, so nothing is drafted
    expect([res.outcome, res.actionable, res.proposals.length, res.candidates.length]).toEqual(["no_actionable_candidate", 0, 0, 1]); expect(called).toBe(0); expect(env.saved).toEqual([]); }); // no paid call, no persisted row
}); // ── one evidence basis, one decision generation, ONE material row ─────────────
const NOW = new Date("2026-07-26T00:00:00.000Z");
/** A REAL but smaller gap (169 clicks) that is listed FIRST, ahead of GAP's 300. */
const WEAK = ownedPage("fixture-outdoors.example/nowruz-food", "Nowruz Food", { impressions: 3000, clicks: 60 }, [{ query: "nowruz food traditions", impressions: 2800, clicks: 55, position: 4.1 }], ["Persian New Year Customs", "Haft-Seen"]);
const BOTH = () => snap([WEAK, GAP], looked([["nowruz food traditions", "fixture-outdoors.example/nowruz-food"], ["nowruz traditions", GAP_URL]]));
const reset = (s: EvidenceSnapshot): void => { env.snap = s; env.saved = []; env.store = new Map(); env.withdrawn = []; env.failWrites = false; env.bundleTarget = null; env.bundle = null; env.realBundle = false; env.door = null; };
/** Count every drafter call a pass made, answering with one valid edit. */
const counting = (): { complete: CompleteFn; calls: () => number } => { let n = 0; return { complete: async () => { n += 1; return { value: VALID_ATOMIC_EDIT }; }, calls: () => n }; };
const run = (complete: CompleteFn) => produceProposalsForTenant("fixture-tenant", { complete, now: NOW, bypassCache: true });
describe("a refresh re-pays nothing, and a pass that saved nothing says so", () => {
  it("aims the deep change at the STRONGEST gap, drafts and writes ONCE, then does nothing at all on the next pass", async () => {
    reset(BOTH()); const first = counting(); const one = await run(first.complete);
    expect(one.candidates.filter((c) => c.action === "act_existing_page").map((c) => c.recoverableClicks)).toEqual([169, 300]); // snapshot order puts the weak page first
    expect(env.bundleTarget).toBe("https://fixture-outdoors.example/nowruz-guide"); // the deep work still goes to the 300-click gap
    expect([one.outcome, one.persisted, one.reused, first.calls()]).toEqual(["proposals_persisted", 2, 0, 2]); const second = counting(); env.saved = []; const again = await run(second.complete);
    expect([again.outcome, again.persisted, again.reused, second.calls()]).toEqual(["proposals_persisted", 0, 2, 0]); // zero drafts, zero writes
    expect(env.saved).toEqual([]); expect(again.proposals.map((p) => p.id)).toEqual(one.proposals.map((p) => p.id)); });
  it("writes a new generation the moment the material content changes, and ignores a moved clock", () => {
    const p = baseProposal(); expect(proposalFingerprint({ ...p, createdAt: "2026-07-27T09:00:00.000Z" })).toBe(proposalFingerprint(p)); // a new timestamp is not new thinking
    for (const changed of [{ ...p, status: "needs_review" as const }, { ...p, confidence: "low" as const }, { ...p, basis: "after the business changed" },
      { ...p, recommendedChange: { kind: "existing_edit" as const, field: "title" as const, before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" } }]) expect(proposalFingerprint(changed)).not.toBe(proposalFingerprint(p)); });
  it("keeps the cause that actually produced the change, and still names one for a change that brought none", async () => {
    // THE LADDER IS ASKED TWICE with different inputs: once over the opportunities query, once inside the bundle over the exact search it drafted for. They can disagree,
    // and the bundle's answer stands. A proposal with NO cause takes this pass's.
    reset(SEEN());
    const plain = await run(counting().complete);
    const here = plain.candidates.find((c) => c.action === "act_existing_page")!.cause.cause;
    expect(plain.proposals[0]!.diagnosisCause).toBe(here);
    expect(here).not.toBe("weak_opening"); // the ladder here reaches a DIFFERENT cause: the whole fixture
    reset(SEEN());
    const own = { cause: "weak_opening" as const, action: null, evidenceKeys: ["demand-exact"], competingExplanations: [], notConsidered: [],
      falsifier: "If the page already answers the search in its first lines, this is not it.", explanation: "The page takes too long to answer the search." };
    env.bundle = { status: "bundled", proposal: baseProposal({ id: "fixture-tenant::/nowruz-guide::existing_edit::bundle",
      pagePath: "/nowruz-guide", pageUrl: "https://fixture-outdoors.example/nowruz-guide", diagnosisCause: "weak_opening", causeFinding: own }) };
    const res = await run(counting().complete);
    const bundled = res.proposals.find((p) => p.id.endsWith("::bundle"))!;
    expect([bundled.diagnosisCause, bundled.causeFinding!.cause]).toEqual(["weak_opening", "weak_opening"]); });
  it("calls a pass that saved nothing a FAILURE, and a real gap with no trusted draft exactly that", async () => {
    reset(SEEN()); env.failWrites = true; const failed = await run(counting().complete);
    expect([failed.outcome, failed.persisted, env.saved.length]).toEqual(["persistence_failed", 0, 1]); // it tried, and it says so
    reset(SEEN()); const thin = await run(async () => ({ error: "the drafter is off", retryable: false })); expect([thin.outcome, thin.actionable, thin.noDraft, thin.proposals.length]).toEqual(["actionable_but_no_trusted_draft", 1, 1, 0]); });
}); // ── research: what the pass is investigating, and what a run buys next ────────
const HAFT = "haft seen table"; const LOOKED_AT = "2026-07-25T00:00:00.000Z"; const RIVAL = (n: number) => `https://r${n}.example/a`; const DEMAND: EvidenceSnapshot["keywordDemand"] = [{ query: HAFT, searchVolume: 900, source: "dataforseo", competition: null, competitionLevel: null, gscImpressions: null }]; const COMPARED = [`https://${GAP_URL}`, RIVAL(1), RIVAL(2), RIVAL(3)].sort();
/** A dated look whose results agree on one meaning and one shape, with an intent on file: everything settled except the pages themselves. */ const GUIDED: FunnelResearchEvidence = { ...emptyResearchEvidence(), retainedKeywords: [{ query: HAFT, searchVolume: 900, competition: null, competitionLevel: null, difficulty: null, intent: "informational", discoveredVia: "gsc", seed: null }],
  serpEvidence: [{ query: HAFT, observedAt: LOOKED_AT, aiOverview: [], aiMode: [], paa: [], related: [], organic: [1, 2, 3].map((rank) => ({ rank, domain: `r${rank}.example`, url: RIVAL(rank), title: `${HAFT} guide` })) }] };
/** Every cheaper check behind me: three publishers I read, my own page on those results, and the answer to exactly the comparison this pass would buy. */ const READY = (over: Partial<ResearchPageComparison> = {}): FunnelResearchEvidence => ({ ...GUIDED, serpEvidence: [{ ...GUIDED.serpEvidence[0]!, organic: [...GUIDED.serpEvidence[0]!.organic, { rank: 4, domain: "fixture-outdoors.example", url: GAP_URL, title: "Nowruz" }] }], winningPages: [1, 2, 3].map((n) => ({ url: RIVAL(n), domain: `r${n}.example`, engines: [], examplePrompts: [], appearances: [{ kind: "serp_organic" as const, query: HAFT, promptId: null, promptText: null, engine: null, rank: n, citedUrl: RIVAL(n), observedAt: LOOKED_AT, modelServed: null }], extract: { title: "g", h1: "g", wordCount: 900, headings: [], faqCount: 0, fetchedAt: LOOKED_AT } })), pageComparisons: [{ topicKey: "", askKey: askIdentity({ pages: COMPARED, intersection_mode: "union" }), pages: COMPARED, excludePages: [], observedAt: LOOKED_AT, receipt: null, unavailable: null, comparison: { intersectionMode: "union", excludePages: [], pages: COMPARED.map((url, i) => ({ page: i + 1, url })), keywords: ["haft seen table on wikipedia.org", "b", "c"].map((keyword, i) => ({ keyword, searchVolume: 500, competition: null, competitionLevel: null, difficulty: null, mainIntent: "informational", ranks: (i === 2 ? [3, 4] : [2, 3]).map((page) => ({ page, url: COMPARED[page - 1]!, title: null, rank: page })) })) }, ...over }] });
const keyOf = (research: FunnelResearchEvidence): string => buildTopicInvestigations(snap([GAP], research, DEMAND)).find((i) => i.label === HAFT)!.key;
/** One bought comparison, written as which requested page ranks for which search (page 1 is my own). */
const comparisonOf = (rows: Array<[string, number[]]>) => ({ intersectionMode: "union" as const, excludePages: [], pages: COMPARED.map((url, i) => ({ page: i + 1, url })),
  keywords: rows.map(([keyword, ranks]) => ({ keyword, searchVolume: 500, competition: null, competitionLevel: null, difficulty: null, mainIntent: "informational",
    ranks: ranks.map((page) => ({ page, url: COMPARED[page - 1]!, title: null, rank: page })) })) });
describe("the pass says what it is investigating without turning any of it into work", () => {
  it("carries the research packets, picks the SAME strongest topic from the same evidence, and proposes nothing off them", async () => {
    const world = () => snap([WINNER], looked([["nowruz traditions", GAP_URL]])); // a page with no gap, plus one results page I have read
    let called = 0; const complete: CompleteFn = async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; };
    reset(world()); const first = await produceProposalsForTenant("fixture-tenant", { complete, now: NOW }); reset(world()); const again = await produceProposalsForTenant("fixture-tenant", { complete, now: NOW });
    expect(first.investigations.length).toBeGreaterThan(0); expect(first.coverage).toEqual(again.coverage); // the packet reaches the pass, and the same evidence reaches the same answer every time
    expect([first.outcome, first.proposals.length, called, env.saved.length]).toEqual(["no_actionable_candidate", 0, 0, 0]); }); // no candidate, no draft, no row
  it("queues one search per topic and only what buying can actually close", async () => {
    const asked = canon({ promptId: "p1", promptText: "where do I see nowruz fire jumping", engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [], fanOutQueries: ["nowruz fire jumping"], observedAt: LOOKED_AT });
    reset(snap([GAP, WEAK], { ...GUIDED, aiObservations: [asked] }, DEMAND)); // one topic settled but unread, one never looked at, and two page gaps that are no topic at all
    expect(await queued("fixture-tenant")).toEqual([HAFT, "nowruz fire jumping"]); // read that one's winners, buy the other one's missing look
    reset(snap([GAP], looked([[HAFT, GAP_URL]], LOOKED_AT))); expect(await queued("fixture-tenant")).toEqual([]); }); // a dated look answering two meanings of the phrase: no purchase settles that, so it queues nothing
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
/** A SECOND topic that outranks the one holding the comparison and that no purchase can move: bigger demand, results I have read, and a page of my own that could already
 *  be the answer whose words I have never held. */
const PARKED = "nowruz table settings"; const PARK_RIVAL = (n: number) => `https://p${n}.example/a`; const UNREAD_URL = "fixture-outdoors.example/nowruz-table";
const UNREAD: OwnedPageEvidence = { ...ownedPage(UNREAD_URL, "T", { impressions: 10, clicks: 1 }, []), content: null };
const PARKED_DEMAND: EvidenceSnapshot["keywordDemand"] = [{ query: PARKED, searchVolume: 2000, source: "dataforseo", competition: null, competitionLevel: null, gscImpressions: null }];
const withParked = (r: FunnelResearchEvidence): FunnelResearchEvidence => ({ ...r,
  retainedKeywords: [...r.retainedKeywords, { query: PARKED, searchVolume: 2000, competition: null, competitionLevel: null, difficulty: null, intent: "informational", discoveredVia: "gsc", seed: null }],
  serpEvidence: [...r.serpEvidence, { query: PARKED, observedAt: LOOKED_AT, aiOverview: [], aiMode: [], paa: [], related: [], organic: [...[1, 2, 3].map((rank) => ({ rank, domain: `p${rank}.example`, url: PARK_RIVAL(rank), title: `${PARKED} guide` })), { rank: 4, domain: "fixture-outdoors.example", url: UNREAD_URL, title: "T" }] }],
  winningPages: [...r.winningPages, ...[1, 2, 3].map((n) => ({ url: PARK_RIVAL(n), domain: `p${n}.example`, engines: [], examplePrompts: [], appearances: [{ kind: "serp_organic" as const, query: PARKED, promptId: null, promptText: null, engine: null, rank: n, citedUrl: PARK_RIVAL(n), observedAt: LOOKED_AT, modelServed: null }], extract: { title: "g", h1: "g", wordCount: 900, headings: [], faqCount: 0, fetchedAt: LOOKED_AT } }))] });
/** A brief with no figure, no address and no question the evidence did not supply. */
const BRIEF = { proposedTitle: "The haft seen table, and what belongs on it", metaDescription: "What a haft seen table is, what goes on it, and how families set one out for the new year.",
  openingAnswer: "A haft seen table is the spread a household sets out for the new year, and each item on it stands for something the family hopes the year will bring.",
  whyExistingPagesLose: "Your page fixture-outdoors.example/nowruz-guide covers the wider holiday and never sets out the table itself, so stretching it would bury the answer people are looking for.",
  sections: ["What a haft seen table is", "What goes on the table", "How families set the table out"].map((heading) => ({ heading, covers: "Answer this plainly and name what belongs on it.", evidenceKeys: ["verdict"] })),
  sourceRequirements: ["Cite a cultural reference for what each item stands for."], factRequirements: ["Check every item name against a source before this goes out."],
  internalLinks: [{ url: GAP_URL, anchor: "the wider holiday" }], faqQuestions: [], headKeys: ["verdict"] };
/** THE PAGE'S OWN SECTIONS, through the real section drafter: a Ready new page carries copy, never a plan. */
const sectionDraft = (user: string, heading = (user.match(/Section to write: (.*)/) ?? [])[1] ?? "The table") => ({ heading,
  body: `${heading}: a haft seen table is the spread a household sets out for the new year, and every piece on it stands for something the family hopes the year will bring. This part of the page says what belongs there and why, in the words a reader looking for ${heading.toLowerCase()} would use.`,
  sources: [{ kind: "own_data", detail: "your own search data for this subject" }], containsNumber: false });
/** One whole drafting pass for a page: the brief, then every planned section. `sections: false` refuses one. */
const pageSeam = (brief: unknown, sections = true): CompleteFn => async ({ kind, user }) =>
  ({ value: (kind === "new_page_brief" ? brief : kind === "section_draft" ? (sections || user.includes("Section to write: What a haft seen table is") ? sectionDraft(user) : {}) : VALID_ATOMIC_EDIT) as never });
const briefSeam = (brief: unknown = BRIEF): { complete: CompleteFn; kinds: string[] } => { const kinds: string[] = []; const inner = pageSeam(brief);
  return { kinds, complete: async (r) => { kinds.push(r.kind); return inner(r); } }; };
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
    const read = (w: EvidenceSnapshot) => readCoverage(w, "fixture-tenant", { basis: "basis_today", maxQueries: 3, now: NOW });
    const owed = (r: Awaited<ReturnType<typeof readCoverage>>) => r.needs.find((n) => n.requirement === "owned_content");
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
    // A question I track on this subject and NOT ONE search an engine ran itself: the branch where calling the example a fan-out would be a lie.
    const asked = [canon({ promptId: "p9", promptText: HAFT, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [], fanOutQueries: [], observedAt: LOOKED_AT })];
    reset(snap([GAP], { ...READY({ topicKey: keyOf(READY()) }), aiObservations: asked }, DEMAND)); const seam = briefSeam();
    const res = await produceProposalsForTenant("fixture-tenant", { complete: seam.complete, now: NOW });
    expect(seam.kinds).toEqual(["new_page_brief", "section_draft", "section_draft", "section_draft"]); // the brief, then the copy for every planned section
    const pages = res.proposals.filter((p) => p.kind === "new_page"); expect(pages).toHaveLength(1);
    const page = pages[0]!; expect(page.recommendedChange).toEqual({ kind: "new_page", proposedTitle: BRIEF.proposedTitle, metaDescription: BRIEF.metaDescription,
      openingAnswer: BRIEF.openingAnswer, outline: BRIEF.sections.map((s) => s.heading), faqQuestions: [], schemaTypes: [] }); // no markup is guessed for a page that does not exist yet
    expect([page.status, page.pagePath, page.publish, validateProposal(page).verdict]).toEqual(["needs_review", null, "manual", "ready"]);
    expect(page.bundle!.plan).toBeUndefined(); // a page that does not exist yet has nothing to keep, change or remove
    expect(page.bundle!.receipt.items.some((i) => i.key === "verdict")).toBe(true);
    // WHOSE SEARCH IS WHOSE: with no fan-out on file the example is named for what it actually is, a question people ask.
    expect(page.bundle!.receipt.items.find((i) => i.key === "asked")!.fact).toBe('No AI engine has shown me a search of its own here. What I hold is a question people ask, like "haft seen table".'); expect(page.bundle!.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer", "section", "source_pack", "internal_links"]);
    // THE OPERATOR PASTES COPY, NOT A PLAN: every planned section in the planned order, written out.
    const written = page.bundle!.components.find((c) => c.kind === "section")!.after;
    for (const s of BRIEF.sections) expect(written).toContain(`${s.heading}: a haft seen table is the spread`);
    expect(written).not.toContain("Answer this plainly"); // the brief's own instruction never ships as the page
    // A SOURCE I HOLD IS NAMED WHOLE: the page, its publisher, what it stands behind, and the day I read it. But a requirement of the model's own is never a source, so
    // it keeps the caveat and the page is held for review.
    const pack = page.bundle!.components.find((c) => c.kind === "source_pack")!.after;
    expect(pack).toContain(`${RIVAL(1)}, published by r1.example, read on 2026-07-25: it is one of the pages that win "${HAFT}"`);
    expect(pack).toContain("Cite a cultural reference for what each item stands for. You pick the exact source for this one");
    expect(page.limitations).toContain("Some of what this page claims still rests on the kind of source it needs rather than a source I hold, so you pick those before it goes out.");
    const queue = await loadProposalQueue("fixture-tenant", { currentBasis: page.basis! }); expect(queue.toDo.map((p) => p.id)).toContain(page.id); // held for a look, never shown ready
    const again = await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW }); expect(again.reused).toBe(1); }); // a refresh re-pays nothing
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
  it.each([["the winners share too little to be a pattern", [["a", [2, 3]], ["b", [2, 3]]], "do_nothing"],
    ["a page I already have carries the cluster", [["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]], "improve_existing"],
  ] as Array<[string, Array<[string, number[]]>, string]>)("answers %s without building anything", async (_what, rows, verdict) => {
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
    // A row that looks current but carries none of that evidence is an older idea, and it stays off the queue.
    const ghost: ChangeProposal = { ...baseProposal({ id: "ghost", kind: "new_page", pagePath: null, basis: "basis_today", bundle: undefined,
      recommendedChange: { kind: "new_page", proposedTitle: "T", metaDescription: "M", openingAnswer: "A", outline: ["One"], faqQuestions: [], schemaTypes: [] } }) };
    env.store = new Map([["ghost", ghost]]); const q = await loadProposalQueue("fixture-tenant", { currentBasis: "basis_today" });
    expect([q.ranked, q.ready, q.toDo].map((l) => l.length)).toEqual([0, 0, 0]); expect(q.demotedStaleBasis).toBe(1); });
}); // ── what the winning pages share, computed on the drafting pass ──────────────
const HEADS = ["What a haft seen table is", "Setting out the table", "What each item stands for"];
const OPENS = "Families set one of these out at the turn of the year, and every piece on it carries a meaning.";
const rich = (w: FunnelResearchEvidence["winningPages"][number], i: number) => ({ ...w, extract: { title: `${HAFT} guide`, h1: `${HAFT} guide`, wordCount: 900 + i,
  headings: HEADS, faqCount: 2, fetchedAt: LOOKED_AT, openingSample: OPENS, entityNames: ["Nowruz"] } });
/** A FOURTH ranked winner whose read is months old: it ranks, and I do not currently hold its words. */
const STALE = { url: RIVAL(4), domain: "r4.example", engines: [], examplePrompts: [], appearances: [{ kind: "serp_organic" as const, query: HAFT, promptId: null, promptText: null, engine: null, rank: 4, citedUrl: RIVAL(4), observedAt: LOOKED_AT, modelServed: null }],
  extract: { title: `${HAFT} guide`, h1: null, wordCount: 200, headings: [], faqCount: 0, fetchedAt: "2026-01-04T00:00:00.000Z" } };
const READABLE = (over: Partial<ResearchPageComparison> = {}): FunnelResearchEvidence => { const r = READY(over); return { ...r, winningPages: [...r.winningPages.map(rich), STALE] }; };
/** A reading in its OWN words: it repeats the shape it was handed, names only what every cited page carries, and writes a gap only against a page of mine. */
const PATTERN = (user: string) => ({ archetype: user.match(/SETTLED: (\w+)/)?.[1] ?? "unknown",
  commonHeadings: [{ heading: "what each piece means", seenOn: [0, 1, 2] }], commonEntities: [{ entity: "Nowruz", seenOn: [0, 1, 2] }],
  questionsAnswered: ["What belongs on it?"], openingPattern: "Each of them answers the question in its first sentence.",
  disagreements: ["Some of them call it a custom and others call it a shopping list."],
  ownedGaps: user.includes("I hold no page of my own") ? [] : [{ gap: "your page never walks through the pieces one by one", seenOn: [0, 1, 2] }],
  uniqueNotCommon: [{ detail: "one of them prices the pieces", seenOn: [1] }] });
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
    expect(d.evidence!.find((e) => e.id === "gap1")!.fact).toContain("Your own page does not do what 3 of them do");
    expect(d.evidence!.find((e) => e.id === "pattern")!.fact).toContain("I read the 3 pages that win here"); });
  it("puts what each winner contributed into the page it drafts, in the verdict's own words", async () => { reset(snap([GAP], READABLE({ topicKey: keyOf(READY()) }), DEMAND));
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async (r) => (r.kind === "winning_pattern" ? { value: PATTERN(r.user) as never } : pageSeam(BRIEF)(r)) });
    const page = res.proposals.find((p) => p.kind === "new_page")!; const keys = page.bundle!.receipt.items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["pattern", "opening", "common1"])); // the verdict's OWN lines, not a second paraphrase of one reading
    expect(keys).not.toContain("gap1"); // I own no page for this subject, so none was supplied and no gap was ever written
    expect(page.bundle!.receipt.items.find((i) => i.key === "common1")!.fact).toBe("3 of the 3 cover what each piece means."); }); });
// ── every door reaches the deep producer, not only a proven click gap ─────────
/** A page the click door can NEVER select: about 27 clicks short of the 50 a change owes, and its displayed line already carries the searcher's words. */
const WHOLE = ownedPage(GAP_URL, `${HAFT} guide for Nowruz`, { impressions: 900, clicks: 45 }, [{ query: HAFT, impressions: 900, clicks: 45, position: 4.1 }], ["Persian New Year Customs", "what each piece means"]);
const SPLIT_URL = "fixture-outdoors.example/haft-seen-table";
const ASKED = canon({ promptId: "p8", promptText: `what goes on a ${HAFT}`, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null,
  modelServed: null, webSearchReported: true, citationsObserved: true, citations: [{ url: RIVAL(1), domain: "r1.example", title: "g" }], fanOutQueries: [HAFT], observedAt: LOOKED_AT });
const doorWorld = (over: Partial<FunnelResearchEvidence> = {}, pages: OwnedPageEvidence[] = [WHOLE], can: EvidenceSnapshot["cannibalization"] = []): EvidenceSnapshot => {
  const r = READABLE({ comparison: comparisonOf([["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]]) });
  const research = { ...r, serpEvidence: [{ ...r.serpEvidence[0]!, organic: [...GUIDED.serpEvidence[0]!.organic, { rank: 4, domain: "fixture-outdoors.example", url: GAP_URL, title: `${HAFT} guide` }] }], ...over };
  const world = { ...snap(pages, research, DEMAND), cannibalization: can };
  // The comparison is pinned to the case THIS world actually builds, so an extra answer in the evidence never orphans it.
  const key = buildTopicInvestigations(world).find((i) => i.label === HAFT)?.key ?? "";
  return { ...world, research: { ...research, pageComparisons: (research.pageComparisons ?? []).map((c) => ({ ...c, topicKey: key })) } };
};
/** The REAL producer, through the REAL pass: nothing about the deep change is stubbed here. */
const doorRun = (world: EvidenceSnapshot, read: (u: string) => unknown = PATTERN) => { reset(world); env.realBundle = true;
  return produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true,
    complete: async (r) => (r.kind === "winning_pattern" ? { value: read(r.user) as never } : pageSeam(BRIEF)(r)) }); };
describe("a page earns the deep read through the door its own evidence opens", () => {
  it("acts on a page with ZERO recoverable clicks because my comparison named it, off the comparison's own search", async () => { const res = await doorRun(doorWorld());
    expect(res.candidates.every((c) => c.action !== "act_existing_page")).toBe(true); // no click gap anywhere: the old pass stopped here
    expect([env.door!.door, env.door!.evidence.query]).toEqual(["coverage_verdict", HAFT]);
    const deep = res.proposals.find((p) => p.bundle)!;
    expect(deep.primaryQuery).toBe(HAFT); // the door's own search, never a gap query that does not exist
    expect(deep.bundle!.components.every((c) => c.kind !== "title")).toBe(true);
    expect(deep.impactScore).toBeNull(); // no proven size, so it ranks as a direction and claims no clicks
  });
  it("acts on a page an engine answered around, off the question it was asked", async () => {
    // Nothing structural is left to accuse: the only thing wrong is that the engine answering its search never names it.
    const noGaps = (u: string) => ({ ...PATTERN(u), ownedGaps: [], openingPattern: "" });
    const res = await doorRun(doorWorld({ aiObservations: [ASKED] }), noGaps);
    expect([env.door!.door, env.door!.evidence.query]).toEqual(["ai_absence", HAFT]);
    const deep = res.proposals.find((p) => p.bundle)!;
    expect(deep.bundle!.components.map((c) => c.kind)).toEqual(["source_update"]); // a source improvement, never a reworded title
    expect(deep.opportunityType).toBe("Give the assistants a reason to name this page");
    // AND IT CAN SHOW THE ANSWER IT WAS MADE FROM: the cause cites the receipt id the receipt actually writes.
    expect([deep.bundle!.components[0]!.evidenceKeys, deep.bundle!.receipt.items.find((i) => i.key === "ai-citations")!.fact.includes(`what goes on a ${HAFT}`)]).toEqual([["ai-citations"], true]);
  });
  /** WHAT A REFUSAL COSTS AND WHAT IT SETTLES: the sentence reaches the operator's receipt, and a stored change whose claims stopped resolving is re-judged and TAKEN
   *  BACK rather than quietly kept on their list. */
  it("carries a refusal onto the candidate line, and takes back the stored change whose evidence stopped resolving", async () => {
    const owed = "I could write 1 of the 3 sections this rebuild needs and 2 are still owed, so I am not handing you half a page.";
    reset(doorWorld()); env.bundle = { status: "none", reason: owed };
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: pageSeam(BRIEF) });
    expect(res.candidates.some((c) => c.reason.includes(owed))).toBe(true);
    const kept = (await doorRun(doorWorld({ aiObservations: [ASKED] }), (u: string) => ({ ...PATTERN(u), ownedGaps: [], openingPattern: "" }))).proposals.find((p) => p.bundle)!;
    env.store.set(kept.id, { ...kept, causeFinding: { ...kept.causeFinding!, evidenceKeys: [...kept.causeFinding!.evidenceKeys, "demand-competing"] } });
    env.realBundle = false; env.bundle = { status: "none", reason: owed }; env.saved = []; env.withdrawn = [];
    const again = await produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: pageSeam(BRIEF) });
    expect([env.withdrawn, again.proposals.some((p) => p.id === kept.id)]).toEqual([[kept.id], false]); });
  it("never rewords one of two pages fighting over one search: it settles the split or it refuses", async () => {
    const split = ownedPage(SPLIT_URL, `${HAFT} table`, { impressions: 900, clicks: 30 }, [{ query: HAFT, impressions: 900, clicks: 30, position: 9 }]);
    const res = await doorRun(doorWorld({}, [WHOLE, split], [{ query: HAFT, note: "two of your own pages", competingUrls: [GAP_URL, SPLIT_URL] }]));
    const deep = res.proposals.find((p) => p.bundle);
    expect(res.proposals.every((p) => p.bundle?.components.some((c) => c.kind === "title") !== true)).toBe(true);
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
    expect([page.bodyHeld, page.strongSignals]).toEqual([false, 1]); expect(page.signals.find((s) => s.strength === "unknown")!.detail).toBe("I do not hold this page's words, so I cannot tell you whether it already covers this."); });
  it("surfaces BOTH of my pages when both already cover the topic", () => { expect(cands(BOTH()).map((c) => [c.url, c.strongSignals])).toEqual([[GAP_URL, 2], [FOOD, 2]]); });
}); // ── WHY this page loses the click: one named cause, or none ─────────────────
/** The reading the drafting pass hands the verdict: what the winners share, and what MY page does not do. */
const PATTERN_HELD = { archetype: "informational_guide" as const, commonHeadings: [{ heading: "what each piece means", seenOn: [0, 1, 2] }], commonEntities: [],
  questionsAnswered: [], openingPattern: "Each of them answers the question in its first sentence.", disagreements: [], uniqueNotCommon: [],
  ownedGaps: [{ gap: "your page never walks through the pieces one by one", seenOn: [0, 1, 2] }], winners: 3, publishers: ["r1.example", "r2.example", "r3.example"], fingerprint: "fixture" };
/** The five causes nothing in this generation can test, which must therefore never be guessed at. */
const NEVER_HELD = ["demand_decline", "ranking_loss", "technical_indexability", "measuring_change"]; // retrieved_not_cited went live when the projection began carrying the retrieval list
/** An engine answering this page's own search and naming everybody except this page. */
const CITED_ELSEWHERE = (): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), aiObservations: [canon({ promptId: "p1", promptText: "nowruz traditions explained", engine: "chatgpt",
  observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true,
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
    expect(compileCandidates(supported)[0]!.cause.cause).toBe("cannibalization"); }); // my own keyword research reaches the same answer on its own
  it("names what the winning pages do that mine does not, citing the verdict's own receipt lines", async () => {
    const world = snap([GAP], READABLE({ topicKey: keyOf(READY()), comparison: comparisonOf([["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]]) }), DEMAND);
    const read = await readCoverage(world, "fixture-tenant", { basis: "basis_today", now: NOW, patternFor: { topicKey: keyOf(READY()), pattern: PATTERN_HELD } });
    expect([read.decided!.decision.verdict, read.decided!.decision.ownedUrls]).toEqual(["improve_existing", [GAP_URL]]);
    const c = compileCandidates(world, { coverage: read.decided })[0]!;
    expect([c.action, c.cause.cause, c.cause.evidenceKeys]).toEqual(["watch", "competitor_content_gap", ["pattern", "gap1"]]); // the ids the verdict wrote its own receipt under
    expect(c.reason).toContain("walks through the pieces one by one"); expect(snapshotToEvidenceInputs(world)).toEqual([]); // a subject the page never covers is not a title rewrite
    const blind = compileCandidates(world)[0]!; // the same page with no verdict in hand
    expect([blind.action, blind.cause.cause]).toEqual(["research_needed", "no_problem"]); // NOT considered rather than guessed at
    expect(blind.cause.notConsidered.map((n) => n.cause)).toContain("competitor_content_gap"); });
  it("walks down to the next cause when the one above it does not fire, and stops rather than guessing", async () => {
    const laddered = async (page: OwnedPageEvidence, pattern: typeof PATTERN_HELD) => {
      const world = snap([page], READABLE({ topicKey: keyOf(READY()), comparison: comparisonOf([["a", [2, 3, 1]], ["b", [2, 3, 1]], ["c", [3, 4]]]) }), DEMAND);
      const read = await readCoverage(world, "fixture-tenant", { basis: "basis_today", now: NOW, patternFor: { topicKey: keyOf(READY()), pattern } });
      return compileCandidates(world, { coverage: read.decided })[0]!;
    };
    const noGaps = { ...PATTERN_HELD, ownedGaps: [] }; const bare = { ...noGaps, commonHeadings: [], commonEntities: [] };
    expect((await laddered(GAP, noGaps)).cause.cause).toBe("incomplete_coverage"); // nothing my page fails to DO, so what they all cover is asked next
    const listy = ownedPage(GAP_URL, "Top 10 Nowruz Traditions", { impressions: 6400, clicks: 190 }, [{ query: "nowruz traditions", impressions: 6000, clicks: 180, position: 4.1 }]);
    expect((await laddered(listy, bare)).cause.cause).toBe("serp_shape_shift"); // and the kind of page that wins is asked after that
    const stopped = await laddered(GAP, bare); expect([stopped.action, stopped.cause.cause]).toEqual(["research_needed", "no_problem"]);
    expect(stopped.cause.notConsidered.map((n) => n.cause)).toEqual(expect.arrayContaining(["weak_opening", "serp_shape_shift", "internal_link_weakness", "ai_citation_gap"])); }); // each one named, none of them guessed
  it("says when an engine cites everybody but this page, and only where an answer with its sources is on file", () => { const c = compileCandidates(snap([GAP], CITED_ELSEWHERE()))[0]!;
    expect([c.action, c.cause.cause]).toEqual(["watch", "ai_citation_gap"]); expect(c.reason).toContain("chatgpt answered"); expect(c.reason).toContain("named 1 other site without"); // one site is one site, never "1 other sites"
    expect(compileCandidates(snap([GAP]))[0]!.cause.notConsidered.find((n) => n.cause === "ai_citation_gap")!.missing).toContain("no AI answer"); });
  it("tells a page the engine READ and passed over from one it never found, and only when the retrieval list was recorded", () => {
    const seen = { ...CITED_ELSEWHERE(), aiObservations: CITED_ELSEWHERE().aiObservations.map((o) => ({ ...o,
      retrievedResults: [{ url: `https://${GAP_URL}`, domain: "fixture-outdoors.example", title: null }] })) };
    const c = compileCandidates(snap([GAP], seen))[0]!;
    expect([c.cause.cause, c.reason.includes("passed over")]).toEqual(["retrieved_not_cited", true]); // read, judged, declined: a content verdict, not a wording one
    expect(compileCandidates(snap([GAP], CITED_ELSEWHERE()))[0]!.cause.cause).toBe("ai_citation_gap"); }); // no retrieval list recorded: the harder claim is never made
  it("answers a page that is losing nothing with no problem, and still says what it ruled out", () => {
    const c = compileCandidates(snap([WINNER]))[0]!; expect([c.action, c.cause.cause]).toEqual(["watch", "no_problem"]);
    expect(c.cause.competingExplanations.map((x) => x.cause)).toEqual(["ctr_snippet"]); expect(c.cause.falsifier).toContain("click rate"); });
  it("accuses THIS page of being read and passed over, never the page next door on the same site", () => { const retrieved = (url: string): FunnelResearchEvidence => ({ ...CITED_ELSEWHERE(),
      aiObservations: CITED_ELSEWHERE().aiObservations.map((o) => ({ ...o, retrievedResults: [{ url, domain: "fixture-outdoors.example", title: null }] })) });
    expect(compileCandidates(snap([GAP], retrieved("https://fixture-outdoors.example/nowruz-food")))[0]!.cause.cause).toBe("ai_citation_gap"); // a hit on another page of mine proves nothing about this one
    const mine = compileCandidates(snap([GAP], retrieved(`https://www.${GAP_URL}/`)))[0]!; // and a www or trailing-slash spelling of THIS page still is this page
    expect([mine.cause.cause, mine.reason.includes("cited 1 other site instead")]).toEqual(["retrieved_not_cited", true]); });
  it("leaves a pair of my pages splitting a DIFFERENT search as not considered, never as ruled out", () => {
    const elsewhere = { ...ACTORS_SEEN(), cannibalization: [{ query: "persian actresses", competingUrls: ["iranopedia.example/a", "iranopedia.example/b"], note: "" }] };
    const c = compileCandidates(elsewhere)[0]!; expect(c.cause.cause).toBe("ctr_snippet"); // the search I measured was never checked for competing pages of mine
    expect(c.cause.notConsidered.find((n) => n.cause === "cannibalization")!.missing).toContain("that exact search");
    expect(c.cause.competingExplanations.map((x) => x.cause)).not.toContain("cannibalization"); });
  it("stops recommending a page whose last change is still being measured, and admits when nobody told it", () => {
    const measuring = compileCandidates(ACTORS_SEEN(), { measuringPagePaths: ["/iranian-actors-actresses"] })[0]!;
    expect([measuring.action, measuring.cause.cause, measuring.cause.action]).toEqual(["watch", "measuring_change", null]);
    expect(measuring.cause.explanation).toContain("still being measured, so I am not stacking another one on top of it");
    const quiet = compileCandidates(ACTORS_SEEN(), { measuringPagePaths: ["/somewhere-else"] })[0]!; // told, and this page is not one of them
    expect([quiet.action, quiet.cause.cause]).toEqual(["act_existing_page", "ctr_snippet"]);
    expect(compileCandidates(ACTORS_SEEN())[0]!.cause.notConsidered.find((n) => n.cause === "measuring_change")!.missing).toContain("I do not hold which of your pages"); });
  it("counts the page it is holding back WHERE THE HOLD HAPPENS, without a draft, a paid call or a store attempt", async () => {
    reset(ACTORS_SEEN()); let called = 0; // the cause ladder fires measuring_change, so no draft is ever attempted for this page
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, measuringPagePaths: ["/iranian-actors-actresses"],
      complete: async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; } });
    expect([res.heldForMeasurement, res.proposals.length, called, env.saved.length]).toEqual([1, 0, 0, 0]);
    expect(await produceProposalsForTenant("fixture-tenant", { now: NOW, measuringPagePaths: ["/somewhere-else"], complete: async () => ({ value: VALID_ATOMIC_EDIT }) })
      .then((r) => r.heldForMeasurement)).toBe(0); }); // and a page nothing is measuring on is never counted as held
  it("counts a consolidation it cannot draft as work, and never reports a quiet day over it", async () => {
    const world = { ...ACTORS_SEEN(), cannibalization: [{ query: "iranian actors", competingUrls: [ACTORS_URL, "iranopedia.example/actors"], note: "" }] };
    reset(world); let called = 0;
    const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; } });
    expect([res.outcome, res.actionable, res.proposals.length, called]).toEqual(["actionable_but_no_trusted_draft", 1, 0, 0]); // named, counted, and not one paid call
    expect(res.candidates.find((c) => c.action === "consolidate")!.cause.cause).toBe("cannibalization"); });
  it("discounts a page only while its applied change is still being measured", async () => { const day = 24 * 60 * 60 * 1000; const applied = (ageDays: number): ChangeProposal =>
      baseProposal({ id: "applied", status: "implemented_pending_verification", basis: "b", createdAt: new Date(Date.now() - ageDays * day).toISOString() });
    expect(pagesUnderMeasurement([applied(10), applied(180)].map((p, i) => ({ ...p, pagePath: `/p${i}` })), new Date())).toEqual(["/p0"]);
    const overlapOf = async (ageDays: number) => { env.store = new Map([["live", baseProposal({ id: "live", basis: "b" })], ["applied", applied(ageDays)]]);
      return (await loadProposalQueue("fixture-tenant", { currentBasis: "b" })).ranked[0]!.rankingReceipt!.factors.find((f) => f.name === "overlap")!; };
    const fresh = await overlapOf(10); const stale = await overlapOf(180); // the production read, not an injected context
    expect([fresh.contribution, stale.contribution, stale.input]).toEqual([-30, 0, "nothing is being measured on this page"]); });
  /** THE SAFETY NET ON BOTH SIDES OF THE STORE: a stored change whose claims stopped resolving may not RENDER, and the next canonical pass takes it back even when
   *  nothing re-selects that page for a deep read. */
  it("neither renders nor keeps a stored change whose claims no longer resolve, without waiting to be re-selected", async () => {
    // a merge whose only component cites a comparison its receipt never carried: the live defect, stored
    const bad = (basis: string): ChangeProposal => baseProposal({ id: "fixture-tenant::/split::existing_edit::bundle", pagePath: "/split", basis, status: "needs_review", riskLevel: "high",
      bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] }, alternatives: [], risks: [], confidenceReasons: [],
        receipt: { items: [{ key: "demand-exact", kind: "gsc_demand", fact: "f", observedAt: null }], missing: [], freshestObservedAt: null },
        components: [{ kind: "consolidation", label: "Settle which page owns this search", before: null, after: "Keep one of these pages.", evidenceKeys: ["demand-competing"], risk: "dangerous", where: "across both", objective: "o", mechanism: "m", measurementPlan: "p" }] } });
    env.store = new Map([["good", baseProposal({ id: "good", basis: "b" })], [bad("b").id, bad("b")]]);
    expect((await loadProposalQueue("fixture-tenant", { currentBasis: "b" })).ranked.map((p) => p.id)).toEqual(["good"]); // it never reaches the screen
    reset(snap([WINNER])); env.store = new Map([[bad("basis_test").id, bad("basis_test")]]); // and no door opens on that page at all
    await produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: async () => ({ value: VALID_ATOMIC_EDIT }) });
    expect(env.withdrawn).toEqual([bad("b").id]); });
  /** AND THE SAME NET CATCHES A ROW THAT WENT COLD. Refused at every door but never taken back, it sits in its own slot forever: an identical redraft answers
   *  "unchanged", so nothing fresh can replace it. */
  it("takes back a change whose readings went cold, so a redraft off fresh evidence can take its slot", async () => {
    const aged = (observedAt: string): ChangeProposal => baseProposal({ id: "fixture-tenant::/aged::existing_edit::bundle", pagePath: "/aged", basis: "basis_test", status: "ready",
      bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] }, alternatives: [], risks: [], confidenceReasons: [],
        receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "f", observedAt }], missing: [], freshestObservedAt: observedAt },
        components: [{ kind: "title", label: "Title", before: "a", after: "b", evidenceKeys: ["k1"], risk: "safe" }] } });
    // Cold goes back; a receipt whose readings still stand is left exactly where it is.
    for (const [at, taken] of [[new Date(NOW.getTime() - 200 * 86_400_000).toISOString(), [aged("x").id]], [NOW.toISOString(), []]] as const) {
      reset(snap([WINNER])); env.store = new Map([[aged(at).id, aged(at)]]);
      await produceProposalsForTenant("fixture-tenant", { now: NOW, bypassCache: true, complete: async () => ({ value: VALID_ATOMIC_EDIT }) });
      expect(env.withdrawn, at).toEqual(taken);
    } });
  it("never emits a diagnosis without a competing explanation, a falsifier, and every unheld cause named", () => {
    for (const world of [snap([WINNER]), SEEN(), snap([GAP]), snap([ACTORS], actorsSerp(DISPLAYED)), snap([GAP], CITED_ELSEWHERE()), BOTH()]) { for (const c of compileCandidates(world)) {
        expect(c.cause.competingExplanations.length).toBeGreaterThan(0); expect(c.cause.competingExplanations.length).toBeLessThanOrEqual(3);
        expect(c.cause.competingExplanations.every((x) => x.reason.length > 0)).toBe(true); expect(c.cause.falsifier.length).toBeGreaterThan(0);
        expect(c.cause.notConsidered.map((n) => n.cause)).toEqual(expect.arrayContaining(NEVER_HELD));
        expect(c.cause.notConsidered.every((n) => n.missing.length > 0)).toBe(true);
        expect(`${c.cause.explanation} ${c.cause.falsifier}`).not.toMatch(/[–—]|SERP|experiment|baseline/); } } }); });