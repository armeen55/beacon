/**
 * PRODUCT - FULL-FIDELITY AI OBSERVATION CAPTURE. Three tracked questions across four engines are driven
 * through the REAL prompt-observation unit, the REAL registry parsers over the REAL provider envelope
 * fixtures, and the REAL fail-closed writer, with only Postgres itself faked. Pins the canonical identity,
 * slot semantics, the whole answer and the whole journey, honest statuses, tenant isolation, and the
 * prompt_answer_observations row as a DERIVED projection. Zero network, zero provider spend.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const db = vi.hoisted(() => ({ written: [] as { table: string; row: Record<string, unknown> }[], read: [] as Record<string, unknown>[], updated: null as Record<string, unknown> | null, matched: [] as { id: string }[], error: null as { message: string } | null, filters: {} as Record<string, unknown>, selected: [] as string[], pages: [] as string[], onPage: null as ((n: number) => void) | null }));
/** The ONE fake: Postgres. Every writer, every guard and every projection above it is the real one. It
 *  answers a KEYSET page the way the real client does: the rows strictly past the cursor, IN THE ORDER THE
 *  CALLER ASKED FOR, cut to the asked limit. A reader that asks for one page and calls it the whole history
 *  is caught here, so is one that re-numbers its window by offset while rows are being inserted underneath
 *  it, and so is one that pages a table without a unique tiebreaker in its own ORDER BY. */
vi.mock("@/lib/persistence/supabase", async (orig) => ({ ...((await orig()) as object), getSupabaseAdmin: () => ({ from: (table: string) => fakeTable(table) }) }));
function fakeTable(table: string) {
  let max: number | null = null;
  let after: { at: string; id: string } | null = null;
  /** Exactly the ORDER BY the caller built, in the order it built it. Nothing is assumed. */
  const orders: { col: string; asc: boolean }[] = [];
  const sorted = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => {
    for (const { col, asc } of orders) {
      const c = String(a[col] ?? "").localeCompare(String(b[col] ?? ""));
      if (c !== 0) return asc ? c : -c;
    }
    return 0; // a tie the query never broke: Postgres is free to return these two either way round
  });
  const q: Record<string, unknown> = {
    select: (cols?: string) => { db.selected.push(cols ?? ""); return q; },
    eq: (c: string, v: unknown) => { db.filters[c] = v; return q; },
    order: (col: string, o?: { ascending?: boolean }) => { orders.push({ col, asc: o?.ascending !== false }); return q; },
    limit: (n: number) => { max = n; return q; },
    or: (expr: string) => {
      const m = /requested_at\.lt\."([^"]*)".*id\.lt\."([^"]*)"/.exec(expr);
      if (m) after = { at: m[1]!, id: m[2]! };
      return q;
    },
    gte: (c: string, v: unknown) => { db.filters[`${c}_gte`] = v; return q; },
    lte: (c: string, v: unknown) => { db.filters[`${c}_lte`] = v; return q; },
    update: (patch: Record<string, unknown>) => { db.updated = patch; return q; },
    upsert: (chunk: Record<string, unknown>[]) => { for (const row of chunk) db.written.push({ table, row }); return { select: async () => ({ data: chunk.map((r) => ({ id: r.id })), error: db.error }) }; },
    then: (res: (v: { data: unknown; error: unknown }) => void) => {
      if (db.updated) return res({ data: db.matched, error: db.error });
      const ordered = sorted(db.read);
      const cursor = after;
      const past = cursor
        ? ordered.filter((r) => { const at = String(r.requested_at ?? ""); return at < cursor.at || (at === cursor.at && String(r.id) < cursor.id); })
        : ordered;
      const page = max == null ? past : past.slice(0, max);
      db.pages.push(`${cursor ? `${cursor.at}|${cursor.id}` : "start"}+${page.length}`);
      db.onPage?.(db.pages.length);
      return res({ data: page, error: db.error });
    },
  };
  return q;
}
/** The two first-party Search Console reads the funnel's own page-query default sits on. Faked here so the
 *  default itself is the thing under test; nothing else in this file reaches them. */
