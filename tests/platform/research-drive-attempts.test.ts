/** WHAT ONE DRIVE MAY BUY AND WHAT IT STILL OWES THE WALK, on two synthetic accounts with unrelated subjects,
 *  through the real `runResearchCycle`: a reading is bought once a drive and spends after two attempts per work
 *  identity per day whichever rows owe it and whichever of the two purchase loops paid, every key the ledger and the
 *  row's own prior stamp are read on carries the work identity and joins its parts on a separator no part can carry,
 *  EVERY answer the phase's own step can give sends the loop back through the stock-first block that step's turn
 *  skipped, and the door in front of that block asks the block's own question about room. */
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/lib/persistence/supabase", async (actual) => ({ ...(await actual<Record<string, unknown>>()),
  getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { research_paused: false }, error: null }) }) }) }) }) }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => {}, readCustomerSurface: async () => null, isCustomerSurfaceStale: () => false, refreshCustomerSurface: async () => ({}) }));

import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle, type ResearchCycleSteps } from "@/domains/runtime/ops/on-visit-refresh";
import type { DueWork } from "@/domains/runtime/ops/due-work";
import { setAccountRepositoryForTests, type AccountRepository } from "@/domains/account/tenants/store";

let NOW = 1_700_000_000_000;
const iso = (ms = NOW) => new Date(ms).toISOString();
const SITES = [{ t: "acct-reef", url: "/tide-pool-guide", topic: "tide pool safety" }, { t: "acct-loom", url: "/blackwork-stitches", topic: "ordre des points" }] as const;
const ckey = (t: string, ms = NOW) => `${t}:${new Date(ms).toISOString().slice(0, 10)}`;
const mk = (o: Partial<RR.ResearchRun>): RR.ResearchRun => ({ id: "seed", tenant_id: "t", cycle_key: ckey("t", NOW), status: "paused", current_phase: "refresh_sources", phase_cursor: null,
  progress: {}, spend_usd: 0, last_error: null, lease_owner: null, lease_expires_at: null, started_at: iso(), updated_at: iso(), completed_at: null, ...o });
function memRepo(): { repo: RR.ResearchRunRepo; rows: RR.ResearchRun[] } { const rows: RR.ResearchRun[] = [];
  const find = (id: string, t: string) => rows.find((x) => x.id === id && x.tenant_id === t);
  const open = (t: string) => rows.filter((r) => r.tenant_id === t).reverse().find((x) => x.status === "running" || x.status === "paused");
  const repo: RR.ResearchRunRepo = {
    async claim({ tenantId, owner, leaseSeconds }) { const o = open(tenantId); const exp = iso(NOW + leaseSeconds * 1000);
      if (o) { Object.assign(o, { lease_owner: owner, lease_expires_at: exp, status: "running", updated_at: iso() }); return { ...o }; }
      rows.push(mk({ id: `r${rows.length}`, tenant_id: tenantId, cycle_key: ckey(tenantId, NOW), status: "running", lease_owner: owner, lease_expires_at: exp })); return { ...rows.at(-1)! }; },
    async claimDue() { return []; }, async startPass() { return null; },
    async advance({ tenantId, id, owner, leaseSeconds, patch }) { const r = find(id, tenantId); if (!r || r.lease_owner !== owner || r.status !== "running") return false;
      Object.assign(r, { current_phase: patch.phase, progress: patch.progress ?? r.progress, phase_cursor: patch.cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) }); return true; },
    async renew({ tenantId, id, owner, leaseSeconds, cursor }) { const r = find(id, tenantId); if (!r || r.lease_owner !== owner || r.status !== "running") return false;
      Object.assign(r, { phase_cursor: cursor ?? null, lease_expires_at: iso(NOW + leaseSeconds * 1000) }); return true; },
    async finish({ tenantId, id, owner, outcome, errorInfo, spendUsd }) { const r = find(id, tenantId); if (!r || r.lease_owner !== owner) return false;
      Object.assign(r, { status: outcome, lease_owner: null, lease_expires_at: null, last_error: outcome === "completed" ? null : errorInfo ?? null,
        ...(typeof spendUsd === "number" ? { spend_usd: spendUsd } : {}), ...(outcome === "completed" ? { current_phase: "done", completed_at: iso() } : {}) }); return true; },
    async latest(t) { const m = rows.filter((r) => r.tenant_id === t).at(-1); return m ? { ...m } : null; },
    async sameDay() { return []; } }; return { repo, rows }; }
