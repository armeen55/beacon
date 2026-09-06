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

/** ONE DRIVE. `seeded` is what the run row carries when the drive begins, `walked` is what the walk hands back, and
 *  `detail` is the sentence every purchase on it comes back with. The whole persisted progress is handed back beside
 *  the debt, because the ledger, the receipts and the row's own stamp are all read off the one drive that wrote them. */
const oneDrive = async (s: typeof SITES[number], seeded: readonly Owed[], walked: readonly Owed[], detail = "the source search is still waiting"): Promise<{ asked: number; owed: readonly Owed[]; progress: RR.ResearchRunProgress }> => {
  const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "fact_check",
    progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: [...seeded] } })); let asked = 0;
  await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN,
    dueWork: async () => ({ ...DUE, due: ["replenish_ready", "check_page_facts"] }),
    acquireEvidence: async () => (asked += 1, { acquired: false, detail }),
    replenishReady: async () => ({ ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [...walked] as never }) } });
  const progress = rows.at(-1)!.progress ?? {}; return { asked, owed: progress.evidenceOwed ?? [], progress }; };

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
/** ONE DRIVE THROUGH A PHASE WHOSE OWN STEP ANSWERS `unit`, and the ONE fixture every door arm below is measured on:
 *  `owedTurn` is a drive that borrowed the phase's turn, `seed` is anything else the row carries, and `rows` continues
 *  the account the drive before it left. Answers what ran, what the row says, and where the phase ended. */
const CASES = ["replenish_ready", "plan_cases"] as const, CAP = "the spending cap ended paid research for today";
const doorDrive = async (s: typeof SITES[number], unit: { status: string; detail?: string }, units: readonly string[], phase: RR.ResearchRun["current_phase"], owedTurn = true, deadlineMs = 260_000, o: { seed?: RR.ResearchRunProgress; rows?: RR.ResearchRun[] } = {}) => {
  const rows = o.rows ?? freshRepo(); if (!o.rows) rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: phase,
    progress: { plan: { units: [...units] as never }, ...(owedTurn ? { waited: { phase: phase as never, drives: 1, unpaid: true } } : {}), ...(o.seed ?? {}) } }));
  let walks = 0, units_ = 0, collects = 0;
  await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs, steps: { ...BENIGN,
    dueWork: async () => ({ ...DUE, due: [...units] as never }),
    dayStanding: async () => NO_CHECKS,
    collectBought: async () => (collects += 1, { pending: 0, ready: 0 }),
    funnelUnit: async () => (units_ += 1, { ...unit, cursor: { at: units_ }, progress: {} }) as never,
    replenishReady: async () => (walks += 1, { ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } });
  const r = rows.at(-1)!; return { walks, collects, units: units_, rows, blocker: r.progress?.state?.blocker ?? null, phase: r.current_phase, status: r.status }; };

