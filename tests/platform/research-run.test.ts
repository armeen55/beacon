/** Durable visit-driven Research Run (Slice 4 + claim-semantics repair): the one-open-run-per-account invariant
 *  (resume any unfinished run across dates before a new daily cycle), the truth boundary (any failure PAUSES,
 *  never completes), partial connector success surviving a pause, deduped refreshed providers across retries,
 *  the lease guards (including the ONE the paid comparison spends under), the frozen investigation, the
 *  idempotency identity, and the fail-closed render path. The in-memory repo models the RPC guards. */
import { describe, it, expect, beforeEach, vi } from "vitest";
/** The DEFAULT reconcile step, exercised for REAL below: what makes the registry worth saving, and what makes it worth a reading. Every other test in this
 *  file seams reconcileCases, so nothing else reaches these modules; funnel/state keeps its real exports because the conflict closure builds a real state. */
const REG = vi.hoisted(() => ({ onFile: [] as unknown[], next: [] as unknown[], saves: 0, readings: 0 }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => ({ ownedPages: [], research: { cases: [] } }) }));
vi.mock("@/domains/evidence/topic-investigation", () => ({ reconcileResearchCases: () => REG.next, buildTopicInvestigations: () => { REG.readings += 1; return []; } }));
vi.mock("@/domains/evidence/funnel/state", async (actual) => ({ ...(await actual<Record<string, unknown>>()),
  loadFunnelState: async () => ({ state: { cases: REG.onFile }, rowVersion: 3 }), saveFunnelState: async () => { REG.saves += 1; return 4; } }));
import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle, continueResearch, ensureResearchRunOnVisit, type ResearchCycleSteps } from "@/domains/runtime/ops/on-visit-refresh";
import { dueWork, type DueWork } from "@/domains/runtime/ops/due-work";
import { caseResearchReceipt } from "@/domains/evidence/case-receipt";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { setAccountRepositoryForTests, type AccountRepository } from "@/domains/account/tenants/store";
import type { AccountStatus } from "@/domains/account";
import type { CachedCallResult, FunnelUnitOutcome } from "@/domains/evidence/dataforseo/funnel-boundary";
import { promptObservationUnit } from "@/domains/evidence/funnel/observe";
import { CONFLICT_DETAIL, type FunnelDeps } from "@/domains/evidence/funnel/shared";
import { emptyFunnelState } from "@/domains/evidence/funnel/state";

// Slice 5 pre-activation gate: the runtime + the RPC model both refuse research work unless the account is
// active. Every tenant defaults to 'active' so every cycle test stands unchanged; a test opts one into
// 'pending_onboarding' to exercise the gate.
const ACCOUNT_STATUS = new Map<string, AccountStatus>();
const statusOf = (t: string): AccountStatus => ACCOUNT_STATUS.get(t) ?? "active";
const setAccountStatus = (t: string, s: AccountStatus): void => void ACCOUNT_STATUS.set(t, s);
function installAccountRepo(): void {
  const byId = async (id: string) => ({ id, slug: id, provisional_name: "", domain: "example.com", status: statusOf(id), signup_date: "", tos_accepted_at: null, daily_budget_usd: 0, growth_goal: null, created_at: "", updated_at: "" });
  setAccountRepositoryForTests({ getAccountById: byId, getAccountBySlug: byId } satisfies AccountRepository); }
let NOW = 1_700_000_000_000;
const iso = (ms = NOW) => new Date(ms).toISOString();
const DAY = 24 * 3600 * 1000, T = "acct-a", U = "acct-b", LEASE = RR.RESEARCH_RUN_LEASE_SECONDS * 1000;
const ckey = (t: string, ms = NOW) => `${t}:${new Date(ms).toISOString().slice(0, 10)}`; // the daily key the DATABASE computes
const mk = (o: Partial<RR.ResearchRun>): RR.ResearchRun => ({ id: "seed", tenant_id: T, cycle_key: ckey(T, NOW), status: "paused",
  current_phase: "refresh_sources", phase_cursor: null, progress: {}, spend_usd: 0, last_error: null,
  lease_owner: null, lease_expires_at: null, started_at: iso(), updated_at: iso(), completed_at: null, ...o });
/** In-memory repo modeling the RPC guards: claim resumes the account's single unfinished run (any date) before
 *  a new daily cycle, a foreign LIVE lease returns null, a same-UTC-day completed run blocks a fresh pass, and
 *  the daily key is computed at database time; advance/renew need a live lease + 'running', finish an open one. */
