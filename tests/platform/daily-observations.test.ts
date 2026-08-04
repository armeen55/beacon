/** The daily AI-answer plan (V1 Truth Convergence Phase 1): ONE canonical reading per tracked question, per engine, per UTC day; core questions first and
 * oldest-missing-first; an already-answered pair is never asked twice; extra readings only on an explicit ask, only after the canonical round, never past three; a
 * version bump is a NEW measurement identity; an engine I cannot ask is excluded and blocks nobody. Plus the read-back step: one gateway call per NEW answer hash, and
 * zero calls on a re-run. Fixtures only, zero network. */
import { describe, it, expect, beforeEach, vi } from "vitest";
/** The ONE fake in this file: Postgres, and only for the tracked-question read below. Every other test here
 *  is pure fixtures and injects its own readers, so nothing else ever reaches it. */
const pg = vi.hoisted(() => ({ queued: [] as { data: unknown; error: unknown }[], queries: 0, cols: [] as string[], inserted: [] as Record<string, unknown>[] }));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => { const q: Record<string, unknown> = {
    select: (c: string) => { pg.queries += 1; pg.cols.push(c); return q; }, eq: () => q, contains: () => q, order: () => q, limit: () => q,
    insert: async (row: Record<string, unknown>) => { pg.inserted.push({ table, ...row }); return { error: null }; },
    then: (res: (v: unknown) => void) => res(pg.queued.shift() ?? { data: [], error: null }) }; return q; } }),
}));
/** The spend gate, allowed, so the read-back path below is exercised end to end without a ledger. */
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({
  checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {},
  reserveOnboardingSpend: async () => ({ ok: true }), reconcileOnboardingSpend: async () => {},
}));
/** WHAT THE PROVIDER REGISTRY CAN ASK TODAY. The planner derives its engine set from the registry through
 *  this one predicate, so turning a capability off here is the only way to prove the derivation is live. */
const registry = vi.hoisted(() => ({ off: new Set<string>() }));
vi.mock("@/domains/evidence/dataforseo/funnel-boundary", async (orig) => ({
  ...((await orig()) as object), capabilityAskable: (cap: string) => !registry.off.has(cap),
}));
/** What the pass SAID, so a swallowed write can be told apart from a recorded one. */
const said = vi.hoisted(() => ({ warnings: [] as string[], errors: [] as string[] }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {},
  error: (msg: string) => { said.errors.push(msg); },
  warn: (msg: string) => { said.warnings.push(msg); } } }));
import { identityFrom } from "@/domains/account/brand-identity";
import { setAccountRepositoryForTests } from "@/domains/account/tenants/store";
import { __resetBusinessProfileCacheForTests, seedBusinessProfileForTests } from "@/domains/account/business-profile";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
import { isAnalysisSettled, type AiObservationView, type DueObservation } from "@/domains/evidence/ai-visibility/ai-observations";
import {
  DAILY_OBSERVATION_BATCH, FAILED_RETRIES_PER_DAY, MAX_SAMPLES_PER_DAY, dailyChecks, dueObservations, extraSampleVerdict,
  planObservations, requestExtraSample, runAnswerAnalyses, selectAnalysisTargets,
  type DayMarkers, type ExtraSampleGrant,
} from "@/domains/runtime/ops/daily-observations";
import { applyTrackedSelection, readActiveTrackedPrompts, type TrackedPromptRow } from "@/domains/runtime/prompt-set";
import { reportingDay } from "@/lib/reporting-day";
import type { AnswerAnalysis } from "@/domains/decision/llm/schemas";

const DAY = "2026-07-31", ENGINES: DueObservation["engine"][] = ["chatgpt", "claude", "gemini", "perplexity"];
const T = "acct-a";
/** Three approved questions, oldest first, all on series 1. */
const q = (id: string, createdAt: string, core = true, version = 1) => ({ id, text: `question ${id}`, version, core, createdAt });
const PROMPTS = [q("p1", "2026-01-01"), q("p2", "2026-02-01"), q("p3", "2026-03-01")];
/** One stored observation row in the reader's own view shape. */
const seen = (o: Partial<AiObservationView> & { promptId: string; engine: string }): AiObservationView => ({
  id: `obs-${o.promptId}-${o.engine}-${o.slot ?? 0}-${o.day ?? DAY}`, version: 1, slot: 0, day: DAY, status: "observed",
  observedAt: null, requestedAt: `${o.day ?? DAY}T08:00:00.000Z`, failureReason: null, promptText: "", answerText: null,
  answerHash: null, citationUrls: null, analysis: null, analysisHash: null, ...o,
});
const key = (d: { promptId: string; version: number; engine: string; slot: number }) => `${d.promptId}|${d.version}|${d.engine}|${d.slot}`;
/** Every pair answered on `day`, so the canonical round is complete. */
const fullDay = (day = DAY, slot = 0) => PROMPTS.flatMap((p) => ENGINES.map((e) => seen({ promptId: p.id, engine: e, slot, day })));

describe("daily observation plan", () => {
  it("plans exactly one slot-0 reading per question and engine, oldest question first, and never re-asks a pair already answered today", () => {
    const all = planObservations(DAY, { prompts: PROMPTS, observed: [], maxBatch: 99 });
    expect(all).toHaveLength(12); // 3 questions x 4 engines, slot 0 only
    expect(all.every((d) => d.slot === 0 && d.version === 1)).toBe(true);
    // Oldest-missing-first: nothing has ever been read, so the OLDEST question leads, engines in fixed order.
    expect(all.slice(0, 5).map((d) => `${d.promptId}|${d.engine}`))
      .toEqual(["p1|chatgpt", "p1|claude", "p1|gemini", "p1|perplexity", "p2|chatgpt"]);
    // A pair read TODAY is done; a pair read on an EARLIER day is still owed today (no backfill of the old day).
    const partial = planObservations(DAY, { prompts: PROMPTS, observed: [
      seen({ promptId: "p1", engine: "chatgpt" }),
      seen({ promptId: "p2", engine: "chatgpt", day: "2026-07-30", observedAt: "2026-07-30T00:00:00.000Z" }),
    ], maxBatch: 99 });
    expect(partial.some((d) => d.promptId === "p1" && d.engine === "chatgpt")).toBe(false);
    expect(partial.some((d) => d.promptId === "p2" && d.engine === "chatgpt")).toBe(true);
    expect(partial).toHaveLength(11);
    // A pair read YESTERDAY is fresher than one never read, so it goes AFTER the never-read pairs.
    expect(partial.at(-1)).toMatchObject({ promptId: "p2", engine: "chatgpt" });
    // A missed day is never asked about again: yesterday plans nothing new for a today-only reader.
    expect(planObservations("2026-07-30", { prompts: PROMPTS, observed: fullDay("2026-07-30"), maxBatch: 99 })).toEqual([]);
  });
  it("puts core questions first and caps the plan to one bounded batch", () => {
    const mixed = [q("z-legacy", "2020-01-01", false), ...PROMPTS];
    const plan = planObservations(DAY, { prompts: mixed, observed: [], maxBatch: 99 });
    expect(plan[0]).toMatchObject({ promptId: "p1", engine: "chatgpt" }); // core beats the older non-core row
    expect(plan.slice(0, 12).every((d) => d.promptId !== "z-legacy")).toBe(true);
    const wide = [...mixed, q("p4", "2026-04-01"), q("p5", "2026-05-01")]; // 6 questions x 4 engines is more than one pass may plan
    expect(planObservations(DAY, { prompts: wide, observed: [] })).toHaveLength(DAILY_OBSERVATION_BATCH);
  });
  it("excludes an engine it cannot ask without blocking the engines it can", () => {
    const plan = planObservations(DAY, {
      prompts: PROMPTS, observed: [], engines: ["chatgpt", "claude", "gemini"], unsupportedPairs: ["p2|claude"], maxBatch: 99,
    });
    expect(plan.some((d) => d.engine === "perplexity")).toBe(false);
    expect(plan.some((d) => d.promptId === "p2" && d.engine === "claude")).toBe(false);
    expect(plan.filter((d) => d.promptId === "p2")).toHaveLength(2); // p2 still gets every engine that works
    expect(plan).toHaveLength(8);
  });
  it("treats a version bump as a NEW measurement identity, and prompt-set bumps it on a rewording and on a revival", () => {
    // Series 1 was fully read today. Bump the question to series 2 and it is owed again, under the new identity.
    const bumped = [{ ...PROMPTS[0]!, version: 2 }, PROMPTS[1]!, PROMPTS[2]!];
    const plan = planObservations(DAY, { prompts: bumped, observed: fullDay(), maxBatch: 99 });
    expect(plan).toHaveLength(4);
    expect(plan.every((d) => d.promptId === "p1" && d.version === 2)).toBe(true);
    // And the writer is what bumps it. A rewording retires the old row untouched and mints a fresh series;
    // dropping a question then bringing it back is a real gap, so the revival starts series 2 on the SAME id.
    const row = (id: string, text: string, is_active: boolean, version: number): TrackedPromptRow => ({
      id, tenant_id: T, account_id: T, text, topic_id: null, location_scope: null, service_scope: null,
      intent_type: "category", platforms: ["chatgpt", "claude", "gemini", "perplexity"], tags: ["core_v1"],
      is_active, version, core: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    });
    const rows = Array.from({ length: 12 }, (_, i) => row(`k${i}`, `kept question ${i}`, i !== 11, i === 11 ? 3 : 1));
    const ctx = { tenantId: T, basis: "basis_a", nowIso: "2026-07-31T00:00:00.000Z" };
    const out = applyTrackedSelection(rows, { keepIds: rows.map((r) => r.id), edits: [{ id: "k0", newText: "reworded question" }], additions: [] }, ctx);
    expect(out.ok).toBe(true);
    const writes = out.ok ? out.writes : [];
    expect(writes.find((w) => w.id === "k0")).toMatchObject({ is_active: false, version: 1 }); // history keeps its series
    expect(writes.find((w) => w.is_active && w.text === "reworded question")).toMatchObject({ version: 1, core: true }); // a fresh id starts at series 1
    expect(writes.find((w) => w.id === "k11")).toMatchObject({ is_active: true, version: 4 }); // the revival is a new series on the same id
    expect(writes.find((w) => w.id === "k1")).toBeUndefined(); // an untouched keep is never rewritten, so its series never moves
  });
});