describe("the walk the owed turn skipped", () => {
  it.each(SITES)("$t: an answer that did not finish, failed as much as waiting, sends the loop back for the walk its own turn skipped, and the row keeps the step's own reason", async (s) => {
    const waited = await doorDrive(s, { status: "waiting" }, CASES, "serp_analysis"), failed = await doorDrive(s, { status: "failed", detail: "the results-page provider refused" }, CASES, "serp_analysis");
    expect([waited.walks, failed.walks, failed.blocker], "the block is skipped for the phase's own turn on the promise that every answer sends the loop back through it, so a drive that spent its turn on a step that failed still prepares finished changes, and the row still carries the step's own reason")
      .toEqual([1, 1, "the results-page provider refused"]);
  });

  it.each(SITES)("$t: the door in front of the block asks the block's own question about room, and still says what the walk could not start", async (s) => {
    const owed = await doorDrive(s, { status: "waiting" }, CASES, "serp_analysis", true, 100_000), plain = await doorDrive(s, { status: "waiting" }, CASES, "serp_analysis", false, 100_000);
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
    const drive = (owed: readonly Owed[], detail: string) => oneDrive(s, owed, owed, detail); // the walk hands back exactly what the row already owed
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

/** 1a. THE BLOCKING ARM OF RV5, RE-RUN. A reading the ranking defers on every drive is reachable only through the loop
 *  behind the walk, so the stamp that loop writes has to survive the drive, name this row's own work and carry the
 *  sentence the LATEST attempt came back with. */
describe("a reading only the post-walk loop can reach", () => {
  it.each(SITES)("$t: spends after two attempts, and its stamp names its own work and its latest sentence", async (s) => {
    const need: Owed = { key: `${s.url}::deep`, kind: "factual_source", query: s.topic, url: s.url, rank: 50,
      reasonCode: "acquire_factual_source", reason: "owed", workKey: "w1", missingTopic: s.topic };
    let owed: readonly Owed[] = [need]; const asked: number[] = [], seen: string[] = [];
    for (let i = 0; i < 4; i += 1) { const d = await oneDrive(s, owed, [need], `refusal number ${i + 1}`);
      const row = d.owed[0]; asked.push(d.asked);
      seen.push(`${row?.tried?.count ?? 0}/${row?.tried?.work ?? "-"}/${row?.tried?.why ?? "-"}`); owed = d.owed; }
    expect([asked, seen], "the deferred reading is bought twice and never again today, each attempt is counted under the identity the row wears, and the row says what the LAST attempt came back with")
      .toEqual([[1, 1, 0, 0], ["1/w1/refusal number 1", "2/w1/refusal number 2", "2/w1/refusal number 2", "2/w1/refusal number 2"]]);
  });
});

/** 1b. THE TWO LOOPS ON ONE DRIVE. The pre-walk loop persists its stamp, the walk replaces the list, the post-walk loop
 *  stamps again: the row the customer reads must never carry two answers about one purchase. */
describe("the pre-walk and the post-walk loop on one drive", () => {
  it.each(SITES)("$t: one reading both loops touch is one purchase, one count and one sentence on the row", async (s) => {
    const need: Owed = { key: `${s.url}::head`, kind: "factual_source", query: s.topic, url: s.url, rank: 1,
      reasonCode: "acquire_factual_source", reason: "owed", workKey: "w1", missingTopic: s.topic };
    const one = await oneDrive(s, [need], [need], "the source search is still waiting");
    const row = one.owed[0], acq = one.progress.acquisitions ?? [];
    expect([one.asked, row?.tried?.count, row?.tried?.work, [...new Set(acq.map((a) => a.attempts))]],
      "the reading leaves the process once, both loops read one ledger entry, and every receipt this drive files about it says the same attempt number")
      .toEqual([1, 1, "w1", [1]]);
  });

  it.each(SITES)("$t: every owed reading is bought once in front of the walk, and the loop behind it re-serves them from this drive's own memory rather than paying again", async (s) => {
    const need = (n: number): Owed => ({ key: `${s.url}::n${n}`, kind: "factual_source", query: `${s.topic} ${n}`, url: `${s.url}/${n}`, rank: n,
      reasonCode: "acquire_factual_source", reason: "owed", workKey: `w${n}`, missingTopic: `${s.topic} ${n}` });
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(need);
    const one = await oneDrive(s, nine, nine);
    const bought = new Set((one.progress.acquisitions ?? []).filter((a) => a.outcome === "not_read").map((a) => a.key));
    expect([one.asked, bought.has(`${s.url}::n9`)], "nine owed readings leave the process nine times and no more: the loop in front of the walk has no cap of its own, so the ninth is bought on the same drive as the first instead of waiting for tomorrow, and the loop behind the walk reads this drive's own answers for it")
      .toEqual([9, true]);
  });
});

/** 1c. THE SEPARATOR. Every key this drive builds joins its parts on the source escape U+0000. None of them is
 *  persisted, so no row a reader opens can carry the escape unless the account's own data already did. */
const NUL = "\u0000";
describe("the source escape the keys are joined on", () => {
  it.each(SITES)("$t: never reaches a persisted string, and a query that carries it is the only way one can", async (s) => {
    const plain: Owed = { key: `${s.url}::a`, kind: "serp", query: "alpha", rank: 1, reasonCode: "no_serp", reason: "owed", workKey: "w1" };
    const clean = await oneDrive(s, [plain], [plain]);
    const dirty: Owed = { key: `${s.url}::b`, kind: "serp", query: `alpha${NUL}beta`, rank: 1, reasonCode: "no_serp", reason: "owed", workKey: "w1" };
    const carried = await oneDrive(s, [dirty], [dirty]);
    expect([JSON.stringify(clean.progress).includes(NUL), (carried.progress.acquisitions ?? [])[0]?.query],
      "the ledger key, the prior key and the reading identity are this drive's own memory and are never written down, so the only escape a reader ever sees is one the account's own query already carried")
      .toEqual([false, `alpha${NUL}beta`]);
  });

  it.each(SITES)("$t: two readings whose parts differ only by where the escape sits are still two ledger entries", async (s) => {
    const a: Owed = { key: `${s.url}::a`, kind: "serp", query: "alpha", rank: 1, reasonCode: "no_serp", reason: "owed", workKey: `beta${NUL}w` };
    const b: Owed = { key: `${s.url}::b`, kind: "serp", query: `alpha${NUL}beta`, rank: 2, reasonCode: "no_serp", reason: "owed", workKey: "w" };
    const one = await oneDrive(s, [a, b], [a, b]);
    expect(one.owed.map((n) => `${n.key}=${n.tried?.work ?? "-"}`),
      "MEASURED, not endorsed: the escape narrows the ambiguity `::` had, it does not close it. Where either half carries U+0000 the two readings are still ONE ledger entry and the first row's stamp names the second row's identity. B12's own labelled claim is that no live string can carry it")
      .toEqual([`${s.url}::a=w`, `${s.url}::b=w`]);
  });
});

/** 1e. THE DRIVE'S OWN MEMORY. `boughtReadings` is the drive's, so nothing the reading identity keys can outlive it. */
describe("the bought-readings map across a drive boundary", () => {
  it.each(SITES)("$t: a reading bought on one drive is bought again on the next, and no key crosses between them", async (s) => {
    const need: Owed = { key: `${s.url}::x`, kind: "serp", query: "alpha", rank: 1, reasonCode: "no_serp", reason: "owed", workKey: "w1" };
    const one = await oneDrive(s, [need], [need]), two = await oneDrive(s, one.owed, [need]);
    expect([one.asked, two.asked, JSON.stringify(two.progress).includes(NUL)],
      "the second drive pays again because the map died with the first, and the only thing that crossed is the typed count on the row")
      .toEqual([1, 1, false]);
  });
});

/** 1d. THE ONE DOOR. Every answer the phase's own step can give has to send the loop back through the block its turn skipped. */
describe("the door in front of the block, on the last phase the plan allows", () => {
  it.each(SITES)("$t: a done answer on the last funnel phase still owes this drive its walk, exactly once", async (s) => {
    const done = await doorDrive(s, { status: "done" }, ["replenish_ready", "read_winner_pages"], "winning_pages");
    expect([done.walks, done.units, done.phase], "the advance is the one answer that leaves the phase for good, so the door is asked in front of it and the block runs once")
      .toEqual([1, 1, "winning_pages"]);
  });

  it.each(SITES)("$t: the drive the done answer costs is one drive and never the day", async (s) => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "winning_pages",
      progress: { plan: { units: ["replenish_ready", "read_winner_pages"] }, waited: { phase: "winning_pages", drives: 1, unpaid: true } } }));
    let walks = 0, units = 0;
    const one = { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN,
      dueWork: async () => ({ ...DUE, due: ["replenish_ready", "read_winner_pages"] as never }),
      funnelUnit: async () => (units += 1, { status: "done" as const, cursor: null, progress: {} }),
      replenishReady: async () => (walks += 1, { ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } };
    await runResearchCycle(s.t, one); const first = rows.at(-1)!.current_phase;
    await runResearchCycle(s.t, one);
    expect([first, walks, units, rows.at(-1)!.current_phase], "the first drive pauses where it stands and walks once, and the second runs the block first, re-runs the step and takes the advance it earned, so the door costs one drive and never the day")
      .toEqual(["winning_pages", 2, 2, "done"]);
  });

  it.each(SITES)("$t: an advanced answer followed by a done answer opens the block once and no more", async (s) => {
    const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "winning_pages",
      progress: { plan: { units: ["replenish_ready", "read_winner_pages"] }, waited: { phase: "winning_pages", drives: 1, unpaid: true } } }));
    let walks = 0, n = 0; const answers = ["advanced", "done"] as const;
    await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN,
      dueWork: async () => ({ ...DUE, due: ["replenish_ready", "read_winner_pages"] }),
      funnelUnit: async () => ({ status: answers[Math.min(n++, 1)]!, cursor: { at: n }, progress: {} }) as never,
      replenishReady: async () => (walks += 1, { ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } });
    expect(walks, "the block's own mark makes stockDue false, so neither door can open it a second time").toBe(1);
  });
});

