/** THE NIGHT THE SEARCH READ TIMED OUT. One statement timeout on the 90-day page-signal aggregate was served
 *  to every surface as an account with no search data at all: every page then judged clean, every $0 producer
 *  emitted nothing, and the sweep behind them read that silence as "the generator no longer stands behind
 *  these cards" and withdrew the operator's open queue mid-edit. Withdrawal is permanent in practice, so the
 *  cards were gone. Each test below pins one link of that chain. Fixture level: no live replay. */
import { describe, it, expect, vi, beforeEach } from "vitest";
type RpcAnswer = { data?: unknown; error?: { message: string; code?: string } | null };
const env = vi.hoisted(() => ({
  /** Queued answers per RPC name; the last one repeats. */
  rpc: {} as Record<string, RpcAnswer[]>,
  calls: [] as Array<{ name: string; args: unknown }>,
  snapshot: null as unknown,
  store: new Map<string, unknown>(),
  withdrawn: [] as string[],
}));
/** A Supabase admin whose every builder method chains and whose await resolves the queued answer. */
vi.mock("@/lib/persistence/supabase", () => {
  const chain = (answer: RpcAnswer): unknown =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (prop === "then") return (res: (v: RpcAnswer) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }).then(res, rej);
        return () => chain(answer);
      }, });
  const next = (name: string): RpcAnswer => {
    const queue = env.rpc[name];
    if (!queue || queue.length === 0) return { data: [] };
    return queue.length === 1 ? queue[0]! : queue.shift()!;
  };
  return {
    getSupabaseAdmin: () => ({
      rpc: (name: string, args: unknown) => { env.calls.push({ name, args }); return chain(next(name)); },
      from: () => chain({ data: [] }),
    }),
  }; });
vi.mock("@/domains/account", () => ({
  loadBusinessProfile: async () => null,
  getTenant: async () => ({ id: "tenant-fx", domain: "fixture.example", growth_goal: null }),
  basisTag: () => "basis_fx",
}));
/** The real loader unless a test pins a snapshot: part of this file exercises it, part feeds the producer. */
vi.mock("@/domains/evidence/snapshot-loader", async (orig) => {
  const actual = (await orig()) as typeof import("@/domains/evidence/snapshot-loader");
  return { ...actual, loadEvidenceSnapshot: async (t: string, o: never) =>
    env.snapshot ?? actual.loadEvidenceSnapshot(t, o) }; });
vi.mock("@/domains/decision/proposal-store", async (orig) => {
  const actual = (await orig()) as typeof import("@/domains/decision/proposal-store");
  return { ...actual,
    loadChangeProposals: async () => new Map(env.store as Map<string, ChangeProposal>),
    withdrawnProposalIds: async () => new Set<string>(),
    withdrawChangeProposal: async (p: ChangeProposal) => { env.withdrawn.push(p.id); return true; },
    saveChangeProposal: async () => "unchanged" as const }; });
import { loadGscPageSignalsForTenant, readGscPageSignalsForTenant } from "@/domains/evidence/readers/gsc-page-signals";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { buildEvidenceSnapshot, type EvidenceSnapshotInput } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import type { ChangeProposal } from "@/domains/decision/contracts";
const TENANT = "tenant-fx";
const TIMEOUT = { message: "canceling statement due to statement timeout", code: "57014" };
/** One full PostgREST page, so the reader asks for a second one and meets the error on it. */
const fullPage = () => Array.from({ length: 1_000 }, (_v, i) => ({
  page: `https://fixture.example/p${String(i).padStart(4, "0")}`,
  clicks: 5, impressions: 100, pos_weighted: 800, top_queries: [],
}));
/** A snapshot whose GSC leg says exactly what the test needs it to say. */
function snapshotWith(status: "failed" | "fresh" | "empty"): unknown {
  const gscPayload = status === "fresh"
    ? [{ url: "https://fixture.example/a", clicks90d: 40, impressions90d: 900, ctr90d: 0.04, position90d: 12, topQueries: [] }]
    : [];
  const input: EvidenceSnapshotInput = {
    scope: { tenantId: TENANT, site: "fixture.example", builtAt: "2026-08-12T00:00:00.000Z" },
    gsc: { status, lastSyncedAt: null, payload: gscPayload },
    ga4: { status: "empty", lastSyncedAt: null, payload: [] },
    wix: { status: "empty", lastSyncedAt: null, payload: [] },
    clarity: { status: "empty", lastSyncedAt: null, payload: [] },
    dataforseo: { status: "empty", lastSyncedAt: null, payload: [] },
    research: { status: "empty", lastSyncedAt: null, payload: emptyResearchEvidence() },
    aiAnswersUnread: false,
  };
  return buildEvidenceSnapshot(input);
}
/** One untouched card the operator can still act on, in a family the sweep rewrites. */
const openCard = (suffix: string): ChangeProposal => ({
  id: `${TENANT}::/shiraz::existing_edit::${suffix}`, tenantId: TENANT, kind: "existing_edit",
  pagePath: "/shiraz", pageUrl: "https://fixture.example/shiraz", pageLabel: "Shiraz",
  primaryQuery: "things to do in shiraz", opportunityType: "Answer the question", changeFamily: suffix,
  status: "needs_review", evidence: { query: "things to do in shiraz", hints: [], evidenceRefCount: 1 },
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A short answer block." },
  whyItMatters: "The page never answers the question it ranks for.", estimatedEffortMinutes: 10,
  riskLevel: "low", confidence: "medium", limitations: [], impactScore: 20, upsidePerMonth: 5,
  publish: "manual", createdAt: "2026-08-10T00:00:00.000Z", });