const gsc = vi.hoisted(() => ({ pages: new Map<string, unknown>(), decay: new Map<string, unknown>() }));
vi.mock("@/domains/evidence/readers/gsc-page-signals", () => ({
  loadGscPageSignalsForTenant: async () => gsc.pages,
  loadGscDecaySignalsForTenant: async () => gsc.decay,
}));
import type { Account } from "@/domains/account";
import { aiObservationId, persistAnswerAnalysis, readAiObservations, readAiObservationViews, recordAiObservation, settleFailedObservation, type AiObservationRecord, type DueObservation } from "@/domains/evidence/ai-visibility/ai-observations";
import { retrievedNotCitedLinks } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { loadFunnelState, type FunnelPair, type FunnelState } from "@/domains/evidence/funnel/state";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
import type { CachedCallResult, CapabilityKey } from "@/domains/evidence/dataforseo/funnel-boundary";
import { promptObservationUnit } from "@/domains/evidence/funnel/observe";
import { resolveDeps, type FunnelDeps } from "@/domains/evidence/funnel/shared";
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

beforeEach(() => { db.written = []; db.read = []; db.updated = null; db.matched = []; db.error = null; db.filters = {}; db.selected = []; db.pages = []; db.onPage = null; });

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
  /** One stored row per index, each with its own ask stamp, newest last so the ids and the stamps disagree
   *  about order exactly as they do in production. */
  const stored = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `obs_${String(from + i).padStart(5, "0")}`,
    tenant_id: TENANT, reporting_day: DAY, sample_slot: 0, status: "observed",
    requested_at: new Date(Date.parse(`${DAY}T00:00:00.000Z`) + (from + i) * 1000).toISOString() }));
  /** A NAMED RANGE COMES BACK WHOLE, ONCE EACH, AND WITHOUT THE ANSWERS RIDING ALONG. 35 questions x 4 engines x 28 days is 3,920 rows:
   *  one capped query returned the newest 2,000, so a report that claimed 28 days was built from about 14 and every total under it was
   *  short. Two rows stamped the same millisecond on a page edge come back either way round without a unique tiebreaker in the ORDER BY,
   *  and the cursor then walks straight past one. And `answer_text` plus `journey` over a 56 day window is megabytes an account a visit,
   *  the exact shape that has timed a statement out on this table before. */
  it("walks a whole range by cursor, reads every stored row exactly once across a same-instant page edge, and asks for only the columns it reads", async () => {
    db.read = stored(3920);
    const rows = await readAiObservations(TENANT, { fromDay: "2026-07-01", toDay: "2026-07-28", slot: 0 });
    expect([rows.length, new Set(rows.map((r) => r.id)).size]).toEqual([3920, 3920]); // every stored row once
    expect(db.pages.map((p) => p.split("+")[1])).toEqual(["1000", "1000", "1000", "920"]); // 1,000 a page, walked to the end
    expect(db.pages[1]!.startsWith("start")).toBe(false); // and every page after the first starts AT A CURSOR
    expect([db.filters.tenant_id, db.filters.reporting_day_gte, db.filters.reporting_day_lte, db.filters.sample_slot])
      .toEqual([TENANT, "2026-07-01", "2026-07-28", 0]); // account, range and slot are all asked in the QUERY
    db.pages = []; db.read = stored(6000);
    expect([(await readAiObservations(TENANT, { fromDay: "2026-07-01", toDay: "2026-07-30", slot: 0 })).length, db.pages.length]).toEqual([6000, 7]);
    db.pages = []; const tied = stored(1001); tied[1]!.requested_at = tied[0]!.requested_at; db.read = tied;
    const walked = await readAiObservations(TENANT, { day: DAY });
    expect([walked.length, new Set(walked.map((r) => r.id)).size, db.pages.map((p) => p.split("+")[1])]).toEqual([1001, 1001, ["1000", "1"]]);
    db.read = stored(3); db.selected = [];
    await readAiObservations(TENANT, { fromDay: "2026-07-01", toDay: "2026-07-28", slot: 0, projection: "outcome" });
    const asked = db.selected[0]!;
    for (const col of ["id", "tenant_id", "prompt_id", "engine", "reporting_day", "sample_slot", "status", "analysis", "requested_at"]) expect(asked.split(",")).toContain(col);
    for (const heavy of ["answer_text", "journey"]) expect(asked).not.toContain(heavy);
    db.selected = []; await readAiObservations(TENANT, { day: DAY }); // a caller that needs the whole answer simply does not ask for a projection
    expect(db.selected[0]).toBe("*");
  });
  it("reads the addresses an answer credited off the stored journey, and keeps null a different claim from none", async () => {
    const at = (url: string, domain: string) => ({ url, domain, title: null });
    db.read = [
      { id: "o1", tenant_id: TENANT, reporting_day: DAY, sample_slot: 0, status: "observed", requested_at: `${DAY}T09:00:04.000Z`,
        journey: { cited_sources: [at("https://rival.example/a", "rival.example"), at("", "acme.com")] } },
      { id: "o2", tenant_id: TENANT, reporting_day: DAY, sample_slot: 0, status: "observed", requested_at: `${DAY}T09:00:03.000Z`,
        journey: { cited_sources: [] } },
      { id: "o3", tenant_id: TENANT, reporting_day: DAY, sample_slot: 0, status: "observed", requested_at: `${DAY}T09:00:02.000Z`,
        journey: { cited_sources: null } },
      { id: "o4", tenant_id: TENANT, reporting_day: DAY, sample_slot: 0, status: "observed", requested_at: `${DAY}T09:00:01.000Z` },
    ];
    const views = await readAiObservationViews(TENANT, { day: DAY });
    // The address when there is one, the bare site when the engine named only a site, in the order credited.
    expect(views.find((v) => v.id === "o1")!.citationUrls).toEqual(["https://rival.example/a", "acme.com"]);
    expect(views.find((v) => v.id === "o2")!.citationUrls).toEqual([]);   // it credited nobody: an OBSERVED zero
    expect(views.find((v) => v.id === "o3")!.citationUrls).toBeNull();    // this path does not report citations at all
    expect(views.find((v) => v.id === "o4")!.citationUrls).toBeNull();    // and a row with no journey claims nothing
  });
  it("settles a failed reading only while it is still failed, and says which honest state it moved to", async () => {
    // A reading that landed while the planner was deciding wins: the compare-and-set is what stops a
    // decision taken a moment earlier from demoting an answer that is now in hand.
    await settleFailedObservation(TENANT, "obs_1", "unavailable");
    expect(db.updated).toEqual({ status: "unavailable" });
    expect(db.filters).toEqual({ tenant_id: TENANT, id: "obs_1", status: "failed" });
    db.updated = null; db.filters = {};
    await settleFailedObservation(TENANT, "obs_2", "unsupported");
    expect(db.updated).toEqual({ status: "unsupported" }); // an engine I cannot ask is a different claim
    expect(db.filters).toEqual({ tenant_id: TENANT, id: "obs_2", status: "failed" });
    db.updated = null; db.error = { message: "connection lost" };
    await expect(settleFailedObservation(TENANT, "obs_3", "unavailable")).rejects.toThrow(/settle failed/);
  });
  it("reads a NAMED DAY whole, and an insert mid-read never doubles a row or drops one", async () => {
    // The planner asks for the single day it is planning. That is a named range, so the reader walks it to
    // the end: it used to default to 500 rows and call the newest page of a 600 row day the whole day.
    db.read = stored(600);
    expect((await readAiObservations(TENANT, { day: DAY })).length).toBe(600);
    // AND THE PAGES DO NOT SHIFT UNDER AN INSERT. The collect step writes rows while a read is walking;
    // an offset window re-numbers itself around them, so one row came back twice and another never at all.
    db.pages = []; db.read = stored(2500);
    db.onPage = (n) => { if (n === 1) db.read = [...stored(30, 9000), ...db.read]; }; // 30 newer rows land mid-read
    const walked = await readAiObservations(TENANT, { day: DAY });
    expect(new Set(walked.map((r) => r.id)).size).toBe(walked.length); // no id twice
    expect(walked.filter((r) => Number(String(r.id).slice(4)) < 2500).length).toBe(2500); // and nothing already stored was skipped
  });
});

