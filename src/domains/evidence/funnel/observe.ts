import "server-only";

/**
 * funnel/observe (B3-B6) - the AI-answer, SERP, and winning-page executors plus
 * the read-only snapshot assembler. Every provider call routes through the frozen
 * boundary; posted Standard tasks resume via collect and are never reposted.
 */

import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
import type { FunnelCounters, FunnelUnitFn, FunnelUnitOutcome } from "@/domains/evidence/dataforseo/funnel-boundary";
import { detectWinningPages, normalizeKeyword, parseAiAnswer, parseSerpTask, rankAndCap } from "./normalize";
import { type FunnelPair, type FunnelSerp, type FunnelState, type FunnelWinningPage } from "./state";
import { AI_EP, buildSpec, EP, EST, FRESH_MS, interp, type Interp, LANG, LOC, MODEL, resolveDeps, round, save, sha16, track, type FunnelDeps, type ResolvedDeps } from "./shared";

// ── B3: prompt observation ──────────────────────────────────────────────────

const pairKey = (p: FunnelPair) => `${p.promptId}|${p.engine}|${p.scraper ? "s" : ""}`;

function buildPairs(prompts: { id: string }[]): FunnelPair[] {
  const out: FunnelPair[] = [];
  for (const p of prompts) for (const engine of ["chatgpt", "gemini", "claude", "perplexity"] as const) out.push({ promptId: p.id, engine, cacheKey: null, status: "pending" });
  for (const p of prompts.slice(0, 20)) out.push({ promptId: p.id, engine: "chatgpt", scraper: true, cacheKey: null, status: "pending" });
  return out;
}

const aiPayload = (text: string, scraper: boolean): unknown[] => [scraper ? { user_prompt: text, force_web_search: true, expand_citations: true } : { user_prompt: text }];

function pairProgress(s: FunnelState): FunnelCounters {
  return {
    promptsChecked: new Set(s.prompts.pairs.map((p) => p.promptId)).size,
    enginePairsDone: s.prompts.pairs.filter((p) => p.status === "done").length,
    enginePairsIntended: s.prompts.intendedPairs,
    cacheHits: s.ledger.cacheHits,
    spendUsd: round(s.ledger.spentUsd),
  };
}

/** ONE historical prompt_answer_observations row per completed answer. The id folds
 *  in modelServed + day so a changed served model yields a DISTINCT row, never a merge. */
function paoRow(p: FunnelPair, parsed: ReturnType<typeof parseAiAnswer>, tenantId: string, runId: string, nowIso: string): PromptAnswerObservation {
  const domains = (parsed.citations ?? []).map((c) => c.domain);
  const model = parsed.modelServed ?? MODEL[p.engine] ?? p.engine;
  return {
    id: `${tenantId}|${p.engine}|${p.promptId}|${model}|${nowIso.slice(0, 10)}`,
    prompt_id: p.promptId,
    run_id: runId,
    answer_hash: parsed.answerText ? sha16(parsed.answerText) : null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: domains.length,
    owned_citation_count: 0,
    citation_domains: domains,
    citation_categories: {},
    mentions: [],
    observed_at: nowIso,
    platform: p.engine,
    topic: "",
    search_queries: parsed.fanOutQueries ?? undefined,
    citation_urls: (parsed.citations ?? []).map((c) => c.url),
    metadata: { source: "research-funnel", scraper: Boolean(p.scraper), webSearchReported: parsed.webSearchReported, modelServed: parsed.modelServed },
    tenant_id: tenantId,
  };
}

async function landAnswer(p: FunnelPair, r: Interp, tenantId: string, runId: string, nowIso: string, syncHistory: ResolvedDeps["syncHistory"]): Promise<void> {
  const parsed = parseAiAnswer(r.payload, Boolean(p.scraper));
  p.status = "done";
  p.cacheKey = r.cacheKey;
  p.observedAt = nowIso;
  p.modelServed = parsed.modelServed ?? r.modelServed;
  p.webSearchReported = parsed.webSearchReported;
  p.citations = (parsed.citations ?? []).map((c) => ({ url: c.url, domain: c.domain }));
  await syncHistory([paoRow(p, parsed, tenantId, runId, nowIso)], tenantId);
}