const freshRepo = (): RR.ResearchRun[] => { const { repo, rows } = memRepo(); RR.setResearchRunRepoForTests(repo); return rows; };
const NO_CHECKS = { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 };
const DUE: DueWork = { due: ["daily_observations"], readable: true, checks: NO_CHECKS, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null, winners: { unread: 0, unranked: 0 } };
const BENIGN: ResearchCycleSteps = { dueWork: async () => DUE, evidenceVersion: async () => null, reconcileCases: async () => {},
  acquireEvidence: async () => ({ acquired: false, detail: "no acquisition in this fixture" }), collectBought: async () => ({ pending: 0, ready: 0 }),
  replenishReady: async () => null, researchOwed: async () => [], dayStanding: async () => NO_CHECKS, strandedToday: async () => [],
  refreshSources: async () => ({ attempted: 0, succeeded: [], failures: [] }), backfillChunk: async () => ({ kind: "no_work" }), crawlPages: async () => 0,
  investigationFocus: async () => null, funnelUnit: async () => ({ status: "done", cursor: null, progress: {} }), currentBasis: async () => "basis_rv4",
  publishSurface: async () => {}, surfaceStale: async () => false, factCheck: async () => ({ status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 0 }),
  analyzeAnswers: async () => ({ attempted: 0, settled: 0, refused: 0, read: 0, outcomes: {} }), verifyShipments: async () => 0, measureShipments: async () => 0 };
beforeEach(() => { NOW = 1_700_000_000_000; RR.setResearchRunRepoForTests(null);
  const byId = async (id: string) => ({ id, slug: id, provisional_name: "", domain: "own.example", status: "active" as const, signup_date: "", tos_accepted_at: null, daily_budget_usd: 0, growth_goal: null, created_at: "", updated_at: "" });
  setAccountRepositoryForTests({ getAccountById: byId, getAccountBySlug: byId } satisfies AccountRepository); });

type Owed = NonNullable<RR.ResearchRunProgress["evidenceOwed"]>[number];

/** ONE DRIVE. `seeded` is what the run row carries when the drive begins; `walked` is what the walk hands back. */
const oneDrive = async (s: typeof SITES[number], seeded: readonly Owed[], walked: readonly Owed[]): Promise<{ asked: number; owed: readonly Owed[] }> => {
  const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "fact_check",
    progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: [...seeded] } })); let asked = 0;
  await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN,
    dueWork: async () => ({ ...DUE, due: ["replenish_ready", "check_page_facts"] }),
    acquireEvidence: async () => (asked += 1, { acquired: false, detail: "the source search is still waiting" }),
    replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [...walked] as never }) } });
  return { asked, owed: rows.at(-1)!.progress?.evidenceOwed ?? [] }; };

/** THE LEDGER IS KEYED BY THE READING AND THE WORK IDENTITY TOGETHER. Keyed by the reading alone, with `spentOn` asked
 *  of the NEED's own identity, one reading owed by two rows under two identities reset its count on every drive. */
describe("the two-attempt stop, when one reading is owed by two rows", () => {
  it.each(SITES)("$t: two rows owing one reading under two work identities are one purchase a drive, and each row spends after its own two attempts with its own work on the stamp", async (s) => {
    const need = (suffix: string, work: string, rank: number): Owed => ({ key: `${s.url}::${suffix}`, kind: "factual_source", query: s.topic, url: s.url, rank,
      reasonCode: "acquire_factual_source", reason: "owed", workKey: work, missingTopic: s.topic });
    const drive = (owed: readonly Owed[]) => oneDrive(s, owed, owed); // the walk hands back exactly what the row already owed
    // one row, one reading: the stop holds, which is round ten's own pin
    let one = await drive([need("a", "w1", 1)]); const solo: number[] = [];
    for (let i = 0; i < 4; i += 1) { solo.push(one.asked); one = await drive(one.owed); }
    // two rows, one reading, two funding identities
    let two = await drive([need("a", "w1", 1), need("b", "w2", 2)]); const pair: number[] = [], stampedWork: (string | undefined)[] = [];
    for (let i = 0; i < 5; i += 1) { pair.push(two.asked); stampedWork.push(two.owed.find((n) => n.key === `${s.url}::a`)?.tried?.work); two = await drive(two.owed); }
    expect([solo, pair], "one row spends its reading after two attempts, and two rows owing THE SAME reading under two funding identities spend it on the same schedule: one purchase serves both, the purchase writes an attempt under each row's own identity, and neither row restarts the other's count")
      .toEqual([[1, 1, 0, 0], [1, 1, 0, 0, 0]]);
    expect(stampedWork, "and each row's stamp names its OWN work, so the receipt never reports an attempt made under a funding identity that is not this row's")
      .toEqual(["w1", "w1", "w1", "w1", "w1"]);
  });
});