function memRepo(): { repo: RR.ResearchRunRepo; rows: RR.ResearchRun[] } {
  const rows: RR.ResearchRun[] = [];
  const find = (id: string, t: string) => rows.find((x) => x.id === id && x.tenant_id === t);
  const live = (r: RR.ResearchRun, o: string) => r.lease_owner === o && r.lease_expires_at != null && Date.parse(r.lease_expires_at) >= NOW;
  /** started_at desc, insertion order breaking a tie: several rows of one test day share a timestamp,
   *  and "the latest row" is the question the day-scoped state and the hop count both ask. */
  const newestFirst = (t: string) => rows.map((r, i) => [r, i] as const).filter(([r]) => r.tenant_id === t)
    .sort((a, b) => b[0].started_at.localeCompare(a[0].started_at) || b[1] - a[1]).map(([r]) => r);
  const openRun = (t: string) => newestFirst(t).find((x) => x.status === "running" || x.status === "paused");
  const repo: RR.ResearchRunRepo = {
    async claim({ tenantId, owner, leaseSeconds }) {
      // Mirror the RPC's new leading guard: no claim unless the account is active.
      if (statusOf(tenantId) !== "active") return null;
      const exp = iso(NOW + leaseSeconds * 1000);
      const open = openRun(tenantId);
      if (open) {
        const foreignLive = open.lease_owner != null && open.lease_owner !== owner && Date.parse(open.lease_expires_at!) >= NOW;
        if (foreignLive) return null;
        Object.assign(open, { lease_owner: owner, lease_expires_at: exp, status: open.status === "paused" ? "running" : open.status, updated_at: iso() });
        return { ...open }; // id / cycle_key / phase / cursor / progress / last_error preserved
      }
      const today = new Date(NOW).toISOString().slice(0, 10);
      if (rows.some((x) => x.tenant_id === tenantId && x.status === "completed" && (x.completed_at ?? "").slice(0, 10) === today)) return null;
      // mk defaults already give refresh_sources / null cursor / {} progress / null error.
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: ckey(tenantId, NOW), status: "running", lease_owner: owner, lease_expires_at: exp }));
      return { ...rows[rows.length - 1]! };
    },
    // The same-day EXTRA pass, modeling both database invariants: the partial unique index refuses any
    // insert while a run is unfinished (so a second tab and a live pass both lose), and (tenant, cycle_key)
    // stays unique because the pass ordinal rides in the middle and the day stays on the tail.
    async startPass({ tenantId, owner, leaseSeconds, day }) {
      if (statusOf(tenantId) !== "active" || openRun(tenantId)) return null;
      const key = `${tenantId}:p${rows.filter((x) => x.tenant_id === tenantId && x.cycle_key.endsWith(day)).length + 1}:${day}`;
      if (rows.some((x) => x.tenant_id === tenantId && x.cycle_key === key)) return null;
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: key, status: "running", lease_owner: owner, lease_expires_at: iso(NOW + leaseSeconds * 1000) }));
      return { ...rows[rows.length - 1]! };
    },
    async advance({ tenantId, id, owner, leaseSeconds, patch }) {
      const r = find(id, tenantId);
      if (!r || !live(r, owner) || r.status !== "running") return false;
      // Like the SQL: phase_cursor is ALWAYS set to the patch value (null clears).
      Object.assign(r, { current_phase: patch.phase, progress: patch.progress ?? r.progress, phase_cursor: patch.cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) });
      return true; },
    async renew({ tenantId, id, owner, leaseSeconds, cursor }) {
      const r = find(id, tenantId);
      if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { phase_cursor: cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) });
      return true; },
    async finish({ tenantId, id, owner, outcome, errorInfo }) {
      const r = find(id, tenantId), done = outcome === "completed";
      if (!r || !live(r, owner) || !(r.status === "running" || r.status === "paused")) return false;
      Object.assign(r, { status: outcome, lease_owner: null, lease_expires_at: null, last_error: done ? null : errorInfo ?? null, ...(done ? { current_phase: "done", completed_at: iso() } : {}) });
      return true; },
    async latest(t) { const m = newestFirst(t)[0]; return m ? { ...m } : null; },
    // The reporting day rides on the tail of BOTH cycle-key shapes, which is how the day's rows are found.
    async sameDay({ tenantId, day, limit }) {
      return newestFirst(tenantId).filter((x) => x.cycle_key.endsWith(day)).slice(0, limit)
        .map((x) => ({ id: x.id, progress: x.progress ?? {} })); },
    async countContinuation({ tenantId, day }) {
      const row = newestFirst(tenantId)[0];
      if (!row) return null;
      const held = row.progress?.continuations;
      const count = (held?.day === day ? held.count : 0) + 1;
      row.progress = { ...row.progress, continuations: { day, count } };
      return count; },
  };
  return { repo, rows };
}
function freshRepo(): RR.ResearchRun[] { const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo); return rows; }
/** A seeded paused (unleased) today-row a fresh claim can reclaim, plus its rows. */
function withRun(o: Partial<RR.ResearchRun> = {}): RR.ResearchRun[] { const rows = freshRepo(); rows.push(mk(o)); return rows; }
/** Work is owed unless a test says otherwise, so every pre-Phase-5 pin drives the same phases it always did. */
const NO_CHECKS = { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 };
const SOMETHING_DUE: DueWork = { due: ["daily_observations"], readable: true, checks: NO_CHECKS, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null };
const NOTHING_DUE: DueWork = { ...SOMETHING_DUE, due: [] };
/** Benign no-op steps; a phase-truth test overrides the ONE step under test. */
const BENIGN: ResearchCycleSteps = {
  dueWork: async () => SOMETHING_DUE,
  evidenceVersion: async () => null,
  refreshSources: async () => ({ attempted: 0, succeeded: [], failures: [] }),
  reconcileCases: async () => {},
  backfillChunk: async () => ({ kind: "no_work" }),
  funnelUnit: async () => ({ status: "done", cursor: null, progress: {} }), // evidence phases no-op in these lease/truth tests
  investigationFocus: async () => null,
  currentBasis: async () => "basis_test", // the account basis the funnel scopes to
  publishSurface: async () => {},
  surfaceStale: async () => false,
  analyzeAnswers: async () => 0, // no new answers to read back in these lease/truth tests
  verifyShipments: async () => 0, // nothing marked implemented is waiting on a live check in these tests
};
/** Healthy logging stub: each step logs its name so phase ordering is observable. */
const healthySteps = (log: string[]): Partial<ResearchCycleSteps> => ({
  refreshSources: async () => (log.push("refresh"), { attempted: 2, succeeded: ["google_gsc", "google_ga4"], failures: [] }),
  backfillChunk: async () => (log.push("backfill"), { kind: "advanced", daysPulled: 30 }),
  publishSurface: async () => void log.push("publish"), surfaceStale: async () => false,
});
const run = (steps: Partial<ResearchCycleSteps>, deadlineMs?: number) =>
  runResearchCycle(T, { now: () => new Date(NOW), steps: { ...BENIGN, ...steps }, ...(deadlineMs === undefined ? {} : { deadlineMs }) });