export function promptObservationUnit(deps: FunnelDeps = {}): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const unitKey = `prompts:${tenantId}`;
    const runId = (cursor?.runId as string) ?? unitKey;
    const deadline = d.now() + Math.max(1000, budgetMs);
    const state = await d.loadState(tenantId);
    const prompts = (await d.loadActivePrompts(tenantId)).slice(0, 100);
    if (prompts.length === 0) return { status: "failed", cursor, progress: pairProgress(state), detail: "I have no active core prompts to check yet." };

    const intended = buildPairs(prompts);
    const byKey = new Map(state.prompts.pairs.map((p) => [pairKey(p), p]));
    for (const ip of intended) if (!byKey.has(pairKey(ip))) byKey.set(pairKey(ip), ip);
    const pairs = [...byKey.values()];
    state.prompts.intendedPairs = intended.length;
    const textOf = new Map(prompts.map((p) => [p.id, p.text]));
    const nowIso = () => new Date(d.now()).toISOString();

    // 1) collect prior posted tasks first (never repost a posted key)
    for (const p of pairs.filter((x) => x.status === "posted" && x.cacheKey)) {
      if (d.now() > deadline) break;
      const r = interp(await d.collectTask(p.cacheKey!));
      track(state, r);
      if (r.kind === "evidence") await landAnswer(p, r, tenantId, runId, nowIso(), d.syncHistory);
      // waiting -> still pending; failed -> leave posted for a later retry
    }

    // 2) post/live the stalest pending pairs, bounded batch within budget
    const now = d.now();
    const todo = pairs
      .filter((p) => p.status === "pending" || (p.status === "done" && p.observedAt && now - Date.parse(p.observedAt) > FRESH_MS))
      .sort((a, b) => (a.observedAt ? Date.parse(a.observedAt) : 0) - (b.observedAt ? Date.parse(b.observedAt) : 0));
    let processed = 0, perp = 0;
    let progressed = false;
    let failedDetail: string | null = null;
    for (const p of todo) {
      if (d.now() > deadline || processed >= 20) break;
      const text = textOf.get(p.promptId);
      if (!text) continue;
      if (p.engine === "perplexity") {
        if (perp >= 3) continue;
        perp += 1;
        const r = interp(await d.callProvider(buildSpec(tenantId, unitKey, AI_EP.perplexity!, aiPayload(text, false), { prompt: normalizeKeyword(text), engine: "perplexity" }, "live", EST.perplexity, MODEL.perplexity)));
        track(state, r);
        if (r.kind === "waiting") { p.status = "posted"; p.cacheKey = r.cacheKey; progressed = true; }
        else if (r.kind === "evidence") { await landAnswer(p, r, tenantId, runId, nowIso(), d.syncHistory); progressed = true; }
        else if (r.kind === "failed") failedDetail = r.detail ?? "provider call failed";
      } else {
        const endpoint = p.scraper ? AI_EP.scraper! : AI_EP[p.engine]!;
        const r = interp(await d.callProvider(buildSpec(tenantId, unitKey, endpoint, aiPayload(text, Boolean(p.scraper)), { prompt: normalizeKeyword(text), engine: p.engine, scraper: Boolean(p.scraper) }, "task", p.scraper ? EST.scraper : EST.answer, MODEL[p.engine])));
        track(state, r);
        if (r.kind === "waiting") { p.status = "posted"; p.cacheKey = r.cacheKey; progressed = true; }
        else if (r.kind === "evidence") { await landAnswer(p, r, tenantId, runId, nowIso(), d.syncHistory); progressed = true; }
        else if (r.kind === "failed") failedDetail = r.detail ?? "provider call failed";
      }
      processed += 1;
    }

    state.prompts.pairs = pairs.slice(0, 500);
    await save(d, tenantId, state);
    const done = pairs.filter((p) => p.status === "done").length;
    const anyPosted = pairs.some((p) => p.status === "posted");
    // Honest status: a capped/errored provider PAUSES the run (never a busy loop);
    // "advanced" is returned ONLY when this iteration made real forward progress;
    // a zero-progress soft pass (dry-run / not configured) finishes the phase with
    // whatever coverage honestly exists rather than spinning the cycle budget.
    let status: FunnelUnitOutcome["status"];
    if (state.prompts.intendedPairs > 0 && done >= state.prompts.intendedPairs) status = "done";
    else if (failedDetail) status = "failed";
    else if (anyPosted) status = "waiting";
    else status = progressed ? "advanced" : "done";
    return { status, cursor: { runId }, progress: pairProgress(state), ...(failedDetail ? { detail: failedDetail } : {}) };
  };
}

// ── B4: SERP analysis ───────────────────────────────────────────────────────

function applySerp(s: FunnelSerp, payload: unknown): void {
  const parsed = parseSerpTask(payload);
  s.status = "done";
  s.organic = parsed.organicItems.slice(0, 10);
  s.aiOverview = (parsed.aiOverview?.references ?? []).map((r) => ({ url: r.url, domain: r.domain }));
}

