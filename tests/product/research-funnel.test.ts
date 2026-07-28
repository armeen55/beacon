/** PRODUCT - the research funnel: the four executors, the pure projector and the canonical snapshot, driven by injected CAPABILITY
 *  fakes over an in-memory basis-scoped state repo. Pins CURRENT-SET truth (obsolete pairs and queries are pruned and never inherit
 *  completion), OBSERVATION-MODE truth (canonical consumer/standardized coverage vs bounded auxiliary research), weekly freshness,
 *  the DISPOSITION ladder (blocked stops the batch and pauses the run; quarantined is plain unavailable coverage), the SERP agenda
 *  in the customer's own words with an open investigation bought first, distinct history identity, and the receipt. No network. */
import { describe, it, expect, vi, beforeEach } from "vitest";
const sb = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fails: false, tenant: "", urls: [] as string[] })); // the ONE page_snapshots read the body reader makes
vi.mock("@/lib/persistence/supabase", async (orig) => ({ ...((await orig()) as object), getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: (_c: string, t: string) => { sb.tenant = t; return { in: (_u: string, urls: string[]) => { sb.urls = urls; return { order: () => ({ limit: async () => (sb.fails ? { data: null, error: { message: "down" } } : { data: sb.rows, error: null }) }) }; } }; } }) }) }) }));
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context";
import { emptyBusinessProfile, type Account, type BusinessProfile, type ProfileSection } from "@/domains/account";
import type { CachedCallResult, CapabilityKey, FailureDisposition, ParsedAiAnswer, ParsedKeywordItem, ParsedSerp } from "@/domains/evidence/dataforseo/funnel-boundary";
import { keywordDiscoveryUnit } from "@/domains/evidence/funnel/discovery";
import { promptObservationUnit, serpAnalysisUnit, winningPagesUnit } from "@/domains/evidence/funnel/observe";
import { retainDiverse, selectSerpAgenda } from "@/domains/evidence/funnel/normalize"; import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { emptyFunnelState, MAX_RETAINED, type FunnelKeyword, type FunnelPair, type FunnelState } from "@/domains/evidence/funnel/state";
import { CONFLICT_DETAIL, type FunnelDeps } from "@/domains/evidence/funnel/shared";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
const BASIS = "basis_aaa"; const NOW = 1_700_000_000_000; // a fixed clock far past the 7-day freshness window
const WEEKS_AGO = new Date(NOW - 30 * 24 * 3600 * 1000).toISOString(); const ENG = ["chatgpt", "gemini", "claude", "perplexity"] as const;
const cur = (basis: string | null = BASIS) => (basis ? { basis } : {}); const confirmed = <V>(value: V): ProfileSection<V> => ({ value, origin: "operator_confirmed", confidence: null, sourceUrls: [] });
function profileOf(id: string, offerings: string[], topics: string[], exclude: string[] = [], banned: string[] = []): BusinessProfile { const p = emptyBusinessProfile(id); p.offerings = confirmed(offerings); p.topicsToOwn = confirmed(topics); p.constraints.value.bannedTerms = banned;
  p.topicsToExclude = { value: exclude, origin: "inferred", confidence: null, sourceUrls: [] }; return p; } const parse = ((_c: unknown, env: unknown) => env) as unknown as FunnelDeps["parse"];
