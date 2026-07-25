/**
 * PRODUCT - the research funnel (Slice 6, Agent B): the four executors + the
 * assembler, driven by an injected boundary fake and an in-memory store. NO network.
 */
import { describe, it, expect } from "vitest";
import { emptyBusinessProfile, type Account, type BusinessProfile, type ProfileSection } from "@/domains/account";
import type { CachedCallResult, CachedCallSpec } from "@/domains/evidence/dataforseo/funnel-boundary";
import { keywordDiscoveryUnit } from "@/domains/evidence/funnel/discovery";
import { promptObservationUnit, serpAnalysisUnit, winningPagesUnit, loadFunnelEvidence } from "@/domains/evidence/funnel/observe";
import { emptyFunnelState, type FunnelState, type FunnelPair, type FunnelSerp } from "@/domains/evidence/funnel/state";
import type { FunnelDeps } from "@/domains/evidence/funnel/shared";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";

const confirmed = <T>(value: T): ProfileSection<T> => ({ value, origin: "operator_confirmed", confidence: null, sourceUrls: [] });
function profileOf(id: string, offerings: string[], topics: string[], exclude: string[] = [], banned: string[] = []): BusinessProfile {
  const p = emptyBusinessProfile(id);
  p.offerings = confirmed(offerings);
  p.topicsToOwn = confirmed(topics);
  p.topicsToExclude = { value: exclude, origin: "inferred", confidence: null, sourceUrls: [] };
  p.constraints.value.bannedTerms = banned;
  return p;
}
const labs = (kws: { keyword: string; volume?: number }[]): unknown => ({ tasks: [{ result: [{ items: kws.map((k) => ({ keyword: k.keyword, keyword_info: { search_volume: k.volume ?? 100, competition: 0.4 } })) }] }] });
const ok = (payload: unknown, cacheKey = "ck"): CachedCallResult => ({ state: "ok", payload, costUsd: 0.01, cacheKey, modelServed: null });
const waiting = (cacheKey: string): CachedCallResult => ({ state: "waiting", cacheKey, providerTaskId: "t", detail: "posted" });
function memStore(seed?: FunnelState): Pick<FunnelDeps, "loadState" | "saveState"> {
  const store = new Map<string, FunnelState>();
  if (seed) store.set(seed.tenantId, seed);
  return { loadState: async (t) => store.get(t) ?? emptyFunnelState(t), saveState: async (t, s) => { store.set(t, s); } };
}
const baseDeps = (profile: BusinessProfile, domain = "iranopedia.com"): FunnelDeps => ({
  ...memStore(),
  loadProfile: async () => profile,
  loadCrawl: async () => null,
  getAccount: async () => ({ domain } as Account),
  now: () => 1_000_000,
});