describe("extra readings", () => {
  const base = { prompts: PROMPTS, observed: [] as AiObservationView[] };
  it("refuses an extra reading before today's canonical round is done, grants one after it, and refuses at three", () => {
    const early = extraSampleVerdict(DAY, { ...base, observed: [seen({ promptId: "p1", engine: "chatgpt" })] });
    expect(early.granted).toBe(false);
    expect(early.due).toEqual([]);
    expect(early.reason).toContain("11 question and engine pairs");
    expect(early.reason).not.toMatch(/[\u2014\u2013]/); // Beacon voice: no em or en dash, ever
    const after = extraSampleVerdict(DAY, { ...base, observed: fullDay() });
    expect(after.granted).toBe(true);
    expect(after.due).toHaveLength(12);
    expect(after.due.every((d) => d.slot === 1)).toBe(true);
    const twice = extraSampleVerdict(DAY, { ...base, observed: [...fullDay(), ...fullDay(DAY, 1)], extraSamples: 1 }); // one already granted; this is the second press
    expect(twice.granted && twice.due.every((d) => d.slot === 2)).toBe(true);
    const full = extraSampleVerdict(DAY, { ...base, observed: [...fullDay(), ...fullDay(DAY, 1), ...fullDay(DAY, 2)], extraSamples: 2 });
    expect(full.granted).toBe(false);
    expect(full.due).toEqual([]);
    expect(full.reason).toContain(`${MAX_SAMPLES_PER_DAY} readings`);
  });
  it("never plans slot 1 or 2 without an explicit ask, and stops at three even when asked", () => {
    expect(planObservations(DAY, { ...base, observed: fullDay(), maxBatch: 99 })).toEqual([]); // complete day, no ask, no work
    const capped = planObservations(DAY, { ...base, observed: [...fullDay(), ...fullDay(DAY, 1), ...fullDay(DAY, 2)], extraSamples: 2, maxBatch: 99 });
    expect(capped).toEqual([]);
    const one = planObservations(DAY, { ...base, observed: fullDay(), extraSamples: 1, maxBatch: 99 });
    expect(new Set(one.map(key)).size).toBe(12);
    // ONE grant buys ONE extra round: with slot 1 in, a second slot needs a second ask.
    expect(planObservations(DAY, { ...base, observed: [...fullDay(), ...fullDay(DAY, 1)], extraSamples: 1, maxBatch: 99 })).toEqual([]);
    expect(planObservations(DAY, { ...base, observed: [...fullDay(), ...fullDay(DAY, 1)], extraSamples: 2, maxBatch: 99 }).every((d) => d.slot === 2)).toBe(true);
  });
  it("refuses honestly rather than guessing when it cannot read where today stands", async () => {
    const out = await requestExtraSample(T, DAY, {
      readPrompts: async () => null,
      readObservations: async () => { throw new Error("db down"); },
    });
    expect([out.granted, out.due]).toEqual([false, []]);
    expect(out.reason).toContain("could not read");
  });
  it("SAVES the grant so the next pass actually plans it, and refuses rather than promising a reading it could not record", async () => {
    let stored: ExtraSampleGrant | null = null;
    const world = { readPrompts: async () => PROMPTS, readObservations: async () => fullDay(),
      readMarkers: async () => (stored ? { extraSamples: stored } : {}),
      writeMarkers: async (_t: string, p: { extraSamples?: ExtraSampleGrant }) => { if (p.extraSamples) stored = p.extraSamples; return true; } };
    const first = await requestExtraSample(T, DAY, world);
    expect([first.granted, stored]).toEqual([true, { day: DAY, granted: 1 }]);
    // THE POINT: a NEW request cycle, nothing in memory, and the planner still knows a second reading is owed.
    const plan = await dueObservations(T, DAY, world);
    expect(plan).toHaveLength(12);
    expect(plan!.every((d) => d.slot === 1 && d.day === DAY)).toBe(true);
    // Yesterday's grant never spends today's money.
    expect(await dueObservations(T, "2026-08-01", { ...world, readObservations: async () => fullDay("2026-08-01") })).toEqual([]);
    // A grant I could not record is a refusal, never a promise.
    const lost = await requestExtraSample(T, DAY, { ...world, writeMarkers: async () => false });
    expect([lost.granted, lost.due]).toEqual([false, []]);
    expect(lost.reason).toContain("could not save");
  });
  it("reports today's standing with the plan, so the progress number a surface shows is the planner's own arithmetic", async () => {
    const world = { readPrompts: async () => PROMPTS, readMarkers: async () => null };
    const cold = await dailyChecks(T, DAY, { ...world, readObservations: async () => [] });
    expect([cold!.done, cold!.total, cold!.due.length]).toEqual([0, 12, 12]); // nothing landed yet, twelve pairs owed
    const partial = await dailyChecks(T, DAY, { ...world, readObservations: async () => ENGINES.map((e) => seen({ promptId: "p1", engine: e })) });
    expect([partial!.done, partial!.total, partial!.due.length]).toEqual([4, 12, 8]); // done plus due always accounts for the whole round
    const finished = await dailyChecks(T, DAY, { ...world, readObservations: async () => fullDay() });
    expect([finished!.done, finished!.total, finished!.due.length]).toEqual([12, 12, 0]);
    // Yesterday's readings are not today's progress, and an unreadable store reports nothing rather than zero.
    expect((await dailyChecks(T, DAY, { ...world, readObservations: async () => fullDay("2026-07-30") }))!.done).toBe(0);
    expect(await dailyChecks(T, DAY, { ...world, readObservations: async () => { throw new Error("store down"); } })).toBeNull();
  });
  it("plans NOTHING and says so when it cannot read the questions or the answers already on file", async () => {
    const prompts = async () => PROMPTS, observed = async () => [], readMarkers = async () => null;
    expect(await dueObservations(T, DAY, { readPrompts: async () => null, readObservations: observed, readMarkers })).toBeNull();
    expect(await dueObservations(T, DAY, { readPrompts: prompts, readObservations: async () => { throw new Error("store down"); }, readMarkers })).toBeNull();
    expect(await dueObservations(T, DAY, { readPrompts: async () => [], readObservations: observed, readMarkers })).toEqual([]); // no questions is a real, empty answer
    expect(await dueObservations(T, DAY, { readPrompts: prompts, readObservations: observed, readMarkers })).toHaveLength(12);
  });
});