const serpProgress = (s: FunnelState): FunnelCounters => ({ serpsAnalyzed: s.serps.analyzed, cacheHits: s.ledger.cacheHits, spendUsd: round(s.ledger.spentUsd) });

export function serpAnalysisUnit(deps: FunnelDeps = {}): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const unitKey = `serps:${tenantId}`;
    const deadline = d.now() + Math.max(1000, budgetMs);
    const state = await d.loadState(tenantId);
    const retained = state.discovery.retained;
    if (retained.length === 0) return { status: "failed", cursor, progress: serpProgress(state), detail: "I have no researched keywords to check in search yet." };

    const chosen = rankAndCap(retained, 40).map((k) => k.keyword);
    const byQ = new Map(state.serps.queries.map((s) => [s.query, s]));
    for (const q of chosen) if (!byQ.has(q)) byQ.set(q, { query: q, cacheKey: null, status: "pending" });
    const serps = [...byQ.values()];
    const top5 = new Set(chosen.slice(0, 5));

    // 1) collect posted organic + AI Mode tasks (never repost)
    for (const s of serps) {
      if (d.now() > deadline) break;
      if (s.status === "posted" && s.cacheKey) {
        const r = interp(await d.collectTask(s.cacheKey));
        track(state, r);
        if (r.kind === "evidence") applySerp(s, r.payload);
        else if (r.kind === "failed") s.status = "failed";
      }
      if (s.aiModeCacheKey && !s.aiModeCitations) {
        const r = interp(await d.collectTask(s.aiModeCacheKey));
        track(state, r);
        if (r.kind === "evidence") s.aiModeCitations = (parseSerpTask(r.payload).aiOverview?.references ?? []).map((x) => ({ url: x.url, domain: x.domain }));
      }
    }

    // 2) post pending organic (and AI Mode for the strongest few)
    let processed = 0;
    for (const s of serps) {
      if (d.now() > deadline || processed >= 40) break;
      if (s.status === "pending") {
        const r = interp(await d.callProvider(buildSpec(tenantId, unitKey, EP.serp, [{ keyword: s.query, location_code: LOC, language_code: LANG, load_async_ai_overview: true, people_also_ask_click_depth: 1 }], { query: s.query, ep: "serp" }, "task", EST.serp)));
        track(state, r);
        if (r.kind === "waiting") { s.status = "posted"; s.cacheKey = r.cacheKey; }
        else if (r.kind === "evidence") applySerp(s, r.payload);
        else if (r.kind === "failed") {
          s.status = "failed";
          state.serps.queries = serps.slice(0, 60);
          state.serps.analyzed = serps.filter((x) => x.status === "done").length;
          await save(d, tenantId, state);
          return { status: "failed", cursor, progress: serpProgress(state), detail: r.detail };
        }
        processed += 1;
      }
      if (top5.has(s.query) && s.aiModeCacheKey == null && s.status !== "failed") {
        const r = interp(await d.callProvider(buildSpec(tenantId, unitKey, EP.aiMode, [{ keyword: s.query, location_code: LOC, language_code: LANG }], { query: s.query, ep: "aimode" }, "task", EST.aiMode)));
        track(state, r);
        if (r.kind === "waiting") s.aiModeCacheKey = r.cacheKey;
        else if (r.kind === "evidence") { s.aiModeCacheKey = r.cacheKey; s.aiModeCitations = (parseSerpTask(r.payload).aiOverview?.references ?? []).map((x) => ({ url: x.url, domain: x.domain })); }
      }
    }

    state.serps.queries = serps.slice(0, 60);
    state.serps.analyzed = serps.filter((s) => s.status === "done").length;
    await save(d, tenantId, state);
    const anyPending = serps.some((s) => s.status === "pending" || s.status === "posted");
    const status: FunnelUnitOutcome["status"] = state.serps.analyzed >= chosen.length ? "done" : anyPending ? "waiting" : "advanced";
    return { status, cursor, progress: serpProgress(state) };
  };
}

// ── B5: winning pages ───────────────────────────────────────────────────────

