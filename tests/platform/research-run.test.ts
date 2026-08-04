/** Durable Research Run: the one-open-run-per-account invariant (resume any unfinished run across dates before a new daily cycle), the truth boundary (any failure PAUSES, never completes), partial connector success surviving a pause, deduped refreshed providers across retries, the lease guards (including the ONE the paid comparison spends under), the frozen investigation, the idempotency identity, and the fail-closed render path. The repo models the RPC guards. */
import { describe, it, expect, beforeEach, vi } from "vitest"; import { readdirSync, readFileSync } from "node:fs";
/** The DEFAULT reconcile step, exercised for REAL below. Every other test seams reconcileCases; funnel/state keeps its real exports for the conflict closure. */
const REG = vi.hoisted(() => ({ onFile: [] as unknown[], next: [] as unknown[], saves: 0, readings: 0 }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => ({ ownedPages: [], research: { cases: [] } }) }));
vi.mock("@/domains/evidence/topic-investigation", () => ({ reconcileResearchCases: () => REG.next, buildTopicInvestigations: () => { REG.readings += 1; return []; } }));
vi.mock("@/domains/evidence/funnel/state", async (actual) => ({ ...(await actual<Record<string, unknown>>()), loadFunnelState: async () => ({ state: { cases: REG.onFile }, rowVersion: 3 }), saveFunnelState: async () => { REG.saves += 1; return 4; } }));
/** The ONE table this file models directly: tenants.research_paused. `missing` is the account the PATCH matches no row for, which PostgREST answers 204 with NO error. Every other table throws exactly as an unconfigured client does, so no other pin moves. */
const DB = vi.hoisted(() => ({ paused: new Set<string>(), missing: new Set<string>() }));
vi.mock("@/lib/persistence/supabase", async (actual) => ({ ...(await actual<Record<string, unknown>>()),
  getSupabaseAdmin: () => ({ from: (table: string) => {
    if (table !== "tenants") throw new Error("this test models no other table");
    return {
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: { research_paused: DB.paused.has(id) }, error: null }) }) }),
      update: (patch: { research_paused: boolean }) => ({ eq: (_c: string, id: string) => ({ select: async () => {
        if (DB.missing.has(id)) return { data: [], error: null }; if (patch.research_paused) DB.paused.add(id); else DB.paused.delete(id);
        return { data: [{ id }], error: null }; } }) }),
    }; } }) }));
/** The crawl seam: ONE in-memory frontier, so what is pinned is the ENTRY POINT rather than the fetcher. `state` is what the durable blob holds, and `racer` lets a concurrent instance initialize between the load and the start. */
const CRAWL = vi.hoisted(() => ({ state: null as null | "in_progress" | "complete" | "unreachable", starts: 0, forced: false, batches: 0, racer: null as null | (() => void) }));
vi.mock("@/domains/evidence/scanning/crawl-frontier", async (actual) => ({ ...(await actual<Record<string, unknown>>()),
  startColdStartCrawl: async (a: { force?: boolean }) => { CRAWL.starts += 1; CRAWL.forced = CRAWL.forced || a.force === true; CRAWL.racer?.();
    CRAWL.state = CRAWL.state ?? "in_progress"; return { status: CRAWL.state, discovered: 3 }; },
  continueColdStartCrawlIfStarted: async () => (CRAWL.state == null || CRAWL.state === "unreachable"
    ? { ran: false, status: CRAWL.state ?? "no_crawl", crawled: 0, failed: 0, totalCrawled: 0, remaining: 0, complete: false, detail: CRAWL.state ?? "no_frontier_state" }
    : (CRAWL.batches += 1, { ran: true, status: CRAWL.state, crawled: 3, failed: 0, totalCrawled: 3 * CRAWL.batches, remaining: 0, complete: false })) }));
/** The route's own dispatch, stubbed so its gate and receipt are pinned without a second drive of the real cycle (every dispatch test below drives it). */
const ROUTE = vi.hoisted(() => ({ receipt: {} as Record<string, unknown>, fail: null as Error | null }));
vi.mock("@/domains/runtime", async (actual) => ({ ...(await actual<Record<string, unknown>>()), runDueAccounts: async () => { if (ROUTE.fail) throw ROUTE.fail; return ROUTE.receipt; } }));
import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle, continueResearch, ensureResearchRunOnVisit, type ResearchCycleSteps } from "@/domains/runtime/ops/on-visit-refresh";
import { dueWork, isResearchPaused, setResearchPaused, type DueWork } from "@/domains/runtime/ops/due-work";
import { runDueAccounts, type SchedulerReceipt } from "@/domains/runtime/ops/scheduler"; import { defaultSteps } from "@/domains/runtime/ops/research-steps";
import { POST } from "@/app/api/cron/scheduler/route"; import { NextRequest } from "next/server";
import { caseResearchReceipt } from "@/domains/evidence/case-receipt"; import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { setAccountRepositoryForTests, type AccountRepository } from "@/domains/account/tenants/store"; import type { AccountStatus } from "@/domains/account";
import type { CachedCallResult, FunnelUnitOutcome } from "@/domains/evidence/dataforseo/funnel-boundary"; import type { AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations";
import { promptObservationUnit } from "@/domains/evidence/funnel/observe"; import { CONFLICT_DETAIL, type FunnelDeps } from "@/domains/evidence/funnel/shared";
import { emptyFunnelState } from "@/domains/evidence/funnel/state";

const ACCOUNT_STATUS = new Map<string, AccountStatus>();  // Pre-activation gate: runtime and the RPC model both refuse research work unless the account is active. Every tenant defaults to 'active'; a test opts one into 'pending_onboarding' to exercise the gate.
const statusOf = (t: string): AccountStatus => ACCOUNT_STATUS.get(t) ?? "active";
const setAccountStatus = (t: string, s: AccountStatus): void => void ACCOUNT_STATUS.set(t, s);
/** Accounts whose operator paused research: the SQL reads it on the scheduler door, isResearchPaused on the visit door, the SAME rows. */
const PAUSED = DB.paused;
function installAccountRepo(): void {
  const byId = async (id: string) => ({ id, slug: id, provisional_name: "", domain: "example.com", status: statusOf(id), signup_date: "", tos_accepted_at: null, daily_budget_usd: 0, growth_goal: null, created_at: "", updated_at: "" });
  setAccountRepositoryForTests({ getAccountById: byId, getAccountBySlug: byId } satisfies AccountRepository); }
let NOW = 1_700_000_000_000;
const iso = (ms = NOW) => new Date(ms).toISOString();
const DAY = 24 * 3600 * 1000, T = "acct-a", U = "acct-b", LEASE = RR.RESEARCH_RUN_LEASE_SECONDS * 1000, FLEET = [T, U];
const ckey = (t: string, ms = NOW) => `${t}:${new Date(ms).toISOString().slice(0, 10)}`; // the daily key the DATABASE computes
const mk = (o: Partial<RR.ResearchRun>): RR.ResearchRun => ({ id: "seed", tenant_id: T, cycle_key: ckey(T, NOW), status: "paused",
  current_phase: "refresh_sources", phase_cursor: null, progress: {}, spend_usd: 0, last_error: null,
  lease_owner: null, lease_expires_at: null, started_at: iso(), updated_at: iso(), completed_at: null, ...o });
/** In-memory repo modeling the RPC guards: claim resumes the single unfinished run (any date) before a new daily cycle, a foreign LIVE lease returns null, a same-day completed run blocks a fresh pass, the daily key is computed at database time; advance/renew need a live lease + 'running', finish an open one. */
function memRepo(): { repo: RR.ResearchRunRepo; rows: RR.ResearchRun[] } {
  const rows: RR.ResearchRun[] = [];
  const find = (id: string, t: string) => rows.find((x) => x.id === id && x.tenant_id === t);
  const live = (r: RR.ResearchRun, o: string) => r.lease_owner === o && r.lease_expires_at != null && Date.parse(r.lease_expires_at) >= NOW;
  /** started_at desc, insertion order breaking a tie: "the latest row" is what day-scoped state and the hop count both ask. */
  const newestFirst = (t: string) => rows.map((r, i) => [r, i] as const).filter(([r]) => r.tenant_id === t)
    .sort((a, b) => b[0].started_at.localeCompare(a[0].started_at) || b[1] - a[1]).map(([r]) => r);
  const openRun = (t: string) => newestFirst(t).find((x) => x.status === "running" || x.status === "paused");
  /** patch_research_run_progress in one atomic step: top-level merge, plus a {day, count} computed FROM THE ROW when an increment key is given. Null = no row. */
  const patchProgress = (t: string, id: string, patch: RR.ResearchRunProgress, key?: string, day?: string): RR.ResearchRunProgress | null => {
    const r = find(id, t); if (!r) return null; const before = r.progress ?? {}, held = key ? (before as Record<string, { day?: string; count?: number } | undefined>)[key] ?? null : null;
    r.progress = { ...before, ...patch, ...(key ? { [key]: { day, count: held != null && held.day === day ? (held.count ?? 0) + 1 : 1 } } : {}) }; return r.progress; };
  const repo: RR.ResearchRunRepo = {
    async claim({ tenantId, owner, leaseSeconds }) {
      if (statusOf(tenantId) !== "active") return null;  // Mirror the RPC's new leading guard: no claim unless the account is active.
      const exp = iso(NOW + leaseSeconds * 1000), open = openRun(tenantId);
      if (open) {
        if (open.lease_owner != null && open.lease_owner !== owner && Date.parse(open.lease_expires_at!) >= NOW) return null; // a foreign LIVE lease
        Object.assign(open, { lease_owner: owner, lease_expires_at: exp, status: open.status === "paused" ? "running" : open.status, updated_at: iso() });
        return { ...open }; } // id / cycle_key / phase / cursor / progress / last_error preserved
      const today = new Date(NOW).toISOString().slice(0, 10); if (rows.some((x) => x.tenant_id === tenantId && x.status === "completed" && (x.completed_at ?? "").slice(0, 10) === today)) return null;
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: ckey(tenantId, NOW), status: "running", lease_owner: owner, lease_expires_at: exp }));  // mk defaults already give refresh_sources / null cursor / {} progress / null error.
      return { ...rows[rows.length - 1]! }; },
    async claimDue({ owner, limit, leaseSeconds }) {  // claim_due_research_work: enumerate ACTIVE, not-paused accounts whose current reporting day still owes work, then claim each THROUGH the claim above, so the lease stays the only mechanism.
      const out: RR.ResearchRun[] = [], today = new Date(NOW).toISOString().slice(0, 10);
      const lastMoved = (t: string) => rows.filter((x) => x.tenant_id === t)  // Fairness order: greatest(max(started_at), max(updated_at)) asc, then id; a resume touches ONLY updated_at.
        .map((x) => (x.updated_at > x.started_at ? x.updated_at : x.started_at)).sort().pop() ?? "";
      const queue = [...FLEET].sort((a, b) => lastMoved(a).localeCompare(lastMoved(b)) || a.localeCompare(b));
      for (const t of queue) {
        if (out.length >= limit) break; if (statusOf(t) !== "active" || PAUSED.has(t)) continue; const done = rows.some((x) => x.tenant_id === t && x.status === "completed" && (x.completed_at ?? "").slice(0, 10) === today), open = openRun(t);
        if (done && !(!!open && (open.status === "paused" || open.lease_owner == null || Date.parse(open.lease_expires_at ?? "") < NOW))) continue; // done, and nothing recoverable left open
        const claimed = await repo.claim({ tenantId: t, owner, leaseSeconds });
        if (claimed) out.push(claimed); }
      return out; },
    async startPass({ tenantId, owner, leaseSeconds, day }) {  // The same-day EXTRA pass: the partial unique index refuses any insert while a run is unfinished, and (tenant, cycle_key) stays unique because the pass ordinal rides in the middle, the day on the tail.
      if (statusOf(tenantId) !== "active" || openRun(tenantId)) return null; const key = `${tenantId}:p${rows.filter((x) => x.tenant_id === tenantId && x.cycle_key.endsWith(day)).length + 1}:${day}`;
      if (rows.some((x) => x.tenant_id === tenantId && x.cycle_key === key)) return null;
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: key, status: "running", lease_owner: owner, lease_expires_at: iso(NOW + leaseSeconds * 1000) }));
      return { ...rows[rows.length - 1]! }; },
    async advance({ tenantId, id, owner, leaseSeconds, patch }) {
      const r = find(id, tenantId); if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { current_phase: patch.phase, progress: patch.progress ?? r.progress, phase_cursor: patch.cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) });  // Like the SQL: phase_cursor is ALWAYS set to the patch value (null clears).
      return true; },
    async renew({ tenantId, id, owner, leaseSeconds, cursor }) {
      const r = find(id, tenantId); if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { phase_cursor: cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) }); return true; },
    async finish({ tenantId, id, owner, outcome, errorInfo }) {
      const r = find(id, tenantId), done = outcome === "completed"; if (!r || !live(r, owner) || !(r.status === "running" || r.status === "paused")) return false;
      Object.assign(r, { status: outcome, lease_owner: null, lease_expires_at: null, last_error: done ? null : errorInfo ?? null, ...(done ? { current_phase: "done", completed_at: iso() } : {}) });
      return true; },
    async latest(t) { const m = newestFirst(t)[0]; return m ? { ...m } : null; },
    async sameDay({ tenantId, day, limit }) {  // The reporting day rides on the tail of BOTH cycle-key shapes, which is how the day's rows are found.
      return newestFirst(tenantId).filter((x) => x.cycle_key.endsWith(day)).slice(0, limit).map((x) => ({ id: x.id, progress: x.progress ?? {} })); },
    async countContinuation({ tenantId, day }) {  // THE COUNT IS COMPUTED WHERE IT IS STORED, so the fake sits at the SAME seam the SQL does. A read-modify-write here would pin the very bug the RPC kills: two tabs both reading 0, both writing 1.
      const row = newestFirst(tenantId)[0]; if (!row) return null; await Promise.resolve(); // the round trip: both callers can be in flight before either patch lands
      const held = patchProgress(tenantId, row.id, {}, "continuations", day)?.continuations;
      return held?.day === day && Number.isFinite(held.count) ? held.count : null; },
  };
  return { repo, rows }; }