describe("reading the approved questions", () => {
  beforeEach(() => { pg.queued = []; pg.queries = 0; pg.cols = []; });
  const missingColumn = { data: null, error: { code: "42703", message: 'column tracked_prompts.version does not exist' } };
  const rows = [{ id: "p1", text: "question p1", tags: ["core_v1"], is_active: true, created_at: "2026-01-01" }];
  it("retries without the version columns ONLY when they are genuinely missing, and never reads a live row as series 1 on a transient failure", async () => {
    // The deploy-before-migration window: the columns really are absent, so the retry is the honest read.
    pg.queued = [missingColumn, { data: rows, error: null }];
    const migrating = await readActiveTrackedPrompts(T);
    expect(migrating).toEqual([{ id: "p1", text: "question p1", version: 1, core: true, createdAt: "2026-01-01" }]);
    expect([pg.queries, pg.cols[1]]).toEqual([2, "id,text,tags,is_active,created_at"]);
    // Any OTHER error is a FAILED READ. Retrying it once read live rows as series 1 and minted a duplicate
    // same-day identity under a version the question had already moved past.
    pg.queued = [{ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }, { data: rows, error: null }];
    pg.queries = 0;
    expect(await readActiveTrackedPrompts(T)).toBeNull();
    expect(pg.queries).toBe(1); // one query, one honest null
  });
});

