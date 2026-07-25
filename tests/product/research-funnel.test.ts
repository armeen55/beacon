/**
 * PRODUCT - the research funnel (integrity closure, Agent B): the four executors,
 * the pure projector, and the canonical snapshot, driven by injected CAPABILITY
 * fakes returning frozen Parsed* shapes + an in-memory basis-scoped state repo.
 * NO network, NO Supabase.
 */
import { describe, it, expect } from "vitest";
import { emptyBusinessProfile, type Account, type BusinessProfile, type ProfileSection } from "@/domains/account";
import type { CachedCallResult, CapabilityKey, ParsedAiAnswer, ParsedKeywordItem, ParsedSerp } from "@/domains/evidence/dataforseo/funnel-boundary";
import { keywordDiscoveryUnit } from "@/domains/evidence/funnel/discovery";
import { promptObservationUnit, serpAnalysisUnit, winningPagesUnit } from "@/domains/evidence/funnel/observe";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { emptyFunnelState, type FunnelState } from "@/domains/evidence/funnel/state";
import type { FunnelDeps } from "@/domains/evidence/funnel/shared";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";

const BASIS = "basis_aaa";
const cur = (basis: string | null = BASIS) => (basis ? { basis } : {});
const confirmed = <T>(value: T): ProfileSection<T> => ({ value, origin: "operator_confirmed", confidence: null, sourceUrls: [] });
function profileOf(id: string, offerings: string[], topics: string[], exclude: string[] = [], banned: string[] = []): BusinessProfile {
  const p = emptyBusinessProfile(id);
  p.offerings = confirmed(offerings);
  p.topicsToOwn = confirmed(topics);
  p.topicsToExclude = { value: exclude, origin: "inferred", confidence: null, sourceUrls: [] };
  p.constraints.value.bannedTerms = banned;
  return p;
}
const parse = ((_c: unknown, env: unknown) => env) as unknown as FunnelDeps["parse"];
const parsedKw = (kws: { keyword: string; volume?: number }[]): ParsedKeywordItem[] =>
  kws.map((k) => ({ keyword: k.keyword, searchVolume: k.volume ?? 100, cpcUsd: null, competition: 0.4, difficulty: null, intent: "informational", monthlySearches: [] }));
const aiAnswer = (over: Partial<ParsedAiAnswer> = {}): ParsedAiAnswer =>
  ({ answerText: "hi", modelServed: null, webSearchReported: null, citations: null, fanOutQueries: null, brands: null, ...over });
const serp = (organic: ParsedSerp["organic"], aiOver: ParsedSerp["organic"] | null = null): ParsedSerp =>
  ({ organic, aiOverview: aiOver ? { present: true, references: aiOver.map((o) => ({ url: o.url, domain: o.domain, title: o.title })), excerpt: null } : null, snippetOwner: null, paaQuestions: [], relatedSearches: [] });
const ok = (parsed: unknown, cacheKey = "ck", modelServed: string | null = null): CachedCallResult => ({ state: "ok", envelope: parsed as never, costUsd: 0.01, cacheKey, modelServed });
const waiting = (cacheKey: string): CachedCallResult => ({ state: "waiting", cacheKey, providerTaskId: "t", detail: "posted" });

function memStore(seed?: FunnelState) {
  const rows = new Map<string, { state: FunnelState; rowVersion: number }>();
  if (seed) rows.set(`${seed.tenantId}|${seed.basisTag}`, { state: seed, rowVersion: 1 });
  const clone = (s: FunnelState): FunnelState => structuredClone(s); // the real repo decodes a fresh object per load
  return {
    deps: {
      loadState: async (t: string, b: string) => {
        const row = rows.get(`${t}|${b}`);
        return row ? { state: clone(row.state), rowVersion: row.rowVersion } : { state: emptyFunnelState(t, b), rowVersion: 0 };
      },
      saveState: async (t: string, b: string, s: FunnelState, expected: number) => {
        const key = `${t}|${b}`;
        if ((rows.get(key)?.rowVersion ?? 0) !== expected) return null;
        const next = expected + 1;
        rows.set(key, { state: clone(s), rowVersion: next });
        return next;
      },
    } satisfies Pick<FunnelDeps, "loadState" | "saveState">,
    peek: (t: string, b: string) => rows.get(`${t}|${b}`)?.state,
  };
}
const base = (profile: BusinessProfile, domain = "iranopedia.com"): FunnelDeps =>
  ({ loadProfile: async () => profile, loadCrawl: async () => null, getAccount: async () => ({ domain } as Account), resolveModel: async () => null, parse, now: () => 1_000_000 });