function freshRepo(): RR.ResearchRun[] { const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo); return rows; }
/** A seeded paused (unleased) today-row a fresh claim can reclaim, plus its rows. */
function withRun(o: Partial<RR.ResearchRun> = {}): RR.ResearchRun[] { const rows = freshRepo(); rows.push(mk(o)); return rows; }
/** Work is owed unless a test says otherwise, so every pre-Phase-5 pin drives the same phases it always did. */
const NO_CHECKS = { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 };
const SOMETHING_DUE: DueWork = { due: ["daily_observations"], readable: true, checks: NO_CHECKS, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null };
const NOTHING_DUE: DueWork = { ...SOMETHING_DUE, due: [] };
/** Benign no-op steps; a phase-truth test overrides the ONE step under test. */
const BENIGN: ResearchCycleSteps = {
  dueWork: async () => SOMETHING_DUE, evidenceVersion: async () => null, reconcileCases: async () => {},
  dayStanding: async () => NO_CHECKS, // nothing owed and nothing landed: settled == intended, so the AI phase advances
  strandedToday: async () => [], // no account was left short of its day, so the dispatch opens no recovery pass
  refreshSources: async () => ({ attempted: 0, succeeded: [], failures: [] }),
  backfillChunk: async () => ({ kind: "no_work" }), crawlPages: async () => 0, investigationFocus: async () => null,
  funnelUnit: async () => ({ status: "done", cursor: null, progress: {} }), // evidence phases no-op in these lease/truth tests
  currentBasis: async () => "basis_test", publishSurface: async () => {}, surfaceStale: async () => false, // the account basis the funnel scopes to
  analyzeAnswers: async () => 0, // no new answers to read back in these lease/truth tests
  verifyShipments: async () => 0, // nothing marked implemented is waiting on a live check in these tests
};
/** Healthy logging stub: each step logs its name so phase ordering is observable. */
const healthySteps = (log: string[]): Partial<ResearchCycleSteps> => ({
  refreshSources: async () => (log.push("refresh"), { attempted: 2, succeeded: ["google_gsc", "google_ga4"], failures: [] }),
  backfillChunk: async () => (log.push("backfill"), { kind: "advanced", daysPulled: 30 }),
  crawlPages: async () => (log.push("crawl"), 1), publishSurface: async () => void log.push("publish"), surfaceStale: async () => false });
const run = (steps: Partial<ResearchCycleSteps>, deadlineMs?: number) =>
  runResearchCycle(T, { now: () => new Date(NOW), steps: { ...BENIGN, ...steps }, ...(deadlineMs === undefined ? {} : { deadlineMs }) });

beforeEach(() => { NOW = 1_700_000_000_000; RR.setResearchRunRepoForTests(null); ACCOUNT_STATUS.clear(); PAUSED.clear(); DB.missing.clear(); installAccountRepo(); });  // ACCOUNT_STATUS is cleared so every tenant defaults to active.
describe("research-run claim: one open run per account across all dates", () => {
  it("resumes the account's one unfinished run first: yesterday's paused run is reclaimed by the same id with phase and cursor untouched, a later-day visit reuses it, and no second row is ever created", async () => {
    const rows = freshRepo(); const cursor = { phase: "gsc_backfill_chunk", attemptKey: "k" };
    rows.push(mk({ id: "seed", status: "paused", current_phase: "gsc_backfill_chunk", phase_cursor: cursor, cycle_key: ckey(T, NOW - DAY), started_at: iso(NOW - DAY) }));
    const first = await RR.claimRun(T, "o1"); // resumed, not a new run: phase and cursor untouched, paused flips to running
    expect([first?.id, first?.current_phase, first?.phase_cursor, first?.status]).toEqual(["seed", "gsc_backfill_chunk", cursor, "running"]); NOW += 2 * DAY; // two UTC days later, o1's lease long dead
    expect([(await RR.claimRun(T, "o2"))?.id, rows.length]).toEqual(["seed", 1]); }); // reuses the one open run; no current-day row was ever created
  it("lets an older run's lease state govern the claim: a live foreign lease blocks a new run, an expired one is reclaimed on the same row", async () => {
    const rows = freshRepo(); rows.push(mk({ id: "seed", status: "running", lease_owner: "other", lease_expires_at: iso(NOW + LEASE), started_at: iso(NOW - DAY) }));
    expect([await RR.claimRun(T, "me"), rows.length]).toEqual([null, 1]); // live foreign lease blocks a second run
    rows[0]!.lease_expires_at = iso(NOW - 1); // the lease expires
    expect([(await RR.claimRun(T, "me"))?.id, rows.length]).toEqual(["seed", 1]); }); // expired lease reclaimed on the same row
  it("keeps accounts independent, blocks a redundant same-day pass after completion, and opens a fresh run only on a later day", async () => {
    const rows = freshRepo(); const a = await RR.claimRun(T, "o1"), b = await RR.claimRun(U, "o2"); expect([a!.id === b!.id, rows.length]).toEqual([false, 2]); // one account's open run never blocks another
    await RR.finishRun(T, a!.id, "o1", "completed"); // T completes today
    expect(await RR.claimRun(T, "o3")).toBeNull(); // no redundant same-UTC-day pass
    NOW += DAY; const next = await RR.claimRun(T, "o4"); // a later eligible day
    expect([next == null, next!.id === a!.id]).toEqual([false, false]); }); // a genuinely new run once none is open
});
describe("research-run pre-activation gate (Slice 5)", () => {
  it("a pending account runs no research at the runtime level: the seeded run is never claimed, no lease is taken, and no new run is created", async () => {
    const rows = withRun(); setAccountStatus(T, "pending_onboarding"); await run(BENIGN); // a claimable paused today-row for T
    expect([rows[0]!.status, rows[0]!.lease_owner, rows.length]).toEqual(["paused", null, 1]); }); // untouched, unleased, and no second run opened
  it("the claim model returns null for a non-active tenant, mirroring the database tenant-active guard", async () => {
    freshRepo(); setAccountStatus(T, "pending_onboarding"); expect(await RR.claimRun(T, "o1")).toBeNull(); }); // nothing claimed or created before activation
});
describe("research-run database-time lease guards", () => {
  it("guards every mutation at database time: foreign and expired owners cannot advance / renew / finish, a live owner can, and a completed row rejects mutation", async () => {
    const rows = withRun({ status: "running", lease_owner: "o1", lease_expires_at: iso(NOW + LEASE) }); const id = rows[0]!.id;
    expect([await RR.advancePhase(T, id, "intruder", { phase: "done" }), await RR.renewLease(T, id, "intruder", { phase: "refresh_sources" }), await RR.finishRun(T, id, "intruder", "completed")]).toEqual([false, false, false]);
    expect(await RR.renewLease(T, id, "o1", { phase: "refresh_sources", attemptKey: "k" })).toBe(true); expect([rows[0]!.lease_owner, rows[0]!.phase_cursor]).toEqual(["o1", { phase: "refresh_sources", attemptKey: "k" }]);
    NOW += LEASE + 1; // the owner's lease is now dead
    expect([await RR.advancePhase(T, id, "o1", { phase: "done" }), await RR.finishRun(T, id, "o1", "completed")]).toEqual([false, false]); NOW -= LEASE + 1; await RR.finishRun(T, id, "o1", "completed"); // a completed row rejects every mutation
    expect([await RR.advancePhase(T, id, "o1", { phase: "refresh_sources" }), await RR.finishRun(T, id, "o1", "paused")]).toEqual([false, false]); });
});
describe("research-run phase truth", () => {
  it("counts only synced sources as refreshed, and any connector failure pauses at refresh_sources without advancing to publish", async () => {
    const rows = withRun(); await run({ ...BENIGN, refreshSources: async () => ({ attempted: 3, succeeded: ["google_gsc", "clarity"], failures: [{ provider: "google_ga4", detail: "429 quota" }] }) });
    expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error?.phase]).toEqual(["paused", "refresh_sources", "refresh_sources"]); // stuck in place → never published off a failed refresh
    expect([rows[0]!.last_error?.failures, rows[0]!.progress.surfacePublished]).toEqual([[{ provider: "google_ga4", detail: "429 quota" }], undefined]); });
  it("treats zero stale sources as a healthy no-op and completes when every phase succeeds or no-ops", async () => {
    const rows = withRun(); await run({ ...BENIGN, surfaceStale: async () => true }); // nothing refreshed, but the saved surface is stale
    expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error, rows[0]!.progress.surfacePublished]).toEqual(["completed", "done", null, true]); });
  it("pauses at the phase that throws, never marks it published, and never completes (backfill chunk, then publish build)", async () => {
    const backfill = withRun({ current_phase: "gsc_backfill_chunk" }); await run({ ...BENIGN, backfillChunk: async () => { throw new Error("gsc backfill chunk did not advance: 429"); } });
    expect([backfill[0]!.status, backfill[0]!.current_phase, backfill[0]!.last_error?.phase, backfill[0]!.progress.surfacePublished]).toEqual(["paused", "gsc_backfill_chunk", "gsc_backfill_chunk", undefined]); // same window retries next visit, and publish was never reached
    const publish = withRun({ current_phase: "publish_surface" }); // fresh repo + seed
    await run({ ...BENIGN, surfaceStale: async () => true, publishSurface: async () => { throw new Error("surface build failed"); } });
    expect([publish[0]!.status, publish[0]!.current_phase, publish[0]!.progress.surfacePublished === true, publish[0]!.completed_at]).toEqual(["paused", "publish_surface", false, null]); });
});
describe("research-run partial-success durability + deduped refreshed providers", () => {
  it("persists the providers that DID sync before pausing, never counts a failed one, and counts a later success exactly once across the retry", async () => {
    const rows = withRun(); let firstAttempt = true;
    const steps: Partial<ResearchCycleSteps> = { ...BENIGN, refreshSources: async () => (firstAttempt
      ? (firstAttempt = false, { attempted: 2, succeeded: ["google_gsc"], failures: [{ provider: "google_ga4", detail: "429" }] })
      : { attempted: 2, succeeded: ["google_gsc", "google_ga4"], failures: [] }) };
    await run(steps); // first attempt: gsc synced, ga4 failed
    expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["paused", "refresh_sources"]); // the retry stays at refresh_sources
    expect([rows[0]!.progress.refreshedProviders, rows[0]!.progress.sourcesRefreshed]).toEqual([["google_gsc"], 1]); // the succeeded source is not stranded, and the count is the unique set
    await run(steps); // retry: both synced → union, gsc counted once
    expect([rows[0]!.status, rows[0]!.progress.sourcesRefreshed]).toEqual(["completed", 2]); expect(rows[0]!.progress.refreshedProviders).toEqual(["google_gsc", "google_ga4"]); }); // union of both attempts, no double count
  it("decodes a legacy numeric-only progress row: projection and resume never crash and the number survives", async () => {
    const rows = withRun({ current_phase: "publish_surface", progress: { sourcesRefreshed: 2 } }); expect((await RR.researchRunStatus(T, new Date(NOW))).counters.sourcesRefreshed).toBe(2); // decodes the bare number
    await run({ ...BENIGN, surfaceStale: async () => false }); expect([rows[0]!.status, rows[0]!.progress.sourcesRefreshed]).toEqual(["completed", 2]); }); // legacy number survives the resume (refresh_sources not re-run)
  it("checks what the operator marked as done BEFORE it publishes off it, and only when a check is genuinely owed", async () => {
    const order: string[] = [];
    const steps = (due: DueWork): Partial<ResearchCycleSteps> => ({ dueWork: async () => due,
      verifyShipments: async () => (order.push("verify"), 1), publishSurface: async () => void order.push("publish"), surfaceStale: async () => true });
    const owed: DueWork = { ...SOMETHING_DUE, due: ["verify_and_measure"] }; withRun({ current_phase: "publish_surface" }); await run(steps(owed));
    expect(order).toEqual(["verify", "publish"]); // the live check lands first, so the surface publishes what was actually verified
    order.length = 0; withRun({ current_phase: "publish_surface" }); await run(steps(SOMETHING_DUE)); // nothing marked implemented is waiting
    expect(order).toEqual(["publish"]); }); // no shipment owed a check, so not one page of the customer's site is read
  it("never lets a check I could not make pause the pass: the surface still publishes", async () => {
    const rows = withRun({ current_phase: "publish_surface" });
    await run({ dueWork: async () => ({ ...SOMETHING_DUE, due: ["verify_and_measure"] }),
      verifyShipments: async () => { throw new Error("your website did not answer"); }, surfaceStale: async () => true });
    expect([rows[0]!.status, rows[0]!.progress.surfacePublished]).toEqual(["completed", true]); });
});