describe("reading the answers back", () => {
  /** Who the account is, in the shape the Account kernel derives it. */
  const BRAND = { name: "Acme", forms: ["acme.com", "acme"], host: "acme.com" };
  const analysis = {
    sections: [], claims: [{ subject: "acme", text: "Acme is open on Sundays" }], topicEntities: ["Acme"],
    ownedBrandMention: { mentioned: true, position: 1, context: null }, competitors: [],
    contentTypesRecommended: [], questionsAnswered: [], materialOmissions: [], caveats: [],
  } as unknown as AnswerAnalysis;
  const row = (id: string, answerHash: string, analysisHash: string | null, analysed: boolean): AiObservationView => ({
    id, promptId: `p-${id}`, version: 1, engine: "chatgpt", slot: 0, day: DAY, status: "observed", observedAt: null,
    requestedAt: `${DAY}T08:00:00.000Z`, failureReason: null,
    promptText: "who is open on sunday", answerText: "Acme is open on Sundays.", answerHash, citationUrls: null,
    analysis: analysed ? { ok: true } : null, analysisHash,
  });
  /** A batch reading that answers every observation it was handed. */
  const readsAll = async ({ targets }: { targets: readonly { row: { id: string } }[] }) =>
    new Map(targets.map((t) => [t.row.id, analysis]));
  it("analyses only what is new: ONE call for a batch of fresh answers, none for an answer already read, and nothing at all on a re-run", async () => {
    const fresh = row("a", "h1", null, false);          // never analysed
    const stale = row("b", "h2-new", "h2-old", true);   // the answer changed under an old analysis
    const done = row("c", "h3", "h3", true);            // already read at this exact hash
    expect(selectAnalysisTargets([fresh, stale, done]).map((r) => r.id)).toEqual(["a", "b"]);
    const groups: number[] = [], saved: Array<[string, string]> = [];
    const deps = { readObservations: async () => [fresh, stale, done], readPrompts: async () => null, identity: BRAND,
      analyzeBatch: async (i: { targets: readonly { row: { id: string } }[] }) => { groups.push(i.targets.length); return readsAll(i); },
      persist: async (_t: string, id: string, _a: Record<string, unknown>, hash: string) => void saved.push([id, hash]) };
    expect(await runAnswerAnalyses(T, DAY, deps)).toBe(2);
    expect(groups).toEqual([2]); // TWO answers, ONE call: this is the whole point
    expect(saved).toEqual([["a", "h1"], ["b", "h2-new"]]);
    // The same pass again, with the analyses now on file: zero calls, zero cents.
    groups.length = 0;
    const settled = [row("a", "h1", "h1", true), row("b", "h2-new", "h2-new", true), done];
    expect(await runAnswerAnalyses(T, DAY, { ...deps, readObservations: async () => settled })).toBe(0);
    expect(groups).toEqual([]);
  });
  it("reads a WHOLE day of 140 answers back inside the passes the day runs, at the call count the batch size predicts", async () => {
    // 35 questions on 4 engines is 140 answers a day. At one call per answer that needed 28 passes, not 8.
    const store = new Map(Array.from({ length: 140 }, (_, i) => [`o${i}`, row(`o${i}`, `hash${i}`, null, false)]));
    let calls = 0, passes = 0;
    const deps = { readObservations: async () => [...store.values()], readPrompts: async () => null, identity: BRAND,
      analyzeBatch: async (i: { targets: readonly { row: { id: string } }[] }) => { calls += 1; return readsAll(i); },
      persist: async (_t: string, id: string, a: Record<string, unknown>, hash: string) => { store.set(id, { ...store.get(id)!, analysis: a, analysisHash: hash }); } };
    while (passes < 8 && selectAnalysisTargets([...store.values()]).length > 0) { passes += 1; await runAnswerAnalyses(T, DAY, deps); }
    // Every answer ends the day ANALYZED or explicitly REJECTED: nothing is left owing.
    expect(selectAnalysisTargets([...store.values()])).toEqual([]);
    expect(passes).toBe(7);   // 20 answers a pass, so the day empties in seven of the passes a day actually runs
    expect(calls).toBe(28);   // ceil(140 / 5): exactly what the batch size predicts, and every call small enough to get through the minute
  });
  it("rejects ONE answer the batch left out, alone, and never lets it cost its neighbours their readings", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(`m${i}`, `hm${i}`, null, false));
    const saved: Array<[string, Record<string, unknown>, string]> = [];
    const written = await runAnswerAnalyses(T, DAY, {
      readObservations: async () => rows,
      // The model answered for two of the three, and invented an id nobody asked about.
      analyzeBatch: async ({ targets }) => new Map([[targets[0]!.row.id, analysis], [targets[2]!.row.id, analysis], ["obs-nobody-asked-about", analysis]]),
      persist: async (_t, id, a, hash) => void saved.push([id, a, hash]),
      readPrompts: async () => null, identity: BRAND,
    });
    expect(written).toBe(2);                       // the two real readings stand
    expect(saved.map((s) => s[0])).toEqual(["m0", "m1", "m2"]); // and the missing one is still settled
    expect(saved[1]![1]).toMatchObject({ rejected: true });
    expect(saved[1]![2]).toBe("hm1");              // against ITS OWN answer hash, so it leaves the worklist
    expect(String(saved[1]![1].reason)).not.toMatch(/[—–]/);
    expect(saved.some((s) => s[0] === "obs-nobody-asked-about")).toBe(false); // a reading for an id I never sent is dropped
  });
  it("degrades a REFUSED batch to one answer at a time, settles every answer it was carrying, and never lets it starve the batches after it", async () => {
    // Four batches of five, which is one pass's whole reach. The gateway already retried batch one's shape once on its own, so a second identical batch buys the same refusal and the ladder drops a rung. The fallback allowance used to be FIVE FOR THE WHOLE PASS, so batch one's failure ate all of it and batches two, three and four settled nothing.
    const rows = Array.from({ length: 20 }, (_, i) => row(`b${String(i).padStart(2, "0")}`, `hb${i}`, null, false)), saved = new Map<string, Record<string, unknown>>();
    let batches = 0, singles = 0;
    const written = await runAnswerAnalyses(T, DAY, { readObservations: async () => rows, readPrompts: async () => null, identity: BRAND,
      analyzeBatch: async ({ targets }) => { batches += 1; return batches === 1 ? null : readsAll({ targets }); },
      analyze: async () => { singles += 1; return singles === 1 ? null : analysis; }, // the poisoned answer is the first one
      persist: async (_t, id, a) => void saved.set(id, a) });
    expect([batches, singles]).toEqual([4, 5]);     // one batch attempt each, and every answer the refused one carried re-read alone
    expect([written, saved.size]).toEqual([19, 20]); // nineteen real readings, and the poisoned answer settled rather than retried forever
    expect(saved.get("b00")).toMatchObject({ rejected: true, outcome: "refused" });
    expect(selectAnalysisTargets(rows.filter((r) => !saved.has(r.id)))).toEqual([]); // nothing this pass read is left owing
  });
  // Selection counted ANSWERS while the budget is spent in PIECES, so the calls ran out part way down the
  // list and the remainder was dropped where nothing said so. Overflow is deferred now, never abandoned.
  it("defers whole answers it cannot finish this pass, and abandons no piece of the ones it takes", async () => {
    const long = (id: string) => ({ ...row(id, `h-${id}`, null, false), answerText: "Acme is open on Sundays. ".repeat(1_400) });
    const rows = Array.from({ length: 20 }, (_, i) => long(`L${String(i).padStart(2, "0")}`));
    const taken = selectAnalysisTargets(rows);
    expect(taken.length).toBeLessThan(rows.length);      // twenty multi-piece answers do not fit four calls
    const pieces: string[] = [], saved = new Set<string>();
    // A SPLIT ANSWER'S READING COMES HOME TO ITS OWN PIECE, which is the key the batch echoes back.
    const written = await runAnswerAnalyses(T, DAY, { readObservations: async () => rows, readPrompts: async () => null, identity: BRAND,
      analyzeBatch: async ({ targets }) => { pieces.push(...targets.map((t) => t.key)); return new Map(targets.map((t) => [t.key, analysis])); },
      persist: async (_t, id) => void saved.add(id) });
    // Every piece of every answer this pass claimed was actually read, and every claimed answer was settled.
    expect(new Set(pieces.map((k) => k.split("#")[0]))).toEqual(new Set(taken.map((r) => r.id)));
    expect([written, saved.size]).toEqual([taken.length, taken.length]);
    // And the rest are still due, exactly as they were: nothing was consumed to produce nothing.
    expect(selectAnalysisTargets(rows.filter((r) => !saved.has(r.id))).length).toBeGreaterThan(0);
  });
  it("records a refusal against the answer it was refused on, so the same answer is never bought twice", async () => {
    const rejected = row("x", "h-x", null, false);
    const saved: Array<[string, Record<string, unknown>, string]> = [];
    const written = await runAnswerAnalyses(T, DAY, { readObservations: async () => [rejected], readPrompts: async () => null, identity: BRAND,
      analyzeBatch: async () => null, analyze: async () => null, // the firewall or the schema refused it
      persist: async (_t, id, a, hash) => void saved.push([id, a, hash]) });
    expect([written, saved.length]).toEqual([0, 1]); // a refusal is not an analysis, but it IS recorded
    expect(saved[0]![0]).toBe("x");
    expect(saved[0]![1]).toMatchObject({ rejected: true });
    expect(saved[0]![2]).toBe("h-x"); // stamped with the answer hash, so this row leaves the worklist
    // Which is exactly what the next pass reads: the row is settled, and only a NEW answer re-qualifies it.
    expect(selectAnalysisTargets([{ ...rejected, analysis: { rejected: true, outcome: "refused" }, analysisHash: "h-x" }])).toEqual([]);
    expect(selectAnalysisTargets([{ ...rejected, answerHash: "h-new", analysis: { rejected: true, outcome: "refused" }, analysisHash: "h-x" }]).map((r) => r.id)).toEqual(["x"]);
  });
  it("treats a throttled reader as the provider's problem, not the answer's: no verdict, still due, and the 278 already stamped come back", async () => {
    // Aug 3 and 4: 278 answers, every one rejected on a 429 and stamped with its own answer hash, so the system believed it had read them forever and
    // Visibility divided by the handful the matcher happened to match. A refusal on the CONTENT is the opposite: it settles, names itself permanent, and
    // carries the deterministic verdict in BOTH polarities, so the denominator is every answer read rather than every match found.
    const rows = Array.from({ length: 20 }, (_, i) => row(`t${i}`, `ht${i}`, null, false)), saved: Array<[string, Record<string, unknown>, string]> = [];
    const missed = { ...row("n", "h-n", null, false), answerText: "This answer names nobody at all." };
    await runAnswerAnalyses(T, DAY, { readObservations: async () => [missed, row("y", "h-y", null, false)], readPrompts: async () => null, identity: BRAND, analyzeBatch: async () => null, analyze: async () => null, persist: async (_t, id, a, hash) => void saved.push([id, a, hash]) });
    expect(saved.map((s) => [s[0], s[2], s[1].outcome, (s[1].ownedBrandMention as { mentioned: boolean }).mentioned])).toEqual([["n", "h-n", "refused", false], ["y", "h-y", "refused", true]]);
    const stamped = { ...rows[0]!, analysis: { rejected: true, reason: "the batch came back missing" }, analysisHash: "ht0" }; // AND THE HISTORY REQUEUES ITSELF
    expect([isAnalysisSettled(stamped), selectAnalysisTargets([stamped]).map((r) => r.id), isAnalysisSettled({ ...stamped, analysis: { rejected: true, outcome: "refused" } })]).toEqual([false, ["t0"], true]);
    // AND A THROTTLE DISCOVERED IN THE FALLBACK ENDS THE PASS TOO: the next batch used to go straight back to a provider that had just refused to serve it.
    let batch2 = 0, single2 = 0;
    await runAnswerAnalyses(T, DAY, { readObservations: async () => rows, readPrompts: async () => null, identity: BRAND, persist: async () => {},
      analyzeBatch: async () => { batch2 += 1; return null; }, analyze: async () => { single2 += 1; return "transient" as const; } });
    expect([batch2, single2]).toEqual([1, 1]); // one refused batch, one throttled single, and the pass stops there
  });
  it("never pays twice to be told nothing: a call that RETURNED settles every answer it covered, and only a call that never returned stays due", async () => {
    // 638 OpenAI calls and $0.80 bought ZERO analysis rows: a batch abandoned at MY OWN timeout after the model had been writing was classed transport-transient, so nothing was persisted and the next pass re-bought the identical batch. Billed is billed, and only a throttle, a server fault or a connection that never opened is due again.
    const rows = Array.from({ length: 3 }, (_, i) => row(`z${i}`, `hz${i}`, null, false)), abandoned = { error: "The operation was aborted due to timeout", retryable: true };
    const saved: Array<[string, Record<string, unknown>]> = []; pg.inserted.length = 0; const pass = async (complete: CompleteFn) => { saved.length = 0; return runAnswerAnalyses(T, DAY, { readObservations: async () => rows, readPrompts: async () => null, identity: BRAND, complete, persist: async (_t, id, a) => void saved.push([id, a]) }); };
    expect([await pass(async () => abandoned), saved.length, saved.every(([, a]) => a.outcome === "refused"), selectAnalysisTargets(rows.map((r, i) => ({ ...r, analysis: saved[i]?.[1] ?? null, analysisHash: `hz${i}` })))]).toEqual([0, 3, true, []]); // every answer that call covered is settled once for this hash, and never bought again
    expect(pg.inserted.map((r) => [r.table, r.rec_id, r.evidence_hash])).toEqual(rows.map((r) => ["llm_rejections", r.id, r.answerHash])); // the ledger that exists for exactly this is wired
    // AND THE READINGS STILL LAND: an abandoned batch drops to ONE CALL PER ANSWER, the path that read 274 answers a day in July. A transport 429 is the opposite: nothing came back, nothing was billed, nothing is stored, every answer stays due.
    expect([await pass(async ({ kind }) => (kind === "answer_analysis_batch" ? abandoned : { value: analysis })), saved.every(([, a]) => a.rejected !== true)]).toEqual([3, true]);
    expect([await pass(async () => ({ error: "openai_429", retryable: true })), saved, selectAnalysisTargets(rows).length]).toEqual([0, [], 3]);
  });
  it("keeps reading through a sustained throttle: a batch too big for the minute drops to single reads on the SAME pass", async () => {
    // PROVEN LIVE: the 15 answer batch was ~75,000 input tokens on its own, tripped the org's per-minute ceiling, took openai_http_429 twice every pass, and stopped the pass having tried nothing at all. A single read is ~1,500 tokens, which trickled through the same limits all July at 274 calls a day.
    const rows = Array.from({ length: 3 }, (_, i) => row(`q${i}`, `hq${i}`, null, false)), saved: Array<[string, Record<string, unknown>]> = []; let batches = 0, singles = 0;
    const written = await runAnswerAnalyses(T, DAY, { readObservations: async () => rows, readPrompts: async () => null, identity: BRAND, persist: async (_t, id, a) => void saved.push([id, a]),
      analyzeBatch: async () => { batches += 1; return "transient" as const; }, analyze: async () => { singles += 1; return singles === 2 ? "transient" as const : analysis; } });
    expect([batches, singles, written, saved.map(([id]) => id)]).toEqual([1, 2, 1, ["q0"]]); // the throttled batch degraded HERE, the first single landed, the throttled single stopped the pass
    expect(selectAnalysisTargets(rows.slice(1)).map((r) => r.id)).toEqual(["q1", "q2"]); // and the answers nothing was told about are still due, with nothing stored against them
  });
  it("re-reads an answer bought on an earlier day, oldest owed day first, and stops looking back at seven days", async () => {
    // The readback only ever read the RUN's own day, so Aug 4's 138 requeued only if a pass ran on Aug 4 and Aug 3's 140 were unreachable forever.
    const asked: string[][] = [], readDays: string[] = [];
    const written = await runAnswerAnalyses(T, DAY, { readPrompts: async () => null, identity: BRAND, analyzeBatch: readsAll, persist: async () => {},
      unreadDays: async (_t, from, to) => { asked.push([from, to]); return ["2026-07-26", DAY]; },
      readObservations: async (_t, o) => { readDays.push(String(o.day)); return [{ ...row("o", "h-o", null, false), day: "2026-07-26" }]; } });
    expect([asked, readDays, written]).toEqual([[["2026-07-25", DAY]], ["2026-07-26"], 1]); // a seven day window ending today, and the OLDEST day owed is read first
  });
  it("gives a LOST refusal write the same retry and the same loud failure as a lost reading", async () => {
    // A silently swallowed rejection left the row at the top of the worklist, re-buying the same refusal.
    let tries = 0;
    const refused = (persist: () => Promise<void>) => runAnswerAnalyses(T, DAY, { readObservations: async () => [row("s", "h-s", null, false)],
      analyzeBatch: async () => null, analyze: async () => null, persist, readPrompts: async () => null, identity: BRAND });
    await refused(async () => { tries += 1; if (tries === 1) throw new Error("write lost"); });
    expect(tries).toBe(2); // exactly one retry, never a loop
    tries = 0;
    await refused(async () => { tries += 1; throw new Error("write lost"); });
    expect(tries).toBe(2);
    expect(said.warnings.join(" ")).toContain("could not record that I was refused a reading");
  });
  it("counts only what actually persisted, and gives a lost write exactly ONE retry", async () => {
    let tries = 0;
    const written = await runAnswerAnalyses(T, DAY, { analyzeBatch: readsAll, readPrompts: async () => null, identity: BRAND,
      readObservations: async () => [row("w0", "hw0", null, false), row("w1", "hw1", null, false)],
      persist: async (_t, id) => { tries += 1; if (id === "w1") throw new Error("write lost"); } });
    expect(written).toBe(1); // two read back, one write lost, and a lost write is never a saved analysis
    expect(tries).toBe(3);   // one clean write plus exactly one retry of the lost one, never a loop
  });
  /** ONE LONG ANSWER, IN PIECES: they ride the same batch and merge into one stored reading. */
  type Piece = { key: string; part: number; parts: number; text: string; row: { id: string } };
  const longAnswer = (tail: string, chars = 12_000): string => {
    const paras: string[] = [];
    while (paras.join("\n\n").length < chars) paras.push(`Paragraph ${paras.length}. ${"ordinary prose about this topic. ".repeat(10)}`);
    return [...paras, tail].join("\n\n");
  };
  const empty = { sections: [], claims: [], topicEntities: [], ownedBrandMention: { mentioned: false, position: null, context: null },
    competitors: [], contentTypesRecommended: [], questionsAnswered: [], materialOmissions: [], caveats: [] } as unknown as AnswerAnalysis;
  it("counts the account as mentioned when ONLY the second piece of a long answer named it", async () => {
    const saved: Record<string, unknown>[] = [];
    await runAnswerAnalyses(T, DAY, { readPrompts: async () => null, identity: BRAND, persist: async (_t, _id, a) => void saved.push(a),
      readObservations: async () => [{ ...row("M", "h-M", null, false), answerText: longAnswer("Nothing further of note here.") }],
      analyzeBatch: async ({ targets }: { targets: readonly Piece[] }) => new Map(targets.map((t) =>
        [t.key, t.part === 2 ? { ...empty, ownedBrandMention: { mentioned: true, position: 4, context: null } } : empty])) });
    // The answer's own words never say "Acme", so only the merge across pieces can make this true.
    expect(saved[0]).toMatchObject({ ownedBrandMention: { mentioned: true, position: 4 }, matchedBy: "model", readParts: 3 });
  });
  it("grounds every reading in ITS OWN answer, so a number from answer A cannot validate a claim about answer B", async () => {
    // One combined corpus grounded all fifteen, so A's number made a fabricated claim about B look proven.
    const saved: Array<[string, Record<string, unknown>]> = [];
    const written = await runAnswerAnalyses(T, DAY, { readPrompts: async () => null, identity: BRAND, persist: async (_t, id, x) => void saved.push([id, x]),
      readObservations: async () => [{ ...row("A", "h-A", null, false), answerText: "Acme served 4200 people last year." },
        { ...row("B", "h-B", null, false), answerText: "This answer gives no figures at all." }],
      analyzeBatch: async ({ targets }: { targets: readonly Piece[] }) => new Map(targets.map((t) =>
        [t.key, { ...empty, claims: [{ subject: "acme", text: `it served 4200 people` }] }])) });
    expect(written).toBe(1);                                     // A's reading stands: its own answer says 4200
    expect(saved.map((s) => s[0])).toEqual(["A", "B"]);          // and B is still settled, never left owing
    expect(saved[0]![1]).toMatchObject({ claims: [{ text: "it served 4200 people" }] });
    expect(saved[1]![1]).toMatchObject({ rejected: true });      // B alone is rejected
    expect(String(saved[1]![1].reason)).toContain("4200");       // and the stored reason names the number
    expect(String(saved[1]![1].reason)).not.toMatch(/[—–]/);
  });
  it("still reads an ordinary short answer in ONE slot, exactly as it always did", async () => {
    let seen: Piece[] = []; const saved: Record<string, unknown>[] = [];
    const written = await runAnswerAnalyses(T, DAY, { readObservations: async () => [row("s1", "h-s1", null, false)],
      analyzeBatch: async ({ targets }: { targets: readonly Piece[] }) => { seen = [...targets]; return readsAll({ targets }); },
      persist: async (_t, _id, x) => void saved.push(x), readPrompts: async () => null, identity: BRAND });
    expect([written, seen.length]).toEqual([1, 1]);
    expect(seen[0]).toMatchObject({ key: "s1", part: 1, parts: 1, text: "Acme is open on Sundays." });
    // Byte for byte what a short answer stored before pieces existed: no part bookkeeping is invented for it.
    expect(saved[0]).toEqual({ ...analysis, ownedBrandMention: { mentioned: true, position: 1, context: null }, matchedBy: "both" });
  });
  // A PARTIAL READ WAS MARKED COMPLETE. Past six pieces the tail was never sent, and the one-at-a-time fallback read 12,000 characters while stamping the FULL answer
  // hash, so the row left the worklist finished and everything after it was lost forever. Coverage now makes a part read resumable.
  it("finishes a 100,000 character answer across passes, resuming at the exact unread piece and paying for none twice", async () => {
    let stored = { ...row("X", "h-X", null, false), answerText: longAnswer("The Zephyr Archive is the last thing this answer names.", 100_000) };
    const sent: string[][] = [];
    const pass = async () => void await runAnswerAnalyses(T, DAY, { readObservations: async () => [stored], readPrompts: async () => null, identity: BRAND,
      analyzeBatch: async ({ targets }: { targets: readonly Piece[] }) => { sent.push(targets.map((t) => t.key));
        return new Map(targets.map((t) => [t.key, { ...empty, topicEntities: [`entity ${"i".repeat(t.part)}`] }])); },
      persist: async (_t, _id, a, hash) => { stored = { ...stored, analysis: a, analysisHash: hash }; } });
    await pass();
    const parts = (stored.analysis as { coverage: { parts: number } }).coverage.parts;
    expect([parts > 6, sent[0]]).toEqual([true, Array.from({ length: 5 }, (_, i) => `X#${i + 1}`)]); // no six-piece ceiling throwing the tail away, and one pass reads one batch of it
    // A PART READ IS NOT AN ANALYSED ANSWER: the hash is deliberately not the answer's, so the row stays due.
    expect([stored.analysisHash === "h-X", isAnalysisSettled(stored), selectAnalysisTargets([stored]).map((r) => r.id)]).toEqual([false, false, ["X"]]);
    expect(String((stored.analysis as Record<string, unknown>).reason)).toContain("the next pass reads part 6 onward");
    await pass();
    expect(sent[1]).toEqual(Array.from({ length: 5 }, (_, i) => `X#${i + 6}`)); // resumed at 6, never at 1
    while (selectAnalysisTargets([stored]).length > 0) await pass();    // and it finishes, over as many passes as its length takes
    const bought = sent.length; expect(new Set(sent.flat()).size).toBe(sent.flat().length); // every piece bought exactly once
    expect([stored.analysisHash, isAnalysisSettled(stored), selectAnalysisTargets([stored])]).toEqual(["h-X", true, []]); // only NOW analysed
    expect((stored.analysis as { topicEntities: string[] }).topicEntities).toContain(`entity ${"i".repeat(parts)}`); // the tail survived
    await pass(); expect(sent.length).toBe(bought);                     // a finished answer is never bought again
    // A CHANGED PROVIDER ANSWER RESETS THE COVERAGE against the new hash and is read from part one.
    stored = { ...stored, answerText: "The engine says something entirely different today.", answerHash: "h-X2" };
    expect(selectAnalysisTargets([stored]).map((r) => r.id)).toEqual(["X"]);
    await pass();
    expect([sent[bought], stored.analysisHash, isAnalysisSettled(stored)]).toEqual([["X"], "h-X2", true]);
  });
  it("degrades a broken batch to ONE CALL PER PIECE, each grounded in its own piece, and still finishes the answer", async () => {
    const grounded: string[] = [], saved: Array<[Record<string, unknown>, string]> = [];
    const written = await runAnswerAnalyses(T, DAY, { readPrompts: async () => null, identity: BRAND,
      readObservations: async () => [{ ...row("F", "h-F", null, false), answerText: longAnswer("The Zephyr Archive is the last thing this answer names.") }],
      analyzeBatch: async () => null,                                   // the whole batch came back unusable
      analyze: async ({ answerText }) => { grounded.push(answerText); return { ...empty, topicEntities: [`piece ${grounded.length}`] }; },
      persist: async (_t, _id, a, hash) => void saved.push([a, hash]) });
    expect([written, grounded.length]).toEqual([1, 3]);                 // one call per PIECE, never one 12,000 character call
    expect([grounded.every((g) => g.length <= 5_000), grounded[2]!.includes("Zephyr Archive")]).toEqual([true, true]); // the tail reached a call
    expect(saved[0]![1]).toBe("h-F");                                   // every piece merged, so now it is analysed
    expect(saved[0]![0]).toMatchObject({ readParts: 3, topicEntities: ["piece 1", "piece 2", "piece 3"] });
  });
  it("reports the reporting day as the operator's own day, not the UTC one", () => {
    // 2 AM UTC on the 5th is still the evening of the 4th where the operator is: a UTC day started early.
    expect(reportingDay(Date.parse("2026-08-05T02:00:00.000Z"))).toBe("2026-08-04");
    expect(reportingDay(Date.parse("2026-08-05T07:00:00.000Z"))).toBe("2026-08-05");
    // And the zone carries its own daylight-saving rule: in January the same instant is an hour further back.
    expect(reportingDay(Date.parse("2026-01-05T07:00:00.000Z"))).toBe("2026-01-04");
    expect(reportingDay(Date.parse("2026-01-05T08:00:00.000Z"))).toBe("2026-01-05");
    // An instant it cannot read still answers in Pacific. The fallback used to slice a UTC string, so the
    // one module that exists to end UTC days named tomorrow every evening after 5 PM.
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-05T02:00:00.000Z"));
    expect([reportingDay(NaN), reportingDay(new Date("not a date"))]).toEqual(["2026-08-04", "2026-08-04"]);
    vi.useRealTimers();
  });
});
it("never plans more perplexity than one pass can drain, and fills the freed slots with finishable work", () => {
  const prompts = Array.from({ length: 35 }, (_, i) => q(`px${String(i).padStart(2, "0")}`, "2026-01-01")); // 35 x 4 = 140 candidates, batch 20
  const plan = planObservations(DAY, { prompts, observed: [] });
  const perp = plan.filter((d) => d.engine === "perplexity").length;
  expect([plan.length, perp]).toEqual([20, 3]); }); // the old plan carried 5+, the pass drained 3, and the skipped rows re-sorted to the head forever

