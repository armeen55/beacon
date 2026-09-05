/** Durable Research Run: the one-open-run-per-account invariant (resume any unfinished run across dates before a new daily cycle), the truth boundary (any failure PAUSES, never completes), partial connector success surviving a pause, deduped refreshed providers across retries, the lease guards (including the ONE the paid comparison spends under), the frozen investigation, the idempotency identity, and the fail-closed render path. The repo models the RPC guards. */
import { describe, it, expect, beforeEach, vi } from "vitest";
/** The DEFAULT reconcile step, exercised for REAL below. Every other test seams reconcileCases; funnel/state keeps its real exports for the conflict closure. */
const REG = vi.hoisted(() => ({ onFile: [] as unknown[], next: [] as unknown[], saves: 0, readings: 0 }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => ({ ownedPages: [], research: { cases: [] } }) }));
vi.mock("@/domains/evidence/topic-investigation", () => ({ reconcileResearchCases: () => REG.next, buildTopicInvestigations: () => { REG.readings += 1; return []; } }));
vi.mock("@/domains/evidence/funnel/state", async (actual) => ({ ...(await actual<Record<string, unknown>>()), loadFunnelState: async () => ({ state: { cases: REG.onFile }, rowVersion: 3 }), saveFunnelState: async () => { REG.saves += 1; return 4; } }));
/** The ONE table this file models directly: tenants.research_paused. `missing` is the account with NO row: the SELECT answers null data and the PATCH matches nothing, which PostgREST answers 204 with NO error. `readThrows` is the client that cannot reach the database at all, and `ignoresWrites` is the row that matched a PATCH whose value did not stick. Every other table throws exactly as an unconfigured client does, so no other pin moves. */
const DB = vi.hoisted(() => ({ paused: new Set<string>(), missing: new Set<string>(), ignoresWrites: new Set<string>(), readThrows: false,
  /** The FLEET, as the recovery probe's own paged read sees it: every id in id order, plus what each window served. */
  fleet: [] as string[], served: [] as string[][], fleetError: null as { message: string } | null }));
vi.mock("@/lib/persistence/supabase", async (actual) => ({ ...(await actual<Record<string, unknown>>()),
  getSupabaseAdmin: () => ({ from: (table: string) => {
    if (table !== "tenants") throw new Error("this test models no other table");
    return {
      select: (_c: string, opts?: { count?: string }) => {
        if (opts?.count == null) return { eq: (_col: string, id: string) => ({ maybeSingle: async () => { if (DB.readThrows) throw new Error("the database could not be reached");
          return DB.missing.has(id) ? { data: null, error: null } : { data: { research_paused: DB.paused.has(id) }, error: null }; } }) };
        const chain = { eq: () => chain, not: () => chain, order: () => chain,
          range: async (from: number, to: number) => { if (DB.fleetError) return { data: null, error: DB.fleetError, count: null };
            const page = DB.fleet.slice(from, to + 1); DB.served.push(page); return { data: page.map((id) => ({ id })), error: null, count: DB.fleet.length }; } };
        return chain; },
      update: (patch: { research_paused: boolean }) => ({ eq: (_c: string, id: string) => ({ select: async () => {
        if (DB.missing.has(id)) return { data: [], error: null };
        if (!DB.ignoresWrites.has(id)) { if (patch.research_paused) DB.paused.add(id); else DB.paused.delete(id); }
        return { data: [{ id }], error: null }; } }) }),
    }; } }) }));
/** The crawl seam: ONE in-memory frontier, so what is pinned is the ENTRY POINT rather than the fetcher. `state` is what the durable blob holds, and `racer` lets a concurrent instance initialize between the load and the start. */
const CRAWL = vi.hoisted(() => ({ state: null as null | "in_progress" | "complete" | "unreachable", starts: 0, forced: false, batches: 0, racer: null as null | (() => void),
  /** The ORDER the batch was handed, captured so what is pinned is which pages jump the queue and not the fetcher. */
  pick: null as null | ((t: string, limit: number, now?: Date) => Promise<string[]>), inventory: [] as string[], decay: [] as { page: string; clicksNow: number; clicksPrior: number }[] }));
vi.mock("@/domains/evidence/scanning/owned-pages-store", async (actual) => ({ ...(await actual<Record<string, unknown>>()), nextCrawlCandidates: async () => CRAWL.inventory }));
vi.mock("@/domains/evidence/readers/gsc-page-signals", async (actual) => ({ ...(await actual<Record<string, unknown>>()),
  loadGscDecaySignalsForTenant: async () => new Map(CRAWL.decay.map((d) => [d.page, d])) }));
vi.mock("@/domains/evidence/scanning/crawl-frontier", async (actual) => ({ ...(await actual<Record<string, unknown>>()),
  startColdStartCrawl: async (a: { force?: boolean }) => { CRAWL.starts += 1; CRAWL.forced = CRAWL.forced || a.force === true; CRAWL.racer?.();
    CRAWL.state = CRAWL.state ?? "in_progress"; return { status: CRAWL.state, discovered: 3 }; },
  continueColdStartCrawlIfStarted: async (_t: string, deps?: { pickCandidates?: (t: string, l: number, n?: Date) => Promise<string[]> }) => (CRAWL.pick = deps?.pickCandidates ?? null, CRAWL.state == null || CRAWL.state === "unreachable"
    ? { ran: false, status: CRAWL.state ?? "no_crawl", crawled: 0, failed: 0, totalCrawled: 0, remaining: 0, complete: false, detail: CRAWL.state ?? "no_frontier_state" }
    : (CRAWL.batches += 1, { ran: true, status: CRAWL.state, crawled: 3, failed: 0, totalCrawled: 3 * CRAWL.batches, remaining: 0, complete: false })) }));
/** The route's own dispatch, stubbed so its gate and receipt are pinned without a second drive of the real cycle (every dispatch test below drives it). */
const ROUTE = vi.hoisted(() => ({ receipt: {} as Record<string, unknown>, fail: null as Error | null }));
vi.mock("@/domains/runtime", async (actual) => ({ ...(await actual<Record<string, unknown>>()), runDueAccounts: async () => { if (ROUTE.fail) throw ROUTE.fail; return ROUTE.receipt; } }));
/** THE SAVED CUSTOMER RELEASE, as the accounts it was age-stamped for: a store transition inside a drive must reach the screen without waiting for publish_surface, which a run parked in an earlier phase never reaches. */
const H = vi.hoisted(() => ({ surf: [] as string[], rebuilt: [] as string[] })), SURF = H.surf, REBUILT = H.rebuilt; vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async (t: string) => void H.surf.push(t), readCustomerSurface: async () => null, isCustomerSurfaceStale: () => false, refreshCustomerSurface: async (t: string) => (H.rebuilt.push(t), {}) })); // REBUILT names every account whose release this tick actually rebuilt, which is the one thing the dispatch's own clock decides
import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle, ensureResearchRunOnVisit, RESEARCH_CYCLE_DEADLINE_MS, type ResearchCycleSteps } from "@/domains/runtime/ops/on-visit-refresh";
import { dueWork, researchPermission, setResearchPaused, visitMayOpenResearch, isDocumentArrival, type DueWork } from "@/domains/runtime/ops/due-work";
import { runDueAccounts, type SchedulerReceipt } from "@/domains/runtime/ops/scheduler"; import { defaultSteps } from "@/domains/runtime/ops/research-steps";
import { POST } from "@/app/api/cron/scheduler/route"; import { NextRequest } from "next/server";
import { caseResearchReceipt } from "@/domains/evidence/case-receipt"; import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { setAccountRepositoryForTests, type AccountRepository } from "@/domains/account/tenants/store"; import type { AccountStatus } from "@/domains/account";
import type { CachedCallResult, FunnelUnitOutcome } from "@/domains/evidence/dataforseo/funnel-boundary"; import type { AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations";
import { promptObservationUnit } from "@/domains/evidence/funnel/observe"; import { CONFLICT_DETAIL, type FunnelDeps } from "@/domains/evidence/funnel/shared";
import { emptyFunnelState } from "@/domains/evidence/funnel/state"; import { reportingDay } from "@/lib/reporting-day";
const ACCOUNT_STATUS = new Map<string, AccountStatus>();  // Pre-activation gate: runtime and the RPC model both refuse research work unless the account is active. Every tenant defaults to 'active'; a test opts one into 'pending_onboarding' to exercise the gate.
const statusOf = (t: string): AccountStatus => ACCOUNT_STATUS.get(t) ?? "active";
const setAccountStatus = (t: string, s: AccountStatus): void => void ACCOUNT_STATUS.set(t, s);
/** Accounts whose operator paused research: the SQL reads it on the scheduler door, researchPermission on the visit door, the SAME rows. */
const PAUSED = DB.paused;
function installAccountRepo(): void {
  const byId = async (id: string) => ({ id, slug: id, provisional_name: "", domain: "example.com", status: statusOf(id), signup_date: "", tos_accepted_at: null, daily_budget_usd: 0, growth_goal: null, created_at: "", updated_at: "" });
  setAccountRepositoryForTests({ getAccountById: byId, getAccountBySlug: byId } satisfies AccountRepository); }
let NOW = 1_700_000_000_000; const iso = (ms = NOW) => new Date(ms).toISOString();
const DAY = 24 * 3600 * 1000, T = "acct-a", U = "acct-b", LEASE = RR.RESEARCH_RUN_LEASE_SECONDS * 1000, FLEET = [T, U];
const ckey = (t: string, ms = NOW) => `${t}:${new Date(ms).toISOString().slice(0, 10)}`; // the daily key the DATABASE computes
const mk = (o: Partial<RR.ResearchRun>): RR.ResearchRun => ({ id: "seed", tenant_id: T, cycle_key: ckey(T, NOW), status: "paused", current_phase: "refresh_sources", phase_cursor: null, progress: {}, spend_usd: 0, last_error: null,
  lease_owner: null, lease_expires_at: null, started_at: iso(), updated_at: iso(), completed_at: null, ...o });
/** In-memory repo modeling the RPC guards: claim resumes the single unfinished run (any date) before a new daily cycle, a foreign LIVE lease returns null, a same-day completed run blocks a fresh pass, the daily key is computed at database time; advance/renew need a live lease + 'running', finish an open one. */
function memRepo(): { repo: RR.ResearchRunRepo; rows: RR.ResearchRun[] } { const rows: RR.ResearchRun[] = [];
  const find = (id: string, t: string) => rows.find((x) => x.id === id && x.tenant_id === t); const live = (r: RR.ResearchRun, o: string) => r.lease_owner === o && r.lease_expires_at != null && Date.parse(r.lease_expires_at) >= NOW;
  /** started_at desc, insertion order breaking a tie: "the latest row" is what day-scoped state and the hop count both ask. */
  const newestFirst = (t: string) => rows.map((r, i) => [r, i] as const).filter(([r]) => r.tenant_id === t) .sort((a, b) => b[0].started_at.localeCompare(a[0].started_at) || b[1] - a[1]).map(([r]) => r);
  const openRun = (t: string) => newestFirst(t).find((x) => x.status === "running" || x.status === "paused");
  /** patch_research_run_progress in one atomic step: top-level merge, plus a {day, count} computed FROM THE ROW when an increment key is given. Null = no row. */
  const patchProgress = (t: string, id: string, patch: RR.ResearchRunProgress, key?: string, day?: string): RR.ResearchRunProgress | null => { const r = find(id, t); if (!r) return null; const before = r.progress ?? {}, held = key ? (before as Record<string, { day?: string; count?: number } | undefined>)[key] ?? null : null;
    r.progress = { ...before, ...patch, ...(key ? { [key]: { day, count: held != null && held.day === day ? (held.count ?? 0) + 1 : 1 } } : {}) }; return r.progress; }; const repo: RR.ResearchRunRepo = {
    async claim({ tenantId, owner, leaseSeconds }) {
      if (statusOf(tenantId) !== "active") return null;  // Mirror the RPC's new leading guard: no claim unless the account is active.
      const exp = iso(NOW + leaseSeconds * 1000), open = openRun(tenantId); if (open) {
        if (open.lease_owner != null && open.lease_owner !== owner && Date.parse(open.lease_expires_at!) >= NOW) return null; // a foreign LIVE lease
        Object.assign(open, { lease_owner: owner, lease_expires_at: exp, status: open.status === "paused" ? "running" : open.status, updated_at: iso() });
        return { ...open }; } // id / cycle_key / phase / cursor / progress / last_error preserved
      const today = new Date(NOW).toISOString().slice(0, 10); if (rows.some((x) => x.tenant_id === tenantId && x.status === "completed" && (x.completed_at ?? "").slice(0, 10) === today)) return null;
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: ckey(tenantId, NOW), status: "running", lease_owner: owner, lease_expires_at: exp }));  // mk defaults already give refresh_sources / null cursor / {} progress / null error.
      return { ...rows[rows.length - 1]! }; },
    async claimDue({ owner, limit, leaseSeconds }) {  // claim_due_research_work: enumerate ACTIVE, not-paused accounts whose current reporting day still owes work, then claim each THROUGH the claim above, so the lease stays the only mechanism.
      const out: RR.ResearchRun[] = [], today = new Date(NOW).toISOString().slice(0, 10);
      const lastMoved = (t: string) => rows.filter((x) => x.tenant_id === t)  // Fairness order: greatest(max(started_at), max(updated_at)) asc, then id; a resume touches ONLY updated_at.
        .map((x) => (x.updated_at > x.started_at ? x.updated_at : x.started_at)).sort().pop() ?? ""; const queue = [...FLEET].sort((a, b) => lastMoved(a).localeCompare(lastMoved(b)) || a.localeCompare(b));
      for (const t of queue) { if (out.length >= limit) break; if (statusOf(t) !== "active" || PAUSED.has(t)) continue; const done = rows.some((x) => x.tenant_id === t && x.status === "completed" && (x.completed_at ?? "").slice(0, 10) === today), open = openRun(t);
        if (done && !(!!open && (open.status === "paused" || open.lease_owner == null || Date.parse(open.lease_expires_at ?? "") < NOW))) continue; // done, and nothing recoverable left open
        const claimed = await repo.claim({ tenantId: t, owner, leaseSeconds }); if (claimed) out.push(claimed); }
      return out; },
    async startPass({ tenantId, owner, leaseSeconds, day, progress }) {  // The same-day EXTRA pass: the partial unique index refuses any insert while a run is unfinished, and (tenant, cycle_key) stays unique because the pass ordinal rides in the middle, the day on the tail. The row is BORN carrying why it was opened, exactly as the insert does.
      if (statusOf(tenantId) !== "active" || openRun(tenantId)) return null; const key = `${tenantId}:p${rows.filter((x) => x.tenant_id === tenantId && x.cycle_key.endsWith(day)).length + 1}:${day}`;
      if (rows.some((x) => x.tenant_id === tenantId && x.cycle_key === key)) return null;
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: key, status: "running", lease_owner: owner, lease_expires_at: iso(NOW + leaseSeconds * 1000), ...(progress ? { progress } : {}) }));
      return { ...rows[rows.length - 1]! }; }, async advance({ tenantId, id, owner, leaseSeconds, patch }) {
      const r = find(id, tenantId); if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { current_phase: patch.phase, progress: patch.progress ?? r.progress, phase_cursor: patch.cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) });  // Like the SQL: phase_cursor is ALWAYS set to the patch value (null clears).
      return true; }, async renew({ tenantId, id, owner, leaseSeconds, cursor }) {
      const r = find(id, tenantId); if (!r || !live(r, owner) || r.status !== "running") return false; Object.assign(r, { phase_cursor: cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) }); return true; },
    async finish({ tenantId, id, owner, outcome, errorInfo, spendUsd }) { const r = find(id, tenantId), done = outcome === "completed"; if (!r || !live(r, owner) || !(r.status === "running" || r.status === "paused")) return false;  // The spend stamp rides the same guarded close the SQL does: it lands under the lease we still hold, right before it is released.
      Object.assign(r, { status: outcome, lease_owner: null, lease_expires_at: null, last_error: done ? null : errorInfo ?? null, ...(typeof spendUsd === "number" ? { spend_usd: spendUsd } : {}), ...(done ? { current_phase: "done", completed_at: iso() } : {}) }); return true; },
    async latest(t) { const m = newestFirst(t)[0]; return m ? { ...m } : null; },
    async sameDay({ tenantId, day, limit }) {  // The reporting day rides on the tail of BOTH cycle-key shapes, which is how the day's rows are found.
      return newestFirst(tenantId).filter((x) => x.cycle_key.endsWith(day)).slice(0, limit).map((x) => ({ id: x.id, progress: x.progress ?? {} })); },
  }; return { repo, rows }; }
function freshRepo(): RR.ResearchRun[] { const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo); return rows; }
/** A seeded paused (unleased) today-row a fresh claim can reclaim, plus its rows. */
function withRun(o: Partial<RR.ResearchRun> = {}): RR.ResearchRun[] { const rows = freshRepo(); rows.push(mk(o)); return rows; }
/** Work is owed unless a test says otherwise, so every pre-Phase-5 pin drives the same phases it always did. */
const NO_CHECKS = { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 };
const SOMETHING_DUE: DueWork = { due: ["daily_observations"], readable: true, checks: NO_CHECKS, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null };
const NOTHING_DUE: DueWork = { ...SOMETHING_DUE, due: [] }, NO_READING = { attempted: 0, settled: 0, refused: 0, read: 0, outcomes: {} };
/** Benign no-op steps; a phase-truth test overrides the ONE step under test. */
const BENIGN: ResearchCycleSteps = {
  dueWork: async () => SOMETHING_DUE, evidenceVersion: async () => null, reconcileCases: async () => {},
  acquireEvidence: async () => ({ acquired: false, detail: "no acquisition in this fixture" }), collectBought: async () => ({ pending: 0, ready: 0 }),
  replenishReady: async () => null, researchOwed: async () => [], // the inventory step own pins drive a spy; a null is unreadable, so nothing is stamped, and no stored research row is owed a reading unless a test says so
  dayStanding: async () => NO_CHECKS, // nothing owed and nothing landed: settled == intended, so the AI phase advances
  strandedToday: async () => [], // no account was left short of its day, so the dispatch opens no recovery pass
  refreshSources: async () => ({ attempted: 0, succeeded: [], failures: [] }),
  backfillChunk: async () => ({ kind: "no_work" }), crawlPages: async () => 0, investigationFocus: async () => null,
  funnelUnit: async () => ({ status: "done", cursor: null, progress: {} }), // evidence phases no-op in these lease/truth tests
  currentBasis: async () => "basis_test", publishSurface: async () => {}, surfaceStale: async () => false, factCheck: async () => ({ status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 0 }), // the account basis the funnel scopes to
  analyzeAnswers: async () => NO_READING, // no new answers to read back in these lease/truth tests
  verifyShipments: async () => 0, measureShipments: async () => 0, // nothing marked implemented is waiting on a live check or a reading in these tests
};
/** Healthy logging stub: each step logs its name so phase ordering is observable. */
const healthySteps = (log: string[]): Partial<ResearchCycleSteps> => ({
  refreshSources: async () => (log.push("refresh"), { attempted: 2, succeeded: ["google_gsc", "google_ga4"], failures: [] }), backfillChunk: async () => (log.push("backfill"), { kind: "advanced", daysPulled: 30 }),
  crawlPages: async () => (log.push("crawl"), 0), publishSurface: async () => void log.push("publish"), surfaceStale: async () => false }); const run = (steps: Partial<ResearchCycleSteps>, deadlineMs?: number) =>
  runResearchCycle(T, { now: () => new Date(NOW), steps: { ...BENIGN, ...steps }, ...(deadlineMs === undefined ? {} : { deadlineMs }) });
beforeEach(() => { NOW = 1_700_000_000_000; RR.setResearchRunRepoForTests(null); ACCOUNT_STATUS.clear(); PAUSED.clear(); DB.missing.clear(); DB.ignoresWrites.clear(); DB.readThrows = false; DB.fleet = []; DB.served = []; DB.fleetError = null; REBUILT.length = 0; installAccountRepo(); });  // ACCOUNT_STATUS is cleared so every tenant defaults to active.
describe("research-run claim: one open run per account across all dates", () => { it("resumes the account's one unfinished run first: yesterday's paused run is reclaimed by the same id with phase and cursor untouched, a later-day visit reuses it, and no second row is ever created", async () => {
    const rows = freshRepo(); const cursor = { phase: "gsc_backfill_chunk", attemptKey: "k" }; rows.push(mk({ id: "seed", status: "paused", current_phase: "gsc_backfill_chunk", phase_cursor: cursor, cycle_key: ckey(T, NOW - DAY), started_at: iso(NOW - DAY) }));
    const first = await RR.claimRun(T, "o1"); // resumed, not a new run: phase and cursor untouched, paused flips to running
    expect([first?.id, first?.current_phase, first?.phase_cursor, first?.status]).toEqual(["seed", "gsc_backfill_chunk", cursor, "running"]); NOW += 2 * DAY; // two UTC days later, o1's lease long dead
    expect([(await RR.claimRun(T, "o2"))?.id, rows.length]).toEqual(["seed", 1]); }); // reuses the one open run; no current-day row was ever created
  it("lets an older run's lease state govern the claim: a live foreign lease blocks a new run, an expired one is reclaimed on the same row", async () => {
    const rows = freshRepo(); rows.push(mk({ id: "seed", status: "running", lease_owner: "other", lease_expires_at: iso(NOW + LEASE), started_at: iso(NOW - DAY) })); expect([await RR.claimRun(T, "me"), rows.length]).toEqual([null, 1]); // live foreign lease blocks a second run
    rows[0]!.lease_expires_at = iso(NOW - 1); // the lease expires
    expect([(await RR.claimRun(T, "me"))?.id, rows.length]).toEqual(["seed", 1]); }); // expired lease reclaimed on the same row
  it("keeps accounts independent, blocks a redundant same-day pass after completion, and opens a fresh run only on a later day", async () => {
    const rows = freshRepo(); const a = await RR.claimRun(T, "o1"), b = await RR.claimRun(U, "o2"); expect([a!.id === b!.id, rows.length]).toEqual([false, 2]); // one account's open run never blocks another
    await RR.finishRun(T, a!.id, "o1", "completed"); // T completes today
    expect(await RR.claimRun(T, "o3")).toBeNull(); // no redundant same-UTC-day pass
    NOW += DAY; const next = await RR.claimRun(T, "o4"); // a later eligible day
    expect([next == null, next!.id === a!.id]).toEqual([false, false]); }); // a genuinely new run once none is open
}); describe("research-run pre-activation gate (Slice 5)", () => {
  it("a pending account runs no research at the runtime level: the seeded run is never claimed, no lease is taken, and no new run is created", async () => {
    const rows = withRun(); setAccountStatus(T, "pending_onboarding"); await run(BENIGN); // a claimable paused today-row for T
    expect([rows[0]!.status, rows[0]!.lease_owner, rows.length]).toEqual(["paused", null, 1]); }); // untouched, unleased, and no second run opened
  it("the claim model returns null for a non-active tenant, mirroring the database tenant-active guard", async () => {
    freshRepo(); setAccountStatus(T, "pending_onboarding"); expect(await RR.claimRun(T, "o1")).toBeNull(); }); // nothing claimed or created before activation
}); describe("research-run database-time lease guards", () => {
  it("guards every mutation at database time: foreign and expired owners cannot advance / renew / finish, a live owner can, and a completed row rejects mutation", async () => {
    const rows = withRun({ status: "running", lease_owner: "o1", lease_expires_at: iso(NOW + LEASE) }); const id = rows[0]!.id; expect([await RR.advancePhase(T, id, "intruder", { phase: "done" }), await RR.renewLease(T, id, "intruder", { phase: "refresh_sources" }), await RR.finishRun(T, id, "intruder", "completed")]).toEqual([false, false, false]); expect(await RR.renewLease(T, id, "o1", { phase: "refresh_sources", attemptKey: "k" })).toBe(true); expect([rows[0]!.lease_owner, rows[0]!.phase_cursor]).toEqual(["o1", { phase: "refresh_sources", attemptKey: "k" }]);
    NOW += LEASE + 1; // the owner's lease is now dead
    expect([await RR.advancePhase(T, id, "o1", { phase: "done" }), await RR.finishRun(T, id, "o1", "completed")]).toEqual([false, false]); NOW -= LEASE + 1; await RR.finishRun(T, id, "o1", "completed"); // a completed row rejects every mutation
    expect([await RR.advancePhase(T, id, "o1", { phase: "refresh_sources" }), await RR.finishRun(T, id, "o1", "paused")]).toEqual([false, false]); }); });
