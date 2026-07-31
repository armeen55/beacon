/**
 * PRODUCT - FULL-FIDELITY AI OBSERVATION CAPTURE. Three tracked questions across four engines are driven
 * through the REAL prompt-observation unit, the REAL registry parsers over the REAL provider envelope
 * fixtures, and the REAL fail-closed writer, with only Postgres itself faked. Pins the canonical identity,
 * slot semantics, the whole answer and the whole journey, honest statuses, tenant isolation, and the
 * prompt_answer_observations row as a DERIVED projection. Zero network, zero provider spend.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const db = vi.hoisted(() => ({ written: [] as { table: string; row: Record<string, unknown> }[], read: [] as Record<string, unknown>[], updated: null as Record<string, unknown> | null, matched: [] as { id: string }[], error: null as { message: string } | null, filters: {} as Record<string, unknown> }));
/** The ONE fake: Postgres. Every writer, every guard and every projection above it is the real one. */
vi.mock("@/lib/persistence/supabase", async (orig) => ({ ...((await orig()) as object), getSupabaseAdmin: () => ({ from: (table: string) => fakeTable(table) }) }));
function fakeTable(table: string) {
  const q: Record<string, unknown> = {
    select: () => q, eq: (c: string, v: unknown) => { db.filters[c] = v; return q; }, order: () => q, limit: () => q,
    update: (patch: Record<string, unknown>) => { db.updated = patch; return q; },
    upsert: (chunk: Record<string, unknown>[]) => { for (const row of chunk) db.written.push({ table, row }); return { select: async () => ({ data: chunk.map((r) => ({ id: r.id })), error: db.error }) }; },
    then: (res: (v: { data: unknown; error: unknown }) => void) => res({ data: db.updated ? db.matched : db.read, error: db.error }),
  };
  return q;
}
import type { Account } from "@/domains/account";
import { aiObservationId, persistAnswerAnalysis, readAiObservationViews, recordAiObservation, type AiObservationRecord, type DueObservation } from "@/domains/evidence/ai-visibility/ai-observations";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
import type { CachedCallResult, CapabilityKey } from "@/domains/evidence/dataforseo/funnel-boundary";
import { promptObservationUnit } from "@/domains/evidence/funnel/observe";
import type { FunnelDeps } from "@/domains/evidence/funnel/shared";
import * as fx from "../fixtures/replay";

const { BASIS, SITE, TENANT } = fx;
const OTHER = "rival-tenant";
const NOW = Date.parse("2026-07-21T09:00:00.000Z"), DAY = "2026-07-21";
const QUESTIONS = [{ id: "q1", text: "where can I see a kite festival" }, { id: "q2", text: "what do people eat at a kite festival" }, { id: "q3", text: "when do kite festivals start" }];
const ENGINES = ["chatgpt", "claude", "gemini", "perplexity"] as const;
/** The planner's output: every tracked question on every engine, at one deliberate sample slot, all on the
 *  reporting day the PLAN names (never a clock, so a run resumed past midnight still lands on one day). */
const duePlan = (slot: 0 | 1 | 2 = 0, version = 1, day = DAY): DueObservation[] =>
  QUESTIONS.flatMap((p) => ENGINES.map((engine) => ({ promptId: p.id, version, text: p.text, engine, slot, day })));

/** A provider that charges ONCE per cache identity and hands back the same envelope for free after that.
 *  The identity is THE WHOLE ASK, exactly as the registry keys it, so what the executor actually hands the
 *  boundary decides whether a reading is a new question or a free replay. */
function provider(fail: CachedCallResult | null = null) {
  const bought = new Set<string>(); let paid = 0;
  const call: NonNullable<FunnelDeps["callProvider"]> = async (cap: CapabilityKey, input) => {
    const ask = input as { user_prompt?: string; keyword?: string };
    const text = ask.user_prompt ?? ask.keyword ?? "", cacheKey = `ck|${cap}|${JSON.stringify(input)}`;
    if (fail) return fail;
    const envelope = cap === "llm_scraper_chatgpt" ? fx.scraperAnswer({ keyword: text }) : fx.llmAnswer({ model: `${cap}-served` });
    if (bought.has(cacheKey)) return { state: "hit", envelope, costUsd: 0, cacheKey, modelServed: null };
    bought.add(cacheKey); paid += 1;
    return { state: "ok", envelope, costUsd: 0.02, cacheKey, modelServed: null };
  };
  return { call, paid: () => paid };
}

