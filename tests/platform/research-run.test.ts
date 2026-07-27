/**
 * Durable visit-driven Research Run (Slice 4 + claim-semantics repair): the
 * one-open-run-per-account invariant (resume any unfinished run across dates before
 * a new daily cycle), the truth boundary (any failure PAUSES, never completes),
 * partial connector success surviving a pause, deduped refreshed providers across
 * retries, the lease guards, the idempotency identity, and the fail-closed render
 * path. The in-memory repo models the RPC guards and the partial unique index.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle, ensureResearchRunOnVisit, type ResearchCycleSteps } from "@/domains/runtime/ops/on-visit-refresh";
import { setAccountRepositoryForTests, type AccountRepository } from "@/domains/account/tenants/store";
import type { AccountStatus } from "@/domains/account";
import type { CachedCallResult, FunnelUnitOutcome } from "@/domains/evidence/dataforseo/funnel-boundary";
import { promptObservationUnit } from "@/domains/evidence/funnel/observe";
import { CONFLICT_DETAIL, type FunnelDeps } from "@/domains/evidence/funnel/shared";
import { emptyFunnelState } from "@/domains/evidence/funnel/state";

// Slice 5 pre-activation gate: the runtime + the RPC model both refuse research
// work unless the account is active. The account status world defaults every
// tenant to 'active' so every existing cycle test stands unchanged; a test opts
// a tenant into 'pending_onboarding' to exercise the gate.
const ACCOUNT_STATUS = new Map<string, AccountStatus>();
const statusOf = (t: string): AccountStatus => ACCOUNT_STATUS.get(t) ?? "active";
const setAccountStatus = (t: string, s: AccountStatus): void => void ACCOUNT_STATUS.set(t, s);
function installAccountRepo(): void {
  const byId = async (id: string) => ({
    id, slug: id, provisional_name: "", domain: "example.com", status: statusOf(id),
    signup_date: "", tos_accepted_at: null, daily_budget_usd: 0, growth_goal: null,
    created_at: "", updated_at: "",
  });
  const repo: AccountRepository = { getAccountById: byId, getAccountBySlug: byId };
  setAccountRepositoryForTests(repo);
}
let NOW = 1_700_000_000_000;
const iso = (ms = NOW) => new Date(ms).toISOString();
const DAY = 24 * 3600 * 1000;
const T = "acct-a";
const U = "acct-b";
const LEASE = RR.RESEARCH_RUN_LEASE_SECONDS * 1000;
const mk = (o: Partial<RR.ResearchRun>): RR.ResearchRun => ({
  id: "seed", tenant_id: T, cycle_key: RR.cycleKeyForUtc(T, new Date(NOW)), status: "paused",
  current_phase: "refresh_sources", phase_cursor: null, progress: {}, spend_usd: 0, last_error: null,
  lease_owner: null, lease_expires_at: null, started_at: iso(), updated_at: iso(), completed_at: null, ...o,
});
/** In-memory repo modeling the RPC guards: claim resumes the account's single
 *  unfinished run (any date) before a new daily cycle, a foreign LIVE lease returns
 *  null, a same-UTC-day completed run blocks a fresh pass, resume-first keeps the
 *  one-open-run invariant, and the daily key is computed at database time from
 *  NOW; advance/renew need a live lease + 'running', finish a live lease + open. */