describe("research-run phase truth", () => { it("counts only synced sources as refreshed, and a connector that would not sync records its debt on the pass receipt the surfaces read while the drive carries on and publishes carrying that sentence", async () => {
    // THE FIRST PHASE MAY NOT END THE DAY (live, three of four drives on 2026-09-04). A partial analytics write paused the pass here, and every phase behind it, including the walk that finishes the operator's work, was unreachable for the rest of that drive.
    const rows = withRun(); await run({ ...BENIGN, surfaceStale: async () => true, refreshSources: async () => ({ attempted: 3, succeeded: ["google_gsc", "clarity"], failures: [{ provider: "google_ga4", detail: "429 quota" }] }) }); expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error]).toEqual(["completed", "done", null]); // the drive ran to the end; the source keeps its stale stamp, so due-work owes the refresh again
    expect([rows[0]!.progress.refreshedProviders, rows[0]!.progress.sourcesRefreshed, rows[0]!.progress.sourcesStale, rows[0]!.progress.surfacePublished], "the surface IS published on one stale connector, and the sentence that says so rides the same object the count does").toEqual([["google_gsc", "clarity"], 2, "1 of 3 connected sources could not be refreshed, so their figures are as old as their last good sync. The next pass tries them again.", true]); }); it("treats zero stale sources as a healthy no-op and completes when every phase succeeds or no-ops", async () => {
    const rows = withRun(); await run({ ...BENIGN, surfaceStale: async () => true }); // nothing refreshed, but the saved surface is stale
    expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error, rows[0]!.progress.surfacePublished]).toEqual(["completed", "done", null, true]); }); it("pauses at the phase that throws, never marks it published, and never completes (backfill chunk, then publish build)", async () => {
    const backfill = withRun({ current_phase: "gsc_backfill_chunk" }); await run({ ...BENIGN, backfillChunk: async () => { throw new Error("gsc backfill chunk did not advance: 429"); } }); expect([backfill[0]!.status, backfill[0]!.current_phase, backfill[0]!.last_error?.phase, backfill[0]!.progress.surfacePublished]).toEqual(["paused", "gsc_backfill_chunk", "gsc_backfill_chunk", undefined]); // same window retries next visit, and publish was never reached
    const publish = withRun({ current_phase: "publish_surface" }); // fresh repo + seed
    await run({ ...BENIGN, surfaceStale: async () => true, publishSurface: async () => { throw new Error("surface build failed"); } }); expect([publish[0]!.status, publish[0]!.current_phase, publish[0]!.progress.surfacePublished === true, publish[0]!.completed_at]).toEqual(["paused", "publish_surface", false, null]); }); });
describe("the canonical run order is the RUNTIME order", () => { it("walks fact_check ahead of every paid phase, so a type-union edit alone can never move it", async () => {
    const { nextPhase } = await import("@/domains/runtime/research-run"); const walked: string[] = []; let p = "refresh_sources" as Parameters<typeof nextPhase>[0];
    for (let i = 0; i < 12 && p !== "done"; i += 1) { walked.push(p); p = nextPhase(p); }
    expect(walked).toEqual(["refresh_sources", "gsc_backfill_chunk", "crawl_pages", "fact_check", "keyword_discovery", "prompt_observations", "serp_analysis", "winning_pages", "publish_surface"]); for (const paid of ["keyword_discovery", "prompt_observations", "serp_analysis", "winning_pages"]) expect(walked.indexOf("fact_check")).toBeLessThan(walked.indexOf(paid)); });
  /** AND THE ORDER INSIDE THE PHASE, which is where the day was actually lost (live 2026-09-04). The units ran first, took their own box, and the walk was left under its floor on every one of twelve consecutive ticks: the run sat 7.9 hours in fact_check, banked about one claim a tick, recorded no walk at all and paused each time on "no room to check the finished-change stock". The walk now runs on a runway that reserves the units' floor, so a checker that never ends cannot take the drive, and the phase behind it is left rather than re-entered. */
  it("gives the walk its turn ahead of the units, records it, opens the highest-ranked owed source page first, stamps the release a transition changed, and leaves the phase behind instead of parking on it again", async () => {
    const day = ckey(T, NOW).slice(-10), need = (url: string, rank: number) => ({ key: url, kind: "factual_source" as const, query: `q${rank}`, url, rank, reasonCode: "no_fact", reason: "owed", workKey: `${url}::wc3::e1`, boughtOn: day }), owed = [need("/low", 9), need("/top", 2)];
    const rows = withRun({ current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: owed } }); const order: string[] = [], opened: (string | null | undefined)[] = []; let t = NOW; SURF.length = 0;
    await runResearchCycle(T, { now: () => new Date(t), deadlineMs: 260_000, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
      replenishReady: async () => (order.push("walk"), { ready: 1, deficit: 4, persisted: 1, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: owed }),
      factCheck: async (_id, _b, _r, first) => (order.push("facts"), opened.push(first), t += 265_000, { status: "advanced" as const, banked: 1, bankedPages: ["/top"], pagesComplete: 0 }) } });
    expect([order, opened, rows.at(-1)!.current_phase, rows.at(-1)!.status, !!rows.at(-1)!.progress?.replenish, SURF], "the walk runs FIRST and is recorded on the row, the checker opens the top-RANKED owed page rather than the first one listed, a checker that outlives the whole drive leaves the phase behind it rather than parking on it a thirteenth time, and the walk's own store transition age-stamps the saved release so the next visit rebuilds it at zero dollars").toEqual([["walk", "facts"], ["/top"], "keyword_discovery", "paused", true, [T]]); });
  /** AND THE HOLD IS DROPPED AGAINST THE BOX THE WALK NEEDS TO BEGIN A JOB, not against one call (measured on four consecutive unattended drives, 2026-09-05). The walk's own free half runs before its first funded job is considered (the snapshot, every $0 producer, the whole-family body read and the re-read of every stored row: 63.9 s on a 227-page account) and the walk stops starting 40 s before its box, so a box under 110 s begins nothing whatever it funds. Read against one call, the 85-second hold turned a 160-second room into a 75-second box, and the drive funded 38 jobs and began none of them, four passes running. */
  it.each([T, U])("gives %s's walk a box it can begin a job in before it holds anything back for the units, and a box that can begin nothing funds nothing and says so", async (t) => {
    const boxes: Array<{ stopBy: number; noRoom: boolean }> = [], drive = async (deadlineMs: number): Promise<void> => { const rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] } } }));
      await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
        replenishReady: async (_i, _n, seen, stopBy) => (boxes.push({ stopBy: (stopBy ?? 0) - NOW, noRoom: seen?.noRoom === true }), null) } }); };
    await drive(160_000); await drive(90_000);
    expect(boxes, "a 160-second room hands the walk 120 seconds to start work in, which covers the free half it runs before its first funded job and one call after it; under a floor of one call the same room handed it 35 and every funded job was filed unstarted. A 90-second room still runs the walk, because its free half is what promotes and demotes stored rows, and tells it to fund NOTHING rather than select a manifest it can begin none of").toEqual([{ stopBy: 120_000, noRoom: false }, { stopBy: 50_000, noRoom: true }]); }); });
  /** A WALK ITS OWN BOX CUT OFF STILL HANDS BACK WHAT IT FILED (live 13:00Z drive on production, 2026-09-05). The drive races the walk against a timer as a backstop; the timer won while a whole-page rewrite was still running, the promise was abandoned, and everything the walk had filed went with it: the day's memory kept the previous walk's keys, the waiting list was not updated, the receipts on the run row were the 12:30Z walk's, and seventeen provider calls worth 0.181417 USD were remembered by nothing, so the next drive funded the same three jobs in the same order and lost them again. */
  it.each([T, U])("keeps every receipt %s's walk had filed when the drive's own box cut it off, remembers the job that was still running with the calls it made, and still checks no stock and buys no evidence in its place", async (t) => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: [{ key: "/owed", kind: "factual_source" as const, query: "owed reading", url: "/owed", rank: 1, reasonCode: "acquire_factual_source", reason: "owed", workKey: "wk-owed" }] } }));
    const filed = { ready: 0, deficit: 5, persisted: 2, satisfied: false, reason: "retryable_blocked" as const, jobs: { "wk-begun": { calls: 1, last: "retryable_blocked", settled: false } }, waiting: ["wk-next"],
      outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 1, unreached: 1, stuck: [], preparedMs: 54_503, receipts: [{ key: "/rewrite", workKey: "wk-begun", outcome: "retryable_blocked", providerCalls: 17, costUsd: 0.181417, ms: 108_000 }, { key: "/next", workKey: "wk-next", outcome: "not_reached", providerCalls: 0, costUsd: 0, ms: 0 }] } };
    let bought = 0; vi.useFakeTimers();
    const drive = runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
      acquireEvidence: async () => (bought += 1, { acquired: true, detail: "the reading landed" }),
      replenishReady: async (_i, _n, seen) => { seen?.filed?.(() => filed); return await new Promise<null>(() => {}); } } });
    await vi.advanceTimersByTimeAsync(400_000); await drive; vi.useRealTimers();
    const row = rows.at(-1)!, rep = row.progress?.replenish;
    expect([rep?.jobs, rep?.waiting, (rep?.outcomes?.receipts ?? []).length, ((rep?.outcomes?.receipts ?? []) as { providerCalls?: number }[]).map((r) => r.providerCalls), rep?.outcomes?.preparedMs, bought, row.status, row.current_phase],
      "the day's memory, the waiting list and every receipt the walk filed survive the box that cut it off, the job that was still running is remembered with the seventeen calls it really made so the next drive demotes it instead of funding it again, and the drive still pauses where it stands, having bought only the reading the head of the order was waiting on before the walk and nothing at all after the box ended").toEqual([
      filed.jobs, ["wk-next"], 2, [17, 0], 54_503, 1, "paused", "fact_check"]); });
  /** AND A READING BOUGHT BEFORE THE WALK IS ONE THE HEAD OF THE ORDER IS WAITING ON, NEVER THE WHOLE OWED LIST (live run tenant-iranopedia:p2:2026-09-05, read 10:09Z). The drive bought up to eight owed readings before the walk, in rank order but with no reference to what the walk was about to do: on that account the best unserved need was ranked 15th and the next six 145th to 158th of 171, while the third job on the manifest already had its source on file and was never begun. The head rule takes a need only while the ranking above it is served, so a gap at the head sends the drive straight to the walk; and the walk's own floor is reserved before a penny is spent, where the old bound stopped at 85 seconds, half of what the walk needs to begin its first job, and checked 90 seconds of elapsed time before a purchase allowed 60 more. */
  it.each([T, U])("buys a reading ahead of %s's walk only where the head of the order is waiting on one, and never out of the box the walk needs to begin a job", async (t) => {
    const day = ckey(t, NOW).slice(-10), need = (key: string, rank: number, servedToday = false) => ({ key, kind: "factual_source" as const, query: `q${key}`, url: key, rank, reasonCode: "acquire_factual_source", reason: "owed", workKey: `${key}::wk`, ...(servedToday ? { boughtOn: day } : {}) });
    const drive = async (deadlineMs: number, owed: readonly ReturnType<typeof need>[]): Promise<{ bought: string[]; deferred: string[]; stopBy: number; noRoom: boolean }> => {
      const rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: [...owed] } }));
      const bought: string[] = []; let walk = { stopBy: 0, noRoom: false };
      await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
        acquireEvidence: async (_i, n) => (bought.push(String(n.query)), { acquired: true, detail: "the reading landed" }),
        replenishReady: async (_i, _n, seen, stopBy) => (walk = { stopBy: (stopBy ?? 0) - NOW, noRoom: seen?.noRoom === true }, null) } });
      return { bought, deferred: (rows.at(-1)!.progress?.acquisitions ?? []).filter((a) => a.outcome === "deferred").map((a) => `${a.key}: ${a.detail.split(",")[0]}`), ...walk }; };
    expect([await drive(200_000, [need("/one", 1, true), need("/two", 15), need("/three", 145)]), await drive(260_000, [need("/a", 1), need("/b", 2), need("/c", 9)]), await drive(125_000, [need("/a", 1)])],
      "a head already served this morning and a gap behind it means nothing is bought and the walk takes the whole box; a head that really is waiting on two readings gets both and the ninth-ranked need waits; and a reading is never started on time the walk needs to begin, so a 125-second box begins its work and the reading takes the next drive. Every reading this drive decided against says so on the row with its own reason, because a need that stops appearing on the receipt is a silence").toEqual([
      { bought: [], deferred: ["/two: the work ranked above this reading needs no reading at all"], stopBy: 75_000, noRoom: false },
      { bought: ["q/a", "q/b"], deferred: ["/c: the work ranked above this reading needs no reading at all"], stopBy: 135_000, noRoom: false },
      { bought: [], deferred: ["/a: what is left of this drive is the box the walk needs to begin its first job"], stopBy: 85_000, noRoom: false }]); });
  /** AND THE WALK'S FLOOR IS THIS ACCOUNT'S OWN MEASUREMENT, NOT A CONSTANT WITH A MARGIN (round-six reviewer, 2026-09-05). A padded floor is a cliff at both ends: at 189 to 195 seconds of room the units lost their whole 85-second reservation to buy the walk time it did not need, and between 104 and 110 seconds a walk that could just begin one job funded nothing instead. Both slivers are the same six seconds of padding, so the last walk that actually reached its funded work reports how long its free half took and the next drive budgets on that. */
  it.each([T, U])("takes %s's walk floor from the last walk's own measured preparation, so the units keep their reservation in the band a padded constant took it away in, and a slower account funds nothing rather than a manifest it cannot begin", async (t) => {
    const drive = async (preparedMs?: number): Promise<{ stopBy: number; noRoom: boolean }> => {
      const rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] },
        ...(preparedMs == null ? {} : { replenish: { day: ckey(t, NOW).slice(-10), jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [], preparedMs } } }) } }));
      let walk = { stopBy: 0, noRoom: false };
      await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 190_000, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
        replenishReady: async (_i, _n, seen, stopBy) => (walk = { stopBy: (stopBy ?? 0) - NOW, noRoom: seen?.noRoom === true }, null) } });
      return walk; };
    expect([await drive(63_900), await drive(), await drive(150_000)],
      "on a measured 63.9-second free half the walk begins its work with 65 seconds to start in AND the units keep their 85; with nothing measured yet the constant stands and the walk takes the whole 190; and on an account whose free half really costs 150 seconds the same room funds nothing and says so").toEqual([
      { stopBy: 65_000, noRoom: false }, { stopBy: 150_000, noRoom: false }, { stopBy: 150_000, noRoom: true }]);
    const rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] },
      replenish: { day: ckey(t, NOW).slice(-10), jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [], preparedMs: 63_900 } } } }));
    await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 190_000, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
      replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [] } }) } });
    expect(rows.at(-1)!.progress?.replenish?.outcomes?.preparedMs, "a pass that funded nothing measured no walk and reports no preparation, and it may never erase the measurement the next drive budgets on, or the passes the floor exists for would wipe it").toBe(63_900); });
  /** AND THE WALK KEEPS ITS WHOLE RUNWAY IN THE BAND THIS ACCOUNT ACTUALLY RUNS IN (five afternoon drives, 2026-09-05). Holding the units' floor back at every phase that checks the stock first was taken whenever `room - 85,000` cleared the box a walk begins ONE job in, so on rooms of 176,500, 194,297 and 195,400 ms it left the walk 6,884, 24,681 and 25,784 ms of funded time against a per-card latency measured the same afternoon at 13,359 to 72,476 ms, which is under one card. The hold stays where the fact check has always had it, and the phase's own unit earns its turn from a walk the day memory closed early. */
  it.each([T, U])("leaves %s's walk the whole 190-second room at prompt_observations, and still keeps the fact check its units' own floor out of the same room", async (t) => {
    const drive = async (phase: "prompt_observations" | "fact_check", unit: "daily_observations" | "check_page_facts"): Promise<[number, number]> => { const rows = freshRepo(); let at = NOW; const stops: number[] = [], budgets: number[] = [];
      rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: phase, progress: { plan: { units: ["replenish_ready", unit] },
        replenish: { day: ckey(t, NOW).slice(-10), jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [], preparedMs: 44_616 } } } }));
      await runResearchCycle(t, { now: () => new Date(at), deadlineMs: 190_000, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", unit] }),
        replenishReady: async (_i, _n, _seen, stopBy) => { stops.push((stopBy ?? at) - NOW); at = (stopBy ?? at) + 40_000; return { ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [] } }; }, // the walk spends the whole box it was handed, which is what every live drive does
        funnelUnit: async (_p, _u, _c, budgetMs) => (budgets.push(budgetMs), { status: "waiting" as const, cursor: null, progress: {} }),
        factCheck: async (_u, budgetMs) => (budgets.push(budgetMs), { status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 0 }) } });
      return [(stops[0] ?? 0) - 44_616, budgets[0] ?? -1]; };
    expect([await drive("prompt_observations", "daily_observations"), await drive("fact_check", "check_page_facts")],
      "on the 190-second room this account keeps arriving with, the walk at prompt_observations is handed 105,384 ms of funded time past its own measured free half, which is more than the slowest card ever timed on it (72,476 ms), and the unit behind it takes its turn on a drive whose walk closed early rather than out of the walk's own runway, so on a room the walk spends whole it is not started AT ALL rather than handed nothing and asked to answer with it; on the identical room the fact check still holds its units their 85,000 ms floor and leaves its walk 20,384").toEqual([
      [105_384, -1], [20_384, 85_000]]); });
  /** AND THE DRIVE HONOURS ITS OWN DEADLINE, STEP BY STEP (the three afternoon drives of 2026-09-05, read from the runtime log against each drive's own slice). The dispatch hands the first account `min(260,000, budget - 40,000)` and keeps the last forty seconds back to publish what the drive found, and every step after the walk was handed `deadline - now` as a budget rather than asked whether it fitted, while the loop's own deadline check fires once per PHASE and not once per step. At 14:00Z the drive ended 71.4 seconds past its deadline, at 14:30Z 86.3, and at 15:00Z the walk closed 36 seconds INSIDE the slice, the unit and the reading of what was shipped then ran 130 seconds, the pause landed at 294 seconds and the hosting ceiling killed the surface rebuild behind it at 300. A step that cannot be paid for is not started, says so on the row, and keeps its place. */
  it.each([T, U])("ends %s's drive inside its own slice when the walk takes the slice, writing the walk's row and starting no step the deadline cannot pay for", async (t) => {
    const rows = freshRepo(); let at = NOW; const started: string[] = [];
    rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "prompt_observations", progress: { plan: { units: ["replenish_ready", "daily_observations", "verify_and_measure", "publish_surfaces"] },
      replenish: { day: ckey(t, NOW).slice(-10), jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [], preparedMs: 44_616 } } } }));
    await runResearchCycle(t, { now: () => new Date(at), deadlineMs: 200_000, steps: { ...BENIGN, ...healthySteps([]),
      dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "daily_observations", "verify_and_measure", "publish_surfaces"] as DueWork["due"] }),
      replenishReady: async (_i, _n, _seen, stopBy) => { started.push("walk"); at = (stopBy ?? at) + 40_000; return { ready: 0, deficit: 5, persisted: 1, satisfied: false, reason: "retryable_blocked" as const, jobs: { "wk-a": { calls: 3, last: "retryable_blocked", settled: false } }, waiting: ["wk-b"], outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 1, stuck: [], receipts: [{ key: "/a", outcome: "retryable_blocked", providerCalls: 3 }] } }; }, // the walk spends its whole box, which is what every live drive on this account does
      funnelUnit: async () => (started.push("unit"), { status: "waiting" as const, cursor: null, progress: {} }),
      verifyShipments: async () => (started.push("verify"), 0), measureShipments: async () => (started.push("measure"), 0), publishSurface: async () => void started.push("publish") } });
    const row = rows.at(-1)!;
    expect([started, at - NOW, row.status, row.current_phase, (row.progress?.replenish?.outcomes?.receipts ?? []).length, row.progress?.replenish?.waiting, row.progress?.state?.blocker],
      "the walk takes the whole 200-second slice and its row is written with the receipts and the waiting list it earned; the research step behind it needs the forty seconds this file stops starting anything at and has none, so it is NOT started, the phase is left exactly where it stands for the next drive, and the row says in the operator's own words what was left undone and when it runs").toEqual([
      ["walk"], 200_000, "paused", "prompt_observations", 1, ["wk-b"], "The next research step needs 40 seconds and this drive had 0 left, so nothing was started for it. The next pass runs it first."]); });
  /** AND A PHASE WHOSE OWN STEP CANNOT BE PAID FOR ON A SECOND CONSECUTIVE DRIVE YIELDS TO THE REST OF THE DAY (round-eleven reviewer, 2026-09-05, on this account's own measured leftovers). The floor above is exactly right at its boundary, and the walk's construction puts this account on the wrong side of it every drive: the hold is 0 at every phase but the fact check, so the walk's box IS the room and ends at the deadline, it stops starting cards forty seconds before that, and the leftover it hands back is therefore always under the forty seconds the guard asks for. The five afternoon drives of 2026-09-05 left 0, 16.6, 18.6, 36.0 and 0 seconds, six of six, and the sixth is not luck. Pausing and nothing else parks the run at one phase for ever: p2 sat at prompt_observations from 09:03Z to 11:34Z and p3 sits at the fact check. So the drive that could not pay is counted on the row, and the second one leaves the phase through the door the waiting lane already uses. */
  it.each([T, U])("leaves %s's phase behind on the second drive its own step could not be paid for, so the run moves though every slice goes to the walk, and the row says what was not started and when it runs", async (t) => {
    const rows = freshRepo(); const started: string[] = []; let at = NOW;
    rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "prompt_observations", progress: { plan: { units: ["replenish_ready", "daily_observations", "plan_cases"] },
      replenish: { day: ckey(t, NOW).slice(-10), jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [], preparedMs: 44_616 } } } }));
    const drive = async (leftoverMs: number): Promise<{ phase: string; status: string; waited: unknown; blocker: string | null | undefined; endedAt: number }> => { at = NOW;
      await runResearchCycle(t, { now: () => new Date(at), deadlineMs: 200_000, steps: { ...BENIGN, ...healthySteps([]),
        dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "daily_observations", "plan_cases"] as DueWork["due"] }),
        replenishReady: async () => { started.push("walk"); at = NOW + 200_000 - leftoverMs; return { ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 1, stuck: [] } }; }, // the walk hands back the leftover this account measures, which is all a box that ends at the deadline can ever leave behind it
        funnelUnit: async () => (started.push("unit"), { status: "waiting" as const, cursor: null, progress: {} }) } });
      const row = rows.at(-1)!; return { phase: row.current_phase, status: row.status, waited: row.progress?.waited, blocker: row.progress?.state?.blocker, endedAt: at - NOW }; };
    expect([await drive(36_000), await drive(18_600), started],
      "the first drive cannot pay for this phase's own step, counts that on the row and pauses exactly where it stands, which is the same one drive of grace the provider lane is given; the second drive finds the same phase unpayable again and LEAVES it, so serp_analysis is reached on a drive whose walk took the whole slice, the lane behind it is no longer parked for ever behind a step no drive can start, and both drives end inside their own 200-second slice having started nothing they could not pay for").toEqual([
      { phase: "prompt_observations", status: "paused", waited: { phase: "prompt_observations", drives: 1 }, blocker: "The next research step needs 40 seconds and this drive had 36 left, so nothing was started for it. The next pass runs it first.", endedAt: 164_000 },
      { phase: "serp_analysis", status: "paused", waited: { phase: "serp_analysis", drives: 1 }, blocker: "The next research step needs 40 seconds and this drive had 19 left, so nothing was started for it. The next pass runs it first.", endedAt: 181_400 },
      ["walk", "walk"]]); });
  /** AND THE ANSWER READ-BACK AND THE WALK SHARE ONE SLICE BY RULE (RV10 residual 1, measured 2026-09-05). The read-back runs AHEAD of the walk out of the same 200-second slice and was bounded by nothing but the slice itself: on the 14:30Z drive it read 27 answers in 72 seconds and handed the walk 128 seconds; on the 15:00Z drive it read 3 in 19. It runs first because the buying lane behind it is blocked while answers already paid for sit unread, so it is bounded by what is genuinely spare over the walk's own measured floor and the reserve the phases behind it bank, exactly as the owed readings ahead of the walk already are. This account's drives arrive with 123,650 to 195,400 ms, and at the bottom of that band an unbounded read-back leaves the walk under the box it needs to begin one job. */
  it.each([T, U])("hands %s's read-back only what is spare over the walk's own floor, so the walk keeps its funded window across the whole 123,650 to 195,400 ms band", async (t) => {
    const drive = async (deadlineMs: number): Promise<{ readBudget: number | null; walkBox: number; noRoom: boolean; analyzed: number | undefined }> => {
      const rows = freshRepo(); let at = NOW, readBudget: number | null = null, walkBox = -1, noRoom = false;
      rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "prompt_observations", progress: { plan: { units: ["replenish_ready", "analyze_answers", "daily_observations"] },
        replenish: { day: ckey(t, NOW).slice(-10), jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [], preparedMs: 44_616 } } } }));
      await runResearchCycle(t, { now: () => new Date(at), deadlineMs, steps: { ...BENIGN, ...healthySteps([]),
        dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "analyze_answers", "daily_observations"] as DueWork["due"] }),
        analyzeAnswers: async (_i, _d, budgetMs) => (readBudget = budgetMs, at += 72_000, { attempted: 27, settled: 27, refused: 0, read: 27, outcomes: {} }), // the 14:30Z reading, to the second
        replenishReady: async (_i, _n, seen, stopBy) => (walkBox = (stopBy ?? at) - at + 40_000, noRoom = seen?.noRoom === true, null),
        funnelUnit: async () => ({ status: "waiting" as const, cursor: null, progress: {} }) } });
      return { readBudget, walkBox, noRoom, analyzed: rows.at(-1)!.progress?.funnel?.answersAnalyzed }; };
    expect([await drive(195_400), await drive(123_650)],
      "at the top of the band the reading is handed 110,400 ms rather than the whole slice, the 27 answers are read and counted on the row, and the walk still opens with 123,400 ms; at the bottom the reading is not started at all, because what is spare there is under the ninety seconds a reading slice needs, and the walk keeps its whole 123,650 ms and a box it can begin work in. Unbounded, that same reading leaves the walk 51,650 ms, which is under the 85,000 it needs to begin one job, so the walk funds nothing at all").toEqual([
      { readBudget: 110_400, walkBox: 123_400, noRoom: false, analyzed: 27 }, { readBudget: null, walkBox: 123_650, noRoom: false, analyzed: undefined }]); });
  /** AND EVERY OWED READING RE-PROVES THE LEASE BEFORE IT SPENDS (R9b, 2026-09-05). A line comment added beside this loop swallowed the `renewLease` call behind it and nothing in the suite noticed, because no promise had ever pinned it: eight owed readings at ninety seconds each run 720 seconds against a 280-second lease, so the second and third would have been bought, and their receipts written, on a lease another instance already owns. */
  it.each([T, U])("stops %s's drive at the first owed reading whose lease no longer holds, so nothing is bought on a dead lease and every reading re-proves it", async (t) => {
    const owed = [1, 2, 3].map((n) => ({ key: `/p${n}`, kind: "factual_source" as const, query: `q${n}`, url: `/p${n}`, rank: n, reasonCode: "acquire_factual_source", reason: "owed", workKey: `/p${n}::wk` }));
    const drive = async (diesAfter: number): Promise<{ bought: number; status: string }> => {
      const { repo, rows } = memRepo(); let live = true; RR.setResearchRunRepoForTests({ ...repo, renew: async (i) => live && await repo.renew(i) });
      rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: [...owed] } })); let bought = 0;
      await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 100_000, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
        acquireEvidence: async () => { bought += 1; if (bought >= diesAfter) live = false; return { acquired: false, detail: "the answer is still owed" }; }, // the lease runs out DURING a ninety-second reading, which is the live case
        replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: {}, evidenceOwed: [...owed] as never, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [] } }) } });
      return { bought, status: rows.at(-1)!.status }; };
    expect([await drive(1), await drive(2), await drive(9)],
      "a lease that dies inside the first reading stops the drive before the second is bought, one that dies inside the second stops it before the third, and a lease that holds buys all three: the renewal is asked before EVERY reading and not once for the loop, and a drive that lost its lease writes no pause of its own, because a pause is a claim about a row this instance no longer owns").toEqual([
      { bought: 1, status: "running" }, { bought: 2, status: "running" }, { bought: 3, status: "completed" }]); });
  /** AND A WALK THAT LANDS IN THE LEASE'S OWN TAIL IS TAKEN WHOLE (RV9 residual 1, measured on the 13:30Z drive, 2026-09-05): the box result was logged at 13:33:21.558Z and the walk's own last receipt landed at 13:33:59.630Z, 38 seconds later, with the Ready row it had just written stamped 44 ms after that. What the box hands back is a snapshot of a walk that had not finished. */
  it.each([T, U])("takes %s's whole walk when it lands inside the lease's own tail, and keeps the filed snapshot when it does not", async (t) => {
    const filed = { ready: 0, deficit: 5, persisted: 1, satisfied: false, reason: "retryable_blocked" as const, jobs: { "wk-a": { calls: 1, last: "retryable_blocked", settled: false } }, waiting: ["wk-b"],
      outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 1, unreached: 1, stuck: [], preparedMs: 54_503, receipts: [{ key: "/a", workKey: "wk-a", outcome: "retryable_blocked", providerCalls: 1, costUsd: 0.01, ms: 90_000 }] } };
    const whole = { ...filed, persisted: 2, jobs: { ...filed.jobs, "wk-b": { calls: 2, last: "produced", settled: true } }, waiting: [], outcomes: { ...filed.outcomes, readySaved: 1, receipts: [...filed.outcomes.receipts, { key: "/b", workKey: "wk-b", outcome: "produced", providerCalls: 2, costUsd: 0.02, ms: 30_000 }] } };
    const drive = async (lands: number | null): Promise<RR.ResearchRun> => { const rows = freshRepo();
      rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] } } }));
      vi.useFakeTimers(); const cycle = runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
        replenishReady: async (_i, _n, seen) => { seen?.filed?.(() => filed); return lands == null ? await new Promise<null>(() => {}) : await new Promise((res) => setTimeout(() => res(whole), lands)); } } });
      await vi.advanceTimersByTimeAsync(600_000); await cycle; vi.useRealTimers(); return rows.at(-1)!; };
    const late = await drive(230_000), lost = await drive(null), rep = (r: RR.ResearchRun) => [(r.progress?.replenish?.outcomes?.receipts ?? []).length, r.progress?.replenish?.waiting ?? [], r.progress?.replenish?.outcomes?.readySaved];
    expect([rep(late), rep(lost)],
      "a walk 15 seconds past its box and its grace is still inside the lease the runtime renewed in front of it, so the runtime holds that lease and takes the walk's WHOLE answer, receipts, waiting list and all, instead of a snapshot of a pass that had not finished; a walk that never comes back at all still leaves exactly what round nine already earned, the record it had filed before its first funded job").toEqual([
      [2, [], 1], [1, ["wk-b"], 0]]); });
  /** AND A READING THAT DID NOT LAND IS NOT BOUGHT AGAIN EVERY DRIVE (live run tenant-iranopedia:p2:2026-09-05, read 11:37Z). A purchase that fails stamps nothing on the need, so one page check was bought SIX times on one run row and another NINE times across the day's two runs, every one of them returning the identical sentence "failed, 0 banked; the answer is still owed". A reading is not a failure the moment it does not land: on the same row a results page came back "waiting" and then "done" on the next drive, and a review came back "no reading of these words came back" and then landed. What proves a purchase can teach this day nothing is the ANSWER repeating, so the attempt is stamped with the answer it got and the work identity it got it for, and the third purchase of the same sentence is refused while the day and that identity stand. */
  it.each([T, U])("stops buying %s's reading once it has answered the same thing twice under one work identity, buys it again the moment that identity moves or the day turns, and says on every receipt which attempt it was", async (t) => {
    type Owed = NonNullable<RR.ResearchRunProgress["evidenceOwed"]>[number];
    const need = (work: string): Owed => ({ key: "/rug::body::meaning", kind: "factual_source", query: "rug meaning", url: "/rug", rank: 1, reasonCode: "acquire_factual_source", reason: "owed", workKey: work, missingTopic: "rug meaning" });
    const drive = async (owed: readonly Owed[], detail: string, at = NOW): Promise<{ asked: number; owed: readonly Owed[]; attempts: readonly (number | undefined)[] }> => {
      const rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, at), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: [...owed] } })); let asked = 0;
      await runResearchCycle(t, { now: () => new Date(at), deadlineMs: 260_000, steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "check_page_facts"] }),
        acquireEvidence: async () => (asked += 1, { acquired: false, detail }),
        replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [...owed] as never }) } });
      const row = rows.at(-1)!; return { asked, owed: row.progress?.evidenceOwed ?? [], attempts: (row.progress?.acquisitions ?? []).map((a) => a.attempts) }; };
    const SAME = "fact check of /rug: failed, 0 banked; the answer to \"rug meaning\" is still owed";
    const one = await drive([need("w1")], SAME), two = await drive(one.owed, SAME), three = await drive(two.owed, SAME);
    expect([one.asked, two.asked, three.asked, one.owed[0]?.tried?.count, two.owed[0]?.tried?.count, one.attempts, two.attempts, three.attempts, three.owed[0]?.boughtOn ?? null],
      "the first purchase learns the answer, the second proves it repeats, and the third is refused: the need carries the count and the answer it keeps getting, every receipt says which attempt it was, the door behind the walk stops offering the reading the moment it is spent, and nothing is ever stamped as bought, because it was not").toEqual([1, 1, 0, 1, 2, [1, 1], [2], [], null]);
    expect((await drive(two.owed.map((n) => ({ ...n, workKey: "w2" })), SAME)).asked, "a new capture or a newly banked source gives the work a new identity, and a reading owed by work this day has never tried is bought").toBe(1);
    expect((await drive(two.owed, SAME, NOW + DAY)).asked, "and tomorrow is a new day, whose money has never bought this reading at all").toBe(1);
    const p1 = await drive([need("w1")], "results page: waiting"), p2 = await drive(p1.owed, "results page: the task returned nothing"), p3 = await drive(p2.owed, "results page: done");
    expect([p1.asked, p2.asked, p3.asked, p3.owed[0]?.tried?.count], "and a reading whose ANSWER moves is still telling this drive something: a posted results page reads waiting, then empty, then done, so it is bought on every one of those drives and the count starts over each time the answer changes. The count is about the answer repeating, never about the number of tries").toEqual([1, 1, 1, 1]); });
  /** AND THE DAY'S RUN REACHES ITS SURFACE (live run tenant-iranopedia:p2:2026-09-05, read 11:37Z: opened 08:30:02Z, still at prompt_observations at 11:34:17Z, 11,054 seconds and nineteen posted tasks later, surfacePublished never set). A funnel unit answering `waiting` paused the whole run, so the source check, the verification and the publication behind it were unreachable for three hours and the customer's surface was never rebuilt. The provider gets its drive; the second drive that finds the same phase still waiting leaves it. */
  it.each([T, U])("leaves %s's waiting step behind on the second drive that finds it still waiting, so the day's surface is published rather than held behind one provider, and the lane's own debt is untouched", async (t) => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "prompt_observations", progress: { plan: { units: ["daily_observations", "verify_and_measure", "publish_surfaces"] } } }));
    const steps = { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["daily_observations", "verify_and_measure", "publish_surfaces"] as DueWork["due"] }), surfaceStale: async () => true,
      funnelUnit: async () => ({ status: "waiting" as const, cursor: { pending: 19 }, progress: {} }) }, at = (): { phase: string; status: string; waited: unknown; published: unknown } =>
      ({ phase: rows.at(-1)!.current_phase, status: rows.at(-1)!.status, waited: rows.at(-1)!.progress?.waited, published: rows.at(-1)!.progress?.surfacePublished });
    await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 260_000, steps }); const first = at();
    await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 260_000, steps });
    expect([first, at()], "the first drive hands the provider its time and pauses exactly where it was, counting the wait on the row; the second drive finds the same step still waiting, leaves it, and runs the rest of the day, so the surface is published and the run finishes rather than holding every phase behind one lane").toEqual([
      { phase: "prompt_observations", status: "paused", waited: { phase: "prompt_observations", drives: 1 }, published: undefined },
      { phase: "done", status: "completed", waited: { phase: "prompt_observations", drives: 2 }, published: true }]);
    expect(rows.at(-1)!.progress?.observations ?? null, "and nothing about the lane is written off: it filed no unreadable state, so due-work still owes today's checks and the next pass reopens exactly this phase").toBeNull(); });
  /** AND THE COUNT BELONGS TO THE PHASE, NOT TO THE RUN (round-eight reviewer, 2026-09-05, residual 3). The counter is never cleared, so a run that had already left one waiting phase behind was read as a run that may leave every later one behind at once. It cannot: the count is keyed on the phase, the cycle walks its phases in one direction and never returns to one it has left, so each phase gets exactly ONE drive of the provider's own time inside a run and yields on the next drive that still finds it waiting. THE RULE, IN ONE SENTENCE: one waiting drive per phase per run. */
  it.each([T, U])("gives %s's second waiting phase its own drive of the provider's time rather than leaving it the moment an earlier phase was left, and never pauses a phase it has already left", async (t) => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), current_phase: "prompt_observations", progress: { plan: { units: ["daily_observations", "plan_cases", "verify_and_measure", "publish_surfaces"] } } }));
    const steps = { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["daily_observations", "plan_cases", "verify_and_measure", "publish_surfaces"] as DueWork["due"] }), surfaceStale: async () => true,
      funnelUnit: async () => ({ status: "waiting" as const, cursor: { pending: 19 }, progress: {} }) }, at = (): { phase: string; waited: unknown } => ({ phase: rows.at(-1)!.current_phase, waited: rows.at(-1)!.progress?.waited });
    const seen: { phase: string; waited: unknown }[] = [];
    for (let drive = 0; drive < 3; drive += 1) { await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 260_000, steps }); seen.push(at()); }
    expect(seen, "the first drive is the results-page lane's own time and the run pauses where it stands; the second leaves that lane and hands the NEXT waiting lane its own first drive, counted from one rather than inherited; the third leaves that one too, so every lane is given the provider's time exactly once and no lane is ever asked to pause the run twice").toEqual([
      { phase: "prompt_observations", waited: { phase: "prompt_observations", drives: 1 } },
      { phase: "serp_analysis", waited: { phase: "serp_analysis", drives: 1 } },
      { phase: "done", waited: { phase: "serp_analysis", drives: 2 } }]); });