describe("research-run idempotency identity", () => {
  it("hands each phase its persisted attempt key: an interrupted retry reuses it even across a date change, the next phase gets a different one, and no second run opens", async () => {
    const rows = withRun({ id: "seed", started_at: iso(NOW) }); const refreshKeys: string[] = [], backfillKeys: string[] = []; let refreshFails = true;
    const steps: Partial<ResearchCycleSteps> = { ...BENIGN,
      refreshSources: async (_t, _n, key) => (refreshKeys.push(key), refreshFails ? { attempted: 1, succeeded: [], failures: [{ provider: "google_gsc", detail: "boom" }] } : { attempted: 1, succeeded: ["google_gsc"], failures: [] }),
      backfillChunk: async (_t, _n, key) => (backfillKeys.push(key), { kind: "no_work" }) };
    await run(steps); // first visit: refresh fails → pause at refresh_sources with the cursor persisted
    expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["paused", "refresh_sources"]); NOW += DAY; await run(steps); // a new UTC day: the resumed run's ORIGINAL cycle key, not today's, still seeds the key
    expect([refreshKeys[1], rows.length]).toEqual([refreshKeys[0], 1]); // identical key after the date changed, and no second run on the new day
    refreshFails = false; await run(steps); // refresh succeeds → resumes the SAME phase (identical key), then advances
    expect([rows[0]!.status, rows[0]!.id]).toEqual(["completed", "seed"]); expect(refreshKeys[2]).toBe(refreshKeys[0]); // an interrupted retry reuses the identical key
    expect(backfillKeys[0]).not.toBe(refreshKeys[2]); expect(refreshKeys[0]).toMatch(/^rr_[0-9a-f]{32}$/); }); // the next phase gets a different key
});

describe("research-run resume + status projection", () => {
  it("resumes at the persisted phase (done phases are not re-run) and a deadline pauses durably", async () => {
    const rows = withRun({ current_phase: "gsc_backfill_chunk" }); const log: string[] = []; await run(healthySteps(log), 0); // out of time before any phase
    expect(log).toEqual([]); expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["paused", "gsc_backfill_chunk"]); await run(healthySteps(log));
    expect(log).toEqual(["backfill", "crawl", "publish"]); // never "refresh" (that phase was already done)
    expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["completed", "done"]); });
  it("projects PERSISTED truth only: the row's own status answers, and a lease that lived or died changes nothing a surface reads", async () => {
    const rows = withRun({ status: "running", lease_owner: "o", lease_expires_at: iso(NOW - LEASE), // lease long dead
      progress: { state: { checksDone: 12, checksTotal: 40, casesActive: 1, casesParked: 2, nextDueAt: "2026-08-02T00:00:00.000Z" } } });
    const dead = await RR.researchRunStatus(T, new Date(NOW)); rows[0]!.lease_expires_at = iso(NOW + LEASE); // the SAME row, a fresh lease
    const live = await RR.researchRunStatus(T, new Date(NOW)); expect(dead).toEqual(live); // THE pin: a transient lease change moves no number and no state
    expect([live.state, live.phaseLabel, live.stepsTotal]).toEqual(["running", "refreshing your connected data", 8]);
    expect([live.counters.aiChecksDone, live.counters.aiChecksIntended, live.cases, live.nextDueAt]) .toEqual([12, 40, { active: 1, parked: 2 }, "2026-08-02T00:00:00.000Z"]); });  // Every number comes off the persisted row, never from a per-render computation.
});

describe("research-run frozen investigation: ONE topic, and the lease the comparison spends under", () => {
  const focusOf = (topicKey: string) => ({ basis: "basis_test", topics: [{ topicKey, query: "haft seen", requirement: "exact_serp" }] });
  const FOCUS = focusOf("inv_haft");
  /** A two-stage winning-pages double over the REAL cycle: stage one persists winners, stage two would SPEND. Every invocation records its phase, the topic it was handed, and how many REAL lease renewals had happened by then, so a spend sits against a countable renewal. */
  function staged(renews: () => number) {
    const seen: Array<[string, string | null, number]> = [], spent: string[] = [];
    const funnelUnit: ResearchCycleSteps["funnelUnit"] = async (phase, _t, cursor, _b, focus) => {
      const topic = focus?.topics[0]?.topicKey ?? null; seen.push([phase, topic, renews()]); if (phase !== "winning_pages") return { status: "done", cursor: null, progress: {} };
      if (cursor?.stage !== "compare") return { status: "advanced", cursor: { stage: "compare" }, progress: {} };
      spent.push(String(topic)); return { status: "done", cursor: null, progress: {} }; };
    return { funnelUnit, seen, spent }; }
  /** memRepo plus a live count of REAL ResearchRun lease renewals. */
  const counted = () => { const { repo, rows } = memRepo(); let n = 0; RR.setResearchRunRepoForTests({ ...repo, renew: async (i) => (n += 1, repo.renew(i)) }); return { rows, renews: () => n }; };
  it("freezes ONE investigation and carries its topic through the searches, the winners and the comparison, never re-picking", async () => {
    const { rows, renews } = counted(); rows.push(mk({ current_phase: "serp_analysis" })); const w = staged(renews); let asked = 0;
    await run({ funnelUnit: w.funnelUnit, investigationFocus: async () => focusOf(asked++ === 0 ? "inv_haft" : "inv_second") });
    expect(rows[0]!.progress.focus).toEqual(FOCUS); expect(JSON.parse(JSON.stringify(rows[0]!.progress)).focus).toEqual(FOCUS); // durable before any paid work, and it survives serialization
    expect(w.seen.map((s) => s[1])).toEqual(["inv_haft", "inv_haft", "inv_haft"]); // searches, winners, comparison: ONE topic
    expect([w.spent, asked, rows[0]!.status]).toEqual([["inv_haft"], 1, "completed"]); }); // the second, fresher answer never reached the paid stage
  it("renews the RUN lease BETWEEN persisting the winners and the comparison, and buys nothing when that renewal fails", async () => {
    const { rows, renews } = counted(); rows.push(mk({ current_phase: "winning_pages", progress: { focus: FOCUS } })); const w = staged(renews); // a RESUMED run reads its frozen focus back
    await run({ funnelUnit: w.funnelUnit }); expect(w.seen[1]![2]).toBe(w.seen[0]![2] + 1); expect(w.spent).toEqual(["inv_haft"]);
    const l = memRepo(); let n = 0; RR.setResearchRunRepoForTests({ ...l.repo, renew: async (i) => ((n += 1) < 2 ? l.repo.renew(i) : false) });
    l.rows.push(mk({ current_phase: "winning_pages", progress: { focus: FOCUS } })); const dead = staged(() => n);
    await run({ funnelUnit: dead.funnelUnit }); expect([dead.seen.length, dead.spent]).toEqual([1, []]); }); // the lease died after the winners landed: the paid stage never ran
  it("pauses the SAME phase and spends nothing when the case identities could not be persisted, at the searches and at the winners alike", async () => {
    const refused = async () => { throw new Error("I could not save which of your topics are which, so I stopped before spending anything on them. I pick this up again on your next visit."); };
    for (const [phase, progress] of [["serp_analysis", {}], ["winning_pages", { focus: FOCUS }]] as const) {
      const rows = withRun({ current_phase: phase, progress }); let units = 0, asked = 0;
      await run({ reconcileCases: refused, investigationFocus: async () => (asked += 1, FOCUS), funnelUnit: async () => (units += 1, { status: "done", cursor: null, progress: {} }) });
      expect([rows[0]!.status, rows[0]!.current_phase, units, asked]).toEqual(["paused", phase, 0, 0]); // no funnel unit, no plan chosen, no purchase
      expect([rows[0]!.progress.focus, rows[0]!.last_error!.phase]).toEqual([progress.focus, phase]); // an existing frozen plan buys nothing either
      expect(rows[0]!.last_error!.message).toContain("I could not save which of your topics are which"); } });
  it("reconciles FIRST and only then freezes the plan, so a retry spends against an identity it has written", async () => {
    const rows = withRun({ current_phase: "serp_analysis" }); const order: string[] = []; let refuse = true;
    const steps = { reconcileCases: async () => { order.push("reconcile"); if (refuse) throw new Error("could not save"); }, investigationFocus: async () => (order.push("focus"), FOCUS) };
    await run(steps); expect([order, rows[0]!.progress.focus, rows[0]!.status]).toEqual([["reconcile"], undefined, "paused"]); refuse = false; await run(steps);
    expect([order, rows[0]!.progress.focus, rows[0]!.status]).toEqual([["reconcile", "reconcile", "focus", "reconcile"], FOCUS, "completed"]); }); // written first, every funnel phase, and only then chosen
  it("pauses a funnel phase before EVERYTHING when the account basis cannot be read, then reconciles first and proceeds once it can", async () => {
    const rows = withRun({ current_phase: "serp_analysis" }); const order: string[] = []; let basis: string | null = null;
    const steps: Partial<ResearchCycleSteps> = { currentBasis: async () => basis, reconcileCases: async () => void order.push("reconcile"),
      investigationFocus: async () => (order.push("focus"), FOCUS), funnelUnit: async () => (order.push("unit"), { status: "done", cursor: null, progress: {} }),
      publishSurface: async () => void order.push("publish"), surfaceStale: async () => true };
    await run(steps); // no basis: identity could not be scoped, so NOTHING may be reconciled, frozen, bought, fetched or published against it
    expect([order, rows[0]!.status, rows[0]!.current_phase, rows[0]!.progress.focus]).toEqual([[], "paused", "serp_analysis", undefined]);
    expect(rows[0]!.last_error!.message).toContain("confirmed business details"); // the existing pause vocabulary, not a new status
    basis = "basis_test"; await run(steps); // the retry re-resolves the basis, reconciles FIRST, and only then freezes and runs
    expect([order[0], order.includes("focus"), order.includes("publish"), rows[0]!.status, rows[0]!.progress.focus]).toEqual(["reconcile", true, true, "completed", FOCUS]); });
  it("requires the account basis at publish_surface too: no staleness check, no publication, no provider and no website call until it can be read", async () => {
    const rows = withRun({ current_phase: "publish_surface" }); const order: string[] = []; let basis: string | null = null;
    const steps: Partial<ResearchCycleSteps> = { currentBasis: async () => basis, surfaceStale: async () => (order.push("stale"), true),
      publishSurface: async () => void order.push("publish"), funnelUnit: async () => (order.push("unit"), { status: "done", cursor: null, progress: {} }) };
    await run(steps); // publish_surface is not a funnel phase, so the gate used to sit past it and a resumed run built and published off a basis nobody could read
    expect([order, rows[0]!.status, rows[0]!.current_phase, rows[0]!.progress.surfacePublished !== true]).toEqual([[], "paused", "publish_surface", true]);
    expect(rows[0]!.last_error!.message).toContain("confirmed business details"); // the existing pause vocabulary, and no completed evidence phase re-run to get here
    basis = "basis_test"; await run(steps); expect([order, rows[0]!.status, rows[0]!.progress.surfacePublished]).toEqual([["stale", "publish"], "completed", true]); }); // the retry publishes exactly once
  it("one empty read never silences a run for the rest of its life", async () => {
    let asked = 0;
    const unit: ResearchCycleSteps["funnelUnit"] = async (phase, _t, cursor, _b, _f) =>
      (phase === "winning_pages" && cursor?.stage !== "compare" ? { status: "advanced", cursor: { stage: "compare" }, progress: {} } : { status: "done", cursor: null, progress: {} });
    const cold = withRun({ current_phase: "serp_analysis" });
    const steps: Partial<ResearchCycleSteps> = { investigationFocus: async () => (asked++ === 0 ? null : FOCUS), // the first read comes back cold
      funnelUnit: async (p, t, c, b, f) => (asked === 1 ? { status: "waiting", cursor: null, progress: {} } : unit(p, t, c, b, f)) };
    await run(steps); expect(cold[0]!.progress.focus).toBeUndefined(); // nothing worth freezing, so nothing frozen
    await run(steps); expect(cold[0]!.progress.focus).toEqual(FOCUS); }); // the next visit asks again and the run recovers
});