/** 1d, the other half: the four answers that leave the phase through a YIELD. The block in front of the phase is
 *  skipped for exactly the pass the step's turn is taken on, and the promise written at :248 and :376 is that every
 *  answer sends the loop back through it. Each arm below pairs the answer with the SAME drive carrying no owed turn,
 *  so the owed turn is the only variable and the fixture cannot be the cause. */
const observed = async (s: typeof SITES[number], unit: { status: string; detail?: string }, standing: unknown, owedTurn: boolean, seenDone = 0) => {
  const rows = freshRepo(); rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "prompt_observations",
    progress: { plan: { units: ["daily_observations", "publish_surfaces"] }, ...(owedTurn ? { waited: { phase: "prompt_observations" as const, drives: 1, unpaid: true } } : {}) } }));
  let walks = 0;
  await runResearchCycle(s.t, { now: () => new Date(NOW), deadlineMs: 260_000, steps: { ...BENIGN,
    dueWork: async () => ({ ...DUE, due: ["daily_observations", "publish_surfaces"], checks: { done: seenDone, total: seenDone > 0 ? 9 : 0, answers: seenDone, unavailable: 0, unsupported: 0 } }),
    funnelUnit: async () => ({ ...unit, cursor: null, progress: {} }) as never,
    dayStanding: async () => standing as never,
    replenishReady: async () => (walks += 1, { ready: 1, deficit: 0, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {}, evidenceOwed: [] as never }) } });
  return walks; };