/** ONE WORKING CONTEXT PER DRIVE, AND THE FUNDED WORK THAT OUTLIVES IT. A drive walks the producer up to ten times and re-read the whole account for every one of them: the snapshot, the rows on file, the two windows, the finished-reading history, the inventory and every $0 producer, byte-identically three times in one measured drive, for 43 seconds a walk out of 260. And the first phase could end the day outright: a partial analytics write paused the pass at refresh_sources and the walk behind it never ran at all. */
describe("one working context per drive, and the funded work that outlives it", () => {
  it.each([T, U])("prepares %s's account once, rebuilds only the part its own writes moved, hands the work it never began to the next walk, and finishes it though the first connector failed", async (t) => {
    const maps: Array<Map<string, unknown> | undefined> = [], prepared: string[] = [], carried: Array<readonly string[]> = [], rows = freshRepo(); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW) })); let owed = [{ key: "/a", kind: "factual_source" as const, query: "q", url: "/a", reasonCode: "no_fact", reason: "owed", workKey: "/a::wk" }];
    const prepare = (shared: Map<string, unknown> | undefined, part: string): void => { const k = `${part}:read`; if (shared?.has(k)) return; shared?.set(k, 1); prepared.push(part); }; // exactly what every preparation does: read once, under the part it belongs to
    await runResearchCycle(t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN, refreshSources: async () => ({ attempted: 1, succeeded: [], failures: [{ provider: "google_ga4", detail: "fetch failed" }] }),
      acquireEvidence: async () => ({ acquired: true, detail: "the reading landed" }), reconcileCases: async (_i, _b, plan) => prepare(plan.shared, "evidence"), factCheck: async (_i, _b, _r, _f, shared) => (prepare(shared, "evidence"), prepare(shared, "learning"), { status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 0 }),
      replenishReady: async (_i, _n, seen) => { maps.push(seen?.shared); carried.push(seen?.waiting ?? []); for (const part of ["evidence", "proposals", "learning"]) prepare(seen?.shared, part);
        const mine = owed; owed = []; return { ready: 1, deficit: 0, persisted: mine.length, satisfied: false, reason: "retryable_blocked" as const, jobs: {}, evidenceOwed: mine, waiting: ["/b::wk"] }; } } }); // the first walk saves a row, which moves the rows on file; the reading behind it moves the evidence
    expect([new Set(maps).size, maps[0] instanceof Map, prepared, carried, rows[0]!.progress.replenish?.waiting, rows[0]!.status, (rows[0]!.progress.sourcesStale ?? "").includes("could not be refreshed")],
      "one map reaches every walk, the fact check and the reconcile; the account is prepared ONCE and only the halves this drive's own writes moved are read again (the rows after a save, the evidence after a landed reading, never the learning neither touched); the work the first walk never began is the second walk's first and stays on the row for the next drive; and a connector that would not sync never costs the drive its walk").toEqual([1, true, ["evidence", "proposals", "learning", "evidence", "proposals"], [[], ["/b::wk"]], ["/b::wk"], "completed", true]); }); });
describe("a fact check that cannot finish withholds that correction, not Beacon", () => { // a pass opened for fact checking AND the growth work
  const held = (failure: string) => ({ ...BENIGN, factCheck: async () => ({ status: "failed" as const, banked: 0, bankedPages: [], pagesComplete: 0, failure, reason: `the source search is ${failure}` }),
    dueWork: async (): Promise<DueWork> => ({ ...SOMETHING_DUE, due: ["check_page_facts", "daily_observations", "plan_cases", "publish_surfaces"] }) });
  it.each(["search_waiting", "source_quality_unresolved"])("keeps the claim owed on %s and still runs the growth phases and publishes", async (failure) => {
    const rows = withRun({ current_phase: "fact_check" }); const ran: string[] = [];
    await run({ ...held(failure), surfaceStale: async () => true, publishSurface: async () => void ran.push("publish"), funnelUnit: async (phase) => (ran.push(phase), { status: "done", cursor: null, progress: {} }) });
    expect([rows[0]!.progress.factCheck?.failure, rows[0]!.progress.factsChecked, rows[0]!.status, rows[0]!.current_phase]).toEqual([failure, 0, "completed", "done"]);
    for (const growth of ["keyword_discovery", "prompt_observations", "serp_analysis", "publish"]) expect(ran).toContain(growth); });
  it("still STOPS the run when the failure means it can no longer safely write", async () => {
    const rows = withRun({ current_phase: "fact_check" }); const touched: string[] = []; await run({ ...held("store_write_failed"), surfaceStale: async () => true, publishSurface: async () => void touched.push("publish") });
    expect([touched, rows[0]!.status, rows[0]!.current_phase, rows[0]!.completed_at, rows[0]!.progress.factCheck?.failure, rows[0]!.last_error?.phase]).toEqual([[], "paused", "fact_check", null, "store_write_failed", "fact_check"]);
    const ok = withRun({ current_phase: "fact_check" }); const published: string[] = []; // a banked claim advances normally
    await run({ ...BENIGN, factCheck: async () => ({ status: "advanced" as const, banked: 1, bankedPages: [], pagesComplete: 0 }), surfaceStale: async () => true, publishSurface: async () => void published.push("publish") });
    expect([ok[0]!.status, ok[0]!.progress.factsChecked, published]).toEqual(["completed", 1, ["publish"]]); }); });
describe("research-run partial-success durability + deduped refreshed providers", () => { it("persists the providers that DID sync, never counts a failed one, and counts a provider exactly once across a failure and a later success", async () => {
    const rows = withRun(); let firstAttempt = true; const steps: Partial<ResearchCycleSteps> = { ...BENIGN, refreshSources: async () => (firstAttempt ? (firstAttempt = false, { attempted: 2, succeeded: ["google_gsc"], failures: [{ provider: "google_ga4", detail: "429" }] }) : { attempted: 2, succeeded: ["google_gsc", "google_ga4"], failures: [] }) };
    await run(steps); // first attempt: gsc synced, ga4 failed, and the day went on anyway
    expect([rows[0]!.status, rows[0]!.progress.refreshedProviders, rows[0]!.progress.sourcesRefreshed]).toEqual(["completed", ["google_gsc"], 1]); // the succeeded source is not stranded, and the count is the unique set of what really synced
    NOW += DAY; await run(steps); // the next day's pass: both synced, and the failed one is counted where it succeeded
    expect([rows[1]!.status, rows[1]!.progress.sourcesRefreshed, rows[1]!.progress.refreshedProviders, rows[1]!.progress.sourcesStale]).toEqual(["completed", 2, ["google_gsc", "google_ga4"], null]);
    const again = withRun({ progress: { refreshedProviders: ["google_gsc"], sourcesStale: "1 of 2 connected sources could not be refreshed, so their figures are as old as their last good sync. The next pass tries them again." } }); await run({ ...BENIGN, refreshSources: async () => ({ attempted: 2, succeeded: ["google_gsc", "google_ga4"], failures: [] }) });
    expect([again[0]!.progress.refreshedProviders, again[0]!.progress.sourcesRefreshed, again[0]!.progress.sourcesStale], "the provider that failed and then succeeded is counted ONCE across the retry, and the debt it left clears with it").toEqual([["google_gsc", "google_ga4"], 2, null]); }); // a debt that cleared leaves no stale claim behind
  it("decodes a legacy numeric-only progress row: projection and resume never crash and the number survives", async () => {
    const rows = withRun({ current_phase: "publish_surface", progress: { sourcesRefreshed: 2 } }); expect((await RR.researchRunStatus(T, new Date(NOW))).counters.sourcesRefreshed).toBe(2); // decodes the bare number
    await run({ ...BENIGN, surfaceStale: async () => false }); expect([rows[0]!.status, rows[0]!.progress.sourcesRefreshed]).toEqual(["completed", 2]); }); // legacy number survives the resume (refresh_sources not re-run)
  /** MEASUREMENT USED TO NEED A VISITOR. dueWork named verify_and_measure and the run only VERIFIED; the engine that turns a verified change into a won or lost verdict fired solely from a Results render, so production sat on sixteen measurable shipments, every one already verified, that no scheduled pass could settle. */
  it("checks and then MEASURES what the operator marked as done before it publishes off it, with nobody opening Results, and only when one is genuinely owed", async () => {
    const order: string[] = []; const steps = (due: DueWork): Partial<ResearchCycleSteps> => ({ dueWork: async () => due, verifyShipments: async () => (order.push("verify"), 1), measureShipments: async () => (order.push("measure"), 16), publishSurface: async () => void order.push("publish"), surfaceStale: async () => true });
    const owed: DueWork = { ...SOMETHING_DUE, due: ["verify_and_measure"] }; withRun({ current_phase: "publish_surface" }); await run(steps(owed)); expect(order).toEqual(["verify", "measure", "publish"]); // verified first because measuring refuses an unverified change, then read, then published off both
    order.length = 0; withRun({ current_phase: "publish_surface" }); await run(steps(SOMETHING_DUE)); // nothing marked implemented is waiting
    expect(order).toEqual(["publish"]); }); // no shipment owed a check, so not one page of the customer's site is read and not one reading is taken
  it("never lets a check or a reading I could not make pause the pass: the surface still publishes", async () => {
    const rows = withRun({ current_phase: "publish_surface" }); await run({ dueWork: async () => ({ ...SOMETHING_DUE, due: ["verify_and_measure"] }), verifyShipments: async () => { throw new Error("your website did not answer"); }, measureShipments: async () => { throw new Error("the ledger did not answer"); }, surfaceStale: async () => true }); expect([rows[0]!.status, rows[0]!.progress.surfacePublished]).toEqual(["completed", true]); });});