describe("research-run Today copy", () => {
  const view = (o: Partial<RR.ResearchRunStatusView>): RR.ResearchRunStatusView => ({
    state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: 8, counters: {}, updatedAt: null, completedAt: null, pauseReason: null, ...o,
  });
  const NOON_PT = Date.parse("2026-07-23T19:00:00Z"); // noon Pacific on Jul 23
  it("never says 'current': same-day completion shows today, an older pass shows its date, none is silent", () => {
    const completed = view({ state: "completed", completedAt: new Date(NOON_PT).toISOString() }); const sameDay = RR.researchStatusLine(completed, new Date(NOON_PT)); const older = RR.researchStatusLine(completed, new Date(NOON_PT + 2 * DAY));
    expect(sameDay).toBe("Latest research pass finished today at 12:00 PM."); expect(older).toBe("Latest research pass finished Jul 23 at 12:00 PM.");
    expect(`${sameDay} ${older}`).not.toMatch(/current/i); expect(RR.researchStatusLine(view({ state: "none" }))).toBeNull(); });
  it("says how a finished day actually landed, in checks, and stays quiet when there is nothing to own", () => {  // EVERY COUNT HERE IS A CHECK, NEVER AN ENGINE: one silent engine across forty questions is forty checks.
    const done = (counters: RR.ResearchRunStatusView["counters"]) =>
      RR.researchStatusLine(view({ state: "completed", completedAt: new Date(NOON_PT).toISOString(), counters }), new Date(NOON_PT));
    expect(done({ aiChecksDone: 140, aiChecksIntended: 140, aiChecksAnswered: 137, aiChecksUnavailable: 2, aiChecksUnsupported: 1 })) .toBe("Latest research pass finished today at 12:00 PM. I finished today's checks: 137 answers, 2 checks came back empty, 1 I cannot ask.");
    expect(done({ aiChecksDone: 140, aiChecksIntended: 140, aiChecksAnswered: 139, aiChecksUnavailable: 1 })) .toContain("1 check came back empty."); // one is one check, never one engine
    expect(done({ aiChecksDone: 140, aiChecksIntended: 140, aiChecksAnswered: 140, aiChecksUnavailable: 0, aiChecksUnsupported: 0 })) .toBe("Latest research pass finished today at 12:00 PM."); // every check answered: nothing to own, so nothing said
    expect(done({ aiChecksDone: 96, aiChecksIntended: 140, aiChecksAnswered: 94 })) .toBe("Latest research pass finished today at 12:00 PM."); }); // the day is still open, so the running count carries it
  it("gives an open error-free run ONE in-progress sentence with the persisted AI-check counts, identical whether the lease is live or released", () => {
    const progress = { funnel: { promptsChecked: 35, enginePairsDone: 40, enginePairsIntended: 140 } };
    const leased = mk({ status: "running", current_phase: "prompt_observations", progress, lease_owner: "o", lease_expires_at: iso(NOW + LEASE) });
    const released = mk({ ...leased, status: "paused", lease_owner: null, lease_expires_at: null }); // same run, a normal provider wait persisted
    const live = RR.researchStatusLine(RR.projectStatusView(leased, NOW)); expect(live).toBe("Research in progress: checking how AI assistants answer your questions. 40 of 140 AI checks collected.");
    expect(RR.researchStatusLine(RR.projectStatusView(released, NOW))).toBe(live); }); // THE pin: the line never toggles on lease state alone
  it("invents no numbers off the AI phase, names a real pause reason, and never resurrects a stale one", () => {
    const later = mk({ status: "running", current_phase: "serp_analysis", lease_owner: "o", lease_expires_at: iso(NOW + LEASE),  // Cumulative funnel counters survive onto later phases; the clause must not follow them.
      progress: { funnel: { promptsChecked: 35, enginePairsDone: 40, enginePairsIntended: 140 } } });
    expect(RR.researchStatusLine(RR.projectStatusView(later, NOW))).toBe("Research in progress: reading the results pages for your strongest topics.");
    const stuck = mk({ status: "paused", current_phase: "keyword_discovery", last_error: { phase: "keyword_discovery", message: "I need your confirmed business basics before I can research keywords.", at: iso() } });  // A pause the operator must clear names its reason instead of reading as ordinary progress.
    expect(RR.researchStatusLine(RR.projectStatusView(stuck, NOW))).toBe("Research paused after 3 of 8 steps. I need your confirmed business basics before I can research keywords.");
    const stale = mk({ ...stuck, current_phase: "serp_analysis" });  // A reason recorded by an already-passed phase never resurrects on the current one.
    expect(RR.researchStatusLine(RR.projectStatusView(stale, NOW))).toBe("Research in progress: reading the results pages for your strongest topics.");
  });
  it("stops calling a dead process work in progress: a freshly-touched running row reads in progress, one untouched for ten minutes reads interrupted", () => {
    const fresh = mk({ status: "running", current_phase: "serp_analysis", updated_at: iso(NOW - 60_000) }); // a minute since the last real write
    expect(RR.researchStatusLine(RR.projectStatusView(fresh, NOW))).toBe("Research in progress: reading the results pages for your strongest topics.");
    const dead = RR.projectStatusView(mk({ ...fresh, updated_at: iso(NOW - 11 * 60_000) }), NOW);  // The SAME row, untouched past the stale bound: the owner died, and saying so is the honest read.
    expect([dead.state, dead.pauseReason]).toEqual(["paused", "I was interrupted mid research. My next daily round picks this back up."]);
    expect(RR.researchStatusLine(dead)).toBe("Research paused after 5 of 8 steps. I was interrupted mid research. My next daily round picks this back up.");
    expect(RR.projectStatusView(mk({ ...fresh, lease_owner: "o", lease_expires_at: iso(NOW - LEASE) }), NOW)) .toEqual(RR.projectStatusView(fresh, NOW)); });  // It reads off updated_at alone, so a lease that lived or died still moves nothing: no flicker.
});