function memRepo(): { repo: RR.ResearchRunRepo; rows: RR.ResearchRun[] } {
  const rows: RR.ResearchRun[] = [];
  const find = (id: string, t: string) => rows.find((x) => x.id === id && x.tenant_id === t);
  const live = (r: RR.ResearchRun, o: string) => r.lease_owner === o && r.lease_expires_at != null && Date.parse(r.lease_expires_at) >= NOW;
  const openRun = (t: string) =>
    rows.filter((x) => x.tenant_id === t && (x.status === "running" || x.status === "paused")).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
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
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: RR.cycleKeyForUtc(tenantId, new Date(NOW)), status: "running", lease_owner: owner, lease_expires_at: exp }));
      return { ...rows[rows.length - 1]! };
    },
    async advance({ tenantId, id, owner, leaseSeconds, patch }) {
      const r = find(id, tenantId);
      if (!r || !live(r, owner) || r.status !== "running") return false;
      // Like the SQL: phase_cursor is ALWAYS set to the patch value (null clears).
      Object.assign(r, { current_phase: patch.phase, progress: patch.progress ?? r.progress, phase_cursor: patch.cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) });
      return true;
    },
    async renew({ tenantId, id, owner, leaseSeconds, cursor }) {
      const r = find(id, tenantId);
      if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { phase_cursor: cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) });
      return true;
    },
    async finish({ tenantId, id, owner, outcome, errorInfo }) {
      const r = find(id, tenantId);
      if (!r || !live(r, owner) || !(r.status === "running" || r.status === "paused")) return false;
      const done = outcome === "completed";
      Object.assign(r, { status: outcome, lease_owner: null, lease_expires_at: null, last_error: done ? null : errorInfo ?? null, ...(done ? { current_phase: "done", completed_at: iso() } : {}) });
      return true;
    },
    async latest(t) {
      const m = rows.filter((x) => x.tenant_id === t).sort((a, b) => b.started_at.localeCompare(a.started_at));
      return m[0] ? { ...m[0] } : null;
    },
  };
  return { repo, rows };
}
function freshRepo(): RR.ResearchRun[] {
  const { repo, rows } = memRepo();
  RR.setResearchRunRepoForTests(repo);
  return rows;
}
/** A seeded paused (unleased) today-row a fresh claim can reclaim, plus its rows. */
function withRun(o: Partial<RR.ResearchRun> = {}): RR.ResearchRun[] {
  const rows = freshRepo();
  rows.push(mk(o));
  return rows;
}
/** Benign no-op steps; a phase-truth test overrides the ONE step under test. */
const BENIGN: ResearchCycleSteps = {
  refreshSources: async () => ({ attempted: 0, succeeded: [], failures: [] }),
  backfillChunk: async () => ({ kind: "no_work" }),
  funnelUnit: async () => ({ status: "done", cursor: null, progress: {} }), // evidence phases no-op in these lease/truth tests
  investigationPriorities: async () => [],
  currentBasis: async () => "basis_test", // the account basis the funnel scopes to
  publishSurface: async () => {},
  surfaceStale: async () => false,
};
/** Healthy logging stub: each step logs its name so phase ordering is observable. */
function healthySteps(log: string[]): Partial<ResearchCycleSteps> {
  return {
    refreshSources: async () => (log.push("refresh"), { attempted: 2, succeeded: ["google_gsc", "google_ga4"], failures: [] }),
    backfillChunk: async () => (log.push("backfill"), { kind: "advanced", daysPulled: 30 }),
    publishSurface: async () => void log.push("publish"),
    surfaceStale: async () => false,
  };
}
const run = (steps: Partial<ResearchCycleSteps>, deadlineMs?: number) =>
  runResearchCycle(T, { now: () => new Date(NOW), steps: { ...BENIGN, ...steps }, ...(deadlineMs === undefined ? {} : { deadlineMs }) });