/** WHEN A PAIR'S DAY IS OVER. A row that only ever said "failed" read as owed on every look, so an engine that
 *  could not answer one question was re-bought on every pass of every day, forever. */
describe("work that is genuinely finished", () => {
  const ONE = [PROMPTS[0]!], REASON = "The provider refused this request.";
  const engines: DueObservation["engine"][] = ["chatgpt"];
  const plan = (observed: AiObservationView[], retries: Record<string, number> = {}) =>
    planObservations(DAY, { prompts: ONE, observed, engines, retries, maxBatch: 99 });
  it("treats an answer, an unavailable engine and an engine it cannot ask as finished for today, and a broken one as worth asking again", () => {
    expect(plan([seen({ promptId: "p1", engine: "chatgpt" })])).toEqual([]);                             // observed
    expect(plan([seen({ promptId: "p1", engine: "chatgpt", status: "unavailable" })])).toEqual([]);      // nothing readable to give
    expect(plan([seen({ promptId: "p1", engine: "chatgpt", status: "unsupported" })])).toEqual([]);      // cannot be asked at all
    expect(plan([seen({ promptId: "p1", engine: "chatgpt", status: "pending" })])).toHaveLength(1);      // in flight: the next pass collects it free
    expect(plan([seen({ promptId: "p1", engine: "chatgpt", status: "failed" })])).toHaveLength(1);       // broken IS worth asking again
    // But only while the day's retry budget lasts. Spent, it is finished for the day like any other outcome.
    expect(plan([seen({ promptId: "p1", engine: "chatgpt", status: "failed" })], { "p1|1|chatgpt|0": FAILED_RETRIES_PER_DAY })).toEqual([]);
  });
  it("derives the engines it plans from the provider registry itself, with nobody handing it a list", async () => {
    // The engine-to-capability map is checked by the compiler and nothing more: a `satisfies` proves the mapping is well typed and proves nothing about whether the
    // planner ever consults it. Turning ONE capability off in the registry is the only way to show the derivation actually reaches a plan.
    const world = { readPrompts: async () => ONE, readObservations: async () => [], readMarkers: async () => null, maxBatch: 99 };
    expect(new Set((await dueObservations(T, DAY, world))!.map((d) => d.engine))).toEqual(new Set(ENGINES));
    registry.off.add("llm_gemini");
    try {
      expect(new Set((await dueObservations(T, DAY, world))!.map((d) => d.engine))).toEqual(new Set(["chatgpt", "claude", "perplexity"]));
    } finally { registry.off.clear(); }
    // And the day it comes back it is planned again, with no stored flag to undo.
    expect(new Set((await dueObservations(T, DAY, world))!.map((d) => d.engine))).toEqual(new Set(ENGINES));
  });
  it("never plans an engine the registry cannot ask, on any day, and does not resurrect it from a stored row", () => {
    const yesterday = [seen({ promptId: "p1", engine: "perplexity", status: "unsupported", day: "2026-07-30" })];
    // The engine set is derived from the capability registry, so an engine that cannot be asked is simply absent from every plan. Nothing stores an "impossible forever"
    // flag, so the day the capability comes back the pair is planned again with no cleanup pass and no stale marker to undo.
    const askable = planObservations(DAY, { prompts: ONE, observed: yesterday, engines: ["chatgpt"], maxBatch: 99 });
    expect(askable.some((d) => d.engine === "perplexity")).toBe(false);
    const restored = planObservations(DAY, { prompts: ONE, observed: yesterday, engines: ["chatgpt", "perplexity"], maxBatch: 99 });
    expect(restored.some((d) => d.engine === "perplexity")).toBe(true);
  });
  it("retries a broken pair the bounded number of times in one day, then settles the row as unavailable with the provider's own reason kept", async () => {
    const store = [seen({ promptId: "p1", engine: "chatgpt", status: "failed", failureReason: REASON, requestedAt: `${DAY}T08:00:00.000Z` })];
    let markers: DayMarkers | null = null, asks = 0;
    const settled: Array<[string, string]> = [];
    const world = {
      readPrompts: async () => ONE, readObservations: async () => store, engines, maxBatch: 99,
      readMarkers: async () => markers,
      writeMarkers: async (_t: string, p: DayMarkers) => { markers = { ...markers, ...p }; return true; },
      // The real write only moves `status`, so this models it exactly: the reason stays where the provider put it.
      settle: async (_t: string, id: string, status: "unavailable" | "unsupported") => {
        settled.push([id, status]); const r = store.find((x) => x.id === id)!; r.status = "unavailable"; },
    };
    const pass = async () => (await dueObservations(T, DAY, world))!.length;
    /** What the executor does with a plan it actually drains: it asks, the provider breaks again, and the
     *  row is rewritten on its own identity with a FRESH ask stamp. That stamp is the proof of the ask. */
    const executorAsks = () => { asks += 1; store[0]!.requestedAt = `${DAY}T09:0${asks}:00.000Z`; };
    expect(await pass()).toBe(1);                                    // retry one is planned
    expect(markers!.observationRetries!.counts).toEqual({ "p1|1|chatgpt|0": 0 }); // and nothing is spent yet
    // A PLAN THE PASS NEVER REACHED SPENDS NOTHING. The batch cap, the pass deadline or a provider that
    // stopped the batch all leave a planned pair unasked, and it used to burn a retry all the same.
    expect(await pass()).toBe(1);
    expect(markers!.observationRetries!.counts).toEqual({ "p1|1|chatgpt|0": 0 });
    executorAsks();
    expect(await pass()).toBe(1);                                    // retry two, after retry one really happened
    expect(markers!.observationRetries!.counts).toEqual({ "p1|1|chatgpt|0": 1 });
    executorAsks();
    expect(await pass()).toBe(0);                                    // and that is the whole budget
    expect(settled).toEqual([[store[0]!.id, "unavailable"]]);
    expect([store[0]!.status, store[0]!.failureReason]).toEqual(["unavailable", REASON]); // still explains itself
    // Settled once, and never again: the row is no longer failed, so nothing re-asks and nothing re-writes.
    expect(await pass()).toBe(0);
    expect(settled).toHaveLength(1);
    // Yesterday's retry ledger never spends today's budget: a new day starts the count fresh.
    store[0]!.status = "failed";
    markers = { observationRetries: { day: "2026-07-30", counts: { "p1|1|chatgpt|0": 9 } } };
    expect(await pass()).toBe(1);
  });
  it("settles a failed row on an engine the registry cannot ask as UNSUPPORTED, and never plans that engine again while that holds", async () => {
    // The engine set handed to the planner IS what the provider registry can ask today. A pair that broke on an engine outside it is not "the engine had nothing to
    // give": I cannot ask it at all, and saying so is the difference between a gap I am working on and one I am not.
    const store = [seen({ promptId: "p1", engine: "perplexity", status: "failed", failureReason: REASON })];
    const settled: Array<[string, string]> = [];
    const world = {
      readPrompts: async () => ONE, readObservations: async () => store, engines, maxBatch: 99,
      readMarkers: async () => ({ observationRetries: { day: DAY, counts: { "p1|1|perplexity|0": FAILED_RETRIES_PER_DAY }, askedAt: { "p1|1|perplexity|0": store[0]!.requestedAt } } }),
      writeMarkers: async () => true,
      settle: async (_t: string, id: string, status: "unavailable" | "unsupported") => {
        settled.push([id, status]); store.find((x) => x.id === id)!.status = status; },
    };
    const due = (await dueObservations(T, DAY, world))!;
    expect(settled).toEqual([[store[0]!.id, "unsupported"]]);
    expect(due.some((d) => d.engine === "perplexity")).toBe(false);
    // AND THE DAY CAN SAY SO. The count reads a settled row off its OWN stored status: derived from today's
    // engine list, "I cannot ask" was a state it could never reach, so a lost engine read as pure silence.
    expect(await dailyChecks(T, DAY, world)).toMatchObject({ done: 1, total: 2, answers: 0, unavailable: 0, unsupported: 1 });
    // Tomorrow is no different while the registry still cannot reach it, and no stored flag has to be undone.
    expect((await dueObservations(T, "2026-08-01", { ...world, readObservations: async () => [] }))!
      .some((d) => d.engine === "perplexity")).toBe(false);
  });
  // A SETTLE THAT THREW IS NOT A SETTLE. The exhausted-retry marker used to land regardless, so the row said
  // `failed` with no budget left to ask again: permanently owed and contradicted by the ledger beside it.
  it("leaves a pair whose settle threw exactly where it was, says so out loud, and closes it on the next pass", async () => {
    const K = "p1|1|chatgpt|0", OLD = `${DAY}T08:00:00.000Z`;
    const store = [seen({ promptId: "p1", engine: "chatgpt", status: "failed", failureReason: REASON, requestedAt: `${DAY}T09:00:00.000Z` })];
    let markers: DayMarkers | null = { observationRetries: { day: DAY, counts: { [K]: FAILED_RETRIES_PER_DAY - 1 }, askedAt: { [K]: OLD } } };
    const settled: string[] = [];
    const world = {
      readPrompts: async () => ONE, readObservations: async () => store, engines, maxBatch: 99,
      readMarkers: async () => markers,
      writeMarkers: async (_t: string, p: DayMarkers) => { markers = { ...markers, ...p }; return true; },
      settle: async () => { throw new Error("the observation store refused that write"); },
    };
    said.errors.length = 0;
    await dueObservations(T, DAY, world);
    expect(markers!.observationRetries)
      .toEqual({ day: DAY, counts: { [K]: FAILED_RETRIES_PER_DAY - 1 }, askedAt: { [K]: OLD } }); // not one retry spent
    expect(store[0]!.status).toBe("failed"); // nothing settled, so the row still says the true thing
    expect(said.errors.some((m) => m.includes("could not close out a check"))).toBe(true);
    // Still owed, and the next pass closes it: the throw cost the pair nothing at all.
    await dueObservations(T, DAY, { ...world,
      settle: async (_t: string, id: string, status: "unavailable" | "unsupported") => {
        settled.push(status); store.find((x) => x.id === id)!.status = status; } });
    expect([settled, store[0]!.status]).toEqual([["unavailable"], "unavailable"]);
  });
  it("asks the observation store for the DAY it is planning, so a 600 row day is read whole", async () => {
    // An unnamed read defaults to the newest 500 rows. A tracked set of 35 questions on 4 engines writes more than that in a day (retries and settles included), so the
    // planner was deciding what was still owed off a truncated day and re-buying readings it could not see.
    const asked: Array<{ day?: string }> = [];
    const big = Array.from({ length: 600 }, (_, i) => seen({ promptId: `p${i}`, engine: "chatgpt", id: `obs-${i}` }));
    const plan = await dueObservations(T, DAY, {
      readPrompts: async () => ONE, engines, maxBatch: 99, readMarkers: async () => null,
      readObservations: async (_t, o) => { asked.push(o); return big.length === 600 ? big : []; },
    });
    expect(asked).toEqual([{ day: DAY }]);   // the day is NAMED, which is what flips the reader to read-it-all
    expect(plan).toEqual([]);                 // and p1's own reading is in that day, so nothing is re-bought
  });
  it("does not plan an unavailable pair again the same day, and does plan it the next day", async () => {
    const gone = seen({ promptId: "p1", engine: "chatgpt", status: "unavailable", failureReason: REASON });
    const world = { readPrompts: async () => ONE, readObservations: async () => [gone], engines, maxBatch: 99, readMarkers: async () => null };
    expect(await dueObservations(T, DAY, world)).toEqual([]);
    const tomorrow = await dueObservations(T, "2026-08-01", world);
    expect(tomorrow).toHaveLength(1);
    expect(tomorrow![0]).toMatchObject({ promptId: "p1", engine: "chatgpt", slot: 0, day: "2026-08-01" });
  });
  it("reads a row already stored under the day it computes as that pair being done, and leaves every other day alone", async () => {
    // THE CUTOVER. Pacific runs behind UTC, so the operator's day can be a day that already holds rows taken under the old UTC label. Those rows are history: they mean
    // the work is done, nothing is re-asked, and nothing is rewritten. A day that was genuinely missed stays missed rather than being filled in late.
    const day = reportingDay(Date.parse("2026-08-05T02:00:00.000Z"));
    expect(day).toBe("2026-08-04");
    // A BROKEN ROW WITH ITS BUDGET SPENT, so the settle path this pass owns actually RUNS. Without one the
    // ledger returns at its first line and "a pass rewrote nothing" could never have failed.
    const spent = seen({ promptId: "p2", engine: "chatgpt", day: "2026-08-04", status: "failed", failureReason: "The provider refused this request." });
    const history = [seen({ promptId: "p1", engine: "chatgpt", day: "2026-08-04" }), seen({ promptId: "p1", engine: "chatgpt", day: "2026-08-02" }), spent];
    const before = JSON.stringify(history);
    const settled: Array<[string, string]> = [];
    const world = { readPrompts: async () => [PROMPTS[0]!, PROMPTS[1]!], readObservations: async () => history, engines, maxBatch: 99,
      readMarkers: async () => ({ observationRetries: { day, counts: { [key({ ...spent, promptId: "p2" })]: FAILED_RETRIES_PER_DAY }, askedAt: { [key({ ...spent, promptId: "p2" })]: spent.requestedAt } } }),
      writeMarkers: async () => true,
      settle: async (_t: string, id: string, status: "unavailable" | "unsupported") => { settled.push([id, status]); } };
    expect(await dueObservations(T, day, world)).toEqual([]);                   // both pairs are finished for the day
    expect(settled).toEqual([[spent.id, "unavailable"]]);                       // and the row that ran out of retries was settled
    expect(JSON.stringify(history)).toBe(before);                              // a pass rewrote nothing it read
    expect(await dueObservations(T, "2026-08-03", world)).toHaveLength(2);      // and a missed day is not backfilled: it is simply the day I am asked about
  });
});