describe("the answers that leave the phase through a yield", () => {
  it.each(SITES)("$t: a step that took the drive's turn and hit the spending cap still owes this drive its walk", async (s) => {
    const plan = ["plan_cases", "publish_surfaces"] as const;
    const capped = await doorDrive(s, { status: "failed", detail: "the daily spending cap reached for this kind of work" }, plan, "serp_analysis");
    const plain = await doorDrive(s, { status: "failed", detail: "the results-page provider refused" }, plan, "serp_analysis");
    expect([capped.walks, plain.walks], "the cap is a ceiling on money and never a wall across the day, so the free half of the walk this drive borrowed the turn from is exactly what still has to run")
      .toEqual([1, 1]);
  });

  it.each(SITES)("$t: a step that took the drive's turn and left its lane unreadable still owes this drive its walk", async (s) => {
    const owed = await observed(s, { status: "failed", detail: "today's checks could not be planned" }, NO_CHECKS, true);
    const none = await observed(s, { status: "failed", detail: "today's checks could not be planned" }, NO_CHECKS, false);
    expect([owed, none], "one lane never closes the day, and it must not close the walk the turn was borrowed from either").toEqual([1, none]);
  });

  it.each(SITES)("$t: a done step whose day standing cannot be counted still owes this drive its walk", async (s) => {
    const owed = await observed(s, { status: "done" }, null, true), none = await observed(s, { status: "done" }, null, false);
    expect([owed, none], "the lane is filed and the rest of the day runs, and the walk the turn was borrowed from is still owed before the phase is left").toEqual([1, none]);
  });

  it.each(SITES)("$t: a done step whose checks moved nothing still owes this drive its walk", async (s) => {
    const st = { done: 4, total: 9, answers: 4, unavailable: 0, unsupported: 0 };
    const owed = await observed(s, { status: "done" }, st, true, 4), none = await observed(s, { status: "done" }, st, false, 4);
    expect([owed, none], "a round that moved nothing leaves the lane, and the walk the turn was borrowed from is still owed before the phase is left").toEqual([1, none]);
  });
});

/** AND THE ROW SAYS WHAT REALLY STOPPED THE STEP WHILE THAT WALK RUNS (reviewer, 2026-09-06). The walk's own "nothing was
 *  started for it" sentence was written over the step's reason at all four of those exits, on the very drives the walk
 *  then ran on, so the operator was told a false thing twice over: the money door, not the walk, is what ended the step. */