describe("research funnel - broad then narrow discovery", () => {
  it("casts a wide net, narrows to <=150 retained with recorded reject reasons, and enriches ONLY the retained set with zero SERP spend", async () => {
    const profile = profileOf("tenant-pub", ["persian recipes", "iran travel guides"], ["nowruz", "persian food"], ["politics"], ["gambling"]);
    const bulkA = Array.from({ length: 300 }, (_, i) => ({ keyword: `persian dish number ${i}`, volume: 900 - i }));
    const bulkB = Array.from({ length: 250 }, (_, i) => ({ keyword: `iran travel spot ${i}`, volume: 700 - i }));
    const rejects = [{ keyword: "gambling bonus offer" }, { keyword: "politics debate today" }, { keyword: "login account page" }, { keyword: "totally unrelated widget gadget" }];
    const calls: { endpoint: string; payload: unknown[] }[] = [];
    const callProvider = async (s: CachedCallSpec): Promise<CachedCallResult> => {
      calls.push({ endpoint: s.endpoint, payload: s.payload });
      if (s.endpoint.endsWith("keywords_for_site/live")) return ok(labs([...bulkA, ...rejects]));
      if (s.endpoint.endsWith("ranked_keywords/live")) return ok(labs(bulkB));
      if (s.endpoint.endsWith("keyword_overview/live")) return ok(labs([]));
      return ok(labs([]));
    };
    const store = memStore();
    const out = await keywordDiscoveryUnit({ ...baseDeps(profile), ...store, callProvider })("tenant-pub", null, 60_000);

    expect(out.status).toBe("done");
    const st = await store.loadState!("tenant-pub");
    expect(st.discovery.counts.raw).toBeGreaterThanOrEqual(500);
    expect(st.discovery.retained.length).toBe(150);
    const reasons = new Set(st.discovery.rejected.map((r) => r.reason));
    expect(reasons).toEqual(new Set(["banned_term", "excluded_topic", "junk", "irrelevant"]));
    const serpCalls = calls.filter((c) => c.endpoint.startsWith("serp/"));
    expect(serpCalls.length).toBe(0);
    const overview = calls.find((c) => c.endpoint.endsWith("keyword_overview/live"));
    const overviewKw = (overview!.payload[0] as { keywords: string[] }).keywords;
    const retainedSet = new Set(st.discovery.retained.map((k) => k.keyword));
    expect(overviewKw.length).toBe(150);
    expect(overviewKw.every((k) => retainedSet.has(k))).toBe(true);
  });

  it("produces a nonempty retained set for a LOCAL SERVICE vertical with zero vertical-specific code", async () => {
    const profile = profileOf("tenant-svc", ["kitchen remodeling", "bathroom renovation"], ["home remodel"]);
    const bulk = Array.from({ length: 40 }, (_, i) => ({ keyword: `kitchen remodel quote ${i}`, volume: 200 - i }));
    const callProvider = async (s: CachedCallSpec): Promise<CachedCallResult> => (s.endpoint.endsWith("keywords_for_site/live") ? ok(labs(bulk)) : ok(labs([])));
    const store = memStore();
    const out = await keywordDiscoveryUnit({ ...baseDeps(profile), ...store, callProvider })("tenant-svc", null, 60_000);
    expect(out.status).toBe("done");
    expect((await store.loadState!("tenant-svc")).discovery.retained.length).toBeGreaterThan(0);
  });
});
describe("research funnel - prompt observation honesty", () => {
  const prompts = [{ id: "p1", text: "best persian restaurant" }, { id: "p2", text: "where to buy saffron" }];
  function promptDeps(store: Pick<FunnelDeps, "loadState" | "saveState">, rows: PromptAnswerObservation[], claudeModel: string): FunnelDeps {
    const answer = (extra: Record<string, unknown>): unknown => ({ tasks: [{ result: [{ items: [{ content: { text: "hi" }, ...extra }] }] }] });
    return {
      ...store,
      loadProfile: async () => profileOf("tenant-p", ["persian food"], ["saffron"]),
      getAccount: async () => ({ domain: "x.com" } as Account),
      loadActivePrompts: async () => prompts,
      syncHistory: async (r) => { rows.push(...r); },
      now: () => 5_000_000,
      collectTask: async () => ok(answer({ model_name: "gpt-4o", annotations: [{ url: "https://a.com/1" }] }), "ck-chat"),
      callProvider: async (s) => {
        if (s.endpoint.includes("perplexity")) return ok(answer({ model_name: "sonar", web_search: true, annotations: [] }));
        if (s.endpoint.includes("llm_scraper")) return ok(answer({ model_name: "gpt-4o", search_queries: ["persian food near me"], brands: ["BrandX"], annotations: [{ url: "https://c.com/2" }] }));
        if (s.endpoint.includes("chat_gpt/llm_responses")) return waiting("ck-chat");
        if (s.endpoint.includes("gemini")) return { state: "not_configured", cacheKey: null, detail: "off" };
        if (s.endpoint.includes("claude")) return ok(answer({ model_name: claudeModel, annotations: [{ url: "https://d.com/3" }] }));
        return { state: "error", cacheKey: null, detail: "?" };
      },
    };
  }

  it("counts a pair done only when a real answer lands, keeps webSearchReported distinct from citations, and records scraper fan-out", async () => {
    const rows: PromptAnswerObservation[] = [];
    const store = memStore();
    const out = await promptObservationUnit(promptDeps(store, rows, "claude-3-5-sonnet"))("tenant-p", null, 60_000);
    expect(out.progress.enginePairsIntended).toBe(10);
    expect(out.progress.enginePairsDone).toBe(6);
    expect(out.status).toBe("waiting");
    const st = await store.loadState!("tenant-p");
    const perp = st.prompts.pairs.find((p) => p.engine === "perplexity" && p.status === "done")!;
    expect(perp.webSearchReported).toBe(true); expect(perp.citations!.length).toBe(0);
    expect(rows.some((r) => (r.search_queries ?? []).length > 0)).toBe(true); expect(rows.length).toBe(6);
    // A capped/errored provider must PAUSE the phase (never a budget-burning busy loop).
    const capped = await promptObservationUnit({ ...promptDeps(memStore(), [], "m"), callProvider: async () => ({ state: "capped", cacheKey: null, detail: "cap reached" }), collectTask: async () => ({ state: "capped", cacheKey: null, detail: "cap reached" }) })("tenant-p", null, 60_000);
    expect(capped.status).toBe("failed");
  });

  it("writes a DISTINCT historical row when the served model changes, never merging", async () => {
    const rows: PromptAnswerObservation[] = [];
    const store = memStore();
    await promptObservationUnit(promptDeps(store, rows, "claude-3-5-sonnet"))("tenant-p", null, 60_000);
    // 8 days later the claude pairs are stale; the model served now differs.
    const later: FunnelDeps = { ...promptDeps(store, rows, "claude-4"), now: () => 5_000_000 + 8 * 24 * 3600 * 1000 };
    await promptObservationUnit(later)("tenant-p", null, 60_000);
    const claudeP1 = new Set(rows.filter((r) => r.platform === "claude" && r.prompt_id === "p1").map((r) => r.id));
    expect(claudeP1.size).toBe(2);
  });
});

