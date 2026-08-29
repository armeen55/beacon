/** PRODUCT - the acquisition policy: WHAT COUNTS AS CURRENT, and WHAT A RUN MAY SPEND. One freshness matrix replaces the single seven-day constant, so a search a frozen case is stuck on is re-bought after a DAY while an unfocused one keeps the week, a page of the account's own is re-read the moment something changed it underneath me, and the recurring-domains capability parses exactly what the provider documents. Plus the raised monthly ceilings. No network, no Supabase, no spend. */
import { describe, it, expect } from "vitest";
import { emptyBusinessProfile, type Account, type BusinessProfile } from "@/domains/account";
import type { CachedCallResult, CapabilityKey, ParsedSerp, ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
import { parseCapability, providerCall } from "@/domains/evidence/dataforseo/capabilities";
import { writePublicPageExtract } from "@/domains/evidence/dataforseo/funnel-boundary";
import { labsKeywordsForSiteLive } from "../fixtures/dataforseo-envelopes";
import { DEFAULT_MONTHLY_CAP_USD, monthlyCapUsd } from "@/domains/evidence/dataforseo/client";
import { DEFAULT_GLOBAL_MONTHLY_CAP_USD, decideBreaker } from "@/lib/cost/cost-breaker";
import { serpAnalysisUnit } from "@/domains/evidence/funnel/observe";
import { winningPagesUnit } from "@/domains/evidence/funnel/winning-pages";
import { emptyFunnelState, type FunnelState } from "@/domains/evidence/funnel/state";
import { freshnessMsFor, isCurrent } from "@/domains/evidence/freshness";
import type { FunnelDeps } from "@/domains/evidence/funnel/shared";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
const BASIS = "basis_aaa", NOW = 1_700_000_000_000, DAY = 86_400_000;
const cur = () => ({ basis: BASIS });
const at = (ms: number) => new Date(ms).toISOString();
const parse = ((_c: unknown, env: unknown) => env) as unknown as FunnelDeps["parse"];
const serp = (organic: ParsedSerp["organic"]): ParsedSerp => ({ organic, aiOverview: null, paaQuestions: [], relatedSearches: [] });
const ok = (parsed: unknown, cacheKey = "ck"): CachedCallResult => ({ state: "ok", envelope: parsed as never, costUsd: 0.01, cacheKey, modelServed: null });
function memStore(seed: FunnelState) {
  const rows = new Map<string, { state: FunnelState; rowVersion: number }>([[`${seed.tenantId}|${seed.basisTag}`, { state: seed, rowVersion: 1 }]]);
  const clone = (s: FunnelState): FunnelState => structuredClone(s);
  const deps = { loadState: async (t: string, b: string) => { const row = rows.get(`${t}|${b}`)!; return { state: clone(row.state), rowVersion: row.rowVersion }; },
    saveState: async (t: string, b: string, s: FunnelState, expected: number) => { const k = `${t}|${b}`; if ((rows.get(k)?.rowVersion ?? 0) !== expected) return null; rows.set(k, { state: clone(s), rowVersion: expected + 1 }); return expected + 1; } } satisfies Pick<FunnelDeps, "loadState" | "saveState">;
  return { deps, peek: (t: string, b: string) => rows.get(`${t}|${b}`)?.state };}
describe("the freshness matrix", () => {
  it("gives every kind of evidence its own window, and history no window at all", () => {
    expect([freshnessMsFor("serp_hot"), freshnessMsFor("serp_cold"), freshnessMsFor("keyword_volume"), freshnessMsFor("owned_page"), freshnessMsFor("winner_extract")])
      .toEqual([DAY, 7 * DAY, 30 * DAY, 7 * DAY, 30 * DAY]); // one day, one week, one month, one week, one month
    expect(isCurrent("historical", at(NOW - 900 * DAY), NOW)).toBe(true); // a dated read of a day that has passed is what happened; it can never go stale
    expect(isCurrent("serp_cold", null, NOW)).toBe(false); // an UNDATED look is not a current look, and never was
    expect(isCurrent("serp_cold", "not a date", NOW)).toBe(false); // a date I cannot read is not a date I can keep
  });
  it("a change underneath me beats the clock either way", () => {
    const read = at(NOW - 2 * DAY);
    expect(isCurrent("owned_page", read, NOW)).toBe(true); // two days into a seven day window
    expect(isCurrent("owned_page", read, NOW, at(NOW - DAY))).toBe(false); // the page changed AFTER I read it: recent, and no longer about the page that exists
    expect(isCurrent("owned_page", read, NOW, at(NOW - 5 * DAY))).toBe(true); // it changed BEFORE I read it, so my read already saw the change
  });});
describe("what the matrix actually buys", () => {
  /** HALF THE MATRIX WAS DECORATIVE: the windows above said a month while the row holding the evidence expired in a week, so a page every side of the product still called current was thrown away and bought back. The cache lifetime IS the matrix now, on the ask and on the banked body alike. */
  const written: Record<string, unknown>[] = [];
  const deps = { env: { DATAFORSEO_AUTH_B64: "abc" } as unknown as NodeJS.ProcessEnv, now: () => new Date(NOW),
    fetchImpl: (async () => new Response(JSON.stringify(labsKeywordsForSiteLive), { status: 200 })) as unknown as typeof fetch,
    claimEvidenceFetch: async () => ({ outcome: "claimed", payload: null, providerTaskId: null, modelServed: null, readyAt: null, costUsd: 0 }),
    reserveProviderSpend: async () => true, adjustProviderSpend: async () => true, breaker: async () => ({ tripped: false }), cacheRead: async () => null,
    cacheWrite: async (_k: string, patch: Record<string, unknown>) => void written.push(patch), cacheUpsert: async (_k: string, r: Record<string, unknown>) => void written.push(r) };
  const lived = () => Date.parse(String(written.filter((w) => w.status === "ready").at(-1)!.expires_at)) - NOW;
  it("keeps a priced keyword row and a banked body for exactly as long as the matrix calls them current", async () => {
    for (const cap of ["labs_keyword_overview", "labs_keyword_ideas"] as const) {
      await providerCall(cap, { keywords: ["saffron"] }, { tenantId: "t", unitKey: "u" }, deps as never);
      expect([cap, lived()]).toEqual([cap, freshnessMsFor("keyword_volume")]); } // volume is reported monthly: a weekly ttl re-bought identical numbers 4x a month
    await writePublicPageExtract("https://a.example/p", { title: "T" }, "hash", deps as never);
    expect(lived()).toBe(freshnessMsFor("winner_extract")); }); // and a body the projection still reads as current is a body the store still holds
});
describe("hot versus cold searches", () => {
  const state = (): FunnelState => { const s = emptyFunnelState("ts", BASIS);
    s.discovery.retained = ["hot query", "cold query"].map((keyword, i) => ({ keyword, searchVolume: 90 - i, competition: 0.3, difficulty: null, intent: null, discoveredVia: "site" as const }));
    s.serps.queries = [{ query: "hot query", cacheKey: null, status: "done", observedAt: at(NOW - 2 * DAY) }, { query: "cold query", cacheKey: null, status: "done", observedAt: at(NOW - 2 * DAY) }];
    s.serps.analyzed = 2; return s; };
  const run = async (priority: string[]) => { const store = memStore(state()); const bought: string[] = [];
    await serpAnalysisUnit({ ...store.deps, parse, now: () => NOW, loadProfile: async () => emptyBusinessProfile("ts"), loadPageQueries: async () => [],
      callProvider: (async (cap: CapabilityKey, input: { keyword: string }) => { if (cap === "serp_organic") bought.push(input.keyword); return ok(serp([])); }) as FunnelDeps["callProvider"] }, priority)("ts", cur(), 60_000);
    return bought; };
  it("re-buys a search a frozen case is stuck on after a DAY, and leaves every other search alone until the week is up", async () => {
    expect(await run([])).toEqual([]); // nothing is named, so both two-day-old looks are still current
    expect(await run(["hot query"])).toEqual(["hot query"]); // named by the plan, the same look is due; the unnamed one is untouched at the same age
    expect(await run(["Hot  Query!"])).toEqual(["hot query"]); // the plan's own wording, not a second identity
  });});
describe("the ONE page of the account's own, and what makes it due", () => {
  const U = "own.com/nowruz", ABS = `https://${U}`;
  const page = { ok: true, html: "<html><body><h1>Nowruz</h1><p>How a nowruz table is set out.</p></body></html>", status: 200 };
  const run = async (fetchedAt: string, bustedAt: string | null) => { const store = memStore(emptyFunnelState("to", BASIS)); const tried: string[] = [];
    const bodies = new Map<string, { fetchedAt: string }>([[canonicalUrlKey(U), { fetchedAt }]]);
    await winningPagesUnit({ ...store.deps, parse, now: () => NOW, loadProfile: async () => emptyBusinessProfile("to") as BusinessProfile, getAccount: async () => ({ domain: "own.com" } as Account), readPageExtract: async () => null,
      readOwnedBodies: (async () => bodies) as unknown as FunnelDeps["readOwnedBodies"], writeOwnedPage: async () => {},
      fetchPage: (async (url: string) => { tried.push(url); return page; }) as unknown as FunnelDeps["fetchPage"] }, [], null, U, bustedAt)("to", cur(), 60_000);
    return tried; };
  it("is not re-read inside its window, is re-read once the window lapses, and is re-read the moment something changed it", async () => {
    expect(await run(at(NOW - 2 * DAY), null)).toEqual([]); // a body two days old is the read: zero fetches of the customer's own website
    expect(await run(at(NOW - 9 * DAY), null)).toEqual([ABS]); // past the week, the body is due
    expect(await run(at(NOW - 2 * DAY), at(NOW - DAY))).toEqual([ABS]); // recent, but the page changed after I read it, so what I hold is not the page
  });});
describe("the recurring winning domains capability (dataforseo_labs/google/serp_competitors/live)", () => {
  /** The DOCUMENTED response shape, verified against docs.dataforseo.com on 2026-07-31: result[0] carries se_type, seed_keywords, location_code, language_code, total_count, items_count and items; each item carries its metrics as FLAT fields, never a nested metrics object. */
  const envelope: ProviderEnvelope = { status_code: 20000, cost: 0.0105, tasks: [{ status_code: 20000, result: [{
    se_type: "google", seed_keywords: ["phone"], location_code: 2840, language_code: "en", total_count: 86, items_count: 3,
    items: [
      { se_type: "google", domain: "apple.com", avg_position: 3, median_position: 2, rating: 812, etv: 41.2, keywords_count: 9, visibility: 0.41, relevant_serp_items: 9, keywords_positions: { phone: [1, 3] } },
      { se_type: "google", domain: "samsung.com", avg_position: 7, median_position: 6, rating: 410, etv: 12.0, keywords_count: 4, visibility: 0.12, relevant_serp_items: 4, keywords_positions: { phone: [7] } },
      { se_type: "google", domain: "", avg_position: 1, rating: 900, keywords_count: 1 },
      { se_type: "google", domain: "gsmarena.com", rating: null, keywords_count: null },
    ] }] }] } as ProviderEnvelope;
  it("keeps the domain, its average position and how much of the set it comes up for, and never invents a metric it was not sent", () => {
    expect(parseCapability("labs_serp_competitors", envelope)).toEqual([
      { domain: "apple.com", avgPosition: 3, rating: 812, keywordsCount: 9 },
      { domain: "samsung.com", avgPosition: 7, rating: 410, keywordsCount: 4 },
      { domain: "gsmarena.com", avgPosition: null, rating: null, keywordsCount: null }, // absent is null, never a fake zero
    ]); // a row with no domain is not a competitor and is dropped
    expect(parseCapability("labs_serp_competitors", { status_code: 20000, tasks: [{ result: [] }] } as ProviderEnvelope)).toEqual([]); // an empty answer reads empty, never a throw
  });});
describe("the monthly ceilings", () => {
  it("holds a real research month at $250 an account and $500 across everything", () => {
    expect([DEFAULT_MONTHLY_CAP_USD, monthlyCapUsd({} as never)]).toEqual([250, 250]);
    expect(monthlyCapUsd({ DATAFORSEO_MONTHLY_CAP_USD: "-1" } as never)).toBe(250); // never unlimited
    expect(DEFAULT_GLOBAL_MONTHLY_CAP_USD).toBe(500);
    expect(decideBreaker({ spentUsd: 60, capUsd: DEFAULT_MONTHLY_CAP_USD, projectedUsd: 0.05 }).tripped).toBe(false); // $60 of research this month keeps going
    expect(decideBreaker({ spentUsd: 260, capUsd: DEFAULT_MONTHLY_CAP_USD, projectedUsd: 0.05 }).tripped).toBe(true); // $260 is past the account's ceiling and stops
    expect(decideBreaker({ spentUsd: null, capUsd: DEFAULT_GLOBAL_MONTHLY_CAP_USD, projectedUsd: 0.05 }).tripped).toBe(true); // a spend I cannot confirm still fails closed
  });});