describe("research-run conflict-free research closure", () => {
  /** THE production incident, hermetic: ONE research_state row, a discovery phase landing this run's REAL receipt, and a prompt phase served the snapshot from BEFORE that write. The writers interleave, so the prompt unit resets its receipt and its optimistic save conflicts. The executor is the REAL one. */
  /** Runtime's daily plan, the observation unit's ONLY input: one question on the four engines, one day. */
  const DUE = (["chatgpt", "claude", "gemini", "perplexity"] as const).map((engine) => ({ promptId: "p1", version: 1, text: "best persian restaurant", engine, slot: 0 as const, day: "2026-07-21" }));
  function funnelWorld(rows: RR.ResearchRun[], staleLoads: number) {
    const pre = emptyFunnelState(T, "basis_test"); pre.cycle = { runId: "prev-run", cycleKey: "prev", spentUsd: 1.82, cacheHits: 0 }; // the PREVIOUS run's receipt
    const live = { state: structuredClone(pre), rowVersion: 18 }; const seen: Record<string, unknown>[] = []; const bought = new Set<string>(); let loads = 0, paid = 0;
    const answer = { answerText: "hi", modelServed: null, webSearchReported: null, citations: [], fanOutQueries: null, brands: null };
    const deps: FunnelDeps = { syncHistory: async () => {}, recordObservation: async () => {}, getAccount: async () => null, now: () => NOW, parse: ((_c: unknown, env: unknown) => env) as FunnelDeps["parse"],
      loadState: async () => (loads++ < staleLoads ? { state: structuredClone(pre), rowVersion: 18 } : { state: structuredClone(live.state), rowVersion: live.rowVersion }),
      saveState: async (_t, _b, s, expected) => { if (expected !== live.rowVersion) return null; live.state = structuredClone(s); live.rowVersion = expected + 1; return live.rowVersion; },
      callProvider: async (cap) => (bought.has(cap) ? { state: "hit", envelope: answer as never, costUsd: 0, cacheKey: `ck-${cap}`, modelServed: null }  // Cache identity makes any retry $0: a capability already bought comes back as a hit, never a second paid post.
        : (bought.add(cap), paid += 1, { state: "ok", envelope: answer as never, costUsd: 0.01, cacheKey: `ck-${cap}`, modelServed: null })) as CachedCallResult };
    const funnelUnit: ResearchCycleSteps["funnelUnit"] = async (phase, tenantId, cursor, budgetMs) => {
      seen.push({ phase, owner: rows[0]!.lease_owner, attemptKey: (rows[0]!.phase_cursor as Record<string, unknown> | null)?.attemptKey });
      if (phase === "keyword_discovery") { // the first writer: this run's proven spend lands at the next row version
        live.state.cycle = { runId: String(cursor!.runId), cycleKey: "c", spentUsd: 0.09504, cacheHits: 8 }; live.rowVersion += 1;
        return { status: "done", cursor: null, progress: { retainedKeywords: 700, cacheHits: 8, spendUsd: 0.09504 } }; }
      return phase === "prompt_observations" ? promptObservationUnit(deps, DUE)(tenantId, cursor, budgetMs) : { status: "done", cursor: null, progress: {} }; };
    return { funnelUnit, paid: () => paid, prompts: () => seen.filter((s) => s.phase === "prompt_observations") }; }
  it("recovers the interleave: ONE retry on the same run, phase, lease and attempt key, no duplicate paid post, and the FRESH receipt persists", async () => {
    const rows = withRun(); const w = funnelWorld(rows, 1); await run({ funnelUnit: w.funnelUnit }); // only the first prompt load is stale
    expect(w.prompts()).toHaveLength(2); expect(w.prompts()[0]).toEqual(w.prompts()[1]); // one conflict, exactly one retry, identical run / lease owner / attempt key
    expect([w.paid(), rows[0]!.status]).toEqual([4, "completed"]); // the 4 planned readings bought once: the retry reused every cache identity at $0, and the run closed instead of pausing
    expect(rows[0]!.progress.funnel).toMatchObject({ retainedKeywords: 700, spendUsd: 0.095, cacheHits: 12 }); }); // the FRESH unit's numbers (4dp receipt), never the stale zeros
  it("pauses ONCE with the bounded reason on a second consecutive conflict, and still never under-reports the run's spend", async () => {
    const rows = withRun(); const w = funnelWorld(rows, 99); await run({ funnelUnit: w.funnelUnit }); // every prompt load is stale: the retry conflicts too
    expect(w.prompts()).toHaveLength(2); expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["paused", "prompt_observations"]); // bounded: no third invocation, no loop
    expect(rows[0]!.last_error).toMatchObject({ phase: "prompt_observations", message: CONFLICT_DETAIL });
    expect(rows[0]!.progress.funnel).toMatchObject({ spendUsd: 0.09504, cacheHits: 8 }); }); // the conflicted attempt's zeros are DISCARDED, never merged over proven spend
  it("retries ONLY a state conflict: a bounded failure, a durable wait and a lost lease each run the unit exactly once", async () => {
    for (const unit of [{ status: "failed", cursor: null, progress: {}, detail: "One research request was turned down." }, { status: "waiting", cursor: null, progress: {} }] as FunnelUnitOutcome[]) {
      const rows = withRun({ current_phase: "prompt_observations" }); let calls = 0;
      await run({ funnelUnit: async () => (calls += 1, unit) }); expect([calls, rows[0]!.status]).toEqual([1, "paused"]); } // no code, no retry
    const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests({ ...repo, renew: async () => false }); rows.push(mk({ current_phase: "prompt_observations" })); let ran = false; // a lost lease aborts BEFORE the side effect
    await run({ funnelUnit: async () => (ran = true, { status: "done", cursor: null, progress: {} }) }); expect([ran, rows[0]!.last_error]).toEqual([false, null]); }); // the unit never ran and nothing was recorded
  it("reads the new answers back on the observation phase only, records what persisted, and never turns a read-back failure into a pause", async () => {
    const seen: Array<[string, string]> = []; const rows = withRun(); await run({ analyzeAnswers: async (t, day) => (seen.push([t, day]), 2) });
    expect(seen).toEqual([[T, ckey(T).slice(-10)]]); // once, on prompt_observations, for the run's own UTC day
    expect([rows[0]!.status, rows[0]!.progress.funnel?.answersAnalyzed]).toEqual(["completed", 2]); const failed = withRun(); // the answers are already safely stored, so a read-back that throws must not pause the run
    await run({ analyzeAnswers: async () => { throw new Error("openai down"); } }); expect([failed[0]!.status, failed[0]!.progress.funnel?.answersAnalyzed]).toEqual(["completed", undefined]); });
});
/** THE DAY IS THE PROMISE, THE BATCH IS AN IMPLEMENTATION DETAIL. The planner hands out twenty checks a pass; the operator was promised 35 questions on 4 engines. The run used to call the phase finished the moment its window settled, walk on, and land `completed` on 107 of 140, after which the fleet claim refused the account for the rest of the day and 33 checks were simply never asked. */
describe("a day of AI checks ends when the day ends, never when a batch does", () => {
  const TOTAL = 140; // 35 tracked questions on 4 engines
  const standing = (done: number) => ({ done, total: TOTAL, answers: done, unavailable: 0, unsupported: 0 });
  /** A day that settles one 20-check window per observation pass, and a planner that answers honestly about it. */
  const day = () => { let done = 0; const windows: number[] = [];
    const steps: Partial<ResearchCycleSteps> = {
      funnelUnit: async (phase) => { if (phase !== "prompt_observations") return { status: "done", cursor: null, progress: {} };
        windows.push(Math.min(20, TOTAL - done)); done = Math.min(TOTAL, done + 20); return { status: "done", cursor: null, progress: {} }; },
      dayStanding: async () => standing(done) };
    return { steps, windows, done: () => done }; };
  it("keeps ONE open run on the AI phase until every identity is settled, then completes on 140 of 140 carrying the whole day's breakdown", async () => {
    const rows = withRun({ current_phase: "prompt_observations" }); const w = day(); await run(w.steps); expect(w.windows).toEqual([20, 20, 20, 20, 20, 20, 20]); // seven windows of twenty, one reporting day, one run
    expect([rows.length, rows[0]!.status, rows[0]!.current_phase]).toEqual([1, "completed", "done"]);
    expect(rows[0]!.progress.state).toMatchObject({ checksDone: 140, checksTotal: 140, checksAnswers: 140 }); }); // the DAY's numbers, not the last batch's
  it("stays on the AI phase while provider work is still in flight: a durable wait pauses there with no error at all, and the next tick picks the day back up", async () => {
    const rows = withRun({ current_phase: "prompt_observations" }); let done = 0, inFlight = true;
    const steps: Partial<ResearchCycleSteps> = {
      funnelUnit: async (phase) => { if (phase !== "prompt_observations") return { status: "done", cursor: null, progress: {} };
        if (inFlight) return { status: "waiting", cursor: null, progress: {} }; // posted, not yet answered
        done = Math.min(TOTAL, done + 20); return { status: "done", cursor: null, progress: {} }; },
      dayStanding: async () => standing(done) };
    await run(steps); expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error]).toEqual(["paused", "prompt_observations", null]); // a wait is not a failure and is never completion
    inFlight = false; await run(steps); expect([rows.length, rows[0]!.status, done]).toEqual([1, "completed", 140]); }); // the SAME run finishes the day it started
  it("closes a pass whose reporting day has already ended instead of buying that day late, and lets today's own cycle open", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); rows.push(mk({ id: "stale", status: "paused", current_phase: "prompt_observations", cycle_key: `${T}:2026-07-01`, started_at: iso(NOW - DAY) }));
    const asked: string[] = [], planned: string[] = [];
    const steps: Partial<ResearchCycleSteps> = { funnelUnit: async (phase) => (asked.push(phase), { status: "done", cursor: null, progress: {} }),
      dayStanding: async (_t, d) => (planned.push(d), standing(TOTAL)) };
    await run(steps); // a run that paused before midnight Pacific and was picked up after it
    expect([asked.filter((a) => a === "prompt_observations"), planned]).toEqual([[], []]); // nothing placed, nothing collected onto that day, nothing even planned for it
    expect([rows.length, rows[0]!.status, rows[0]!.progress.state?.checksTotal]).toEqual([1, "completed", 0]); // closed honestly, and the dead day's denominator never landed as today's
    await run(steps); // and TODAY's own cycle is free to open, which the one-open-run index refused while that run stayed open
    expect([rows.length, rows[1]!.cycle_key.endsWith(new Date(NOW).toISOString().slice(0, 10)), rows[1]!.status]).toEqual([2, true, "completed"]); });
  it("stops an observation phase that never converges instead of looping on the database, and says how much is still owed", async () => {
    const rows = withRun({ current_phase: "prompt_observations" }); let seen = 0;
    await run({ funnelUnit: async () => ({ status: "done", cursor: null, progress: {} }), // the planner and the executor disagree: settled never moves
      dayStanding: async () => { if ((seen += 1) > 60) throw new Error("the phase never stopped asking"); return standing(20); } });
    expect([seen <= 13, rows[0]!.status, rows[0]!.current_phase]).toEqual([true, "paused", "prompt_observations"]); expect(rows[0]!.last_error!.message).toContain("120 of today's 140 AI checks are still owed"); });
  it("never calls a day finished it could not count: an unreadable planner pauses the AI phase and advances nothing", async () => {
    const rows = withRun({ current_phase: "prompt_observations" }); await run({ dayStanding: async () => null });
    expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["paused", "prompt_observations"]); expect(rows[0]!.last_error!.message).toContain("where today's AI checks stand"); });
});

/** THE CRAWL HAS TO BEGIN SOMEWHERE. Cold start only ever fired from onboarding, so an account that predates it kept an empty owned-page inventory forever: every scheduled pass asked to CONTINUE a crawl that had never started, was told "no crawl", and recorded a healthy no-op. */
describe("reading a pre-existing account's own website", () => {
  const crawl = () => defaultSteps.crawlPages(T, new Date(NOW));
  beforeEach(() => { CRAWL.state = null; CRAWL.starts = 0; CRAWL.batches = 0; CRAWL.forced = false; CRAWL.racer = null; });
  it("starts the frontier once for an active account that never had one, reads one bounded batch, and only continues it from then on", async () => {
    expect([await crawl(), CRAWL.starts, CRAWL.batches, CRAWL.forced]).toEqual([3, 1, 1, false]); // one init, one batch, never forced, never onboarding
    expect([await crawl(), CRAWL.starts, CRAWL.batches]).toEqual([3, 1, 2]); }); // an existing frontier is continued, never started again
  it("continues the state a concurrent instance created rather than resetting it, and leaves an unreachable site exactly as it found it", async () => {
    CRAWL.racer = () => { CRAWL.state = "complete"; }; // another instance initialized between the load and the start
    expect([await crawl(), CRAWL.starts, CRAWL.batches]).toEqual([3, 1, 1]); // the SURVIVING state is what gets continued
    CRAWL.state = "unreachable"; CRAWL.racer = null; expect([await crawl(), CRAWL.starts, CRAWL.batches]).toEqual([0, 1, 1]); }); // unreachable is persisted truth, not a reason to start over
  it("never crawls from a render: not one customer surface reaches a crawl entry point", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    const surfaces = [...walk("src/app"), ...walk("src/components")].filter((f) => /\.tsx?$/.test(f)); expect(surfaces.filter((f) => /startColdStartCrawl|runCrawlBatch|ColdStartCrawlIfStarted/.test(readFileSync(f, "utf8")))).toEqual([]); });
});