const parsedKw = (kws: { keyword: string; volume?: number }[]): ParsedKeywordItem[] => kws.map((k) => ({ keyword: k.keyword, searchVolume: k.volume ?? 100, cpcUsd: null, competition: 0.4, competitionLevel: null, difficulty: null, intent: "informational", monthlySearches: null }));
const aiAnswer = (over: Partial<ParsedAiAnswer> = {}): ParsedAiAnswer => ({ answerText: "hi", modelServed: null, webSearchReported: null, citations: null, fanOutQueries: null, brands: null, ...over });
const serp = (organic: ParsedSerp["organic"]): ParsedSerp => ({ organic, aiOverview: null, snippetOwner: null, paaQuestions: [], relatedSearches: [] });
const ok = (parsed: unknown, cacheKey = "ck", modelServed: string | null = null): CachedCallResult => ({ state: "ok", envelope: parsed as never, costUsd: 0.01, cacheKey, modelServed });
const waiting = (cacheKey: string): CachedCallResult => ({ state: "waiting", cacheKey, providerTaskId: "t", costUsd: 0, detail: "posted" });
const err = (disposition: FailureDisposition, cacheKey: string | null = "ck-old"): CachedCallResult => ({ state: "error", cacheKey, disposition, detail: "the provider could not finish it" }); function memStore(seed?: FunnelState) {
  const rows = new Map<string, { state: FunnelState; rowVersion: number }>(); if (seed) rows.set(`${seed.tenantId}|${seed.basisTag}`, { state: seed, rowVersion: 1 }); const clone = (s: FunnelState): FunnelState => structuredClone(s); // the real repo decodes a fresh object per load
  const deps = { loadState: async (t: string, b: string) => { const row = rows.get(`${t}|${b}`); return row ? { state: clone(row.state), rowVersion: row.rowVersion } : { state: emptyFunnelState(t, b), rowVersion: 0 }; },
    saveState: async (t: string, b: string, s: FunnelState, expected: number) => { const k = `${t}|${b}`; if ((rows.get(k)?.rowVersion ?? 0) !== expected) return null; rows.set(k, { state: clone(s), rowVersion: expected + 1 }); return expected + 1; } } satisfies Pick<FunnelDeps, "loadState" | "saveState">;
  return { deps, peek: (t: string, b: string) => rows.get(`${t}|${b}`)?.state }; }