/** THE BLOCK'S DOOR IS SKIPPED FOR AN OWED TURN ON THE PROMISE THAT EVERY ANSWER SENDS THE LOOP BACK, so a `failed`
 *  answer owes the walk exactly as a `waiting` one does, and the room the door asks for is the block's own. */
describe("the walk the owed turn skipped", () => {
  const drive = async (s: typeof SITES[number], unit: { status: "waiting" | "failed"; detail?: string }, deadlineMs = 260_000, owedTurn = true) => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "serp_analysis",
      progress: { plan: { units: ["replenish_ready", "plan_cases"] }, ...(owedTurn ? { waited: { phase: "serp_analysis" as const, drives: 1, unpaid: true } } : {}) } }));
    let walks = 0, collects = 0;
    await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs, steps: { ...BENIGN,
      dueWork: async () => ({ ...DUE, due: ["replenish_ready", "plan_cases"] }),
      collectBought: async () => (collects += 1, { pending: 0, ready: 0 }),
      funnelUnit: async () => ({ ...unit, cursor: { pending: 3 }, progress: {} }) as never,
      replenishReady: async () => (walks += 1, { ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } });
    return { walks, collects, blocker: rows.at(-1)!.progress?.state?.blocker ?? null }; };

  it.each(SITES)("$t: an answer that did not finish, failed as much as waiting, sends the loop back for the walk its own turn skipped, and the row keeps the step's own reason", async (s) => {
    const waited = await drive(s, { status: "waiting" }), failed = await drive(s, { status: "failed", detail: "the results-page provider refused" });
    expect([waited.walks, failed.walks, failed.blocker], "the block is skipped for the phase's own turn on the promise that every answer sends the loop back through it, so a drive that spent its turn on a step that failed still prepares finished changes, and the row still carries the step's own reason")
      .toEqual([1, 1, "the results-page provider refused"]);
  });

  it.each(SITES)("$t: the door in front of the block asks the block's own question about room, and still says what the walk could not start", async (s) => {
    const owed = await drive(s, { status: "waiting" }, 100_000, true), plain = await drive(s, { status: "waiting" }, 100_000, false);
    expect([owed.walks, owed.collects, plain.walks, plain.collects], "the block asks for its 45-second minimum and the door in front of it asks the same question, so at 100 seconds the same drive runs the walk's free half and the free collection of results pages already bought whether or not a turn was owed on it")
      .toEqual([plain.walks, plain.collects, 1, 1]);
    expect(owed.blocker, "and the row still says what could not be STARTED on this drive, which is what round nine promised and what `noRoom` inside the walk then enforces").toContain("Preparing more finished changes needs 110 seconds");
  });
});