// ACCOUNT_STATUS is cleared so every tenant defaults to active.
beforeEach(() => { NOW = 1_700_000_000_000; RR.setResearchRunRepoForTests(null); ACCOUNT_STATUS.clear(); installAccountRepo(); });
describe("research-run claim: one open run per account across all dates", () => {
  it("resumes the account's one unfinished run first: yesterday's paused run is reclaimed by the same id with phase and cursor untouched, a later-day visit reuses it, and no second row is ever created", async () => {
    const rows = freshRepo(); const cursor = { phase: "gsc_backfill_chunk", attemptKey: "k" };
    rows.push(mk({ id: "seed", status: "paused", current_phase: "gsc_backfill_chunk", phase_cursor: cursor, cycle_key: ckey(T, NOW - DAY), started_at: iso(NOW - DAY) }));
    const first = await RR.claimRun(T, "o1"); // resumed, not a new run: phase and cursor untouched, paused flips to running
    expect([first?.id, first?.current_phase, first?.phase_cursor, first?.status]).toEqual(["seed", "gsc_backfill_chunk", cursor, "running"]);
    NOW += 2 * DAY; // two UTC days later, o1's lease long dead
    expect([(await RR.claimRun(T, "o2"))?.id, rows.length]).toEqual(["seed", 1]); }); // reuses the one open run; no current-day row was ever created
  it("lets an older run's lease state govern the claim: a live foreign lease blocks a new run, an expired one is reclaimed on the same row", async () => {
    const rows = freshRepo();
    rows.push(mk({ id: "seed", status: "running", lease_owner: "other", lease_expires_at: iso(NOW + LEASE), started_at: iso(NOW - DAY) }));
    expect([await RR.claimRun(T, "me"), rows.length]).toEqual([null, 1]); // live foreign lease blocks a second run
    rows[0]!.lease_expires_at = iso(NOW - 1); // the lease expires
    expect([(await RR.claimRun(T, "me"))?.id, rows.length]).toEqual(["seed", 1]); }); // expired lease reclaimed on the same row
  it("keeps accounts independent, blocks a redundant same-day pass after completion, and opens a fresh run only on a later day", async () => {
    const rows = freshRepo(); const a = await RR.claimRun(T, "o1"), b = await RR.claimRun(U, "o2");
    expect([a!.id === b!.id, rows.length]).toEqual([false, 2]); // one account's open run never blocks another
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
    freshRepo(); setAccountStatus(T, "pending_onboarding");
    expect(await RR.claimRun(T, "o1")).toBeNull(); }); // nothing claimed or created before activation
});
describe("research-run database-time lease guards", () => {
  it("guards every mutation at database time: foreign and expired owners cannot advance / renew / finish, a live owner can, and a completed row rejects mutation", async () => {
    const rows = withRun({ status: "running", lease_owner: "o1", lease_expires_at: iso(NOW + LEASE) }); const id = rows[0]!.id;
    expect([await RR.advancePhase(T, id, "intruder", { phase: "done" }), await RR.renewLease(T, id, "intruder", { phase: "refresh_sources" }), await RR.finishRun(T, id, "intruder", "completed")]).toEqual([false, false, false]);
    expect(await RR.renewLease(T, id, "o1", { phase: "refresh_sources", attemptKey: "k" })).toBe(true);
    expect([rows[0]!.lease_owner, rows[0]!.phase_cursor]).toEqual(["o1", { phase: "refresh_sources", attemptKey: "k" }]);
    NOW += LEASE + 1; // the owner's lease is now dead
    expect([await RR.advancePhase(T, id, "o1", { phase: "done" }), await RR.finishRun(T, id, "o1", "completed")]).toEqual([false, false]);
    NOW -= LEASE + 1; await RR.finishRun(T, id, "o1", "completed"); // a completed row rejects every mutation
    expect([await RR.advancePhase(T, id, "o1", { phase: "refresh_sources" }), await RR.finishRun(T, id, "o1", "paused")]).toEqual([false, false]); });
});
describe("research-run phase truth", () => {
  it("counts only synced sources as refreshed, and any connector failure pauses at refresh_sources without advancing to publish", async () => {
    const rows = withRun();
    await run({ ...BENIGN, refreshSources: async () => ({ attempted: 3, succeeded: ["google_gsc", "clarity"], failures: [{ provider: "google_ga4", detail: "429 quota" }] }) });
    expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error?.phase]).toEqual(["paused", "refresh_sources", "refresh_sources"]); // stuck in place → never published off a failed refresh
    expect([rows[0]!.last_error?.failures, rows[0]!.progress.surfacePublished]).toEqual([[{ provider: "google_ga4", detail: "429 quota" }], undefined]); });
  it("treats zero stale sources as a healthy no-op and completes when every phase succeeds or no-ops", async () => {
    const rows = withRun(); await run({ ...BENIGN, surfaceStale: async () => true }); // nothing refreshed, but the saved surface is stale
    expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error, rows[0]!.progress.surfacePublished]).toEqual(["completed", "done", null, true]); });
  it("pauses at the phase that throws, never marks it published, and never completes (backfill chunk, then publish build)", async () => {
    const backfill = withRun({ current_phase: "gsc_backfill_chunk" });
    await run({ ...BENIGN, backfillChunk: async () => { throw new Error("gsc backfill chunk did not advance: 429"); } });
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
    expect([rows[0]!.status, rows[0]!.progress.sourcesRefreshed]).toEqual(["completed", 2]);
    expect(rows[0]!.progress.refreshedProviders).toEqual(["google_gsc", "google_ga4"]); }); // union of both attempts, no double count
  it("decodes a legacy numeric-only progress row: projection and resume never crash and the number survives", async () => {
    const rows = withRun({ current_phase: "publish_surface", progress: { sourcesRefreshed: 2 } });
    expect((await RR.researchRunStatus(T, new Date(NOW))).counters.sourcesRefreshed).toBe(2); // decodes the bare number
    await run({ ...BENIGN, surfaceStale: async () => false });
    expect([rows[0]!.status, rows[0]!.progress.sourcesRefreshed]).toEqual(["completed", 2]); }); // legacy number survives the resume (refresh_sources not re-run)
  it("checks what the operator marked as done BEFORE it publishes off it, and only when a check is genuinely owed", async () => {
    const order: string[] = [];
    const steps = (due: DueWork): Partial<ResearchCycleSteps> => ({ dueWork: async () => due,
      verifyShipments: async () => (order.push("verify"), 1), publishSurface: async () => void order.push("publish"), surfaceStale: async () => true });
    const owed: DueWork = { ...SOMETHING_DUE, due: ["verify_and_measure"] };
    withRun({ current_phase: "publish_surface" }); await run(steps(owed));
    expect(order).toEqual(["verify", "publish"]); // the live check lands first, so the surface publishes what was actually verified
    order.length = 0;
    withRun({ current_phase: "publish_surface" }); await run(steps(SOMETHING_DUE)); // nothing marked implemented is waiting
    expect(order).toEqual(["publish"]); }); // no shipment owed a check, so not one page of the customer's site is read
  it("never lets a check I could not make pause the pass: the surface still publishes", async () => {
    const rows = withRun({ current_phase: "publish_surface" });
    await run({ dueWork: async () => ({ ...SOMETHING_DUE, due: ["verify_and_measure"] }),
      verifyShipments: async () => { throw new Error("your website did not answer"); }, surfaceStale: async () => true });
    expect([rows[0]!.status, rows[0]!.progress.surfacePublished]).toEqual(["completed", true]); });
});