function world(over: Partial<FunnelDeps> = {}, fail: CachedCallResult | null = null) {
  const store = fx.memFunnelStore(), p = provider(fail);
  const deps: FunnelDeps = { ...store.deps, callProvider: p.call, now: () => NOW, getAccount: async () => ({ domain: SITE } as Account), ...over };
  return { deps, paid: p.paid, store };
}
const rowsFor = (table: string) => db.written.filter((w) => w.table === table).map((w) => w.row);
const observations = () => rowsFor("ai_observations") as unknown as AiObservationRecord[];
const history = () => rowsFor("prompt_answer_observations") as unknown as PromptAnswerObservation[];
const run = (deps: FunnelDeps, due: DueObservation[] | null, tenantId = TENANT) => promptObservationUnit(deps, due)(tenantId, { basis: BASIS, runId: "run-1" }, 60_000);

beforeEach(() => { db.written = []; db.read = []; db.updated = null; db.matched = []; db.error = null; db.filters = {}; });

describe("one canonical identity per observation", () => {
  it("stores exactly the pairs that came due, each on the identity a retry can only ever reuse", async () => {
    const w = world();
    await run(w.deps, duePlan());
    const rows = observations().filter((r) => r.status === "observed");
    expect(rows.length).toBe(12); // 3 questions x 4 engines, nothing implied and nothing dropped
    expect(new Set(rows.map((r) => r.id)).size).toBe(12);
    for (const r of rows) expect(r.id).toBe(aiObservationId({ tenantId: TENANT, promptId: r.prompt_id, promptVersion: 1, engine: r.engine, day: DAY, slot: 0 }));
    expect(new Set(rows.map((r) => `${r.reporting_day}|${r.sample_slot}|${r.language}|${r.location}`))).toEqual(new Set([`${DAY}|0|en|2840`]));
    expect(rows.every((r) => r.site === SITE && r.prompt_text.length > 0 && r.completed_at === new Date(NOW).toISOString())).toBe(true);
  });
  it("reuses the SAME row when a failed check is retried, and never buys the same day twice", async () => {
    const broken = world({}, { state: "error", cacheKey: null, disposition: "none", detail: "the provider could not finish it" });
    await run(broken.deps, duePlan());
    const failed = observations();
    expect([failed.length, new Set(failed.map((r) => r.status)).size, failed[0]!.failure_reason]).toEqual([12, 1, "the provider could not finish it"]);
    expect(failed.every((r) => r.status === "failed" && r.cost_usd === 0)).toBe(true); // a refusal is named, not hidden, and nothing was charged for it
    db.written = [];
    const healthy = world({ loadState: broken.store.deps.loadState, saveState: broken.store.deps.saveState });
    await run(healthy.deps, duePlan());
    const landed = observations().filter((r) => r.status === "observed");
    expect(landed.map((r) => r.id).sort()).toEqual(failed.map((r) => r.id).sort()); // the retry overwrote ITSELF; it did not mint a second history
    db.written = [];
    await run(healthy.deps, duePlan()); // the SAME day, planned again: I ask, and the day's identity makes it free
    expect([healthy.paid(), observations().filter((r) => r.status === "observed").length]).toEqual([12, 12]);
    expect(observations().map((r) => r.id).sort()).toEqual(failed.map((r) => r.id).sort()); // still ONE row per identity: a same-day retry overwrites itself
  });
  it("asks day two's plan IN FULL: a reading that landed yesterday can never satisfy today", async () => {
    const DAY2 = "2026-07-22";
    const w = world();
    await run(w.deps, duePlan());
    const first = observations().filter((r) => r.status === "observed");
    expect([first.length, w.paid()]).toEqual([12, 12]);
    db.written = [];
    await run(w.deps, duePlan(0, 1, DAY2));
    const second = observations().filter((r) => r.status === "observed");
    expect([second.length, w.paid()]).toEqual([12, 24]); // TWELVE MORE readings and twelve more paid asks, never a silent zero
    expect(second.every((r) => r.reporting_day === DAY2)).toBe(true);
    expect(first.some((r) => second.some((s) => s.id === r.id))).toBe(false); // a new day is a new identity, so nothing is overwritten
  });
  it("stores the day the PLAN named, so a run resumed past midnight lands where the analysis pass looks", async () => {
    const pastMidnight = Date.parse("2026-07-22T00:30:00.000Z");
    await run(world({ now: () => pastMidnight }).deps, duePlan()); // the plan still says the 21st
    const rows = observations().filter((r) => r.status === "observed");
    expect(rows.length).toBe(12);
    expect(new Set(rows.map((r) => r.reporting_day))).toEqual(new Set([DAY])); // ONE reporting day, whatever the clock said
    expect(rows.every((r) => r.requested_at === new Date(pastMidnight).toISOString())).toBe(true); // when it happened is still recorded honestly
    for (const r of rows) expect(r.id).toBe(aiObservationId({ tenantId: TENANT, promptId: r.prompt_id, promptVersion: 1, engine: r.engine, day: DAY, slot: 0 }));
  });
  it("does nothing at all when the planner could not read what is due, and never falls back on asking everything", async () => {
    const blind = world();
    const out = await run(blind.deps, null);
    expect([out.status, blind.paid(), db.written.length]).toEqual(["failed", 0, 0]);
    expect(out.detail).toContain("I could not read which of your questions are due");
    const settled = world();
    const nothing = await run(settled.deps, []); // nothing owed is a finished day, not a reason to re-ask
    expect([nothing.status, settled.paid(), db.written.length]).toEqual(["done", 0, 0]);
  });
  it("treats a second deliberate reading of the same pair as a NEW observation, never an overwrite", async () => {
    const w = world();
    await run(w.deps, duePlan(0));
    const first = observations().map((r) => r.id);
    db.written = [];
    await run(w.deps, duePlan(1));
    const second = observations();
    expect(second.length).toBe(12);
    expect(second.every((r) => r.sample_slot === 1 && r.reporting_day === DAY)).toBe(true);
    expect(first.some((id) => second.some((r) => r.id === id))).toBe(false); // same question, same engine, same day, DIFFERENT reading
    expect(w.paid()).toBe(24); // and a DIFFERENT question to the provider: a second sample that replayed the first for $0 would not be a second opinion
  });
});