/** THE MONEY IS THE PLACEMENT'S. A posted ask is finished by a FREE collect, and that free collect used to land the final row at cost 0, erasing the receipt the pending row already held: the one row Decision reads about an answer disagreed with the ledger that paid for it. */
describe("what a stored observation says it cost", () => {
  const DUE = [{ promptId: "p1", version: 1, text: "best persian restaurant", engine: "claude" as const, slot: 0 as const, day: "2026-08-03" }];
  const CURSOR = { basis: "basis_test", runId: "r1", cycle: `${T}:2026-08-03` };
  const answer = { answerText: "hi", modelServed: null, webSearchReported: null, citations: [], fanOutQueries: null, brands: null };
  /** One account's funnel document plus the two seams that matter here: what a PLACEMENT costs, and what the paid row already ON FILE says when the landing itself computed nothing. */
  const world = (postCost: number, onFile = 0) => {
    const wrote: AiObservationRecord[] = []; const held = { s: emptyFunnelState(T, "basis_test"), v: 1 }; let posts = 0, reads = 0;
    const deps: FunnelDeps = { syncHistory: async () => {}, getAccount: async () => null, now: () => NOW, parse: ((_c: unknown, env: unknown) => env) as FunnelDeps["parse"],
      recordObservation: async (rec) => void wrote.push(rec), readObservationCost: async () => (reads += 1, onFile),
      loadState: async () => ({ state: structuredClone(held.s), rowVersion: held.v }),
      saveState: async (_t, _b, s, expected) => { if (expected !== held.v) return null; held.s = structuredClone(s); held.v += 1; return held.v; },
      callProvider: async () => (posts += 1, { state: "waiting", cacheKey: "ck-1", costUsd: postCost, modelRequested: null } as CachedCallResult),
      collectTask: async () => ({ state: "ok", envelope: answer as never, costUsd: 0, cacheKey: "ck-1", modelServed: null } as CachedCallResult) };
    // Exactly the shape of the identities already in flight when the pair-carried cost shipped: posted, live at the provider, with no cost of their own.
    const forget = () => { held.s.prompts.pairs = held.s.prompts.pairs.map((x) => ({ ...x, postCostUsd: undefined })); }; return { deps, wrote, forget, posts: () => posts, reads: () => reads }; };
  it("keeps the placement cost on the final answer, asks the provider exactly once, upserts ONE identity, and never re-reads a cost it already carries", async () => {
    const w = world(0.0075); const first = await promptObservationUnit(w.deps, DUE)(T, CURSOR, 5_000); // the ask is PLACED: the money moves here
    expect([first.status, w.wrote.at(-1)!.status, w.wrote.at(-1)!.cost_usd, w.wrote.at(-1)!.cache_key]).toEqual(["waiting", "pending", 0.0075, "ck-1"]);
    const second = await promptObservationUnit(w.deps, DUE)(T, CURSOR, 5_000); // the next tick collects it for free
    expect([second.status, w.wrote.at(-1)!.status, w.wrote.at(-1)!.cost_usd]).toEqual(["done", "observed", 0.0075]); // THE pin: free collection never overwrites what placement paid
    expect([w.posts(), new Set(w.wrote.map((r) => r.id)).size, w.reads()]).toEqual([1, 1, 0]); }); // no second paid post, one identity upserted, and no read it did not need
  it("keeps the paid placement ALREADY ON FILE for an identity posted before the pair carried its own cost, instead of writing a paid receipt down to zero", async () => {
    const w = world(0.0075, 0.0075);
    await promptObservationUnit(w.deps, DUE)(T, CURSOR, 5_000); w.forget();
    const second = await promptObservationUnit(w.deps, DUE)(T, CURSOR, 5_000);
    expect([second.status, w.wrote.at(-1)!.cost_usd, w.reads()]).toEqual(["done", 0.0075, 1]); }); // the pending row's own receipt survives the free collect
});

describe("research-run fail-closed + render path", () => {
  it("fails closed when the claim RPC throws, throws on an empty tenant before any I/O, and runs no phase on the render path", async () => {
    let touched = false; const log: string[] = [];
    RR.setResearchRunRepoForTests({ ...memRepo().repo, claim: async () => { touched = true; throw new Error("db down"); } });
    await run(healthySteps(log)); expect([log, touched]).toEqual([[], true]); // no phase ran, and it did try to claim
    touched = false; await expect(RR.claimRun("", "o1")).rejects.toThrow(/tenantId is required/); expect(touched).toBe(false); // never reached the repo
    const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo); expect(() => ensureResearchRunOnVisit(T)).not.toThrow(); // after() invalid outside a request → caught
    await Promise.resolve(); expect(rows).toHaveLength(0); }); // no phase work on the render path
});

/** THE REGISTRY DECIDES, ONCE per run. The reconcile step here is the real one, so the wiring is what is pinned: a registry that only changed the ORDER it was written in is unmoved, and the advisory reading is bounded per RUN, never per unit iteration. */
describe("the case registry a run saves, and the ONE reading it buys", () => {
  const row = (id: string, anchors: string[]) => ({ id, anchors });
  const real = (steps: Partial<ResearchCycleSteps> = {}) => { const { reconcileCases: _seam, ...rest } = BENIGN;
    return runResearchCycle(T, { now: () => new Date(NOW), steps: { ...rest, ...steps } }); };
  beforeEach(() => { REG.saves = 0; REG.readings = 0; });
  it("saves nothing and reads nothing when the registry changed only the order it happens to be written in", async () => {
    REG.onFile = [row("inv_b", ["y", "x"]), row("inv_a", ["a"])]; REG.next = [row("inv_a", ["a"]), row("inv_b", ["x", "y"])]; const rows = withRun({ current_phase: "serp_analysis" }); await real();
    expect([REG.saves, REG.readings, rows[0]!.progress.synthesisAttempted, rows[0]!.status]).toEqual([0, 0, undefined, "completed"]); });
  it("attempts the reading at most ONCE per run, however many units and phases reconcile against a registry that did move", async () => {
    REG.onFile = [row("inv_a", ["a"])]; REG.next = [row("inv_a", ["a", "b"])]; const rows = withRun({ current_phase: "serp_analysis" }); let units = 0;
    await real({ funnelUnit: async () => { units += 1; return units < 4 ? { status: "advanced", cursor: { units }, progress: {} } : { status: "done", cursor: null, progress: {} }; } });
    expect([REG.saves > 1, REG.readings, rows[0]!.progress.synthesisAttempted, units, rows[0]!.status]).toEqual([true, 1, true, 5, "completed"]); });
});