describe("research-run idempotency identity", () => {
  it("hands each phase its persisted attempt key: an interrupted retry reuses it even across a date change, the next phase gets a different one, and no second run opens", async () => {
    const rows = withRun({ id: "seed", started_at: iso(NOW) });
    const refreshKeys: string[] = [], backfillKeys: string[] = []; let refreshFails = true;
    const steps: Partial<ResearchCycleSteps> = { ...BENIGN,
      refreshSources: async (_t, _n, key) => (refreshKeys.push(key), refreshFails ? { attempted: 1, succeeded: [], failures: [{ provider: "google_gsc", detail: "boom" }] } : { attempted: 1, succeeded: ["google_gsc"], failures: [] }),
      backfillChunk: async (_t, _n, key) => (backfillKeys.push(key), { kind: "no_work" }) };
    await run(steps); // first visit: refresh fails → pause at refresh_sources with the cursor persisted
    expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["paused", "refresh_sources"]);
    NOW += DAY; await run(steps); // a new UTC day: the resumed run's ORIGINAL cycle key, not today's, still seeds the key
    expect([refreshKeys[1], rows.length]).toEqual([refreshKeys[0], 1]); // identical key after the date changed, and no second run on the new day
    refreshFails = false;
    await run(steps); // refresh succeeds → resumes the SAME phase (identical key), then advances
    expect([rows[0]!.status, rows[0]!.id]).toEqual(["completed", "seed"]);
    expect(refreshKeys[2]).toBe(refreshKeys[0]); // an interrupted retry reuses the identical key
    expect(backfillKeys[0]).not.toBe(refreshKeys[2]); expect(refreshKeys[0]).toMatch(/^rr_[0-9a-f]{32}$/); }); // the next phase gets a different key
});

describe("research-run resume + status projection", () => {
  it("resumes at the persisted phase (done phases are not re-run) and a deadline pauses durably", async () => {
    const rows = withRun({ current_phase: "gsc_backfill_chunk" }); const log: string[] = [];
    await run(healthySteps(log), 0); // out of time before any phase
    expect(log).toEqual([]); expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["paused", "gsc_backfill_chunk"]);
    await run(healthySteps(log));
    expect(log).toEqual(["backfill", "publish"]); // never "refresh" (that phase was already done)
    expect([rows[0]!.status, rows[0]!.current_phase]).toEqual(["completed", "done"]); });
  it("projects PERSISTED truth only: the row's own status answers, and a lease that lived or died changes nothing a surface reads", async () => {
    const rows = withRun({ status: "running", lease_owner: "o", lease_expires_at: iso(NOW - LEASE), // lease long dead
      progress: { state: { checksDone: 12, checksTotal: 40, casesActive: 1, casesParked: 2, nextDueAt: "2026-08-02T00:00:00.000Z" } } });
    const dead = await RR.researchRunStatus(T, new Date(NOW));
    rows[0]!.lease_expires_at = iso(NOW + LEASE); // the SAME row, a fresh lease
    const live = await RR.researchRunStatus(T, new Date(NOW));
    expect(dead).toEqual(live); // THE pin: a transient lease change moves no number and no state
    expect([live.state, live.phaseLabel, live.stepsTotal]).toEqual(["running", "refreshing your connected data", 7]);
    // Every number comes off the persisted row, never from a per-render computation.
    expect([live.counters.aiChecksDone, live.counters.aiChecksIntended, live.cases, live.nextDueAt])
      .toEqual([12, 40, { active: 1, parked: 2 }, "2026-08-02T00:00:00.000Z"]); });
});