/** DUE WORK DECIDES WHETHER A PASS RUNS; IT DECIDES WHAT THE PASS DOES TOO. Once a run opened, the executor traversed the COMPLETE cycle whatever the debt was, so recovery for one stored-answer reading re-ran keyword discovery, results pages, winner reads, a crawl and a publication: four live passes spent about 69 cents on research nobody had asked for. The reason a pass was opened now rides its own row, and every phase outside that reason is skipped BEFORE a lease renewal or a cent. */
describe("research-run: a recovery pass runs what it was opened for", () => {
  const spy = (touched: string[]): Partial<ResearchCycleSteps> => ({
    refreshSources: async () => (touched.push("refresh"), { attempted: 0, succeeded: [], failures: [] }),
    backfillChunk: async () => (touched.push("backfill"), { kind: "no_work" }), crawlPages: async () => (touched.push("crawl"), 0),
    funnelUnit: async (phase) => (touched.push(phase), { status: "done", cursor: null, progress: {} }),
    verifyShipments: async () => (touched.push("verify"), 0), measureShipments: async () => (touched.push("measure"), 0),
    publishSurface: async () => void touched.push("publish"), surfaceStale: async () => true });
  /** A day that already completed a pass, so the next one can only open through the same-day door that carries the reason. */
  const settled = () => { const rows = freshRepo(); rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done", started_at: iso() })); return rows; };
  it("settles a reading debt by READING, and buys no keyword, results page, winner, crawl or publication to do it", async () => {
    const rows = settled(); const touched: string[] = []; let analysed = 0;
    await run({ ...spy(touched), dueWork: async () => ({ ...SOMETHING_DUE, due: ["analyze_answers"] }), analyzeAnswers: async () => (analysed += 1, { attempted: 7, settled: 7, refused: 0, read: 7, outcomes: { settled: 7 } }) }); expect([touched, analysed]).toEqual([[], 1]); // not one phase outside the debt ran, so not one cent of research was spent
    expect([rows[1]!.status, rows[1]!.progress.plan?.units, rows[1]!.progress.funnel?.answersAnalyzed]).toEqual(["completed", ["analyze_answers"], 7]); });
  it("spends a settled reading by harvesting it and deciding again, and buys no results page, winner, crawl or answer to do it", async () => {
    settled(); const touched: string[] = []; await run({ ...spy(touched), dueWork: async () => ({ ...SOMETHING_DUE, due: ["consume_analyses"] }) }); expect(touched).toEqual(["keyword_discovery", "publish"]); }); // the harvest and the re-decide, and not one phase or cent beside them
  it("runs exactly the owed set on a mixed debt, and nothing beside it", async () => { settled(); const touched: string[] = [];
    await run({ ...spy(touched), dueWork: async () => ({ ...SOMETHING_DUE, due: ["crawl_pages", "verify_and_measure"] }) }); expect(touched).toEqual(["crawl", "verify", "measure", "publish"]); });
  it("still walks the whole ordered cycle on the day's first genuine run, which is a recovery of nothing", async () => {
    freshRepo(); const touched: string[] = [];
    await run({ ...spy(touched), dueWork: async () => ({ ...SOMETHING_DUE, due: ["analyze_answers"] }) });
    expect(touched).toEqual(["refresh", "backfill", "crawl", "keyword_discovery", "prompt_observations", "serp_analysis", "winning_pages", "publish"]); });});
describe("research-run idempotency identity", () => {
  it("hands each phase its persisted attempt key: an interrupted retry reuses it, the next phase gets a different one, and no second run opens", async () => {
    const rows = withRun({ id: "seed", started_at: iso(NOW) }); const refreshKeys: string[] = [], backfillKeys: string[] = []; let refreshFails = true;
    const steps: Partial<ResearchCycleSteps> = { ...BENIGN,
      refreshSources: async (_t, _n, key) => (refreshKeys.push(key), refreshFails ? { attempted: 1, succeeded: [], failures: [{ provider: "google_gsc", detail: "boom" }] } : { attempted: 1, succeeded: ["google_gsc"], failures: [] }),
      backfillChunk: async (_t, _n, key) => (backfillKeys.push(key), { kind: "no_work" }) };
    await run({ ...steps, crawlPages: async () => { throw new Error("the crawl could not run"); } }); // first visit: the crawl throws → pause at crawl_pages with the cursor persisted
    expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["paused", "crawl_pages"]); refreshFails = false; await run(steps); // the same day, resumed: the run's own cycle key still seeds it, and the interrupted phase is the one that retries
    expect(rows.length).toBe(1); // no second run opened
    expect([rows[0]!.status, rows[0]!.id]).toEqual(["completed", "seed"]); expect(refreshKeys.length).toBe(1); // a phase already past is never re-run, so it never asks for a second key
    expect(backfillKeys[0]).not.toBe(refreshKeys[0]); expect(refreshKeys[0]).toMatch(/^rr_[0-9a-f]{32}$/); }); // the next phase gets a different key
  /** PHASE 5A. A run may pause at ANY phase, and a paused run that lives past midnight used to keep the one open-run index against TODAY's cycle: the guard that closed a dead day sat on the observation phase alone, so a pass parked at keyword_discovery, serp_analysis, winning_pages, crawl_pages, gsc_backfill or publish_surface could pause its way across the date forever, and today never opened at all. */
  it.each(["keyword_discovery", "serp_analysis", "winning_pages", "crawl_pages", "gsc_backfill_chunk", "publish_surface"] as const)(
    "closes a run stranded past midnight at %s, keeps every piece of evidence it wrote, buys nothing for the dead day, and frees today", async (phase) => {
      const rows = withRun({ current_phase: phase, progress: { sourcesRefreshed: 2, funnel: { answersAnalyzed: 7 } } }); const touched: string[] = [];
      const spy: Partial<ResearchCycleSteps> = { ...BENIGN, refreshSources: async () => (touched.push("refresh"), { attempted: 0, succeeded: [], failures: [] }),
        backfillChunk: async () => (touched.push("backfill"), { kind: "no_work" }), crawlPages: async () => (touched.push("crawl"), 3),
        funnelUnit: async () => (touched.push("unit"), { status: "done", progress: {}, cursor: null }), publishSurface: async () => void touched.push("publish"), currentBasis: async () => "b1" };
      NOW += DAY; await run(spy); // the day the run opened on is gone
      expect([rows[0]!.status, touched]).toEqual(["completed", []]); // closed from that very phase, and not one side effect fired for the dead day
      expect([rows[0]!.progress.sourcesRefreshed, rows[0]!.progress.funnel?.answersAnalyzed]).toEqual([2, 7]); // every number it did write survives
      await run({ ...BENIGN, dueWork: async () => SOMETHING_DUE }); // today may now claim its own cycle
      expect([rows.length, rows[1]?.cycle_key.slice(-10)]).toEqual([2, reportingDay(NOW)]); });});
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
    expect([live.state, live.phaseLabel, live.stepsTotal]).toEqual(["running", "refreshing your connected data", 9]);
    expect([live.counters.aiChecksDone, live.counters.aiChecksIntended, live.cases, live.nextDueAt]) .toEqual([12, 40, { active: 1, parked: 2 }, "2026-08-02T00:00:00.000Z"]); });  // Every number comes off the persisted row, never from a per-render computation.
});
describe("research-run frozen investigation: ONE topic, and the lease the comparison spends under", () => {
  const focusOf = (topicKey: string) => ({ basis: "basis_test", topics: [{ topicKey, query: "haft seen", requirement: "exact_serp" }] });
  const FOCUS = focusOf("inv_haft");
  /** A two-stage winning-pages double over the REAL cycle: stage one persists winners, stage two would SPEND. Every invocation records its phase, the topic it was handed, and how many REAL lease renewals had happened by then, so a spend sits against a countable renewal. */
  function staged(renews: () => number) {
    const seen: Array<[string, string | null, number]> = [], spent: string[] = []; const funnelUnit: ResearchCycleSteps["funnelUnit"] = async (phase, _t, cursor, _b, focus) => {
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
    for (const [phase, progress] of [["serp_analysis", {}], ["winning_pages", { focus: FOCUS }]] as const) { const rows = withRun({ current_phase: phase, progress }); let units = 0, asked = 0;
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
    const steps: Partial<ResearchCycleSteps> = { currentBasis: async () => basis, reconcileCases: async () => void order.push("reconcile"), investigationFocus: async () => (order.push("focus"), FOCUS), funnelUnit: async () => (order.push("unit"), { status: "done", cursor: null, progress: {} }), publishSurface: async () => void order.push("publish"), surfaceStale: async () => true };
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
  it("one empty read never silences a run for the rest of its life", async () => { let asked = 0; const unit: ResearchCycleSteps["funnelUnit"] = async (phase, _t, cursor, _b, _f) =>
      (phase === "winning_pages" && cursor?.stage !== "compare" ? { status: "advanced", cursor: { stage: "compare" }, progress: {} } : { status: "done", cursor: null, progress: {} });
    const cold = withRun({ current_phase: "serp_analysis" });
    const steps: Partial<ResearchCycleSteps> = { investigationFocus: async () => (asked++ === 0 ? null : FOCUS), // the first read comes back cold
      funnelUnit: async (p, t, c, b, f) => (asked === 1 ? { status: "waiting", cursor: null, progress: {} } : unit(p, t, c, b, f)) };
    await run(steps); expect(cold[0]!.progress.focus).toBeUndefined(); // nothing worth freezing, so nothing frozen
    await run(steps); expect(cold[0]!.progress.focus).toEqual(FOCUS); }); // the next visit asks again and the run recovers
});
describe("research-run Today copy", () => {
  const view = (o: Partial<RR.ResearchRunStatusView>): RR.ResearchRunStatusView => ({ state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: 9, counters: {}, updatedAt: null, completedAt: null, pauseReason: null, ...o,});
  const NOON_PT = Date.parse("2026-07-23T19:00:00Z"); // noon Pacific on Jul 23
  it("never says 'current', says how a finished day actually landed in checks, and stays quiet when there is nothing to own", () => {  // EVERY COUNT HERE IS A CHECK, NEVER AN ENGINE: one silent engine across forty questions is forty checks.
    const completed = view({ state: "completed", completedAt: new Date(NOON_PT).toISOString() }); const sameDay = RR.researchStatusLine(completed, new Date(NOON_PT)); const older = RR.researchStatusLine(completed, new Date(NOON_PT + 2 * DAY));
    expect([sameDay, older, `${sameDay} ${older}`.match(/current/i), RR.researchStatusLine(view({ state: "none" }))]).toEqual(["Latest research pass finished today at 12:00 PM.", "Latest research pass finished Jul 23 at 12:00 PM.", null, null]);
    const done = (counters: RR.ResearchRunStatusView["counters"]) => RR.researchStatusLine(view({ state: "completed", completedAt: new Date(NOON_PT).toISOString(), counters }), new Date(NOON_PT));
    expect(done({ aiChecksDone: 140, aiChecksIntended: 140, aiChecksAnswered: 137, aiChecksUnavailable: 2, aiChecksUnsupported: 1 })) .toBe("Latest research pass finished today at 12:00 PM. Today's checks finished: 137 answers, 2 checks came back empty, 1 on an engine that cannot be asked.");
    expect(done({ aiChecksDone: 140, aiChecksIntended: 140, aiChecksAnswered: 139, aiChecksUnavailable: 1 })) .toContain("1 check came back empty."); // one is one check, never one engine
    expect(done({ aiChecksDone: 140, aiChecksIntended: 140, aiChecksAnswered: 140, aiChecksUnavailable: 0, aiChecksUnsupported: 0 })) .toBe("Latest research pass finished today at 12:00 PM."); // every check answered: nothing to own, so nothing said
    expect(done({ aiChecksDone: 96, aiChecksIntended: 140, aiChecksAnswered: 94 })) .toBe("Latest research pass finished today at 12:00 PM."); }); // the day is still open, so the running count carries it
  /** Today printed the COLLECTED count under the words "an answer I analyzed", so a day that bought 140 answers and had read 12 of them closely claimed 140 readings. */
  it("reports answers collected and answers read closely as two separate numbers, and withholds the reading count it does not hold", () => {
    const row = { state: { checksDone: 140, checksTotal: 140, checksAnswers: 140 }, funnel: { answersAnalyzed: 12 } }; const c = RR.projectStatusView(mk({ status: "running", current_phase: "serp_analysis", progress: row }), NOW).counters;
    expect([c.aiChecksAnswered, c.answersReadClosely]).toEqual([140, 12]); // the readback receipt is valid in every phase, and it is never the collected number
    expect(RR.projectStatusView(mk({ status: "running", progress: { state: row.state } }), NOW).counters.answersReadClosely).toBeUndefined(); }); // absent, never a zero I would print as a claim
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
    expect(RR.researchStatusLine(RR.projectStatusView(stuck, NOW))).toBe("Research paused after 4 of 9 steps. I need your confirmed business basics before I can research keywords."); // fact_check now precedes keyword_discovery
    const stale = mk({ ...stuck, current_phase: "serp_analysis" });  // A reason recorded by an already-passed phase never resurrects on the current one.
    expect(RR.researchStatusLine(RR.projectStatusView(stale, NOW))).toBe("Research in progress: reading the results pages for your strongest topics.");});
  /** A SURFACE BUILT ON A STALE CONNECTOR SAYS SO. A connector that would not sync stopped ending the drive on 2026-09-05 and the debt it leaves was written to the pass receipt, where NOTHING read it: every figure in the app could be as old as a broken source and no screen said a word. The projection the connectors page reads carries it now, so the sentence lands where each source's own last-synced time is printed. A debt that cleared leaves nothing behind, because a stale claim outliving its cause is the same defect the other way round. */
  it.each(["tenant-one", "tenant-two"])("carries the stale-source sentence from the pass receipt onto the projection a surface reads, and carries nothing when every source synced [%s]", () => {
    const owed = "1 of 3 connected sources could not be refreshed, so their figures are as old as their last good sync. The next pass tries them again.";
    const stale = RR.projectStatusView(mk({ status: "completed", current_phase: "publish_surface", progress: { sourcesRefreshed: 2, sourcesStale: owed } }), NOW);
    expect([stale.sourcesStale, stale.counters.sourcesRefreshed], "the debt and the count of the sources that DID sync ride the same object, so a surface cannot print one without the other being available to it").toEqual([owed, 2]);
    expect(RR.projectStatusView(mk({ status: "completed", current_phase: "publish_surface", progress: { sourcesRefreshed: 3, sourcesStale: null } }), NOW).sourcesStale, "a healthy pass leaves no claim standing").toBeNull();
    expect(RR.projectStatusView(mk({ status: "running", current_phase: "crawl_pages", progress: {} }), NOW).sourcesStale, "and a pass that has not reached the sources yet claims nothing either way").toBeNull(); });
  it("stops calling a dead process work in progress: a freshly-touched running row reads in progress, one untouched for ten minutes reads interrupted", () => {
    const fresh = mk({ status: "running", current_phase: "serp_analysis", updated_at: iso(NOW - 60_000) }); // a minute since the last real write
    expect(RR.researchStatusLine(RR.projectStatusView(fresh, NOW))).toBe("Research in progress: reading the results pages for your strongest topics.");
    const dead = RR.projectStatusView(mk({ ...fresh, updated_at: iso(NOW - 11 * 60_000) }), NOW);  // The SAME row, untouched past the stale bound: the owner died, and saying so is the honest read.
    expect([dead.state, dead.pauseReason]).toEqual(["paused", "Research stopped part way through. The next daily round picks this back up."]);
    expect(RR.researchStatusLine(dead)).toBe("Research paused after 6 of 9 steps. Research stopped part way through. The next daily round picks this back up.");
    expect(RR.projectStatusView(mk({ ...fresh, lease_owner: "o", lease_expires_at: iso(NOW - LEASE) }), NOW)).toEqual(RR.projectStatusView(fresh, NOW)); });  // It reads off updated_at alone, so a lease that lived or died still moves nothing: no flicker.
  it("says whether research is alive at all: what the last pass produced, a day that owed nothing, and a silence with the press that ends it", () => {
    const at = new Date(NOON_PT).toISOString(), seen = (o: Partial<RR.ResearchRun>, ms = NOON_PT + 3_600_000) => RR.projectStatusView(mk({ status: "completed", updated_at: at, completed_at: at, ...o }), ms).liveness;
    expect([seen({ progress: { funnel: { answersAnalyzed: 34 } } }), seen({}), seen({}, NOON_PT + 3 * DAY), RR.projectStatusView(null, NOON_PT).liveness]).toEqual([{ state: "productive", line: "Read 34 new answers closely today at 12:00 PM." }, { state: "quiet", line: "Checked today at 12:00 PM. Nothing new was owed." }, { state: "silent", line: "No research has run since Thursday. Open Today and press Update data." }, { state: "silent", line: "No research has run for this account yet. Open Today and press Update data." }]); }); // a count of checks can never say this: a quiet day and a week of silence both rendered as nothing at all
});
describe("research-run conflict-free research closure", () => {
  /** THE production incident, hermetic: ONE research_state row, a discovery phase landing this run's REAL receipt, and a prompt phase served the snapshot from BEFORE that write. The writers interleave, so the prompt unit resets its receipt and its optimistic save conflicts. The executor is the REAL one. */
  /** Runtime's daily plan, the observation unit's ONLY input: one question on the four engines, one day. */
  const DUE = (["chatgpt", "claude", "gemini", "perplexity"] as const).map((engine) => ({ promptId: "p1", version: 1, text: "best persian restaurant", engine, slot: 0 as const, day: "2026-07-21" }));
  function funnelWorld(rows: RR.ResearchRun[], staleLoads: number) {
    const pre = emptyFunnelState(T, "basis_test"); pre.cycle = { runId: "prev-run", cycleKey: "prev", spentUsd: 1.82, cacheHits: 0 }; // the PREVIOUS run's receipt
    const live = { state: structuredClone(pre), rowVersion: 18 }; const seen: Record<string, unknown>[] = []; const bought = new Set<string>(); let loads = 0, paid = 0;
    const answer = { answerText: "hi", modelServed: null, webSearchReported: null, citations: [], fanOutQueries: null, brands: null };
    const deps: FunnelDeps = { recordObservation: async () => {}, getAccount: async () => null, now: () => NOW, parse: ((_c: unknown, env: unknown) => env) as FunnelDeps["parse"],
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
  it("retries a conflict ONCE, then files the observation lane as unreadable and runs the rest of the day, never under-reporting the run's spend", async () => {
    const rows = withRun(); const w = funnelWorld(rows, 99); await run({ funnelUnit: w.funnelUnit }); // every prompt load is stale: the retry conflicts too
    expect(w.prompts()).toHaveLength(2); expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["completed", "done"]); // bounded: no third invocation, no loop, and ONE LANE NEVER CLOSES THE DAY (operator, 2026-09-02)
    expect([rows[0]!.progress.observations?.state, rows[0]!.progress.state?.blocker]).toEqual(["reading_unreadable", CONFLICT_DETAIL]); // the lane's debt is filed on the row, not written over the day
    expect(rows[0]!.progress.funnel).toMatchObject({ spendUsd: 0.09504, cacheHits: 8 }); }); // the conflicted attempt's zeros are DISCARDED, never merged over proven spend
  it("retries ONLY a state conflict: a bounded failure yields the lane once, a durable wait pauses once, and a lost lease never runs the unit", async () => {
    { const rows = withRun({ current_phase: "prompt_observations" }); const at: string[] = []; // a bounded failure runs the observation unit ONCE and the day goes on behind it
      await run({ funnelUnit: async (phase) => (at.push(phase), phase === "prompt_observations" ? { status: "failed", cursor: null, progress: {}, detail: "One research request was turned down." } : { status: "done", cursor: null, progress: {} }) });
      expect([at.filter((x) => x === "prompt_observations").length, rows[0]!.status, rows[0]!.progress.observations?.state]).toEqual([1, "completed", "reading_unreadable"]); }
    { const rows = withRun({ current_phase: "prompt_observations" }); let calls = 0;
      await run({ funnelUnit: async () => (calls += 1, { status: "waiting", cursor: null, progress: {} }) }); expect([calls, rows[0]!.status]).toEqual([1, "paused"]); } // a durable wait: no code, no retry
    const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests({ ...repo, renew: async () => false }); rows.push(mk({ current_phase: "prompt_observations" })); let ran = false; // a lost lease aborts BEFORE the side effect
    await run({ funnelUnit: async () => (ran = true, { status: "done", cursor: null, progress: {} }) }); expect([ran, rows[0]!.last_error]).toEqual([false, null]); }); // the unit never ran and nothing was recorded
  it("reads the answers already paid for BEFORE it walks back into a long step, so a step that runs for hours can never starve them", async () => {
    const order: string[] = [], rows = withRun({ current_phase: "serp_analysis", progress: { plan: { units: ["analyze_answers", "plan_cases"] } } });
    await run({ dueWork: async () => ({ ...SOMETHING_DUE, due: ["analyze_answers", "plan_cases"] }), analyzeAnswers: async () => (order.push("read"), { attempted: 40, settled: 38, refused: 2, read: 36, outcomes: { settled: 38, provider_refused: 2 } }),
      funnelUnit: async (phase) => (order.push(phase), { status: "done", cursor: null, progress: {} }) });
    expect(order).toEqual(["read", "serp_analysis"]); // the reading first, then the long step carries on with whatever is left of the turn
    expect(rows[0]!.progress.funnel).toMatchObject({ answersAnalyzed: 36, answersAttempted: 40, answersRefused: 2 }); // and the row says what this turn actually did, so ten hours of silence is impossible
    const fresh = withRun({ current_phase: "refresh_sources" }), walked: string[] = []; // A FRESH RUN IS NOT A RESUMED ONE: it reads once, at the observation step, exactly as it always did
    await run({ dueWork: async () => ({ ...SOMETHING_DUE, due: ["analyze_answers"] }), analyzeAnswers: async () => (walked.push("read"), { attempted: 1, settled: 1, refused: 0, read: 1, outcomes: { settled: 1 } }) });
    expect([walked.length, fresh[0]!.status]).toEqual([1, "completed"]); });
  it("reads that slice ONCE a turn, however many times the turn passes back through a long step, and starts none at all with no time to store one", async () => {
    const order: string[] = [], rows = withRun({ current_phase: "serp_analysis", progress: { plan: { units: ["analyze_answers", "acquire_case_evidence"] } } }); let unit = 0; const reading = (into: string[]) => async () => (into.push("read"), { attempted: 5, settled: 5, refused: 0, read: 5, outcomes: { settled: 5 } });
    await run({ dueWork: async () => ({ ...SOMETHING_DUE, due: ["analyze_answers", "acquire_case_evidence"] }), analyzeAnswers: reading(order),
      funnelUnit: async (phase) => (order.push(phase), (unit += 1) === 1 ? { status: "advanced", cursor: { n: 1 }, progress: {} } : { status: "done", cursor: null, progress: {} }) });
    expect(order).toEqual(["read", "serp_analysis", "serp_analysis", "winning_pages"]); // three passes through a long step, exactly one reading slice
    expect(rows[0]!.progress.funnel?.answersAnalyzed).toBe(5); // and one slice's worth of readings on the row, never three
    const late: string[] = []; withRun({ current_phase: "serp_analysis", progress: { plan: { units: ["analyze_answers", "plan_cases"] } } }); // a fresh row for the short turn
    await run({ dueWork: async () => ({ ...SOMETHING_DUE, due: ["analyze_answers", "plan_cases"] }), analyzeAnswers: reading(late), funnelUnit: async (phase) => (late.push(phase), { status: "done", cursor: null, progress: {} }) }, 60_000);
    expect(late).toEqual(["serp_analysis"]); });
  it("reads the new answers back on the observation phase only, records what persisted, and never turns a read-back failure into a pause", async () => {
    const seen: Array<[string, string]> = []; const rows = withRun(); await run({ analyzeAnswers: async (t, day) => (seen.push([t, day]), { attempted: 3, settled: 3, refused: 1, read: 2, outcomes: { settled: 2, provider_refused: 1 } }) });
    expect(seen).toEqual([[T, ckey(T).slice(-10)]]); // once, on prompt_observations, for the run's own UTC day
    expect([rows[0]!.status, rows[0]!.progress.funnel]).toMatchObject(["completed", { answersAnalyzed: 2, answersAttempted: 3, answersRefused: 1, answersOutcomes: { settled: 2, provider_refused: 1 } }]); const failed = withRun(); // the row carries WHY the two numbers differ, so 3 taken on and 2 read is never a shape without an explanation
    await run({ analyzeAnswers: async () => { throw new Error("openai down"); } }); expect([failed[0]!.status, failed[0]!.progress.funnel?.answersAnalyzed]).toEqual(["completed", undefined]); });
  /** On 13 August ten cron dispatches in a row died at exactly 300 seconds. The reading sat between the settled observation unit and the phase advance, so one run held prompt_observations for five and a half hours with all 140 answers stored and settled, and every surface still read 0 of 140: each write that would have said otherwise was queued behind an analysis bounded by item counts alone. */
  describe("collection is banked before analysis, and the lease decides who analyses", () => {
    const FULL_DAY = { done: 140, total: 140, answers: 140, unavailable: 0, unsupported: 0 };
    it("advances the phase and records the day BEFORE it reads one answer, so a reading that outruns the turn leaves the analyses OWED and the next pass resumes them without re-buying an observation", async () => {
      const rows = withRun({ current_phase: "prompt_observations" }); const budgets: number[] = [];
      const steps: Partial<ResearchCycleSteps> = { dayStanding: async () => FULL_DAY, analyzeAnswers: async (_t, _d, budgetMs) => (budgets.push(budgetMs), NOW += RESEARCH_CYCLE_DEADLINE_MS + 10_000, NO_READING) }; // the hosting ceiling hits INSIDE the reading, whatever that ceiling is set to
      await run(steps);
      expect([rows[0]!.current_phase, rows[0]!.status, rows[0]!.progress.state?.checksDone, rows[0]!.progress.funnel?.answersAnalyzed]).toEqual(["serp_analysis", "paused", 140, undefined]); // the phase MOVED and the day's collection is on the row; not one analysis is claimed by it
      expect(budgets).toEqual([RESEARCH_CYCLE_DEADLINE_MS]); // the reading was handed what was left of the turn, never a count of answers standing in for a clock
      expect(RR.researchStatusLine(await RR.researchRunStatus(T, new Date(NOW)), new Date(NOW))) .toBe("Research in progress: reading the results pages for your strongest topics. 140 of 140 AI checks collected."); // collected, never analysed, and never finished
      const later: string[] = []; // the pass due-work opens on the debt those answers left behind
      await run({ ...steps, dueWork: async () => ({ ...SOMETHING_DUE, due: ["analyze_answers"] }), funnelUnit: async (phase) => (later.push(phase), { status: "done", cursor: null, progress: {} }),
        analyzeAnswers: async () => ({ attempted: 40, settled: 40, refused: 0, read: 40, outcomes: { settled: 40 } }) });
      expect([later.includes("prompt_observations"), rows[0]!.progress.funnel?.answersAnalyzed]).toEqual([false, 40]); }); // it reads what was owed and re-buys not one observation to do it
    it("refuses a second invocation while the lease is live: it claims nothing, opens no pass and reads nothing, so one pass does the reading", async () => {
      const rows = withRun({ current_phase: "prompt_observations" }); let reads = 0; await Promise.all([1, 2].map(() => run({ dayStanding: async () => FULL_DAY,
        analyzeAnswers: async () => (reads += 1, { attempted: 40, settled: 40, refused: 0, read: 40, outcomes: { settled: 40 } }) })));
      expect([reads, rows.length, rows[0]!.progress.funnel?.answersAnalyzed]).toEqual([1, 1, 40]); }); // one reading pass, one run: the second claim met a live lease and opened nothing
  });
  it("stamps what the pass actually spent onto the run's own spend column at the close, and zero when it bought nothing", async () => {
    const paid = withRun({ progress: { funnel: { spendUsd: 0.42 } } }); await run({}); const quiet = withRun(); await run({});
    expect([paid[0]!.status, paid[0]!.spend_usd, quiet[0]!.spend_usd]).toEqual(["completed", 0.42, 0]); }); // the column research_runs declared and nothing ever wrote, so every closed row claimed $0.00 forever; a pass that bought nothing stamps zero, which is a fact and not an absence
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
  it("checks and reads what was marked done before a waiting lane pauses, and asks nothing else of that lane", async () => { let checked = 0; const rows = withRun({ current_phase: "serp_analysis" }); await run({ dueWork: async () => ({ ...SOMETHING_DUE, due: ["plan_cases", "verify_and_measure"] }), verifyShipments: async () => (checked += 1, 1), funnelUnit: async () => ({ status: "waiting", cursor: null, progress: {} }) }); expect([rows[0]!.status, rows[0]!.current_phase, checked]).toEqual(["paused", "serp_analysis", 1]); });
  it("stays on the AI phase while provider work is still in flight: a durable wait pauses there with no error at all, and the next tick picks the day back up", async () => {
    const rows = withRun({ current_phase: "prompt_observations" }); let done = 0, inFlight = true;
    const steps: Partial<ResearchCycleSteps> = {
      funnelUnit: async (phase) => { if (phase !== "prompt_observations") return { status: "done", cursor: null, progress: {} };
        if (inFlight) return { status: "waiting", cursor: null, progress: {} }; // posted, not yet answered
        done = Math.min(TOTAL, done + 20); return { status: "done", cursor: null, progress: {} }; }, dayStanding: async () => standing(done) };
    await run(steps); expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error]).toEqual(["paused", "prompt_observations", null]); // a wait is not a failure and is never completion
    inFlight = false; await run(steps); expect([rows.length, rows[0]!.status, done]).toEqual([1, "completed", 140]); }); // the SAME run finishes the day it started
  it("closes a pass whose reporting day has already ended instead of buying that day late, and lets today's own cycle open", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); rows.push(mk({ id: "stale", status: "paused", current_phase: "prompt_observations", cycle_key: `${T}:2026-07-01`, started_at: iso(NOW - DAY), progress: { state: { checksDone: 96, checksTotal: 140 } } }));
    const asked: string[] = [], planned: string[] = [];
    const steps: Partial<ResearchCycleSteps> = { funnelUnit: async (phase) => (asked.push(phase), { status: "done", cursor: null, progress: {} }),
      dueWork: async () => ({ ...SOMETHING_DUE, checks: { ...NO_CHECKS, done: 3, total: 140 } }), dayStanding: async (_t, d) => (planned.push(d), standing(TOTAL)) };
    await run(steps); // a run that paused before midnight Pacific and was picked up after it
    expect([asked.filter((a) => a === "prompt_observations"), planned]).toEqual([[], []]); // nothing placed, nothing collected onto that day, nothing even planned for it
    expect([rows.length, rows[0]!.status, rows[0]!.progress.state]).toEqual([1, "completed", { checksDone: 96, checksTotal: 140 }]); // closed on ITS OWN last numbers; today's 3-of-140 never overwrote the dead day's receipt
    await run(steps); // and TODAY's own cycle is free to open, which the one-open-run index refused while that run stayed open
    expect([rows.length, rows[1]!.cycle_key.endsWith(new Date(NOW).toISOString().slice(0, 10)), rows[1]!.status]).toEqual([2, true, "completed"]); });
  /** A BLOCKED PURCHASE LANE CANNOT BLOCK THE REST OF THE DAY. Answers already paid for over the reading ceiling stop the buying, so the unit is handed an empty window, reads it as a finished round, and the day still owes
   *  140. That disagreement used to chain twelve rounds on the database and then PAUSE the run, so the results pages, the winner reads, the verification, the measurement and the publication behind this phase never ran at
   *  all: the live run of 2026-09-01 sat paused at prompt_observations from morning to night with 140 checks owed. The lane is entered ONCE, it reads the paid backlog first, and then it yields the phase. */
  const UNREAD = 640;
  const blocked = (touched: string[]): Partial<ResearchCycleSteps> => ({
    funnelUnit: async (phase) => (touched.push(phase), { status: "done", cursor: null, progress: {} }), // the empty window a paused purchase lane hands back
    dayStanding: async () => ({ ...standing(0), readingBacklog: UNREAD }), replenishReady: async () => (touched.push("produce"), null),
    verifyShipments: async () => (touched.push("verify"), 0), measureShipments: async () => (touched.push("measure"), 0), publishSurface: async () => void touched.push("publish"), surfaceStale: async () => true,
    dueWork: async () => ({ ...SOMETHING_DUE, due: ["daily_observations", "analyze_answers", "verify_and_measure"], checks: { ...NO_CHECKS, total: TOTAL, readingBacklog: UNREAD } }) });
  it("enters an unchanged blocked window ONCE and never pauses the run on it, reading the paid backlog before it asks for anything", async () => {
    const rows = withRun({ current_phase: "prompt_observations" }); const touched: string[] = []; let read = 0;
    await run({ ...blocked(touched), analyzeAnswers: async () => (read += 1, { attempted: 40, settled: 40, refused: 0, read: 40, outcomes: { settled: 40 } }) });
    expect([touched.filter((t) => t === "prompt_observations").length, read, rows[0]!.status]).toEqual([1, 1, "completed"]); // one window, one reading in front of it, and no pause
    expect(rows[0]!.progress.observations).toEqual({ state: "reading_backlog", unread: UNREAD, done: 0, total: TOTAL }); }); // typed on the row: neither done nor failed
  it("runs the rest of the day in the SAME drive while the purchase lane is blocked: the produce pass, the results pages, the winners, the verification, the measurement and the publication", async () => {
    const touched: string[] = []; withRun({ current_phase: "prompt_observations" }); await run(blocked(touched));
    expect(touched).toEqual(["produce", "prompt_observations", "serp_analysis", "winning_pages", "verify", "measure", "publish"]); });
  /** AND THE STATE CLEARS ITSELF. A lane stamped blocked that stayed stamped after the reading caught up would tell every later reader that buying is still paused over a backlog that no longer exists. */
  it("clears the blocked state once the backlog has actually drained, and never leaves a stale claim on the row", async () => {
    const rows = withRun({ current_phase: "prompt_observations" }); const touched: string[] = [];
    await run({ ...blocked(touched), dayStanding: async () => standing(0) }); // the drive OPENED on a backlog of 640 and the reading took it under the bound, so the standing no longer names one
    expect([rows[0]!.progress.observations, rows[0]!.status]).toEqual([undefined, "completed"]); });
  it("never calls a day finished it could not count: an unreadable standing files the lane as unreadable and the rest of the day still runs", async () => {
    const rows = withRun({ current_phase: "prompt_observations" }); await run({ dayStanding: async () => null });
    expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.progress.observations?.state]).toEqual(["completed", "done", "reading_unreadable"]); expect(rows[0]!.progress.state?.blocker).toContain("could not be counted"); });});