/** The three rules the same block already held before the reviewer read it, pinned so no repair can quietly cost them. */
describe("what rounds eight to ten do hold", () => {
  const seed = (s: typeof SITES[number], progress: RR.ResearchRunProgress) => { const rows = freshRepo();
    rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "serp_analysis", progress })); return rows; };

  it.each(SITES)("$t: the stock-first block runs at most once on a drive, whatever answers the phase gives it", async (s) => {
    seed(s, { plan: { units: ["replenish_ready", "plan_cases"] }, waited: { phase: "serp_analysis", drives: 1, unpaid: true } });
    let walks = 0; const answers = ["advanced", "waiting", "waiting"] as const; let n = 0;
    await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN,
      dueWork: async () => ({ ...DUE, due: ["replenish_ready", "plan_cases"] }),
      funnelUnit: async () => ({ status: answers[Math.min(n++, 2)]!, cursor: { at: n }, progress: {} }) as never,
      replenishReady: async () => (walks += 1, { ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } });
    expect(walks, "an owed turn, an advanced answer that sends the loop back, then a waiting answer behind the block: the block's own `replenished` mark makes `stockDue` false, so neither door can open it a second time").toBe(1);
  });

  it.each(SITES)("$t: an owed turn whose step answers waiting under the walk's floor always writes the sentence before it pauses", async (s) => {
    const rows = seed(s, { plan: { units: ["replenish_ready", "plan_cases"] }, waited: { phase: "serp_analysis", drives: 1, unpaid: true } });
    await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs: 100_000, steps: { ...BENIGN,
      dueWork: async () => ({ ...DUE, due: ["replenish_ready", "plan_cases"] }),
      funnelUnit: async () => ({ status: "waiting" as const, cursor: { pending: 3 }, progress: {} }),
      replenishReady: async () => ({ ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } });
    expect([rows.at(-1)!.progress?.state?.blocker, rows.at(-1)!.status], "the row says which work was not started, what it needed, what the drive had, and that the next pass runs it first")
      .toEqual(["Preparing more finished changes needs 110 seconds and this drive had 100 left, so nothing was started for it. The next pass runs it first.", "paused"]);
  });

  it.each(SITES)("$t: one reading owed by two rows under ONE work identity is bought once and spent after two attempts, and the latest sentence lands on both rows", async (s) => {
    const need = (suffix: string, rank: number): Owed => ({ key: `${s.url}::${suffix}`, kind: "factual_source", query: s.topic, url: s.url, rank,
      reasonCode: "acquire_factual_source", reason: "owed", workKey: "w1", missingTopic: s.topic });
    const drive = async (owed: readonly Owed[], detail: string): Promise<{ asked: number; owed: readonly Owed[] }> => {
      const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "fact_check",
        progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: [...owed] } })); let asked = 0;
      await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN,
        dueWork: async () => ({ ...DUE, due: ["replenish_ready", "check_page_facts"] }),
        acquireEvidence: async () => (asked += 1, { acquired: false, detail }),
        replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [...owed] as never }) } });
      return { asked, owed: rows.at(-1)!.progress?.evidenceOwed ?? [] }; };
    const one = await drive([need("a", 1), need("b", 2)], "the source search is waiting");
    const two = await drive(one.owed, "the source search returned nothing"), three = await drive(two.owed, "the source search is waiting again");
    expect([one.asked, two.asked, three.asked, two.owed.map((n) => n.tried?.count), two.owed.map((n) => n.tried?.why)],
      "one purchase serves both rows, the count belongs to the reading, the second attempt spends it for both, and each row keeps the LATEST sentence rather than the one that opened the count")
      .toEqual([1, 1, 0, [2, 2], ["the source search returned nothing", "the source search returned nothing"]]);
  });
});

/** REACH IS ASKED OF THE ROW'S KEY AND OF NOTHING ELSE. The producer mints one need per key, so this shape cannot be
 *  minted today; pinned as a fact, so a producer that ever owes two kinds on one key is caught by this arm. */
describe("how far down the order the last walk reached", () => {
  it.each(SITES)("$t: a receipt for one row lifts reach to the deepest rank any need on that key carries, whatever kind it is", async (s) => {
    const owed: Owed[] = [
      { key: `${s.url}::head`, kind: "serp", query: s.topic, rank: 5, reasonCode: "no_serp", reason: "owed", workKey: "w1" },
      { key: `${s.url}::head`, kind: "factual_source", query: s.topic, url: s.url, missingTopic: s.topic, rank: 90, reasonCode: "acquire_factual_source", reason: "owed", workKey: "w1" }];
    const bought: string[] = []; const rows = freshRepo();
    rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: owed,
      replenish: { day: new Date(NOW).toISOString().slice(0, 10), jobs: {}, outcomes: { receipts: [{ key: `${s.url}::head`, outcome: "prepared", providerCalls: 1 }] } } as never } }));
    await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN,
      dueWork: async () => ({ ...DUE, due: ["replenish_ready", "check_page_facts"] }),
      acquireEvidence: async (_t, need) => (bought.push(`${(need as Owed).kind}:${(need as Owed).rank}`), { acquired: false, detail: "still owed" }),
      replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: owed as never }) } });
    expect(bought, "the walk's receipt was earned for the row at rank 5 and the reading bought across the gap is the one at rank 90, because reach is read off the key alone").toEqual(["serp:5", "factual_source:90"]);
  });
});

/** THE STAMP IS WRITTEN BEFORE THE WALK AND NEVER AFTER IT. `stamp(left)` runs inside the pre-walk purchase loop and
 *  `stamp(...)` runs again on the walk's own list BEFORE the loop behind it buys anything, so every attempt the
 *  post-walk loop makes lives in the drive's memory and dies with it. A reading the head of the order defers on every
 *  drive is bought only there, so its count restarts at 1 for ever and the two-attempt stop never reaches it. */