/** THE DUE-WORK RUNTIME. A day is not a unit of work: owed work is. The SAME free question ("what is genuinely due, from persisted state alone") decides whether a second pass may open on a finished day, whether a pass has anything to do, and whether a continuation is worth asking for. Rows, never a lease. */
describe("the due-work runtime: a day is not a unit of work", () => {
  const today = () => new Date(NOW).toISOString().slice(0, 10);
  const completedToday = (): RR.ResearchRun[] => { const rows = freshRepo(); rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done" })); return rows; };
  it("opens a SECOND pass the same day on genuinely due work, and refuses at zero cost when nothing is due or the state cannot be read", async () => {
    const rows = completedToday(); let asked = 0; await run({ dueWork: async () => (asked += 1, NOTHING_DUE), refreshSources: async () => { throw new Error("no phase may run"); } });
    expect([rows.length, asked]).toEqual([1, 1]); // nothing due: no row, no phase, no cent
    await run({ dueWork: async () => ({ ...SOMETHING_DUE, readable: false }), refreshSources: async () => { throw new Error("no phase may run"); } });
    expect(rows).toHaveLength(1); // unreadable is not "due": opening a pass on a guess is how money gets spent twice
    await run({ dueWork: async () => SOMETHING_DUE }); // a retry date passed, a source refreshed, an extra reading was granted
    expect([rows.length, rows[1]!.status, rows[1]!.cycle_key.slice(-10)]).toEqual([2, "completed", today()]); expect(rows[1]!.cycle_key).not.toBe(rows[0]!.cycle_key); }); // a distinct pass, still reporting into the day it opened
  it("closes a pass that opened with nothing due immediately and at zero cost, and that completion blocks no later pass", async () => {
    const rows = freshRepo(); const log: string[] = [];
    await run({ ...healthySteps(log), dueWork: async () => ({ ...NOTHING_DUE, checks: { ...NO_CHECKS, done: 40, total: 40, answers: 37, unavailable: 2, unsupported: 1 }, cases: { active: 0, parked: 2 }, nextDueAt: "2026-08-02T00:00:00.000Z" }) });
    expect([log, rows[0]!.status, rows[0]!.current_phase]).toEqual([[], "completed", "done"]); // not one phase ran
    expect(rows[0]!.progress.state).toMatchObject({ checksDone: 40, checksTotal: 40, checksAnswers: 37, checksUnavailable: 2, checksUnsupported: 1, casesParked: 2, nextDueAt: "2026-08-02T00:00:00.000Z" });  // A pass that closed with nothing owed still says what it checked and when the waiting ends.
    expect(RR.researchStatusLine(RR.projectStatusView(rows[0]!, NOW), new Date(NOW))) .toContain("Nothing more is due until August 1."); // the operator's own zone, the same one every other date on Today uses
    NOW += DAY; await run(healthySteps(log)); expect([log, rows.length]).toEqual([["refresh", "backfill", "crawl", "publish"], 2]); }); // tomorrow is untouched by today's empty pass
  it("chains bounded continuations: it re-schedules only while work is due, and never past the bound", async () => {
    let hops = 0; const chain = async (due: () => DueWork) => { completedToday(); let hop = 0, ran = 0;
      while (ran < 12) { const step = await continueResearch(T, hop, { now: () => new Date(NOW), steps: { ...BENIGN, dueWork: async () => (hops += 1, due()) } });  // Bounded past the ceiling so a regression FAILS instead of looping: the day's hop count terminates it.
        ran += 1; if (!step.more) return { hop: step.hop, ran }; hop = step.hop; }
      return { hop, ran } };
    expect((await chain(() => NOTHING_DUE)).ran).toBe(1); // nothing due after the first hop: no second request is asked for
    hops = 0; const forever = await chain(() => SOMETHING_DUE); expect([forever.hop, forever.ran]).toEqual([6, 6]); }); // due forever still stops at the bound
  it("counts overlapping continuation hops once each, never twice as the first", async () => {  // TWO TABS ARE ONE COUNT. Both hops start before either lands and the increment happens where the row is, so they read 1 and 2. Counted in the app, both would read 0 and write 1, and the hop bound would bound nothing.
    const rows = freshRepo(); const day = today(); rows.push(mk({ id: "r-open", status: "running", started_at: iso() }));
    const both = await Promise.all([RR.countContinuationHop(T, day), RR.countContinuationHop(T, day)]); expect(both.sort()).toEqual([1, 2]); expect(rows[0]!.progress.continuations).toEqual({ day, count: 2 });
    expect(await RR.countContinuationHop(T, "2026-08-09")).toBe(1); }); // a new day starts over, never adds on
  it("carries the day's own state onto the pass it justified: the grant, the ceiling marker, the reading receipt and the decide watermark all survive a new row, and none of them survives the day", async () => {
    const rows = freshRepo(); const day = today();
    const dayState = { extraSamples: { day, granted: 1 }, capped: { day, caseIds: ["inv_haft"] },
      synthesisAttempted: true, decided: { basis: "basis_test", rowVersion: 12 } };
    rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done", progress: dayState })); await run({ dueWork: async () => SOMETHING_DUE });
    expect([rows.length, rows[1]!.status]).toEqual([2, "completed"]);  // The planner, the case receipt and the watermark all read the LATEST row. Before this, the pass the grant paid for was born blank, so the grant could never be spent and the watermark to close the day was gone.
    expect(rows[1]!.progress).toMatchObject(dayState); NOW += DAY; await run({ dueWork: async () => SOMETHING_DUE }); // a new reporting day inherits none of it
    expect([rows.length, rows[2]!.progress.extraSamples, rows[2]!.progress.capped, rows[2]!.progress.synthesisAttempted]) .toEqual([3, undefined, undefined, undefined]); });
  it("keeps opening passes while work is genuinely due, and refuses the 25th on one day as the absolute runaway stop", async () => {
    const rows = freshRepo(); const day = today();
    for (let i = 0; i < 23; i += 1) rows.push(mk({ id: `p${i}`, status: "completed", completed_at: iso(), current_phase: "done", cycle_key: `${T}:p${i + 1}:${day}` }));
    const twentyFourth = await RR.startExtraPass(T, "tab-24", day); // the day's own stop, above any one door's allowance
    expect([twentyFourth?.lease_owner, rows.length]).toEqual(["tab-24", 24]); await RR.finishRun(T, twentyFourth!.id, "tab-24", "completed");
    expect(await RR.startExtraPass(T, "tab-25", day)).toBeNull(); // the honest runaway stop, not a claim that nothing is due
    expect(rows).toHaveLength(24); });
  it("holds the VISIT door to eight extra passes a day, so navigating cannot spend the day the scheduler needs", async () => {
    const rows = freshRepo(); const day = today();
    for (let i = 0; i < 8; i += 1) rows.push(mk({ id: `p${i}`, status: "completed", completed_at: iso(), current_phase: "done", cycle_key: `${T}:p${i + 1}:${day}` }));  // Every navigation is a chance to open a pass, so this door keeps its own eight; the day's absolute stop is 24.
    await run({ dueWork: async () => SOMETHING_DUE, refreshSources: async () => { throw new Error("no phase may run"); } }); expect(rows).toHaveLength(8); // the 9th visit-door pass is refused, and nothing ran
    expect(await RR.startExtraPass(T, "cron", day)).not.toBeNull(); }); // the day itself still has room
  it("counts continuation hops on the account's own row, so a client that keeps claiming hop 0 is refused once the day's bound is spent", async () => {
    const rows = completedToday(); let cycles = 0; const seen: Array<{ hop: number; more: boolean }> = [];
    const steps = { ...BENIGN, dueWork: async () => SOMETHING_DUE,
      refreshSources: async () => (cycles += 1, { attempted: 0, succeeded: [], failures: [] }) };
    for (let i = 0; i < 8; i += 1) seen.push(await continueResearch(T, 0, { now: () => new Date(NOW), steps })); // the same made-up hop, every time
    expect(seen.map((s) => s.hop)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // the SERVER counts, and the count survives every new pass row
    expect(seen.map((s) => s.more)).toEqual([true, true, true, true, true, false, false, false]); expect(cycles).toBe(6); // the last two hops ran nothing at all
    expect(rows[rows.length - 1]!.progress.continuations).toEqual({ day: today(), count: 8 }); });
  it("two tabs cannot both open a same-day pass: the second insert loses to the one-open-run invariant", async () => {
    const rows = completedToday(); const one = await RR.startExtraPass(T, "tab-1", today()); const two = await RR.startExtraPass(T, "tab-2", today()); // the first pass is still open
    expect([one?.lease_owner, two, rows.length]).toEqual(["tab-1", null, 2]); });
  it("marks the case a spending ceiling stopped, day-scoped on the run's own row, and the receipt reads it", async () => {
    const rows = withRun({ current_phase: "keyword_discovery" });
    await run({ funnelUnit: async () => ({ status: "failed", cursor: { stage: "competitors", cappedCase: "inv_haft" }, progress: {}, detail: "the ceiling was reached" }) });
    expect(rows[0]!.progress.capped).toEqual({ day: today(), caseIds: ["inv_haft"] });
    const snapshot = { scope: { builtAt: iso() }, ownedPages: [], research: { cases: [{ id: "inv_haft", anchors: ["haft seen"] }],
      retainedKeywords: [], serpEvidence: [], aiObservations: [], pageComparisons: [], winningPages: [], caseCompetitors: [], receipt: { spentUsd: 0, cached: 0 } } } as unknown as EvidenceSnapshot;
    const reasons = (capped: string[]) => caseResearchReceipt(snapshot, "inv_haft", capped)!.notBought.map((n) => n.reason); expect(reasons(rows[0]!.progress.capped!.caseIds)).toContain("capped");
    expect(reasons([])).not.toContain("capped"); }); // the marker dies with the day, so tomorrow's receipt says nothing about today's ceiling
});

/** THE DAILY DISPATCH. Daily AI tracking must happen on a day nobody opens the app, without becoming a second orchestrator: the guarded endpoint is the only door, the dispatch claims through the SAME lease and drives the SAME cycle, firing it twice does nothing twice, and its receipt never flatters a failure. */
describe("the daily scheduler: one guarded door, the same lease, the same cycle", () => {
  const today = () => new Date(NOW).toISOString().slice(0, 10);
  const NO_PHASE = { refreshSources: async () => { throw new Error("no phase may run"); } };
  /** The receipt's eight fields, so every expectation states the whole answer and a silent new key fails. */
  const R = (o: Partial<SchedulerReceipt> = {}): SchedulerReceipt =>
    ({ claimed: 0, attempted: 0, succeeded: 0, paused: 0, failed: 0, leaseHeldUntil: [], released: 0, remaining: 0, ...o });
  const dispatch = (steps: Partial<ResearchCycleSteps> = {}) =>
    runDueAccounts({ now: () => new Date(NOW), steps: { ...BENIGN, ...steps } });
  const post = (headers: Record<string, string>) =>
    POST(new NextRequest("http://beacon.test/api/cron/scheduler", { method: "POST", headers }));
  it("answers 401 without the exact bearer, and 401 when CRON_SECRET is unset, so an unconfigured deploy never dispatches", async () => {
    const rows = freshRepo(); vi.stubEnv("CRON_SECRET", ""); expect((await post({ authorization: "Bearer anything" })).status).toBe(401); // no secret configured = fail closed
    vi.stubEnv("CRON_SECRET", "s3cret"); expect((await post({})).status).toBe(401); expect((await post({ authorization: "s3cret" })).status).toBe(401); // the scheme is part of the check
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401); vi.unstubAllEnvs(); expect(rows).toHaveLength(0); }); // a refused call claims nothing, so no work leaks past the gate
  it("answers 200 with the dispatch's own receipt when the bearer matches, and nothing else", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret"); ROUTE.receipt = R({ claimed: 2, attempted: 2, succeeded: 2 }); const res = await post({ authorization: "Bearer s3cret" }); expect(res.status).toBe(200);
    expect(await res.json()).toEqual(R({ claimed: 2, attempted: 2, succeeded: 2 })); // counts only: no token, no tenant, no secret
    vi.unstubAllEnvs(); });
  it("claims each due account in turn and drives it through the real cycle, and its receipt carries counts and nothing else", async () => {
    const rows = freshRepo(); const log: string[] = []; const receipt = await dispatch(healthySteps(log));
    expect(receipt).toEqual(R({ claimed: 2, attempted: 2, succeeded: 2 })); // the whole fleet fits this budget; nothing is left leased
    expect(Object.keys(receipt).sort()).toEqual(["attempted", "claimed", "failed", "leaseHeldUntil", "paused", "released", "remaining", "succeeded"]); // no token, no tenant, no secret
    expect(log).toEqual(["refresh", "backfill", "crawl", "publish", "refresh", "backfill", "crawl", "publish"]); // the SAME phase order a visit drives, twice
    expect(rows.map((r) => [r.tenant_id, r.status, r.cycle_key.slice(-10)])).toEqual([[T, "completed", today()], [U, "completed", today()]]);
    expect(await dispatch(NO_PHASE)).toEqual(R()); }); // a finished day is claimed by nobody
  /** A THROW IS NOT A DRIVE. The old receipt counted `driven` inside the very catch that logged the failure, so a dispatch whose account blew up past the cycle's own recovery reported a full day's work. Each outcome has its own name now, and the live lease a throw leaves behind is either handed back through the canonical paused state or, when even that will not land, reported by the moment it expires. */
  it("tells a failure apart from a drive, hands the failed account's lease back, and names the expiry when it cannot", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); // one candidate, so one outcome is the whole answer
    expect(await dispatch({ currentBasis: async () => { throw new Error("the cycle fell over"); } }))  // Basis resolution sits OUTSIDE the cycle's own phase recovery, so a throw here is a throw the dispatch sees.
      .toEqual(R({ claimed: 2, attempted: 1, failed: 1, released: 1, paused: 1, remaining: 2 })); // never succeeded, never "driven"; the re-claim the one-turn guard hands back is counted too, so the receipt sums
    expect([rows[0]!.status, rows[0]!.lease_owner]).toEqual(["paused", null]); // returned, not sat on
    const fresh = freshRepo();
    const receipt = await dispatch({ currentBasis: async () => { fresh[0]!.lease_owner = null; throw new Error("and the release could not clean up"); } });  // Now the release cannot land: the lease is gone from under it, the one case where an account stays leased.
    expect(receipt).toEqual(R({ claimed: 2, attempted: 1, failed: 1, paused: 1, remaining: 2, leaseHeldUntil: [iso(NOW + LEASE)] })); expect(receipt.released).toBe(0); });
  /** THE RECEIPT IS THE DRIVER'S, NOT THE LOOP'S. Returning normally used to be the whole test of success, so a durable provider wait, a phase that paused
   *  itself and a lease another instance had already recovered were each counted as a finished day, and the one machine-readable receipt said so. */
  it("counts a wait, a phase pause and a lost lease as themselves, and a clean cycle as exactly one success", async () => {
    const one = (steps: Partial<ResearchCycleSteps>) => { const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); return { rows, receipt: dispatch(steps) }; };
    const waiting = one({ funnelUnit: async () => ({ status: "waiting", cursor: null, progress: {} }) });
    expect(await waiting.receipt).toEqual(R({ claimed: 2, attempted: 1, paused: 2, remaining: 2 })); // durable provider work is pending, which is not a day's work done
    expect(waiting.rows[0]!.status).toBe("paused"); const partial = one({ refreshSources: async () => ({ attempted: 2, succeeded: ["google_gsc"], failures: [{ provider: "google_ga4", detail: "token expired" }] }) });
    expect(await partial.receipt).toEqual(R({ claimed: 2, attempted: 1, paused: 2, remaining: 2 })); // a phase that reported failures paused; it did not succeed
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding");
    const stolen = await dispatch({ crawlPages: async () => { rows[0]!.lease_owner = "another-instance"; return 0; } }); // the lease is recovered from under us mid-cycle
    expect(stolen).toEqual(R({ claimed: 1, attempted: 1, failed: 1, remaining: 1 })); // never a success, and a lease somebody else now holds is not mine to report
    const clean = one({}); expect(await clean.receipt).toEqual(R({ claimed: 1, attempted: 1, succeeded: 1 })); expect(clean.rows[0]!.status).toBe("completed"); }); // exactly one, on a run that really did land completed
  /** AN OUTAGE IS NOT AN EMPTY FLEET. The claim used to swallow every error into an empty list, so a database that was down, an RPC that was never migrated
   *  and a revoked permission all answered 200 with a zero receipt: identical to a genuinely idle fleet, and cron monitoring recorded a healthy day. */
  it("says 503 when it could not read what is owed, in one bounded word, and keeps 200 for a fleet that genuinely owes nothing", async () => {
    const { repo } = memRepo();
    for (const boom of [new Error("connect ECONNREFUSED 10.0.0.4:5432 db.vlxwevsdvwxvopkjsewo.supabase.co"),
      Object.assign(new Error("Could not find the function public.claim_due_research_work"), { code: "PGRST202" })]) {
      RR.setResearchRunRepoForTests({ ...repo, claimDue: async () => { throw boom; } }); await expect(RR.claimDueRuns("o1", 1)).rejects.toThrow(); // a typed failure, never an empty list
      await expect(dispatch(NO_PHASE)).rejects.toThrow(); ROUTE.fail = boom; vi.stubEnv("CRON_SECRET", "s3cret"); const res = await post({ authorization: "Bearer s3cret" });
      expect([res.status, await res.json()]).toEqual([503, { error: "scheduler_unavailable" }]); // no account, no host, no port, no database text
      ROUTE.fail = null; vi.unstubAllEnvs();
    }
    const rows = freshRepo(); PAUSED.add(T); PAUSED.add(U); expect(await dispatch(NO_PHASE)).toEqual(R()); // zero rows owed is a success, and always was
    expect(rows).toHaveLength(0); ROUTE.receipt = R(); vi.stubEnv("CRON_SECRET", "s3cret"); const idle = await post({ authorization: "Bearer s3cret" }); expect([idle.status, await idle.json()]).toEqual([200, R()]);
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401); // and a bad bearer still claims nothing at all
    vi.unstubAllEnvs(); });
  /** A COMPLETED PASS IS NOT A FINISHED DAY, and the fleet claim cannot tell them apart: claim_due_research_work excludes an account the moment ANY run completed today, so the 23:00 tick answered a zero receipt while 33 of that day's checks had never been asked at all. A repeat tick is a no-op only once the DAY is settled, and the recovery lives here in the dispatch because the claim itself is frozen. */
  it("opens exactly one more pass for a day left short, drives it to the end of the day, and only then goes back to a zero receipt", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding");
    rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done", started_at: iso() })); // today's pass finished its batch and stopped at 107
    let done = 107, paidUnits = 0;
    const steps: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE,
      strandedToday: async () => (done < 140 ? [T] : []),
      dayStanding: async () => ({ done, total: 140, answers: done, unavailable: 0, unsupported: 0 }),
      funnelUnit: async (phase) => { if (phase === "prompt_observations") { paidUnits += 1; done = Math.min(140, done + 20); } return { status: "done", cursor: null, progress: {} }; } };
    expect(await dispatch(steps)).toEqual(R({ claimed: 1, attempted: 1, succeeded: 1 })); // the stranded day is claimed and driven, not skipped
    expect([rows.length, rows[1]!.status, done, paidUnits]).toEqual([2, "completed", 140, 2]); // ONE recovery pass, and it finished the day
    expect(await dispatch(steps)).toEqual(R()); // now the day really is done: the honest zero receipt
    expect(rows).toHaveLength(2); }); // and no pass opens on a settled day, ever
  it("never opens a recovery pass on a day that is genuinely terminal, and buys nothing twice on one that is", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); let paidUnits = 0;
    const paying: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE,
      funnelUnit: async () => (paidUnits += 1, { status: "done", cursor: null, progress: {} }) };
    await dispatch(paying); const afterFirst = paidUnits; expect([rows.length, rows[0]!.status, afterFirst > 0]).toEqual([1, "completed", true]);
    expect(await dispatch(paying)).toEqual(R()); // the day is settled, so nothing is claimed and nothing is opened
    expect([rows.length, paidUnits]).toEqual([1, afterFirst]); }); // no second row, not one more paid unit
  it("still reaches the account the claim cannot see when another one is re-claimed: one dispatch, one recovery pass", async () => {
    const rows = freshRepo(); // U stays open with provider work in flight; T finished its batch and left the day short
    rows.push(mk({ id: "openU", tenant_id: U, status: "paused", current_phase: "prompt_observations", started_at: iso() }));
    rows.push(mk({ id: "doneT", tenant_id: T, status: "completed", completed_at: iso(), current_phase: "done", started_at: iso() }));
    const steps: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE, strandedToday: async () => [T],
      dayStanding: async () => ({ done: 107, total: 140, answers: 107, unavailable: 0, unsupported: 0 }),
      funnelUnit: async (phase) => (phase === "prompt_observations" ? { status: "waiting", cursor: null, progress: {} } : { status: "done", cursor: null, progress: {} }) };
    await dispatch(steps);
    expect(rows.filter((r) => r.tenant_id === T && r.cycle_key.includes(":p"))).toHaveLength(1); }); // U being re-claimed must not cost T its recovery
  it("two ticks racing the same stranded day open at most one pass between them", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done", started_at: iso() }));
    const steps: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE, strandedToday: async () => [T],
      dayStanding: async () => ({ done: 107, total: 140, answers: 107, unavailable: 0, unsupported: 0 }),
      funnelUnit: async (phase) => (phase === "prompt_observations" ? { status: "waiting", cursor: null, progress: {} } : { status: "done", cursor: null, progress: {} }) };
    await Promise.all([dispatch(steps), dispatch(steps)]); expect(rows.filter((r) => r.cycle_key.includes(":p"))).toHaveLength(1); }); // the one-open-run invariant is the whole guard, and it holds
  /** ONE canonical runtime, two doors: the operator's "update my data" press and the nightly dispatch drive the SAME row, or the app has a second pipeline. */
  it("shares one runtime with the operator's own refresh: the same phases, the same row, resumed and not restarted", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); const scheduled: string[] = [];
    await dispatch({ ...healthySteps(scheduled), publishSurface: async () => { scheduled.push("publish"); throw new Error("stop here, mid-cycle"); } });
    expect([scheduled, rows.length, rows[0]!.status, rows[0]!.current_phase]).toEqual([["refresh", "backfill", "crawl", "publish"], 1, "paused", "publish_surface"]);
    const visited: string[] = []; // the operator now presses refresh on the account the dispatch left unfinished
    await runResearchCycle(T, { now: () => new Date(NOW), steps: { ...BENIGN, ...healthySteps(visited) } });
    expect([visited, rows.length, rows[0]!.status]).toEqual([["publish"], 1, "completed"]); });  // The SAME row, picked up at the SAME phase it stopped on: never a restart, never work paid for twice.
  it("holds ONE live claim at a time, so an account is never leased while another is being driven", async () => {
    const rows = freshRepo(); const leasedWhileDriving: number[] = [];  // THE DEFECT: claiming three accounts up front left two holding live foreign leases for minutes, and an operator who opened Beacon on one of them was refused by a lease taken for them.
    const receipt = await dispatch({ refreshSources: async () => {
      leasedWhileDriving.push(rows.filter((r) => r.lease_owner != null).length); return { attempted: 0, succeeded: [], failures: [] }; } });
    expect(receipt).toEqual(R({ claimed: 2, attempted: 2, succeeded: 2 })); expect(leasedWhileDriving).toEqual([1, 1]); }); // never two, so a visit on the other account still wins its claim
  it("never starts an account it cannot give a real slice to, and releases one whose claim spent the last of it", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); rows.push(mk({ id: "a", status: "paused" })); const spend = (budgetMs: number, stepMs = 0) => { let reading = 0;
      return runDueAccounts({ now: () => new Date(NOW + reading++ * stepMs), budgetMs, steps: { ...BENIGN, ...NO_PHASE } }); };
    expect(await spend(29_000)).toEqual(R()); // under half a minute buys nothing worth claiming
    expect([rows[0]!.status, rows[0]!.lease_owner]).toEqual(["paused", null]);
    expect(await spend(60_000, 20_000)).toEqual(R({ claimed: 1, paused: 1, remaining: 1 }));  // 60 seconds of budget against a clock that moves 20 per reading: the claim lands, the slice does not.
    expect([rows[0]!.status, rows[0]!.lease_owner]).toEqual(["paused", null]); }); // handed back, never left leased
  it("cannot double-drive: a duplicate dispatch loses at the lease seam, and a finished day is claimed again by neither", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); // one candidate, so the refusal is the whole answer
    rows.push(mk({ id: "live", status: "running", lease_owner: "other-dispatch", lease_expires_at: iso(NOW + LEASE) })); expect(await dispatch(NO_PHASE)).toEqual(R());
    expect(rows[0]!.lease_owner).toBe("other-dispatch"); // a live foreign lease is somebody else's work, never disturbed
    const fresh = freshRepo(); await dispatch(); expect(fresh[0]!.status).toBe("completed"); expect(await dispatch(NO_PHASE)).toEqual(R()); // the day it finished is not claimed again
    expect(fresh).toHaveLength(1); });
  it("never claims an account whose operator paused research, or one that is not active", async () => {
    const rows = freshRepo(); PAUSED.add(T); PAUSED.add(U); expect(await dispatch(NO_PHASE)).toEqual(R()); PAUSED.delete(T); setAccountStatus(T, "pending_onboarding"); expect((await dispatch(NO_PHASE)).claimed).toBe(0);
    expect(rows).toHaveLength(0); });
  it("plans today and never the days it missed: a run resumed after a long pause reports into today's date, and one day makes one row", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding");
    rows.push(mk({ id: "old", status: "paused", cycle_key: `${T}:2026-07-01`, started_at: iso(NOW - 30 * DAY) }));
    await dispatch(); expect([rows.length, rows[0]!.status]).toEqual([1, "completed"]); // the one unfinished run is RESUMED, no missed day is invented
    expect(await dispatch(NO_PHASE)).toEqual(R()); });
  it("reports the pause switch only when the database actually took it, and both doors honour the answer", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding");
    DB.missing.add(T);  // A PATCH matching no row answers 204 with NO error, so a bare "no error" reported success over a database that never heard the request, and Settings flipped the switch on screen for the rest of the day.
    expect(await setResearchPaused(T, true)).toBe(false); expect(await isResearchPaused(T)).toBe(false); // unchanged, and the surface keeps the state it had
    DB.missing.delete(T); expect(await setResearchPaused(T, true)).toBe(true); expect(await isResearchPaused(T)).toBe(true);
    await run({ dueWork: async () => SOMETHING_DUE, ...NO_PHASE }); // the VISIT door reads the same row
    expect([await dispatch(NO_PHASE), rows.length]).toEqual([R(), 0]); });
});