const base = (profile: BusinessProfile, domain = "iranopedia.com"): FunnelDeps => ({ loadProfile: async () => profile, loadCrawl: async () => null, getAccount: async () => ({ domain } as Account), parse, now: () => 1_000_000 });
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
    return { ...store.deps, loadProfile: async () => profileOf("tp", ["persian food"], ["saffron"]), parse, loadActivePrompts: async () => prompts, syncHistory: async (r) => { rows.push(...r); }, now: () => 5_000_000,
      collectTask: async () => ok(aiAnswer({ modelServed: "gpt-4o", citations: [{ url: "https://a.com/1", domain: "a.com", title: null }] }), "ck-chat"),
      callProvider: async (cap: CapabilityKey) => { if (cap === "llm_perplexity") return ok(aiAnswer({ modelServed: "sonar", webSearchReported: true, citations: [] }));
        if (cap === "llm_scraper_chatgpt") return ok(aiAnswer({ modelServed: "gpt-4o", citations: [{ url: "https://c.com/2", domain: "c.com", title: null }], fanOutQueries: ["persian food near me"] }));
        if (cap === "llm_chatgpt") return waiting("ck-chat"); if (cap === "llm_gemini") return ok(aiAnswer({ citations: null })); return ok(aiAnswer({ modelServed: claudeModel, citations: [{ url: "https://d.com/3", domain: "d.com", title: null }] })); } };
  }
  it("keeps webSearchReported distinct from citations and preserves the null-vs-[] citation tri-state", async () => { const rows: PromptAnswerObservation[] = []; const store = memStore(); const out = await promptObservationUnit(deps(store, rows, "claude-3-5-sonnet"))("tp", cur(), 60_000);
    expect(out.progress.enginePairsIntended).toBe(8); expect(out.status).toBe("done"); // 2 prompts x 4 canonical pairs, all in; the auxiliary chatgpt looks stay posted and never hold the unit back
    const st = store.peek("tp", BASIS)!; const perp = st.prompts.pairs.find((p) => p.engine === "perplexity" && p.status === "done")!; expect(perp.webSearchReported).toBe(true); expect(perp.citations).toEqual([]); expect(perp.citationsObserved).toBe(true);
    const gem = st.prompts.pairs.find((p) => p.engine === "gemini" && p.status === "done")!; expect(gem.citations).toBeNull(); expect(gem.citationsObserved).toBe(false); const perpRow = rows.find((r) => r.platform === "perplexity")!, gemRow = rows.find((r) => r.platform === "gemini")!;
    expect(perpRow.citation_urls).toEqual([]); expect(perpRow.metadata.citationsObserved).toBe(true); expect(perpRow.metadata.observationMode).toBe("standardized_response");
    expect(gemRow.citation_urls).toBeNull(); expect(gemRow.metadata.citationsObserved).toBe(false); expect(rows.some((r) => (r.search_queries ?? []).length > 0)).toBe(true); });
  it("hands each capability its own provider-valid ask: chatgpt web only, claude web+force+country, gemini web-only, perplexity plain, consumer search by keyword", async () => { const seen = new Map<string, unknown>(); const store = memStore();
    await promptObservationUnit({ ...deps(store, [], "claude-4"), callProvider: async (cap, input) => { if (!seen.has(cap)) seen.set(cap, input); return waiting("ck"); } })("tp", cur(), 60_000);
    expect(seen.get("llm_chatgpt")).toEqual({ user_prompt: "best persian restaurant", web_search: true }); // ChatGPT rejects force_web_search on its reasoning models (in-body 40501), so we never send it
    expect(seen.get("llm_claude")).toEqual({ user_prompt: "best persian restaurant", web_search: true, force_web_search: true, web_search_country_iso_code: "US" }); // documented for Claude
    expect(seen.get("llm_gemini")).toEqual({ user_prompt: "best persian restaurant", web_search: true }); expect(seen.get("llm_perplexity")).toEqual({ user_prompt: "best persian restaurant" });
    expect(seen.get("llm_scraper_chatgpt")).toEqual({ keyword: "best persian restaurant", force_web_search: true, expand_citations: true }); }); // keyword-based, never user_prompt
  it("gives the consumer look and a changed served model their OWN history rows, never a merge", async () => { const rows: PromptAnswerObservation[] = []; const store = memStore(); await promptObservationUnit(deps(store, rows, "claude-3-5-sonnet"))("tp", cur(), 60_000);
    await promptObservationUnit(deps(store, rows, "claude-3-5-sonnet"))("tp", cur(), 60_000); // same day: collects the posted ChatGPT tasks
    const chat = rows.filter((r) => r.prompt_id === "p1" && r.platform === "chatgpt"); expect(chat.length).toBe(2); expect(new Set(chat.map((r) => r.id)).size).toBe(2); // same engine, day and model: still distinct ids
    expect(new Set(chat.map((r) => r.metadata.observationMode))).toEqual(new Set(["consumer_search", "standardized_response"])); expect(new Set(chat.map((r) => Boolean(r.metadata.scraper)))).toEqual(new Set([true, false])); // pre-6I readers still see the flag
    await promptObservationUnit({ ...deps(store, rows, "claude-4"), now: () => 5_000_000 + 8 * 24 * 3600 * 1000 })("tp", cur(), 60_000); expect(new Set(rows.filter((r) => r.platform === "claude" && r.prompt_id === "p1").map((r) => r.id)).size).toBe(2); });
  it("stamps history with the REAL run id and starts each cycle's receipt at zero", async () => { const rows: PromptAnswerObservation[] = []; const store = memStore(); const d: FunnelDeps = { ...deps(store, rows, "claude-4"), callProvider: async () => ok(aiAnswer({ citations: [] })) };
    const r1 = await promptObservationUnit(d)("tp", { basis: BASIS, runId: "run-1", cycle: "cycle-1" }, 60_000); expect(r1.status).toBe("done"); expect(rows.every((r) => r.run_id === "run-1")).toBe(true); // never a manufactured id
    const c1 = store.peek("tp", BASIS)!; expect(c1.cycle).toMatchObject({ runId: "run-1", cycleKey: "cycle-1" }); expect(c1.cycle.spentUsd).toBeCloseTo(0.1, 5); // 10 pairs at one cent
    const r2 = await promptObservationUnit(d)("tp", { basis: BASIS, runId: "run-2", cycle: "cycle-2" }, 60_000); const c2 = store.peek("tp", BASIS)!; expect(r2.status).toBe("done"); expect(r2.progress.spendUsd).toBe(0);
    expect(c2.cycle).toMatchObject({ runId: "run-2", spentUsd: 0, cacheHits: 0 }); // a new run gets a FRESH receipt
    expect(c2.ledger.spentUsd).toBeCloseTo(0.1, 5); }); // the lifetime total is still true
});
describe("research funnel - current-set truth + the disposition ladder", () => {
  const prompts = [{ id: "p1", text: "best persian restaurant" }]; const donePair = (promptId: string, engine: FunnelPair["engine"], observedAt: string): FunnelPair => ({ promptId, engine, cacheKey: null, status: "done", observedAt, citationsObserved: true, citations: [] });
  const seedWith = (pairs: FunnelPair[]) => { const s = emptyFunnelState("tp", BASIS); s.prompts = { pairs, intendedPairs: pairs.length }; return memStore(s); };
  const mk = (store: ReturnType<typeof memStore>, over: Partial<FunnelDeps> = {}): FunnelDeps => ({ ...store.deps, loadProfile: async () => profileOf("tp", ["persian food"], ["saffron"]), loadActivePrompts: async () => prompts, parse, syncHistory: async () => {}, now: () => NOW, ...over });
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${String(i).padStart(2, "0")}`, text: `prompt ${i}` }));
  it("prunes pairs whose prompt left the active set, so old completions can never satisfy the new set", async () => { const store = seedWith(ENG.map((e) => donePair("p_gone", e, new Date(NOW).toISOString()))); const out = await promptObservationUnit(mk(store, { callProvider: async () => waiting("ck") }))("tp", cur(), 60_000);
    expect(out.status).toBe("waiting"); expect(out.progress.enginePairsIntended).toBe(4); // every CANONICAL pair of the NEW prompt is outstanding
    const kept = store.peek("tp", BASIS)!.prompts.pairs; expect(kept.length).toBe(5); expect(kept.every((p) => p.promptId === "p1")).toBe(true); }); // 4 canonical + 1 auxiliary; obsolete rows dropped (history lives in observations)
  it("intends 4 canonical pairs per prompt plus a bounded 20-prompt auxiliary set, and migrates a pre-6I state without re-buying a fresh look", async () => { const fresh = new Date(NOW).toISOString(); const store = seedWith([...ENG.map((e) => donePair("p00", e, fresh)), { ...donePair("p00", "chatgpt", fresh), scraper: true }, donePair("p24", "chatgpt", fresh)]);
    const asked: string[] = []; const ask = (i: unknown) => (i as { user_prompt?: string; keyword?: string }).user_prompt ?? (i as { keyword?: string }).keyword;
    const out = await promptObservationUnit(mk(store, { loadActivePrompts: async () => many(25), callProvider: async (cap, i) => { asked.push(`${cap}|${ask(i)}`); return waiting("ck"); } }))("tp", cur(), 60_000);
    const pairs = store.peek("tp", BASIS)!.prompts.pairs; const aux = pairs.filter((p) => p.engine === "chatgpt" && p.mode === "standardized_response"); expect([out.progress.enginePairsIntended, pairs.length]).toEqual([100, 120]); // 25 x 4 canonical coverage, plus 20 auxiliary chatgpt looks that count toward nothing
    expect(pairs.filter((p) => p.engine === "chatgpt" && p.mode === "consumer_search").length).toBe(25); // exactly ONE consumer look per prompt
    expect([aux.length, new Set(aux.map((p) => p.promptId)).size, aux.some((p) => p.promptId === "p24")]).toEqual([20, 20, false]); // bounded to the first 20 prompts
    expect(pairs.filter((p) => p.promptId === "p00" && p.status === "done").map((p) => `${p.engine}|${p.mode}`).sort())
      .toEqual(["chatgpt|consumer_search", "chatgpt|standardized_response", "claude|standardized_response", "gemini|standardized_response", "perplexity|standardized_response"]); // legacy scraper flag decodes to the consumer look, a bare chatgpt row to the auxiliary slot
    expect(asked.some((a) => a.endsWith("prompt 0"))).toBe(false); // every carried row is fresh: nothing fresh is ever bought twice
    expect(pairs.some((p) => p.promptId === "p24")).toBe(true); expect(pairs.some((p) => p.promptId === "p24" && p.status === "done")).toBe(false); // the out-of-band auxiliary row is pruned from the working set
    const shuffled = memStore(); await promptObservationUnit(mk(shuffled, { loadActivePrompts: async () => many(25).reverse(), callProvider: async () => waiting("ck") }))("tp", cur(), 60_000);
    const shuffledAux = shuffled.peek("tp", BASIS)!.prompts.pairs.filter((p) => p.engine === "chatgpt" && p.mode === "standardized_response").map((p) => p.promptId); expect(shuffledAux).toEqual(aux.map((p) => p.promptId)); }); // provider row order cannot rotate the paid auxiliary sample
  it("an auxiliary failure never fails the unit or blocks done, and even an auxiliary BLOCK never holds the run hostage", async () => {
    const run = (disposition: FailureDisposition) => { const store = memStore(); return promptObservationUnit(mk(store, { callProvider: async (cap) => (cap === "llm_chatgpt" ? err(disposition) : ok(aiAnswer({ citations: [] }))) }))("tp", cur(), 60_000).then((out) => ({ out, store })); };
    const q = await run("quarantined"); expect([q.out.status, q.out.detail, q.out.progress.enginePairsIntended]).toEqual(["done", undefined, 4]); // the four canonical looks are in: an auxiliary gap names nothing and blocks nothing
    const b = await run("blocked"); expect([b.out.status, b.out.detail]).toEqual(["done", undefined]); // an aux block reads unsupported (durable, free) and resurfaces on canonical work, never a permanent pause
    expect(b.store.peek("tp", BASIS)!.prompts.pairs.find((p) => p.engine === "chatgpt" && p.mode === "standardized_response")!.status).toBe("unsupported");
    const canon = await promptObservationUnit(mk(memStore(), { callProvider: async (cap) => (cap === "llm_scraper_chatgpt" ? err("blocked") : ok(aiAnswer({ citations: [] }))) }))("tp", cur(), 60_000);
    expect([canon.status, canon.detail]).toEqual(["failed", "the provider could not finish it"]); }); // a CANONICAL block still pauses the run for review (6G)
  it("keeps working on a half-refreshed stale set instead of reporting done", async () => { const store = seedWith([...ENG.map((e) => donePair("p1", e, WEEKS_AGO)), { ...donePair("p1", "chatgpt", WEEKS_AGO), scraper: true }]);
    let landed = false; // the budget runs out right after the FIRST stale pair refreshes
    const out = await promptObservationUnit(mk(store, { now: () => (landed ? NOW + 9_000_000 : NOW), syncHistory: async () => { landed = true; }, callProvider: async () => ok(aiAnswer({ citations: [] })) }))("tp", cur(), 60_000);
    expect(out.status).toBe("advanced"); expect(store.peek("tp", BASIS)!.prompts.pairs.filter((p) => p.observedAt === WEEKS_AGO).length).toBe(4); }); // NOT done: four looks are still stale
  it("keeps a retry_free task posted on the SAME key; a blocked collect keeps it too and stops the paid batch dead", async () => { for (const disposition of ["retry_free", "blocked"] as const) {
      const store = seedWith([{ promptId: "p1", engine: "chatgpt", mode: "consumer_search", cacheKey: "ck-old", status: "posted" }]); let posts = 0; const d = mk(store, { collectTask: async () => err(disposition), callProvider: async () => { posts += 1; return waiting("ck-new"); } });
      const r1 = await promptObservationUnit(d)("tp", cur(), 60_000), r2 = await promptObservationUnit(d)("tp", cur(), 60_000); // a second terminal never escalates
      const p = store.peek("tp", BASIS)!.prompts.pairs.find((x) => x.engine === "chatgpt" && x.mode === "consumer_search")!; expect(p).toMatchObject({ status: "posted", cacheKey: "ck-old" }); expect(p.reposts).toBeUndefined(); // same identity, one-repost budget untouched
      expect([r1.status, r2.status]).toEqual(["failed", "failed"]); expect(r2.detail).toBeTruthy(); // an honest bounded pause
      expect(posts).toBe(disposition === "blocked" ? 0 : 4); // blocked stops every remaining provider call; retry_free lets the rest of the set run
    } });
  it("an expired task reposts the pair clean exactly ONCE, then explicit unsupported coverage, never a stuck run", async () => { const store = seedWith([{ promptId: "p1", engine: "chatgpt", mode: "consumer_search", cacheKey: "ck-old", status: "posted" }]); let posts = 0;
    const d = mk(store, { collectTask: async () => err("repost_once"), callProvider: async () => { posts += 1; return waiting("ck-new"); } }); const chat = () => store.peek("tp", BASIS)!.prompts.pairs.find((p) => p.engine === "chatgpt" && p.mode === "consumer_search")!;
    const r1 = await promptObservationUnit(d)("tp", cur(), 60_000); expect(r1.status).toBe("waiting"); expect(chat()).toMatchObject({ status: "posted", cacheKey: "ck-new", reposts: 1 }); // ONE clean repost
    const r2 = await promptObservationUnit(d)("tp", cur(), 60_000); expect(chat().status).toBe("unsupported"); expect(r2.status).toBe("waiting"); // unavailable coverage named; the run is not stuck
    expect(posts).toBe(9); // 5 first-pass posts + the OTHER four pairs' single recovery; the dead key never reposts again
    const r3 = await promptObservationUnit(d)("tp", cur(), 60_000); expect(posts).toBe(9); expect(r3.status).toBe("failed"); }); // every repost spent: zero further spend, honest failure, never done
  it("pauses honestly when a pass processes nothing or coverage is unavailable, never a fake done", async () => { const store = memStore(); let t = 0; // the deadline passes immediately after it is set: zero pairs run
    const stalled = await promptObservationUnit(mk(store, { now: () => (t += 100_000), callProvider: async () => waiting("ck") }))("tp", cur(), 1_000);
    const unavailable = await promptObservationUnit(mk(store, { callProvider: async () => ({ state: "not_configured", cacheKey: null, detail: "not configured" }) }))("tp", cur(), 60_000); expect([stalled.status, unavailable.status, !!stalled.detail, !!unavailable.detail]).toEqual(["failed", "failed", true, true]); });
  it("a blocked POST stops the batch on the FIRST refusal, leaves every row exactly as it was, and pauses the run for review", async () => { const store = memStore(); let calls = 0; const pairs = () => store.peek("tp", BASIS)!.prompts.pairs;
    const d = mk(store, { callProvider: async () => { calls += 1; return err("blocked", "ck-blocked"); } });
    const r1 = await promptObservationUnit(d)("tp", cur(), 60_000); expect([r1.status, r1.detail, calls]).toEqual(["failed", "the provider could not finish it", 1]); // the boundary's own truth, never a canned line, and not one more paid request
    expect(pairs().every((p) => p.status === "pending" && p.cacheKey == null)).toBe(true); // a held refusal is NEVER ordinary unsupported coverage
    const r2 = await promptObservationUnit(d)("tp", cur(), 60_000); // a revisit re-enters and gets the same held answer for free
    expect([r2.status, r2.detail, calls]).toEqual(["failed", "the provider could not finish it", 2]); // still paused, zero post-block calls
    let ecalls = 0; // a refusal carrying an EMPTY detail must still arm the block and the batch stop
    const empty = await promptObservationUnit(mk(memStore(), { callProvider: async () => { ecalls += 1; return { state: "error", cacheKey: null, disposition: "blocked", detail: "" } as CachedCallResult; } }))("tp", cur(), 60_000); expect([empty.status, !!empty.detail, ecalls]).toEqual(["failed", true, 1]); });
  it("a quarantined POST is plain unavailable coverage: the pair is marked unsupported and the batch keeps running", async () => { const store = memStore(); let calls = 0; const out = await promptObservationUnit(mk(store, { callProvider: async () => { calls += 1; return err("quarantined", "ck-q"); } }))("tp", cur(), 60_000);
    expect([out.status, calls]).toEqual(["failed", 5]); // one ambiguous key never deadlocks the phase: every pair still got its turn
    expect(store.peek("tp", BASIS)!.prompts.pairs.every((p) => p.status === "unsupported" && p.observedAt)).toBe(true); // explicit, dated, unavailable
  });
});
describe("research funnel - SERP current set, freshness, and recovery", () => {
  const retainedState = (keywords: string[]): FunnelState => { const s = emptyFunnelState("ts", BASIS);
    s.discovery.retained = keywords.map((keyword, i) => ({ keyword, searchVolume: 90 - i, competition: 0.3, difficulty: null, intent: null, discoveredVia: "site" as const })); return s; };
  // The agenda reads the profile and my own page queries; both are injected here so nothing reaches the network.
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
    seed.serps.analyzed = 2; // both looks already landed: analyzed + unavailable would otherwise satisfy done
    const run = async (disposition: FailureDisposition) => { const s = memStore(seed); let calls = 0;
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
    const store = memStore(s); let fetchCalls = 0;
    const out = await winningPagesUnit({ ...store.deps, loadProfile: async () => emptyBusinessProfile("tw"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => NOW,
      readPageExtract: async () => ({ extract: { title: "CACHED", h1: null, wordCount: 5, headings: [], faqCount: 0 }, contentHash: "h", fetchedAt: "x" }),
      fetchPage: (async () => { fetchCalls += 1; return { ok: false }; }) as unknown as FunnelDeps["fetchPage"] })("tw", cur(), 60_000); expect(out.status).toBe("done"); expect(fetchCalls).toBe(0); // cached extract reused before any fetch
    const win = store.peek("tw", BASIS)!.winningPages; expect(win.map((w) => w.domain)).not.toContain("own.com"); expect(win[0]!.domain).toBe("b.com"); expect(win[0]!.engines).toEqual(["chatgpt"]); // AI-cited (x2) outweighs organic; its OWN appearances only
    expect(win[0]!.examplePrompts).toEqual(["best persian restaurant"]); expect(win[0]!.extract!.title).toBe("CACHED"); // real text, never the id
    const answers = win[0]!.appearances.filter((a) => a.kind === "ai_answer"); expect(answers.map((a) => a.observationMode)).toEqual(["consumer_search"]); // one citation, two modes: credited ONCE to the consumer look, never double-counted
    expect([win[0]!.extract!.openingSample, win[0]!.extract!.hasList]).toEqual([null, undefined]); // an extract persisted before the richer fields still loads: absent, never a fake zero
  });
  it("banks each priority query its OWN fetched winners ahead of the global order, at the same bounded total", async () => { const s = emptyFunnelState("tw", BASIS); const at = new Date(NOW).toISOString();
    s.serps.queries = [{ query: "iranian actors", cacheKey: null, status: "done", observedAt: at, organic: Array.from({ length: 3 }, (_, i) => ({ rank: i + 1, url: `https://o${i}.com/p`, domain: `o${i}.com`, title: null })) }];
    s.prompts.pairs = Array.from({ length: 18 }, (_, i) => ({ promptId: `pr${i}`, promptText: "q", engine: "chatgpt" as const, mode: "consumer_search" as const, cacheKey: null, status: "done" as const, observedAt: at, citationsObserved: true, citations: [{ url: `https://ai${i}.com/p`, domain: `ai${i}.com`, title: null }] }));
    const run = async (priority: string[]) => { const st = memStore(s); await winningPagesUnit({ ...st.deps, loadProfile: async () => emptyBusinessProfile("tw"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => NOW, readPageExtract: async () => null, fetchPage: (async () => ({ ok: false })) as unknown as FunnelDeps["fetchPage"] }, priority)("tw", cur(), 60_000); return st.peek("tw", BASIS)!.winningPages.map((w) => w.url); };
    expect(await run([])).not.toContain("https://o0.com/p"); // global weight alone: the AI-cited pages fill every slot and the query under investigation gets NOTHING
    const hybrid = await run(["iranian actors"]); expect(hybrid.slice(0, 2)).toEqual(["https://o0.com/p", "https://o1.com/p"]); // its own top two, best rank first, before any global fill
    expect([hybrid.length, new Set(hybrid).size]).toEqual([15, 15]); }); // one bounded total, and one page is never two winners
});
describe("evidence - my own page's actual words, read narrowly", () => {
  const row = (over: Record<string, unknown> = {}) => ({ url: "https://own.com/actors", title: "T", meta_description: "M", fetched_at: "2026-06-11T00:00:00.000Z", body_paragraph_sample: ["Iran has a deep film history."], card_texts: ["Card"], schema_entity_names: ["Person"], internal_links: [{ href: "/a", anchor_text: "A" }], ...over });
  beforeEach(() => { sb.rows = []; sb.fails = false; sb.tenant = ""; sb.urls = []; });
  it("reads only the asked tenant and the asked URLs, and refuses a wider ask instead of fanning out", async () => { sb.rows = [row(), row({ url: "https://own.com/other" })];
    const got = await loadOwnedPageBodies("t1", ["https://own.com/actors"]);
    expect([sb.tenant, sb.urls.includes("https://own.com/actors")]).toEqual(["t1", true]); // tenant AND url scoped in the query itself, never filtered after a wide read
    expect([...got.keys()]).toEqual(["own.com/actors"]); expect(got.get("own.com/actors")!.openingSample).toContain("deep film history"); // a page I did not ask about is never keyed in
    expect((await loadOwnedPageBodies("t1", ["a", "b", "c", "d"])).size).toBe(0); }); // four is past the bound: refused, never fanned out
  it("fails closed to no bodies on a broken read, and gives no body for a page with no snapshot", async () => { sb.fails = true;
    expect((await loadOwnedPageBodies("t1", ["https://own.com/actors"])).size).toBe(0); // a broken read is never an empty page
    sb.fails = false; sb.rows = [row()]; const got = await loadOwnedPageBodies("t1", ["https://own.com/actors", "https://own.com/missing"]);
    expect([got.size, got.has("own.com/missing"), got.get("own.com/actors")!.fetchedAt]).toEqual([1, false, "2026-06-11T00:00:00.000Z"]); }); // the date rides along so the caller can judge staleness
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
  it("treats word order as one subject and a changed modifier as another, so nothing buys twice", () => { expect(canonicalQueryKey("baby male names")).toBe(canonicalQueryKey("baby names male"));
    expect(canonicalQueryKey("national flag 1979")).not.toBe(canonicalQueryKey("political revolution 1979")); // a date is not an event: never collapsed together
    const dup = agenda({ pageQueries: [{ query: "national flag 1979", impressions: 900 }, { query: "national flag 1979", impressions: 400 }, { query: "1979 national flag", impressions: 300 }] }, 12);
    expect(dup.queries[0]).toBe("national flag 1979"); expect(new Set(dup.queries.map(canonicalQueryKey)).size).toBe(dup.queries.length); }); // one subject, ONE paid slot
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
    expect([MAX_RETAINED, retainDiverse(Array.from({ length: 900 }, (_, i) => kw(`k${i}`, i)), MAX_RETAINED).length]).toEqual([700, 700]); });
  it("seeds discovery from EVERY confirmed theme, bounded at twelve, and prices the retained set in ONE bounded request", async () => { const store = memStore(); const topics = Array.from({ length: 15 }, (_, i) => `gadget topic ${String(i).padStart(2, "0")}`);
    const wordy = `gadget ${Array.from({ length: 11 }, (_, i) => `w${i}`).join(" ")}`, long = `gadget ${"x".repeat(80)}`; let batch: string[] = []; const found = parsedKw([{ keyword: "gadget topic 00 review" }, { keyword: wordy }, { keyword: long }]);
    await keywordDiscoveryUnit({ ...base(profileOf("td", [], topics)), ...store.deps, callProvider: async (cap: CapabilityKey, input: unknown) => { if (cap === "labs_keyword_overview") batch = (input as { keywords: string[] }).keywords; return ok(cap === "labs_keywords_for_site" ? found : parsedKw([])); } })("td", cur(), 60_000);
    expect(store.peek("td", BASIS)!.discovery.seeds).toEqual(topics.slice(0, 12)); // the old five-seed truncation starved every theme after the fifth
    expect(batch).toEqual(["gadget topic 00 review"]); }); // over 80 characters or over 10 words: dropped BEFORE the batch, never truncated into a different keyword
});
describe("research funnel - canonical snapshot carries the research bundle", () => {
  it("surfaces the current set, its provenance, and THIS run's receipt", async () => { const s = emptyFunnelState("tg", BASIS); s.discovery.retained = [{ keyword: "saffron price", searchVolume: 500, competition: 0.4, difficulty: null, intent: "commercial", discoveredVia: "site" }];
    s.discovery.counts = { raw: 30, normalized: 20, retained: 1, rejected: 2 };
    s.prompts.intendedPairs = 2; // CANONICAL coverage: the consumer look + gemini
    s.prompts.pairs = [{ promptId: "pr", promptText: "where to buy saffron", engine: "chatgpt", mode: "consumer_search", cacheKey: null, status: "done", observedAt: "2026-07-24T00:00:00.000Z", modelServed: "gpt-4o", citationsObserved: true, citations: [{ url: "https://b.com/y", domain: "b.com", title: null }] },
      { promptId: "pr", promptText: "where to buy saffron", engine: "chatgpt", mode: "standardized_response", cacheKey: null, status: "done", observedAt: "2026-07-24T00:00:00.000Z", citationsObserved: false, citations: null }, { promptId: "pr", engine: "gemini", mode: "standardized_response", cacheKey: null, status: "pending" }];
    s.serps.queries = [{ query: "saffron price", cacheKey: null, status: "done", observedAt: "2026-07-24T00:00:00.000Z", organic: [{ rank: 1, url: "https://a.com/x", domain: "a.com", title: "A" }], aiOverview: [{ url: "https://b.com/y", domain: "b.com", title: null }] }, { query: "unavailable", cacheKey: null, status: "failed" }];
    s.serps.analyzed = 1; s.winningPages = [{ url: "https://b.com/y", domain: "b.com", engines: ["chatgpt"], examplePrompts: ["where to buy saffron"], appearances: [], fetched: false, extract: null }];
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
    s.discovery.retained[0]!.competitionLevel = "low"; s.discovery.counts.retained = routes.length;
    const snapshot = await loadEvidenceSnapshot("tl", { resolveBasis: async () => BASIS, loadState: async () => ({ state: s, rowVersion: 1 }), now: new Date("2026-07-24T00:00:00.000Z") });
    expect(snapshot.research.retainedKeywords.map((k) => [k.discoveredVia, k.seed])).toEqual(routes.map((r, i) => [r, i % 2 ? `theme ${i}` : null])); // recorded lineage, never inferred downstream
    expect(snapshot.research.retainedKeywords.map((k) => k.competitionLevel).slice(0, 2)).toEqual(["low", "high"]); // the provider's OWN label wins; only an unlabeled row falls back to the derived band
  }); });