/** WHO the answer was read for. Beacon used to ask the model "was this brand mentioned" with an EMPTY brand, so every reading came back "not mentioned" and the AI trend
 * was computed from that. These go through the real production wiring (no injected identity): the Account kernel derives the name from the confirmed profile and the
 * account's own website, and a deterministic second read of the same answer catches what the model missed. */
describe("every written form that still means this business", () => {
  it("says nothing at all about an account that has neither a name nor a website", () => {
    // No forms is the caller's signal to stop: asking a model "was this brand mentioned" with an empty
    // brand comes back "no" every time, and a whole AI trend was computed off that answer.
    expect(identityFrom("", "")).toEqual({ name: "", forms: [], host: "" });
    expect(identityFrom("  ", "   ")).toEqual({ name: "", forms: [], host: "" });
  });
  it("reads a company suffix as the same business, and offers the longest form first", () => {
    // A reader who sees "Ritz Builders" has seen "Ritz Builders, Inc.", and the longest form is tried first so the whole name wins over a fragment of it.
    expect(identityFrom("Ritz Builders, Inc.", "https://www.ritz-builders.com/")).toEqual({
      name: "Ritz Builders, Inc.", host: "ritz-builders.com",
      forms: ["ritz builders, inc.", "ritz-builders.com", "ritz builders"],
    });
  });
  it("keeps a bare domain label only when it could not be an ordinary English word", () => {
    // The mention verdict ORs every form together, so a generic label on its own turns "a guide to Nowruz"
    // into a mention of guide.com. The whole address always counts; the label has to earn its place.
    expect(identityFrom("", "https://guide.com").forms).toEqual(["guide.com"]);          // an everyday word
    expect(identityFrom("", "https://ritz.com").forms).toEqual(["ritz.com"]);            // too short to stand alone
    expect(identityFrom("", "https://iranopedia.com").forms).toEqual(["iranopedia.com", "iranopedia"]);
    // A confirmed name's OWN word is kept even when it is generic, because the account really is called that.
    expect(identityFrom("Guide", "https://guide.com").forms).toEqual(["guide.com", "guide"]);
    // And a label that is not one of the confirmed name's words is never invented into a form.
    expect(identityFrom("Ritz Builders", "https://ritz-builders.com").forms).toEqual(["ritz-builders.com", "ritz builders"]);
  });
});

