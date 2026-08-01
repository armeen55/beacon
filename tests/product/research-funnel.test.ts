/** PRODUCT - the research funnel: the four executors, the pure projector and the canonical snapshot, driven by injected CAPABILITY fakes over an
 *  in-memory basis-scoped state repo. Pins CURRENT-SET truth, OBSERVATION-MODE truth, weekly freshness, the DISPOSITION ladder, the SERP agenda in
 *  the customer's own words with an open investigation bought first, the ONE paid page-by-page comparison, history identity, the receipt. No network. */
import { describe, it, expect, vi, beforeEach } from "vitest";
const sb = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fails: false, tenant: "", urls: [] as string[] })); // the ONE page_snapshots read the body reader makes
vi.mock("@/lib/persistence/supabase", async (orig) => ({ ...((await orig()) as object), getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: (_c: string, t: string) => { sb.tenant = t; return { in: (_u: string, urls: string[]) => { sb.urls = urls; return { order: () => ({ limit: async () => (sb.fails ? { data: null, error: { message: "down" } } : { data: sb.rows, error: null }) }) }; } }; } }) }) }) }));
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context"; import { canonicalUrlKey } from "@/domains/evidence/snapshot"; import { emptyBusinessProfile, type Account, type BusinessProfile, type ProfileSection } from "@/domains/account";
import type { CachedCallResult, CapabilityKey, FailureDisposition, ParsedAiAnswer, ParsedKeywordItem, ParsedSerp } from "@/domains/evidence/dataforseo/funnel-boundary";
import { keywordDiscoveryUnit } from "@/domains/evidence/funnel/discovery"; import { promptObservationUnit, serpAnalysisUnit } from "@/domains/evidence/funnel/observe"; import { winningPagesUnit } from "@/domains/evidence/funnel/winning-pages";
import { retainDiverse, selectSerpAgenda } from "@/domains/evidence/funnel/normalize"; import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { caseResearchReceipt } from "@/domains/evidence/case-receipt"; import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { emptyFunnelState, loadFunnelState, MAX_RETAINED, type FunnelKeyword, type FunnelPair, type FunnelState } from "@/domains/evidence/funnel/state";
import { CONFLICT_DETAIL, type FunnelDeps } from "@/domains/evidence/funnel/shared"; import { aiObservationId, type DueObservation } from "@/domains/evidence/ai-visibility/ai-observations"; import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
const BASIS = "basis_aaa"; const NOW = 1_700_000_000_000; // a fixed clock far past the 7-day freshness window
const WEEKS_AGO = new Date(NOW - 30 * 24 * 3600 * 1000).toISOString(); const ENG = ["chatgpt", "gemini", "claude", "perplexity"] as const;
const cur = (basis: string | null = BASIS) => (basis ? { basis } : {}); const confirmed = <V>(value: V): ProfileSection<V> => ({ value, origin: "operator_confirmed", confidence: null, sourceUrls: [] });
function profileOf(id: string, offerings: string[], topics: string[], exclude: string[] = [], banned: string[] = []): BusinessProfile { const p = emptyBusinessProfile(id); p.offerings = confirmed(offerings); p.topicsToOwn = confirmed(topics); p.constraints.value.bannedTerms = banned;
  p.topicsToExclude = { value: exclude, origin: "inferred", confidence: null, sourceUrls: [] }; return p; } const parse = ((_c: unknown, env: unknown) => env) as unknown as FunnelDeps["parse"];
const parsedKw = (kws: { keyword: string; volume?: number }[]): ParsedKeywordItem[] => kws.map((k) => ({ keyword: k.keyword, searchVolume: k.volume ?? 100, cpcUsd: null, competition: 0.4, competitionLevel: null, difficulty: null, intent: "informational", rankedUrl: null, rankedRank: null, monthlySearches: null }));
const aiAnswer = (over: Partial<ParsedAiAnswer> = {}): ParsedAiAnswer => ({ answerText: "hi", modelServed: null, webSearchReported: null, citations: null, fanOutQueries: null, retrievedResults: null, brandMentions: null, ...over });
const serp = (organic: ParsedSerp["organic"]): ParsedSerp => ({ organic, aiOverview: null, paaQuestions: [], relatedSearches: [] });
const ok = (parsed: unknown, cacheKey = "ck", modelServed: string | null = null): CachedCallResult => ({ state: "ok", envelope: parsed as never, costUsd: 0.01, cacheKey, modelServed });
const waiting = (cacheKey: string): CachedCallResult => ({ state: "waiting", cacheKey, providerTaskId: "t", costUsd: 0, detail: "posted" });
const err = (disposition: FailureDisposition, cacheKey: string | null = "ck-old"): CachedCallResult => ({ state: "error", cacheKey, disposition, detail: "the provider could not finish it" }); function memStore(seed?: FunnelState) {
  const rows = new Map<string, { state: FunnelState; rowVersion: number }>(); if (seed) rows.set(`${seed.tenantId}|${seed.basisTag}`, { state: seed, rowVersion: 1 }); const clone = (s: FunnelState): FunnelState => structuredClone(s); // the real repo decodes a fresh object per load
  const deps = { loadState: async (t: string, b: string) => { const row = rows.get(`${t}|${b}`); return row ? { state: clone(row.state), rowVersion: row.rowVersion } : { state: emptyFunnelState(t, b), rowVersion: 0 }; },
    saveState: async (t: string, b: string, s: FunnelState, expected: number) => { const k = `${t}|${b}`; if ((rows.get(k)?.rowVersion ?? 0) !== expected) return null; rows.set(k, { state: clone(s), rowVersion: expected + 1 }); return expected + 1; } } satisfies Pick<FunnelDeps, "loadState" | "saveState">;
  return { deps, peek: (t: string, b: string) => rows.get(`${t}|${b}`)?.state }; }
