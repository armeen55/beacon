import "server-only";

/**
 * funnel/observe (integrity closure) - the AI-answer, SERP, and winning-page
 * executors plus the PURE snapshot projector. Every provider call routes through
 * the frozen boundary by CAPABILITY and consumes the registry's typed parse
 * output; posted Standard tasks resume via collect and are never reposted. All
 * state is basis-scoped with optimistic row_version. Provenance is TRUE: every
 * winning-page appearance carries its own query/prompt/engine, and citations
 * preserve the null-vs-[]-vs-nonempty tri-state end to end.
 */

import { basisTag } from "@/domains/account";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
import type { CapabilityKey, FunnelCounters, FunnelUnitFn, FunnelUnitOutcome, ParsedAiAnswer, ParsedSerp } from "@/domains/evidence/dataforseo/funnel-boundary";
import { normalizeKeyword, rankAndCap, rankWinningPages } from "./normalize";
import { type FunnelPair, type FunnelSerp, type FunnelState, type FunnelWinningPage } from "./state";
import {
  emptyResearchEvidence,
  type FunnelResearchEvidence,
  type ResearchEngine,
  type ResearchPageExtract,
  type ResearchWinningAppearance,
} from "./research-evidence";
import {
  basisFromCursor, CONFLICT_DETAIL, FRESH_MS, interp, type Interp, NO_BASIS_DETAIL,
  resolveDeps, round, save, type SaveCtx, sha16, StateConflictError, track, type FunnelDeps, type ResolvedDeps,
} from "./shared";

// ── B3: prompt observation ──────────────────────────────────────────────────

const ENGINES: ResearchEngine[] = ["chatgpt", "gemini", "claude", "perplexity"];
const pairKey = (p: FunnelPair) => `${p.promptId}|${p.engine}|${p.scraper ? "s" : ""}`;
const capabilityFor = (p: FunnelPair): CapabilityKey => (p.scraper ? "llm_scraper_chatgpt" : (`llm_${p.engine}` as CapabilityKey));

function buildPairs(prompts: { id: string }[]): FunnelPair[] {
  const out: FunnelPair[] = [];
  for (const p of prompts) for (const engine of ENGINES) out.push({ promptId: p.id, engine, cacheKey: null, status: "pending" });
  for (const p of prompts.slice(0, 20)) out.push({ promptId: p.id, engine: "chatgpt", scraper: true, cacheKey: null, status: "pending" });
  return out;
}

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
 *  in modelServed + day so a changed served model yields a DISTINCT row, never a
 *  merge. citation_urls is null (not []) when citations were NOT observable, and
 *  metadata.citationsObserved records the tri-state a count-of-0 would flatten. */
function paoRow(p: FunnelPair, parsed: ParsedAiAnswer, tenantId: string, runId: string, nowIso: string): PromptAnswerObservation {
  const domains = (parsed.citations ?? []).map((c) => c.domain);
  const observed = parsed.citations !== null;
  const model = parsed.modelServed ?? p.modelRequested ?? p.engine;
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
    citation_urls: observed ? (parsed.citations ?? []).map((c) => c.url) : null,
    metadata: {
      source: "research-funnel",
      scraper: Boolean(p.scraper),
      webSearchReported: parsed.webSearchReported,
      modelServed: parsed.modelServed,
      modelRequested: p.modelRequested ?? null,
      citationsObserved: observed,
      prompt_text: p.promptText ?? "",
    },
    tenant_id: tenantId,
  };
}

async function landAnswer(p: FunnelPair, r: Interp, parsed: ParsedAiAnswer, promptText: string, tenantId: string, runId: string, nowIso: string, syncHistory: ResolvedDeps["syncHistory"]): Promise<void> {
  p.status = "done";
  p.cacheKey = r.cacheKey;
  p.observedAt = nowIso;
  p.promptText = promptText;
  p.modelServed = parsed.modelServed ?? r.modelServed;
  p.webSearchReported = parsed.webSearchReported;
  p.citationsObserved = parsed.citations !== null;
  p.citations = parsed.citations ? parsed.citations.map((c) => ({ url: c.url, domain: c.domain, title: c.title })) : null;
  p.fanOutQueries = parsed.fanOutQueries;
  p.answerHash = parsed.answerText ? sha16(parsed.answerText) : null;
  await syncHistory([paoRow(p, parsed, tenantId, runId, nowIso)], tenantId);
}

