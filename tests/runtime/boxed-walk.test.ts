/** A JOB THAT FINISHED AFTER THE DRIVE STOPPED WAITING IS RECOGNISED, NOT BOUGHT AGAIN (2026-09-05). The drive boxes the WAIT, not the
 *  walk: when the box ends the walk carries on, and the job that was in flight saves its row a minute later. The day remembered that
 *  attempt as "still running", so the next drive funded the very same work and paid a second time for words already on file. The rows
 *  answer first now. Driven through the REAL step and the REAL plan, on two synthetic accounts with nothing in common, with the producer
 *  and the store faked and no provider, no key and no clock of its own. */
import { describe, expect, it, vi } from "vitest";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { settledByRows } from "@/domains/decision/load-proposals";
import type { ChangeProposal } from "@/domains/decision/contracts";

const NOW = new Date("2026-09-05T12:00:00.000Z");
/** THE MOMENT THE JOB IN FLIGHT SAVED ITS ROW: four minutes after the drive stopped waiting, which is the same day and is why it settles. Every stored row carries the moment it was written, so the rows here do too. */
const SAVED = new Date(NOW.getTime() + 4 * 60_000).toISOString();
/** TWO SYNTHETIC ACCOUNTS. `a` is the job the box cuts off mid-flight, `b` the funded job the walk never began. */
const SITES = [
  { t: "acct-tide", a: "/tide-pools", b: "/rock-shelves" },
  { t: "acct-bordado", a: "/bordado", b: "/puntadas" },
];
type Job = { calls: number; last: string; settled: boolean };
type Ask = { memory?: Readonly<Record<string, Job>>; handOver?: (ask: () => { paid: unknown; persisted: number }) => void };

/** ONE WALK, with the producer faked and every other door left real. `out` says how each funded job ended; `ready` and `toDo` are the
 *  rows on file at the moment the walk reads them, which is the whole point: the second walk reads a row the first walk's job saved
 *  after the box had already ended. */
const harness = async (s: (typeof SITES)[number]) => {
  vi.resetModules();
  const wk = (k: string) => `${k}::wc5::e1`; // the identity a workKey carries: the funding key, the writer contract and the evidence behind THIS job
  const M = { out: [] as { key: string; outcome: string; calls: number }[], ready: [] as { workKey: string; createdAt: string }[], toDo: [] as { workKey: string; createdAt: string }[],
    asked: [] as Ask[], handed: null as null | (() => unknown) };
  vi.doMock("@/lib/cost/budget-ledger-supabase", () => ({ getTenantSpentThisMonthUsd: async () => 0 }));
  vi.doMock("@/domains/decision/llm/gateway", () => ({ creditBreakerHeld: async () => false }));
  vi.doMock("@/domains/decision", async () => ({
    resolveCurrentBasis: async () => "b", stockOf: (rows: unknown[]) => rows.length,
    /** THE REAL RULE, never a stub: this is the behaviour under test. */
    settledByRows: (await vi.importActual<typeof import("@/domains/decision/load-proposals")>("@/domains/decision/load-proposals")).settledByRows,
    loadProposalQueue: async () => ({ ready: M.ready, toDo: M.toDo }),
    produceProposalsForTenant: async (_t: string, o: Ask) => {
      M.asked.push(o);
      const declared = [s.a, s.b];
      const funded = declared.filter((k) => { const m = o.memory?.[wk(k)]; return m?.settled !== true && (m?.calls ?? 0) < 2; });
      const receipts = funded.map((key) => { const hit = M.out.find((r) => r.key === key);
        return { key, workKey: wk(key), funded: true, treatment: "add_answer_section", impact: 5, allowance: 6, ops: 2,
          providerCalls: hit?.calls ?? 0, costUsd: 0, providerAttempted: (hit?.calls ?? 0) > 0, outcome: hit?.outcome ?? "not_reached" }; });
      const paid = { declared, funded, attemptUnitsSpent: funded.length * 3, receipts, evidenceOwed: [] };
      o.handOver?.(() => ({ paid, persisted: 0 })); // the walk hands the caller a way to read this record before it starts a funded job, which is what a boxed drive reads instead of losing the pass
      return { persisted: 0, held: [], outcome: "proposals_persisted", paid };
    },
  }));
  const { defaultSteps } = await import("@/domains/runtime/ops/research-steps");
  type Answer = { reason: string; jobs: Record<string, Job>; waiting?: readonly string[]; outcomes?: { ended?: string; receipts?: unknown[] } };
  const walk = async (jobs: Record<string, Job>): Promise<Answer> =>
    await defaultSteps.replenishReady(s.t, NOW, { jobs, filed: (f) => { M.handed = f; } }) as unknown as Answer;
  return { M, wk, walk, boxed: () => (M.handed as unknown as () => Answer)() };
};