export function winningPagesUnit(deps: FunnelDeps = {}): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, _cursor, budgetMs) => {
    const deadline = d.now() + Math.max(1000, budgetMs);
    const state = await d.loadState(tenantId);
    const account = await d.getAccount(tenantId).catch(() => null);
    const ownDomain = account?.domain ? rootDomain(account.domain) : null;

    const serpInputs = state.serps.queries.map((s) => ({ query: s.query, organic: s.organic ?? [], aiOverview: [...(s.aiOverview ?? []), ...(s.aiModeCitations ?? [])] }));
    const aiInputs = state.prompts.pairs.filter((p) => p.citations && p.citations.length > 0).map((p) => ({ query: p.promptId, citations: p.citations! }));
    const candidates = detectWinningPages(serpInputs, aiInputs, ownDomain, 10);
    const profile = await d.loadProfile(tenantId).catch(() => null);

    const pages: FunnelWinningPage[] = [];
    let fetched = 0;
    for (const c of candidates) {
      let extract: FunnelWinningPage["extract"] = null;
      let didFetch = false;
      if (d.now() <= deadline) {
        try {
          const res = await d.fetchPage(c.url, new Map(), {});
          if (res.ok) {
            didFetch = true;
            const snap = extractPageSnapshot(res.html, c.url, `winpage-${sha16(c.url)}`, tenantId, res.status, profile);
            extract = { title: snap.title, h1: snap.h1, wordCount: snap.word_count, headings: (snap.h2_list ?? []).slice(0, 20), faqCount: snap.faqs.length };
            fetched += 1;
          }
        } catch {
          /* fetch/extract failure -> honest fetched:false */
        }
      }
      pages.push({ url: c.url, domain: c.domain, appearances: c.appearances, fetched: didFetch, extract });
    }
    state.winningPages = pages;
    await save(d, tenantId, state);
    return { status: "done", cursor: null, progress: { winningPagesFetched: fetched, cacheHits: state.ledger.cacheHits, spendUsd: round(state.ledger.spentUsd) } };
  };
}

// ── B6: read-only snapshot assembler ────────────────────────────────────────

const competitionLevel = (c: number | null): "low" | "medium" | "high" | null => (c == null ? null : c < 0.34 ? "low" : c < 0.67 ? "medium" : "high");

export type FunnelEvidence = {
  retainedKeywords: { query: string; searchVolume: number | null; competition: number | null; competitionLevel: "low" | "medium" | "high" | null }[];
  nativeAi: { citedPages: { url: string; isOwned: boolean; citationCount: number; distinctPrompts: number; engines: string[]; examplePrompts: string[] }[]; questions: { text: string; weight: number; sourcePrompts: string[] }[]; rowsScanned: number; enginesSeen: string[] };
  serpCitations: { query: string; aiOverviewDomains: string[]; organicDomains: string[] }[];
  winningPages: FunnelWinningPage[];
  receipt: { researched: number; retained: number; stale: number; missing: number; cached: number; spentUsd: number };
};

/** Read-only: normalize the persisted funnel into snapshot-ready inputs plus an
 *  explicit missing-evidence receipt. No writes, no network. */
export async function loadFunnelEvidence(tenantId: string, deps: FunnelDeps = {}): Promise<FunnelEvidence> {
  const d = resolveDeps(deps);
  const state = await d.loadState(tenantId);
  const now = d.now();
  const donePairs = state.prompts.pairs.filter((p) => p.status === "done");
  const enginesSeen = [...new Set(donePairs.map((p) => p.engine))];
  const doneSerps = state.serps.queries.filter((s) => s.status === "done");

  const citedPages = state.winningPages.map((w) => ({ url: w.url, isOwned: false, citationCount: w.appearances.length, distinctPrompts: new Set(w.appearances.map((a) => a.query)).size, engines: enginesSeen, examplePrompts: [] }));
  const stale = donePairs.filter((p) => p.observedAt && now - Date.parse(p.observedAt) > FRESH_MS).length;
  const missing = Math.max(0, state.prompts.intendedPairs - donePairs.length) + state.serps.queries.filter((s) => s.status !== "done").length;

  return {
    retainedKeywords: state.discovery.retained.map((k) => ({ query: k.keyword, searchVolume: k.searchVolume, competition: k.competition, competitionLevel: competitionLevel(k.competition) })),
    nativeAi: { citedPages, questions: [], rowsScanned: donePairs.length, enginesSeen },
    serpCitations: doneSerps.map((s) => ({ query: s.query, aiOverviewDomains: (s.aiOverview ?? []).map((x) => x.domain), organicDomains: (s.organic ?? []).map((x) => x.domain) })),
    winningPages: state.winningPages,
    receipt: { researched: state.discovery.counts.raw, retained: state.discovery.counts.retained, stale, missing, cached: state.ledger.cacheHits, spentUsd: round(state.ledger.spentUsd) },
  };
}