describe("the sentence the row carries when the walk door holds a yield back", () => {
  it.each(SITES)("$t: a step that took the drive's turn and hit the spending cap still says the spending cap stopped it", async (s) => {
    const owed = await doorDrive(s, { status: "failed", detail: CAP }, CASES, "serp_analysis", true, 100_000);
    const plain = await doorDrive(s, { status: "failed", detail: CAP }, CASES, "serp_analysis", false, 100_000);
    expect([owed.walks, plain.walks], "both drives prepare finished changes, which is what round thirteen bought").toEqual([1, 1]);
    expect([plain.blocker, owed.blocker], "the drive that borrowed the phase's turn is told the same thing about the same event: the money door stopped paid research, not that the walk was never started")
      .toEqual([CAP, CAP]);
  });

  it.each(SITES)("$t: an unreadable observation lane keeps its own sentence too", async (s) => {
    const owed = await doorDrive(s, { status: "failed", detail: "the question list could not be read" }, ["replenish_ready", "daily_observations"], "prompt_observations", true, 100_000);
    expect([owed.walks, owed.blocker], "the lane files as unreadable in its own words and the walk still runs behind it")
      .toEqual([1, "the question list could not be read"]);
  });
});

/** AND THE DOOR HOLDS ONE PHASE BACK ONCE AND NEVER TWICE: it answers the same phase, the loop re-enters the stock-first
 *  block whose mark the step's own turn dropped, and the pause behind that block ends the drive, so the yield itself
 *  happens on the next drive, where no turn is owed and paid evidence really does end for the day. */
describe("how many times the door can hold one phase", () => {
  it.each(SITES)("$t: the phase yields no more than once on the drive that borrowed its turn, and is left on the next one", async (s) => {
    const one = await doorDrive(s, { status: "failed", detail: CAP }, CASES, "serp_analysis", true, 100_000);
    const two = await doorDrive(s, { status: "failed", detail: CAP }, CASES, "serp_analysis", true, 100_000, { rows: one.rows });
    expect([one.units, one.walks, one.phase, one.status], "the drive that owed its walk runs the step once, walks once and stands still")
      .toEqual([1, 1, "serp_analysis", "paused"]);
    expect([two.units, two.walks, two.phase], "and the drive behind it, owing no turn, walks first and then leaves the phase, so paid evidence really does end for the day one drive later")
      .toEqual([1, 1, "done"]);
  });

  it.each(SITES)("$t: a turn borrowed where nothing is left to walk leaves the phase at once", async (s) => {
    const closed = { replenish: { day: ckey(s.t, NOW).slice(-10), jobs: {}, closed: "candidates_exhausted" as const } } as RR.ResearchRunProgress;
    const out = await doorDrive(s, { status: "failed", detail: CAP }, CASES, "serp_analysis", true, 100_000, { seed: closed });
    expect([out.walks, out.phase], "the door's first question is whether the stock is still owed, so a day closed on its own exhaustion makes it inert and the yield is immediate")
      .toEqual([0, "done"]);
  });
});

/** A RESULTS PAGE IS CHARGED AT THE POST AND COLLECTED WITH A FREE FOLLOW-UP, so the drive that collects one spends
 *  nothing on it. Counted as a purchase, one page took the one reading a drive may buy out of the ranking's order on
 *  the drive that posted it AND on the drive that collected it (production run p3, 2026-09-06: rank 30 posted 16:00Z,
 *  collected 16:30Z, the rank-57 hub need deferred by the same sentence both times). Every drive below has its clock
 *  spent by the walk, so what the loop AHEAD of the walk decided is the whole of what the drive bought. */
type Answer = { acquired: boolean; posted?: boolean; detail: string };
const serpNeed = (s: typeof SITES[number], suffix: string, work: string, rank: number, over: Partial<Owed> = {}): Owed => ({ key: `${s.url}::${suffix}`, kind: "serp", query: `${s.topic} ${suffix}`, rank, reasonCode: "no_exact_serp", reason: "owed", workKey: work, ...over });
const head = (s: typeof SITES[number]): Owed => serpNeed(s, "head", "w-head", 30, { query: s.topic }), behind = (s: typeof SITES[number]): Owed => serpNeed(s, "behind", "w-behind", 57, { query: `${s.topic} hub` });
// the last walk filed a reached receipt for both rows, so the gap the head of this order leaves may be crossed once
const outcomes = (s: typeof SITES[number]) => ({ readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [],
  receipts: [head(s), behind(s)].map((n) => ({ key: n.key, outcome: "prepared", providerCalls: 1 })) });