describe("research-run frozen investigation: ONE topic, and the lease the comparison spends under", () => {
  const focusOf = (topicKey: string) => ({ basis: "basis_test", topics: [{ topicKey, query: "haft seen", requirement: "exact_serp" }] });
  const FOCUS = focusOf("inv_haft");
  /** A two-stage winning-pages double over the REAL cycle: stage one persists winners and hands the run back,
   *  stage two is the one that would SPEND. Every invocation records its phase, the topic it was handed, and
   *  how many REAL ResearchRun lease renewals had happened by then, so a spend sits against a countable renewal. */
  function staged(renews: () => number) {
    const seen: Array<[string, string | null, number]> = [], spent: string[] = [];
    const funnelUnit: ResearchCycleSteps["funnelUnit"] = async (phase, _t, cursor, _b, focus) => {
      const topic = focus?.topics[0]?.topicKey ?? null; seen.push([phase, topic, renews()]);
      if (phase !== "winning_pages") return { status: "done", cursor: null, progress: {} };
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
    basis = "basis_test"; await run(steps);
    expect([order, rows[0]!.status, rows[0]!.progress.surfacePublished]).toEqual([["stale", "publish"], "completed", true]); }); // the retry publishes exactly once
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
    state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: 7, counters: {}, updatedAt: null, completedAt: null, pauseReason: null, ...o,
  });
  const NOON_PT = Date.parse("2026-07-23T19:00:00Z"); // noon Pacific on Jul 23
  it("never says 'current': same-day completion shows today, an older pass shows its date, none is silent", () => {
    const completed = view({ state: "completed", completedAt: new Date(NOON_PT).toISOString() });
    const sameDay = RR.researchStatusLine(completed, new Date(NOON_PT)); const older = RR.researchStatusLine(completed, new Date(NOON_PT + 2 * DAY));
    expect(sameDay).toBe("Latest research pass finished today at 12:00 PM."); expect(older).toBe("Latest research pass finished Jul 23 at 12:00 PM.");
    expect(`${sameDay} ${older}`).not.toMatch(/current/i); expect(RR.researchStatusLine(view({ state: "none" }))).toBeNull(); });
  it("gives an open error-free run ONE in-progress sentence with the persisted AI-check counts, identical whether the lease is live or released", () => {
    const progress = { funnel: { promptsChecked: 35, enginePairsDone: 40, enginePairsIntended: 140 } };
    const leased = mk({ status: "running", current_phase: "prompt_observations", progress, lease_owner: "o", lease_expires_at: iso(NOW + LEASE) });
    const released = mk({ ...leased, status: "paused", lease_owner: null, lease_expires_at: null }); // same run, a normal provider wait persisted
    const live = RR.researchStatusLine(RR.projectStatusView(leased, NOW));
    expect(live).toBe("Research in progress: checking how AI assistants answer your questions. 40 of 140 AI checks collected.");
    expect(RR.researchStatusLine(RR.projectStatusView(released, NOW))).toBe(live); }); // THE pin: the line never toggles on lease state alone
  it("invents no numbers off the AI phase, names a real pause reason, and never resurrects a stale one", () => {
    // Cumulative funnel counters survive onto later phases; the clause must not follow them.
    const later = mk({ status: "running", current_phase: "serp_analysis", lease_owner: "o", lease_expires_at: iso(NOW + LEASE),
      progress: { funnel: { promptsChecked: 35, enginePairsDone: 40, enginePairsIntended: 140 } } });
    expect(RR.researchStatusLine(RR.projectStatusView(later, NOW))).toBe("Research in progress: reading the results pages for your strongest topics.");
    // A pause the operator must clear names its reason instead of reading as ordinary progress.
    const stuck = mk({ status: "paused", current_phase: "keyword_discovery", last_error: { phase: "keyword_discovery", message: "I need your confirmed business basics before I can research keywords.", at: iso() } });
    expect(RR.researchStatusLine(RR.projectStatusView(stuck, NOW))).toBe("Research paused after 2 of 7 steps. I need your confirmed business basics before I can research keywords.");
    // A reason recorded by an already-passed phase never resurrects on the current one.
    const stale = mk({ ...stuck, current_phase: "serp_analysis" });
    expect(RR.researchStatusLine(RR.projectStatusView(stale, NOW))).toBe("Research in progress: reading the results pages for your strongest topics.");
  });
  it("stops calling a dead process work in progress: a freshly-touched running row reads in progress, one untouched for ten minutes reads interrupted", () => {
    const fresh = mk({ status: "running", current_phase: "serp_analysis", updated_at: iso(NOW - 60_000) }); // a minute since the last real write
    expect(RR.researchStatusLine(RR.projectStatusView(fresh, NOW))).toBe("Research in progress: reading the results pages for your strongest topics.");
    // The SAME row, untouched past the stale bound: the owner died, and saying so is the honest read.
    const dead = RR.projectStatusView(mk({ ...fresh, updated_at: iso(NOW - 11 * 60_000) }), NOW);
    expect([dead.state, dead.pauseReason]).toEqual(["paused", "I was interrupted mid research. I pick this back up on your next visit."]);
    expect(RR.researchStatusLine(dead)).toBe("Research paused after 4 of 7 steps. I was interrupted mid research. I pick this back up on your next visit.");
    // It reads off updated_at alone, so a lease that lived or died still moves nothing: no flicker.
    expect(RR.projectStatusView(mk({ ...fresh, lease_owner: "o", lease_expires_at: iso(NOW - LEASE) }), NOW))
      .toEqual(RR.projectStatusView(fresh, NOW)); });
});