describe("the answer is kept whole", () => {
  it("keeps the full text and the whole journey, with retrieved pages held apart from cited sources", async () => {
    await run(world().deps, duePlan());
    const rows = observations();
    const consumer = rows.find((r) => r.engine === "chatgpt")!;
    expect([consumer.observation_mode, consumer.capability_version, consumer.model_served]).toEqual(["consumer_search", "llm_scraper_chatgpt@v3", "gpt-4o-search"]);
    expect(consumer.answer_text).toContain("Families fly kites at dawn"); // the answer itself, not a hash of it
    expect([consumer.answer_hash!.length, consumer.answer_text!.length > 100]).toEqual([16, true]);
    expect(consumer.journey.cited_sources!.map((c) => c.domain)).toEqual(["rival-a.example", SITE]);
    expect(consumer.journey.retrieved_results!.map((r) => r.domain)).toEqual(fx.RETRIEVED_ONLY.map((r) => r.domain));
    for (const r of fx.RETRIEVED_ONLY) expect(JSON.stringify(consumer.journey.cited_sources)).not.toContain(r.domain); // read is not credited
    expect([consumer.journey.brand_mentions, consumer.journey.web_search_reported, consumer.journey.fan_outs]).toEqual([["Atlaspedia", "Rival A"], true, ["what happens at a kite festival", "kite festival food traditions"]]);
    const standardized = rows.find((r) => r.engine === "gemini")!;
    expect([standardized.observation_mode, standardized.journey.retrieved_results, standardized.journey.brand_mentions]).toEqual(["standardized_response", null, null]); // llm_responses reports neither: null is not an observed empty
    expect([standardized.journey.web_search_reported, standardized.journey.cited_sources!.length]).toEqual([true, 1]);
    expect(rows.every((r) => r.cache_key!.startsWith("ck|") && r.cost_usd === 0.02)).toBe(true); // the envelope it was read from, and what it cost
  });
  it("names an engine it cannot ask as unsupported, and spends nothing finding out", async () => {
    const w = world();
    const out = await run(w.deps, [...duePlan(), { promptId: "q1", version: 1, text: QUESTIONS[0]!.text, engine: "grok" as DueObservation["engine"], slot: 0, day: DAY }]);
    const unsupported = observations().filter((r) => r.status === "unsupported");
    expect([unsupported.length, unsupported[0]!.engine, unsupported[0]!.cost_usd, unsupported[0]!.cache_key]).toEqual([1, "grok", 0, null]);
    expect(unsupported[0]!.failure_reason).toBe("I cannot ask grok for you yet, so I spent nothing on it.");
    expect([w.paid(), out.status]).toEqual([12, "done"]); // the gap is named and the twelve engines I can reach still finish
  });
});