describe("research funnel - basis-scoped discovery + isolation", () => {
  const profile = profileOf("t1", ["persian recipes"], ["nowruz", "persian food"], ["politics"], ["gambling"]);
  const bulk = Array.from({ length: 60 }, (_, i) => ({ keyword: `persian food dish ${i}`, volume: 900 - i }));
  const rejects = [{ keyword: "gambling bonus offer" }, { keyword: "politics debate today" }, { keyword: "login account page" }, { keyword: "unrelated widget gadget" }];
  const callProvider = async (cap: CapabilityKey) => (cap === "labs_keywords_for_site" ? ok(parsedKw([...bulk, ...rejects])) : ok(parsedKw([])));

  it("persists retained under the cursor basis; a different basis reads empty; a second tenant shares nothing", async () => {
    const store = memStore();
    const out = await keywordDiscoveryUnit({ ...base(profile), ...store.deps, callProvider })("t1", cur(), 60_000);
    expect(out.status).toBe("done");
    const st = store.peek("t1", BASIS)!;
    expect(st.discovery.retained.length).toBeGreaterThan(0);
    expect(new Set(st.discovery.rejected.map((r) => r.reason))).toEqual(new Set(["banned_term", "excluded_topic", "junk", "irrelevant"]));
    expect(store.peek("t1", "basis_other")).toBeUndefined();
    await keywordDiscoveryUnit({ ...base(profileOf("t2", ["persian recipes"], ["persian food"])), ...store.deps, callProvider })("t2", cur(), 60_000);
    expect(store.peek("t2", BASIS)!.discovery.retained.length).toBeGreaterThan(0);
    expect(store.peek("t1", BASIS)!.discovery.retained.length).toBe(st.discovery.retained.length);
  });

  it("fails closed with a plain detail when the cursor carries no basis", async () => {
    const store = memStore();
    const out = await keywordDiscoveryUnit({ ...base(profile), ...store.deps, callProvider })("t1", cur(null), 60_000);
    expect(out.status).toBe("failed");
    expect(out.detail && out.detail.length).toBeTruthy();
    expect(store.peek("t1", BASIS)).toBeUndefined();
  });

  it("does not corrupt persisted state when an optimistic save conflicts (fail closed)", async () => {
    const seed = emptyFunnelState("t1", BASIS);
    seed.discovery.retained = [{ keyword: "keep me", searchVolume: 9, competition: 0.2, difficulty: null, intent: null, discoveredVia: "site" }];
    const store = memStore(seed);
    // A concurrent writer moved the row: every save now conflicts.
    const out = await keywordDiscoveryUnit({ ...base(profile), ...store.deps, saveState: async () => null, callProvider })("t1", cur(), 60_000);
    expect(out.status).toBe("failed");
    expect(store.peek("t1", BASIS)!.discovery.retained[0]!.keyword).toBe("keep me"); // persisted row untouched
  });
});