/** The two readers the research funnel falls back on when a caller injects nothing. Both were built to carry
 *  PROVENANCE, and provenance is invisible from the outside: a keyword harvested downstream can name the
 *  answer or the page it came from only because these fields ride along. Run for real over the fakes. */
describe("the funnel's own default readers carry provenance, not just payload", () => {
  it("keeps every answer's identity on the analysis it is about", async () => {
    const analysis = { ownedBrandMention: { mentioned: true, position: 1, context: null } };
    db.read = [
      { id: "obs_a", tenant_id: TENANT, prompt_id: "q7", prompt_version: 3, engine: "claude", reporting_day: DAY,
        sample_slot: 0, status: "observed", requested_at: `${DAY}T09:00:02.000Z`, completed_at: null,
        prompt_text: QUESTIONS[0]!.text, answer_text: "an answer", answer_hash: "h", analysis, analysis_hash: "ah" },
      // Never analyzed: there is no verdict to carry, so it is not a candidate at all.
      { id: "obs_b", tenant_id: TENANT, prompt_id: "q8", prompt_version: 1, engine: "chatgpt", reporting_day: DAY,
        sample_slot: 0, status: "observed", requested_at: `${DAY}T09:00:01.000Z`, prompt_text: "x", analysis: null },
    ];
    const rows = await resolveDeps({}).loadAnswerAnalyses(TENANT);
    // Without these six the analysis arrives anonymous, and a keyword taken out of it can never name the
    // question, the engine, the day or the stored answer it came from.
    expect(rows).toEqual([{ analysis, observationId: "obs_a", promptId: "q7", promptVersion: 3,
      promptText: QUESTIONS[0]!.text, engine: "claude", reportingDay: DAY }]);
  });
  it("names the page of mine whose Search Console row carried each query, and orders the slipping ones first", async () => {
    gsc.pages = new Map([
      ["https://mine.example/guide", { page: "https://mine.example/guide", clicks90d: 10, impressions90d: 900, ctr90d: 0.01,
        position90d: 8, topQueries: [{ query: "kite festival dates", impressions: 400 }] }],
      ["https://mine.example/food", { page: "https://mine.example/food", clicks90d: 20, impressions90d: 500, ctr90d: 0.04,
        position90d: 5, topQueries: [{ query: "kite festival food", impressions: 300 }] }],
    ]);
    // The guide's last 28 days fell against the 28 before them, so its queries are the slipping ones.
    gsc.decay = new Map([["https://mine.example/guide", { page: "https://mine.example/guide", clicksNow: 3, clicksPrior: 9 }]]);
    const queries = await resolveDeps({}).loadPageQueries(TENANT);
    expect(queries).toEqual([
      { query: "kite festival dates", impressions: 400, declining: true, page: "https://mine.example/guide" },
      { query: "kite festival food", impressions: 300, declining: false, page: "https://mine.example/food" },
    ]);
  });
});