/** THE CRAWL HAS TO BEGIN SOMEWHERE. Cold start only ever fired from onboarding, so an account that predates it kept an empty owned-page inventory forever: every scheduled pass asked to CONTINUE a crawl that had never started, was told "no crawl", and recorded a healthy no-op. */
describe("reading a pre-existing account's own website", () => {
  const crawl = () => defaultSteps.crawlPages(T, new Date(NOW));
  beforeEach(() => { CRAWL.state = null; CRAWL.starts = 0; CRAWL.batches = 0; CRAWL.forced = false; CRAWL.racer = null; CRAWL.pick = null; CRAWL.inventory = []; CRAWL.decay = []; });
  /** THE DRAFT STEP REFUSES A PAGE IT HAS NOT READ WHOLE, so the pages the operator is waiting on are the ones losing clicks. The frontier handed them out in inventory order, so a page under investigation sat behind two hundred it had never heard of. */
  it("puts a page losing clicks at the FRONT of the batch, without ever adding a page the inventory withheld", async () => {
    CRAWL.inventory = ["https://site.example/steady", "https://www.site.example/losing/", "https://site.example/other"];
    CRAWL.decay = [{ page: "https://site.example/losing", clicksNow: 4, clicksPrior: 90 }, { page: "https://site.example/steady", clicksNow: 90, clicksPrior: 90 }];
    await crawl(); expect(await CRAWL.pick!(T, 200)).toEqual(["https://www.site.example/losing/", "https://site.example/steady", "https://site.example/other"]); // the slipping page first, www and trailing slash and all, and nothing invented
    expect(await CRAWL.pick!(U, 200)).toEqual(CRAWL.inventory); // ANOTHER account asked through the same wrapper gets the inventory's own order, never this account's declining pages ranked over its own
    CRAWL.decay = []; CRAWL.pick = null; await crawl(); expect(await CRAWL.pick!(T, 200)).toEqual(CRAWL.inventory); }); // no readable decline is the inventory's own order, exactly as before
  it("starts the frontier once for an active account that never had one, reads one bounded batch, and only continues it from then on", async () => {
    expect([await crawl(), CRAWL.starts, CRAWL.batches, CRAWL.forced]).toEqual([3, 1, 1, false]); // one init, one batch, never forced, never onboarding
    expect([await crawl(), CRAWL.starts, CRAWL.batches]).toEqual([3, 1, 2]); }); // an existing frontier is continued, never started again
  it("continues the state a concurrent instance created rather than resetting it, and leaves an unreachable site exactly as it found it", async () => {
    CRAWL.racer = () => { CRAWL.state = "complete"; }; // another instance initialized between the load and the start
    expect([await crawl(), CRAWL.starts, CRAWL.batches]).toEqual([3, 1, 1]); // the SURVIVING state is what gets continued
    CRAWL.state = "unreachable"; CRAWL.racer = null; expect([await crawl(), CRAWL.starts, CRAWL.batches]).toEqual([0, 1, 1]); }); // unreachable is persisted truth, not a reason to start over
  /** ONE SMALL BATCH A DAY IS NOT THE PRODUCT. An account holding two hundred pages nobody had opened waited months on one fifteen-page batch per pass. */
  it("keeps reading the website inside one pass until a batch reads nothing, then advances, and never loops on it forever", async () => {
    const rows = withRun({ current_phase: "crawl_pages" }); let left = 2, batches = 0; await run({ ...BENIGN, crawlPages: async () => (batches += 1, left > 0 ? (left -= 1, 15) : 0) });
    expect([batches, rows[0]!.status, rows[0]!.current_phase]).toEqual([3, "completed", "done"]); // two full batches, then the one that proved nothing is left
    const endless = withRun({ current_phase: "crawl_pages" }); let forever = 0;
    await run({ ...BENIGN, crawlPages: async () => (forever += 1, 15) }); // a site that never runs out must still hand the pass back
    const short = withRun({ current_phase: "crawl_pages" }); let rounds = 0, t = NOW; // and a batch that eats the clock hands the rest of the drive to the work already selected, rather than reading the site until there is no room to finish anything
    await runResearchCycle(T, { now: () => new Date(t), deadlineMs: 260_000, steps: { ...BENIGN, crawlPages: async () => (rounds += 1, t += 60_000, 15) } });
    expect([forever, endless[0]!.status, rounds, short[0]!.status], "bounded rounds, the rest owed to the next pass, and a crawl that would leave the walk no runway stops one round early").toEqual([4, "completed", 2, "completed"]); }); // bounded rounds, and the rest is owed to the next pass
});
/** THE MONEY IS THE PLACEMENT'S. A posted ask is finished by a FREE collect, and that free collect used to land the final row at cost 0, erasing the receipt the pending row already held: the one row Decision reads about an answer disagreed with the ledger that paid for it. */
describe("what a stored observation says it cost", () => {
  const DUE = [{ promptId: "p1", version: 1, text: "best persian restaurant", engine: "claude" as const, slot: 0 as const, day: "2026-08-03" }];
  const CURSOR = { basis: "basis_test", runId: "r1", cycle: `${T}:2026-08-03` };
  const answer = { answerText: "hi", modelServed: null, webSearchReported: null, citations: [], fanOutQueries: null, brands: null };
  /** One account's funnel document plus the two seams that matter here: what a PLACEMENT costs, and what the paid row already ON FILE says when the landing itself computed nothing. */
  const world = (postCost: number, onFile = 0) => {
    const wrote: AiObservationRecord[] = []; const held = { s: emptyFunnelState(T, "basis_test"), v: 1 }; let posts = 0, reads = 0;
    const deps: FunnelDeps = { getAccount: async () => null, now: () => NOW, parse: ((_c: unknown, env: unknown) => env) as FunnelDeps["parse"],
      recordObservation: async (rec) => void wrote.push(rec), readObservationCost: async () => (reads += 1, onFile),
      loadState: async () => ({ state: structuredClone(held.s), rowVersion: held.v }),
      saveState: async (_t, _b, s, expected) => { if (expected !== held.v) return null; held.s = structuredClone(s); held.v += 1; return held.v; },
      callProvider: async () => (posts += 1, { state: "waiting", cacheKey: "ck-1", costUsd: postCost, modelRequested: null } as CachedCallResult),
      collectTask: async () => ({ state: "ok", envelope: answer as never, costUsd: 0, cacheKey: "ck-1", modelServed: null } as CachedCallResult) };
    const forget = () => { held.s.prompts.pairs = held.s.prompts.pairs.map((x) => ({ ...x, postCostUsd: undefined })); }; return { deps, wrote, forget, posts: () => posts, reads: () => reads }; };
  it("keeps the placement cost on the final answer, asks the provider exactly once, upserts ONE identity, and never re-reads a cost it already carries", async () => {
    const w = world(0.0075); const first = await promptObservationUnit(w.deps, DUE)(T, CURSOR, 5_000); // the ask is PLACED: the money moves here
    expect([first.status, w.wrote.at(-1)!.status, w.wrote.at(-1)!.cost_usd, w.wrote.at(-1)!.cache_key]).toEqual(["waiting", "pending", 0.0075, "ck-1"]);
    const second = await promptObservationUnit(w.deps, DUE)(T, CURSOR, 5_000); // the next tick collects it for free
    expect([second.status, w.wrote.at(-1)!.status, w.wrote.at(-1)!.cost_usd]).toEqual(["done", "observed", 0.0075]); // THE pin: free collection never overwrites what placement paid
    expect([w.posts(), new Set(w.wrote.map((r) => r.id)).size, w.reads()]).toEqual([1, 1, 0]); }); // no second paid post, one identity upserted, and no read it did not need
  it("keeps the paid placement ALREADY ON FILE for an identity posted before the pair carried its own cost, instead of writing a paid receipt down to zero", async () => {
    const w = world(0.0075, 0.0075); await promptObservationUnit(w.deps, DUE)(T, CURSOR, 5_000); w.forget(); const second = await promptObservationUnit(w.deps, DUE)(T, CURSOR, 5_000);
    expect([second.status, w.wrote.at(-1)!.cost_usd, w.reads()]).toEqual(["done", 0.0075, 1]); }); // the pending row's own receipt survives the free collect
});
describe("research-run fail-closed + render path", () => {
  it("fails closed when the claim RPC throws, throws on an empty tenant before any I/O, and runs no phase on the render path", async () => {
    let touched = false; const log: string[] = []; RR.setResearchRunRepoForTests({ ...memRepo().repo, claim: async () => { touched = true; throw new Error("db down"); } });
    await run(healthySteps(log)); expect([log, touched]).toEqual([[], true]); // no phase ran, and it did try to claim
    touched = false; await expect(RR.claimRun("", "o1")).rejects.toThrow(/tenantId is required/); expect(touched).toBe(false); // never reached the repo
    const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo); expect(() => ensureResearchRunOnVisit(T, true)).not.toThrow(); // after() invalid outside a request → caught
    await Promise.resolve(); expect(rows).toHaveLength(0); }); // no phase work on the render path
});
/** THE ONLY PAID RESEARCH TRIGGER A PERSON REACHES WITHOUT ASKING FOR ONE: it fires on every render of the app shell, including the repaint the $0 "Update data" control asks for when it is done, and it opened a same-day pass through startExtraPass whenever anything read as due. Spend is asked BEFORE that now. */
describe("a visit may not open a research pass the account cannot pay for", () => {
  it("refuses a spent ceiling, allows a funded one, treats an unreadable budget as unaffordable, and probes a cost a ceiling can actually refuse", async () => {
    const refused = await visitMayOpenResearch(T, async () => ({ allowed: false, reason: "Monthly adjudicator budget cap reached (54.9913 / 55 USD this 2026-08)." }));
    const unreadable = await visitMayOpenResearch(T, async () => { throw new Error("db down"); });
    let asked = -1; const allowed = await visitMayOpenResearch(T, async (_t, projected) => { asked = projected; return { allowed: true }; });
    expect([refused.allowed, allowed.allowed, unreadable.allowed]).toEqual([false, true, false]);
    expect([refused.reason.includes("54.9913 / 55"), unreadable.reason.includes("could not be read")]).toEqual([true, true]); // the refusal carries the door's OWN words
    expect([asked > 0, 54.9913 + asked > 55]).toEqual([true, true]); }); // THE TRAP: the door refuses on `spend + projected > cap`, so a ZERO probe still answers "allowed" against an allowance reached to the last cent, and a visit would open paid work on an account with nothing left.
  /** THE COUNTEREXAMPLE AFFORDABILITY CANNOT PRODUCE. Testing only at a spent ceiling proves the money gate, never the free-control contract: with the allowance restored the press would arm research again. */
  it("does not arm recovery on a repaint even when the budget is FULLY available", async () => { const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
    expect((await visitMayOpenResearch(T, async () => ({ allowed: true }))).allowed).toBe(true); // money is NOT what stops it
    expect([isDocumentArrival(h({ rsc: "1" })), isDocumentArrival(h({ "next-action": "a1" })), isDocumentArrival(h({})), isDocumentArrival(null)]).toEqual([false, false, true, false]); }); // router.refresh(), a Server Action's own response and a client navigation are RSC payloads; only a full document is a person turning up.
});
/** THE REGISTRY DECIDES, ONCE per run. The reconcile step here is the real one, so the wiring is what is pinned: a registry that only changed the ORDER it was written in is unmoved, and the advisory reading is bounded per RUN, never per unit iteration. */
describe("the case registry a run saves, and the ONE reading it buys", () => {
  const row = (id: string, anchors: string[]) => ({ id, anchors }); const real = (steps: Partial<ResearchCycleSteps> = {}) => { const { reconcileCases: _seam, ...rest } = BENIGN;
    return runResearchCycle(T, { now: () => new Date(NOW), steps: { ...rest, ...steps } }); };
  beforeEach(() => { REG.saves = 0; REG.readings = 0; });
  it("saves nothing and reads nothing when the registry changed only the order it happens to be written in", async () => {
    REG.onFile = [row("inv_b", ["y", "x"]), row("inv_a", ["a"])]; REG.next = [row("inv_a", ["a"]), row("inv_b", ["x", "y"])]; const rows = withRun({ current_phase: "serp_analysis" }); await real();
    expect([REG.saves, REG.readings, rows[0]!.progress.synthesisAttempted, rows[0]!.status]).toEqual([0, 0, undefined, "completed"]); });
  it("attempts the reading at most ONCE per run, however many units and phases reconcile against a registry that did move", async () => {
    REG.onFile = [row("inv_a", ["a"])]; REG.next = [row("inv_a", ["a", "b"])]; const rows = withRun({ current_phase: "serp_analysis" }); let units = 0;
    await real({ funnelUnit: async () => { units += 1; return units < 4 ? { status: "advanced", cursor: { units }, progress: {} } : { status: "done", cursor: null, progress: {} }; } });
    expect([REG.saves > 1, REG.readings, rows[0]!.progress.synthesisAttempted, units, rows[0]!.status]).toEqual([true, 1, true, 5, "completed"]); });});
