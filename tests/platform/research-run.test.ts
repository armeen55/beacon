/**
 * Durable visit-driven Research Run (Slice 4 truth-and-lease repair): the truth
 * boundary (advance only on real success/healthy no-op; any failure PAUSES with a
 * bounded last_error, never completes), the database-time lease guards, the
 * pre-phase idempotency identity, account independence, the fail-closed render
 * path, and the honest Today copy. The in-memory repo models the RPC guards.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle, ensureResearchRunOnVisit, type ResearchCycleSteps } from "@/domains/runtime/ops/on-visit-refresh";
let NOW = 1_700_000_000_000;
const iso = (ms = NOW) => new Date(ms).toISOString();
const T = "acct-a";
const U = "acct-b";
const LEASE = RR.RESEARCH_RUN_LEASE_SECONDS * 1000;
const mk = (o: Partial<RR.ResearchRun>): RR.ResearchRun => ({
  id: "seed", tenant_id: T, cycle_key: RR.cycleKeyForUtc(T, new Date(NOW)),
  status: "paused", current_phase: "refresh_sources", phase_cursor: null,
  progress: {}, spend_usd: 0, last_error: null, lease_owner: null, lease_expires_at: null,
  started_at: iso(), updated_at: iso(), completed_at: null,
  ...o,
});
/** In-memory repo modeling the RPCs: advance/renew require a LIVE lease + status
 *  'running'; finish requires a live lease + running|paused. An expired or foreign
 *  owner matches no row, exactly like the database-time WHERE guards. */
function memRepo(): { repo: RR.ResearchRunRepo; rows: RR.ResearchRun[] } {
  const rows: RR.ResearchRun[] = [];
  const find = (id: string, t: string) => rows.find((x) => x.id === id && x.tenant_id === t);
  const live = (r: RR.ResearchRun, o: string) => r.lease_owner === o && r.lease_expires_at != null && Date.parse(r.lease_expires_at) >= NOW;
  const repo: RR.ResearchRunRepo = {
    async claim({ tenantId, cycleKey, owner, leaseSeconds }) {
      const exp = iso(NOW + leaseSeconds * 1000);
      const r = rows.find((x) => x.tenant_id === tenantId && x.cycle_key === cycleKey);
      if (r) {
        const reclaimable =
          (r.status === "running" || r.status === "paused") &&
          (r.lease_owner == null || Date.parse(r.lease_expires_at!) < NOW || r.lease_owner === owner);
        if (!reclaimable) return null;
        Object.assign(r, { lease_owner: owner, lease_expires_at: exp, status: r.status === "paused" ? "running" : r.status });
        return { ...r };
      }
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: cycleKey, status: "running", lease_owner: owner, lease_expires_at: exp }));
      return { ...rows[rows.length - 1]! };
    },
    async advance({ tenantId, id, owner, leaseSeconds, patch }) {
      const r = find(id, tenantId);
      if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, {
        current_phase: patch.phase, progress: patch.progress ?? r.progress,
        phase_cursor: patch.cursor === undefined ? r.phase_cursor : patch.cursor,
        lease_expires_at: iso(NOW + leaseSeconds * 1000),
      });
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
      Object.assign(r, {
        status: outcome, lease_owner: null, lease_expires_at: null,
        last_error: outcome === "completed" ? null : errorInfo ?? null,
        ...(outcome === "completed" ? { current_phase: "done", completed_at: iso() } : {}),
      });
      return true;
    },
    async latest(t) {
      const m = rows.filter((x) => x.tenant_id === t).sort((a, b) => b.started_at.localeCompare(a.started_at));
      return m[0] ? { ...m[0] } : null;
    },
  };
  return { repo, rows };
}
/** A seeded paused (unleased) row a fresh claim can reclaim, plus its rows/repo. */
function withRun(o: Partial<RR.ResearchRun> = {}) {
  const { repo, rows } = memRepo();
  RR.setResearchRunRepoForTests(repo);
  rows.push(mk(o));
  return rows;
}
/** Benign no-op steps; phase-truth tests override the ONE step under test, and the
 *  run's final phase + status proves the untouched phases never advanced. */