describe("research-run conflict-free research closure", () => {
  /** THE production incident, hermetic (run cd309823, 2026-07-27): ONE research_state row, a discovery phase that lands this run's
   *  REAL receipt, and a prompt phase whose read is served the snapshot from BEFORE that write. The two writers interleave over one
   *  row, so the prompt unit resets its per-run receipt to zero and its optimistic save conflicts. `staleLoads` = how many prompt
   *  loads see the pre-discovery snapshot. The evidence executor here is the REAL one, driven by the real runResearchCycle. */
  /** Runtime's daily plan, the observation unit's ONLY input: one question on the four engines, one day. */
  const DUE = (["chatgpt", "claude", "gemini", "perplexity"] as const).map((engine) => ({ promptId: "p1", version: 1, text: "best persian restaurant", engine, slot: 0 as const, day: "2026-07-21" }));
  function funnelWorld(rows: RR.ResearchRun[], staleLoads: number) {
    const pre = emptyFunnelState(T, "basis_test"); pre.cycle = { runId: "prev-run", cycleKey: "prev", spentUsd: 1.82, cacheHits: 0 }; // the PREVIOUS run's receipt
    const live = { state: structuredClone(pre), rowVersion: 18 }; const seen: Record<string, unknown>[] = []; const bought = new Set<string>(); let loads = 0, paid = 0;
    const answer = { answerText: "hi", modelServed: null, webSearchReported: null, citations: [], fanOutQueries: null, brands: null };
    const deps: FunnelDeps = { syncHistory: async () => {}, recordObservation: async () => {}, getAccount: async () => null, now: () => NOW, parse: ((_c: unknown, env: unknown) => env) as FunnelDeps["parse"],
      loadState: async () => (loads++ < staleLoads ? { state: structuredClone(pre), rowVersion: 18 } : { state: structuredClone(live.state), rowVersion: live.rowVersion }),
      saveState: async (_t, _b, s, expected) => { if (expected !== live.rowVersion) return null; live.state = structuredClone(s); live.rowVersion = expected + 1; return live.rowVersion; },
      // Cache identity makes any retry $0: a capability already bought comes back as a hit, never a second paid post.
      callProvider: async (cap) => (bought.has(cap) ? { state: "hit", envelope: answer as never, costUsd: 0, cacheKey: `ck-${cap}`, modelServed: null }
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
    await run({ funnelUnit: async () => (ran = true, { status: "done", cursor: null, progress: {} }) });
    expect([ran, rows[0]!.last_error]).toEqual([false, null]); }); // the unit never ran and nothing was recorded
  it("reads the new answers back on the observation phase only, records what persisted, and never turns a read-back failure into a pause", async () => {
    const seen: Array<[string, string]> = []; const rows = withRun();
    await run({ analyzeAnswers: async (t, day) => (seen.push([t, day]), 2) });
    expect(seen).toEqual([[T, ckey(T).slice(-10)]]); // once, on prompt_observations, for the run's own UTC day
    expect([rows[0]!.status, rows[0]!.progress.funnel?.answersAnalyzed]).toEqual(["completed", 2]);
    const failed = withRun(); // the answers are already safely stored, so a read-back that throws must not pause the run
    await run({ analyzeAnswers: async () => { throw new Error("openai down"); } });
    expect([failed[0]!.status, failed[0]!.progress.funnel?.answersAnalyzed]).toEqual(["completed", undefined]); });
});
describe("research-run fail-closed + render path", () => {
  it("fails closed when the claim RPC throws, throws on an empty tenant before any I/O, and runs no phase on the render path", async () => {
    let touched = false; const log: string[] = [];
    RR.setResearchRunRepoForTests({ ...memRepo().repo, claim: async () => { touched = true; throw new Error("db down"); } });
    await run(healthySteps(log)); expect([log, touched]).toEqual([[], true]); // no phase ran, and it did try to claim
    touched = false; await expect(RR.claimRun("", "o1")).rejects.toThrow(/tenantId is required/); expect(touched).toBe(false); // never reached the repo
    const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo);
    expect(() => ensureResearchRunOnVisit(T)).not.toThrow(); // after() invalid outside a request → caught
    await Promise.resolve(); expect(rows).toHaveLength(0); }); // no phase work on the render path
});

/** THE REGISTRY DECIDES, and it decides ONCE per run. The reconcile step here is the real one (the seam is removed), so what is pinned is the wiring
 *  itself: a registry that only changed the ORDER it was written in is unmoved, and the advisory reading is bounded per RUN, never per unit iteration. */
describe("the case registry a run saves, and the ONE reading it buys", () => {
  const row = (id: string, anchors: string[]) => ({ id, anchors });
  const real = (steps: Partial<ResearchCycleSteps> = {}) => { const { reconcileCases: _seam, ...rest } = BENIGN;
    return runResearchCycle(T, { now: () => new Date(NOW), steps: { ...rest, ...steps } }); };
  beforeEach(() => { REG.saves = 0; REG.readings = 0; });
  it("saves nothing and reads nothing when the registry changed only the order it happens to be written in", async () => {
    REG.onFile = [row("inv_b", ["y", "x"]), row("inv_a", ["a"])]; REG.next = [row("inv_a", ["a"]), row("inv_b", ["x", "y"])];
    const rows = withRun({ current_phase: "serp_analysis" }); await real();
    expect([REG.saves, REG.readings, rows[0]!.progress.synthesisAttempted, rows[0]!.status]).toEqual([0, 0, undefined, "completed"]); });
  it("attempts the reading at most ONCE per run, however many units and phases reconcile against a registry that did move", async () => {
    REG.onFile = [row("inv_a", ["a"])]; REG.next = [row("inv_a", ["a", "b"])];
    const rows = withRun({ current_phase: "serp_analysis" }); let units = 0;
    await real({ funnelUnit: async () => { units += 1; return units < 4 ? { status: "advanced", cursor: { units }, progress: {} } : { status: "done", cursor: null, progress: {} }; } });
    expect([REG.saves > 1, REG.readings, rows[0]!.progress.synthesisAttempted, units, rows[0]!.status]).toEqual([true, 1, true, 5, "completed"]); });
});

/** V1 Truth Convergence Phase 5 - THE DUE-WORK RUNTIME. A day is not a unit of work: owed work is. What is
 *  pinned here is that the SAME free question ("what is genuinely due, from persisted state alone") decides
 *  whether a second pass may open on a day that already finished one, whether a pass that opened has
 *  anything to do, and whether a continuation is worth asking for. Every rule reads rows, never a lease. */