describe("a reading bought after the walk", () => {
  it.each(SITES)("$t: spends after two attempts exactly as one bought before the walk does", async (s) => {
    const need: Owed = { key: `${s.url}::deep`, kind: "factual_source", query: s.topic, url: s.url, rank: 50,
      reasonCode: "acquire_factual_source", reason: "owed", workKey: "w1", missingTopic: s.topic };
    // rank 50 with no walk receipt on file: the pre-walk loop defers at the first gap in the ranking and buys nothing,
    // so this reading is only ever reachable through the loop that runs AFTER the walk.
    let owed: readonly Owed[] = []; const asked: number[] = [], counts: (number | undefined)[] = [];
    for (let i = 0; i < 5; i += 1) { const d = await oneDrive(s, owed, [need]); asked.push(d.asked); counts.push(d.owed[0]?.tried?.count); owed = d.owed; }
    expect([asked, counts], "the reading is attempted, the attempt is counted onto the row, and the third drive spends it: the stop is about the READING and not about which of the two loops paid for it")
      .toEqual([[1, 1, 0, 0, 0], [1, 2, 2, 2, 2]]);
  });
});

/** ONE ENTRY PER SERVED NEED. A purchase that failed writes an attempt for the buying row AND for every row that owes
 *  the same reading, each under its own identity. A row the drive never reached still spends, which is right while the
 *  reading is genuinely one reading; this pins that it is never charged more than the reading was attempted. */
describe("the rows a failed purchase also served", () => {
  it.each(SITES)("$t: a row served only by another row's purchase spends on the reading's own count, never faster", async (s) => {
    const need = (suffix: string, work: string, rank: number): Owed => ({ key: `${s.url}::${suffix}`, kind: "factual_source", query: s.topic, url: s.url, rank,
      reasonCode: "acquire_factual_source", reason: "owed", workKey: work, missingTopic: s.topic });
    let owed: readonly Owed[] = [need("head", "w1", 1), need("tail", "w2", 200)];
    const asked: number[] = [], tail: (number | undefined)[] = [];
    for (let i = 0; i < 4; i += 1) { const d = await oneDrive(s, owed, [...owed]); asked.push(d.asked); tail.push(d.owed.find((n) => n.key === `${s.url}::tail`)?.tried?.count); owed = d.owed; }
    expect([asked, tail], "the deep row is deferred by the ranking on every drive and is served by the head's purchase, so its count is the reading's own count and it stops on the same drive the head does")
      .toEqual([[1, 1, 0, 0], [1, 2, 2, 2]]);
  });
});

/** THE FALLBACK IS THE ROW'S OWN PRIOR STAMP, keyed on `key::kind::query` and never on the work, so a row whose
 *  funding identity MOVED reads back an attempt made under the identity it no longer wears. */
describe("the stamp a row keeps when its funding identity moves", () => {
  it.each(SITES)("$t: names the identity the row wears now, and counts the attempt this drive actually made", async (s) => {
    const at = (work: string): Owed => ({ key: `${s.url}::moved`, kind: "factual_source", query: s.topic, url: s.url, rank: 1,
      reasonCode: "acquire_factual_source", reason: "owed", workKey: work, missingTopic: s.topic });
    const one = await oneDrive(s, [at("w1")], [at("w1")]), two = await oneDrive(s, one.owed, [at("w1")]);
    const moved = await oneDrive(s, two.owed, [at("w2")]);
    expect([two.owed[0]?.tried?.count, moved.asked, moved.owed[0]?.workKey, moved.owed[0]?.tried?.work, moved.owed[0]?.tried?.count],
      "a fresh capture moves the identity and the reading is worth buying again, which it is; what the row then carries has to be THIS identity's own count, not the spent one it left behind")
      .toEqual([2, 1, "w2", "w2", 1]);
  });
});

/** THE COMPOUND KEY IS TWO STRINGS JOINED BY THE SEPARATOR EITHER OF THEM MAY CONTAIN. A work identity is built as
 *  `<declared>::<...>` in the walk's own ledger (research-steps), so the separator is live in the right half. */
