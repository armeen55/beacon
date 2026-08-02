/** The shell continuation controller (V1 closure, launch blocker 5): an open, visible tab finishes the
 *  day's research by asking the server for one more bounded continuation, and the SERVER owns every bound.
 *  Pinned here: the client's cadence policy (it stops on stop, on a hidden tab, and on its own per-view
 *  ceiling) and the server tick it relays (paused stops, a live pass waits, nothing due stops, a spent
 *  day stops, and two tabs racing cannot both advance the run because the lease answers only one). */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The controller module is imported for its PURE policy only; the action seam is mocked so no server
// module is pulled into this test.
vi.mock("@/app/(shell)/settings/connectors/actions", () => ({ researchTickNow: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { LOOP_START, afterTick, shouldAsk } from "@/components/shell/keep-researching";
import { researchTick } from "@/domains/runtime/ops/on-visit-refresh";
import * as RR from "@/domains/runtime/research-run";
import { setAccountRepositoryForTests, type AccountRepository } from "@/domains/account/tenants/store";
import type { DueWork } from "@/domains/runtime/ops/due-work";

const T = "acct-tick";
const NOW = new Date("2026-08-01T18:00:00.000Z");
const now = () => NOW;

const row = (o: Partial<RR.ResearchRun>): RR.ResearchRun => ({
  id: "r1", tenant_id: T, cycle_key: `${T}:2026-08-01`, status: "completed", current_phase: "done",
  phase_cursor: null, progress: {}, spend_usd: 0, last_error: null, lease_owner: null,
  lease_expires_at: null, started_at: NOW.toISOString(), updated_at: NOW.toISOString(),
  completed_at: NOW.toISOString(), ...o,
});

const work = (owed: boolean): DueWork => ({
  due: owed ? ["refresh_sources"] : [], readable: true, checks: { done: 1, total: 2, answers: 1, unavailable: 0, unsupported: 0 },
  cases: { active: 1, parked: 0 }, nextDueAt: null, evidenceVersion: 1,
});

/** The days the server counted a continuation against, so the call site's own day arithmetic is inspectable. */
const countedDays: string[] = [];

/** The repo the tick reads through: `latest` is the durable state it polls, `grants` is how many callers
 *  the lease lets in (that refusal is the whole two-tab safety story), `counted` is the day's hop total. */
function repoFor(latest: RR.ResearchRun | null, opts: { grants?: number; counted?: number | null } = {}) {
  let grants = opts.grants ?? 0;
  const repo: RR.ResearchRunRepo = {
    async claim() {
      if (grants <= 0) return null;
      grants -= 1;
      return row({ id: "claimed", status: "running", current_phase: "refresh_sources", completed_at: null,
        lease_owner: "me", lease_expires_at: new Date(NOW.getTime() + 240_000).toISOString() });
    },
    async startPass() { return null; },
    async advance() { return true; },
    async renew() { return true; },
    async finish() { return true; },
    async latest() { return latest; },
    async sameDay() { return []; },
    async countContinuation(a: { day: string }) { countedDays.push(a.day); return opts.counted ?? null; },
  };
  RR.setResearchRunRepoForTests(repo);
}

beforeEach(() => {
  countedDays.length = 0;
  const account = async (id: string) => ({ id, slug: id, provisional_name: "", domain: "example.com",
    status: "active" as const, signup_date: "", tos_accepted_at: null, daily_budget_usd: 0,
    growth_goal: null, created_at: "", updated_at: "" });
  setAccountRepositoryForTests({ getAccountById: account, getAccountBySlug: account } satisfies AccountRepository);
});
afterEach(() => {
  RR.setResearchRunRepoForTests(null);
  setAccountRepositoryForTests(null);
});

describe("the tab's cadence policy", () => {
  it("stops for the rest of the page view when the server says stop", () => {
    expect(afterTick(LOOP_START, "stop").stopped).toBe(true);
    expect(shouldAsk(afterTick(LOOP_START, "stop"), true)).toBe(false);
  });

  it("never asks while the tab is hidden, and resumes the moment it is visible again", () => {
    const state = afterTick(LOOP_START, "continue");
    expect(shouldAsk(state, false)).toBe(false);
    expect(shouldAsk(state, true)).toBe(true);
  });

  it("keeps the base interval while work continues and backs off, doubling, while nothing is due", () => {
    expect(afterTick(LOOP_START, "continue").delayMs).toBe(30_000);
    const first = afterTick(LOOP_START, "wait");
    const second = afterTick(first, "wait");
    const third = afterTick(second, "wait");
    expect([first.delayMs, second.delayMs, third.delayMs]).toEqual([45_000, 90_000, 180_000]);
    // Never below fifteen seconds, never a runaway: the backoff is capped and a continuation resets it.
    expect(afterTick(third, "wait").delayMs).toBe(180_000);
    expect(afterTick(third, "continue").delayMs).toBe(30_000);
  });

  it("stops at its own per-page-view ceiling even when the server keeps saying continue", () => {
    let state = LOOP_START;
    let asks = 0;
    while (shouldAsk(state, true)) { asks += 1; state = afterTick(state, "continue"); }
    expect(asks).toBe(12);
    expect(state.stopped).toBe(true);
  });
});

describe("the server tick the tab relays", () => {
  it("stops on a pause the operator has to clear", async () => {
    repoFor(row({ status: "paused", current_phase: "refresh_sources", completed_at: null,
      last_error: { phase: "refresh_sources", message: "I need you to reconnect Google.", at: NOW.toISOString() } }));
    const dueWork = vi.fn(async () => work(true));
    expect(await researchTick(T, 0, { now, steps: { dueWork } })).toEqual({ hop: 0, next: "stop" });
    expect(dueWork).not.toHaveBeenCalled();
  });

  it("waits, spending no continuation, while a pass is already advancing the run", async () => {
    repoFor(row({ status: "running", current_phase: "serp_analysis", completed_at: null }));
    const dueWork = vi.fn(async () => work(true));
    expect(await researchTick(T, 0, { now, steps: { dueWork } })).toEqual({ hop: 0, next: "wait" });
    expect(dueWork).not.toHaveBeenCalled();
  });

  it("stops when the day's work is complete", async () => {
    repoFor(row({}));
    expect(await researchTick(T, 0, { now, steps: { dueWork: async () => work(false) } }))
      .toEqual({ hop: 0, next: "stop" });
  });

  it("asks for one more continuation while work is owed, and stops when the day's bound is spent", async () => {
    // THE HOP IS THE SERVER'S NUMBER, NOT THE BROWSER'S. Both fixtures hand over hop 0, which is what a
    // caller that kept resending zero looked like: counting the client's claim plus one would answer 1 here
    // and hand this tab a fresh allowance on every request, so the day's bound would bound nothing.
    repoFor(row({}), { counted: 5 });
    expect(await researchTick(T, 0, { now, steps: { dueWork: async () => work(true) } }))
      .toEqual({ hop: 5, next: "continue" });
    repoFor(row({}), { counted: 7 });
    expect(await researchTick(T, 0, { now, steps: { dueWork: async () => work(true) } }))
      .toEqual({ hop: 7, next: "stop" });
  });

  it("picks an interrupted run back up, because this IS the next visit its own copy promised", async () => {
    // A deploy or a lambda timeout leaves a `running` row nobody touches again. The projection tells the
    // operator "I pick this back up on your next visit", and the controller that exists to BE that visit
    // read the same projection as a pause and stopped, so the row sat there for the rest of the day.
    const stale = new Date(NOW.getTime() - 11 * 60_000).toISOString();
    repoFor(row({ status: "running", current_phase: "serp_analysis", completed_at: null, updated_at: stale }), { counted: 1 });
    const dueWork = vi.fn(async () => work(true));
    expect(await researchTick(T, 0, { now, steps: { dueWork } })).toEqual({ hop: 1, next: "continue" });
    expect(dueWork).toHaveBeenCalled();
    // And a run that is genuinely still advancing is still a wait, not a second claim.
    repoFor(row({ status: "running", current_phase: "serp_analysis", completed_at: null }), { counted: 1 });
    expect(await researchTick(T, 0, { now, steps: { dueWork: async () => work(true) } })).toEqual({ hop: 0, next: "wait" });
  });

  it("counts the continuation against the operator's own day, not the UTC one", async () => {
    // Six in the evening Pacific on August 1 is already August 2 in UTC. Slicing the instant would spend
    // tomorrow's allowance every evening and hand the tab a fresh six hops seven hours early.
    const evening = new Date("2026-08-02T02:00:00.000Z");
    repoFor(row({}), { counted: 1 });
    await researchTick(T, 0, { now: () => evening, steps: { dueWork: async () => work(true) } });
    expect(countedDays).toEqual(["2026-08-01"]);
  });

  it("stops before anything runs when the account is not active", async () => {
    const pending = async (id: string) => ({ id, slug: id, provisional_name: "", domain: "example.com",
      status: "pending_onboarding" as const, signup_date: "", tos_accepted_at: null, daily_budget_usd: 0,
      growth_goal: null, created_at: "", updated_at: "" });
    setAccountRepositoryForTests({ getAccountById: pending, getAccountBySlug: pending } satisfies AccountRepository);
    repoFor(row({}));
    const dueWork = vi.fn(async () => work(true));
    expect(await researchTick(T, 0, { now, steps: { dueWork } })).toEqual({ hop: 0, next: "stop" });
    expect(dueWork).not.toHaveBeenCalled();
  });

  it("lets exactly one of two racing tabs advance the run: the lease answers only one", async () => {
    repoFor(row({}), { grants: 1, counted: 1 });
    let refreshes = 0;
    const steps = {
      dueWork: async () => work(true),
      refreshSources: async () => { refreshes += 1; return { attempted: 1, succeeded: [],
        failures: [{ provider: "google_gsc", detail: "not connected" }] }; },
    };
    const both = await Promise.all([researchTick(T, 0, { now, steps }), researchTick(T, 0, { now, steps })]);
    expect(refreshes).toBe(1);
    expect(both.every((t) => t.next === "continue")).toBe(true);
  });
});