/** The rules themselves, on injected persisted state: no network, no clock tricks, no lease. */
describe("dueWork: what is genuinely owed, computed from persisted state only", () => {
  const parked = (ms: number) => ({ basis: "b1", topics: [{ topicKey: "t1", query: "haft seen", requirement: "exact_serp", retryAfter: new Date(ms).toISOString() }] });
  const base = { staleSources: async () => 0, checks: async () => ({ ...NO_CHECKS, done: 4, total: 4, answers: 4, due: 0 }), basis: async () => "b1", evidenceVersion: async () => 7,
    surfaceStale: async () => false, debt: async () => ({ measurable: 0, unverified: 0 }), pagesToCrawl: async () => false, run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW + DAY) } }) };
  it("owes nothing when the sources are fresh, today's round has landed, the notes have not moved past the last decision, and the rest is waiting on a date I promised", async () => {
    const w = await dueWork(T, new Date(NOW), base);
    expect([w.due, w.readable, w.checks, w.cases, w.nextDueAt]).toEqual([[], true, { ...NO_CHECKS, done: 4, total: 4, answers: 4 }, { active: 0, parked: 1 }, new Date(NOW + DAY).toISOString()]); });
  it("names each owed unit from the ONE persisted fact that proves it", async () => {
    const due = async (o: Parameters<typeof dueWork>[2]) => (await dueWork(T, new Date(NOW), { ...base, ...o })).due; expect(await due({ staleSources: async () => 1 })).toEqual(["refresh_sources"]);
    expect(await due({ checks: async () => ({ ...NO_CHECKS, done: 2, total: 4, answers: 2, due: 2 }) })).toEqual(["daily_observations"]);
    expect(await due({ pagesToCrawl: async () => true })).toEqual(["crawl_pages"]); // a page of their own website I have never read is owed a batch; base says none is, which is the "nothing due" half
    expect(await due({ run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW - 1) } }) })).toEqual(["acquire_case_evidence"]);  // A retry date that PASSED is the same-day unlock: the promise I made has come due.
    expect(await due({ evidenceVersion: async () => 8 })).toEqual(["plan_cases", "decide_and_prepare"]);  // The notes moved past what the last decision consumed: new evidence, so a plan and a decision are owed.
    expect(await due({ debt: async () => ({ measurable: 3, unverified: 0 }) })).toEqual(["verify_and_measure"]);
    expect(await due({ debt: async () => ({ measurable: 0, unverified: 1 }) })).toEqual(["verify_and_measure"]);  // A change marked implemented but never checked live owes the same unit. ONE ledger read answers both.
    expect(await due({ surfaceStale: async () => true })).toEqual(["publish_surfaces"]);
    expect(await due({ run: async () => ({ open: true, progress: { decided: { basis: "b1", rowVersion: 7 } } }) })).toEqual(["plan_cases"]);  // An OPEN run with no plan bound to this basis owes one; an idle account with no plan owes nothing.
    expect(await due({ run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 } } }) })).toEqual([]); });
  it("treats a completed pass's frozen plan as a receipt, not a standing queue: only an arrived retry date or a still-open run makes a topic owed", async () => {
    const plan = { basis: "b1", topics: [{ topicKey: "t1", query: "haft seen", requirement: "exact_serp" }] }; // frozen, no date promised
    const decided = { basis: "b1", rowVersion: 7 }; const due = async (open: boolean) => (await dueWork(T, new Date(NOW), { ...base, run: async () => ({ open, progress: { decided, focus: plan } }) })).due;
    expect(await due(false)).toEqual([]); // the pass that froze it CONSUMED it: a quiet account takes the zero-cost exit
    expect(await due(true)).toEqual(["acquire_case_evidence"]); // the run that froze it is still open and genuinely owes the work
    expect((await dueWork(T, new Date(NOW), { ...base, run: async () => ({ open: false, progress: { decided, focus: parked(NOW - 1) } }) })).due) .toEqual(["acquire_case_evidence"]); });  // And a date I promised that has ARRIVED is owed whether or not a run is open.
  it("says UNREADABLE rather than empty when the durable state cannot be read, so a caller never mistakes a failed read for a finished day", async () => {
    const blind = await dueWork(T, new Date(NOW), { ...base, run: async () => { throw new Error("db down"); } }); expect([blind.readable, blind.due]).toEqual([false, []]);
    const noPlan = await dueWork(T, new Date(NOW), { ...base, checks: async () => null }); expect(noPlan.readable).toBe(false);
    expect((await dueWork("", new Date(NOW), base)).readable).toBe(false); }); // no tenant, no answer, no I/O
});
