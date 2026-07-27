/** DECISION kernel outcomes: what the evidence justifies BEFORE anything is drafted, then
 *  generate -> validate -> rank -> persist round-trip, fail-closed validator rejections, and
 *  manual-only proposals. Each test name states its promise. */
import { describe, it, expect, vi } from "vitest";

// Budget is not this file's subject: always-allowed, no-op hermetic seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
const env = vi.hoisted(() => ({ snap: null as unknown, saved: [] as unknown[] }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
vi.mock("@/domains/decision/proposal-store", () => ({ loadChangeProposals: async () => new Map(), saveChangeProposal: async (p: unknown) => { env.saved.push(p); return true; } }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => null, basisTag: () => "basis_test" }));
import { proposeExistingPageChange, proposeNewPageChange } from "@/domains/decision/propose";
import { validateProposal } from "@/domains/decision/validate-proposal";
import { rankProposals, proposalValueScore } from "@/domains/decision/rank-proposals";
import { compileCandidates, snapshotToEvidenceInputs } from "@/domains/decision/opportunities";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { serializeChangeProposal, deserializeChangeProposal, type EvidenceInput, type ChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
/** A completion fn that replays a fixed queue (last response repeats). The seam returns a PARSED structured VALUE (never text); an error carries its retryability. */
function fakeComplete(responses: Array<{ value: unknown } | { error: string; retryable?: boolean }>): CompleteFn {
  let i = 0; return async () => { const r = responses[Math.min(i++, responses.length - 1)]!; return "error" in r ? { error: r.error, retryable: r.retryable ?? false } : { value: r.value }; };
}
const PROOF = { metrics: ["clicks", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" };
const VALID_ATOMIC_EDIT = {
  field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen", confidence: "high",
  rationale: "The current title is one word and misses the specific customs searchers ask about.", risks: ["keep the title concise"],
  evidenceRefs: [{ source: "gsc", detail: "many impressions for nowruz traditions with a low click rate" }], operatorSteps: ["Replace the page title field with the new value"], proofPlan: PROOF };
const VALID_CREATE_PAGE = {
  proposedTitle: "Haft-Seen Table: The Symbolic Items of Nowruz",
  metaDescription: "Learn what goes on the Haft-Seen table for the Persian New Year and what each symbolic item means for the year ahead.",
  openingAnswer: "The Haft-Seen table is the centerpiece of Nowruz, the Persian New Year, arranged with symbolic items whose Persian names begin with the letter seen. Families gather the setting to wish for renewal, health, and prosperity, and sit before it together as the new year arrives.",
  outline: ["What the Haft-Seen table is", "The symbolic items and their meanings", "How families arrange the setting", "Regional variations across Iran"],
  faqQuestions: ["What does Haft-Seen mean?", "When is the Haft-Seen table set?"], schemaTypes: ["Article", "FAQPage"], confidence: "high",
  evidenceRefs: [{ source: "dataforseo", detail: "AI is asked what goes on the haft-seen table for nowruz" }], risks: ["describe the items qualitatively, not by count"],
  operatorSteps: ["Create a new page with this title and outline"], proofPlan: { metrics: ["AI citations"], windowsDays: [7, 14, 28], controls: "comparable topic pages" } };
const EXISTING_INPUT: EvidenceInput = {
  tenantId: "referencepedia", page: { path: "/nowruz", url: "https://fixture-content.example/nowruz", label: "Nowruz" }, sizing: { impactScore: 80, upsidePerMonth: 45 },
  opportunity: { query: "nowruz traditions", kind: "existing_edit", field: "title", opportunityType: "Capture clicks", currentValue: "Nowruz", intent: "what" },
  evidence: { hints: ["Search Console shows strong demand for nowruz traditions, the persian new year customs"], outline: ["History of Nowruz", "Haft-Seen table", "Persian customs and foods"] } };
const NEW_PAGE_INPUT: EvidenceInput = {
  tenantId: "referencepedia", page: { path: null, url: null, label: "Haft-Seen table" }, opportunity: { query: "haft-seen table", kind: "new_page", opportunityType: "Win AI citations" }, sizing: { impactScore: 60, upsidePerMonth: null },
  evidence: { hints: ["AI assistants are asked what goes on the haft-seen table for nowruz, the persian new year celebrated across iran"], fanoutQueries: ["what are the seven items", "what does each item mean"], competitorPages: ["https://example.com/haft-seen"] } };
/** A minimal safe existing-edit proposal, for constructing rejection variants. */
function baseProposal(over: Partial<ChangeProposal> = {}): ChangeProposal {
  return {
    id: "referencepedia::/x::existing_edit::title", tenantId: "referencepedia", kind: "existing_edit", pagePath: "/x", pageUrl: "https://fixture-content.example/x",
    pageLabel: "X", primaryQuery: "nowruz traditions", opportunityType: "Capture clicks", changeFamily: "title", status: "proposed", evidence: { query: "nowruz traditions", hints: ["gsc demand"], evidenceRefCount: 1 },
    recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen" },
    whyItMatters: "The title misses the customs searchers ask about.", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "high", limitations: [],
    impactScore: 50, upsidePerMonth: 20, publish: "manual", createdAt: "2026-07-22T00:00:00.000Z", ...over };
}
/** The exact-edit rewrite under test, with one field swapped. */
const edited = (field: "title" | "meta", before: string | null, after: string): ChangeProposal => baseProposal({ recommendedChange: { kind: "existing_edit", field, before, after } });
describe("existing-page cold proposal", () => {
  it("generates, validates, persists (serialize), and re-loads (deserialize)", async () => {
    const out = await proposeExistingPageChange(EXISTING_INPUT, { complete: fakeComplete([{ value: VALID_ATOMIC_EDIT }]), now: new Date("2026-07-22T00:00:00Z") });
    expect(out.status).toBe("proposed"); if (out.status !== "proposed") return;
    const p = out.proposal; // exact-edit outcome fields Changes/Today render
    expect(p.recommendedChange.kind).toBe("existing_edit");
    if (p.recommendedChange.kind === "existing_edit") { expect(p.recommendedChange.before).toBe("Nowruz"); expect(p.recommendedChange.after).toContain("Nowruz Traditions"); }
    expect(p.whyItMatters).toMatch(/customs/i); expect(p.evidence.evidenceRefCount).toBe(1); expect(p.primaryQuery).toBe("nowruz traditions"); expect(p.opportunityType).toBe("Capture clicks");
    expect(out.validation.verdict).toBe("ready"); expect(p.status).toBe("proposed"); // validated safe → proposed, not rejected
    const loaded = deserializeChangeProposal(serializeChangeProposal(p)); expect(loaded).not.toBeNull(); expect(loaded).toEqual(p); // persisted + loadable: round-trips + re-validates
    // a tampered persisted row is rejected on load (never served as trusted)
    const tampered = JSON.stringify({ v: 1, proposal: { ...p, recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "" } } });
    expect(deserializeChangeProposal(tampered)).toBeNull(); });
  it("returns no_draft (fail-closed) when no key or completion transport exists", async () => { expect((await proposeExistingPageChange(EXISTING_INPUT)).status).toBe("no_draft"); });
});
describe("new-page cold brief", () => {
  it("generates a full brief and validates it", async () => {
    const out = await proposeNewPageChange(NEW_PAGE_INPUT, { complete: fakeComplete([{ value: VALID_CREATE_PAGE }]), now: new Date("2026-07-22T00:00:00Z") });
    expect(out.status).toBe("proposed"); if (out.status !== "proposed") return;
    const p = out.proposal;
    expect(p.kind).toBe("new_page"); expect(p.pagePath).toBeNull(); expect(p.recommendedChange.kind).toBe("new_page"); // no existing page
    if (p.recommendedChange.kind === "new_page") {
      expect(p.recommendedChange.proposedTitle).toContain("Haft-Seen"); expect(p.recommendedChange.faqQuestions.length).toBeGreaterThan(0);
      expect(p.recommendedChange.outline.length).toBeGreaterThanOrEqual(3);
    }
    expect(p.limitations.some((l) => /baseline/i.test(l))).toBe(true); // honest limitation: a new page has no before/after baseline
    // a generated brief is either ready (proposed) or held for review, never rejected/high-risk when its content is clean.
    expect(out.validation.verdict).not.toBe("rejected");
    expect(p.status === "proposed" || p.status === "needs_review").toBe(true); expect(p.riskLevel).toBe("medium"); });
});
describe("safety gates reject unsafe drafts", () => {
  it("rejects a placeholder stub", () => { expect(validateProposal(edited("title", "Nowruz", "Nowruz [insert customs here]")).verdict).toBe("rejected"); });
  it("rejects an em/en dash in operator copy", () => {
    const v = validateProposal(edited("title", "Nowruz", "Nowruz Traditions — Persian New Year"));
    expect(v.verdict).toBe("rejected"); expect(v.safetyFlags.some((f) => /dash/i.test(f))).toBe(true); });
  it("rejects a raw uuid leaking into copy", () => { expect(validateProposal(edited("title", "Nowruz", "Nowruz 550e8400-e29b-41d4-a716-446655440000 Guide")).verdict).toBe("rejected"); });
  it("rejects a destructive edit that guts the current value", () => {
    const v = validateProposal(edited("meta", "Nowruz is the Persian New Year celebrated with the Haft-Seen table, customs, and foods across Iran and the diaspora.", "Nowruz."));
    expect(v.verdict).toBe("rejected"); expect(v.safetyFlags.some((f) => /destructive/i.test(f))).toBe(true); });
  it("maps a rejected verdict to a rejected proposal status", () => { expect(validateProposal(edited("title", "Nowruz", "Nowruz — bad")).status).toBe("rejected"); });
  it("rejects an edit that introduces an ungrounded number or claim", () => {
    const p = edited("meta", "Nowruz is the Persian New Year celebrated across Iran.", "Nowruz is the Persian New Year, first celebrated exactly 3247 years ago in 1223 BCE.");
    const v = validateProposal(p, { evidenceText: "nowruz is the persian new year", pageBodyText: "Nowruz is the Persian New Year celebrated across Iran." }); // grounding carries no such figure
    expect(v.verdict).toBe("rejected"); expect(v.factViolations.length).toBeGreaterThan(0); });
});
describe("rankProposals orders by recoverable clicks", () => {
  it("puts the most recoverable clicks first and sinks the rejected one", () => {
    const low = baseProposal({ id: "low", impactScore: 30 }), high = baseProposal({ id: "high", impactScore: 300 }), rejected = baseProposal({ id: "rej", status: "rejected", impactScore: 9999 });
    expect(rankProposals([low, rejected, high]).map((p) => p.id)).toEqual(["high", "low", "rej"]);
    expect(proposalValueScore(high)).toBeGreaterThan(proposalValueScore(rejected)); // a rejected proposal never outranks a proposed one on clicks alone
  });
});
describe("manual publishing authority", () => {
  it("every generated proposal is a manual proposal, never applied", async () => {
    const out = await proposeExistingPageChange(EXISTING_INPUT, { complete: fakeComplete([{ value: VALID_ATOMIC_EDIT }]) });
    expect(out.status).toBe("proposed"); if (out.status !== "proposed") return;
    expect(out.proposal.publish).toBe("manual"); expect(out.proposal.status).not.toBe("applied"); });
});
// ── the diagnosis: only a proven, recoverable gap earns work ──────────────────
function ownedPage(url: string, title: string, totals: { impressions: number; clicks: number }, topQueries: OwnedQuerySignal[]): OwnedPageEvidence {
  return { url, content: { title, metaDescription: null, h1: title, h2: [], outline: [], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 800, internalLinks: [], fetchedAt: null },
    search: { clicks90d: totals.clicks, impressions90d: totals.impressions, ctr90d: totals.clicks / totals.impressions, position90d: 4, topQueries }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } };
}
function snap(ownedPages: OwnedPageEvidence[]): EvidenceSnapshot {
  return { scope: { tenantId: "fixture-tenant", site: "fixture-outdoors.example", builtAt: "2026-07-26T00:00:00.000Z" }, sources: [], ownedPages, competitors: [], keywordDemand: [], questionDemand: [],
    intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], newPageOpportunities: [], aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, research: emptyResearchEvidence(), evidenceHash: "fixture" };
}
/** A big winner: its main searches BEAT the clicks their positions earn, and even counting its one soft search it is ahead. */
const WINNER = ownedPage("fixture-outdoors.example/trail-shoes", "Trail Shoes", { impressions: 75646, clicks: 3246 }, [
  { query: "trail running shoes", impressions: 25000, clicks: 2365, position: 3.96 }, { query: "womens trail shoes", impressions: 12000, clicks: 1012, position: 3.74 },
  { query: "trail shoes for women", impressions: 2110, clicks: 209, position: 2.66 }, { query: "trail shoe reviews", impressions: 1331, clicks: 40, position: 3.7 }]);
/** A far smaller page with a REAL gap: 3.0 percent against the 8.0 percent that position usually earns. */
const GAP = ownedPage("fixture-outdoors.example/boot-care", "Boot Care", { impressions: 6400, clicks: 190 }, [{ query: "how to clean hiking boots", impressions: 6000, clicks: 180, position: 4.1 }]);

describe("what the evidence justifies before anything is drafted", () => {
  it("leaves a page that already beats the clicks its positions earn alone, however big it is", () => {
    const c = compileCandidates(snap([WINNER]))[0]!;
    expect([c.action, c.query, c.recoverableClicks]).toEqual(["watch", "trail shoe reviews", 66]); // one soft search on a winning page is watched, not worked
    expect(c.reason).toContain("1,331"); expect(c.reason).not.toContain("75,646"); expect(c.reason).not.toContain("3,246"); // a page total is never quoted as a query number
    expect(snapshotToEvidenceInputs(snap([WINNER]))).toEqual([]); // no title, no description, no work
  });
  it("earns exactly one action from a gap above every floor, carrying that query's own numbers", () => {
    expect(compileCandidates(snap([GAP])).map((c) => [c.action, c.gap, c.query, c.recoverableClicks])).toEqual([["act_existing_page", "ctr_deficit", "how to clean hiking boots", 300]]);
    const inputs = snapshotToEvidenceInputs(snap([GAP]));
    expect(inputs.map((i) => i.opportunity.field)).toEqual(["title"]); // ONE field, the one the gap justifies
    expect(inputs[0]!.sizing!.impactScore).toBe(300); // recoverable clicks is the only value scalar
    const hint = (inputs[0]!.evidence.hints ?? []).join(" ");
    expect(hint).toContain("6,000"); expect(hint).toContain("8.0 percent"); expect(hint).toContain("3.0 percent"); expect(hint).toContain("300 clicks");
    expect(hint).not.toContain("6,400"); // the page total never stands in for the query
  });
  it("ranks a small page with a real gap above a huge page with none", () => {
    expect(snapshotToEvidenceInputs(snap([WINNER, GAP])).map((i) => i.page.path)).toEqual(["/boot-care"]);
    expect(rankProposals([baseProposal({ id: "huge-no-gap", impactScore: 0 }), baseProposal({ id: "small-real-gap", impactScore: 300 })]).map((p) => p.id)).toEqual(["small-real-gap", "huge-no-gap"]);
  });
  it("treats nothing worth doing as a SUCCESS with no proposals, and never calls the drafter", async () => {
    env.snap = snap([WINNER]); env.saved = [];
    let called = 0; const complete: CompleteFn = async () => { called += 1; return { error: "the drafter must never run when nothing earned an action", retryable: false }; };
    const res = await produceProposalsForTenant("fixture-tenant", { complete, now: new Date("2026-07-26T00:00:00.000Z") });
    expect([res.noActionableCandidate, res.actionable, res.proposals.length, res.candidates.length]).toEqual([true, 0, 0, 1]);
    expect(called).toBe(0); expect(env.saved).toEqual([]); // no paid call, no persisted row
  });
});