describe("the due-work runtime: a day is not a unit of work", () => {
  const today = () => new Date(NOW).toISOString().slice(0, 10);
  const completedToday = (): RR.ResearchRun[] => { const rows = freshRepo(); rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done" })); return rows; };

  it("opens a SECOND pass the same day on genuinely due work, and refuses at zero cost when nothing is due or the state cannot be read", async () => {
    const rows = completedToday(); let asked = 0;
    await run({ dueWork: async () => (asked += 1, NOTHING_DUE), refreshSources: async () => { throw new Error("no phase may run"); } });
    expect([rows.length, asked]).toEqual([1, 1]); // nothing due: no row, no phase, no cent
    await run({ dueWork: async () => ({ ...SOMETHING_DUE, readable: false }), refreshSources: async () => { throw new Error("no phase may run"); } });
    expect(rows).toHaveLength(1); // unreadable is not "due": opening a pass on a guess is how money gets spent twice
    await run({ dueWork: async () => SOMETHING_DUE }); // a retry date passed, a source refreshed, an extra reading was granted
    expect([rows.length, rows[1]!.status, rows[1]!.cycle_key.slice(-10)]).toEqual([2, "completed", today()]);
    expect(rows[1]!.cycle_key).not.toBe(rows[0]!.cycle_key); }); // a distinct pass, still reporting into the day it opened

  it("closes a pass that opened with nothing due immediately and at zero cost, and that completion blocks no later pass", async () => {
    const rows = freshRepo(); const log: string[] = [];
    await run({ ...healthySteps(log), dueWork: async () => ({ ...NOTHING_DUE, checks: { ...NO_CHECKS, done: 40, total: 40, answers: 37, unavailable: 2, unsupported: 1 }, cases: { active: 0, parked: 2 }, nextDueAt: "2026-08-02T00:00:00.000Z" }) });
    expect([log, rows[0]!.status, rows[0]!.current_phase]).toEqual([[], "completed", "done"]); // not one phase ran
    // A pass that closed with nothing owed still says what it checked and when the waiting ends.
    expect(rows[0]!.progress.state).toMatchObject({ checksDone: 40, checksTotal: 40, checksAnswers: 37, checksUnavailable: 2, checksUnsupported: 1, casesParked: 2, nextDueAt: "2026-08-02T00:00:00.000Z" });
    expect(RR.researchStatusLine(RR.projectStatusView(rows[0]!, NOW), new Date(NOW)))
      .toContain("Nothing more is due until August 1."); // the operator's own zone, the same one every other date on Today uses
    NOW += DAY; await run(healthySteps(log));
    expect([log, rows.length]).toEqual([["refresh", "backfill", "publish"], 2]); }); // tomorrow is untouched by today's empty pass

  it("chains bounded continuations: it re-schedules only while work is due, and never past the bound", async () => {
    let hops = 0;
    const chain = async (due: () => DueWork) => { completedToday(); let hop = 0, ran = 0;
      // Bounded well past the ceiling so a regression FAILS instead of looping: the day's hop count is
      // what makes this terminate, and it only survives because a new pass row inherits it.
      while (ran < 12) { const step = await continueResearch(T, hop, { now: () => new Date(NOW), steps: { ...BENIGN, dueWork: async () => (hops += 1, due()) } });
        ran += 1; if (!step.more) return { hop: step.hop, ran }; hop = step.hop; }
      return { hop, ran } };
    expect((await chain(() => NOTHING_DUE)).ran).toBe(1); // nothing due after the first hop: no second request is asked for
    hops = 0; const forever = await chain(() => SOMETHING_DUE);
    expect([forever.hop, forever.ran]).toEqual([6, 6]); }); // due forever still stops at the bound

  it("carries the day's own state onto the pass it justified: the grant, the ceiling marker, the reading receipt and the decide watermark all survive a new row, and none of them survives the day", async () => {
    const rows = freshRepo(); const day = today();
    const dayState = { extraSamples: { day, granted: 1 }, capped: { day, caseIds: ["inv_haft"] },
      synthesisAttempted: true, decided: { basis: "basis_test", rowVersion: 12 } };
    rows.push(mk({ id: "done1", status: "completed", completed_at: iso(), current_phase: "done", progress: dayState }));
    await run({ dueWork: async () => SOMETHING_DUE });
    // The planner, the case receipt and the watermark all read the LATEST row. Before this, the pass the
    // grant paid for was born blank, so the grant it opened on could never be spent and the watermark it
    // needed to close the day was gone.
    expect([rows.length, rows[1]!.status]).toEqual([2, "completed"]);
    expect(rows[1]!.progress).toMatchObject(dayState);
    NOW += DAY; await run({ dueWork: async () => SOMETHING_DUE }); // a new reporting day inherits none of it
    expect([rows.length, rows[2]!.progress.extraSamples, rows[2]!.progress.capped, rows[2]!.progress.synthesisAttempted])
      .toEqual([3, undefined, undefined, undefined]); });

  it("refuses to open a ninth pass on one day, however due the work still looks", async () => {
    const rows = freshRepo(); const day = today();
    for (let i = 0; i < 8; i += 1) rows.push(mk({ id: `p${i}`, status: "completed", completed_at: iso(), current_phase: "done", cycle_key: `${T}:p${i + 1}:${day}` }));
    expect(await RR.startExtraPass(T, "tab-9", day)).toBeNull(); // the honest ceiling, not a claim that nothing is due
    await run({ dueWork: async () => SOMETHING_DUE, refreshSources: async () => { throw new Error("no phase may run"); } });
    expect(rows).toHaveLength(8); }); // an unsatisfiable topic stops costing a pass per navigation

  it("counts continuation hops on the account's own row, so a client that keeps claiming hop 0 is refused once the day's bound is spent", async () => {
    const rows = completedToday(); let cycles = 0; const seen: Array<{ hop: number; more: boolean }> = [];
    const steps = { ...BENIGN, dueWork: async () => SOMETHING_DUE,
      refreshSources: async () => (cycles += 1, { attempted: 0, succeeded: [], failures: [] }) };
    for (let i = 0; i < 8; i += 1) seen.push(await continueResearch(T, 0, { now: () => new Date(NOW), steps })); // the same made-up hop, every time
    expect(seen.map((s) => s.hop)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // the SERVER counts, and the count survives every new pass row
    expect(seen.map((s) => s.more)).toEqual([true, true, true, true, true, false, false, false]);
    expect(cycles).toBe(6); // the last two hops ran nothing at all
    expect(rows[rows.length - 1]!.progress.continuations).toEqual({ day: today(), count: 8 }); });

  it("two tabs cannot both open a same-day pass: the second insert loses to the one-open-run invariant", async () => {
    const rows = completedToday();
    const one = await RR.startExtraPass(T, "tab-1", today());
    const two = await RR.startExtraPass(T, "tab-2", today()); // the first pass is still open
    expect([one?.lease_owner, two, rows.length]).toEqual(["tab-1", null, 2]); });

  it("marks the case a spending ceiling stopped, day-scoped on the run's own row, and the receipt reads it", async () => {
    const rows = withRun({ current_phase: "keyword_discovery" });
    await run({ funnelUnit: async () => ({ status: "failed", cursor: { stage: "competitors", cappedCase: "inv_haft" }, progress: {}, detail: "the ceiling was reached" }) });
    expect(rows[0]!.progress.capped).toEqual({ day: today(), caseIds: ["inv_haft"] });
    const snapshot = { scope: { builtAt: iso() }, ownedPages: [], research: { cases: [{ id: "inv_haft", anchors: ["haft seen"] }],
      retainedKeywords: [], serpEvidence: [], aiObservations: [], pageComparisons: [], winningPages: [], caseCompetitors: [], receipt: { spentUsd: 0, cached: 0 } } } as unknown as EvidenceSnapshot;
    const reasons = (capped: string[]) => caseResearchReceipt(snapshot, "inv_haft", capped)!.notBought.map((n) => n.reason);
    expect(reasons(rows[0]!.progress.capped!.caseIds)).toContain("capped");
    expect(reasons([])).not.toContain("capped"); }); // the marker dies with the day, so tomorrow's receipt says nothing about today's ceiling
});

/** The rules themselves, on injected persisted state: no network, no clock tricks, no lease. */
describe("dueWork: what is genuinely owed, computed from persisted state only", () => {
  const parked = (ms: number) => ({ basis: "b1", topics: [{ topicKey: "t1", query: "haft seen", requirement: "exact_serp", retryAfter: new Date(ms).toISOString() }] });
  const base = { staleSources: async () => 0, checks: async () => ({ ...NO_CHECKS, done: 4, total: 4, answers: 4, due: 0 }), basis: async () => "b1",
    evidenceVersion: async () => 7, surfaceStale: async () => false, debt: async () => ({ measurable: 0, unverified: 0 }),
    run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW + DAY) } }) };

  it("owes nothing when the sources are fresh, today's round has landed, the notes have not moved past the last decision, and the rest is waiting on a date I promised", async () => {
    const w = await dueWork(T, new Date(NOW), base);
    expect([w.due, w.readable, w.checks, w.cases, w.nextDueAt]).toEqual([[], true, { ...NO_CHECKS, done: 4, total: 4, answers: 4 }, { active: 0, parked: 1 }, new Date(NOW + DAY).toISOString()]); });

  it("names each owed unit from the ONE persisted fact that proves it", async () => {
    const due = async (o: Parameters<typeof dueWork>[2]) => (await dueWork(T, new Date(NOW), { ...base, ...o })).due;
    expect(await due({ staleSources: async () => 1 })).toEqual(["refresh_sources"]);
    expect(await due({ checks: async () => ({ ...NO_CHECKS, done: 2, total: 4, answers: 2, due: 2 }) })).toEqual(["daily_observations"]);
    // A retry date that PASSED is the same-day unlock: the promise I made has come due.
    expect(await due({ run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, focus: parked(NOW - 1) } }) })).toEqual(["acquire_case_evidence"]);
    // The notes moved past what the last decision consumed: new evidence, so a plan and a decision are owed.
    expect(await due({ evidenceVersion: async () => 8 })).toEqual(["plan_cases", "decide_and_prepare"]);
    expect(await due({ debt: async () => ({ measurable: 3, unverified: 0 }) })).toEqual(["verify_and_measure"]);
    // A change marked implemented that has never been checked on the live page owes the same unit: until it
    // is verified there is nothing honest to measure. ONE ledger read answers both.
    expect(await due({ debt: async () => ({ measurable: 0, unverified: 1 }) })).toEqual(["verify_and_measure"]);
    expect(await due({ surfaceStale: async () => true })).toEqual(["publish_surfaces"]);
    // An OPEN run with no plan bound to this basis owes one; an idle account with no plan owes nothing.
    expect(await due({ run: async () => ({ open: true, progress: { decided: { basis: "b1", rowVersion: 7 } } }) })).toEqual(["plan_cases"]);
    expect(await due({ run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 } } }) })).toEqual([]); });

  it("treats a completed pass's frozen plan as a receipt, not a standing queue: only an arrived retry date or a still-open run makes a topic owed", async () => {
    const plan = { basis: "b1", topics: [{ topicKey: "t1", query: "haft seen", requirement: "exact_serp" }] }; // frozen, no date promised
    const decided = { basis: "b1", rowVersion: 7 };
    const due = async (open: boolean) => (await dueWork(T, new Date(NOW), { ...base, run: async () => ({ open, progress: { decided, focus: plan } }) })).due;
    expect(await due(false)).toEqual([]); // the pass that froze it CONSUMED it: a quiet account takes the zero-cost exit
    expect(await due(true)).toEqual(["acquire_case_evidence"]); // the run that froze it is still open and genuinely owes the work
    // And a date I promised that has ARRIVED is owed whether or not a run is open.
    expect((await dueWork(T, new Date(NOW), { ...base, run: async () => ({ open: false, progress: { decided, focus: parked(NOW - 1) } }) })).due)
      .toEqual(["acquire_case_evidence"]); });

  it("says UNREADABLE rather than empty when the durable state cannot be read, so a caller never mistakes a failed read for a finished day", async () => {
    const blind = await dueWork(T, new Date(NOW), { ...base, run: async () => { throw new Error("db down"); } });
    expect([blind.readable, blind.due]).toEqual([false, []]);
    const noPlan = await dueWork(T, new Date(NOW), { ...base, checks: async () => null });
    expect(noPlan.readable).toBe(false);
    expect((await dueWork("", new Date(NOW), base)).readable).toBe(false); }); // no tenant, no answer, no I/O
});