beforeEach(() => {
  env.rpc = {}; env.calls = []; env.snapshot = null; env.store = new Map(); env.withdrawn = []; });
describe("a search read that did not answer", () => {
  it("throws instead of handing back an account with no search data", async () => {
    env.rpc = { gsc_page_signals_v1: [{ error: TIMEOUT }] };
    await expect(loadGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:00:00Z"))).rejects.toThrow(/statement timeout/); });
  it("marks a read cut short after some rows INCOMPLETE, keeping what landed", async () => {
    env.rpc = { gsc_page_signals_v1: [{ data: fullPage() }, { error: TIMEOUT }], gsc_page_totals_v1: [{ data: [] }] };
    const read = await readGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:00:00Z"));
    expect([read.incomplete, read.signals.size]).toEqual([true, 1_000]); });
  it("asks the database ONE question per account per reporting day, however the caller spells now", async () => {
    env.rpc = { gsc_page_signals_v1: [{ data: [] }], gsc_page_totals_v1: [{ data: [] }] };
    await loadGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:00:00Z"));
    await loadGscPageSignalsForTenant(TENANT, new Date("2026-08-12T09:14:37.412Z"));
    const asked = env.calls.filter((c) => c.name === "gsc_page_signals_v1").map((c) => JSON.stringify(c.args));
    expect(new Set(asked).size).toBe(1); // one memo slot, not one per caller's clock
  });

  it("travels to the snapshot as a FAILED source, never as an empty one", async () => {
    env.rpc = { gsc_page_signals_v1: [{ data: fullPage() }, { error: TIMEOUT }], gsc_page_totals_v1: [{ data: [] }] };
    const snapshot = await loadEvidenceSnapshot(TENANT, { now: new Date("2026-08-12T09:00:00Z") });
    expect(snapshot.sources.find((s) => s.source === "gsc")?.status).toBe("failed"); }); });

describe("the sweep only retires what a producer that FINISHED rewrote", () => {
  it("changes nothing at all when the search source failed, so open cards survive", async () => {
    env.snapshot = snapshotWith("failed");
    env.store = new Map([["a", openCard("answer_block")], ["t", openCard("title")]].map(([, p]) => [(p as ChangeProposal).id, p]));
    const out = await produceProposalsForTenant(TENANT);
    expect(out.outcome).toBe("evidence_unreadable");
    expect(env.withdrawn).toEqual([]); });

  it("withdraws nothing when the search source is merely EMPTY: unread is not rewritten", async () => {
    env.snapshot = snapshotWith("empty");
    env.store = new Map([[openCard("title").id, openCard("title")]]);
    await produceProposalsForTenant(TENANT);
    expect(env.withdrawn).toEqual([]); });

  it("withdraws a stale card in its own family once the producer that owns it finished", async () => {
    env.snapshot = snapshotWith("fresh");
    const stale = openCard("title"), theirs = openCard("ai_answer_gap");
    env.store = new Map([[stale.id, stale], [theirs.id, theirs]]);
    await produceProposalsForTenant(TENANT);
    // The extras producer never ran on this path, so its family is left exactly where it was.
    expect(env.withdrawn).toEqual([stale.id]); }); });