const DAY = new Date(NOW).toISOString().slice(0, 10), YESTERDAY = new Date(NOW - 86_400_000).toISOString().slice(0, 10);
/** ONE DRIVE AT THE FACT CHECK. `walked` is the list the walk hands back, `spendMs` what the walk takes off the clock,
 *  and `deadlineMs` decides which of the two purchase loops gets to spend, because the loop in front of the walk stops
 *  under the box the walk begins a job in. */
const postDrive = async (s: typeof SITES[number], seeded: readonly Owed[], answer: (n: Owed) => Answer, o: { walked?: readonly Owed[]; deadlineMs?: number; spendMs?: number } = {}) => {
  const rows = freshRepo(); let at = NOW;
  rows.push(mk({ tenant_id: s.t, cycle_key: ckey(s.t, NOW), current_phase: "fact_check",
    progress: { plan: { units: ["replenish_ready", "check_page_facts"] }, evidenceOwed: [...seeded], replenish: { day: DAY, jobs: {}, outcomes: outcomes(s) } as never } }));
  const asked: string[] = [];
  await runResearchCycle(s.t, { now: () => new Date(at), deadlineMs: o.deadlineMs ?? 260_000, steps: { ...BENIGN,
    dueWork: async () => ({ ...DUE, due: ["replenish_ready", "check_page_facts"] }),
    acquireEvidence: async (_t, n) => (asked.push((n as Owed).key), answer(n as Owed)),
    replenishReady: async () => (at += o.spendMs ?? 210_000, { ready: 0, deficit: 5, persisted: 0, satisfied: false, reason: "made_progress" as const, jobs: {},
      evidenceOwed: [...(o.walked ?? [head(s), behind(s)])] as never, outcomes: outcomes(s) as never }) } });
  const progress = rows.at(-1)!.progress ?? {};
  return { asked, owed: progress.evidenceOwed ?? [], deferred: (progress.acquisitions ?? []).filter((a) => a.outcome === "deferred").map((a) => a.key) }; };
/** The head answers `waiting`, which is the post; everything else refuses in the ordinary way, so the post is the only variable. */
const posts = (s: typeof SITES[number]) => (n: Owed): Answer => n.key === head(s).key
  ? { acquired: false, posted: true, detail: `results page for "${s.topic}": waiting` }
  : { acquired: false, detail: "the results-page provider refused" };

describe("a results page posted on one drive and collected on the next", () => {
  it.each(SITES)("$t: the page is posted and the need behind it is bought on the same drive, and the collection that finishes the page costs neither money nor a turn", async (s) => {
    const one = await postDrive(s, [head(s), behind(s)], posts(s));
    const two = await postDrive(s, one.owed, (n) => n.key === head(s).key ? { acquired: true, detail: `results page for "${s.topic}": done` } : posts(s)(n));
    const stamped = one.owed.find((n) => n.key === head(s).key);
    expect([one.asked, one.deferred, stamped?.postedOn, stamped?.boughtOn ?? null],
      "the post is stamped as a post and never as a buy, because a page that has landed is held back for the rest of the day and a posted one has to stay buyable; and the need behind it is bought on the very drive that posted the page, because no cap holds it back any more")
      .toEqual([[head(s).key, behind(s).key], [], DAY, null]);
    expect([two.asked, two.deferred],
      "the collection is the free follow-up on money already spent, and the need behind it is served again on the same drive: two results pages take one drive between them rather than one drive each")
      .toEqual([[head(s).key, behind(s).key], []]);
  });

  it.each(SITES)("$t: a posted page that never lands still spends after two attempts", async (s) => {
    const one = await postDrive(s, [head(s), behind(s)], posts(s));
    const two = await postDrive(s, one.owed, posts(s));
    const three = await postDrive(s, two.owed, posts(s));
    expect([one.asked, two.asked, three.asked, three.owed.find((n) => n.key === head(s).key)?.tried?.count],
      "posting counts an attempt and the collection that answered nothing counts the second, so both readings stop being bought on the third drive: the two-attempt stop is what bounds a page that never lands, and it is untouched by the loop losing its cap")
      .toEqual([[head(s).key, behind(s).key], [head(s).key, behind(s).key], [], 2]);
  });
});