describe("tenant isolation and the derived history row", () => {
  it("never lets one account's answers carry another account's identity", async () => {
    await run(world().deps, duePlan(), TENANT);
    const mine = observations();
    db.written = [];
    await run(world({ getAccount: async () => ({ domain: "rival.example" } as Account) }).deps, duePlan(), OTHER);
    const theirs = observations();
    expect(theirs.every((r) => r.tenant_id === OTHER && r.site === "rival.example")).toBe(true);
    expect(mine.some((r) => theirs.some((t) => t.id === r.id))).toBe(false); // the same question on the same day is a DIFFERENT observation per account
    await expect(recordAiObservation({ ...mine[0]! }, OTHER)).rejects.toThrow(/tenant mismatch/); // and the writer refuses to be told otherwise
  });
  it("derives the history row from the stored observation instead of composing a second truth", async () => {
    await run(world().deps, duePlan());
    const rows = observations(), past = history();
    expect(past.length).toBe(12);
    for (const h of past) {
      const rec = rows.find((r) => r.id === h.metadata.observationId)!;
      expect(rec).toBeDefined(); // every history row names the observation it came from
      expect([h.platform, h.prompt_id, h.answer_hash, h.observed_at]).toEqual([rec.engine, rec.prompt_id, rec.answer_hash, rec.completed_at]);
      expect(h.citation_urls).toEqual(rec.journey.cited_sources!.map((c) => c.url));
      expect([h.citation_count, h.metadata.citationsObserved, h.metadata.observationMode]).toEqual([rec.journey.cited_sources!.length, true, rec.observation_mode]);
    }
    expect(past.find((h) => h.platform === "chatgpt")!.id).toContain("chatgpt+scraper"); // the pre-6I id shape is unchanged, so every existing reader still works
    expect(past.every((h) => h.run_id === "run-1" && h.tenant_id === TENANT)).toBe(true);
  });
});

describe("re-analysis reads what was already bought", () => {
  it("reads stored answers back and records a verdict beside them without asking any provider again", async () => {
    db.read = [{ id: "obs_1", tenant_id: TENANT, prompt_id: "q1", prompt_version: 1, engine: "chatgpt", sample_slot: 0, reporting_day: DAY,
      status: "observed", completed_at: "2026-07-21T09:00:00.000Z", prompt_text: QUESTIONS[0]!.text, answer_text: "Kite festivals open at dawn.", answer_hash: "abc", analysis: null, analysis_hash: null }];
    const views = await readAiObservationViews(TENANT, { day: DAY });
    expect([views.length, views[0]!.promptId, views[0]!.answerText, views[0]!.analysis]).toEqual([1, "q1", "Kite festivals open at dawn.", null]);
    expect([db.filters.tenant_id, db.filters.reporting_day]).toEqual([TENANT, DAY]); // scoped to ONE account and ONE day, always
    db.matched = [{ id: "obs_1" }];
    await persistAnswerAnalysis(TENANT, "obs_1", { mentioned: true }, "hash-1");
    expect(db.updated).toEqual({ analysis: { mentioned: true }, analysis_hash: "hash-1" });
    db.matched = [];
    await expect(persistAnswerAnalysis(TENANT, "obs_missing", { mentioned: false }, "hash-2")).rejects.toThrow(/matched no row/); // a lost verdict never reads as a saved one
  });
});