beforeEach(() => {
  NOW = 1_700_000_000_000;
  RR.setResearchRunRepoForTests(null);
  ACCOUNT_STATUS.clear(); // every tenant defaults to active
  installAccountRepo();
});
describe("research-run claim: one open run per account across all dates", () => {
  it("resumes the account's one unfinished run first: yesterday's paused run is reclaimed by the same id with phase and cursor untouched, a later-day visit reuses it, and no second row is ever created", async () => {
    const rows = freshRepo();
    const cursor = { phase: "gsc_backfill_chunk", attemptKey: "k" };
    rows.push(mk({ id: "seed", status: "paused", current_phase: "gsc_backfill_chunk", phase_cursor: cursor, cycle_key: RR.cycleKeyForUtc(T, new Date(NOW - DAY)), started_at: iso(NOW - DAY) }));
    const first = await RR.claimRun(T, "o1");
    expect(first?.id).toBe("seed"); // resumed, not a new run
    expect(first?.current_phase).toBe("gsc_backfill_chunk"); // phase untouched on claim
    expect(first?.phase_cursor).toEqual(cursor); // cursor untouched
    expect(first?.status).toBe("running"); // paused flips to running
    NOW += 2 * DAY; // two UTC days later, o1's lease long dead
    const later = await RR.claimRun(T, "o2");
    expect(later?.id).toBe("seed"); // reuses the one open run, never opens another
    expect(rows).toHaveLength(1); // no current-day row was ever created
  });
  it("lets an older run's lease state govern the claim: a live foreign lease blocks a new run, an expired one is reclaimed on the same row", async () => {
    const rows = freshRepo();
    rows.push(mk({ id: "seed", status: "running", lease_owner: "other", lease_expires_at: iso(NOW + LEASE), started_at: iso(NOW - DAY) }));
    expect(await RR.claimRun(T, "me")).toBeNull(); // live foreign lease blocks a second run
    expect(rows).toHaveLength(1);
    rows[0]!.lease_expires_at = iso(NOW - 1); // the lease expires
    expect((await RR.claimRun(T, "me"))?.id).toBe("seed"); // expired lease reclaimed on the same row
    expect(rows).toHaveLength(1);
  });
  it("keeps accounts independent, blocks a redundant same-day pass after completion, and opens a fresh run only on a later day", async () => {
    const rows = freshRepo();
    const a = await RR.claimRun(T, "o1");
    const b = await RR.claimRun(U, "o2");
    expect(a!.id).not.toBe(b!.id); // one account's open run never blocks another
    expect(rows).toHaveLength(2);
    await RR.finishRun(T, a!.id, "o1", "completed"); // T completes today
    expect(await RR.claimRun(T, "o3")).toBeNull(); // no redundant same-UTC-day pass
    NOW += DAY; // a later eligible day
    const next = await RR.claimRun(T, "o4");
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe(a!.id); // a genuinely new run once none is open
  });
});
describe("research-run pre-activation gate (Slice 5)", () => {
  it("a pending account runs no research at the runtime level: the seeded run is never claimed, no lease is taken, and no new run is created", async () => {
    const rows = withRun(); // a claimable paused today-row for T
    setAccountStatus(T, "pending_onboarding");
    await run(BENIGN);
    expect(rows[0]!.status).toBe("paused"); // untouched — the cycle no-oped before claiming
    expect(rows[0]!.lease_owner).toBeNull(); // no lease was taken
    expect(rows).toHaveLength(1); // no second run was opened
  });
  it("the claim model returns null for a non-active tenant, mirroring the database tenant-active guard", async () => {
    freshRepo();
    setAccountStatus(T, "pending_onboarding");
    expect(await RR.claimRun(T, "o1")).toBeNull(); // nothing claimed or created before activation
  });
});
describe("research-run database-time lease guards", () => {
  it("guards every mutation at database time: foreign and expired owners cannot advance / renew / finish, a live owner can, and a completed row rejects mutation", async () => {
    const rows = withRun({ status: "running", lease_owner: "o1", lease_expires_at: iso(NOW + LEASE) });
    const id = rows[0]!.id;
    expect(await RR.advancePhase(T, id, "intruder", { phase: "done" })).toBe(false);
    expect(await RR.renewLease(T, id, "intruder", { phase: "refresh_sources" })).toBe(false);
    expect(await RR.finishRun(T, id, "intruder", "completed")).toBe(false);
    expect(await RR.renewLease(T, id, "o1", { phase: "refresh_sources", attemptKey: "k" })).toBe(true);
    expect(rows[0]!.lease_owner).toBe("o1");
    expect(rows[0]!.phase_cursor).toEqual({ phase: "refresh_sources", attemptKey: "k" });
    NOW += LEASE + 1; // the owner's lease is now dead
    expect(await RR.advancePhase(T, id, "o1", { phase: "done" })).toBe(false);
    expect(await RR.finishRun(T, id, "o1", "completed")).toBe(false);
    NOW -= LEASE + 1;
    await RR.finishRun(T, id, "o1", "completed");
    expect(await RR.advancePhase(T, id, "o1", { phase: "refresh_sources" })).toBe(false); // completed row rejects mutation
    expect(await RR.finishRun(T, id, "o1", "paused")).toBe(false);
  });
});
describe("research-run phase truth", () => {
  it("counts only synced sources as refreshed, and any connector failure pauses at refresh_sources without advancing to publish", async () => {
    const rows = withRun();
    await run({ ...BENIGN, refreshSources: async () => ({ attempted: 3, succeeded: ["google_gsc", "clarity"], failures: [{ provider: "google_ga4", detail: "429 quota" }] }) });
    expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error?.phase]).toEqual(["paused", "refresh_sources", "refresh_sources"]); // stuck in place → never published off a failed refresh
    expect(rows[0]!.last_error?.failures).toEqual([{ provider: "google_ga4", detail: "429 quota" }]);
    expect(rows[0]!.progress.surfacePublished).toBeUndefined();
  });
  it("treats zero stale sources as a healthy no-op and completes when every phase succeeds or no-ops", async () => {
    const rows = withRun();
    await run({ ...BENIGN, surfaceStale: async () => true }); // nothing refreshed, but the saved surface is stale
    expect([rows[0]!.status, rows[0]!.current_phase, rows[0]!.last_error]).toEqual(["completed", "done", null]);
    expect(rows[0]!.progress.surfacePublished).toBe(true); });
  it("pauses at the phase that throws, never marks it published, and never completes (backfill chunk, then publish build)", async () => {
    const backfill = withRun({ current_phase: "gsc_backfill_chunk" });
    await run({ ...BENIGN, backfillChunk: async () => { throw new Error("gsc backfill chunk did not advance: 429"); } });
    expect([backfill[0]!.status, backfill[0]!.current_phase, backfill[0]!.last_error?.phase]).toEqual(["paused", "gsc_backfill_chunk", "gsc_backfill_chunk"]); // same window retries next visit
    expect(backfill[0]!.progress.surfacePublished).toBeUndefined(); // never reached publish
    const publish = withRun({ current_phase: "publish_surface" }); // fresh repo + seed
    await run({ ...BENIGN, surfaceStale: async () => true, publishSurface: async () => { throw new Error("surface build failed"); } });
    expect([publish[0]!.status, publish[0]!.current_phase]).toEqual(["paused", "publish_surface"]);
    expect(publish[0]!.progress.surfacePublished).not.toBe(true); expect(publish[0]!.completed_at).toBeNull(); });
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
  it("pays for one set of searches and reads competitors for that SAME set, across a pause", async () => {
    const rows = withRun({ current_phase: "serp_analysis" }); const seen: Array<[string, string[]]> = []; let asked = 0;
    const answers = [["a", "b", "c"], ["d", "e", "f"]]; // the second is what a fresh look says once those results pages land
    const steps: Partial<ResearchCycleSteps> = { investigationPriorities: async () => answers[Math.min(asked++, 1)]!,
      funnelUnit: async (phase, _t, _c, _b, priority) => { seen.push([phase, priority]); // the first look waits on the provider, the next visit finishes it
        return phase === "serp_analysis" && seen.length === 1 ? { status: "waiting", cursor: null, progress: {} } : { status: "done", cursor: null, progress: {} }; } };
    await run(steps); expect(rows[0]!.progress.priorityQueries).toEqual(["a", "b", "c"]); // durable BEFORE any paid work
    await run(steps); // a later visit resumes and crosses into winning_pages
    expect(seen).toEqual([["serp_analysis", ["a", "b", "c"]], ["serp_analysis", ["a", "b", "c"]], ["winning_pages", ["a", "b", "c"]]]);
    expect(asked).toBe(1); }); // the run chose once; the second answer never reached a paid phase
  it("does not let one empty read silence a run's priorities for the rest of its life", async () => {
    const rows = withRun({ current_phase: "serp_analysis" }); const seen: string[][] = []; let asked = 0;
    const steps: Partial<ResearchCycleSteps> = { investigationPriorities: async () => (asked++ === 0 ? [] : ["a"]), // the first read comes back cold
      funnelUnit: async (_p, _t, _c, _b, priority) => { seen.push(priority);
        return seen.length === 1 ? { status: "waiting", cursor: null, progress: {} } : { status: "done", cursor: null, progress: {} }; } };
    await run(steps); expect(rows[0]!.progress.priorityQueries).toBeUndefined(); // nothing worth freezing, so nothing frozen
    await run(steps); expect(seen).toEqual([[], ["a"], ["a"]]); }); // the next visit asks again and the run recovers
  it("projects persisted truth: a running row with a dead lease presents as paused; a live one runs", async () => {
    const rows = withRun({ status: "running", lease_owner: "o", lease_expires_at: iso(NOW - LEASE) }); // lease long dead
    expect((await RR.researchRunStatus(T, new Date(NOW))).state).toBe("paused");
    rows[0]!.lease_expires_at = iso(NOW + LEASE); // fresh lease
    const v = await RR.researchRunStatus(T, new Date(NOW));
    expect(v.state).toBe("running");
    expect(v.phaseLabel).toBe("refreshing your connected data");
    expect(v.stepsTotal).toBe(7);
  });
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
});