describe("research funnel - prompt observation honesty", () => {
  const prompts = [{ id: "p1", text: "best persian restaurant" }, { id: "p2", text: "where to buy saffron" }];
  function deps(store: ReturnType<typeof memStore>, rows: PromptAnswerObservation[], claudeModel: string): FunnelDeps {
    return {
      ...store.deps, loadProfile: async () => profileOf("tp", ["persian food"], ["saffron"]), resolveModel: async () => null, parse,
      loadActivePrompts: async () => prompts, syncHistory: async (r) => { rows.push(...r); }, now: () => 5_000_000,
      collectTask: async () => ok(aiAnswer({ modelServed: "gpt-4o", citations: [{ url: "https://a.com/1", domain: "a.com", title: null }] }), "ck-chat"),
      callProvider: async (cap: CapabilityKey) => {
        if (cap === "llm_perplexity") return ok(aiAnswer({ modelServed: "sonar", webSearchReported: true, citations: [] }));
        if (cap === "llm_scraper_chatgpt") return ok(aiAnswer({ modelServed: "gpt-4o", citations: [{ url: "https://c.com/2", domain: "c.com", title: null }], fanOutQueries: ["persian food near me"] }));
        if (cap === "llm_chatgpt") return waiting("ck-chat");
        if (cap === "llm_gemini") return ok(aiAnswer({ citations: null }));
        return ok(aiAnswer({ modelServed: claudeModel, citations: [{ url: "https://d.com/3", domain: "d.com", title: null }] }));
      },
    };
  }

  it("keeps webSearchReported distinct from citations and preserves the null-vs-[] citation tri-state", async () => {
    const rows: PromptAnswerObservation[] = [];
    const store = memStore();
    const out = await promptObservationUnit(deps(store, rows, "claude-3-5-sonnet"))("tp", cur(), 60_000);
    expect(out.progress.enginePairsIntended).toBe(10);
    expect(out.status).toBe("waiting"); // chatgpt pairs are posted, resumed via collect next pass
    const st = store.peek("tp", BASIS)!;
    const perp = st.prompts.pairs.find((p) => p.engine === "perplexity" && p.status === "done")!;
    expect(perp.webSearchReported).toBe(true); expect(perp.citations).toEqual([]); expect(perp.citationsObserved).toBe(true);
    const gem = st.prompts.pairs.find((p) => p.engine === "gemini" && p.status === "done")!;
    expect(gem.citations).toBeNull(); expect(gem.citationsObserved).toBe(false);
    const perpRow = rows.find((r) => r.platform === "perplexity")!;
    expect(perpRow.citation_urls).toEqual([]); expect(perpRow.metadata.citationsObserved).toBe(true);
    const gemRow = rows.find((r) => r.platform === "gemini")!;
    expect(gemRow.citation_urls).toBeNull(); expect(gemRow.metadata.citationsObserved).toBe(false);
    expect(rows.some((r) => (r.search_queries ?? []).length > 0)).toBe(true);
  });

  it("writes a DISTINCT history row when the served model changes, never merging", async () => {
    const rows: PromptAnswerObservation[] = [];
    const store = memStore();
    await promptObservationUnit(deps(store, rows, "claude-3-5-sonnet"))("tp", cur(), 60_000);
    const later: FunnelDeps = { ...deps(store, rows, "claude-4"), now: () => 5_000_000 + 8 * 24 * 3600 * 1000 };
    await promptObservationUnit(later)("tp", cur(), 60_000);
    const claudeP1 = new Set(rows.filter((r) => r.platform === "claude" && r.prompt_id === "p1").map((r) => r.id));
    expect(claudeP1.size).toBe(2);
  });
});