describe("research funnel - SERP resume + failure honesty", () => {
  const retainedState = (): FunnelState => { const s = emptyFunnelState("tenant-s"); s.discovery.retained = [{ keyword: "a query", searchVolume: 90, competition: 0.3, difficulty: null, intent: null, discoveredVia: "site" }, { keyword: "b query", searchVolume: 80, competition: 0.3, difficulty: null, intent: null, discoveredVia: "site" }]; return s; };
  const serpBody = (): unknown => ({ tasks: [{ result: [{ items: [{ type: "organic", url: "https://a.com/x" }] }] }] });

  it("posts each query once, resumes pending via collect, and never reposts a posted key", async () => {
    const store = memStore(retainedState());
    let organicPosts = 0, collects = 0;
    const post: FunnelDeps = {
      ...store, getAccount: async () => ({ domain: "own.com" } as Account),
      callProvider: async (s) => { if (s.endpoint === "serp/google/organic/task_post") organicPosts += 1; return waiting(`ck-${(s.publicInput as { query: string }).query}`); },
      collectTask: async () => { collects += 1; return ok(serpBody()); },
      now: () => 1,
    };
    const r1 = await serpAnalysisUnit(post)("tenant-s", null, 60_000);
    expect(r1.status).toBe("waiting");
    expect(organicPosts).toBe(2);
    const r2 = await serpAnalysisUnit(post)("tenant-s", null, 60_000);
    expect(organicPosts).toBe(2); // no repost
    expect(collects).toBeGreaterThanOrEqual(2);
    expect(r2.status).toBe("done");
  });

  it("returns failed with persisted partial progress when the boundary errors mid-unit", async () => {
    const store = memStore(retainedState());
    const deps: FunnelDeps = { ...store, getAccount: async () => ({ domain: "own.com" } as Account), callProvider: async (s) => (s.endpoint === "serp/google/organic/task_post" ? { state: "error", cacheKey: null, detail: "boom" } : waiting("x")), collectTask: async () => waiting("x"), now: () => 1 };
    const out = await serpAnalysisUnit(deps)("tenant-s", null, 60_000);
    expect(out.status).toBe("failed");
    const st = await store.loadState!("tenant-s");
    expect(st.serps.queries.some((q: FunnelSerp) => q.status === "failed")).toBe(true);
  });
});

describe("research funnel - winning pages", () => {
  it("weights AI citations above organic, excludes the account's own domain, and assembles a receipt", async () => {
    const s = emptyFunnelState("tenant-w");
    s.discovery.retained = [{ keyword: "q1", searchVolume: 10, competition: 0.2, difficulty: null, intent: null, discoveredVia: "site" }];
    s.discovery.counts = { raw: 10, normalized: 8, retained: 1, rejected: 0 };
    s.serps.queries = [{ query: "q1", cacheKey: null, status: "done", organic: [{ rank: 1, url: "https://own.com/p", domain: "own.com" }, { rank: 2, url: "https://a.com/x", domain: "a.com" }], aiOverview: [{ url: "https://b.com/y", domain: "b.com" }] }];
    s.serps.analyzed = 1;
    s.prompts.pairs = [{ promptId: "pr", engine: "chatgpt", cacheKey: null, status: "done", citations: [{ url: "https://b.com/y", domain: "b.com" }] } as FunnelPair];
    const store = memStore(s);
    const deps: FunnelDeps = {
      ...store, loadProfile: async () => emptyBusinessProfile("tenant-w"), getAccount: async () => ({ domain: "own.com" } as Account), now: () => 1,
      fetchPage: (async () => ({ ok: true, status: 200, html: "<html><head><title>T</title></head><body><h1>H</h1><h2>Head</h2><p>word word word word word word word word word word</p></body></html>" })) as unknown as FunnelDeps["fetchPage"],
    };
    const out = await winningPagesUnit(deps)("tenant-w", null, 60_000);
    expect(out.status).toBe("done");
    const st = await store.loadState!("tenant-w");
    expect(st.winningPages.map((w) => w.domain)).not.toContain("own.com");
    expect(st.winningPages[0]!.domain).toBe("b.com"); // AI-cited x2 outweighs organic
    expect(st.winningPages[0]!.fetched).toBe(true);
    expect(st.winningPages[0]!.extract!.title).toBe("T");

    const evidence = await loadFunnelEvidence("tenant-w", store);
    expect(evidence.retainedKeywords.length).toBe(1);
    expect(evidence.receipt.researched).toBe(10);
    expect(evidence.receipt.retained).toBe(1);
    expect(evidence.serpCitations[0]!.aiOverviewDomains).toContain("b.com");
  });
});