describe("the ledger key when the work identity carries the separator", () => {
  it.each(SITES)("$t: two different readings under two different identities never share one ledger entry", async (s) => {
    const a: Owed = { key: `${s.url}::a`, kind: "serp", query: "alpha", rank: 1, reasonCode: "no_serp", reason: "owed", workKey: `job::${s.topic}` };
    const b: Owed = { key: `${s.url}::b`, kind: "serp", query: `alpha::job`, rank: 2, reasonCode: "no_serp", reason: "owed", workKey: s.topic };
    const one = await oneDrive(s, [a, b], [a, b]);
    const stamps = one.owed.map((n) => `${n.key}=${n.tried?.work ?? "-"}`);
    expect(stamps, "each row's stamp names its OWN work identity: `reading::work` is ambiguous the moment either half carries `::`, and a stamp read off the wrong entry reports an attempt made under an identity that is not this row's")
      .toEqual([`${s.url}::a=job::${s.topic}`, `${s.url}::b=${s.topic}`]);
  });
});

/** THE DOOR IN FRONT OF THE STOCK-FIRST BLOCK, after B11 replaced the `waiting` literal with the enclosing
 *  `unit.status !== "done"` and the block's own room question. */
describe("the owed-turn door", () => {
  const run = async (s: typeof SITES[number], answers: readonly ("done" | "waiting" | "failed" | "advanced")[], deadlineMs = 260_000, phase: "serp_analysis" | "fact_check" = "serp_analysis") => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: phase,
      progress: { plan: { units: ["replenish_ready", phase === "fact_check" ? "check_page_facts" : "plan_cases"] }, waited: { phase, drives: 1, unpaid: true } } }));
    let walks = 0, n = 0, units = 0;
    await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs, steps: { ...BENIGN,
      dueWork: async () => ({ ...DUE, due: ["replenish_ready", phase === "fact_check" ? "check_page_facts" : "plan_cases"] }),
      funnelUnit: async () => (units += 1, { status: answers[Math.min(n++, answers.length - 1)]!, cursor: { at: n }, progress: {} }) as never,
      factCheck: async () => (units += 1, { status: "done" as const, banked: 0, bankedPages: [], pagesComplete: 0 }),
      replenishReady: async () => (walks += 1, { ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } });
    return { walks, units, blocker: rows.at(-1)!.progress?.state?.blocker ?? null }; };
  /** THE SAME DRIVE WITH NO TURN OWED: the block is reached on its own door instead of through the one in front of it. */
  const runNoTurn = async (s: typeof SITES[number], deadlineMs: number) => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "fact_check", progress: { plan: { units: ["replenish_ready", "check_page_facts"] } } }));
    let walks = 0;
    await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs, steps: { ...BENIGN,
      dueWork: async () => ({ ...DUE, due: ["replenish_ready", "check_page_facts"] }),
      replenishReady: async () => (walks += 1, { ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } });
    return { walks, blocker: rows.at(-1)!.progress?.state?.blocker ?? null }; };

  it.each(SITES)("$t: no sequence of answers opens the block twice on one drive", async (s) => {
    const churn = await run(s, ["waiting", "waiting", "waiting"]), mixed = await run(s, ["advanced", "failed", "waiting"]), twice = await run(s, ["advanced", "advanced", "waiting"]);
    expect([churn.walks, mixed.walks, twice.walks], "`replenished` closes `stockDue` the moment the block is entered and `walkOwed` pauses the pass after the door fires, so neither door can open it a second time")
      .toEqual([1, 1, 1]);
  });

  it.each(SITES)("$t: a step that FINISHED the phase it took the drive's turn from still owes this drive its walk", async (s) => {
    const done = await run(s, ["done"]), waiting = await run(s, ["waiting"]), failed = await run(s, ["failed"]);
    expect([done.walks, waiting.walks, failed.walks], "the order at :248 skips the block for exactly the pass the turn is taken on, and the promise behind that skip is that the answer sends the loop back through it: waiting and failed do, `advanced` does, and `done` advances the phase instead, so a drive resuming at the last funnel phase its plan allows ends having prepared nothing")
      .toEqual([1, 1, 1]);
  });

  it.each(SITES)("$t: the door and the block ask one question about room at every point of the band", async (s) => {
    // fact_check is the only phase that holds a unit floor out of the walk's box, so it is where the two could differ.
    const band = [260_000, 200_000, 130_000, 90_000, 46_000, 44_000];
    const owed: number[] = [], plain: number[] = [];
    for (const ms of band) { owed.push((await run(s, ["waiting"], ms, "fact_check")).walks); plain.push((await runNoTurn(s, ms)).walks); }
    expect(owed, "`reserveMs()` is one function read at both, and the block's extra `unitHold` is taken only where the room already clears the walk's floor twice over, so the door never sends the loop back for a walk the block then refuses").toEqual(plain);
  });
});