const BENIGN: ResearchCycleSteps = {
  refreshSources: async () => ({ attempted: 0, succeeded: 0, failures: [] }),
  backfillChunk: async () => ({ kind: "no_work" }),
  publishSurface: async () => {},
  surfaceStale: async () => false,
};
/** Healthy logging stub for the resume test: each step logs its name so ordering
 *  (proving a done phase is not re-run) is observable. */
function healthySteps(log: string[]): Partial<ResearchCycleSteps> {
  return {
    refreshSources: async () => (log.push("refresh"), { attempted: 2, succeeded: 2, failures: [] }),
    backfillChunk: async () => (log.push("backfill"), { kind: "advanced", daysPulled: 30 }),
    publishSurface: async () => void log.push("publish"),
    surfaceStale: async () => false,
  };
}
/** Drive one cycle for tenant T at the frozen clock, with the given steps. */
const run = (steps: Partial<ResearchCycleSteps>, deadlineMs?: number) =>
  runResearchCycle(T, { now: () => new Date(NOW), steps, ...(deadlineMs === undefined ? {} : { deadlineMs }) });

beforeEach(() => {
  NOW = 1_700_000_000_000;
  RR.setResearchRunRepoForTests(null);
});
describe("research-run lease correctness", () => {
  it("claims exactly once: a foreign lease loses, accounts are independent, an expired lease is recovered, a completed cycle yields no re-run", async () => {
    RR.setResearchRunRepoForTests(memRepo().repo);
    const a = await RR.claimRun(T, "o1", new Date(NOW));
    expect(a).not.toBeNull();
    expect(await RR.claimRun(T, "o2", new Date(NOW))).toBeNull(); // foreign unexpired lease loses
    expect(await RR.claimRun(U, "o3", new Date(NOW))).not.toBeNull(); // other account independent
    NOW += LEASE + 1;
    expect(await RR.claimRun(T, "o2", new Date(NOW))).not.toBeNull(); // expired lease recovered
    await RR.finishRun(T, a!.id, "o2", "completed");
    expect(await RR.claimRun(T, "o4", new Date(NOW))).toBeNull(); // completed today → no re-run
  });
  it("guards every mutation at database time: foreign and expired owners cannot advance / renew / finish, a live owner can, and a completed row rejects mutation", async () => {
    const rows = withRun({ status: "running", lease_owner: "o1", lease_expires_at: iso(NOW + LEASE) });
    const id = rows[0]!.id;
    // Foreign owner is rejected by every mutation.
    expect(await RR.advancePhase(T, id, "intruder", { phase: "done" })).toBe(false);
    expect(await RR.renewLease(T, id, "intruder", { phase: "refresh_sources" })).toBe(false);
    expect(await RR.finishRun(T, id, "intruder", "completed")).toBe(false);
    // The true owner renews (preserving ownership + persisting the cursor).
    expect(await RR.renewLease(T, id, "o1", { phase: "refresh_sources", attemptKey: "k" })).toBe(true);
    expect(rows[0]!.lease_owner).toBe("o1");
    expect(rows[0]!.phase_cursor).toEqual({ phase: "refresh_sources", attemptKey: "k" });
    // An expired owner is dead: it cannot advance or finish.
    NOW += LEASE + 1;
    expect(await RR.advancePhase(T, id, "o1", { phase: "done" })).toBe(false);
    expect(await RR.finishRun(T, id, "o1", "completed")).toBe(false);
    // A completed row rejects further mutation.
    NOW -= LEASE + 1;
    await RR.finishRun(T, id, "o1", "completed");
    expect(await RR.advancePhase(T, id, "o1", { phase: "refresh_sources" })).toBe(false);
    expect(await RR.finishRun(T, id, "o1", "paused")).toBe(false);
  });
});
describe("research-run phase truth", () => {
  it("counts only synced sources as refreshed, and any connector failure pauses at refresh_sources without advancing to publish", async () => {
    const rows = withRun();
    await run({ ...BENIGN, refreshSources: async () => ({ attempted: 3, succeeded: 2, failures: [{ provider: "google_gsc", detail: "429 quota" }] }) });
    expect(rows[0]!.status).toBe("paused");
    expect(rows[0]!.current_phase).toBe("refresh_sources"); // stuck in place → never published off a failed refresh
    expect(rows[0]!.last_error?.phase).toBe("refresh_sources");
    expect(rows[0]!.last_error?.failures).toEqual([{ provider: "google_gsc", detail: "429 quota" }]);
  });
  it("treats zero stale sources as a healthy no-op and completes when every phase succeeds or no-ops", async () => {
    const rows = withRun();
    // Nothing refreshed or backfilled, but the saved surface is stale → publish still runs, then it completes.
    await run({ ...BENIGN, surfaceStale: async () => true });
    expect(rows[0]!.status).toBe("completed");
    expect(rows[0]!.current_phase).toBe("done");
    expect(rows[0]!.last_error).toBeNull();
    expect(rows[0]!.progress.surfacePublished).toBe(true);
  });
  it("pauses at the backfill phase when the chunk errors, and can never present a failed chunk as success", async () => {
    const rows = withRun({ current_phase: "gsc_backfill_chunk" });
    await run({ ...BENIGN, backfillChunk: async () => { throw new Error("gsc backfill chunk did not advance: 429"); } });
    expect(rows[0]!.status).toBe("paused");
    expect(rows[0]!.current_phase).toBe("gsc_backfill_chunk"); // same window retries next visit
    expect(rows[0]!.last_error?.phase).toBe("gsc_backfill_chunk");
    expect(rows[0]!.progress.surfacePublished).toBeUndefined(); // never reached publish
  });
  it("pauses at publish when the surface build fails, never sets surfacePublished, and never completes", async () => {
    const rows = withRun({ current_phase: "publish_surface" });
    // Publish is warranted (surface stale), but the build throws.
    await run({ ...BENIGN, surfaceStale: async () => true, publishSurface: async () => { throw new Error("surface build failed"); } });
    expect(rows[0]!.status).toBe("paused");
    expect(rows[0]!.current_phase).toBe("publish_surface");
    expect(rows[0]!.progress.surfacePublished).not.toBe(true);
    expect(rows[0]!.completed_at).toBeNull();
  });
});
describe("research-run idempotency identity", () => {
  it("hands each phase its persisted attempt key: an interrupted retry reuses the identical key, and the next phase gets a different one", async () => {
    const rows = withRun();
    const refreshKeys: string[] = [];
    const backfillKeys: string[] = [];
    let refreshFails = true;
    const steps: Partial<ResearchCycleSteps> = {
      ...BENIGN,
      refreshSources: async (_t, _n, key) => {
        refreshKeys.push(key);
        return refreshFails
          ? { attempted: 1, succeeded: 0, failures: [{ provider: "google_gsc", detail: "boom" }] }
          : { attempted: 1, succeeded: 1, failures: [] };
      },
      backfillChunk: async (_t, _n, key) => (backfillKeys.push(key), { kind: "no_work" }),
    };
    // First visit: refresh fails → pause at refresh_sources with the cursor persisted.
    await run(steps);
    expect(rows[0]!.status).toBe("paused");
    expect(rows[0]!.current_phase).toBe("refresh_sources");
    // Second visit: refresh now succeeds → resumes the SAME phase (identical key), then advances.
    refreshFails = false;
    await run(steps);
    expect(rows[0]!.status).toBe("completed");
    expect(refreshKeys).toHaveLength(2);
    expect(refreshKeys[0]).toBe(refreshKeys[1]); // interrupted retry reuses the identical key
    expect(backfillKeys[0]).not.toBe(refreshKeys[1]); // the next phase gets a different key
    expect(refreshKeys[0]).toMatch(/^rr_[0-9a-f]{32}$/);
  });
  it("phaseIdempotencyKey is stable across retries and distinct across phases, cursors, and accounts", () => {
    const k = (t: string, p: RR.ResearchPhase, c: Record<string, unknown>) => RR.phaseIdempotencyKey(t, "run1", p, c);
    expect(k(T, "refresh_sources", { a: 1, b: 2 })).toBe(k(T, "refresh_sources", { b: 2, a: 1 })); // key order irrelevant
    expect(k(T, "refresh_sources", { a: 1 })).not.toBe(k(T, "gsc_backfill_chunk", { a: 1 })); // phase
    expect(k(T, "refresh_sources", { a: 1 })).not.toBe(k(T, "refresh_sources", { a: 2 })); // cursor
    expect(k(T, "refresh_sources", { a: 1 })).not.toBe(k(U, "refresh_sources", { a: 1 })); // account
  });
});
describe("research-run resume + status projection", () => {
  it("resumes at the persisted phase (done phases are not re-run) and a deadline pauses durably", async () => {
    const rows = withRun({ current_phase: "gsc_backfill_chunk" });
    const log: string[] = [];
    await run(healthySteps(log), 0); // out of time before any phase
    expect(log).toEqual([]);
    expect(rows[0]!.status).toBe("paused");
    expect(rows[0]!.current_phase).toBe("gsc_backfill_chunk");
    await run(healthySteps(log));
    expect(log).toEqual(["backfill", "publish"]); // never "refresh" (that phase was already done)
    expect(rows[0]!.status).toBe("completed");
    expect(rows[0]!.current_phase).toBe("done");
  });
  it("projects persisted truth: a running row with a dead lease presents as paused; a live one runs", async () => {
    const rows = withRun({ status: "running", lease_owner: "o", lease_expires_at: iso(NOW - LEASE) }); // lease long dead
    expect((await RR.researchRunStatus(T, new Date(NOW))).state).toBe("paused");
    rows[0]!.lease_expires_at = iso(NOW + LEASE); // fresh lease
    const v = await RR.researchRunStatus(T, new Date(NOW));
    expect(v.state).toBe("running");
    expect(v.phaseLabel).toBe("refreshing your connected data");
    expect(v.stepsTotal).toBe(3);
  });
});
describe("research-run Today copy", () => {
  const view = (o: Partial<RR.ResearchRunStatusView>): RR.ResearchRunStatusView => ({
    state: "none", phaseLabel: "", stepsDone: 0, stepsTotal: 3, counters: {}, updatedAt: null, completedAt: null,
    ...o,
  });
  const NOON_PT = Date.parse("2026-07-23T19:00:00Z"); // noon Pacific on Jul 23
  it("never says 'current': same-day completion shows today, an older pass shows its date, running/paused keep their lines, none is silent", () => {
    const completed = view({ state: "completed", completedAt: new Date(NOON_PT).toISOString() });
    const sameDay = RR.researchStatusLine(completed, new Date(NOON_PT));
    expect(sameDay).toBe("Latest research pass finished today at 12:00 PM.");
    const older = RR.researchStatusLine(completed, new Date(NOON_PT + 2 * 24 * 3600 * 1000));
    expect(older).toBe("Latest research pass finished Jul 23 at 12:00 PM.");
    expect(sameDay).not.toMatch(/current/i);
    expect(older).not.toMatch(/current/i);
    expect(RR.researchStatusLine(view({ state: "running", phaseLabel: "refreshing your connected data" }))).toBe(
      "Researching: refreshing your connected data.",
    );
    expect(RR.researchStatusLine(view({ state: "paused", stepsDone: 1 }))).toBe(
      "Research paused after 1 of 3 steps. I'll resume when you return.",
    );
    expect(RR.researchStatusLine(view({ state: "none" }))).toBeNull();
  });
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