describe("research funnel - SERP resume + winning-page provenance", () => {
  const retainedState = (): FunnelState => {
    const s = emptyFunnelState("ts", BASIS);
    s.discovery.retained = [{ keyword: "a query", searchVolume: 90, competition: 0.3, difficulty: null, intent: null, discoveredVia: "site" }, { keyword: "b query", searchVolume: 80, competition: 0.3, difficulty: null, intent: null, discoveredVia: "site" }];
    return s;
  };

  it("posts each query once, resumes pending via collect, and never reposts a posted key", async () => {
    const store = memStore(retainedState());
    let posts = 0, collects = 0;
    const deps: FunnelDeps = {
      ...store.deps, getAccount: async () => ({ domain: "own.com" } as Account), parse, now: () => 1,
      callProvider: async (cap: CapabilityKey, input) => { if (cap === "serp_organic") posts += 1; return waiting(`ck-${(input as { keyword: string }).keyword}`); },
      collectTask: async () => { collects += 1; return ok(serp([{ rank: 1, domain: "a.com", url: "https://a.com/x", title: "A" }])); },
    };
    const r1 = await serpAnalysisUnit(deps)("ts", cur(), 60_000);
    expect(r1.status).toBe("waiting"); expect(posts).toBe(2);
    const r2 = await serpAnalysisUnit(deps)("ts", cur(), 60_000);
    expect(posts).toBe(2); expect(collects).toBeGreaterThanOrEqual(2); expect(r2.status).toBe("done");
  });

  it("attributes each winning page to its OWN engines/prompts, excludes the own domain, and reuses a cached extract before any fetch", async () => {
    const s = emptyFunnelState("tw", BASIS);
    s.discovery.counts = { raw: 10, normalized: 8, retained: 1, rejected: 0 };
    s.serps.queries = [{ query: "q1", cacheKey: null, status: "done", organic: [{ rank: 1, url: "https://own.com/p", domain: "own.com", title: null }, { rank: 2, url: "https://a.com/x", domain: "a.com", title: "A" }], aiOverview: [{ url: "https://b.com/y", domain: "b.com", title: null }] }];
    s.prompts.pairs = [{ promptId: "pr", promptText: "best persian restaurant", engine: "chatgpt", cacheKey: null, status: "done", observedAt: "2026-07-24T00:00:00.000Z", modelServed: "gpt-4o", citationsObserved: true, citations: [{ url: "https://b.com/y", domain: "b.com", title: null }] }];
    const store = memStore(s);
    let fetchCalls = 0;
    const deps: FunnelDeps = {
      ...store.deps, loadProfile: async () => emptyBusinessProfile("tw"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => 1,
      readPageExtract: async () => ({ extract: { title: "CACHED", h1: null, wordCount: 5, headings: [], faqCount: 0 }, contentHash: "h", fetchedAt: "x" }),
      fetchPage: (async () => { fetchCalls += 1; return { ok: false }; }) as unknown as FunnelDeps["fetchPage"],
    };
    const out = await winningPagesUnit(deps)("tw", cur(), 60_000);
    expect(out.status).toBe("done");
    expect(fetchCalls).toBe(0); // cached extract reused before any fetch
    const win = store.peek("tw", BASIS)!.winningPages;
    expect(win.map((w) => w.domain)).not.toContain("own.com");
    const top = win[0]!;
    expect(top.domain).toBe("b.com"); // AI-cited (x2) outweighs organic
    expect(top.engines).toEqual(["chatgpt"]); // its OWN appearances only
    expect(top.examplePrompts).toEqual(["best persian restaurant"]); // real text, never the id
    expect(top.extract!.title).toBe("CACHED");
  });
});

describe("research funnel - canonical snapshot carries the research bundle", () => {
  it("surfaces retained keywords, AI observations, SERP evidence, winning pages, and the receipt", async () => {
    const s = emptyFunnelState("tg", BASIS);
    s.discovery.retained = [{ keyword: "saffron price", searchVolume: 500, competition: 0.4, difficulty: null, intent: "commercial", discoveredVia: "site" }];
    s.discovery.counts = { raw: 30, normalized: 20, retained: 1, rejected: 2 };
    s.prompts.intendedPairs = 1;
    s.prompts.pairs = [{ promptId: "pr", promptText: "where to buy saffron", engine: "chatgpt", cacheKey: null, status: "done", observedAt: "2026-07-24T00:00:00.000Z", modelServed: "gpt-4o", citationsObserved: true, citations: [{ url: "https://b.com/y", domain: "b.com", title: null }] }];
    s.serps.queries = [{ query: "saffron price", cacheKey: null, status: "done", organic: [{ rank: 1, url: "https://a.com/x", domain: "a.com", title: "A" }], aiOverview: [{ url: "https://b.com/y", domain: "b.com", title: null }] }];
    s.serps.analyzed = 1;
    s.winningPages = [{ url: "https://b.com/y", domain: "b.com", engines: ["chatgpt"], examplePrompts: ["where to buy saffron"], appearances: [], fetched: false, extract: null }];
    const snapshot = await loadEvidenceSnapshot("tg", { resolveBasis: async () => BASIS, loadState: async () => ({ state: s, rowVersion: 1 }), now: new Date("2026-07-24T00:00:00.000Z") });
    expect(snapshot.research.retainedKeywords[0]!.intent).toBe("commercial");
    expect(snapshot.research.aiObservations[0]!.promptText).toBe("where to buy saffron");
    expect(snapshot.research.serpEvidence[0]!.aiOverview[0]!.domain).toBe("b.com");
    expect(snapshot.research.winningPages[0]!.examplePrompts).toEqual(["where to buy saffron"]);
    expect(snapshot.research.receipt.retained).toBe(1);
    expect(snapshot.keywordDemand.some((k) => k.query === "saffron price")).toBe(true);
  });
});