describe("retrieved is not the same claim as not cited", () => {
  const at = (url: string) => ({ url, domain: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]!, title: null });
  const MINE = "https://mine.example/guide";
  it("subtracts the citations from the retrieval list by canonical url, and claims nothing without them", () => {
    // The SAME page, read and then credited, differing by scheme, www, a trailing slash and a fragment.
    const retrieved = [at("http://www.mine.example/guide/#top"), at("https://rival.example/a")];
    const cited = [at(MINE)];
    expect(retrievedNotCitedLinks(retrieved, cited).map((r) => r.url)).toEqual(["https://rival.example/a"]);
    expect(retrievedNotCitedLinks(retrieved, null)).toEqual([]); // citations not observable cannot accuse anyone
    expect(retrievedNotCitedLinks(null, cited)).toEqual([]);
    expect(retrievedNotCitedLinks(retrieved, [])).toEqual(retrieved); // an observed zero IS a claim
  });
  it("credits the whole site when the citation names only a site, and only that page when it names a page", () => {
    // The reader falls back to the bare domain whenever an engine reports no address for what it credited,
    // and comparing whole urls alone matched none of those: a page that WAS credited came back as read and
    // passed over, which is the harshest verdict this product can reach about a page.
    const retrieved = [at("https://acme.com/guide"), at("https://rival.example/a")];
    expect(retrievedNotCitedLinks(retrieved, [{ url: "acme.com", domain: "acme.com", title: null }]).map((r) => r.url))
      .toEqual(["https://rival.example/a"]);
    // A citation naming a DIFFERENT page on the same site still leaves the retrieved one uncredited.
    expect(retrievedNotCitedLinks(retrieved, [at("https://acme.com/other")]).map((r) => r.url))
      .toEqual(["https://acme.com/guide", "https://rival.example/a"]);
  });
  it("decodes a row stored before this rule as the raw list it always was, subtracted once and never twice", async () => {
    const pair = { promptId: "q1", engine: "chatgpt", cacheKey: null, status: "done",
      citations: [at(MINE)], retrievedResults: [at(MINE), at("https://rival.example/a")] } as FunnelPair;
    const state = { schemaVersion: 3, tenantId: TENANT, basisTag: BASIS, prompts: { pairs: [pair], intendedPairs: 1 } } as FunnelState;
    const row = { schema_version: 3, state, row_version: 1 };
    const table = { select: () => table, eq: () => table, maybeSingle: async () => ({ data: row, error: null }) };
    const loaded = await loadFunnelState(TENANT, BASIS, { configured: () => true, admin: () => ({ from: () => table }) });
    expect(loaded.state.prompts.pairs[0]!.retrievedResults).toEqual(pair.retrievedResults); // decoded whole, not reinterpreted
    const once = retrievedNotCitedLinks(loaded.state.prompts.pairs[0]!.retrievedResults, pair.citations);
    expect(once.map((r) => r.url)).toEqual(["https://rival.example/a"]);
    expect(retrievedNotCitedLinks(once, pair.citations)).toEqual(once); // deriving again takes nothing more away
  });
});