/** THE STAMP IS THE READING'S AND NOT THE ROW'S, so every row owing the reading one post was made for carries it, and
 *  the buy stamp lands beside it when the page finally does. They cannot disagree: the loop asks the buy stamp first. */
describe("the stamp on the rows one post also serves", () => {
  it.each(SITES)("$t: a row served by another row's post carries the stamp, and keeps it beside the buy stamp once the page lands", async (s) => {
    const first = serpNeed(s, "shared", "w-head", 1), sibling = serpNeed(s, "shared-b", "w-sib", 2, { query: `${s.topic} shared` });
    const answer = (n: Owed): Answer => n.key === first.key ? { acquired: false, posted: true, detail: "waiting" } : { acquired: false, detail: "the results-page provider refused" };
    const one = await postDrive(s, [first, sibling], answer, { walked: [first, sibling] });
    const two = await postDrive(s, one.owed, (n) => n.key === first.key ? { acquired: true, detail: "done" } : answer(n), { walked: one.owed });
    const sib1 = one.owed.find((n) => n.key === sibling.key), sib2 = two.owed.find((n) => n.key === sibling.key);
    expect([one.asked, sib1?.postedOn ?? null], "the post is one purchase for the reading, and every row owing that reading is stamped as posted by it")
      .toEqual([[first.key], DAY]);
    expect([sib2?.boughtOn ?? null, sib2?.postedOn ?? null], "and when the page lands, the row served by it carries both stamps at once; they do not disagree, because the loop asks the buy stamp first and skips the row for the rest of the day")
      .toEqual([DAY, DAY]);
  });
});

/** AND THE STAMP IS THE DAY'S. Yesterday's post is not cleared off the row and is not read as today's either, so the
 *  reading it names still costs this day the one purchase the ranking's order allows. */
describe("the stamp when the day turns", () => {
  it.each(SITES)("$t: a post stamped yesterday is not cleared, and does not spend today's allowance for free", async (s) => {
    const stale = serpNeed(s, "stale", "w1", 1, { postedOn: YESTERDAY }), later = behind(s);
    const seeded = [stale, later];
    const out = await postDrive(s, seeded, () => ({ acquired: false, detail: "the results-page provider refused" }), { walked: seeded });
    expect([out.asked, out.deferred, out.owed.find((n) => n.key === stale.key)?.postedOn], "yesterday's stamp is not today's, so the reading is bought again today at its own rank and the need behind it is bought beside it; the stale value itself stays on the row untouched, because a stamp is a fact about the day it was written on")
      .toEqual([[stale.key, later.key], [], YESTERDAY]);
  });
});

/** AND THE LOOP BEHIND THE WALK DOES NOT ASK THE POST STAMP AT ALL (RV7 finding 1, measured and not endorsed): it
 *  filters on the buy stamp alone, so a free collection takes one of the eight slots there where in front of the walk
 *  it takes none. It costs one drive of latency and never money; the clause that would close it is `n.postedOn !== day`. */
describe("the loop behind the walk, on a drive the loop in front of it could not spend", () => {
  it.each(SITES)("$t: MEASURED: a page already posted today takes one of the eight slots behind the walk, where in front of it it takes none", async (s) => {
    const nine = Array.from({ length: 9 }, (_, i) => serpNeed(s, `n${i}`, `w${i}`, i + 1, i === 0 ? { postedOn: DAY } : {}));
    const out = await postDrive(s, nine, () => ({ acquired: false, detail: "the results-page provider refused" }), { walked: nine, deadlineMs: 120_000, spendMs: 0 });
    expect([out.asked.length, out.asked.includes(nine[0]!.key), out.asked.includes(nine[8]!.key)],
      "the loop in front of the walk had no room and deferred, so these eight are the loop behind it; it filters on the buy stamp alone, so the free collection of a page posted earlier today consumes a slot and the ninth owed reading is not bought at all")
      .toEqual([8, true, false]);
  });
});