describe("research-run conflict-free research closure", () => {
  /** THE production incident, hermetic (run cd309823, 2026-07-27): ONE research_state row, a discovery phase that lands this run's
   *  REAL receipt, and a prompt phase whose read is served the snapshot from BEFORE that write. The two writers interleave over one
   *  row, so the prompt unit resets its per-run receipt to zero and its optimistic save conflicts. `staleLoads` = how many prompt
   *  loads see the pre-discovery snapshot. The evidence executor here is the REAL one, driven by the real runResearchCycle. */
  function funnelWorld(rows: RR.ResearchRun[], staleLoads: number) {
    const pre = emptyFunnelState(T, "basis_test"); pre.cycle = { runId: "prev-run", cycleKey: "prev", spentUsd: 1.82, cacheHits: 0 }; // the PREVIOUS run's receipt
    const live = { state: structuredClone(pre), rowVersion: 18 }; const seen: Record<string, unknown>[] = []; const bought = new Set<string>(); let loads = 0, paid = 0;
    const answer = { answerText: "hi", modelServed: null, webSearchReported: null, citations: [], fanOutQueries: null, brands: null };
    const deps: FunnelDeps = { loadActivePrompts: async () => [{ id: "p1", text: "best persian restaurant" }], syncHistory: async () => {}, now: () => NOW, parse: ((_c: unknown, env: unknown) => env) as FunnelDeps["parse"],
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
      return phase === "prompt_observations" ? promptObservationUnit(deps)(tenantId, cursor, budgetMs) : { status: "done", cursor: null, progress: {} }; };
    return { funnelUnit, paid: () => paid, prompts: () => seen.filter((s) => s.phase === "prompt_observations") }; }
  it("recovers the interleave: ONE retry on the same run, phase, lease and attempt key, no duplicate paid post, and the FRESH receipt persists", async () => {
    const rows = withRun(); const w = funnelWorld(rows, 1); await run({ funnelUnit: w.funnelUnit }); // only the first prompt load is stale
    expect(w.prompts()).toHaveLength(2); expect(w.prompts()[0]).toEqual(w.prompts()[1]); // one conflict, exactly one retry, identical run / lease owner / attempt key
    expect([w.paid(), rows[0]!.status]).toEqual([5, "completed"]); // 5 pairs bought once: the retry reused every cache identity at $0, and the run closed instead of pausing
    expect(rows[0]!.progress.funnel).toMatchObject({ retainedKeywords: 700, spendUsd: 0.095, cacheHits: 13 }); }); // the FRESH unit's numbers (4dp receipt), never the stale zeros
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
});
describe("research-run fail-closed + render path", () => {
  it("fails closed when the claim RPC throws, throws on an empty tenant before any I/O, and runs no phase on the render path", async () => {
    let touched = false;
    const log: string[] = [];
    RR.setResearchRunRepoForTests({ ...memRepo().repo, claim: async () => { touched = true; throw new Error("db down"); } });
    await run(healthySteps(log));
    expect(log).toEqual([]); // no phase ran
    expect(touched).toBe(true); // it did try to claim
    touched = false;
    await expect(RR.claimRun("", "o1")).rejects.toThrow(/tenantId is required/);
    expect(touched).toBe(false); // never reached the repo
    const { repo, rows } = memRepo();
    RR.setResearchRunRepoForTests(repo);
    expect(() => ensureResearchRunOnVisit(T)).not.toThrow(); // after() invalid outside a request → caught
    await Promise.resolve();
    expect(rows).toHaveLength(0); // no phase work on the render path
  });
});