/** THE DUE-WORK RUNTIME. A day is not a unit of work: owed work is. The SAME free question ("what is genuinely due, from persisted state alone") decides whether a second pass may open on a finished day, whether a pass has anything to do, and whether a continuation is worth asking for. Rows, never a lease. */
describe("the due-work runtime: a day is not a unit of work", () => {
  const today = () => new Date(NOW).toISOString().slice(0, 10);
  /** EVERY DURABLE SIGNAL READABLE AND QUIET: a settled day, a settled manifest, a fresh surface, no measurement debt, nothing to crawl, nothing to read. One test moves one of them. */
  const PERSISTED = { staleSources: async () => 0, checks: async () => ({ ...NO_CHECKS, done: 140, total: 140, answers: 140, due: 0 }),
    run: async () => ({ progress: { decided: { basis: "b1", rowVersion: 1 }, replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v1" } }, open: false }), basis: async () => "b1", evidenceVersion: async () => 1,
    surfaceStale: async () => false, debt: async () => ({ measurable: 0, unverified: 0 }), analysisFingerprint: async () => "fp1", consumedAnalyses: async () => "fp1",
    pagesToCrawl: async () => false, answersToAnalyze: async () => false, readyStock: async () => 5 };
  const completedToday = (): RR.ResearchRun[] => { const rows = freshRepo(); rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done" })); return rows; };
  /** PHASE 5D. ONE canonical answer to "is anything owed", so a day whose AI answers are all collected is not therefore finished: the website may still be two hundred pages unread, and answers already bought may have no verdict on them yet. Both used to be invisible to the recovery opener. */
  it("does not buy evidence for a claim while the provider that has to judge it is out of credit", async () => { const owing = { ...PERSISTED, factDebt: async () => ({ owed: 33, everChecked: true }) };
    expect((await dueWork(T, new Date(NOW), { ...owing, creditHeld: async () => false })).due).toContain("check_page_facts");
    expect((await dueWork(T, new Date(NOW), { ...owing, creditHeld: async () => true })).due).not.toContain("check_page_facts"); });
  it("still owes work on a day whose answers are complete when the website is unread or the bought answers have not been read closely, and owes nothing when both are terminal", async () => {
    const quiet = { ...PERSISTED, factDebt: async () => ({ owed: 0, everChecked: true }), creditHeld: async () => false };
    const crawlOwed = await dueWork(T, new Date(NOW), { ...quiet, pagesToCrawl: async () => true, answersToAnalyze: async () => false });
    expect([crawlOwed.readable, crawlOwed.due]).toEqual([true, ["crawl_pages"]]); // 208 pages nobody has opened is owed work, whatever the answer count says
    const readOwed = await dueWork(T, new Date(NOW), { ...quiet, pagesToCrawl: async () => false, answersToAnalyze: async () => true });
    expect(readOwed.due).toEqual(["analyze_answers"]); // an answer bought and never read closely is a debt, not a finished day
    const terminal = await dueWork(T, new Date(NOW), { ...quiet, pagesToCrawl: async () => false, answersToAnalyze: async () => false });
    expect([terminal.readable, terminal.due]).toEqual([true, []]); }); // genuinely terminal opens nothing at all
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
  /** ONE PRESS, SERVER-OWNED. The old shape ran one hop per request, capped six per day, and the browser looped: closing the tab stopped the day and hop seven said done over an unfinished queue. The server now drives the one runtime internally; nothing due runs nothing and spends nothing, and a due list a whole pass could not move is a BLOCKER to report, never a loop to buy again. */
  it("two tabs cannot both open a same-day pass: the second insert loses to the one-open-run invariant", async () => { // the one-press continuation tests left with continueResearch itself (deleted 2026-08-30: zero callers)
    const rows = completedToday(); const one = await RR.startExtraPass(T, "tab-1", today()); const two = await RR.startExtraPass(T, "tab-2", today()); // the first pass is still open
    expect([one?.lease_owner, two, rows.length]).toEqual(["tab-1", null, 2]); });
  it("marks the case a spending ceiling stopped, day-scoped on the run's own row, and the receipt reads it", async () => {
    const rows = withRun({ current_phase: "keyword_discovery" }); await run({ funnelUnit: async () => ({ status: "failed", cursor: { stage: "competitors", cappedCase: "inv_haft" }, progress: {}, detail: "the ceiling was reached" }) });
    expect(rows[0]!.progress.capped).toEqual({ day: today(), caseIds: ["inv_haft"] });
    const snapshot = { scope: { builtAt: iso() }, ownedPages: [], research: { cases: [{ id: "inv_haft", anchors: ["haft seen"] }],
      retainedKeywords: [], serpEvidence: [], aiObservations: [], pageComparisons: [], winningPages: [], caseCompetitors: [], receipt: { spentUsd: 0, cached: 0 } } } as unknown as EvidenceSnapshot;
    const reasons = (capped: string[]) => caseResearchReceipt(snapshot, "inv_haft", capped)!.notBought.map((n) => n.reason); expect(reasons(rows[0]!.progress.capped!.caseIds)).toContain("capped");
    expect(reasons([])).not.toContain("capped"); }); // the marker dies with the day, so tomorrow's receipt says nothing about today's ceiling
});
/** THE DAILY DISPATCH. Daily AI tracking must happen on a day nobody opens the app, without becoming a second orchestrator: the guarded endpoint is the only door, the dispatch claims through the SAME lease and drives the SAME cycle, firing it twice does nothing twice, and its receipt never flatters a failure. */
describe("the daily scheduler: one guarded door, the same lease, the same cycle", () => {
  const today = () => new Date(NOW).toISOString().slice(0, 10); const NO_PHASE = { refreshSources: async () => { throw new Error("no phase may run"); } };
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
  /** THE RECEIPT IS THE DRIVER'S, NOT THE LOOP'S. Returning normally used to be the whole test of success, so a durable provider wait, a phase that paused itself and a lease another instance had already recovered were each counted as a finished day, and the one machine-readable receipt said so. */
  it("counts a wait, a phase pause and a lost lease as themselves, and a clean cycle as exactly one success", async () => {
    const one = (steps: Partial<ResearchCycleSteps>) => { const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); return { rows, receipt: dispatch(steps) }; };
    const waiting = one({ funnelUnit: async () => ({ status: "waiting", cursor: null, progress: {} }) });
    expect(await waiting.receipt).toEqual(R({ claimed: 2, attempted: 1, paused: 2, remaining: 2 })); // durable provider work is pending, which is not a day's work done
    expect(waiting.rows[0]!.status).toBe("paused"); const partial = one({ refreshSources: async () => ({ attempted: 2, succeeded: ["google_gsc"], failures: [{ provider: "google_ga4", detail: "token expired" }] }) });
    expect(await partial.receipt).toEqual(R({ claimed: 1, attempted: 1, succeeded: 1 })); // a source that would not sync is ONE LANE'S DEBT: the day ran to the end, so the dispatch counts a finished pass and holds nothing open
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding");
    const stolen = await dispatch({ crawlPages: async () => { rows[0]!.lease_owner = "another-instance"; return 0; } }); // the lease is recovered from under us mid-cycle
    expect(stolen).toEqual(R({ claimed: 1, attempted: 1, failed: 1, remaining: 1 })); // never a success, and a lease somebody else now holds is not mine to report
    const clean = one({}); expect(await clean.receipt).toEqual(R({ claimed: 1, attempted: 1, succeeded: 1 })); expect(clean.rows[0]!.status).toBe("completed"); }); // exactly one, on a run that really did land completed
  /** AN OUTAGE IS NOT AN EMPTY FLEET. The claim used to swallow every error into an empty list, so a database that was down, an RPC that was never migrated and a revoked permission all answered 200 with a zero receipt: identical to a genuinely idle fleet, and cron monitoring recorded a healthy day. */
  it("says 503 when it could not read what is owed, in one bounded word, and keeps 200 for a fleet that genuinely owes nothing", async () => {
    const { repo } = memRepo(); for (const boom of [new Error("connect ECONNREFUSED 10.0.0.4:5432 db.vlxwevsdvwxvopkjsewo.supabase.co"),
      Object.assign(new Error("Could not find the function public.claim_due_research_work"), { code: "PGRST202" })]) {
      RR.setResearchRunRepoForTests({ ...repo, claimDue: async () => { throw boom; } }); await expect(RR.claimDueRuns("o1", 1)).rejects.toThrow(); // a typed failure, never an empty list
      await expect(dispatch(NO_PHASE)).rejects.toThrow(); ROUTE.fail = boom; vi.stubEnv("CRON_SECRET", "s3cret"); const res = await post({ authorization: "Bearer s3cret" });
      expect([res.status, await res.json()]).toEqual([503, { error: "scheduler_unavailable" }]); // no account, no host, no port, no database text
      ROUTE.fail = null; vi.unstubAllEnvs();}
    const rows = freshRepo(); PAUSED.add(T); PAUSED.add(U); expect(await dispatch(NO_PHASE)).toEqual(R()); // zero rows owed is a success, and always was
    expect(rows).toHaveLength(0); ROUTE.receipt = R(); vi.stubEnv("CRON_SECRET", "s3cret"); const idle = await post({ authorization: "Bearer s3cret" }); expect([idle.status, await idle.json()]).toEqual([200, R()]);
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401); // and a bad bearer still claims nothing at all
    vi.unstubAllEnvs(); });
  /** A COMPLETED PASS IS NOT A FINISHED DAY, and the fleet claim cannot tell them apart: claim_due_research_work excludes an account the moment ANY run completed today, so the 23:00 tick answered a zero receipt while 33 of that day's checks had never been asked at all. A repeat tick is a no-op only once the DAY is settled, and the recovery lives here in the dispatch because the claim itself is frozen. */
  it("opens exactly one more pass for a day left short, drives it to the end of the day, and only then goes back to a zero receipt", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding");
    rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done", started_at: iso() })); // today's pass finished its batch and stopped at 107
    let done = 107, paidUnits = 0; const steps: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE, strandedToday: async () => (done < 140 ? [{ tenantId: T, due: ["daily_observations" as const] }] : []),
      dayStanding: async () => ({ done, total: 140, answers: done, unavailable: 0, unsupported: 0 }),
      funnelUnit: async (phase) => { if (phase === "prompt_observations") { paidUnits += 1; done = Math.min(140, done + 20); } return { status: "done", cursor: null, progress: {} }; } };
    expect(await dispatch(steps)).toEqual(R({ claimed: 1, attempted: 1, succeeded: 1 })); // the stranded day is claimed and driven, not skipped
    expect([rows.length, rows[1]!.status, done, paidUnits]).toEqual([2, "completed", 140, 2]); // ONE recovery pass, and it finished the day
    expect(await dispatch(steps)).toEqual(R()); // now the day really is done: the honest zero receipt
    expect(rows).toHaveLength(2); }); // and no pass opens on a settled day, ever
  /** PHASE 5C. Twenty was a fixed HEAD of the account list, so an account past it was never probed at all and could be short every day forever. */
  it("reaches every account in a fleet larger than one probe window, by rotating that window across the whole list", async () => {
    freshRepo(); DB.fleet = Array.from({ length: 25 }, (_, i) => `acct-${String(i).padStart(2, "0")}`);
    const HOUR = 3_600_000; const seen = new Set<string>();
    for (let tick = 0; tick < 3; tick += 1) { DB.served = []; await defaultSteps.strandedToday(NOW + tick * HOUR); for (const page of DB.served) for (const id of page) seen.add(id); }
    expect([...seen].sort()).toEqual([...DB.fleet].sort()); }); // account 21 through 25 are reachable, which they never were
  /** PHASE 5B. The probe swallowed every failure into an empty list, so an outage, a revoked permission and a genuinely finished fleet were one answer and cron monitoring recorded a healthy day. */
  it("says 503 rather than a quiet day when the recovery probe itself could not read the fleet", async () => {
    freshRepo(); PAUSED.add(T); PAUSED.add(U); DB.fleetError = { message: "connect ECONNREFUSED" }; // nothing to claim, so the probe is the whole dispatch
    await expect(runDueAccounts({ now: () => new Date(NOW), steps: { ...BENIGN, strandedToday: defaultSteps.strandedToday, ...NO_PHASE } })).rejects.toThrow();
    PAUSED.clear(); const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); // one claimable account, so one drive lands before the probe runs
    await expect(runDueAccounts({ now: () => new Date(NOW), steps: { ...BENIGN, strandedToday: defaultSteps.strandedToday } }))
      .rejects.toMatchObject({ receipt: R({ claimed: 1, attempted: 1, succeeded: 1 }) });
    expect(rows[0]!.status).toBe("completed"); // the account it did finish is finished, whatever the probe after it did
    ROUTE.fail = new Error("the recovery probe could not read the fleet"); vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await post({ authorization: "Bearer s3cret" }); expect([res.status, await res.json()]).toEqual([503, { error: "scheduler_unavailable" }]);
    ROUTE.fail = null; vi.unstubAllEnvs();
    DB.fleetError = null; DB.fleet = []; expect(await dispatch({ ...NO_PHASE, strandedToday: defaultSteps.strandedToday })).toEqual(R()); }); // a read that SUCCEEDED and proved zero is still a clean 200
  it("never opens a recovery pass on a day that is genuinely terminal, and buys nothing twice on one that is", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); let paidUnits = 0; const paying: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE,
      funnelUnit: async () => (paidUnits += 1, { status: "done", cursor: null, progress: {} }) };
    await dispatch(paying); const afterFirst = paidUnits; expect([rows.length, rows[0]!.status, afterFirst > 0]).toEqual([1, "completed", true]);
    expect(await dispatch(paying)).toEqual(R()); // the day is settled, so nothing is claimed and nothing is opened
    expect([rows.length, paidUnits]).toEqual([1, afterFirst]); }); // no second row, not one more paid unit
  it("still reaches the account the claim cannot see when another one is re-claimed: one dispatch, one recovery pass", async () => {
    const rows = freshRepo(); // U stays open with provider work in flight; T finished its batch and left the day short
    rows.push(mk({ id: "openU", tenant_id: U, status: "paused", current_phase: "prompt_observations", started_at: iso() }));
    rows.push(mk({ id: "doneT", tenant_id: T, status: "completed", completed_at: iso(), current_phase: "done", started_at: iso() }));
    const steps: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE, strandedToday: async () => [{ tenantId: T, due: ["daily_observations" as const] }],
      dayStanding: async () => ({ done: 107, total: 140, answers: 107, unavailable: 0, unsupported: 0 }),
      funnelUnit: async (phase) => (phase === "prompt_observations" ? { status: "waiting", cursor: null, progress: {} } : { status: "done", cursor: null, progress: {} }) };
    await dispatch(steps); expect(rows.filter((r) => r.tenant_id === T && r.cycle_key.includes(":p"))).toHaveLength(1); }); // U being re-claimed must not cost T its recovery
  it("two ticks racing the same stranded day open at most one pass between them", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done", started_at: iso() }));
    const steps: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE, strandedToday: async () => [{ tenantId: T, due: ["daily_observations" as const] }],
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
  /** AND THE SURFACE REBUILD ASKS THE DISPATCH'S OWN CLOCK (live 15:00Z, 2026-09-05, and the two ticks before it). The rebuild after a paused drive judges every stored row again and writes one release: 5.8, 7.0 and 22.3 seconds measured, begun 71.3, 86.3 and 94.1 seconds past the drive's own deadline every time, and on the third the hosting ceiling killed the tick six seconds into it, holding the release half written. The reserve the dispatch keeps back is forty seconds; a drive that honours its deadline leaves it, so the exception that published outside the budget for the first account bought nothing the reserve was not already buying. The producer inside the rebuild stays: it is the one door that turns what the walk just wrote into the release Today and Changes read, and over four consecutive drives its second judgement of the twelve rows it re-refuses moved not one version. */
  it.each([T, U])("rebuilds %s's release after a paused drive while the dispatch still holds its own reserve, and begins no rebuild the tick cannot finish", async (t) => {
    const tick = async (burnMs: number): Promise<{ rebuilt: string[]; paused: number }> => {
      REBUILT.length = 0; const rows = freshRepo(); setAccountStatus(t === T ? U : T, "pending_onboarding"); rows.push(mk({ tenant_id: t, cycle_key: ckey(t, NOW), status: "paused" })); let at = NOW;
      const receipt = await runDueAccounts({ now: () => new Date(at), budgetMs: 240_000, steps: { ...BENIGN,
        refreshSources: async () => (at = NOW + burnMs, { attempted: 1, succeeded: ["google_gsc"], failures: [] }) } }); // the drive spends the tick and pauses at the loop's own deadline check
      return { rebuilt: [...REBUILT], paused: receipt.paused }; };
    expect([await tick(215_000), await tick(250_000)],
      "a drive that ends 215 seconds in has spent its own 200-second slice and fifteen seconds of the reserve, so the customer's release is still rebuilt inside the tick's 240; one that ends 250 seconds in has spent the reserve as well, and the rebuild it would begin is the one the hosting ceiling killed on 2026-09-05, so the release on file stands and the next tick rebuilds it").toEqual([
      { rebuilt: [t], paused: 1 }, { rebuilt: [], paused: 1 }]); });
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
  it("keeps back enough of the dispatch for the customer's release, so research can never eat the publish", async () => {
    freshRepo(); setAccountStatus(U, "pending_onboarding"); const given: number[] = [];
    const watch: Partial<ResearchCycleSteps> = { dueWork: async () => ({ ...SOMETHING_DUE, due: ["analyze_answers"] }),
      analyzeAnswers: async (_t, _d, budgetMs) => (given.push(budgetMs), NO_READING) };
    await runDueAccounts({ now: () => new Date(NOW), steps: { ...BENIGN, ...watch } });
    expect(given[0]).toBeLessThanOrEqual(200_000); }); // the whole 240 second dispatch minus the reserved publish slice, never the whole of it
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
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding"); rows.push(mk({ id: "old", status: "paused", cycle_key: `${T}:2026-07-01`, started_at: iso(NOW - 30 * DAY) }));
    await dispatch(); expect([rows.length, rows[0]!.status]).toEqual([1, "completed"]); // the one unfinished run is RESUMED, no missed day is invented
    expect(await dispatch(NO_PHASE)).toEqual(R()); });
  it("reports the pause switch only when the database took the row AND read the value back, and both doors honour the answer", async () => {
    const rows = freshRepo(); setAccountStatus(U, "pending_onboarding");
    DB.missing.add(T);  // A PATCH matching no row answers 204 with NO error, so a bare "no error" reported success over a database that never heard the request, and Settings flipped the switch on screen for the rest of the day.
    expect(await setResearchPaused(T, true)).toBe(false); expect(await researchPermission(T)).toBe("unreadable"); // no row is no answer at all, never "running"
    DB.missing.delete(T); DB.ignoresWrites.add(T);  // A ROW THAT MATCHED IS NOT A VALUE THAT STUCK. Without the readback this reported success over a column that still holds the old answer.
    expect(await setResearchPaused(T, true)).toBe(false); expect(await researchPermission(T)).toBe("running");
    DB.ignoresWrites.clear(); expect(await setResearchPaused(T, true)).toBe(true); expect(await researchPermission(T)).toBe("paused");
    await run({ dueWork: async () => SOMETHING_DUE, ...NO_PHASE }); // the VISIT door reads the same row
    expect([await dispatch(NO_PHASE), rows.length]).toEqual([R(), 0]); });
  /** AN UNREADABLE OFF SWITCH IS NOT AN ON SWITCH. The read fail-softed to "not paused", so the one gate standing between an outage and a day of bought answers treated every unreachable database, every revoked permission and every deleted account row as the operator's permission to spend. Only an explicit, readable false opens this door now; the state that could not be read opens nothing and says why. */
  it("opens the visit door on an explicit readable false only: a thrown read, a missing account row and an explicit true each start zero research work", async () => {
    const paid: Partial<ResearchCycleSteps> = { dueWork: async () => SOMETHING_DUE, ...NO_PHASE };
    DB.readThrows = true; let rows = freshRepo(); await run(paid); expect(rows).toHaveLength(0); // an exception is never permission
    DB.readThrows = false; DB.missing.add(T); rows = freshRepo(); await run(paid); expect(rows).toHaveLength(0); // no account row is never permission
    DB.missing.clear(); PAUSED.add(T); rows = freshRepo(); await run(paid); expect(rows).toHaveLength(0); // the operator said stop
    PAUSED.delete(T); rows = freshRepo(); await run(paid); expect(rows).toHaveLength(1); }); // and the ONE state that spends: the switch read, and it read false
});
/** The rules themselves, on injected persisted state: no network, no clock tricks, no lease. */
describe("dueWork: what is genuinely owed, computed from persisted state only", () => {
  const parked = (ms: number) => ({ basis: "b1", topics: [{ topicKey: "t1", query: "haft seen", requirement: "exact_serp", retryAfter: new Date(ms).toISOString() }] });
  const base = { staleSources: async () => 0, checks: async () => ({ ...NO_CHECKS, done: 4, total: 4, answers: 4, due: 0 }), basis: async () => "b1", evidenceVersion: async () => 7, answersToAnalyze: async () => false, analysisFingerprint: async () => "fp1", consumedAnalyses: async () => "fp1",
    surfaceStale: async () => false, debt: async () => ({ measurable: 0, unverified: 0 }), pagesToCrawl: async () => false, factDebt: async () => ({ owed: 0, everChecked: true }), readyStock: async () => 5, creditHeld: async () => false,
    run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW + DAY),
      replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) };
  it("owes nothing when the sources are fresh, today's round has landed, the notes have not moved past the last decision, and the rest is waiting on a date I promised", async () => {
    const w = await dueWork(T, new Date(NOW), base);
    expect([w.due, w.readable, w.checks, w.cases, w.nextDueAt]).toEqual([[], true, { ...NO_CHECKS, done: 4, total: 4, answers: 4 }, { active: 0, parked: 1 }, new Date(NOW + DAY).toISOString()]); });
  it("names each owed unit from the ONE persisted fact that proves it", async () => {
    const due = async (o: Parameters<typeof dueWork>[2]) => (await dueWork(T, new Date(NOW), { ...base, ...o })).due; expect(await due({ staleSources: async () => 1 })).toEqual(["refresh_sources"]);
    expect(await due({ checks: async () => ({ ...NO_CHECKS, done: 2, total: 4, answers: 2, due: 2 }) })).toEqual(["daily_observations"]);
    expect(await due({ pagesToCrawl: async () => true })).toEqual(["crawl_pages"]); // a page of their own website I have never read is owed a batch; base says none is, which is the "nothing due" half
    expect(await due({ run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW - 1), replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) })).toEqual(["acquire_case_evidence"]);  // A retry date that PASSED is the same-day unlock: the promise I made has come due.
    expect(await due({ evidenceVersion: async () => 8, run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW + DAY), replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v8" } } }) })).toEqual(["plan_cases", "decide_and_prepare"]);  // The notes moved past what the last decision consumed: new evidence, so a plan and a decision are owed.
    expect(await due({ debt: async () => ({ measurable: 3, unverified: 0 }) })).toEqual(["verify_and_measure"]);
    expect(await due({ debt: async () => ({ measurable: 0, unverified: 1 }) })).toEqual(["verify_and_measure"]);  // A change marked implemented but never checked live owes the same unit. ONE ledger read answers both.
    expect(await due({ surfaceStale: async () => true })).toEqual(["publish_surfaces"]); let win: string[] = []; expect(await due({ answersToAnalyze: async (_t, f, t2) => { win = [f, t2]; return true; } })).toEqual(["analyze_answers"]);
    expect(await due({ analysisFingerprint: async () => "fp2" })).toEqual(["consume_analyses"]); // a reading settled on an answer already on file: evidence nobody has spent yet
    expect(await due({ consumedAnalyses: async () => null })).toEqual(["consume_analyses"]); // never harvested under this basis at all is the same debt, not a quiet zero
    expect(await due({ analysisFingerprint: async () => null })).toEqual([]); // no canonical answer at all is nothing to consume, so it is never owed
    expect(await due({ analysisFingerprint: async () => "fp2", consumedAnalyses: async () => "fp2" })).toEqual([]); // the pass that consumed it stamped what it consumed: the SAME debt is never emitted twice
    expect(win).toEqual([reportingDay(NOW - 6 * DAY), reportingDay(NOW)]); // A BOUNDED SEVEN DAY LOOK-BACK: the probe asked about TODAY only, so an answer bought yesterday and never read requeued only if a pass happened to run yesterday
    expect(await due({ run: async () => ({ open: true, progress: { decided: { basis: "b1", rowVersion: 7 }, replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) })).toEqual(["plan_cases"]);  // An OPEN run with no plan bound to this basis owes one; an idle account with no plan owes nothing.
    expect(await due({ run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) })).toEqual([]); });
  it("treats a completed pass's frozen plan as a receipt, not a standing queue: only an arrived retry date or a still-open run makes a topic owed", async () => {
    const plan = { basis: "b1", topics: [{ topicKey: "t1", query: "haft seen", requirement: "exact_serp" }] }; // frozen, no date promised
    const decided = { basis: "b1", rowVersion: 7 }; const due = async (open: boolean) => (await dueWork(T, new Date(NOW), { ...base, run: async () => ({ open, progress: { decided, focus: plan, replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) })).due;
    expect(await due(false)).toEqual([]); // the pass that froze it CONSUMED it: a quiet account takes the zero-cost exit
    expect(await due(true)).toEqual(["acquire_case_evidence"]); // the run that froze it is still open and genuinely owes the work
    expect((await dueWork(T, new Date(NOW), { ...base, run: async () => ({ open: false, progress: { decided, focus: parked(NOW - 1), replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) })).due) .toEqual(["acquire_case_evidence"]); });  // And a date I promised that has ARRIVED is owed whether or not a run is open.
  /** A COUNT IS NOT A REASON TO STOP WORKING. Replenish was due only while the stock sat BELOW five, so an account holding fourteen finished changes was never asked and Update Data answered "nothing due" with real evidenced work standing unwritten. What ends a day is a SETTLED MANIFEST, never a quantity. */
  it("keeps asking for work above the stock floor, and stops only on a proven exhaustion", async () => {
    const closed = (n: number) => ({ ...base, readyStock: async () => n, run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW + DAY), replenish: { day: reportingDay(NOW), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) }); expect([(await dueWork(T, new Date(NOW), closed(5))).due, (await dueWork(T, new Date(NOW), closed(4))).due]).toEqual([[], []]); // a SETTLED manifest holds the day shut at any count
    const open = (n: number) => ({ ...base, readyStock: async () => n, run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW + DAY) } }) });
    for (const n of [0, 4, 5, 14, 40, 100, 500]) expect((await dueWork(T, new Date(NOW), open(n))).due, `at ${n} Ready rows the work is still due`).toEqual(["replenish_ready"]); }); // THE OPERATOR'S ACCEPTANCE COUNTS (2026-08-30): at 0, at the old floor, and far past it, eligibility is identical.
  it("reopens an exhausted day the moment the evidence behind it moves, without waiting for tomorrow", async () => {
    const shut = { ...base, readyStock: async () => 0, run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW + DAY), replenish: { day: reportingDay(NOW), jobs: { "/a::wc3::b1": { calls: 1, last: "deterministic_refusal", settled: true } }, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) };
    expect((await dueWork(T, new Date(NOW), shut)).due).toEqual([]); // exhausted under version 7, and it stays shut while that is the question
    expect((await dueWork(T, new Date(NOW), { ...shut, evidenceVersion: async () => 8 })).due).toContain("replenish_ready"); }); // version 8 arrives the same day and those same pages are owed again
  it("says UNREADABLE rather than empty when ANY durable signal cannot be read, so a caller never mistakes a failed read for a healthy idle", async () => {
    const blind = await dueWork(T, new Date(NOW), { ...base, run: async () => { throw new Error("db down"); } }); expect([blind.readable, blind.due]).toEqual([false, []]);
    const noPlan = await dueWork(T, new Date(NOW), { ...base, checks: async () => null }); expect(noPlan.readable).toBe(false);
    const down = async () => { throw new Error("down"); }; // EVERY signal, not just the two: a swallowed read answered 200 with an empty due list over a day it could not judge. An individually EMPTY signal is untouched by that, which is what `base` is
    for (const k of ["staleSources", "basis", "evidenceVersion", "surfaceStale", "debt", "pagesToCrawl", "answersToAnalyze", "analysisFingerprint", "consumedAnalyses", "factDebt", "readyStock", "creditHeld"] as const) expect([k, (await dueWork(T, new Date(NOW), { ...base, [k]: down })).readable]).toEqual([k, false]);
    expect((await dueWork(T, new Date(NOW), base)).readable).toBe(true); expect((await dueWork("", new Date(NOW), base)).readable).toBe(false); }); // no tenant, no answer, no I/O
});
/** FINISHING BEFORE ACQUISITION (operator, 2026-08-22; count semantics deleted 2026-08-30): the drive runs the finishing step in front of the first exploratory-evidence phase, exactly once per drive. The count on its receipt is the low-stock alarm; it sizes and closes nothing. */
describe("the cycle finishes stored work before it buys exploratory evidence", () => {
  const REPLENISHED = { ready: 5, deficit: 0, persisted: 2, satisfied: true, reason: "candidates_exhausted" as const, jobs: {}, closedUnder: "b1::v1" };
  /** WHAT WAS ALREADY PAID FOR IS FINISHED FIRST, AND IT IS FREE (falsifier, 2026-09-02): posted provider tasks are charged at post and collected with a GET, and the only collector ran on a scheduler tick that never fires while hosting is paused, so results pages this account had already bought sat pending for days and every gate asking for one answered no. */
  it("collects what was already paid for before it funds a single draft, calls the inventory step once before the keyword phase's own unit, and never on a reading-only debt pass", async () => {
    const order: string[] = []; const rows = withRun(); await run({ ...healthySteps(order), collectBought: async () => (order.push("collect"), { pending: 3, ready: 2 }),
      replenishReady: async () => (order.push("replenish"), REPLENISHED),
      funnelUnit: async (phase) => (order.push(`unit:${phase}`), { status: "done" as const, cursor: null, progress: {} }) });
    const [collectAt, replenishAt, firstBuy] = ["collect", "replenish", "unit:keyword_discovery"].map((x) => order.indexOf(x));
    expect([collectAt >= 0, collectAt < replenishAt, firstBuy > replenishAt, order.filter((x) => x === "replenish").length, rows.at(-1)!.progress?.collected], "the free collection runs first, the inventory step exactly once before any buying, and what the collection found is written onto the run").toEqual([true, true, true, 1, { pending: 3, ready: 2 }]);});
  it("buys no evidence on a drive with no room to check a SHORT stock, and leaves the phase for the next one", async () => {
    const walked: string[] = [], rows = withRun({ current_phase: "keyword_discovery", progress: { plan: { units: ["replenish_ready", "plan_cases"] } } });
    await run({ ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready", "plan_cases"] }), replenishReady: async () => (walked.push("replenish"), null),
      funnelUnit: async (phase) => (walked.push(phase), { status: "done" as const, cursor: null, progress: {} }) }, 40_000); // under the floor the check needs, so it cannot even be attempted
    expect([walked, rows.at(-1)!.status, rows.at(-1)!.current_phase]).toEqual([[], "paused", "keyword_discovery"]); }); // nothing bought, the phase untouched, the next dispatch resumes here with a whole drive
  it("stamps the day only once the step PROVED an exhaustion, and nothing at all when the top-up did not land", async () => {
    for (const answer of [null, { ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: {} },
      { ready: 2, deficit: 3, persisted: 2, satisfied: false, reason: "made_progress" as const, jobs: {} }]) {
      const rows = withRun({ current_phase: "keyword_discovery" }); await run({ ...healthySteps([]), replenishReady: async () => answer }); expect(rows.at(-1)!.progress?.replenish?.closed, `closed on ${JSON.stringify(answer)}`).toBeUndefined();}
    const proved = withRun({ current_phase: "keyword_discovery" }); await run({ ...healthySteps([]), replenishReady: async () => REPLENISHED });
    expect([proved.at(-1)!.progress?.replenish?.day, proved.at(-1)!.progress?.replenish?.closed]).toEqual([ckey(T, NOW).slice(-10), "candidates_exhausted"]);});
  /** WHAT MAY END A DAY'S OBLIGATION, driven through the REAL defaultSteps on the producer's OWN PER-JOB RECEIPTS. The fiction this replaces: one aggregate "calls were charged" number was read as "every funded page was attempted", and allowances are decremented BEFORE the gateway is called, so a single out-of-quota call could write off four pages nobody ever asked about and then close the day as exhausted (Codex, 2026-08-22). AND A STOCKED COUNT CHANGES NOTHING (operator, 2026-08-30): the drive used to size its buy off "floor minus ready" and a separate $0 pre-pass proved the count before a day could close, and both are deleted, so the shape of the one call this makes is pinned here too. */
  it("writes a page off only on its own settled receipt, and never on a blocked, unreached or unreadable pass", async () => {
    const M = { ready: 0, declared: ["/a", "/b", "/c", "/d", "/e"], out: [] as { key: string; outcome: string; why?: string; cost?: number }[], outcome: "proposals_persisted", throws: false, owed: [] as unknown[], lands: true, evidence: "e1", asked: [] as { produce?: boolean; bypassCache?: boolean; maxDrafts?: number; memory?: Readonly<Record<string, { calls: number; last: string; settled: boolean }>> }[] }; vi.resetModules();
    const L = { seq: [] as number[] }; // what the provider ledger answers, drained one read at a time
    vi.doMock("@/lib/cost/budget-ledger-supabase", () => ({ getTenantSpentThisMonthUsd: async () => (L.seq.length > 0 ? L.seq.shift()! : 0) }));
    vi.doMock("@/domains/decision/llm/gateway", () => ({ creditBreakerHeld: async () => false }));
    vi.doMock("@/domains/decision", () => ({ resolveCurrentBasis: async () => "b", stockOf: (rows: unknown[]) => rows.length, loadProposalQueue: async () => (M.ready < 0 ? Promise.reject(new Error("queue unreadable")) : { ready: Array.from({ length: M.ready }, () => ({})) }),
      produceProposalsForTenant: async (_t: string, o: { maxDrafts?: number; produce?: boolean; bypassCache?: boolean; memory?: Readonly<Record<string, { calls: number; last: string; settled: boolean }>>; handOver?: (ask: () => { paid: unknown; persisted: number }) => void }) => { if (M.throws) throw new Error("the provider fell over");
        M.asked.push(o); const wk = (k: string) => `${k}::wc3::${M.evidence}`; // the identity a workKey carries: the funding key, the writer contract, and the evidence behind THIS job
        const funded = M.declared.filter((k) => { const m = o.memory?.[wk(k)]; return m?.settled !== true && (m?.calls ?? 0) < 2; }); // the plan's own two questions, asked of the WORK and never of the page
        const receipts = funded.map((key) => { const hit = M.out.find((r) => r.key === key); return { key, workKey: wk(key), funded: true, treatment: "add_answer_section", impact: 5, allowance: 6, ops: 2, providerCalls: hit?.outcome === "not_reached" || !hit ? 0 : 3, costUsd: hit?.cost ?? 0, providerAttempted: true, outcome: (hit?.outcome ?? "not_reached") as never, ...(hit?.why ? { why: hit.why } : {}) }; });
        M.ready += M.lands ? receipts.filter((r) => r.outcome === "produced").length : 0; // `lands: false` holds the queue still, which is the case the deleted stock-delta rule got wrong
        const paid = { declared: M.declared, funded, attemptUnitsSpent: funded.length * 3, receipts, evidenceOwed: M.owed }; o.handOver?.(() => ({ paid, persisted: 0 })); // the walk hands its caller a way to read this record before it starts a funded job, which is what a boxed drive reads instead of losing the pass
        return { persisted: 0, held: [], outcome: M.outcome, paid }; } }));
    try {
      const { defaultSteps: live } = await import("@/domains/runtime/ops/research-steps"); let mem: { jobs: Record<string, { calls: number; last: string; settled: boolean }> } = { jobs: {} };
      const drive = async () => { const r = await live.replenishReady(T, new Date(NOW), mem); if (r) mem = { jobs: r.jobs }; return r && [r.ready, r.reason, Object.values(r.jobs).filter((j) => j.settled).length]; };
      /* AND THE SAME ARITHMETIC ANSWERS A WALK THAT WAS CUT OFF (live 13:00Z and 13:30Z drives, 2026-09-05): the caller's box ended while a rewrite was still running and the whole pass was discarded, so the day's memory, the waiting list, the receipts and 37 provider calls over two drives were remembered by nothing. What the walk hands back mid-flight is composed by this one function, so a boxed drive records the same day memory, the same queue positions and the same receipts as a walk that ran to its end, and it may never close the day. */
      { let handed: (() => unknown) | null = null; M.out = [{ key: "/a", outcome: "produced" }]; const whole = await live.replenishReady(T, new Date(NOW), { jobs: {}, filed: (f) => { handed = f; } }) as { jobs: unknown; waiting?: unknown; outcomes?: { receipts?: unknown[] } }, boxed = (handed as unknown as (() => { jobs: unknown; waiting?: unknown; reason: string; satisfied: boolean; outcomes?: { receipts?: unknown[] } }))();
        expect([boxed.jobs, boxed.waiting, (boxed.outcomes?.receipts ?? []).length, boxed.reason, boxed.satisfied], "a walk read at the box carries the same memory, the same waiting list and the same receipts the finished walk reports, and it is retryable rather than progress or an exhaustion, because it never re-read the stock it was cut off from").toEqual([whole.jobs, whole.waiting, (whole.outcomes?.receipts ?? []).length, "retryable_blocked", false]);
        M.ready = 0; mem = { jobs: {} }; M.out = []; M.asked.length = 0; } // the reading above is not one of the drives the sequence below counts
      M.out = [{ key: "/a", outcome: "retryable_blocked" }]; expect(await drive()).toEqual([0, "retryable_blocked", 0]); // 1. five funded, the first call out of quota, the rest never reached: not one page written off, the day stays open
      expect([Object.entries(mem.jobs).map(([k, m]) => [k, m.calls, m.settled, (m as { waited?: number }).waited ?? 0]), M.asked.length, M.asked[0]!.produce, M.asked[0]!.bypassCache, "maxDrafts" in M.asked[0]!], "P3: A JOB NOBODY STARTED IS UNSPENT AND STILL OWED. Four of the five were funded and never reached: not one is written off, each is remembered at ZERO calls and unsettled so it is owed at its own rank next drive, and NOTHING ELSE is recorded against it. The count of drives it went unreached is gone (measured, 2026-09-05): it fed a demotion that could never release, because demoted work is never reached and so only ever waited again, and worth orders the manifest instead. And no count gates the buy: ONE call is the whole pass, dispatched to produce, and nothing inventory-shaped rides it. A FRESH PAID TAKE IS FOR A RETRY: this day has tried nothing yet, so an ask identical to one already paid for and validated is served from the cache").toEqual([[["/a::wc3::e1", 1, false, 0], ["/b::wc3::e1", 0, false, 0], ["/c::wc3::e1", 0, false, 0], ["/d::wc3::e1", 0, false, 0], ["/e::wc3::e1", 0, false, 0]], 1, true, false, false]);
      M.out = [{ key: "/a", outcome: "retryable_blocked" }, { key: "/b", outcome: "retryable_blocked" }]; expect([await drive(), M.asked[1]!.bypassCache], "2. a transient failure on one page before the others are reached writes off neither, and now that the day holds an attempt that took real calls and finished nothing, the next walk takes a fresh paid take: the retry exists to get different words").toEqual([[0, "retryable_blocked", 0], true]);
      for (const bad of ["evidence_unreadable", "persistence_failed"]) { M.outcome = bad; expect(await drive()).toEqual([0, "retryable_blocked", 0]); } // 3. an unreadable pass, one that could not save, and a throw each settle nothing
      M.outcome = "proposals_persisted"; M.throws = true; expect(await drive()).toEqual([0, "retryable_blocked", 0]); M.throws = false;
      M.asked.length = 0; M.out = M.declared.map((key) => ({ key, outcome: "deterministic_refusal" })); expect(await drive()).toEqual([0, "retryable_blocked", 4]); // P4: /a spent two real attempts and finished nothing, so the plan declines it on the third pass; /b, on one attempt, is still funded, and it and the three never started settle here
      expect([mem.jobs["/a::wc3::e1"], M.asked.at(-1)!.memory?.["/a::wc3::e1"]], "the ledger carries what each attempt cost and how it ended, and the plan reads exactly that").toEqual([{ calls: 2, last: "retryable_blocked", settled: false }, { calls: 2, last: "retryable_blocked", settled: false }]);
      mem = { jobs: {} }; expect(await drive()).toEqual([0, "candidates_exhausted", 5]); // 4. settled receipts are the only thing that writes a page off, and only a fully settled manifest exhausts
      M.declared = ["/f"]; M.out = [{ key: "/f", outcome: "produced" }]; expect(await drive()).toEqual([1, "made_progress", 6]); // 5. credit returning later the SAME DAY finishes the page that was blocked, on a manifest that moved on, and the ledger ACCUMULATES: the five settled above are still remembered beside it
      // 4b. A READING STILL OWED IS WORK STILL OWED, and WORK THE QUEUE CANNOT SEE SETTLES NOTHING (falsifiers, 2026-09-02): the day closed `candidates_exhausted` over an acquisition it had just minted, and over two rows the store accepted that the ready queue never carried.
      M.declared = ["/j"]; M.out = [{ key: "/j", outcome: "deterministic_refusal" }]; mem = { jobs: {} };
      M.owed = [{ key: "/j", kind: "serp", query: "persian wolf", reasonCode: "no_exact_serp", reason: "no results page is on file", workKey: "w" }];
      expect((await drive())?.[1], "every declared key is settled and an acquisition is still in flight, so the day stays open").toBe("retryable_blocked");
      // R3. THE RECEIPT IS THE AUTHORITY, NEVER THE STOCK DELTA. The producer re-reads every produced claim against the row standing on file when its pass ends and refiles the ones that are not ready as `review_saved`, so the runtime trusts what it is handed. A stock delta cannot: one real landing beside one phantom moves the count, and the rule that used to live here settled BOTH.
      M.owed = []; M.lands = false; M.declared = ["/k", "/l"]; M.out = [{ key: "/k", outcome: "produced" }, { key: "/l", outcome: "review_saved" }]; mem = { jobs: {} }; const mixed = await live.replenishReady(T, new Date(NOW), mem);
      expect([mixed!.reason, mixed!.jobs["/k::wc3::e1"]!.settled, mixed!.jobs["/l::wc3::e1"]!.settled], "one real landing beside one phantom the producer already downgraded, with the queue standing still: only the real one settles, the day cannot close over the other, and a COUNT decides neither").toEqual(["retryable_blocked", true, false]); M.lands = true;
      M.ready = 0; M.declared = ["/g", "pattern:x"]; mem = { jobs: {} }; // 6. THE REFUSAL'S OWN WORDS REACH THE DAY'S MEMORY, and a reading of the winning pages is banked EVIDENCE, never a change anybody can act on.
      M.out = [{ key: "/g", outcome: "deterministic_refusal", why: "the closing line tells the reader to read the page" }, { key: "pattern:x", outcome: "evidence_banked" }]; const last = await live.replenishReady(T, new Date(NOW), mem);
      expect([last!.outcomes!.readySaved, last!.outcomes!.evidenceBanked, last!.outcomes!.refused, last!.outcomes!.stuck.join(" ").includes("the closing line tells the reader to read the page")]).toEqual([0, 1, 1, true]);
      // 7. P5/P6: A CORRECTED JOB RUNS AGAIN TODAY. The two pages this matters for by name: both were refused today under the evidence then on file, and the old page-keyed memory answered "already tried those" until midnight however much the evidence moved. A banked reading gives the work a different `workKey`, which the day remembers nothing about, so it is funded again by rank and never skipped.
      M.ready = 0; M.declared = ["/basic-persian-phrases", "/funny-farsi-phrases"]; M.out = M.declared.map((key) => ({ key, outcome: "deterministic_refusal" })); mem = { jobs: {} }; expect((await drive())?.[1]).toBe("candidates_exhausted");
      M.asked.length = 0; M.out = M.declared.map((key) => ({ key, outcome: "produced" })); const settledUnder = { ...mem.jobs };
      expect((await drive())?.[1], "settled under the evidence in hand, nothing is funded and the day stays shut").toBe("candidates_exhausted");
      M.evidence = "e2"; const reopened = await live.replenishReady(T, new Date(NOW), mem); // the reading landed: same pages, same families, different evidence
      expect([reopened!.reason, reopened!.ready > 0, Object.keys(settledUnder).every((w) => reopened!.jobs[w]?.settled === true), Object.keys(reopened!.jobs).length], "the same page is written the SAME DAY under its new identity, and what the old identity settled is still remembered beside it").toEqual(["made_progress", true, true, 4]); M.evidence = "e1";
      L.seq = [1.0, 1.02]; M.ready = 0; M.declared = ["/h"]; mem = { jobs: {} }; M.out = [{ key: "/h", outcome: "produced", cost: 0.02 }]; // 8. THE LEDGER'S OWN ANSWER RIDES BESIDE THE RECEIPTS, both directions. A world that moved more than the receipts explain is REPORTED as unreconciled, never patched. (The COMPLETENESS of a receipt is proved
      expect((await live.replenishReady(T, new Date(NOW), mem))!.outcomes!.ledger).toEqual({ before: 1.0, after: 1.02, delta: 0.02, metered: 0.02, unexplained: 0, reconciled: true });
      L.seq = [1.0, 1.9]; M.ready = 0; M.declared = ["/i"]; mem = { jobs: {} }; M.out = [{ key: "/i", outcome: "produced", cost: 0.02 }];
      expect((await live.replenishReady(T, new Date(NOW), mem))!.outcomes!.ledger).toEqual({ before: 1.0, after: 1.9, delta: 0.9, metered: 0.02, unexplained: 0.88, reconciled: true }); // the receipts never claimed more than the ledger saw; the 0.88 the drafting meter cannot explain is NAMED, not called a mismatch
    } finally {
      vi.doUnmock("@/lib/cost/budget-ledger-supabase"); vi.doUnmock("@/domains/decision"); vi.doUnmock("@/domains/decision/llm/gateway"); vi.resetModules(); }});
  /** THE OBLIGATION AT SCHEDULER LEVEL, not four calls to the helper (Codex, 2026-08-22). The runtime used to make no promise at all: replenishReady tops up by at most two, the drive asks once, and dueWork did not count a Ready shortage as owed work, so a queue could go 0 to 2, the run could finish, and the account would sit three changes short until some UNRELATED debt happened to open the next run. Here the REAL dueWork decides what is owed and the REAL runner performs each dispatch. */
  /** THE DISPATCH GOES AND GETS THE READING A REFUSED CANDIDATE NAMED (Codex, 2026-08-23). Storing it, logging it and  checking it as a boolean is not acquisition: /persian-female-first-names named the exact search it needed, the  dispatch ended, and the next drive drafted from the same missing evidence. Proved through the REAL runtime. */
  it("buys exactly the search a funded candidate was refused for, even on a run that opened only for the stock", async () => {
    const asked: Array<{ kind: string; query: string; basis: string }> = [];
    const rows = withRun({ current_phase: "keyword_discovery", progress: { plan: { units: ["replenish_ready"] } } });
    await run({ ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready"] }),
      acquireEvidence: async (_t, need, basis) => { asked.push({ kind: need.kind, query: need.query, basis: basis ?? "(none)" }); return { acquired: true, detail: "bought" }; },
      replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const,
        jobs: {},
        evidenceOwed: [{ key: "/persian-female-first-names", kind: "serp" as const, query: "persian girl names", reasonCode: "no_exact_serp",
          reason: "No results page is on file", workKey: "wk-1" }] }) });
    expect(asked.map((a) => ({ kind: a.kind, query: a.query }))).toEqual([{ kind: "serp", query: "persian girl names" }]); // the EXACT search, not a topic the run picked
    expect(asked[0]!.basis).not.toBe("(none)"); // AND IT CARRIES THE RUN'S BASIS: a null one failed before reading anything
    void rows; const asked2: string[] = []; withRun({ current_phase: "keyword_discovery", progress: { plan: { units: ["replenish_ready"] }, evidenceOwed: [{ key: "/persian-female-first-names", kind: "serp" as const, query: "persian girl names", reasonCode: "no_exact_serp", reason: "No results page is on file", workKey: "wk-1", boughtOn: ckey(T, NOW).slice(-10) }] } }); await run({ ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready"] }), acquireEvidence: async (_t, need) => { asked2.push(need.query); return { acquired: true, detail: "bought" }; }, replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: {}, evidenceOwed: [{ key: "/persian-female-first-names", kind: "serp" as const, query: "persian girl names", reasonCode: "no_exact_serp", reason: "No results page is on file", workKey: "wk-1" }] }) }); expect(asked2, "a reading bought today that left the same refusal standing is not bought again today, before the walk or after it").toEqual([]); });
  /** EVERY PAID ACQUISITION NAMES THE DECISION IT UNLOCKS, AND ONE PURCHASE SERVES EVERY ROW THAT OWES IT (operator, 2026-09-05). On the live account ten funded jobs ended a pass owing readings the same day had already paid for, and nothing durable said which row's obligation the money was for or whether it was met: the only trace was a log line. Two rows owing one page's source pass each ran their own, measured on eight of nine live run rows. */
  it.each([T, U])("names on the run row which row and which funding identity every reading was bought to unlock, buys one reading once however many rows owe it, and writes a reading that landed without moving its obligation onto the need instead of re-owing it in silence [%s]", async (tenant) => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: tenant, cycle_key: ckey(tenant, NOW), current_phase: "keyword_discovery", progress: { plan: { units: ["replenish_ready"] } } }));
    const asked: string[] = [], owed = [
      { key: "/one::body", kind: "factual_source" as const, query: "how deep is the well", url: "https://me.example/one", missingTopic: "how deep is the well", reasonCode: "acquire_factual_source", reason: "nothing checked on file answers it, so the source comes before the copy.", workKey: "wk-one" },
      { key: "/one::title", kind: "factual_source" as const, query: "the well", url: "https://me.example/one", missingTopic: "how deep is the well", reasonCode: "claim_unsourced", reason: "it stands only on this page saying so, so it is held until a source is on file.", workKey: "wk-one-title" },
      { key: "/two::meta", kind: "serp" as const, query: "well covers", reasonCode: "no_exact_serp", reason: "no results page for it is on file, so the reading comes first.", workKey: "wk-two" }];
    await runResearchCycle(tenant, { now: () => new Date(NOW), steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready"] }),
      acquireEvidence: async (_t, need) => { asked.push(`${need.kind}::${need.missingTopic ?? need.query}`); return need.kind === "serp" ? { acquired: true, detail: "the results page is on file" } : { acquired: true, unlocked: false, detail: `fact check of the page: done, 3 banked; the answer to "how deep is the well" is researched, and what came back is rated likely and does not meet the evidence rules copy must stand on` }; },
      replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: {}, evidenceOwed: owed }) } });
    const got = rows[0]!.progress.acquisitions ?? [];
    expect(asked, "one reading, one purchase: the second row owing the same page and the same missing answer reads the first purchase's result for free").toEqual(["factual_source::how deep is the well", "serp::well covers"]);
    expect(got.map((a) => [a.key, a.workKey, a.reasonCode, a.outcome, a.sharedWith ?? []]), "every purchase names the row that owes it, the funding identity behind that row, the requirement code it answers, and a typed outcome").toEqual([
      ["/one::body", "wk-one", "acquire_factual_source", "read_not_usable", ["/one::title"]],
      ["/one::title", "wk-one-title", "claim_unsourced", "read_not_usable", ["/one::body"]],
      ["/two::meta", "wk-two", "no_exact_serp", "unlocked", []]]);
    expect(got[1]!.detail.startsWith("served by the purchase this drive already made:"), "the shared row says whose purchase answered it rather than claiming a second one").toBe(true);
    expect((rows[0]!.progress.evidenceOwed ?? []).find((n) => n.key === "/one::body")!.reason, "a reading that was paid for and cannot carry the answer leaves that fact on the need, so the next receipt for that row is not the same sentence as before the money was spent").toBe('nothing checked on file answers it, so the source comes before the copy. A source for it was read on this drive and cannot carry the answer yet, so a stronger one is owed before the copy: the answer to "how deep is the well" is researched, and what came back is rated likely and does not meet the evidence rules copy must stand on.'); });
  /** THE RECEIPTS ON A RUN ROW ARE THE RECEIPTS OF THE PASS THAT PRODUCED THEM (R2 residual 6, 2026-09-05). The day's memory travels with the day, which is what it is for, and the receipts used to travel with it: three consecutive live run rows reported one earlier pass's funded outcomes because each made no provider call of its own and kept what it inherited. */
  it.each([T, U])("carries the day's attempt ledger into a second same-day pass and never that pass's receipts, and stamps the pass that earned the ones it does carry [%s]", async (tenant) => {
    const rows = freshRepo(); const day = ckey(tenant, NOW).slice(-10);
    rows.push(mk({ id: "earlier", tenant_id: tenant, cycle_key: `${tenant}:p1:${day}`, status: "completed", current_phase: "done", completed_at: iso(),
      progress: { replenish: { day, jobs: { "wk-old": { calls: 4, last: "produced", settled: true } }, outcomes: { pass: `${tenant}:p1:${day}`, readySaved: 1, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [], receipts: [{ key: "/spent", funded: true, providerCalls: 4, outcome: "produced" }] } } } }));
    await runResearchCycle(tenant, { now: () => new Date(NOW), steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready"] }),
      replenishReady: async (_t, _n, was) => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: { ...(was?.jobs ?? {}), "wk-new": { calls: 0, last: "not_reached", settled: false } },
        outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 1, stuck: [], receipts: [{ key: "/free", funded: true, providerCalls: 0, outcome: "not_reached" }] } }) } });
    const fresh = rows.find((r) => r.id !== "earlier")!.progress.replenish!;
    expect(Object.keys(fresh.jobs).sort(), "the day's attempt ledger still travels with the day, so a second pass does not re-fund what the first one settled").toEqual(["wk-new", "wk-old"]);
    expect([(fresh.outcomes!.receipts as { key: string }[]).map((r) => r.key), fresh.outcomes!.pass], "and the receipts are this pass's own, naming the pass that earned them, however little it spent").toEqual([["/free"], rows.find((r) => r.id !== "earlier")!.cycle_key]); });
  /** A DRIVER THAT DIES MID-RUN (live, 2026-09-05: a production pass was left `running` at 03:28Z with its lease expired at 03:37Z, and the next drive reclaimed and completed the SAME row at 03:47Z). Nothing rolls it back and nothing else may take the account while the lease is alive; the next tick takes the same row, keeps the phase, the cursor and the day's memory, and finishes it. */
  it.each([T, U])("reclaims a run whose driver died: the same row is taken once its lease expires, with its phase, cursor and day memory intact, and it completes as one run rather than a second one [%s]", async (tenant) => {
    const rows = freshRepo(); const day = ckey(tenant, NOW).slice(-10), cursor = { phase: "keyword_discovery", attemptKey: "k9" };
    rows.push(mk({ id: "abandoned", tenant_id: tenant, cycle_key: `${tenant}:p8:${day}`, status: "running", current_phase: "keyword_discovery", phase_cursor: cursor, lease_owner: "the-driver-that-died", lease_expires_at: iso(NOW + LEASE),
      progress: { plan: { units: ["replenish_ready"] }, replenish: { day, jobs: { "wk-half-done": { calls: 2, last: "evidence_required", settled: false } } } } }));
    expect(await RR.claimRun(tenant, "next-tick"), "while the dead driver's lease is still alive nothing else takes the account").toBeNull();
    rows[0]!.lease_expires_at = iso(NOW - 1);
    await runResearchCycle(tenant, { now: () => new Date(NOW), steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready"] }),
      replenishReady: async (_t, _n, was) => ({ ready: 5, deficit: 0, persisted: 0, satisfied: true, reason: "candidates_exhausted" as const, jobs: { ...(was?.jobs ?? {}) }, closedUnder: "b1::v1" }) } });
    expect([rows.length, rows[0]!.id, rows[0]!.status, rows[0]!.lease_owner], "one row, reclaimed and finished: an abandoned run is never left behind for a second row to duplicate").toEqual([1, "abandoned", "completed", null]);
    expect(Object.keys(rows[0]!.progress.replenish!.jobs), "and the work the dead driver had already paid for is still remembered, so the reclaiming pass does not fund it again").toEqual(["wk-half-done"]); });
  /** THE ONE REQUIREMENT THAT BUYS NO NEW READING (operator, 2026-09-02): the copy is already final and its sources are already banked beside it, and what is missing is that nobody has read the two together. Filed as a `factual_source` before this case existed, so the runtime went and bought facts while the reading stayed untaken for ever. */
  it("takes the owed reading by loading the ONE change it names, saving what came back, and buys nothing at all for a requirement that names no change", async () => {
    vi.resetModules(); const S = { loaded: [] as string[], saved: [] as Array<Record<string, unknown>> };
    vi.doMock("@/domains/decision/proposal-store", () => ({ loadChangeProposal: async (_t: string, id: string) => (S.loaded.push(id), { id, primaryQuery: "persian wolf" }), saveChangeProposal: async (p: Record<string, unknown>) => (S.saved.push(p), "saved") }));
    vi.doMock("@/domains/decision/drafted-copy", () => ({ reviewFinishedCopy: async (p: Record<string, unknown>) => ({ row: { ...p, semanticReview: { of: "k", version: 5, claims: [{ i: 0, by: ["fact-1"], entailed: true }] } }, detail: "the reading landed and its rulings are banked claim by claim" }) }));
    try { const { defaultSteps: live } = await import("@/domains/runtime/ops/research-steps"); const ID = `${T}::/persian-wolf::existing_edit::missing_description`;
      const got = await live.acquireEvidence(T, { kind: "semantic_review", query: "persian wolf", proposalId: ID }, "b1", 5_000);
      const bare = await live.acquireEvidence(T, { kind: "semantic_review", query: "persian wolf" }, "b1", 5_000);
      expect([got.acquired, S.loaded, !!S.saved[0]?.semanticReview, bare.acquired, bare.detail.includes("names no change"), S.loaded.length], "one row by its own id, read and saved with the ruling on it; a requirement with no change named reads nothing and says so").toEqual([true, [ID], true, false, true, 1]);
    } finally { vi.doUnmock("@/domains/decision/proposal-store"); vi.doUnmock("@/domains/decision/drafted-copy"); vi.resetModules(); } });
  /** THE CURSOR IS THE RANKING (Codex, 2026-08-23). A candidate selected and not started is owed FIRST: it never enters the day's memory at all, so the next continuation ranks it exactly where its impact puts it. The deferral this replaces sent the account's strongest page to the back for three dispatches running. */
  it("carries the day's one ledger from drive to drive, and holds no entry for work nobody started", async () => {
    type Mem = Record<string, { calls: number; last: string; settled: boolean }>; const seen: Mem[] = []; const rows = withRun({ current_phase: "keyword_discovery", progress: { plan: { units: ["replenish_ready"] } } });
    const drive = async (jobs: Mem) => { await run({ ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["replenish_ready"] }),
        replenishReady: async (_t, _n, was) => { seen.push({ ...(was?.jobs ?? {}) });
          return { ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs }; } });};
    const ledger: Mem = { "/settled::wc3::e1": { calls: 1, last: "deterministic_refusal", settled: true } };
    await drive(ledger); // /strong was funded and never reached, so it has no entry at all
    expect(rows.at(-1)!.progress?.replenish?.jobs).toEqual(ledger);
    expect(JSON.stringify(rows.at(-1)!.progress?.replenish)).not.toMatch(/attempted|tried|spent|fingerprint|deferred/); // the four page-keyed lists and the manifest fingerprint are deleted, not renamed
    await drive(ledger);
    expect(seen.at(-1)).toEqual(ledger); }); // the next drive is handed exactly what the last one learned, and nothing else
  /** P1, P2, P12. A FACT BANKED IN THIS DRIVE HIRES ITS WRITER IN THIS DRIVE. The walk runs once, at the first stock phase, and the fact check is a LATER phase, so a proposition researched at 02:29 could reach the writer no earlier than the next invocation, by which time the day had written its key off (live, cobra and jersey, 2026-09-03). It still does, from the door that matters: on a day the walk has already closed or already run, the units bank and the awakened walk hires the writer behind them. */ it("walks again in the same drive when a fact lands for funded work, resumes exactly that work when the box ends first, and never lets one account's ledger reach another", async () => {
    const day = ckey(T, NOW).slice(-10), WOLF = "/persian-wolf", KEY = `${WOLF}::wc3::e1`, need = { key: WOLF, kind: "factual_source" as const, query: "is the persian wolf a subspecies", reasonCode: "no_fact", reason: "the page does not answer this question yet", workKey: KEY }, owed = { [KEY]: { calls: 1, last: "evidence_required", settled: false } };
    const seed = (tenant = T) => { const rows = freshRepo(); rows.push(mk({ tenant_id: tenant, cycle_key: ckey(tenant, NOW), current_phase: "fact_check", progress: { plan: { units: ["check_page_facts"] }, evidenceOwed: [{ ...need, boughtOn: day }], replenish: { day, jobs: owed } } })); return rows; };
    const walks: Array<Record<string, unknown>> = [], bought: string[] = [], spent: number[] = [], order: string[] = []; let round = 0, shut2 = 0; const walk = (reason: "retryable_blocked" | "candidates_exhausted"): ResearchCycleSteps["replenishReady"] => async (_t, _n, was) => (walks.push({ ...(was?.jobs ?? {}) }), order.push("walk"), spent.push(was?.callsSpent ?? 0), round += 1, { ready: 0, deficit: 5, persisted: 0, satisfied: false, reason, closedUnder: "basis_test::v", jobs: { ...owed, [`r${round}`]: { calls: round, last: "review_saved", settled: false } }, evidenceOwed: [need], outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 1, unreached: 0, stuck: [], receipts: [{ providerCalls: 7 }] } });
    const steps = (reason: "retryable_blocked" | "candidates_exhausted", fact: ResearchCycleSteps["factCheck"]): Partial<ResearchCycleSteps> => ({ ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["check_page_facts"] }), acquireEvidence: async (_t, n) => (bought.push(n.query), { acquired: true, detail: "bought" }), replenishReady: walk(reason), researchOwed: async (_t, p) => (p.includes(WOLF) ? [WOLF] : []), factCheck: async (...a) => (order.push("facts"), fact(...a)) });
    const shut = () => { rows = seed(); Object.assign(rows.at(-1)!.progress!, { evidenceOwed: [], replenish: { day, jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "basis_test::v" } }); walks.length = 0; }; // R1. A DAY THAT HAS CLOSED: `candidates_exhausted` is earned only with an empty owed list and nothing unsettled, so the ledger and the owed list are empty BY CONSTRUCTION and the exhaustion held until midnight however much evidence landed. It still holds while nothing moves; a fact banked for a page whose STORED research row owes a reading reopens it on the fact itself, in the same drive, and due-work owes the stock again on the next invocation
    let rows = seed(); await run(steps("retryable_blocked", async () => ({ status: "advanced" as const, banked: 1, bankedPages: [WOLF], pagesComplete: 0 })));
    expect([order, walks.length, bought, rows.at(-1)!.progress?.replenish?.awakened, spent], "P1: THE DRIVE'S ONE WALK COMES FIRST AND THE UNITS RUN BEHIND IT, so a source check that never ends cannot cost the day its Ready work; no rollover, no second walk, and no reading is re-bought. R5: a walk is a PAID drafting pass, so it draws on the remainder of ONE ceiling for the drive").toEqual([["walk", "facts"], 1, [], undefined, [0]]);
    order.length = 0; walks.length = 0; spent.length = 0; rows = seed(); await run(steps("retryable_blocked", async () => ({ status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 1 })));
    expect([order, walks.length], "and a fact check that banks nothing still gets its own turn behind the walk: the source rotation is never held hostage to the stock, nor the stock to it").toEqual([["walk", "facts"], 1]);
    walks.length = 0; let t = NOW; // P2. THE BOX ENDS BEFORE ANY WALK: the units bank and the clock is gone, so the exhaustion standing on the row is dropped, the woken work is persisted by name, and the next invocation walks it without acquiring anything again
    shut(); await runResearchCycle(T, { now: () => new Date(t), deadlineMs: 260_000, steps: { ...BENIGN, ...steps("retryable_blocked", async () => { t += 210_000; return { status: "advanced" as const, banked: 1, bankedPages: [WOLF], pagesComplete: 0 }; }) } });
    const parked = rows.at(-1)!.progress; expect([walks.length, parked?.replenish?.awakened, parked?.replenish?.closed, (parked?.state?.blocker ?? "").includes("for 1 change already funded today, and this pass ran out of time")], "P2: no walk had room, the exhaustion withdrawn, the exact work persisted by ONE name (R6: a reading key and the workKey that opens with it are one funding slot, and the sentence the operator reads counts it once), and the stop reason on the row in their own words").toEqual([0, [WOLF], undefined, true]);
    walks.length = 0; order.length = 0; await run(steps("retryable_blocked", async () => ({ status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 1 })));
    expect([order, rows.at(-1)!.progress?.replenish?.awakened], "and the next invocation walks the work that was woken, which clears the list; whatever that walk re-mints is bought and redrafted in the same turn, and the units run behind both, exactly as any other reading is").toEqual([["walk", "walk", "facts"], undefined]);
    shut(); await run(steps("retryable_blocked", async () => ({ status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 1 }))); shut2 = walks.length; shut(); await run(steps("retryable_blocked", async () => ({ status: "advanced" as const, banked: 1, bankedPages: [WOLF], pagesComplete: 0 }))); const { dueWork: dw } = await import("@/domains/runtime/ops/due-work"), back = rows.at(-1)!.progress, owedNow = (await dw(T, new Date(NOW), { staleSources: async () => 0, checks: async () => ({ ...NO_CHECKS, done: 1, total: 1, answers: 1, due: 0 }), basis: async () => "basis_test", evidenceVersion: async () => null, answersToAnalyze: async () => false, analysisFingerprint: async () => "f", consumedAnalyses: async () => "f", surfaceStale: async () => false, debt: async () => ({ measurable: 0, unverified: 0 }), pagesToCrawl: async () => false, factDebt: async () => ({ owed: 0, everChecked: true }), readyStock: async () => 0, creditHeld: async () => false, run: async () => ({ open: false, progress: back! }) })).due.includes("replenish_ready");
    expect([shut2, walks.length, back?.replenish?.closed, owedNow], "nothing banked leaves the proven exhaustion holding the day shut; a fact banked for the page that stored row was researching reopens it on the fact, walks in the same drive, and the next invocation owes the stock again").toEqual([0, 1, undefined, true]);
    walks.length = 0; bought.length = 0; rows.push(mk({ tenant_id: U, cycle_key: ckey(U, NOW) })); // the first account row, ledger and owed reading all still stand in the same store
    await runResearchCycle(U, { now: () => new Date(NOW), steps: { ...BENIGN, ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: ["check_page_facts"] }), acquireEvidence: async (_t, n) => (bought.push(n.query), { acquired: true, detail: "bought" }), factCheck: async () => ({ status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 0 }), replenishReady: async (_t, _n, was) => (walks.push({ ...(was?.jobs ?? {}) }), { ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "retryable_blocked" as const, jobs: {} }) } });
    expect([walks.map((w) => Object.keys(w)), bought], "P12: no key of the first account's ledger and no reading of its debt reaches the second account's plan").toEqual([[[]], []]); });
  it("keeps the stock owed across scheduler dispatches until five exist, and closes the day only at the target or on a proven exhaustion", async () => {
    const { dueWork } = await import("@/domains/runtime/ops/due-work");
    const Q = { ready: 0, finishes: true }; // the queue as the store holds it, moved only by the drives below
    const quiet = { staleSources: async () => 0, checks: async () => ({ ...NO_CHECKS, done: 1, total: 1, answers: 1, due: 0 }), basis: async () => "b1", evidenceVersion: async () => 1,
      surfaceStale: async () => false, debt: async () => ({ measurable: 0, unverified: 0 }), pagesToCrawl: async () => false, answersToAnalyze: async () => false, analysisFingerprint: async () => "fp1",
      consumedAnalyses: async () => "fp1", factDebt: async () => ({ owed: 0, everChecked: true }), creditHeld: async () => false, readyStock: async () => Q.ready };
    const owed = async () => (await dueWork(T, new Date(NOW), { ...quiet, run: async () => ({ open: rows.at(-1)!.status !== "completed", progress: rows.at(-1)!.progress ?? {} }) })).due;
    const DECIDED = { decided: { basis: "b1", rowVersion: 1 }, focus: { basis: "b1", topics: [] } }, rows = withRun({ current_phase: "keyword_discovery", progress: { ...DECIDED, plan: { units: ["replenish_ready"] } } }); // the notes have not moved and this basis has its frozen plan, so the ONLY thing owed below is the stock
    const dispatch = async () => { const due = await owed(); if (!due.includes("replenish_ready")) return "not_owed"; // ONE SCHEDULER DISPATCH: the real due-work read decides what is owed, and the REAL runner claims the open run or opens another same-day pass on that same due list
      await run({ ...healthySteps([]), dueWork: async () => ({ ...SOMETHING_DUE, due: [...due] }),
        replenishReady: async () => { const before = Q.ready; Q.ready += Q.finishes ? Math.min(2, Math.max(0, 5 - before)) : 0;
          return { ready: Q.ready, deficit: Math.max(0, 5 - Q.ready), persisted: Q.ready - before, satisfied: Q.ready >= 5, jobs: {}, closedUnder: "b1::v1",
            reason: Q.ready >= 5 ? "candidates_exhausted" as const : Q.ready > before ? "made_progress" as const : "candidates_exhausted" as const }; } });
      return [Q.ready, rows.at(-1)!.progress?.replenish?.closed ?? null]; };  // the day marker is the MEMORY; `closed` is the discharge
    expect(await dispatch()).toEqual([2, null]);  // 0 to 2 does NOT discharge the obligation and stamps no day
    expect(await dispatch()).toEqual([4, null]);  // a later dispatch continues from what is still owed
    expect(await dispatch()).toEqual([5, "candidates_exhausted"]); // and the day closes when its candidates are settled, with the reason beside it
    expect(await owed()).toEqual([]); expect(await dispatch()).toBe("not_owed"); // nothing is owed once the stock is there, so no further dispatch opens a run
    const fresh = () => { rows.length = 0; rows.push(mk({ current_phase: "keyword_discovery", progress: { ...DECIDED, plan: { units: ["replenish_ready"] } } })); }; // a fresh day; nothing carried but the queue
    Q.ready = 0; Q.finishes = false; fresh(); // AND THE OTHER TERMINAL: a funded drive that finishes nothing proves no candidate on file can finish, so the day closes rather than spinning
    expect(await dispatch()).toEqual([0, "candidates_exhausted"]); expect(await dispatch()).toBe("not_owed");
    Q.ready = 0; // and a spent provider balance owes nothing either, because a drive could achieve nothing: the day is NOT closed, so the moment the credit is back this is due again
    expect(await dueWork(T, new Date(NOW), { ...quiet, creditHeld: async () => true, run: async () => ({ open: false, progress: { ...DECIDED } }) })).toMatchObject({ due: [], readable: true }); });
  it("replenishes before acquisition from a run already at serp_analysis", async () => { // A RUN ALREADY PARKED PAST THE FIRST PHASE STILL REPLENISHES BEFORE IT BUYS: bound to keyword_discovery alone, the live run sitting at serp_analysis could never top the inventory up at all.
    const order: string[] = []; void withRun({ current_phase: "serp_analysis" });
    await run({ ...healthySteps(order), replenishReady: async () => (order.push("replenish"), REPLENISHED),
      funnelUnit: async (phase) => (order.push(`unit:${phase}`), { status: "done" as const, cursor: null, progress: {} }) });
    expect(order.indexOf("replenish")).toBeGreaterThanOrEqual(0); expect(order.indexOf("unit:serp_analysis")).toBeGreaterThan(order.indexOf("replenish"));});});