describe("the drive stops waiting, the walk does not, and the row it saves is the answer", () => {
  for (const s of SITES) {
    it(`${s.t}: a boxed walk and a stopped walk are two different answers on the row`, async () => {
      const h = await harness(s);
      h.M.out = [{ key: s.a, outcome: "retryable_blocked", calls: 3 }]; // the job still running at the box; the second was funded and never begun
      const whole = await h.walk({}), boxed = h.boxed();
      expect([boxed.outcomes?.ended, whole.outcomes?.ended], "the caller giving up on a running walk and the walk refusing to start work it cannot pay for are told apart, and never printed as one sentence").toEqual(["boxed", "stopped"]);
      expect([(boxed.outcomes?.receipts ?? []).length, boxed.reason], "and a boxed walk still hands back every receipt it had filed, retryable by construction because it never reached the end of its own manifest").toEqual([2, "retryable_blocked"]);
      h.M.out = [{ key: s.a, outcome: "produced", calls: 3 }, { key: s.b, outcome: "produced", calls: 3 }];
      expect((await h.walk({})).outcomes?.ended, "a walk that reached the end of everything it funded says so and neither of the other two words is used for it").toBe("ran");
    });

    it(`${s.t}: the row the boxed job saved after the box settles the day's memory, and the plan funds it as nothing`, async () => {
      const h = await harness(s);
      h.M.out = [{ key: s.a, outcome: "retryable_blocked", calls: 3 }];
      await h.walk({});
      const one = h.boxed().jobs; // the day memory a drive that stopped waiting carries away
      expect([one[h.wk(s.a)], one[h.wk(s.b)]], "the job in flight is remembered with the calls it really made and settles nothing; the one never begun is remembered at zero and is owed at its own rank").toEqual([{ calls: 1, last: "retryable_blocked", settled: false }, { calls: 0, last: "not_reached", settled: false }]);

      const plan = (memory: Record<string, Job>) => DRAFT_BUDGET.plan({ candidates: 5, calls: 30, memory,
        jobs: [s.a, s.b].map((k) => ({ key: k, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS, workKey: h.wk(k) })) });
      expect(plan(one).funded.map((f) => f.key).sort(), "without the row, the next drive funds that same work again and buys the words a second time").toEqual([s.a, s.b].sort());

      h.M.ready = [{ workKey: h.wk(s.a), createdAt: SAVED }]; // THE JOB LANDED ITS ROW AFTER THE BOX ENDED, which is exactly what the live 13:30Z drive did
      h.M.out = [];
      await h.walk(one);
      const asked = h.M.asked[h.M.asked.length - 1]!.memory ?? {};
      expect([asked[h.wk(s.a)], asked[h.wk(s.b)]], "the next walk reads the rows before it funds anything: the boxed job is settled from its own row as produced, and the job that was never begun is left exactly as it was").toEqual([{ calls: 1, last: "produced", settled: true }, { calls: 0, last: "not_reached", settled: false }]);
      expect([plan(asked).funded.map((f) => f.key).sort(), plan(asked).declined.map((d) => d.reason)], "so the one whose words are on file is funded as nothing, in the plan's own words, and the work still owed is the only thing bought").toEqual([[s.b], ["finished work or a settled refusal already stands under this exact evidence"]]);
    });

    it(`${s.t}: a draft the boxed job saved for review settles it too, and a row nothing wrote leaves the work owed`, async () => {
      const h = await harness(s);
      h.M.out = [{ key: s.a, outcome: "retryable_blocked", calls: 3 }];
      await h.walk({});
      const one = h.boxed().jobs;
      h.M.toDo = [{ workKey: h.wk(s.a), createdAt: SAVED }]; // the words are written and one named check stands between them and ready
      await h.walk(one);
      expect(h.M.asked[h.M.asked.length - 1]!.memory?.[h.wk(s.a)], "a draft stored for a person to read is what that attempt produced, so it is not paid for twice either").toEqual({ calls: 1, last: "review_saved", settled: true });
      h.M.toDo = []; h.M.ready = [{ workKey: `${s.b}::wc5::e1`, createdAt: SAVED }]; // a row for OTHER work, which answers nothing about this job
      await h.walk(one);
      expect(h.M.asked[h.M.asked.length - 1]!.memory?.[h.wk(s.a)], "and a key no row of its own answers is untouched: the work is still owed and the next drive takes it").toEqual({ calls: 1, last: "retryable_blocked", settled: false });
    });
  }
});