export function promptObservationUnit(deps: FunnelDeps = {}): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const unitKey = `prompts:${tenantId}`;
    const ids = { tenantId, unitKey };
    const runId = (cursor?.runId as string) ?? unitKey;
    const deadline = d.now() + Math.max(1000, budgetMs);
    const loaded = await d.loadState(tenantId, basis);
    const state = loaded.state;
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion };
    const prompts = (await d.loadActivePrompts(tenantId)).slice(0, 100);
    if (prompts.length === 0) return { status: "failed", cursor, progress: pairProgress(state), detail: "I have no active core prompts to check yet." };

    const intended = buildPairs(prompts);
    const byKey = new Map(state.prompts.pairs.map((p) => [pairKey(p), p]));
    for (const ip of intended) if (!byKey.has(pairKey(ip))) byKey.set(pairKey(ip), ip);
    const pairs = [...byKey.values()];
    state.prompts.intendedPairs = intended.length;
    const textOf = new Map(prompts.map((p) => [p.id, p.text]));
    const nowIso = () => new Date(d.now()).toISOString();
    const modelCache = new Map<ResearchEngine, string | null>();
    const modelFor = async (engine: ResearchEngine): Promise<string | null> => {
      if (!modelCache.has(engine)) modelCache.set(engine, await d.resolveModel(engine).catch(() => null));
      return modelCache.get(engine) ?? null;
    };

    try {
      // 1) collect prior posted tasks first (never repost a posted key)
      for (const p of pairs.filter((x) => x.status === "posted" && x.cacheKey)) {
        if (d.now() > deadline) break;
        const r = interp(await d.collectTask(p.cacheKey!));
        track(state, r);
        if (r.kind === "evidence") {
          const parsed = d.parse(capabilityFor(p), r.payload as never) as ParsedAiAnswer | null;
          if (parsed) await landAnswer(p, r, parsed, textOf.get(p.promptId) ?? p.promptText ?? "", tenantId, runId, nowIso(), d.syncHistory);
        }
      }

      // 2) post/live the stalest pending pairs, bounded batch within budget
      const now = d.now();
      const todo = pairs
        .filter((p) => p.status === "pending" || (p.status === "done" && p.observedAt && now - Date.parse(p.observedAt) > FRESH_MS))
        .sort((a, b) => (a.observedAt ? Date.parse(a.observedAt) : 0) - (b.observedAt ? Date.parse(b.observedAt) : 0));
      let processed = 0, perp = 0, progressed = false;
      let failedDetail: string | null = null;
      for (const p of todo) {
        if (d.now() > deadline || processed >= 20) break;
        const text = textOf.get(p.promptId);
        if (!text) continue;
        if (p.engine === "perplexity" && perp >= 3) continue;
        if (p.engine === "perplexity") perp += 1;
        const model = await modelFor(p.engine);
        p.modelRequested = model;
        const r = interp(await d.callProvider(capabilityFor(p), { user_prompt: text, modelRequested: model ?? undefined }, ids));
        track(state, r);
        if (r.kind === "waiting") { p.status = "posted"; p.cacheKey = r.cacheKey; progressed = true; }
        else if (r.kind === "evidence") {
          const parsed = d.parse(capabilityFor(p), r.payload as never) as ParsedAiAnswer | null;
          if (parsed) { await landAnswer(p, r, parsed, text, tenantId, runId, nowIso(), d.syncHistory); progressed = true; }
        } else if (r.kind === "failed") failedDetail = r.detail ?? "provider call failed";
        processed += 1;
      }

      state.prompts.pairs = pairs.slice(0, 500);
      await save(d, tenantId, basis, state, ctx);
      const done = pairs.filter((p) => p.status === "done").length;
      const anyPosted = pairs.some((p) => p.status === "posted");
      // Honest status: a capped/errored provider PAUSES (never a busy loop); "advanced"
      // only on real forward progress; a zero-progress soft pass finishes the phase.
      let status: FunnelUnitOutcome["status"];
      if (state.prompts.intendedPairs > 0 && done >= state.prompts.intendedPairs) status = "done";
      else if (failedDetail) status = "failed";
      else if (anyPosted) status = "waiting";
      else status = progressed ? "advanced" : "done";
      return { status, cursor: { runId }, progress: pairProgress(state), ...(failedDetail ? { detail: failedDetail } : {}) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", cursor: { runId }, progress: pairProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}

// ── B4: SERP analysis ───────────────────────────────────────────────────────

const refs = (parsed: ParsedSerp | null) => (parsed?.aiOverview?.references ?? []).map((r) => ({ url: r.url, domain: r.domain, title: r.title }));

function applySerp(s: FunnelSerp, parsed: ParsedSerp): void {
  s.status = "done";
  s.organic = parsed.organic.slice(0, 10).map((o) => ({ rank: o.rank, url: o.url, domain: o.domain, title: o.title }));
  s.aiOverview = refs(parsed);
  s.paa = parsed.paaQuestions.map((q) => ({ question: q.question, answeringDomain: q.answeringDomain }));
  s.related = parsed.relatedSearches.slice(0, 20);
}

const serpProgress = (s: FunnelState): FunnelCounters => ({ serpsAnalyzed: s.serps.analyzed, cacheHits: s.ledger.cacheHits, spendUsd: round(s.ledger.spentUsd) });

export function serpAnalysisUnit(deps: FunnelDeps = {}): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const unitKey = `serps:${tenantId}`;
    const ids = { tenantId, unitKey };
    const deadline = d.now() + Math.max(1000, budgetMs);
    const loaded = await d.loadState(tenantId, basis);
    const state = loaded.state;
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion };
    const retained = state.discovery.retained;
    if (retained.length === 0) return { status: "failed", cursor, progress: serpProgress(state), detail: "I have no researched keywords to check in search yet." };

    const chosen = rankAndCap(retained, 40).map((k) => k.keyword);
    const byQ = new Map(state.serps.queries.map((s) => [s.query, s]));
    for (const q of chosen) if (!byQ.has(q)) byQ.set(q, { query: q, cacheKey: null, status: "pending" });
    const serps = [...byQ.values()];
    const top5 = new Set(chosen.slice(0, 5));
    const parseSerp = (payload: unknown) => d.parse("serp_organic", payload as never) as ParsedSerp | null;

    try {
      // 1) collect posted organic + AI Mode tasks (never repost)
      for (const s of serps) {
        if (d.now() > deadline) break;
        if (s.status === "posted" && s.cacheKey) {
          const r = interp(await d.collectTask(s.cacheKey));
          track(state, r);
          if (r.kind === "evidence") { const parsed = parseSerp(r.payload); if (parsed) applySerp(s, parsed); }
          else if (r.kind === "failed") s.status = "failed";
        }
        if (s.aiModeCacheKey && !s.aiMode) {
          const r = interp(await d.collectTask(s.aiModeCacheKey));
          track(state, r);
          if (r.kind === "evidence") s.aiMode = refs(d.parse("serp_ai_mode", r.payload as never) as ParsedSerp | null);
        }
      }

      // 2) post pending organic (and AI Mode for the strongest few)
      let processed = 0;
      for (const s of serps) {
        if (d.now() > deadline || processed >= 40) break;
        if (s.status === "pending") {
          const r = interp(await d.callProvider("serp_organic", { keyword: s.query }, ids));
          track(state, r);
          if (r.kind === "waiting") { s.status = "posted"; s.cacheKey = r.cacheKey; }
          else if (r.kind === "evidence") { const parsed = parseSerp(r.payload); if (parsed) applySerp(s, parsed); }
          else if (r.kind === "failed") {
            s.status = "failed";
            state.serps.queries = serps.slice(0, 60);
            state.serps.analyzed = serps.filter((x) => x.status === "done").length;
            await save(d, tenantId, basis, state, ctx);
            return { status: "failed", cursor, progress: serpProgress(state), detail: r.detail };
          }
          processed += 1;
        }
        if (top5.has(s.query) && s.aiModeCacheKey == null && s.status !== "failed") {
          const r = interp(await d.callProvider("serp_ai_mode", { keyword: s.query }, ids));
          track(state, r);
          if (r.kind === "waiting") s.aiModeCacheKey = r.cacheKey;
          else if (r.kind === "evidence") { s.aiModeCacheKey = r.cacheKey; s.aiMode = refs(d.parse("serp_ai_mode", r.payload as never) as ParsedSerp | null); }
        }
      }

      state.serps.queries = serps.slice(0, 60);
      state.serps.analyzed = serps.filter((s) => s.status === "done").length;
      await save(d, tenantId, basis, state, ctx);
      const anyPending = serps.some((s) => s.status === "pending" || s.status === "posted");
      const status: FunnelUnitOutcome["status"] = state.serps.analyzed >= chosen.length ? "done" : anyPending ? "waiting" : "advanced";
      return { status, cursor, progress: serpProgress(state) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", cursor, progress: serpProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}

// ── B5: winning pages ───────────────────────────────────────────────────────

/** Flatten every SERP + AI appearance into TRUE-provenance rows: each carries its
 *  own query or real prompt id + text, its engine, and its rank. Prompt ids never
 *  surface as customer-facing query evidence. Pure. */
function collectAppearances(state: FunnelState, fallbackIso: string): ResearchWinningAppearance[] {
  const out: ResearchWinningAppearance[] = [];
  for (const s of state.serps.queries.filter((x) => x.status === "done")) {
    const at = state.updatedAt || fallbackIso;
    for (const o of s.organic ?? []) out.push({ kind: "serp_organic", query: s.query, promptId: null, promptText: null, engine: null, rank: o.rank, citedUrl: o.url, observedAt: at, modelServed: null });
    for (const a of s.aiOverview ?? []) out.push({ kind: "ai_overview", query: s.query, promptId: null, promptText: null, engine: null, rank: null, citedUrl: a.url, observedAt: at, modelServed: null });
    for (const a of s.aiMode ?? []) out.push({ kind: "ai_mode", query: s.query, promptId: null, promptText: null, engine: null, rank: null, citedUrl: a.url, observedAt: at, modelServed: null });
  }
  for (const p of state.prompts.pairs.filter((x) => x.status === "done" && x.citations && x.citations.length > 0)) {
    for (const c of p.citations!) out.push({ kind: "ai_answer", query: null, promptId: p.promptId, promptText: p.promptText ?? null, engine: p.engine, rank: null, citedUrl: c.url, observedAt: p.observedAt ?? fallbackIso, modelServed: p.modelServed ?? null });
  }
  return out;
}

const extractFromRecord = (rec: Record<string, unknown>): ResearchPageExtract => ({
  title: typeof rec.title === "string" ? rec.title : null,
  h1: typeof rec.h1 === "string" ? rec.h1 : null,
  wordCount: typeof rec.wordCount === "number" ? rec.wordCount : 0,
  headings: Array.isArray(rec.headings) ? (rec.headings as unknown[]).filter((x): x is string => typeof x === "string") : [],
  faqCount: typeof rec.faqCount === "number" ? rec.faqCount : 0,
});

export function winningPagesUnit(deps: FunnelDeps = {}): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const deadline = d.now() + Math.max(1000, budgetMs);
    const loaded = await d.loadState(tenantId, basis);
    const state = loaded.state;
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion };
    const account = await d.getAccount(tenantId).catch(() => null);
    const ownDomain = account?.domain ? rootDomain(account.domain) : null;
    const profile = await d.loadProfile(tenantId).catch(() => null);
    const nowIso = new Date(d.now()).toISOString();

    const candidates = rankWinningPages(collectAppearances(state, nowIso), ownDomain, 10);
    const pages: FunnelWinningPage[] = [];
    let fetched = 0;
    try {
      for (const c of candidates) {
        const engines = [...new Set(c.appearances.map((a) => a.engine).filter((e): e is string => !!e))].sort();
        const examplePrompts = [...new Set(c.appearances.map((a) => a.promptText).filter((t): t is string => !!t))].slice(0, 5);
        let extract: ResearchPageExtract | null = null;
        let contentHash: string | null = null;
        let has = false;
        // Reuse a cached public extract before any fetch; never refetch in freshness.
        const cached = await d.readPageExtract(c.url).catch(() => null);
        if (cached) { extract = extractFromRecord(cached.extract); contentHash = cached.contentHash; has = true; }
        else if (d.now() <= deadline) {
          try {
            const res = await d.fetchPage(c.url, new Map(), {});
            if (res.ok) {
              const snap = extractPageSnapshot(res.html, c.url, `winpage-${sha16(c.url)}`, tenantId, res.status, profile);
              extract = { title: snap.title, h1: snap.h1, wordCount: snap.word_count, headings: (snap.h2_list ?? []).slice(0, 20), faqCount: snap.faqs.length };
              contentHash = sha16(res.html);
              await d.writePageExtract(c.url, extract as unknown as Record<string, unknown>, contentHash).catch(() => {});
              fetched += 1;
              has = true;
            }
          } catch {
            /* fetch/extract failure -> honest fetched:false */
          }
        }
        pages.push({ url: c.url, domain: c.domain, engines, examplePrompts, appearances: c.appearances, fetched: has, contentHash, extract });
      }
      state.winningPages = pages;
      await save(d, tenantId, basis, state, ctx);
      return { status: "done", cursor: null, progress: { winningPagesFetched: fetched, cacheHits: state.ledger.cacheHits, spendUsd: round(state.ledger.spentUsd) } };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", cursor, progress: { winningPagesFetched: fetched }, detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}

// ── B6: PURE snapshot projector ─────────────────────────────────────────────

const competitionLevel = (c: number | null): "low" | "medium" | "high" | null => (c == null ? null : c < 0.34 ? "low" : c < 0.67 ? "medium" : "high");

/** FunnelEvidence is the funnel's snapshot-facing bundle (kept as the historical
 *  facade name). Slice 7 consumes it ONLY through the canonical EvidenceSnapshot. */
export type FunnelEvidence = FunnelResearchEvidence;

/** Read-only: normalize the persisted funnel state into the canonical research
 *  evidence bundle plus an explicit receipt. PURE (no I/O, no network). */
export function projectFunnelEvidence(state: FunnelState, now: number): FunnelResearchEvidence {
  const donePairs = state.prompts.pairs.filter((p) => p.status === "done");
  const observedTimes = donePairs.map((p) => p.observedAt).filter((t): t is string => !!t).sort();
  const stale = donePairs.filter((p) => p.observedAt && now - Date.parse(p.observedAt) > FRESH_MS).length;
  const missing = Math.max(0, state.prompts.intendedPairs - donePairs.length) + state.serps.queries.filter((s) => s.status !== "done").length;
  const doneSerps = state.serps.queries.filter((s) => s.status === "done");
  return {
    retainedKeywords: state.discovery.retained.map((k) => ({ query: k.keyword, searchVolume: k.searchVolume, competition: k.competition, competitionLevel: competitionLevel(k.competition), intent: k.intent })),
    aiObservations: donePairs.map((p) => ({
      promptId: p.promptId, promptText: p.promptText ?? "", engine: p.engine,
      modelRequested: p.modelRequested ?? null, modelServed: p.modelServed ?? null,
      webSearchReported: p.webSearchReported ?? null, citationsObserved: p.citationsObserved ?? (p.citations != null),
      citations: p.citations ?? null, fanOutQueries: p.fanOutQueries ?? null, observedAt: p.observedAt ?? "",
    })),
    serpEvidence: doneSerps.map((s) => ({
      query: s.query,
      organic: (s.organic ?? []).map((o) => ({ rank: o.rank, domain: o.domain, url: o.url, title: o.title ?? null })),
      aiOverview: (s.aiOverview ?? []).map((a) => ({ url: a.url, domain: a.domain, title: a.title ?? null })),
      aiMode: (s.aiMode ?? []).map((a) => ({ url: a.url, domain: a.domain, title: a.title ?? null })),
      paa: s.paa ?? [], related: s.related ?? [],
    })),
    winningPages: state.winningPages.map((w) => ({ url: w.url, domain: w.domain, engines: w.engines, examplePrompts: w.examplePrompts, appearances: w.appearances, extract: w.extract })),
    receipt: { researched: state.discovery.counts.raw, retained: state.discovery.counts.retained, stale, missing, cached: state.ledger.cacheHits, spentUsd: round(state.ledger.spentUsd), freshestObservationAt: observedTimes.at(-1) ?? null },
  };
}

