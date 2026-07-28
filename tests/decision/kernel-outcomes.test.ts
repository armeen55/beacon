/** DECISION kernel outcomes: what the evidence justifies BEFORE anything is drafted, then generate ->
 *  validate -> rank -> persist -> REUSE, and fail-closed rejections. Each test name states its promise. */
import { describe, it, expect, vi } from "vitest";
// Budget is not this file's subject: always-allowed, no-op hermetic seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
const env = vi.hoisted(() => ({ snap: null as unknown, saved: [] as { id: string }[], store: new Map<string, ChangeProposal>(), failWrites: false, bundleTarget: null as string | null }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
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
import { topInvestigationQueries } from "@/domains/runtime/ops/investigation-queries";
import { proposalFingerprint } from "@/domains/decision/proposal-store"; import { ownedCandidatesFor } from "@/domains/decision/owned-coverage"; import { buildTopicInvestigations } from "@/domains/evidence/topic-investigation";
import { emptyResearchEvidence, type FunnelResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
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
} function snap(ownedPages: OwnedPageEvidence[], research: FunnelResearchEvidence = emptyResearchEvidence()): EvidenceSnapshot {
  return { scope: { tenantId: "fixture-tenant", site: "fixture-outdoors.example", builtAt: "2026-07-26T00:00:00.000Z" }, sources: [], ownedPages, competitors: [], keywordDemand: [], questionDemand: [],
    intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, research, evidenceHash: "fixture" };
} /** A live results page observed for these EXACT searches, carrying this page's OWN line on it and two rivals that share wording
 *  that line does not: exactly what a diagnosis has to read before it may name the title. */
const looked = (pairs: [string, string][]): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), serpEvidence: pairs.map(([query, url]) => ({ query, observedAt: null, aiOverview: [], aiMode: [], paa: [], related: [],
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
/** A third proven gap, so the priority list has more page work than it has slots. */
const THIRD = ownedPage("fixture-outdoors.example/nowruz-music", "Nowruz Music", { impressions: 2600, clicks: 52 }, [{ query: "nowruz music", impressions: 2500, clicks: 50, position: 4.1 }]);
describe("the pass says what it is investigating without turning any of it into work", () => {
  it("carries the research packets, picks the SAME strongest topic from the same evidence, and proposes nothing off them", async () => {
    const world = () => snap([WINNER], looked([["nowruz traditions", GAP_URL]])); // a page with no gap, plus one results page I have read
    let called = 0; const complete: CompleteFn = async () => { called += 1; return { value: VALID_ATOMIC_EDIT }; };
    reset(world()); const first = await produceProposalsForTenant("fixture-tenant", { complete, now: NOW }); reset(world()); const again = await produceProposalsForTenant("fixture-tenant", { complete, now: NOW });
    expect(first.investigations.length).toBeGreaterThan(0); // the research packet reaches the production pass
    expect(first.strongestInvestigation!.key).toBe(again.strongestInvestigation!.key); // same evidence, same pick, every pass
    expect(first.strongestMissingEvidence).toEqual(first.strongestInvestigation!.missingEvidence); // and it says what it still needs
    expect([first.outcome, first.proposals.length, called, env.saved.length]).toEqual(["no_actionable_candidate", 0, 0, 0]); }); // no candidate, no draft, no row
  it("freezes a priority list that keeps ONE slot for the strongest investigation's own missing search, still capped at three", async () => {
    reset(snap([GAP, WEAK, THIRD], looked([["haft seen table", GAP_URL]]))); // three gaps I have never looked at, and a packet still missing its own results page
    expect(await topInvestigationQueries("fixture-tenant")).toEqual(["nowruz traditions", "nowruz food traditions", "haft seen table"]); }); // the weakest gap waits; the research advances
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
  it("yields the same candidates in the same order from the same evidence", () => { expect(cands(BOTH())).toEqual(cands(snap([GAP, WEAK], looked([["nowruz food traditions", FOOD], ["nowruz traditions", GAP_URL]])))); });
});