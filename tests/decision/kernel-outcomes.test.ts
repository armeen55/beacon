/** DECISION kernel outcomes: what the evidence justifies BEFORE anything is drafted, then generate ->
 *  validate -> rank -> persist -> REUSE, and fail-closed rejections. Each test name states its promise. */
import { describe, it, expect, vi } from "vitest";
// Budget is not this file's subject: always-allowed, no-op hermetic seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
const env = vi.hoisted(() => ({ snap: null as unknown, saved: [] as ChangeProposal[], store: new Map<string, ChangeProposal>(), failWrites: false, bundleTarget: null as string | null }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
vi.mock("@/domains/evidence/pages/owned-context", () => ({ loadOwnedPageBodies: async (_t: string, urls: string[]) => new Map(urls.filter((u) => !u.includes("unreadable")).map((u) => [u, { url: u, title: "T", metaDescription: null, openingSample: "How a nowruz table is set.", cardTexts: [], entityNames: [], internalLinks: [], fetchedAt: "2026-07-25T00:00:00.000Z" }])) }));
// The REAL fingerprint is under test; only the two I/O calls are seams. The deep bundle has its own suite, so here it only reports WHICH page it was aimed at.
vi.mock("@/domains/decision/proposal-store", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision/proposal-store")>("@/domains/decision/proposal-store")), loadChangeProposals: async () => env.store,
  saveChangeProposal: async (p: ChangeProposal) => { env.saved.push(p); if (env.failWrites) return "failed"; env.store.set(p.id, p); return "saved"; } }));
vi.mock("@/domains/decision/produce-bundle", () => ({
  produceBundleForSnapshot: async (_s: unknown, o: { onlyPageUrl?: string | null }) => { env.bundleTarget = o?.onlyPageUrl ?? null; return { status: "none", reason: "pinned in change-bundle.test" }; } }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "fixture-tenant", domain: "fixture-outdoors.example", growth_goal: null }), basisTag: () => "basis_test" }));