/** AND ONLY A ROW THIS DAY'S WORK COULD HAVE WRITTEN MAY SETTLE IT (reviewer, 2026-09-05). The rule above is asked of the WHOLE live
 *  queue, not of the rows this drive wrote, so with no moment to measure against a ready row standing since an earlier day settled
 *  today's blocked job: the work was not lost, but the day's own receipt said a drive produced what it did not, and a fresh day memory
 *  could repeat it. The unit rule itself, on the same two accounts, with the moment the walk passes it. */
const KEY = "work::body::one";
const row = (s: (typeof SITES)[number], over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${s.t}::body::x`, tenantId: s.t, kind: "existing_edit", pagePath: s.a, pageUrl: `https://${s.t}.example${s.a}`,
  pageLabel: "Page", primaryQuery: s.a.replace(/[/-]/g, " ").trim(), opportunityType: "Capture clicks", changeFamily: "section", status: "ready",
  researchOnly: false, recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "Finished copy." },
  whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [],
  evidence: { query: s.a, hints: [], evidenceRefCount: 1 }, impactScore: 10, upsidePerMonth: null, publish: "manual",
  createdAt: "2026-08-20T00:00:00.000Z", workKey: KEY, ...over,
} as ChangeProposal);
const DAY = NOW.toISOString().slice(0, 10); // the moment the walk hands the rule: the start of the day this memory belongs to

describe("the day's memory is settled by the rows, and by which rows", () => {
  it.each(SITES)("$t: a row the boxed job landed after the box settles the key it was funded under", (s) => {
    const before = { [KEY]: { calls: 2, last: "retryable_blocked", settled: false } };
    expect(settledByRows(before, { ready: [row(s, { createdAt: SAVED })], toDo: [] }, DAY)[KEY]).toEqual({ calls: 2, last: "produced", settled: true });
    const today = { createdAt: new Date().toISOString() } as Partial<ChangeProposal>; // and with no moment named at all the day this is read on is the floor, which is the day that wrote the memory
    expect(settledByRows(before, { ready: [row(s, today)], toDo: [] })[KEY]).toEqual({ calls: 2, last: "produced", settled: true });
  });

  it.each(SITES)("$t: a row standing since an earlier day settles nothing, so a drive that produced nothing never reads as produced", (s) => {
    const before = { [KEY]: { calls: 2, last: "retryable_blocked", settled: false } };
    const stale = row(s, { updatedAt: "2026-08-20T00:00:00.000Z" } as Partial<ChangeProposal>);
    // THE PIN: a key whose only row predates this drive is still owed, because nothing this drive did produced it.
    expect(settledByRows(before, { ready: [stale], toDo: [] }, DAY)[KEY]).toEqual({ calls: 2, last: "retryable_blocked", settled: false });
    expect(settledByRows(before, { ready: [stale], toDo: [] })[KEY], "and it is owed with no moment named either, because the floor is then the day this is read on").toEqual({ calls: 2, last: "retryable_blocked", settled: false });
    expect(settledByRows(before, { ready: [row(s, { createdAt: SAVED, updatedAt: "2026-08-20T00:00:00.000Z" } as Partial<ChangeProposal>)], toDo: [] }, DAY)[KEY], "and where the store carries an update moment that moment is what answers, never the day the row was first written").toEqual({ calls: 2, last: "retryable_blocked", settled: false });
  });
});
