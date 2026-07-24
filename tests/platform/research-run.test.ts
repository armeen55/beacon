/** Durable visit-driven Research Run (Slice 4): DB lease exactly-once, independent accounts, phase resume, fail-closed guards, no phase on render. Injected repo models the claim RPC. */
import { describe, it, expect, beforeEach } from "vitest";
import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle, ensureResearchRunOnVisit, type ResearchCycleSteps } from "@/domains/runtime/ops/on-visit-refresh";
let NOW = 1_700_000_000_000;
const iso = (ms = NOW) => new Date(ms).toISOString();
const T = "acct-a", U = "acct-b", LEASE = RR.RESEARCH_RUN_LEASE_SECONDS * 1000;
const mk = (o: Partial<RR.ResearchRun>): RR.ResearchRun => ({ id: "seed", tenant_id: T, cycle_key: RR.cycleKeyForUtc(T, new Date(NOW)), status: "paused", current_phase: "refresh_sources", phase_cursor: null, progress: {}, spend_usd: 0, last_error: null, lease_owner: null, lease_expires_at: null, started_at: iso(), updated_at: iso(), completed_at: null, ...o });
function memRepo(): { repo: RR.ResearchRunRepo; rows: RR.ResearchRun[] } {
  const rows: RR.ResearchRun[] = [];
  const own = (id: string, t: string, o: string) => rows.find((x) => x.id === id && x.tenant_id === t && x.lease_owner === o);
  const repo: RR.ResearchRunRepo = {
    async claim({ tenantId, cycleKey, owner, leaseSeconds }) {
      const r = rows.find((x) => x.tenant_id === tenantId && x.cycle_key === cycleKey), exp = iso(NOW + leaseSeconds * 1000);
      if (r) {
        if (!((r.status === "running" || r.status === "paused") && (r.lease_owner == null || Date.parse(r.lease_expires_at!) < NOW || r.lease_owner === owner))) return null;
        Object.assign(r, { lease_owner: owner, lease_expires_at: exp, status: r.status === "paused" ? "running" : r.status }); return { ...r };
      }
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: cycleKey, status: "running", lease_owner: owner, lease_expires_at: exp })); return { ...rows[rows.length - 1]! };
    },
    async advance({ tenantId, id, owner, leaseSeconds, patch }) {
      const r = own(id, tenantId, owner); if (!r) return false;
      Object.assign(r, { current_phase: patch.phase, progress: patch.progress ?? r.progress, phase_cursor: patch.cursor ?? r.phase_cursor, lease_expires_at: iso(NOW + leaseSeconds * 1000) }); return true;
    },
    async finish({ tenantId, id, owner, outcome, errorInfo }) {
      const r = own(id, tenantId, owner); if (!r) return false;
      Object.assign(r, { status: outcome, lease_owner: null, lease_expires_at: null, last_error: errorInfo ?? null, ...(outcome === "completed" ? { current_phase: "done", completed_at: iso() } : {}) }); return true;
    },
    async latest(t) { const m = rows.filter((x) => x.tenant_id === t).sort((a, b) => b.started_at.localeCompare(a.started_at)); return m[0] ? { ...m[0] } : null; },
  };
  return { repo, rows };
}
const stub = (calls: string[]): { steps: Partial<ResearchCycleSteps> } => ({ steps: { refreshSources: async () => (calls.push("refresh"), 2), backfillChunk: async () => (calls.push("backfill"), { ran: true, daysPulled: 30 }), publishSurface: async () => void calls.push("publish"), surfaceStale: async () => false } });
describe("research-run durable cycle", () => {
  beforeEach(() => { NOW = 1_700_000_000_000; RR.setResearchRunRepoForTests(null); });
  it("lease is exactly-once: foreign blocks, expired recovers, completed cycle is empty, accounts independent, wrong owner no-ops", async () => {
    RR.setResearchRunRepoForTests(memRepo().repo);
    const a = await RR.claimRun(T, "o1", new Date(NOW)); expect(a).not.toBeNull();
    expect(await RR.claimRun(T, "o2", new Date(NOW))).toBeNull(); // foreign unexpired lease loses
    expect(await RR.claimRun(U, "o3", new Date(NOW))).not.toBeNull(); // other account independent
    expect(await RR.advancePhase(T, a!.id, "wrong", { phase: "done" })).toBe(false); // owner-guarded
    expect(await RR.finishRun(T, a!.id, "wrong", "completed")).toBe(false);
    NOW += LEASE + 1;
    expect(await RR.claimRun(T, "o2", new Date(NOW))).not.toBeNull(); // expired lease recovered
    await RR.finishRun(T, a!.id, "o2", "completed");
    expect(await RR.claimRun(T, "o4", new Date(NOW))).toBeNull(); // completed today → no re-run
  });
  it("resumes at the persisted phase (done phases not re-executed); a deadline pauses durably then resumes", async () => {
    const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo);
    rows.push(mk({ current_phase: "gsc_backfill_chunk" })); const calls: string[] = []; // refresh_sources done last visit
    await runResearchCycle(T, { now: () => new Date(NOW), deadlineMs: 0, ...stub(calls) }); // out of time
    expect(calls).toEqual([]); expect(rows[0]!.status).toBe("paused"); expect(rows[0]!.current_phase).toBe("gsc_backfill_chunk");
    await runResearchCycle(T, { now: () => new Date(NOW), ...stub(calls) });
    expect(calls).toEqual(["backfill", "publish"]); // never "refresh"
    expect(rows[0]!.status).toBe("completed"); expect(rows[0]!.current_phase).toBe("done");
  });
  it("fails closed: a claim-RPC failure runs no phase, empty tenantId throws before I/O, the render path no-ops", async () => {
    let touched = false; const calls: string[] = [];
    RR.setResearchRunRepoForTests({ ...memRepo().repo, claim: async () => { touched = true; throw new Error("db down"); } });
    await runResearchCycle(T, { now: () => new Date(NOW), ...stub(calls) });
    expect(calls).toEqual([]); expect(touched).toBe(true); touched = false;
    await expect(RR.claimRun("", "o1")).rejects.toThrow(/tenantId is required/);
    expect(touched).toBe(false); // never reached the repo
    const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo);
    expect(() => ensureResearchRunOnVisit(T)).not.toThrow(); // after() invalid outside request → caught
    await Promise.resolve(); expect(rows).toHaveLength(0); // no phase on the render path
  });
  it("researchRunStatus projects persisted truth; a dead-lease 'running' row presents as paused", async () => {
    const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo); expect((await RR.researchRunStatus(T, new Date(NOW))).state).toBe("none");
    rows.push(mk({ status: "running", lease_owner: "o", lease_expires_at: iso(NOW - LEASE) })); // lease long dead
    expect((await RR.researchRunStatus(T, new Date(NOW))).state).toBe("paused");
    rows[0]!.lease_expires_at = iso(NOW + LEASE); // fresh lease
    const v = await RR.researchRunStatus(T, new Date(NOW));
    expect(v.state).toBe("running"); expect(v.phaseLabel).toBe("refreshing your connected data"); expect(v.stepsTotal).toBe(3);
  });
  it("phaseIdempotencyKey: identical across retries, different across phases/cursors/accounts", () => {
    const k = (t: string, p: RR.ResearchPhase, c: Record<string, unknown>) => RR.phaseIdempotencyKey(t, "run1", p, c);
    expect(k(T, "refresh_sources", { a: 1, b: 2 })).toBe(k(T, "refresh_sources", { b: 2, a: 1 }));
    expect(k(T, "refresh_sources", { a: 1 })).not.toBe(k(T, "gsc_backfill_chunk", { a: 1 }));
    expect(k(T, "refresh_sources", { a: 1 })).not.toBe(k(T, "refresh_sources", { a: 2 }));
    expect(k(T, "refresh_sources", { a: 1 })).not.toBe(k(U, "refresh_sources", { a: 1 }));
  });
});