import { proposeExistingPageChange } from "@/domains/decision/propose";
import { validateProposal } from "@/domains/decision/validate-proposal";
import { rankProposals, proposalValueScore } from "@/domains/decision/rank-proposals";
import { compileCandidates, snapshotToEvidenceInputs } from "@/domains/decision/opportunities";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { chooseInvestigation, comparisonForFocus, focusQueries } from "@/domains/runtime/ops/investigation-queries";
import { reconcileResearchCases } from "@/domains/evidence/topic-investigation";
const queued = async (tenantId: string, at = 0) => focusQueries(await chooseInvestigation(tenantId, null), at);
import { proposalFingerprint } from "@/domains/decision/proposal-store"; import { ownedCandidatesFor } from "@/domains/decision/owned-coverage"; import { askIdentity } from "@/domains/evidence/page-intersection";
import { buildTopicInvestigations } from "@/domains/evidence/topic-investigation";
import { readCoverage, rankInvestigations } from "@/domains/decision/coverage-pass"; import { loadProposalQueue } from "@/domains/decision/load-proposals";
import { emptyResearchEvidence, type FunnelResearchEvidence, type ResearchPageComparison, type WinnerReadOutcome } from "@/domains/evidence/funnel/research-evidence";
import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { serializeChangeProposal, deserializeChangeProposal, type EvidenceInput, type ChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
/** A completion fn that replays a fixed queue (last response repeats). The seam returns a PARSED structured VALUE (never text); an error carries its retryability. */
function fakeComplete(responses: Array<{ value: unknown } | { error: string; retryable?: boolean }>): CompleteFn {
  let i = 0; return async () => { const r = responses[Math.min(i++, responses.length - 1)]!; return "error" in r ? { error: r.error, retryable: r.retryable ?? false } : { value: r.value }; };
} const PROOF = { metrics: ["clicks", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" };
const VALID_ATOMIC_EDIT = {
  field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen", confidence: "high",
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
function baseProposal(over: Partial<ChangeProposal> = {}): ChangeProposal {
  return {
    id: "referencepedia::/x::existing_edit::title", tenantId: "referencepedia", kind: "existing_edit", pagePath: "/x", pageUrl: "https://fixture-content.example/x",
    pageLabel: "X", primaryQuery: "nowruz traditions", opportunityType: "Capture clicks", changeFamily: "title", status: "proposed", evidence: { query: "nowruz traditions", hints: ["gsc demand"], evidenceRefCount: 1 },
    recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen" },
    whyItMatters: "The title misses the customs searchers ask about.", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "high", limitations: [],
    impactScore: 50, upsidePerMonth: 20, publish: "manual", createdAt: "2026-07-22T00:00:00.000Z", ...over };
} /** The exact-edit rewrite under test, with one field swapped. */
const edited = (field: "title" | "meta", before: string | null, after: string): ChangeProposal => baseProposal({ recommendedChange: { kind: "existing_edit", field, before, after } });
describe("existing-page cold proposal", () => {
  it("generates, validates, persists (serialize), and re-loads (deserialize)", async () => {
    const out = await proposeExistingPageChange(EXISTING_INPUT, { complete: fakeComplete([{ value: VALID_ATOMIC_EDIT }]), now: new Date("2026-07-22T00:00:00Z") });
    expect(out.status).toBe("proposed"); if (out.status !== "proposed") return;
    const p = out.proposal; if (p.recommendedChange.kind === "existing_edit") { expect(p.recommendedChange.before).toBe("Nowruz"); expect(p.recommendedChange.after).toContain("Nowruz Traditions"); } else throw new Error("expected an exact edit");
    expect(p.whyItMatters).toMatch(/customs/i); expect(p.primaryQuery).toBe("nowruz traditions"); expect(p.opportunityType).toBe("Capture clicks");
    expect(p.evidence.evidenceRefCount).toBe(5); expect(out.validation.verdict).toBe("ready"); expect(p.status).toBe("proposed"); // the receipt keys the diagnosis cites, and a safe draft is proposed, never rejected
    expect(deserializeChangeProposal(serializeChangeProposal(p))).toEqual(p); // persisted + loadable: round-trips + re-validates
    expect(deserializeChangeProposal(JSON.stringify({ v: 1, proposal: { ...p, recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "" } } }))).toBeNull(); // a tampered row is never served as trusted
    const brief = { kind: "new_page" as const, proposedTitle: "T", metaDescription: "M", openingAnswer: "A", outline: ["One"], faqQuestions: [], schemaTypes: [] }; // recorded before this kernel stopped writing them
    expect(deserializeChangeProposal(serializeChangeProposal({ ...p, id: "hist", kind: "new_page", pagePath: null, recommendedChange: brief }))?.recommendedChange).toEqual(brief); }); // history still decodes
  it("returns no_draft (fail-closed) when no key or completion transport exists", async () => { expect((await proposeExistingPageChange(EXISTING_INPUT)).status).toBe("no_draft"); });
  it("never calls the drafter for a candidate the results page has not accused", async () => { let called = 0; // no completion call, no copy, no row
    const out = await proposeExistingPageChange({ ...EXISTING_INPUT, evidence: { ...EXISTING_INPUT.evidence, diagnosis: undefined } }, { complete: async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; } });
    expect([out.status, called, out.status === "no_draft" && out.reason]).toEqual(["no_draft", 0, "I checked the results page, but it does not yet show that the title is the problem."]); });
}); describe("safety gates reject unsafe drafts", () => {
  const LONG_META = "Nowruz is the Persian New Year celebrated with the Haft-Seen table, customs, and foods across Iran and the diaspora.";
  it.each([ // one gate per row: the flag it must raise
    ["a placeholder stub", edited("title", "Nowruz", "Nowruz [insert customs here]"), /placeholder|stub/i],
    ["an em dash in operator copy", edited("title", "Nowruz", "Nowruz Traditions — Persian New Year"), /dash/i],
    ["a raw uuid leaking into copy", edited("title", "Nowruz", "Nowruz 550e8400-e29b-41d4-a716-446655440000 Guide"), /./],
    ["a destructive edit that guts the current value", edited("meta", LONG_META, "Nowruz."), /destructive/i]] as const)("rejects %s", (_w, p, flag) => {
    const v = validateProposal(p); expect(v.verdict).toBe("rejected"); expect(v.status).toBe("rejected"); // a rejected verdict maps to a rejected proposal status, never a quiet needs_review
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
/** THE LIVE PRODUCTION CASE, verified 2026-07-27: 2,451 views and 15 clicks at position 6.1 on one search, a stored title missing
 *  the searcher's own word, and a results page where Google already displays that word back to them. */
const ACTORS_URL = "iranopedia.example/iranian-actors-actresses"; const DISPLAYED = "Famous Iranian & Persian Actors, Actresses & Celebrities";
const ACTORS = ownedPage(ACTORS_URL, "Top 20 Famous Persian Actresses and Actors | Iranopedia", { impressions: 2451, clicks: 15 }, [{ query: "iranian actors", impressions: 2451, clicks: 15, position: 6.1 }]);
const actorsSerp = (ownedTitle: string): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), serpEvidence: [{ observedAt: null, query: "iranian actors", aiOverview: [], aiMode: [], paa: [], related: [],
  organic: [{ rank: 1, domain: "imdb.example", url: "https://imdb.example/list", title: "Iranian Actors" }, { rank: 2, domain: "wiki.example", url: "https://wiki.example/list", title: "List of Iranian male actors" },
    { rank: 3, domain: "pantheon.example", url: "https://pantheon.example/iran", title: "Greatest Iranian Actors" }, { rank: 6, domain: "iranopedia.example", url: ACTORS_URL, title: ownedTitle }] }] });
describe("what the evidence justifies before anything is drafted", () => {
  it("leaves a page that already beats the clicks its positions earn alone, however big it is", () => {
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
    const rejected = baseProposal({ id: "rej", status: "rejected", impactScore: 9999 }); // a rejected row never outranks a real one on clicks alone
    expect(rankProposals([baseProposal({ id: "huge-no-gap", impactScore: 0 }), rejected, baseProposal({ id: "small-real-gap", impactScore: 300 })]).map((p) => p.id)).toEqual(["small-real-gap", "huge-no-gap", "rej"]); expect(proposalValueScore(baseProposal({ impactScore: 300 }))).toBeGreaterThan(proposalValueScore(rejected)); });
  it("treats nothing worth doing as a SUCCESS with no proposals, and never calls the drafter", async () => {
    reset(snap([WINNER])); let called = 0; const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async () => { called += 1; return { error: "the drafter must never run when nothing earned an action", retryable: false }; } }); // nothing earns an action, so nothing is drafted
    expect([res.outcome, res.actionable, res.proposals.length, res.candidates.length]).toEqual(["no_actionable_candidate", 0, 0, 1]); expect(called).toBe(0); expect(env.saved).toEqual([]); }); // no paid call, no persisted row
}); // ── one evidence basis, one decision generation, ONE material row ─────────────
const NOW = new Date("2026-07-26T00:00:00.000Z");
/** A REAL but smaller gap (169 clicks) that is listed FIRST, ahead of GAP's 300. */
const WEAK = ownedPage("fixture-outdoors.example/nowruz-food", "Nowruz Food", { impressions: 3000, clicks: 60 }, [{ query: "nowruz food traditions", impressions: 2800, clicks: 55, position: 4.1 }], ["Persian New Year Customs", "Haft-Seen"]);
const BOTH = () => snap([WEAK, GAP], looked([["nowruz food traditions", "fixture-outdoors.example/nowruz-food"], ["nowruz traditions", GAP_URL]]));
const reset = (s: EvidenceSnapshot): void => { env.snap = s; env.saved = []; env.store = new Map(); env.failWrites = false; env.bundleTarget = null; };
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
    const asked = { promptId: "p1", promptText: "where do I see nowruz fire jumping", engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [], fanOutQueries: ["nowruz fire jumping"], observedAt: LOOKED_AT };
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
    const aiObservations = [{ promptId: "p9", promptText: HAFT, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [], fanOutQueries: [], observedAt: LOOKED_AT }];
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
/** A SECOND topic that outranks the one holding the comparison and that no purchase can move: bigger demand,
 *  results I have read, and a page of my own that could already be the answer whose words I have never held. */
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
const briefSeam = (): { complete: CompleteFn; kinds: string[] } => { const kinds: string[] = []; return { kinds, complete: async ({ kind }) => { kinds.push(kind); return { value: (kind === "new_page_brief" ? BRIEF : VALID_ATOMIC_EDIT) as never }; } }; };
describe("a subject I own no page for becomes ONE researched page, and nothing else does", () => {
  it("reads a page of mine whose words are already stored, decides again in the SAME pass, and still judges the topic that OWNS the comparison", async () => {
    const research = withParked(READY({ topicKey: keyOf(READY()) })); const world = snap([GAP, UNREAD], research, [...DEMAND, ...PARKED_DEMAND]);
    const order = buildTopicInvestigations(world); const parked = order.find((i) => i.label === PARKED)!;
    const read = await readCoverage(world, "fixture-tenant", { basis: "basis_today", maxQueries: 3 });
    expect(rankInvestigations(order)[0]!.key).toBe(parked.key); // it ranks first, and its own page sat unread while its words were already on file
    expect(read.needs.find((n) => n.topicKey === parked.key)?.requirement).toBe("page_intersection"); // one bounded read moved it on without sending the operator away
    expect([read.decided!.investigation.label, read.decided!.decision.verdict]).toEqual([HAFT, "create_new"]); }); // and the comparison I paid for is read for the topic that owns it
  it("tells a robots refusal from a page that did not answer, retries neither before its date, and judges a body it just acquired in the SAME pass", async () => {
    const dark: OwnedPageEvidence = { ...ownedPage("fixture-outdoors.example/nowruz-unreadable", "T", { impressions: 400, clicks: 4 }, [{ query: PARKED, impressions: 400, clicks: 4, position: 6 }]), content: null };
    const world = snap([GAP, UNREAD, dark], withParked(READY({ topicKey: keyOf(READY()) })), [...DEMAND, ...PARKED_DEMAND]);
    const at = (acquireBody: NonNullable<Parameters<typeof readCoverage>[2]>["acquireBody"]) => readCoverage(world, "fixture-tenant", { basis: "basis_today", maxQueries: 3, now: NOW, acquireBody });
    const owed = (r: Awaited<ReturnType<typeof readCoverage>>) => r.needs.find((n) => n.requirement === "owned_content");
    const shut = await at(async (_t, url) => ({ failure: { url, state: "robots_blocked", retryAfter: null } }));
    const down = await at(async (_t, url) => ({ failure: { url, state: "temporarily_unavailable", retryAfter: "2026-07-27T00:00:00.000Z" } }));
    expect([owed(shut)!.retryAfter, shut.waitingUntil]).toEqual([null, null]); // a refusal carries no date at all, so it never enters the daily retry loop
    expect([owed(down)!.retryAfter, down.waitingUntil]).toEqual([null, null]); // and a page that did not answer promises NO day, because that failure is not stored anywhere and a date would slide forward on every visit
    const got = await at(async (_t, url) => ({ body: { url, title: "T", metaDescription: null, openingSample: "How a nowruz table is set out, item by item.", cardTexts: [], entityNames: [], internalLinks: [], fetchedAt: LOOKED_AT } }));
    expect([owed(got), got.waitingUntil]).toEqual([undefined, null]); // the body I just read is judged in this same breath, not next visit
    const plan = { basis: "b", topics: [{ topicKey: "t1", query: "still cooling off", requirement: "owned_content", retryAfter: "2026-07-27T00:00:00.000Z" }, { topicKey: "t2", query: "due now", requirement: "exact_serp", retryAfter: null }] }; // no URL is read before its cooldown expires
    expect([focusQueries(plan, Date.parse("2026-07-26T00:00:00Z")), focusQueries(plan, Date.parse("2026-07-28T00:00:00Z"))]).toEqual([["due now"], ["still cooling off", "due now"]]); });
  it("finds the comparison AND the live page filed under an id this case absorbed, so neither is bought or built a second time", async () => {
    const key = keyOf(READY()); const anchors = reconcileResearchCases(snap([GAP], READY(), DEMAND)).find((c) => c.id === key)!.anchors;
    const cases = [{ id: "inv_absorbed", anchors: anchors.slice(0, 1) }, { id: key, anchors }]; // two ids on file for one subject, already merged and SAVED
    const world = () => snap([GAP], { ...READY({ topicKey: "inv_absorbed" }), cases }, DEMAND); // the comparison was paid for under the absorbed id
    reset(world()); const built = await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW });
    expect([built.coverage!.investigation.aliasKeys, built.coverage!.decision.verdict, built.coverage!.decision.missing]).toEqual([["inv_absorbed"], "create_new", []]); // read, not re-bought
    const page = built.proposals.find((p) => p.kind === "new_page")!; const under = { ...page, id: page.id.replace(key, "inv_absorbed") };
    reset(world()); env.store = new Map([[under.id, under]]); const again = briefSeam(); const res = await produceProposalsForTenant("fixture-tenant", { complete: again.complete, now: NOW });
    expect([again.kinds, res.reused, res.proposals.filter((p) => p.kind === "new_page").map((p) => p.id)]).toEqual([[], 1, [under.id]]); }); // zero brief calls, and ONE page for one subject
  it("builds exactly ONE new page from the earned verdict, and it reaches Ready as current work", async () => {
    reset(snap([GAP], READY({ topicKey: keyOf(READY()) }), DEMAND)); const seam = briefSeam();
    const res = await produceProposalsForTenant("fixture-tenant", { complete: seam.complete, now: NOW });
    expect(seam.kinds).toEqual(["new_page_brief"]); // the ONE call an earned verdict makes, and no other draft this pass
    const pages = res.proposals.filter((p) => p.kind === "new_page"); expect(pages).toHaveLength(1);
    const page = pages[0]!; expect(page.recommendedChange).toEqual({ kind: "new_page", proposedTitle: BRIEF.proposedTitle, metaDescription: BRIEF.metaDescription,
      openingAnswer: BRIEF.openingAnswer, outline: BRIEF.sections.map((s) => s.heading), faqQuestions: [], schemaTypes: [] }); // no markup is guessed for a page that does not exist yet
    expect([page.status, page.pagePath, page.publish, validateProposal(page).verdict]).toEqual(["proposed", null, "manual", "ready"]);
    expect(page.bundle!.receipt.items.some((i) => i.key === "verdict")).toBe(true); expect(page.bundle!.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer", "section", "source_pack", "internal_links"]);
    const queue = await loadProposalQueue("fixture-tenant", { currentBasis: page.basis! }); expect(queue.ready.map((p) => p.id)).toContain(page.id);
    const again = await produceProposalsForTenant("fixture-tenant", { complete: briefSeam().complete, now: NOW }); expect(again.reused).toBe(1); }); // a refresh re-pays nothing
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
    for (const stray of strays) {
      reset(snap([GAP], READY({ topicKey: keyOf(READY()) }), DEMAND));
      const res = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async ({ kind }) => ({ value: (kind === "new_page_brief" ? { ...BRIEF, ...stray } : VALID_ATOMIC_EDIT) as never }) });
      expect(res.proposals.every((p) => p.kind !== "new_page")).toBe(true); expect(env.saved.every((p) => p.kind !== "new_page")).toBe(true); }
    reset(snap([GAP], READY({ topicKey: keyOf(READY()) }), DEMAND)); // a question I DID supply survives even though it names a site, because I am the one who showed it
    expect((await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async ({ kind }) => ({ value: (kind === "new_page_brief" ? { ...BRIEF, faqQuestions: ["haft seen table on wikipedia.org"] } : VALID_ATOMIC_EDIT) as never }) })).proposals.some((p) => p.kind === "new_page")).toBe(true);
    reset(snap([GAP], READY({ topicKey: keyOf(READY()), comparison: comparisonOf([["k1", [1, 2, 3]], ["k2", [2, 3]], ["k3", [3, 4]], ["k4", [2, 3]]]) }), DEMAND));
    const partly = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: briefSeam().complete }); // the SECOND branch that earns a page: I reach some of this, too little to build on
    const obj = partly.proposals.find((p) => p.kind === "new_page")?.bundle?.objective ?? "";
    expect(obj.includes("none of your own pages")).toBe(false); // never the claim and its contradiction on one screen
    let fig = ""; reset(snap([GAP], READY({ topicKey: keyOf(READY()) }), DEMAND)); // and the figure check is not "no digits allowed": one I DID supply survives
    const ok = await produceProposalsForTenant("fixture-tenant", { now: NOW, complete: async ({ kind, user }) => { if (kind === "new_page_brief") fig = (user.match(/\d[\d,]*/) ?? [""])[0];
      return { value: (kind === "new_page_brief" ? { ...BRIEF, openingAnswer: `${BRIEF.openingAnswer} I count ${fig} of them.` } : VALID_ATOMIC_EDIT) as never }; } });
    expect([fig.length > 0, ok.proposals.some((p) => p.kind === "new_page")]).toEqual([true, true]);
    // A row that looks current but carries none of that evidence is an older idea, and it stays off the queue.
    const ghost: ChangeProposal = { ...baseProposal({ id: "ghost", kind: "new_page", pagePath: null, basis: "basis_today", bundle: undefined,
      recommendedChange: { kind: "new_page", proposedTitle: "T", metaDescription: "M", openingAnswer: "A", outline: ["One"], faqQuestions: [], schemaTypes: [] } }) };
    env.store = new Map([["ghost", ghost]]); const q = await loadProposalQueue("fixture-tenant", { currentBasis: "basis_today" });
    expect([q.ranked, q.ready, q.toDo].map((l) => l.length)).toEqual([0, 0, 0]); expect(q.demotedStaleBasis).toBe(1); });
}); // ── do I already have the right page for what I investigated? ────────────────
const FOOD = "fixture-outdoors.example/nowruz-food"; const cands = (s: EvidenceSnapshot) => ownedCandidatesFor(s, buildTopicInvestigations(s)[0]!);
const UBIQUITOUS = ["food", "music", "gifts", "fire", "dance", "poetry", "cards", "tables", "flowers", "travel"].map((w) => ({ query: `nowruz ${w}`, searchVolume: null, competition: null, competitionLevel: null, difficulty: null, intent: null })); const LOOKALIKE = ownedPage("fixture-outdoors.example/nowruz-gifts", "Nowruz Traditions and Gifts", { impressions: 400, clicks: 8 }, [{ query: "nowruz gifts", impressions: 400, clicks: 8, position: 9 }]); // every phrase this account owns carries one word, so that word proves nothing here
describe("do I already have the right page for what I investigated", () => {
  it("treats an exact Search Console query as proof of coverage and matching wording as only a hint", () => {
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
});