describe("who the answer was read for", () => {
  const ACCOUNT = { id: T, slug: "acct-a", provisional_name: "whatever a stranger typed at signup", domain: "", status: "active" as const,
    signup_date: "", tos_accepted_at: null, daily_budget_usd: 5, growth_goal: null, created_at: "", updated_at: "" };
  const onFile = (name: string, domain: string) => {
    __resetBusinessProfileCacheForTests();
    setAccountRepositoryForTests({ getAccountById: async () => ({ ...ACCOUNT, domain }), getAccountBySlug: async () => null });
    seedBusinessProfileForTests(T, { name: { value: name, origin: "operator_confirmed", confidence: null, sourceUrls: [] } });
  };
  const answer = (id: string, answerText: string, citationUrls: string[] | null = null): AiObservationView => ({
    id, promptId: "p1", version: 1, engine: "chatgpt", slot: 0, day: DAY, status: "observed", observedAt: null,
    requestedAt: `${DAY}T08:00:00.000Z`, failureReason: null,
    promptText: "who should I read about Iran with", answerText, answerHash: `h-${id}`, citationUrls, analysis: null, analysisHash: null });
  const READING = { sections: [], claims: [], topicEntities: [], ownedBrandMention: { mentioned: false, position: null, context: null },
    competitors: [], contentTypesRecommended: [], questionsAnswered: [], materialOmissions: [], caveats: [] } as unknown as AnswerAnalysis;
  /** One pass, one answer, through the REAL batch path unless a reading is handed over. */
  const readBack = async (row: AiObservationView, over: Record<string, unknown> = {}) => {
    const saved: Record<string, unknown>[] = [];
    const written = await runAnswerAnalyses(T, DAY, {
      readObservations: async () => [row], persist: async (_t, _id, a) => void saved.push(a), readPrompts: async () => null, ...over });
    return { written, saved };
  };
  beforeEach(() => { setAccountRepositoryForTests(null); __resetBusinessProfileCacheForTests(); });
  it("sends the account's REAL name into the BATCH call, taken from the confirmed profile and its own website, with one entry per answer", async () => {
    onFile("Iranopedia", "https://www.iranopedia.com/");
    const asked: string[] = [];
    // The real batch prompt, through the real gateway wiring, with only the transport injected.
    const complete: CompleteFn = async ({ user }) => {
      asked.push(user);
      const ids = [...user.matchAll(/OBSERVATION (\S+)/g)].map((m) => m[1]);
      return { value: { analyses: ids.map((observationId) => ({ ...READING, observationId, ownedBrandMention: { mentioned: true, position: 1, context: null } })) } };
    };
    const { written, saved } = await readBack(answer("a", "Iranopedia is the one I would start with."), { complete });
    expect([written, asked.length]).toEqual([1, 1]);
    expect(asked[0]).toContain("BRAND TO LOOK FOR: Iranopedia");
    expect(asked[0]).not.toContain("(none supplied)"); // the defect: an empty brand reached the model on every call
    expect(asked[0]).toContain("OBSERVATION a");       // each answer is keyed by the observation it was taken on
    expect(saved[0]).toMatchObject({ ownedBrandMention: { mentioned: true }, matchedBy: "both" });
  });
  it("keeps a mention the model missed, from the answer's own words or an address it credited, and says which found it", async () => {
    onFile("Iranopedia", "https://www.iranopedia.com/");
    // The model read this answer IN A BATCH and said "not mentioned": the deterministic second read still runs
    // per observation, and the merged verdict is still what lands on that observation's own row.
    const missed = { analyzeBatch: async ({ targets }: { targets: readonly { row: { id: string } }[] }) => new Map(targets.map((t) => [t.row.id, READING])) };
    const byText = await readBack(answer("t", "Iranopedia covers the festivals in depth."), missed);
    expect(byText.saved[0]).toMatchObject({ ownedBrandMention: { mentioned: true }, matchedBy: "text" });
    const byCitation = await readBack(answer("c", "A few travel guides cover it.", ["https://www.iranopedia.com/festivals"]), missed);
    expect(byCitation.saved[0]).toMatchObject({ ownedBrandMention: { mentioned: true }, matchedBy: "citation" });
    const neither = await readBack(answer("n", "Ask a local travel agent.", ["https://example.com/x"]), missed);
    expect(neither.saved[0]).toMatchObject({ ownedBrandMention: { mentioned: false }, matchedBy: null }); // a real absence, not a model miss
  });
  it("never reads a bare domain label as the business name when the label is an ordinary English word", async () => {
    // The mention verdict ORs every written form together, so the label on its own ("guide", "best") matched
    // any sentence using that word and every such account read as mentioned in answers about nobody.
    const missed = { analyzeBatch: async ({ targets }: { targets: readonly { row: { id: string } }[] }) => new Map(targets.map((t) => [t.row.id, READING])) };
    onFile("", "https://guide.com");
    const generic = await readBack(answer("g", "Here is a guide to the festivals."), missed);
    expect(generic.saved[0]).toMatchObject({ ownedBrandMention: { mentioned: false }, matchedBy: null });
    // The whole address always still counts, and so does a label that IS the confirmed name's own word.
    const host = await readBack(answer("h", "It is all on guide.com."), missed);
    expect(host.saved[0]).toMatchObject({ ownedBrandMention: { mentioned: true }, matchedBy: "text" });
    onFile("Iranopedia", "https://www.iranopedia.com/");
    const own = await readBack(answer("o", "Iranopedia covers the festivals in depth."), missed);
    expect(own.saved[0]).toMatchObject({ ownedBrandMention: { mentioned: true }, matchedBy: "text" });
  });
  it("never invents a mention out of a longer word, and reads nothing back at all when it cannot name the account", async () => {
    onFile("Ritz", "https://ritz-builders.com");
    const { saved } = await readBack(answer("w", "Ritzy Hotels are lovely this time of year."),
      { analyzeBatch: async ({ targets }: { targets: readonly { row: { id: string } }[] }) => new Map(targets.map((t) => [t.row.id, READING])) });
    expect(saved[0]).toMatchObject({ ownedBrandMention: { mentioned: false }, matchedBy: null });
    // No confirmed name and no website: I stop rather than pay to ask the model about nobody.
    onFile("", "");
    let calls = 0;
    const silent = await readBack(answer("z", "Anything at all."), { analyzeBatch: async () => { calls += 1; return null; } });
    expect([silent.written, silent.saved.length, calls]).toEqual([0, 0, 0]);
  });
});