const base = (profile: BusinessProfile, domain = "iranopedia.com"): FunnelDeps => ({ loadProfile: async () => profile, loadCrawl: async () => null, getAccount: async () => ({ domain } as Account), parse, now: () => 1_000_000 });
const DAY_A = "2026-07-21", DAY_B = "2026-07-22"; // THE PLANNER owns the reporting day; the unit never derives one
/** Runtime's daily plan: every question on every engine, at one slot, on one named reporting day. */
const plan = (ps: { id: string; text: string }[], day = DAY_A, slot: 0 | 1 | 2 = 0): DueObservation[] => ps.flatMap((p) => ENG.map((engine) => ({ promptId: p.id, version: 1, text: p.text, engine, slot, day })));
describe("research funnel - basis-scoped discovery + isolation", () => {
  const profile = profileOf("t1", ["persian recipes"], ["nowruz", "persian food"], ["politics"], ["gambling"]); const bulk = Array.from({ length: 60 }, (_, i) => ({ keyword: `persian food dish ${i}`, volume: 900 - i }));
  const rejects = [{ keyword: "gambling bonus offer" }, { keyword: "politics debate today" }, { keyword: "login account page" }, { keyword: "unrelated widget gadget" }]; const callProvider = async (cap: CapabilityKey) => (cap === "labs_keywords_for_site" ? ok(parsedKw([...bulk, ...rejects])) : ok(parsedKw([])));
  it("scopes retained keywords to the cursor basis, shares nothing across tenants, and fails closed with no basis", async () => { const store = memStore(); const out = await keywordDiscoveryUnit({ ...base(profile), ...store.deps, callProvider })("t1", cur(), 60_000);
    expect(out.status).toBe("done"); const st = store.peek("t1", BASIS)!; expect(st.discovery.retained.length).toBeGreaterThan(0); expect(new Set(st.discovery.rejected.map((r) => r.reason))).toEqual(new Set(["banned_term", "excluded_topic", "junk", "irrelevant"])); expect(store.peek("t1", "basis_other")).toBeUndefined();
    await keywordDiscoveryUnit({ ...base(profileOf("t2", ["persian recipes"], ["persian food"])), ...store.deps, callProvider })("t2", cur(), 60_000); expect(store.peek("t2", BASIS)!.discovery.retained.length).toBeGreaterThan(0); expect(store.peek("t1", BASIS)!.discovery.retained.length).toBe(st.discovery.retained.length);
    const blind = await keywordDiscoveryUnit({ ...base(profile), ...memStore().deps, callProvider })("t1", cur(null), 60_000); expect([blind.status, !!blind.detail]).toEqual(["failed", true]); }); // fail closed with no basis
  it("reports a moved row as a STRUCTURED state conflict and corrupts nothing (Runtime never parses the copy)", async () => { const seed = emptyFunnelState("t1", BASIS); // a concurrent writer moved the row: every save now conflicts
    seed.discovery.retained = [{ keyword: "keep me", searchVolume: 9, competition: 0.2, difficulty: null, intent: null, discoveredVia: "site" }]; const store = memStore(seed); const out = await keywordDiscoveryUnit({ ...base(profile), ...store.deps, saveState: async () => null, callProvider })("t1", cur(), 60_000);
    expect([out.status, out.code, out.detail]).toEqual(["failed", "state_conflict", CONFLICT_DETAIL]); expect(store.peek("t1", BASIS)!.discovery.retained[0]!.keyword).toBe("keep me"); }); // persisted row untouched
});
describe("research funnel - prompt observation honesty + history identity", () => {
  const prompts = [{ id: "p1", text: "best persian restaurant" }, { id: "p2", text: "where to buy saffron" }]; function deps(store: ReturnType<typeof memStore>, rows: PromptAnswerObservation[], claudeModel: string): FunnelDeps {
    return { ...store.deps, loadProfile: async () => profileOf("tp", ["persian food"], ["saffron"]), parse, syncHistory: async (r) => { rows.push(...r); }, recordObservation: async () => {}, getAccount: async () => ({ domain: "iranopedia.com" } as Account), now: () => 5_000_000,
      collectTask: async () => ok(aiAnswer({ modelServed: "gpt-4o", citations: [{ url: "https://a.com/1", domain: "a.com", title: null }] }), "ck-chat"),
      callProvider: async (cap: CapabilityKey) => { if (cap === "llm_perplexity") return ok(aiAnswer({ modelServed: "sonar", webSearchReported: true, citations: [] }));
        if (cap === "llm_scraper_chatgpt") return ok(aiAnswer({ modelServed: "gpt-4o", citations: [{ url: "https://c.com/2", domain: "c.com", title: null }], fanOutQueries: ["persian food near me"] }));
        if (cap === "llm_chatgpt") return waiting("ck-chat"); if (cap === "llm_gemini") return ok(aiAnswer({ citations: null })); return ok(aiAnswer({ modelServed: claudeModel, citations: [{ url: "https://d.com/3", domain: "d.com", title: null }] })); } };
  }
  it("keeps webSearchReported distinct from citations and preserves the null-vs-[] citation tri-state", async () => { const rows: PromptAnswerObservation[] = []; const store = memStore(); const out = await promptObservationUnit(deps(store, rows, "claude-3-5-sonnet"), plan(prompts))("tp", cur(), 60_000);
    expect(out.progress.enginePairsIntended).toBe(8); expect(out.status).toBe("done"); // exactly the 8 readings the planner asked for, all in
    const st = store.peek("tp", BASIS)!; const perp = st.prompts.pairs.find((p) => p.engine === "perplexity" && p.status === "done")!; expect(perp.webSearchReported).toBe(true); expect(perp.citations).toEqual([]); expect(perp.citationsObserved).toBe(true);
    const gem = st.prompts.pairs.find((p) => p.engine === "gemini" && p.status === "done")!; expect(gem.citations).toBeNull(); expect(gem.citationsObserved).toBe(false); const perpRow = rows.find((r) => r.platform === "perplexity")!, gemRow = rows.find((r) => r.platform === "gemini")!;
    expect(perpRow.citation_urls).toEqual([]); expect(perpRow.metadata.citationsObserved).toBe(true); expect(perpRow.metadata.observationMode).toBe("standardized_response");
    expect(gemRow.citation_urls).toBeNull(); expect(gemRow.metadata.citationsObserved).toBe(false); expect(rows.some((r) => (r.search_queries ?? []).length > 0)).toBe(true); });
  it("hands each capability its own provider-valid ask, and rides the plan's own reporting day on every one", async () => { const seen = new Map<string, unknown>(); const store = memStore();
    await promptObservationUnit({ ...deps(store, [], "claude-4"), callProvider: async (cap, input) => { if (!seen.has(cap)) seen.set(cap, input); return waiting("ck"); } }, plan(prompts))("tp", cur(), 60_000);
    expect(seen.get("llm_claude")).toEqual({ user_prompt: "best persian restaurant", web_search: true, force_web_search: true, web_search_country_iso_code: "US", observation_day: DAY_A }); // documented for Claude
    expect(seen.get("llm_gemini")).toEqual({ user_prompt: "best persian restaurant", web_search: true, observation_day: DAY_A }); expect(seen.get("llm_perplexity")).toEqual({ user_prompt: "best persian restaurant", observation_day: DAY_A });
    expect(seen.get("llm_scraper_chatgpt")).toEqual({ keyword: "best persian restaurant", force_web_search: true, expand_citations: true, observation_day: DAY_A }); // keyword-based, never user_prompt
    expect(seen.has("llm_chatgpt")).toBe(false); // ChatGPT coverage IS the consumer look; nothing asks the standardized endpoint any more
    expect(Object.values(seen.get("llm_gemini") as Record<string, unknown>).includes(0)).toBe(false); }); // slot 0 is left OUT, so a same-day retry is still a free replay of one identical ask
  it("gives a changed served model its OWN history row, never a merge", async () => { const rows: PromptAnswerObservation[] = []; const store = memStore(); await promptObservationUnit(deps(store, rows, "claude-3-5-sonnet"), plan(prompts))("tp", cur(), 60_000);
    await promptObservationUnit({ ...deps(store, rows, "claude-4"), now: () => 5_000_000 + 24 * 3600 * 1000 }, plan(prompts, DAY_B))("tp", cur(), 60_000);
    expect(new Set(rows.filter((r) => r.platform === "claude" && r.prompt_id === "p1").map((r) => r.id)).size).toBe(2);
    expect(rows.filter((r) => r.platform === "chatgpt").every((r) => r.metadata.scraper === true && r.metadata.observationMode === "consumer_search")).toBe(true); }); // pre-6I readers still see the flag
  it("stamps history with the REAL run id and starts each cycle's receipt at zero", async () => { const rows: PromptAnswerObservation[] = []; const store = memStore(); const d: FunnelDeps = { ...deps(store, rows, "claude-4"), callProvider: async () => ok(aiAnswer({ citations: [] })) };
    const r1 = await promptObservationUnit(d, plan(prompts))("tp", { basis: BASIS, runId: "run-1", cycle: "cycle-1" }, 60_000); expect(r1.status).toBe("done"); expect(rows.every((r) => r.run_id === "run-1")).toBe(true); // never a manufactured id
    const c1 = store.peek("tp", BASIS)!; expect(c1.cycle).toMatchObject({ runId: "run-1", cycleKey: "cycle-1" }); expect(c1.cycle.spentUsd).toBeCloseTo(0.08, 5); // 8 pairs at one cent
    const r2 = await promptObservationUnit(d, plan(prompts, DAY_B))("tp", { basis: BASIS, runId: "run-2", cycle: "cycle-2" }, 60_000); const c2 = store.peek("tp", BASIS)!; expect(r2.status).toBe("done");
    expect(c2.cycle).toMatchObject({ runId: "run-2", cacheHits: 0 }); expect(c2.cycle.spentUsd).toBeCloseTo(0.08, 5); expect(c2.ledger.spentUsd).toBeCloseTo(0.16, 5); }); // a new run gets a FRESH receipt; the lifetime total is still true
});
describe("research funnel - current-set truth + the disposition ladder", () => {
  const prompts = [{ id: "p1", text: "best persian restaurant" }]; const donePair = (promptId: string, engine: FunnelPair["engine"], observedAt: string): FunnelPair => ({ promptId, engine, cacheKey: null, status: "done", observedAt, day: DAY_A, citationsObserved: true, citations: [] });
  const postedPair = (): FunnelPair => ({ promptId: "p1", engine: "chatgpt", mode: "consumer_search", day: DAY_A, cacheKey: "ck-old", status: "posted" });
  const seedWith = (pairs: FunnelPair[]) => { const s = emptyFunnelState("tp", BASIS); s.prompts = { pairs, intendedPairs: pairs.length }; return memStore(s); };
  const mk = (store: ReturnType<typeof memStore>, over: Partial<FunnelDeps> = {}): FunnelDeps => ({ ...store.deps, loadProfile: async () => profileOf("tp", ["persian food"], ["saffron"]), parse, syncHistory: async () => {}, recordObservation: async () => {}, getAccount: async () => ({ domain: "iranopedia.com" } as Account), now: () => NOW, ...over });
  const one = () => plan(prompts); const unit = (d: FunnelDeps, due = one()) => promptObservationUnit(d, due)("tp", cur(), 60_000);
  it("keeps ONLY the readings this plan asked for, so a completion from another question or another day can never satisfy it", async () => { const store = seedWith([...ENG.map((e) => donePair("p_gone", e, new Date(NOW).toISOString())), ...ENG.map((e) => ({ ...donePair("p1", e, new Date(NOW).toISOString()), day: "2026-07-20" }))]);
    const out = await unit(mk(store, { callProvider: async () => waiting("ck") }));
    expect(out.status).toBe("waiting"); expect(out.progress.enginePairsIntended).toBe(4); // every reading the planner asked for is outstanding
    const kept = store.peek("tp", BASIS)!.prompts.pairs; expect(kept.length).toBe(4); expect(kept.every((p) => p.promptId === "p1" && p.day === DAY_A)).toBe(true); }); // obsolete rows dropped; the history lives in ai_observations
  it("keeps working when the budget runs out mid-plan instead of reporting done", async () => { const store = memStore(); let landed = false; // the budget runs out right after the FIRST reading lands
    const out = await unit(mk(store, { now: () => (landed ? NOW + 9_000_000 : NOW), syncHistory: async () => { landed = true; }, callProvider: async () => ok(aiAnswer({ citations: [] })) }));
    expect(out.status).toBe("advanced"); expect(store.peek("tp", BASIS)!.prompts.pairs.filter((p) => p.status === "pending").length).toBe(3); }); // NOT done: three readings are still owed
  it("keeps a retry_free task posted on the SAME key; a blocked collect keeps it too and stops the paid batch dead", async () => { for (const disposition of ["retry_free", "blocked"] as const) {
      const store = seedWith([postedPair()]); let posts = 0; const d = mk(store, { collectTask: async () => err(disposition), callProvider: async () => { posts += 1; return waiting("ck-new"); } });
      const r1 = await unit(d), r2 = await unit(d); // a second terminal never escalates
      const p = store.peek("tp", BASIS)!.prompts.pairs.find((x) => x.engine === "chatgpt")!; expect(p).toMatchObject({ status: "posted", cacheKey: "ck-old" }); expect(p.reposts).toBeUndefined(); // same identity, one-repost budget untouched
      expect([r1.status, r2.status]).toEqual(["failed", "failed"]); expect(r2.detail).toBeTruthy(); // an honest bounded pause
      expect(posts).toBe(disposition === "blocked" ? 0 : 3); // blocked stops every remaining provider call; retry_free lets the rest of the set run
    } });
  it("an expired task reposts the pair clean exactly ONCE, then explicit unsupported coverage, never a stuck run", async () => { const store = seedWith([postedPair()]); let posts = 0;
    const d = mk(store, { collectTask: async () => err("repost_once"), callProvider: async () => { posts += 1; return waiting("ck-new"); } }); const chat = () => store.peek("tp", BASIS)!.prompts.pairs.find((p) => p.engine === "chatgpt")!;
    const r1 = await unit(d); expect(r1.status).toBe("waiting"); expect(chat()).toMatchObject({ status: "posted", cacheKey: "ck-new", reposts: 1 }); expect(chat().requestedAt).toBeTruthy(); // ONE clean repost, stamped with ITS OWN moment
    const r2 = await unit(d); expect(chat()).toMatchObject({ status: "unsupported", requestedAt: undefined }); expect(r2.status).toBe("waiting"); // unavailable coverage named; the run is not stuck
    expect(posts).toBe(7); // 4 first-pass posts + the OTHER three pairs' single recovery; the dead key never reposts again
    const r3 = await unit(d); expect(posts).toBe(7); expect(r3.status).toBe("failed"); }); // every repost spent, and the day's budget is NOT reset by a revisit: zero further spend, honest failure, never done
  it("pauses honestly when a pass processes nothing or coverage is unavailable, never a fake done", async () => { const store = memStore(); let t = 0; // the deadline passes immediately after it is set: zero pairs run
    const stalled = await promptObservationUnit(mk(store, { now: () => (t += 100_000), callProvider: async () => waiting("ck") }), one())("tp", cur(), 1_000);
    const unavailable = await unit(mk(store, { callProvider: async () => ({ state: "not_configured", cacheKey: null, detail: "not configured" }) })); expect([stalled.status, unavailable.status, !!stalled.detail, !!unavailable.detail]).toEqual(["failed", "failed", true, true]); });
  it("a blocked POST stops the batch on the FIRST refusal, leaves every row exactly as it was, and pauses the run for review", async () => { const store = memStore(); let calls = 0; const pairs = () => store.peek("tp", BASIS)!.prompts.pairs;
    const d = mk(store, { callProvider: async () => { calls += 1; return err("blocked", "ck-blocked"); } });
    const r1 = await unit(d); expect([r1.status, r1.detail, calls]).toEqual(["failed", "the provider could not finish it", 1]); // the boundary's own truth, never a canned line, and not one more paid request
    expect(pairs().every((p) => p.status === "pending" && p.cacheKey == null)).toBe(true); // a held refusal is NEVER ordinary unsupported coverage
    const r2 = await unit(d); // a revisit re-enters and gets the same held answer for free
    expect([r2.status, r2.detail, calls]).toEqual(["failed", "the provider could not finish it", 2]); // still paused, zero post-block calls
    let ecalls = 0; // a refusal carrying an EMPTY detail must still arm the block and the batch stop
    const empty = await unit(mk(memStore(), { callProvider: async () => { ecalls += 1; return { state: "error", cacheKey: null, disposition: "blocked", detail: "" } as CachedCallResult; } })); expect([empty.status, !!empty.detail, ecalls]).toEqual(["failed", true, 1]); });
  it("a quarantined POST is plain unavailable coverage: the pair is marked unsupported and the batch keeps running", async () => { const store = memStore(); let calls = 0; const out = await unit(mk(store, { callProvider: async () => { calls += 1; return err("quarantined", "ck-q"); } }));
    expect([out.status, calls]).toEqual(["failed", 4]); // one ambiguous key never deadlocks the phase: every pair still got its turn
    expect(store.peek("tp", BASIS)!.prompts.pairs.every((p) => p.status === "unsupported" && p.observedAt && p.requestedAt === undefined)).toBe(true); // explicit, dated, unavailable, and never stamped with a stale ask
  });
});
describe("research funnel - SERP current set, freshness, and recovery", () => {
  const retainedState = (keywords: string[]): FunnelState => { const s = emptyFunnelState("ts", BASIS); // the agenda reads the profile and my own page queries; both injected, so nothing reaches the network
    s.discovery.retained = keywords.map((keyword, i) => ({ keyword, searchVolume: 90 - i, competition: 0.3, difficulty: null, intent: null, discoveredVia: "site" as const })); return s; };
  const serpBase = { parse, now: () => NOW, loadProfile: async () => emptyBusinessProfile("ts"), loadPageQueries: async () => [] } satisfies FunnelDeps;
  it("prunes obsolete queries, re-observes only a week-old look, resumes via collect, and never reposts a live key", async () => {
    const seed = retainedState(["a query", "b query"]); seed.serps.queries = [{ query: "dropped query", cacheKey: null, status: "done", observedAt: new Date(NOW).toISOString() }, { query: "a query", cacheKey: null, status: "done", observedAt: WEEKS_AGO }, { query: "b query", cacheKey: null, status: "done", observedAt: new Date(NOW - 3_600_000).toISOString() }];
    seed.serps.analyzed = 3; const store = memStore(seed); let posts = 0, collects = 0;
    const deps: FunnelDeps = { ...store.deps, ...serpBase, callProvider: async (cap: CapabilityKey, input) => { if (cap === "serp_organic") posts += 1; return waiting(`ck-${(input as { keyword: string }).keyword}`); },
      collectTask: async () => { collects += 1; return ok(serp([{ rank: 1, domain: "a.com", url: "https://a.com/x", title: "A" }])); } };
    const r1 = await serpAnalysisUnit(deps)("ts", cur(), 60_000); expect(r1.status).toBe("waiting"); expect(posts).toBe(1); // only the week-old look is due; the fresh one is never bought again
    const kept = store.peek("ts", BASIS)!.serps; expect(kept.queries.map((q) => q.query)).toEqual(["a query", "b query"]); // the obsolete query is pruned
    expect(kept.analyzed).toBe(1); // an old completion can never satisfy a due query
    const r2 = await serpAnalysisUnit(deps)("ts", cur(), 60_000); expect(posts).toBe(1); expect(collects).toBeGreaterThanOrEqual(1); expect(r2.status).toBe("done"); // resumed for free, never reposted
  });
  it("spends NOTHING when every trusted starting point is unreadable, and keeps the research already saved", async () => { const store = memStore(retainedState(["a query"])); let calls = 0;
    const out = await serpAnalysisUnit({ ...store.deps, ...serpBase, loadProfile: async () => { throw new Error("records down"); }, loadPageQueries: async () => null, callProvider: async () => { calls += 1; return waiting("ck"); } })("ts", cur(), 60_000);
    expect([out.status, calls, out.detail]).toEqual(["failed", 0, "I could not read any of your trusted starting points this pass, so I spent nothing. I will try again on your next visit."]); // a failed read is never "you have nothing"
    expect(store.peek("ts", BASIS)!.discovery.retained).toHaveLength(1); }); // prior saved research untouched
  it("recovers an expired search exactly once, then reports it unavailable instead of sticking failed", async () => { const seed = retainedState(["a query"]); seed.serps.queries = [{ query: "a query", cacheKey: "ck-old", status: "posted" }]; const store = memStore(seed); let posts = 0;
    const deps: FunnelDeps = { ...store.deps, ...serpBase, collectTask: async () => err("repost_once"), callProvider: async (cap: CapabilityKey) => { if (cap === "serp_organic") posts += 1; return waiting("ck-new"); } };
    const r1 = await serpAnalysisUnit(deps)("ts", cur(), 60_000); expect(r1.status).toBe("waiting"); expect(posts).toBe(1); // exactly ONE clean repost
    expect(store.peek("ts", BASIS)!.serps.queries[0]).toMatchObject({ status: "posted", cacheKey: "ck-new", reposts: 1 }); const r2 = await serpAnalysisUnit(deps)("ts", cur(), 60_000);
    expect(posts).toBe(1); expect(store.peek("ts", BASIS)!.serps.queries[0]!.status).toBe("failed"); // the repost budget is spent: zero further spend
    expect(r2.status).toBe("failed"); expect(r2.detail).toBeTruthy(); // explicit unavailable coverage, never silence
  });
  it("a blocked refusal outranks the done arithmetic and stops the batch; a quarantined one only names the gap", async () => {
    const seed = retainedState(["a query", "b query"]); const fresh = new Date(NOW).toISOString(); seed.serps.queries = [{ query: "a query", cacheKey: null, status: "done", observedAt: fresh }, { query: "b query", cacheKey: null, status: "done", observedAt: fresh }];
    seed.serps.analyzed = 2; const run = async (disposition: FailureDisposition) => { const s = memStore(seed); let calls = 0; // both looks landed: analyzed + unavailable would otherwise satisfy done
      const out = await serpAnalysisUnit({ ...s.deps, ...serpBase, callProvider: async () => { calls += 1; return err(disposition); } })("ts", cur(), 60_000); return { out, calls, rows: s.peek("ts", BASIS)!.serps.queries }; };
    const b = await run("blocked"); expect([b.out.status, b.out.detail, b.calls]).toEqual(["failed", "the provider could not finish it", 1]); // every look is in and the run STILL pauses for review
    expect(b.rows.every((r) => r.status === "done" && !r.aiModeFailed)).toBe(true); // a block never turns into unavailable coverage
    const q = await run("quarantined"); expect([q.out.status, q.calls]).toEqual(["done", 2]); // one ambiguous key never deadlocks the phase
    expect(q.rows.every((r) => r.aiModeFailed)).toBe(true); expect(q.out.detail).toContain("AI Mode looks were unavailable"); // explicit missing coverage, named
  });
  it("attributes each winning page to its OWN engines/prompts, excludes the own domain, and reuses a cached extract before any fetch", async () => { const s = emptyFunnelState("tw", BASIS); s.discovery.counts = { raw: 10, normalized: 8, retained: 1, rejected: 0 };
    s.serps.queries = [{ query: "q1", cacheKey: null, status: "done", observedAt: new Date(NOW).toISOString(), organic: [{ rank: 1, url: "https://own.com/p", domain: "own.com", title: null }, { rank: 2, url: "https://a.com/x", domain: "a.com", title: "A" }], aiOverview: [{ url: "https://b.com/y", domain: "b.com", title: null }] }];
    const cite = { url: "https://b.com/y", domain: "b.com", title: null }; // the SAME citation seen through both ChatGPT modes
    s.prompts.pairs = (["standardized_response", "consumer_search"] as const).map((mode) => ({ promptId: "pr", promptText: "best persian restaurant", engine: "chatgpt" as const, mode, cacheKey: null, status: "done" as const, observedAt: new Date(NOW).toISOString(), modelServed: "gpt-4o", citationsObserved: true, citations: [cite] }));
    const store = memStore(s); let fetchCalls = 0; const out = await winningPagesUnit({ ...store.deps, loadProfile: async () => emptyBusinessProfile("tw"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => NOW,
      readPageExtract: async () => ({ extract: { title: "CACHED", h1: null, wordCount: 5, headings: [], faqCount: 0 }, contentHash: "h", fetchedAt: "x" }),
      fetchPage: (async () => { fetchCalls += 1; return { ok: false, reason: "robots_blocked" }; }) as unknown as FunnelDeps["fetchPage"] })("tw", cur(), 60_000); expect(out.status).toBe("advanced"); expect(fetchCalls).toBe(0); // the winners are in and the run is handed back; cached extract reused before any fetch
    const win = store.peek("tw", BASIS)!.winningPages; expect(win.map((w) => w.domain)).not.toContain("own.com"); expect(win[0]!.domain).toBe("b.com"); expect(win[0]!.engines).toEqual(["chatgpt"]); // AI-cited (x2) outweighs organic; its OWN appearances only
    expect(win[0]!.examplePrompts).toEqual(["best persian restaurant"]); expect(win[0]!.extract!.title).toBe("CACHED"); // real text, never the id
    const answers = win[0]!.appearances.filter((a) => a.kind === "ai_answer"); expect(answers.map((a) => a.observationMode)).toEqual(["consumer_search"]); // one citation, two modes: credited ONCE to the consumer look, never double-counted
    expect([win[0]!.extract!.openingSample, win[0]!.extract!.hasList]).toEqual([null, undefined]); // an extract persisted before the richer fields still loads: absent, never a fake zero
  });
  it("reserves each priority search THREE DISTINCT PUBLISHERS, admits ONE substitute only for the search whose own page was unreadable, and never exceeds eighteen page attempts", async () => { const s = emptyFunnelState("tw", BASIS); const at = new Date(NOW).toISOString(); const PRIORITY = ["iranian actors", "iranian films", "iranian food"]; const q = (query: string, hosts: string[]) => ({ query, cacheKey: null, status: "done" as const, observedAt: at, organic: hosts.map((h, i) => ({ rank: i + 1, url: `https://${h}/p`, domain: h, title: null })) });
    s.serps.queries = [q(PRIORITY[0]!, ["en.wikipedia.org", "simple.wikipedia.org", "b.com", "c.com", "d.com"]), q(PRIORITY[1]!, ["f1.com", "f2.com", "f3.com", "f4.com", "f5.com"]), q(PRIORITY[2]!, ["g1.com", "g2.com", "g3.com", "g4.com", "g5.com"])]; s.prompts.pairs = Array.from({ length: 18 }, (_, i) => ({ promptId: `pr${i}`, promptText: "q", engine: "chatgpt" as const, mode: "consumer_search" as const, cacheKey: null, status: "done" as const, observedAt: at, citationsObserved: true, citations: [{ url: `https://ai${i}.com/p`, domain: `ai${i}.com`, title: null }] }));
    const run = async (priority: string[], unreadable: RegExp) => { const st = memStore(s); const tried: string[] = []; // tried = every page I actually went out and read, in the order I read them
      await winningPagesUnit({ ...st.deps, loadProfile: async () => emptyBusinessProfile("tw"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => NOW, parse, readPageExtract: async () => null, writePageExtract: async () => {}, fetchPage: (async (url: string) => { tried.push(url); return unreadable.test(url) ? { ok: false, reason: "robots_blocked" } : { ok: true, html: "<html><body><h1>H</h1><p>real words on this page</p></body></html>", status: 200 }; }) as unknown as FunnelDeps["fetchPage"] }, priority)("tw", cur(), 60_000); return { tried, urls: st.peek("tw", BASIS)!.winningPages.map((w) => w.url) }; };
    const none = await run([], /never/); expect([none.urls.some((u) => /wikipedia|f\d|g\d/.test(u)), none.tried.every((u) => u.includes("ai"))]).toEqual([false, true]); // THE STARVATION PIN: on global weight alone, eighteen AI-cited pages outrank every page these three cases need and not ONE of them is banked
    const all = await run(PRIORITY, /wikipedia|[bcd]\.com|[fg]\d/); expect([all.tried.slice(0, 3), all.tried.slice(9, 12)]).toEqual([["https://en.wikipedia.org/p", "https://f1.com/p", "https://g1.com/p"], ["https://d.com/p", "https://f4.com/p", "https://g4.com/p"]]); // named, each case keeps ONE reserve slot per publisher (the second wikipedia page never eats the third opinion's slot) and the reserves are read ROUND BY ROUND, so every case's first winner lands before any case's second; FOCUS COMES BEFORE BREADTH, so their substitutes are read before any exploration page
    expect([all.tried.length, all.tried.slice(12).every((u) => u.includes("ai")), all.urls.some((u) => /f5|g5|simple/.test(u))]).toEqual([18, true, false]); // 20 pages were ranked and 18 attempts is the WHOLE acquisition budget; one failure buys exactly ONE substitute, so the rest of every bench stays shut
    expect(["b", "c", "f2", "f3", "g2", "g3"].every((h) => all.tried.some((u) => u.includes(`${h}.com/`)))).toBe(true); // every case's full three-publisher reserve is read, and the global fill takes only what is left over
    const one = await run(PRIORITY, /wikipedia/); expect([one.tried.length, one.tried.includes("https://d.com/p"), one.tried.some((u) => /f4|f5|g4|g5/.test(u))]).toEqual([16, true, false]); }); // only the search whose own page was unreadable spends a substitution: an unrelated search's bench stays shut
  it("spends the SIX paid body reads round by round, so a third case is never handed nothing because the first two spent them all", async () => { const s = emptyFunnelState("tw", BASIS); const at = new Date(NOW).toISOString(); const PRIORITY = ["case one", "case two", "case three"];
    const q = (query: string, hosts: string[]) => ({ query, cacheKey: null, status: "done" as const, observedAt: at, organic: hosts.map((h, i) => ({ rank: i + 1, url: `https://${h}/p`, domain: h, title: null })) });
    s.serps.queries = [q(PRIORITY[0]!, ["a1.com", "a2.com", "a3.com"]), q(PRIORITY[1]!, ["b1.com", "b2.com", "b3.com"]), q(PRIORITY[2]!, ["c1.com", "c2.com", "c3.com"])];
    const st = memStore(s); const paid: string[] = []; const body = { title: "T", h1: "H", wordCount: 5, headings: [], faqCount: 0 };
    await winningPagesUnit({ ...st.deps, loadProfile: async () => emptyBusinessProfile("tw"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => NOW, parse, readPageExtract: async () => null, writePageExtract: async () => {},
      callProvider: (async (cap: CapabilityKey, input: { url: string }) => { if (cap !== "onpage_content_parsing") return ok(serp([])); paid.push(input.url); return ok(body); }) as FunnelDeps["callProvider"],
      fetchPage: (async () => ({ ok: false, reason: "fetch_failed" })) as unknown as FunnelDeps["fetchPage"] }, PRIORITY)("tw", cur(), 60_000);
    expect([paid.length, ["a", "b", "c"].map((p) => paid.filter((u) => u.startsWith(`https://${p}`)).length)]).toEqual([6, [2, 2, 2]]); }); // read case by case, the first two cases took all six and the third got none; in rounds every case is served the same two
  it("never bypasses a robots denial, pays for at most ONE read of a body per URL and SIX in a cycle, banks the CONTENT it parsed and never the address, and repeats a cycle for free", async () => { const at = new Date(NOW).toISOString(); const s = emptyFunnelState("tr", BASIS); const PROV = "2026-01-01T00:00:00.000Z"; const u = (h: string) => `https://${h}/p`;
    s.serps.queries = [{ query: "iran leader", cacheKey: null, status: "done", observedAt: at, organic: ["no.com", "h2.com", "h3.com", "h4.com", "h5.com", "h6.com", "h7.com", "h8.com", "h9.com"].map((h, i) => ({ rank: i + 1, url: u(h), domain: h, title: null })) }]; const st = memStore(s); const banked = new Map<string, { extract: Record<string, unknown>; hash: string }>(); let reads = 0; const paid: string[] = []; const full = { title: "T", h1: "H", wordCount: 5, headings: [], faqCount: 0 };
    const body = (url: string) => url.includes("h3") ? { h1: "H", faqCount: 0, headings: [], title: "T", wordCount: 5 } : url.includes("h4") ? { ...full, title: "CHANGED" } : url.includes("h6") ? { ...full, fetchedAt: PROV } : url.includes("h7") ? { ...full, wordCount: 0 } : full; // the same body in another key order, a changed title, the provider's own fetch time, and no words at all
    const deps = (): FunnelDeps => ({ ...st.deps, loadProfile: async () => emptyBusinessProfile("tr"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => NOW, parse, readPageExtract: async (url: string) => { const r = banked.get(url); return r ? { extract: r.extract, contentHash: r.hash, fetchedAt: at } : null; }, writePageExtract: async (url: string, extract: Record<string, unknown>, hash: string) => { banked.set(url, { extract, hash }); },
      callProvider: (async (cap: CapabilityKey, input: { url: string }) => { if (cap !== "onpage_content_parsing") return ok(serp([])); paid.push(input.url); return ok(body(input.url)); }) as FunnelDeps["callProvider"], fetchPage: (async (url: string) => { reads += 1; return { ok: false, reason: url.includes("no.com") ? "robots_blocked" : "fetch_failed" }; }) as unknown as FunnelDeps["fetchPage"] });
    await winningPagesUnit(deps(), ["iran leader"])("tr", cur(), 60_000); const row = (h: string) => st.peek("tr", BASIS)!.winningPages.find((w) => w.url === u(h))!;
    expect([paid, ["no.com", "h7.com", "h9.com"].map((h) => [row(h).extract, row(h).readOutcome!.state])]).toEqual([["h2.com", "h3.com", "h4.com", "h6.com", "h7.com", "h8.com"].map(u), [[null, "robots_blocked"], [null, "provider_unavailable"], [null, "temporarily_unavailable"]]]); // a robots denial is NEVER sent through the provider, an ordinary refusal earns exactly ONE paid read and the sixth is the last a cycle buys; the ranked URL survives either way and a denial, an empty parse and a spent ceiling are each named honestly
    expect([banked.get(u("h3.com"))!.hash, banked.get(u("h6.com"))!.hash, banked.get(u("h4.com"))!.hash === banked.get(u("h2.com"))!.hash, row("h6.com").extract!.fetchedAt]).toEqual([banked.get(u("h2.com"))!.hash, banked.get(u("h2.com"))!.hash, false, PROV]); // key order and fetch time are not content; changed words ARE; and the provider's own fetch time is kept, never invented
    await winningPagesUnit(deps(), ["iran leader"])("tr", cur(), 60_000); expect([reads, paid.length]).toEqual([8, 6]); }); // the same evidence a second time: every body I hold is served from what I banked, zero duplicate provider calls
  // ── the ONE paid page-by-page comparison the winners earn ──
  const OWN = "https://own.com/p", W1 = "https://a.com/x", W2 = "https://b.com/g", ASK = { topicKey: "t1", ask: { pages: [W2, W1], exclude_pages: [OWN] } };
  const answer = { status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [{ keyword_data: { keyword: "k", keyword_info: { search_volume: 9 } }, intersection_result: { "1": { url: W1, title: "t", rank_group: 3, rank_absolute: 6 } } }] }] }] };
  const cmpSeed = () => { const s = emptyFunnelState("tx", BASIS); s.serps.queries = [{ query: "q", cacheKey: null, status: "done", observedAt: new Date(NOW).toISOString(), organic: [{ rank: 1, url: W1, domain: "a.com", title: null }] }]; return s; };
  const cmpDeps = (st: ReturnType<typeof memStore>, callProvider: FunnelDeps["callProvider"], over: Partial<FunnelDeps> = {}): FunnelDeps => ({ ...st.deps, loadProfile: async () => emptyBusinessProfile("tx"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => NOW, parse, readPageExtract: async () => null, fetchPage: (async () => ({ ok: false, reason: "robots_blocked" })) as unknown as FunnelDeps["fetchPage"], callProvider, ...over });
  const CMP = { ...cur(), stage: "compare" }; // stage TWO: the winners are already saved and the caller renewed the RUN lease in between
  it("buys ONE comparison for the WHOLE page set, never buys a landed one twice, and a resumed crash costs nothing", async () => { const asks: unknown[] = [];
    const call = (async (cap: CapabilityKey, input: unknown) => { if (cap !== "labs_page_intersection") return ok(serp([])); asks.push(input); return asks.length > 1 ? { state: "hit", envelope: answer, costUsd: 0, cacheKey: "ck-pi", modelServed: null } as CachedCallResult : ok(answer, "ck-pi"); }) as FunnelDeps["callProvider"];
    const st = memStore(cmpSeed()); const winners = await winningPagesUnit(cmpDeps(st, call), [], ASK)("tx", cur(), 60_000);
    expect([winners.status, winners.cursor, asks.length]).toEqual(["advanced", { stage: "compare" }, 0]); // stage one banks the winners and spends NOTHING; the purchase waits for a renewed lease
    const r1 = await winningPagesUnit(cmpDeps(st, call), [], ASK)("tx", { ...cur(), ...winners.cursor }, 60_000); const held = st.peek("tx", BASIS)!.pageComparisons;
    expect([r1.status, asks.length, asks[0]]).toEqual(["done", 1, { pages: [W1, W2], exclude_pages: [OWN], intersection_mode: "union", limit: 100 }]); // ONE request carries every page, normalized: a call per page or per keyword is a defect
    expect([held.length, held[0]!.topicKey, held[0]!.unavailable, held[0]!.receipt, held[0]!.comparison!.pages, held[0]!.comparison!.keywords[0]!.ranks]).toEqual([1, "t1", null, "ck-pi", [{ page: 1, url: W1 }, { page: 2, url: W2 }], [{ page: 1, url: W1, title: "t", rank: 3 }]]); // parsed WITH the ask, so the slot NAMES its page; rank_group, never rank_absolute
    const round = JSON.parse(JSON.stringify(st.peek("tx", BASIS)!)) as FunnelState; expect(round.pageComparisons[0]!.askKey).toBe(held[0]!.askKey); // survives storage unchanged
    await winningPagesUnit(cmpDeps(memStore(round), call), [], { topicKey: "t1", ask: { pages: [W1, W2, W1], exclude_pages: [OWN], intersection_mode: "union" as const, limit: 100 } })("tx", CMP, 60_000);
    expect(asks.length).toBe(1); // a reorder, a duplicate and a spelled-out default are the SAME ask: the landed answer is reused and nothing is re-bought
    await winningPagesUnit(cmpDeps(memStore(round), call), [], { topicKey: "t2", ask: ASK.ask })("tx", CMP, 60_000); // another topic never inherits this one's answer
    await winningPagesUnit(cmpDeps(memStore(round), call), [], { topicKey: "t1", ask: { pages: [W2, "https://c.com/z"] } })("tx", CMP, 60_000); expect(asks.length).toBe(3); // a different page set is a different question
    const crashed = memStore(cmpSeed()); const spent = await winningPagesUnit(cmpDeps(crashed, call), [], ASK)("tx", CMP, 60_000); // the crash lost the row, so the phase asks again
    expect([spent.progress.spendUsd, crashed.peek("tx", BASIS)!.cycle.cacheHits]).toEqual([0, 1]); }); // the money core serves the SAME identity warm: zero network, zero new spend
  it("persists a refusal, a ceiling, a wait and an unreadable answer as honest gaps, spends nothing on a lost lease, and refuses a set of one", async () => {
    const cases: [CachedCallResult, string][] = [[err("blocked"), "blocked"], [err("daily_limit"), "capped"], [{ state: "capped", cacheKey: null, detail: "ceiling" }, "capped"], [waiting("ck-pi"), "waiting"], [err("quarantined"), "quarantined"], [err("retry_free"), "ambiguous"], [err("none"), "failed"], [{ state: "not_configured", cacheKey: null, detail: "off" }, "failed"]];
    for (const [result, unavailable] of cases) { const st = memStore(cmpSeed());
      const out = await winningPagesUnit(cmpDeps(st, (async (cap: CapabilityKey) => (cap === "labs_page_intersection" ? result : ok(serp([])))) as FunnelDeps["callProvider"]), [], ASK)("tx", CMP, 60_000);
      const row = st.peek("tx", BASIS)!.pageComparisons[0]!; expect([out.status, row.comparison, row.unavailable, row.pages]).toEqual(["done", null, unavailable, [W1, W2]]); } // the winners are still in; the comparison names its own gap and never reads as a finding
    const unread = memStore(cmpSeed()); await winningPagesUnit(cmpDeps(unread, (async (cap: CapabilityKey) => (cap === "labs_page_intersection" ? ok(null, "ck-pi") : ok(serp([])))) as FunnelDeps["callProvider"]), [], ASK)("tx", CMP, 60_000);
    expect(unread.peek("tx", BASIS)!.pageComparisons[0]!.unavailable).toBe("ambiguous"); // an answer I cannot read is not zero shared searches
    let calls = 0; const count = (async (cap: CapabilityKey) => { if (cap === "labs_page_intersection") calls += 1; return ok(serp([])); }) as FunnelDeps["callProvider"];
    const lost = await winningPagesUnit(cmpDeps(memStore(cmpSeed()), count, { saveState: async () => null }), [], ASK)("tx", cur(), 60_000);
    expect([lost.status, lost.code, calls]).toEqual(["failed", "state_conflict", 0]); // a concurrent writer moved the research row: the winners never land, so the comparison stage is never reached
    const one = memStore(cmpSeed()); await winningPagesUnit(cmpDeps(one, count), [], { topicKey: "t1", ask: { pages: [W1] } })("tx", CMP, 60_000);
    expect([calls, one.peek("tx", BASIS)!.pageComparisons]).toEqual([0, []]); }); // one page is not a comparison: refused before the money, and nothing stored
});
describe("research funnel - the ONE page of the account's OWN a run may read", () => {
  const U = "own.com/nowruz", ABS = `https://${U}`, DAY = 86_400_000, at = (ms: number) => new Date(ms).toISOString();
  const page = { ok: true, html: "<html><body><h1>Nowruz</h1><p>How a nowruz table is set out.</p></body></html>", status: 200 };
  const seeded = (ownedReads: FunnelState["ownedReads"]) => { const s = emptyFunnelState("to", BASIS); s.ownedReads = ownedReads; return memStore(s); };
  const hold = (url: string, state: "robots_blocked" | "temporarily_unavailable", ms: number) => ({ url, state, attemptedAt: at(NOW), retryAfter: at(NOW + ms) });
  /** ONE stage-one pass with no winners at all, so the only page work it can do is the owned read under test. `bodies` IS the canonical page_snapshots row: the
   *  snapshot write lands in it and the read-before-fetch reads it back, so a body I persisted a moment ago is a body I hold, not a page I have to fetch again. */
  const run = async (store: ReturnType<typeof memStore>, now: number, answer: unknown, ownedUrl: string | null = U, tenant = "to", over: Partial<FunnelDeps> = {}, bodies = new Map<string, { fetchedAt: string }>()) => {
    const tried: string[] = [], saved: string[][] = [], paid: string[] = [];
    const out = await winningPagesUnit({ ...store.deps, loadProfile: async () => emptyBusinessProfile(tenant), getAccount: async () => ({ domain: "own.com" } as Account), now: () => now, parse, readPageExtract: async () => null,
      callProvider: (async (cap: CapabilityKey) => { paid.push(cap); return ok(serp([])); }) as FunnelDeps["callProvider"],
      fetchPage: (async (url: string) => { tried.push(url); return answer; }) as unknown as FunnelDeps["fetchPage"], readOwnedBodies: (async () => bodies) as unknown as FunnelDeps["readOwnedBodies"],
      writeOwnedPage: async (snap, t) => { saved.push([snap.id, snap.url, t]); bodies.set(canonicalUrlKey(snap.url), { fetchedAt: at(now) }); }, ...over }, [], null, ownedUrl)(tenant, cur(), 60_000);
    return { out, tried, saved, paid, held: store.peek(tenant, BASIS)!.ownedReads }; };
  it("reads the named page ONCE, persists the page snapshot itself, never pays a provider for it, and clears what stopped me last time", async () => {
    const store = seeded([{ url: U, state: "temporarily_unavailable", attemptedAt: at(NOW - 2 * DAY), retryAfter: at(NOW - DAY) }]); const r = await run(store, NOW, page);
    expect([r.tried, r.saved.map((s) => s.slice(1)), r.held, r.paid]).toEqual([[ABS], [[ABS, "to"]], [], []]); // one read, the canonical snapshot under my own tenant, the memory cleared, and the customer's own page never sent to a provider
    expect((await run(store, NOW, page, null)).tried).toEqual([]); }); // no page named, no page read
  it("counts a page I just saved as read: a conflict on the research row sends the retry to the body I persisted, never back out to the website", async () => {
    const store = seeded([]), bodies = new Map<string, { fetchedAt: string }>();
    const first = await run(store, NOW, page, U, "to", { saveState: async () => null }, bodies); // the snapshot landed; the funnel row moved underneath the save
    expect([first.out.status, first.out.code, first.tried, [...bodies.keys()]]).toEqual(["failed", "state_conflict", [ABS], [U]]);
    const second = await run(store, NOW + 1000, page, U, "to", {}, bodies); // Runtime re-invokes the SAME phase
    expect([second.out.status, second.tried, second.held]).toEqual(["advanced", [], []]); }); // ONE website fetch across both passes, and no failure hold for a page I can read
  it("a page I could not SAVE is not a page I read: the phase pauses in my own words and that URL still earns a date, so a broken write cannot refetch it every visit", async () => {
    const prior = { url: U, state: "temporarily_unavailable" as const, attemptedAt: at(NOW - 2 * DAY), retryAfter: at(NOW - DAY) };
    const r = await run(seeded([prior]), NOW, page, U, "to", { writeOwnedPage: async () => { throw new Error("the row was rejected"); } });
    expect([r.out.status, r.out.cursor, r.tried, r.held.map((o) => [o.url, o.state, o.retryAfter])]).toEqual(["failed", null, [ABS], [[U, "temporarily_unavailable", at(NOW + DAY)]]]); // never a robots denial, never "your page did not answer", and never a clean slate
    expect(r.out.detail).toBe("I read your page but I could not save what it says, so I am not counting it as read yet. I will read it again on your next visit.");
    const amb = seeded([]), bodies = new Map<string, { fetchedAt: string }>(); // the row DID land and the write's own answer was lost
    const one = await run(amb, NOW, page, U, "to", { writeOwnedPage: async (snap) => { bodies.set(canonicalUrlKey(snap.url), { fetchedAt: at(NOW) }); throw new Error("timed out"); } }, bodies);
    const two = await run(amb, NOW + DAY + 1000, page, U, "to", {}, bodies); // a day later, past the hold, so it is READ-BEFORE-FETCH doing the work and not the date
    expect([one.out.status, one.tried.length, two.out.status, two.tried, two.held]).toEqual(["failed", 1, "advanced", [], []]); }); // the body I persisted IS the read: still exactly ONE fetch
  it("honors my own site's robots rules for a month, never lets newer failures crowd that promise out, and never holds another account or basis to it", async () => {
    const store = memStore(); const shut = await run(store, NOW, { ok: false, reason: "robots_blocked" });
    expect(shut.held.map((o) => [o.state, o.retryAfter])).toEqual([["robots_blocked", at(NOW + 30 * DAY)]]);
    expect((await run(store, NOW + 29 * DAY, page)).tried).toEqual([]); expect((await run(store, NOW + 31 * DAY, page)).tried).toEqual([ABS]); // one month held, then exactly one new attempt
    const day = Array.from({ length: 9 }, (_, i) => hold(`own.com/x${i}`, "temporarily_unavailable", DAY)), month = hold(U, "robots_blocked", 30 * DAY);
    const full = seeded([...day, month]); // every slot in the bounded memory is a live promise
    for (const u of ["own.com/n1", "own.com/n2", "own.com/n3"]) expect((await run(full, NOW + 1000, page, u)).tried).toEqual([]); // FAIL CLOSED: never a read whose failure I could not remember
    expect([full.peek("to", BASIS)!.ownedReads.length, (await run(full, NOW + 1000, page, U)).tried]).toEqual([10, []]); // the month-long promise is still on file, and still unfetched
    const room = await run(seeded([...day, month]), NOW + DAY + 1, page, "own.com/n1"); // a day later the nine day-holds are memory of nothing
    expect([room.tried, room.held]).toEqual([["https://own.com/n1"], [month]]); // expired rows pruned, room made, and the month-long hold survived
    expect((await run(memStore(), NOW, { ok: false, reason: "fetch_failed" }, U, "tb")).tried).toEqual([ABS]); }); // another account is never held by my refusal
  it("remembers a page that did not answer for a day, spends nothing inside it, keeps the SAME date, and allows exactly ONE more attempt when it expires", async () => {
    const store = memStore(emptyFunnelState("to", BASIS)); const first = await run(store, NOW, { ok: false, reason: "fetch_failed" });
    expect([first.tried.length, first.held.map((o) => [o.state, o.retryAfter])]).toEqual([1, [["temporarily_unavailable", at(NOW + DAY)]]]);
    const inside = await run(store, NOW + DAY - 1, page); expect([inside.tried, inside.held[0]!.retryAfter]).toEqual([[], at(NOW + DAY)]); // no fetch, and the date I promised did not slide
    const due = await run(store, NOW + DAY + 1, { ok: false, reason: "fetch_failed" }); expect([due.tried.length, due.held[0]!.retryAfter]).toEqual([1, at(NOW + 2 * DAY + 1)]); // one new attempt, one new honest date
    expect([store.peek("tb", BASIS), store.peek("to", "basis_other")]).toEqual([undefined, undefined]); }); // never another account's row, never another basis
});
describe("evidence - my own page's actual words, read narrowly", () => {
  const row = (over: Record<string, unknown> = {}) => ({ url: "https://own.com/actors", title: "T", meta_description: "M", fetched_at: "2026-06-11T00:00:00.000Z", body_paragraph_sample: ["Iran has a deep film history."], card_texts: ["Card"], schema_entity_names: ["Person"], internal_links: [{ href: "/a", anchor_text: "A" }], ...over });
  beforeEach(() => { sb.rows = []; sb.fails = false; sb.tenant = ""; sb.urls = []; });
  it("reads only the asked tenant and the asked URLs, refuses a wider ask instead of fanning out, and fails closed to no bodies", async () => { sb.rows = [row(), row({ url: "https://own.com/other" })];
    const got = await loadOwnedPageBodies("t1", ["https://own.com/actors"]);
    expect([sb.tenant, sb.urls.includes("https://own.com/actors")]).toEqual(["t1", true]); // tenant AND url scoped in the query itself, never filtered after a wide read
    expect([...got.keys()]).toEqual(["own.com/actors"]); expect(got.get("own.com/actors")!.openingSample).toContain("deep film history"); // a page I did not ask about is never keyed in
    expect((await loadOwnedPageBodies("t1", ["a", "b", "c", "d"])).size).toBe(0); // four is past the bound: refused, never fanned out
    sb.fails = true; expect((await loadOwnedPageBodies("t1", ["https://own.com/actors"])).size).toBe(0); // a broken read is never an empty page
    sb.fails = false; sb.rows = [row()]; const two = await loadOwnedPageBodies("t1", ["https://own.com/actors", "https://own.com/missing"]);
    expect([two.size, two.has("own.com/missing"), two.get("own.com/actors")!.fetchedAt]).toEqual([1, false, "2026-06-11T00:00:00.000Z"]); }); // no snapshot, no body; the date rides along so the caller can judge staleness
  it("never passes headings off as body text", async () => { sb.rows = [row({ body_paragraph_sample: undefined, h2_list: ["Famous Actors"], card_texts: ["Golshifteh Farahani"] })];
    const body = (await loadOwnedPageBodies("t1", ["https://own.com/actors"])).get("own.com/actors")!;
    expect([body.openingSample, body.cardTexts]).toEqual([null, ["Golshifteh Farahani"]]); }); // no body text on file is said plainly, never filled in from labels
});
describe("research funnel - the SERP agenda buys my own words, never a lookalike", () => {
  // A GENERIC reference site: no vertical token is privileged anywhere in the gate.
  const THEMES = ["baby names", "flag history", "national holidays", "given name origins"];
  const BIG = ["celebrity gossip today", "movie trailer news", "sports scores live", "weather forecast tomorrow", "stock market today"]; // huge volume, no theme of mine
  const THEMED: [string, number][] = [["female baby names", 900], ["baby names 2026", 800], ["flag history timeline", 700], ["national holidays calendar", 600], ["given name origins guide", 500], ["political revolution 1979", 400], ["national flag history", 300]];
  const kw = (keyword: string, searchVolume: number, over: Partial<FunnelKeyword> = {}): FunnelKeyword => ({ keyword, searchVolume, competition: null, difficulty: null, intent: null, discoveredVia: "site", ...over });
  const retained = [...BIG.map((k, i) => kw(k, 400_000 - i * 10_000)), ...THEMED.map(([k, v]) => kw(k, v))]; type Agenda = Parameters<typeof selectSerpAgenda>[0];
  const agenda = (over: Partial<Agenda>, cap: number) => selectSerpAgenda({ retained, themes: THEMES, prompts: [], pageQueries: [], ...over }, cap);
  it("buys my own page's query EXACTLY, even when I never researched it, and never swaps in a lookalike", () => { const out = agenda({ pageQueries: [{ query: "boys baby names", impressions: 900 }, { query: "national flag 1979", impressions: 800 }] }, 2);
    expect(out.queries).toEqual(["boys baby names", "national flag 1979"]); // a first-party query needs no researched twin: the search call takes any keyword string
    expect(retained.some((r) => out.queries.includes(r.keyword))).toBe(false); }); // "female baby names" and "political revolution 1979" sat right there and were NOT substituted in
  it("checks a tracked question through its observed fan-out, else through its own approved words", () => {
    expect(agenda({ prompts: [{ text: "what are popular baby names", fanOutQueries: ["most popular baby names 2026"] }, { text: "which flags changed in 1979" }] }, 2).queries).toEqual(["most popular baby names 2026", "which flags changed in 1979"]); });
  it("skips a query the provider would refuse instead of truncating it into a different question", () => { const long = "a".repeat(701);
    const out = agenda({ pageQueries: [{ query: long, impressions: 900 }, { query: "boys baby names", impressions: 10 }] }, 1);
    expect(out.queries).toEqual(["boys baby names"]); expect(out.skipped).toEqual([{ query: long, reason: "over_provider_keyword_length" }]); });
  it("gives every theme a real query, names the one it cannot defend, and bounds exploration at eight", () => { const out = agenda({ themes: [...THEMES, "septic tank inspection"] }, 8);
    expect(out.queries.slice(0, 4)).toEqual(["female baby names", "flag history timeline", "given name origins guide", "national holidays calendar"]);
    expect(out.uncoveredThemes).toEqual(["septic tank inspection"]); expect(out.queries.some((q) => q.includes("septic"))).toBe(false); // named, never faked
    expect(agenda({ themes: [] }, 40).queries).toHaveLength(8); }); // nothing trusted to check: a SHORTER agenda, never forty slots of padding
  it("buys the searches an open question is stuck on FIRST, verbatim, and never more than three", () => {
    const out = agenda({ priorityQueries: ["national flag 1979", "boys baby names", "given name origins", "septic tank inspection"], pageQueries: [{ query: "female baby names", impressions: 9000 }] }, 8);
    expect(out.queries.slice(0, 3)).toEqual(["national flag 1979", "boys baby names", "given name origins"]); // the caller's own ranking, ahead of a 9,000-view first-party query
    expect(out.queries).not.toContain("septic tank inspection"); expect(out.queries[3]).toBe("female baby names"); // a fourth is not a priority, and nothing trusted was displaced
    expect(JSON.stringify(agenda({ priorityQueries: ["boys baby names", "boys names baby"] }, 8).queries.slice(0, 2))).toBe(JSON.stringify(["boys baby names", "female baby names"])); }); // one subject, ONE paid slot
  it("produces the same agenda from the same inputs in any array order", () => { const full: Agenda = { retained, themes: THEMES, prompts: [{ text: "what are popular baby names", fanOutQueries: ["most popular baby names 2026", "baby names by decade"] }], pageQueries: [{ query: "boys baby names", impressions: 100, declining: true }, { query: "national flag 1979", impressions: 900 }] };
    const rev: Agenda = { retained: [...retained].reverse(), themes: [...THEMES].reverse(), prompts: [...full.prompts].reverse(), pageQueries: [...full.pageQueries].reverse() };
    expect(JSON.stringify(selectSerpAgenda(rev, 10))).toBe(JSON.stringify(selectSerpAgenda(full, 10))); });
  it("retains with SOURCE diversity, so one broad pull cannot evict every seed's discovery", () => { const site = Array.from({ length: 10 }, (_, i) => kw(`site keyword ${i}`, 9000 - i));
    const seeded = ["alpha", "beta"].map((s) => kw(`${s} niche keyword`, 10, { discoveredVia: "related", seed: s })); const out = retainDiverse([...site, ...seeded], 4).map((k) => k.keyword);
    expect(out).toEqual(["alpha niche keyword", "beta niche keyword", "site keyword 0", "site keyword 1"]); expect(retainDiverse([...seeded, ...site].reverse(), 4).map((k) => k.keyword)).toEqual(out); // volume alone kept only the broad pull
    expect([MAX_RETAINED, retainDiverse(Array.from({ length: 1800 }, (_, i) => kw(`k${i}`, i)), MAX_RETAINED).length]).toEqual([1400, 1400]); }); // TWO full enrichment requests, not one request's worth
  it("seeds discovery from EVERY confirmed theme, bounded at twelve, and prices the retained set in ONE bounded request", async () => { const store = memStore(); const topics = Array.from({ length: 15 }, (_, i) => `gadget topic ${String(i).padStart(2, "0")}`);
    const wordy = `gadget ${Array.from({ length: 11 }, (_, i) => `w${i}`).join(" ")}`, long = `gadget ${"x".repeat(80)}`; let batch: string[] = []; const found = parsedKw([{ keyword: "gadget topic 00 review" }, { keyword: wordy }, { keyword: long }]);
    await keywordDiscoveryUnit({ ...base(profileOf("td", [], topics)), ...store.deps, callProvider: async (cap: CapabilityKey, input: unknown) => { if (cap === "labs_keyword_overview") batch = (input as { keywords: string[] }).keywords; return ok(cap === "labs_keywords_for_site" ? found : parsedKw([])); } })("td", cur(), 60_000);
    expect(store.peek("td", BASIS)!.discovery.seeds).toEqual(topics.slice(0, 12)); // the old five-seed truncation starved every theme after the fifth
    expect(batch).toEqual(["gadget topic 00 review"]); }); // over 80 characters or over 10 words: dropped BEFORE the batch, never truncated into a different keyword
});
describe("research funnel - the CASE-SCOPED keyword universe", () => {
  const CASE = "inv_canon", ABSORBED = "inv_old", at = new Date(NOW).toISOString();
  const ranked = (rows: [string, string, number][]): ParsedKeywordItem[] => rows.map(([keyword, rankedUrl, rankedRank]) => ({ ...parsedKw([{ keyword }])[0]!, rankedUrl, rankedRank }));
  /** A tenant that has already looked at one results page and asked one question: every candidate below is
   *  evidence the account paid for once and used to throw away. */
  const observed = (): FunnelState => { const s = emptyFunnelState("tc", BASIS);
    s.cases = [{ id: CASE, anchors: [canonicalQueryKey("price saffron")] }, { id: ABSORBED, anchors: [], aliasOf: CASE }];
    s.serps.queries = [{ query: "price saffron", cacheKey: "ck-serp", status: "done", observedAt: at, paa: [{ question: "How much does saffron cost per gram", answeringDomain: null }], related: ["saffron grades"] }];
    s.prompts.pairs = [{ promptId: "p1", promptText: "where to buy saffron", engine: "chatgpt", mode: "consumer_search", cacheKey: null, status: "done", observedAt: at, fanOutQueries: ["best saffron brands"] }];
    return s; };
  const PLAN = [{ caseId: ABSORBED, query: "where to buy saffron" }]; // the plan names an id a merge already absorbed
  const disc = (store: ReturnType<typeof memStore>, over: Partial<FunnelDeps> = {}, plan = PLAN) => keywordDiscoveryUnit({
    ...base(profileOf("tc", ["saffron"], ["saffron price"])), ...store.deps, keywordIdeas: async () => [], loadPageQueries: async () => [{ query: "saffron benefits", impressions: 90 }],
    loadAnswerAnalyses: async () => [{ analysis: { topicEntities: ["iranian saffron"], questionsAnswered: ["does saffron expire"] }, observationId: "obs_a", promptId: "p1", promptVersion: 1, engine: "chatgpt", reportingDay: DAY_A, promptText: "where to buy saffron" }],
    // The last two rows are ONE page of mine reported twice for one search: rows, not pages.
    callProvider: async (cap: CapabilityKey) => ok(cap === "labs_ranked_keywords" ? ranked([["price saffron", "https://own.com/a", 4], ["price saffron", "https://own.com/b", 9], ["saffron threads", "https://own.com/t", 7], ["saffron threads", "https://own.com/t", 2]]) : parsedKw([])), ...over }, plan)("tc", cur(), 60_000);
  it("takes every source the account already observed, tagged with the route it actually arrived by, and never buys one subject twice", async () => {
    const store = memStore(observed()); let batch: string[] = [];
    const out = await disc(store, { callProvider: async (cap: CapabilityKey, input: unknown) => { if (cap === "labs_keyword_overview") batch = (input as { keywords: string[] }).keywords;
      return ok(cap === "labs_ranked_keywords" ? ranked([["price saffron", "https://own.com/a", 4]]) : parsedKw([])); } });
    expect(out.status).toBe("done"); const held = new Map(store.peek("tc", BASIS)!.discovery.retained.map((k) => [k.keyword, k.discoveredVia]));
    expect([held.get("how much does saffron cost per gram"), held.get("saffron grades"), held.get("where to buy saffron"), held.get("best saffron brands"), held.get("saffron benefits"), held.get("iranian saffron"), held.get("does saffron expire")])
      .toEqual(["paa", "related_search", "prompt", "fanout", "gsc", "answer_entity", "answer_entity"]); // the questions on my results page, the searches the engines ran, my own Search Console rows and the entities my answers named
    expect(held.get("price saffron")).toBe("ranked"); // one subject, ONE row: the richest source wins the merge
    expect(batch.filter((k) => k === "price saffron" || k === "saffron price").length).toBe(1); }); // deduped BEFORE the purchase, so a reordered variant is never priced twice
  it("files a keyword under the case that answers for it now, even when the plan named an id a merge absorbed", async () => {
    const store = memStore(observed()); await disc(store);
    const rows = new Map(store.peek("tc", BASIS)!.discovery.retained.map((k) => [k.keyword, k.caseId ?? null]));
    expect([rows.get("price saffron"), rows.get("where to buy saffron"), rows.get("saffron benefits")]).toEqual([CASE, CASE, null]); // the anchor on file and the plan's own search both land on the canonical case; an unrelated keyword claims none
  });
  it("says what acting on a keyword would mean from my OWN rankings, and says nothing at all when it never checked them", async () => {
    const store = memStore(observed()); await disc(store);
    const rows = new Map(store.peek("tc", BASIS)!.discovery.retained.map((k) => [k.keyword, [k.supports, k.ownedRankingUrl, k.ownedPosition]]));
    expect(rows.get("price saffron")).toEqual(["consolidation", "https://own.com/a", 4]); // two of my pages rank for one search, and the BEST position is the one named
    expect(rows.get("saffron threads")).toEqual(["existing_page", "https://own.com/t", 2]); // ONE page reported twice is one page, never two of mine competing, and its BEST position is the one named
    expect(rows.get("saffron benefits")).toEqual(["new_page", null, null]);
    const blind = memStore(observed()); await disc(blind, { getAccount: async () => null }); // no domain, so the ranked pull never runs
    expect(blind.peek("tc", BASIS)!.discovery.retained.every((k) => k.supports == null)).toBe(true); }); // never checked is NOT "no page of mine ranks"
  it("fills the provider's own batch ceilings: ceil(n / 700) enrichment requests and ONE bounded competitors request per case set", async () => {
    const s = emptyFunnelState("tc", BASIS); const pool = Array.from({ length: 1500 }, (_, i) => ({ keyword: `gadget topic ${i}`, volume: 2000 - i }));
    s.cases = [{ id: CASE, anchors: pool.slice(0, 500).map((k) => canonicalQueryKey(k.keyword)) }];
    const store = memStore(s); const batches: number[] = [], sets: number[] = [];
    const out = await keywordDiscoveryUnit({ ...base(profileOf("tc", [], ["gadget"])), ...store.deps, keywordIdeas: async () => [], loadPageQueries: async () => [], loadAnswerAnalyses: async () => [],
      callProvider: async (cap: CapabilityKey, input: unknown) => { if (cap === "labs_keyword_overview") batches.push((input as { keywords: string[] }).keywords.length);
        if (cap === "labs_serp_competitors") sets.push((input as { keywords: string[] }).keywords.length);
        return ok(cap === "labs_keywords_for_site" ? parsedKw(pool) : cap === "labs_serp_competitors" ? [{ domain: "rival.com", avgPosition: 4, rating: 91, keywordsCount: 120 }] : parsedKw([])); } }, [{ caseId: CASE, query: null }])("tc", cur(), 60_000);
    expect([out.status, store.peek("tc", BASIS)!.discovery.retained.length]).toEqual(["done", 1400]);
    expect(batches).toEqual([700, 700]); // 1,400 keywords is TWO full requests at the documented 700 ceiling, never 1,400 requests and never one request's worth kept
    expect(sets).toEqual([200]); }); // 500 case keywords is ONE request at the documented 200 ceiling, never 500 requests
  it("buys the recurring winning domains once per case set, records how that call was served, and does not buy the week again", async () => {
    const store = memStore(observed()); let calls = 0;
    const run = (over: Partial<FunnelDeps> = {}) => disc(store, { callProvider: async (cap: CapabilityKey) => { if (cap === "labs_serp_competitors") { calls += 1; return ok([{ domain: "rival.com", avgPosition: 4, rating: 91, keywordsCount: 12 }], "ck-comp"); }
      return ok(cap === "labs_ranked_keywords" ? ranked([["price saffron", "https://own.com/a", 4]]) : parsedKw([])); }, ...over });
    await run(); const held = store.peek("tc", BASIS)!.discovery.caseCompetitors;
    expect([calls, held.length, held[0]!.caseId, held[0]!.keywordsAsked, held[0]!.receipt, held[0]!.served, held[0]!.domains]).toEqual([1, 1, CASE, 2, "ck-comp", "paid", [{ domain: "rival.com", avgPosition: 4, rating: 91, keywordsCount: 12 }]]); // ONE request for the whole set, filed under the canonical case with the money core's own identity
    await run(); expect(calls).toBe(1); // inside the week the answer on file is the answer: zero further spend
    await run({ now: () => NOW + 8 * 24 * 3600 * 1000 }); expect(calls).toBe(2); }); // past it, exactly one fresh look
});
/** THE JOURNEY, not just the first step: a fan-out has to be traceable back to the approved question, the
 *  engine, the reporting day and the stored answer it came out of, or Beacon cannot say why it belongs to a
 *  page. Route alone was all that survived discovery before this. */
describe("research funnel - the journey behind a keyword", () => {
  const JCASE = "inv_j", jAt = new Date(NOW).toISOString(); const FAN = "best saffron brands";
  const pair = (over: Partial<FunnelPair> = {}): FunnelPair => ({ promptId: "p1", promptText: "where to buy saffron", engine: "chatgpt", mode: "consumer_search", promptVersion: 2, day: DAY_A, cacheKey: null, status: "done", observedAt: jAt, fanOutQueries: [FAN], ...over });
  const seeded = (pairs: FunnelPair[]): FunnelState => { const s = emptyFunnelState("tj", BASIS);
    s.cases = [{ id: JCASE, anchors: [canonicalQueryKey("price saffron")] }];
    s.serps.queries = [{ query: "price saffron", cacheKey: "ck", status: "done", observedAt: jAt, paa: [{ question: "How much does saffron cost per gram", answeringDomain: null }], related: [] }];
    s.prompts.pairs = pairs; return s; };
  const run = (store: ReturnType<typeof memStore>) => keywordDiscoveryUnit({ ...base(profileOf("tj", ["saffron"], ["saffron price"])), ...store.deps, keywordIdeas: async () => [],
    loadPageQueries: async () => [{ query: "saffron benefits", impressions: 90, page: "https://own.com/saffron" }],
    loadAnswerAnalyses: async () => [{ analysis: { topicEntities: ["iranian saffron"], questionsAnswered: [] }, observationId: "obs_read", promptId: "p9", promptVersion: 4, engine: "gemini", reportingDay: DAY_B, promptText: "is saffron worth it" }],
    callProvider: async () => ok(parsedKw([])) }, [{ caseId: JCASE, query: "price saffron" }])("tj", cur(), 60_000);
  const rowsOf = (store: ReturnType<typeof memStore>) => new Map(store.peek("tj", BASIS)!.discovery.retained.map((k) => [k.keyword, k]));

  it("traces every free candidate back to the exact thing that produced it, and invents nothing a route cannot know", async () => {
    const store = memStore(seeded([pair()])); expect((await run(store)).status).toBe("done"); const rows = rowsOf(store);
    expect(rows.get(FAN)!.origins).toEqual([{ route: "fanout", promptId: "p1", promptVersion: 2, engine: "chatgpt", reportingDay: DAY_A, parentQuery: "where to buy saffron",
      observationId: aiObservationId({ tenantId: "tj", promptId: "p1", promptVersion: 2, engine: "chatgpt", day: DAY_A, slot: 0 }) }]); // the answer this search came out of, named the way the store files it
    expect(rows.get("saffron benefits")!.origins).toEqual([{ route: "gsc", pageUrl: "https://own.com/saffron" }]); // my own page earned it; it claims no prompt, no engine, no day it never had
    expect(rows.get("how much does saffron cost per gram")!.origins).toEqual([{ route: "paa", parentQuery: "price saffron", sourceQuery: "How much does saffron cost per gram" }]); // the results page it sat on, in Google's own spelling
    expect(rows.get("iranian saffron")!.origins).toEqual([{ route: "answer_entity", promptId: "p9", promptVersion: 4, engine: "gemini", reportingDay: DAY_B, observationId: "obs_read", parentQuery: "is saffron worth it" }]);
  });
  it("merges one follow-up seen in two different answers into ONE row that names both", async () => {
    const store = memStore(seeded([pair(), pair({ promptId: "p2", promptText: "cheapest saffron", day: DAY_B })])); await run(store);
    const row = rowsOf(store).get(FAN)!;
    expect(row.origins!.map((o) => [o.promptId, o.reportingDay])).toEqual([["p1", DAY_A], ["p2", DAY_B]]); // two answers asking one follow-up is two pieces of evidence, never one
    expect(row.moreOrigins).toBeUndefined(); });
  it("keeps six arrivals and COUNTS the rest, so a bounded journey never reads as the whole story", async () => {
    const store = memStore(seeded(Array.from({ length: 7 }, (_, i) => pair({ promptId: `p${i}`, promptText: `question ${i}` })))); await run(store);
    const row = rowsOf(store).get(FAN)!;
    expect([row.origins!.map((o) => o.promptId), row.moreOrigins]).toEqual([["p0", "p1", "p2", "p3", "p4", "p5"], 1]); }); // the seventh grows the count, never the list
  it("carries a journey across passes: a rediscovered keyword keeps last pass's arrivals and adds this pass's", async () => {
    const first = memStore(seeded([pair()])); await run(first);
    expect(rowsOf(first).get(FAN)!.origins!.map((o) => o.promptId)).toEqual(["p1"]);
    const held = first.peek("tj", BASIS)!; held.prompts.pairs = [pair({ promptId: "p2", promptText: "cheapest saffron", day: DAY_B })]; // the same follow-up, out of a different answer this time
    const second = memStore(held); await run(second);
    expect(rowsOf(second).get(FAN)!.origins!.map((o) => o.promptId)).toEqual(["p1", "p2"]); }); // what the last pass learned is not re-learned and not lost
  it("decodes a row stored before the journey was kept as one that recorded no journey, never as one from nowhere", async () => {
    const stored = { schemaVersion: 3, tenantId: "tj", basisTag: BASIS, discovery: { seeds: [], rejected: [], counts: { raw: 1, normalized: 1, retained: 1, rejected: 0 }, caseCompetitors: [],
      retained: [{ keyword: "saffron price", searchVolume: 500, competition: null, difficulty: null, intent: null, discoveredVia: "site", rankedUrl: "https://own.com/s", rankedRank: 4 }] } } as unknown as FunnelState;
    const table = { select: () => table, eq: () => table, maybeSingle: async () => ({ data: { schema_version: 3, state: stored, row_version: 1 }, error: null }) };
    const loaded = await loadFunnelState("tj", BASIS, { configured: () => true, admin: () => ({ from: () => table }) });
    const k = loaded.state.discovery.retained[0]!;
    expect([k.origins, k.moreOrigins, k.ownedRankingUrl, k.ownedPosition]).toEqual([undefined, undefined, "https://own.com/s", 4]); }); // nothing crashes, nothing is fabricated, the legacy ranking still lands
});
describe("evidence - the per-case research receipt", () => {
  const CASE = "inv_canon", ABSORBED = "inv_old", at = new Date(NOW).toISOString();
  const seeded = (): FunnelState => { const s = emptyFunnelState("tr2", BASIS);
    s.cases = [{ id: CASE, anchors: [canonicalQueryKey("saffron price")] }, { id: ABSORBED, anchors: [], aliasOf: CASE }];
    s.discovery.retained = [{ keyword: "saffron price", searchVolume: 500, competition: null, difficulty: 12, intent: "commercial", discoveredVia: "paa", caseId: CASE, ownedRankingUrl: "https://own.com/s", ownedPosition: 4, supports: "existing_page" },
      { keyword: "saffron grades", searchVolume: null, competition: null, difficulty: null, intent: null, discoveredVia: "related_search", caseId: null }];
    s.discovery.counts.retained = 2;
    s.serps.queries = [{ query: "saffron price", cacheKey: "ck-serp", status: "done", observedAt: at, organic: [] }];
    s.prompts.pairs = [{ promptId: "p1", promptText: "saffron price", engine: "gemini", mode: "standardized_response", cacheKey: null, status: "done", observedAt: at, citationsObserved: false, citations: null }];
    s.pageComparisons = [{ topicKey: ABSORBED, askKey: "ak", pages: ["https://a.com/x", "https://b.com/y"], excludePages: [], observedAt: at, receipt: "ck-pi", comparison: null, unavailable: "capped" }];
    s.discovery.caseCompetitors = [{ caseId: CASE, keywordsAsked: 2, domains: [{ domain: "rival.com", avgPosition: 4, rating: 91, keywordsCount: 12 }], observedAt: at, receipt: "ck-comp", served: "cache" }];
    s.cycle = { runId: "run-r", cycleKey: null, spentUsd: 0.05, cacheHits: 1 }; return s; };
  it("answers for an absorbed id, names every source, tells cache from paid honestly, and says why it bought no more", async () => {
    const snapshot = await loadEvidenceSnapshot("tr2", { resolveBasis: async () => BASIS, loadState: async () => ({ state: seeded(), rowVersion: 1 }), now: new Date(NOW) });
    const r = caseResearchReceipt(snapshot, ABSORBED)!;
    expect([r.caseId, r.aliasKeys]).toEqual([CASE, [ABSORBED]]); // asked under the id a merge absorbed, answered by the case that answers for it now
    expect(r.keywords).toEqual([{ query: "saffron price", discoveredVia: "paa", metricsHeld: true, searchVolume: 500, difficulty: 12, intent: "commercial", ownedRankingUrl: "https://own.com/s", ownedPosition: 4, supports: "existing_page", origins: null, moreOrigins: null }]); // only this case's keywords, each with how I found it, its recorded journey, and what acting on it would mean
    expect(r.calls.map((c) => [c.kind, c.identity, c.served]).sort()).toEqual([["ai_answer", null, "unknown"], ["competitor_domains", "ck-comp", "cache"], ["page_comparison", "ck-pi", "unknown"], ["search_results", null, "unknown"]].sort()); // the ONE call that recorded how it was served says so; the rest say unknown instead of guessing
    expect(r.spend).toEqual({ spentUsd: 0.05, cachedCalls: 1 }); // THIS run's money, never a lifetime total
    expect(r.notBought.map((n) => n.reason)).toEqual(["capped", "fresh"]);
    expect(r.notBought[0]!.detail).toContain("spending ceiling"); expect(r.notBought[1]!.detail).toContain("all 1 of this case's searches");
    expect(caseResearchReceipt(snapshot, "inv_nobody")).toBeNull(); }); // a case I do not hold gets no receipt, never an empty one that reads as researched
  it("answers for a TWO-HOP chain, so nothing a merge absorbed twice falls out of the receipt", async () => {
    const DEEP = "inv_older", s = seeded(); // A absorbed B, and B had already absorbed C
    s.cases = [...s.cases!, { id: DEEP, anchors: [], aliasOf: ABSORBED }];
    s.discovery.retained = [...s.discovery.retained, { keyword: "saffron threads", searchVolume: null, competition: null, difficulty: null, intent: null, discoveredVia: "gsc", caseId: DEEP }];
    s.pageComparisons = [...s.pageComparisons!, { topicKey: DEEP, askKey: "ak2", pages: ["https://a.com/x", "https://c.com/z"], excludePages: [], observedAt: at, receipt: "ck-deep", comparison: null, unavailable: null }];
    const snapshot = await loadEvidenceSnapshot("tr2", { resolveBasis: async () => BASIS, loadState: async () => ({ state: s, rowVersion: 1 }), now: new Date(NOW) });
    const r = caseResearchReceipt(snapshot, DEEP)!;
    expect([r.caseId, r.aliasKeys]).toEqual([CASE, [ABSORBED, DEEP]]); // asked under the deepest id, answered by the case that answers for all three
    expect(r.keywords.map((k) => k.query).sort()).toEqual(["saffron price", "saffron threads"]); // the keyword filed two hops down is still this case's keyword
    expect(r.calls.filter((c) => c.kind === "page_comparison").map((c) => c.identity).sort()).toEqual(["ck-deep", "ck-pi"]); }); // and so is the money spent under it
});
describe("research funnel - canonical snapshot carries the research bundle", () => {
  it("surfaces the current set, its provenance, and THIS run's receipt", async () => { const s = emptyFunnelState("tg", BASIS); s.discovery.retained = [{ keyword: "saffron price", searchVolume: 500, competition: 0.4, difficulty: null, intent: "commercial", discoveredVia: "site" }];
    s.discovery.counts = { raw: 30, normalized: 20, retained: 1, rejected: 2 };
    s.prompts.intendedPairs = 2; // CANONICAL coverage: the consumer look + gemini
    s.prompts.pairs = [{ promptId: "pr", promptText: "where to buy saffron", engine: "chatgpt", mode: "consumer_search", cacheKey: null, status: "done", observedAt: "2026-07-24T00:00:00.000Z", modelServed: "gpt-4o", citationsObserved: true, citations: [{ url: "https://b.com/y", domain: "b.com", title: null }] },
      { promptId: "pr", promptText: "where to buy saffron", engine: "chatgpt", mode: "standardized_response", cacheKey: null, status: "done", observedAt: "2026-07-24T00:00:00.000Z", citationsObserved: false, citations: null }, { promptId: "pr", engine: "gemini", mode: "standardized_response", cacheKey: null, status: "pending" }];
    s.serps.queries = [{ query: "saffron price", cacheKey: null, status: "done", observedAt: "2026-07-24T00:00:00.000Z", organic: [{ rank: 1, url: "https://a.com/x", domain: "a.com", title: "A" }], aiOverview: [{ url: "https://b.com/y", domain: "b.com", title: null }] }, { query: "unavailable", cacheKey: null, status: "failed" }];
    s.serps.analyzed = 1; s.winningPages = [{ url: "https://b.com/y", domain: "b.com", engines: ["chatgpt"], examplePrompts: ["where to buy saffron"], appearances: [], extract: null }];
    s.ledger = { spentUsd: 99, cacheHits: 99 }; // lifetime totals are NOT the receipt
    s.cycle = { runId: "run-9", cycleKey: "cycle-9", spentUsd: 0.5, cacheHits: 3 }; const snapshot = await loadEvidenceSnapshot("tg", { resolveBasis: async () => BASIS, loadState: async () => ({ state: s, rowVersion: 1 }), now: new Date("2026-07-24T00:00:00.000Z") });
    expect(snapshot.research.retainedKeywords[0]!.intent).toBe("commercial"); expect(snapshot.research.aiObservations.map((o) => o.promptText)).toEqual(["where to buy saffron", "where to buy saffron"]); // only resolved evidence projects
    expect(snapshot.research.aiObservations.map((o) => o.observationMode)).toEqual(["consumer_search", "standardized_response"]); // both looks project with their own provenance, never blended
    expect(snapshot.research.serpEvidence.map((e) => e.query)).toEqual(["saffron price"]); expect(snapshot.research.serpEvidence[0]!.aiOverview[0]!.domain).toBe("b.com");
    expect(snapshot.research.winningPages[0]!.examplePrompts).toEqual(["where to buy saffron"]);
    expect(snapshot.research.receipt.retained).toBe(1); expect(snapshot.research.receipt.missing).toBe(2); // one unanswered pair + one unavailable search
    expect(snapshot.research.receipt.spentUsd).toBe(0.5); expect(snapshot.research.receipt.cached).toBe(3); // THIS run, not the lifetime totals
    expect(snapshot.keywordDemand.some((k) => k.query === "saffron price")).toBe(true);
  });
  it("carries every keyword's OWN discovery route and seed theme through, and the provider's own competition label", async () => { const s = emptyFunnelState("tl", BASIS);
    const routes = ["site", "ranked", "related", "suggestion", "gsc", "profile", "ideas"] as const; // every route a keyword can arrive by
    s.discovery.retained = routes.map((discoveredVia, i) => ({ keyword: `kw ${discoveredVia}`, searchVolume: 10 + i, competition: 0.9, difficulty: null, intent: null, discoveredVia, ...(i % 2 ? { seed: `theme ${i}` } : {}) }));
    s.discovery.retained[0]!.competitionLevel = "low"; s.discovery.retained[1]!.ownedRankingUrl = "https://own.com/saffron"; s.discovery.retained[1]!.ownedPosition = 3; s.discovery.counts.retained = routes.length;
    s.discovery.retained[0]!.origins = [{ route: "fanout", promptId: "pr", promptVersion: 2, engine: "chatgpt", reportingDay: DAY_A, observationId: "obs_z", parentQuery: "where to buy saffron" }]; s.discovery.retained[0]!.moreOrigins = 2;
    const snapshot = await loadEvidenceSnapshot("tl", { resolveBasis: async () => BASIS, loadState: async () => ({ state: s, rowVersion: 1 }), now: new Date("2026-07-24T00:00:00.000Z") });
    expect(snapshot.research.retainedKeywords.map((k) => [k.discoveredVia, k.seed])).toEqual(routes.map((r, i) => [r, i % 2 ? `theme ${i}` : null])); // recorded lineage, never inferred downstream
    expect(snapshot.research.retainedKeywords.map((k) => k.competitionLevel).slice(0, 2)).toEqual(["low", "high"]); // the provider's OWN label wins; only an unlabeled row falls back to the derived band
    expect(snapshot.research.retainedKeywords.map((k) => [k.ownedRankingUrl, k.ownedPosition]).slice(0, 2)).toEqual([[null, null], ["https://own.com/saffron", 3]]); // a ranked keyword NAMES the page of MY OWN that ranks; every other route says so plainly
    expect([snapshot.research.retainedKeywords[0]!.origins, snapshot.research.retainedKeywords[0]!.moreOrigins]).toEqual([s.discovery.retained[0]!.origins, 2]); // the WHOLE journey projects, truncation count and all
    expect(snapshot.research.retainedKeywords[1]!.origins).toBeUndefined(); // a row that recorded no journey projects none, never an empty one
  }); });
