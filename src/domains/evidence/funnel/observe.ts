import "server-only";
/**
 * funnel/observe (integrity closure) - the AI-answer, SERP, and winning-page
 * executors plus the PURE snapshot projector. Every provider call routes through
 * the frozen boundary by CAPABILITY and consumes the registry's typed parse
 * output; posted Standard tasks resume via collect, and only a PROVEN-dead task
 * identity earns one clean repost per incident (the disposition decides). All
 * state is basis-scoped with optimistic row_version. Provenance is TRUE: every
 * winning-page appearance carries its own query/prompt/engine, and citations
 * preserve the null-vs-[]-vs-nonempty tri-state end to end.
 */

import { basisTag } from "@/domains/account";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
import type { CachedCallResult, CapabilityKey, FunnelCounters, FunnelUnitFn, FunnelUnitOutcome, LlmWebInput, ParsedAiAnswer, ParsedSerp } from "@/domains/evidence/dataforseo/funnel-boundary";
import { rankAndCap, rankWinningPages } from "./normalize";
import { type FunnelPair, type FunnelSerp, type FunnelState, type FunnelWinningPage } from "./state";
import {
  emptyResearchEvidence, type FunnelResearchEvidence, type ResearchEngine,
  type ResearchPageExtract, type ResearchWinningAppearance,
} from "./research-evidence";
import {
  basisFromCursor, beginCycle, CONFLICT_DETAIL, FRESH_MS, interp, type Interp, NO_BASIS_DETAIL, pauseDetail,
  resolveDeps, round, save, type SaveCtx, sha16, StateConflictError, track, type FunnelDeps, type ResolvedDeps,
} from "./shared";

// ── B3: prompt observation ──────────────────────────────────────────────────
const ENGINES: ResearchEngine[] = ["chatgpt", "gemini", "claude", "perplexity"];
const pairKey = (p: FunnelPair) => `${p.promptId}|${p.engine}|${p.scraper ? "s" : ""}`;
const capabilityFor = (p: FunnelPair): CapabilityKey => (p.scraper ? "llm_scraper_chatgpt" : (`llm_${p.engine}` as CapabilityKey));

/** ChatGPT/Claude get the full web-enabled ask (registry gates force/country on the
 *  model); gemini web_search only; perplexity none; the scraper is KEYWORD-based. */
const webAsk = (text: string): LlmWebInput => ({ user_prompt: text, web_search: true, force_web_search: true, web_search_country_iso_code: "US" });
function observeCall(callProvider: ResolvedDeps["callProvider"], p: FunnelPair, text: string, ids: { tenantId: string; unitKey: string }): Promise<CachedCallResult> {
  if (p.scraper) return callProvider("llm_scraper_chatgpt", { keyword: text, force_web_search: true, expand_citations: true }, ids);
  switch (p.engine) {
    case "gemini": return callProvider("llm_gemini", { user_prompt: text, web_search: true }, ids);
    case "perplexity": return callProvider("llm_perplexity", { user_prompt: text }, ids);
    case "claude": return callProvider("llm_claude", webAsk(text), ids);
    default: return callProvider("llm_chatgpt", webAsk(text), ids);
  }
}

/** THE current intended pair set (active prompts x engines + scraper subset), each
 *  carrying forward its persisted row when the key still belongs; everything else is
 *  PRUNED (the working set is not an archive; history lives in the pao table). */
function currentPairs(prompts: { id: string }[], persisted: FunnelPair[]): FunnelPair[] {
  const byKey = new Map(persisted.map((p) => [pairKey(p), p]));
  const intended: FunnelPair[] = [];
  for (const p of prompts) for (const engine of ENGINES) intended.push({ promptId: p.id, engine, cacheKey: null, status: "pending" });
  for (const p of prompts.slice(0, 20)) intended.push({ promptId: p.id, engine: "chatgpt", scraper: true, cacheKey: null, status: "pending" });
  return intended.map((ip) => byKey.get(pairKey(ip)) ?? ip);
}

/** Fresh = inside the weekly window; done-but-STALE = outstanding, not complete. */
const pairFresh = (p: FunnelPair, now: number) => p.status === "done" && !!p.observedAt && now - Date.parse(p.observedAt) <= FRESH_MS;
const pairComplete = (p: FunnelPair, now: number) => p.status === "unsupported" || pairFresh(p, now);

function pairProgress(s: FunnelState): FunnelCounters {
  return {
    promptsChecked: new Set(s.prompts.pairs.map((p) => p.promptId)).size,
    enginePairsDone: s.prompts.pairs.filter((p) => p.status === "done").length,
    enginePairsIntended: s.prompts.intendedPairs,
    cacheHits: s.cycle.cacheHits,
    spendUsd: round(s.cycle.spentUsd),
  };
}

/** ONE historical prompt_answer_observations row per completed answer. The id folds
 *  in the retrieval MODE (the scraper look is a different observation of the same
 *  engine, never an overwrite), modelServed, and the day, so a changed served model
 *  yields a DISTINCT row, never a merge. citation_urls is null (not []) when
 *  citations were NOT observable, and metadata.citationsObserved records the
 *  tri-state a count-of-0 would flatten. */
function paoRow(p: FunnelPair, parsed: ParsedAiAnswer, tenantId: string, runId: string, nowIso: string): PromptAnswerObservation {
  const domains = (parsed.citations ?? []).map((c) => c.domain);
  const observed = parsed.citations !== null;
  const model = parsed.modelServed ?? p.modelRequested ?? p.engine;
  return {
    id: `${tenantId}|${p.engine}${p.scraper ? "+scraper" : ""}|${p.promptId}|${model}|${nowIso.slice(0, 10)}`,
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
  p.reposts = undefined; // a landed answer closes the incident: fresh budget next time
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
    const deadline = d.now() + Math.max(1000, budgetMs);
    const loaded = await d.loadState(tenantId, basis);
    const state = loaded.state;
    const runId = beginCycle(state, cursor, unitKey);
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion };
    const prompts = (await d.loadActivePrompts(tenantId)).slice(0, 100);
    if (prompts.length === 0) return { status: "failed", cursor, progress: pairProgress(state), detail: "I have no active core prompts to check yet." };

    const pairs = currentPairs(prompts, state.prompts.pairs);
    state.prompts.intendedPairs = pairs.length;
    const textOf = new Map(prompts.map((p) => [p.id, p.text]));
    const nowIso = () => new Date(d.now()).toISOString();
    let failedDetail: string | null = null;
    let softUnavailable = false;
    // Budgets are per INCIDENT: a stale unsupported pair re-enters weekly with a
    // fresh repost budget, so unavailable coverage is a bounded outage, not a hole.
    for (const p of pairs) if (p.status === "unsupported" && p.observedAt && d.now() - Date.parse(p.observedAt) > FRESH_MS) { p.status = "pending"; p.cacheKey = null; p.reposts = undefined; }

    try {
      // 1) collect prior posted tasks (only a PROVEN-dead identity ever reposts)
      for (const p of pairs.filter((x) => x.status === "posted" && x.cacheKey)) {
        if (d.now() > deadline) break;
        const r = interp(await d.collectTask(p.cacheKey!));
        track(state, r);
        if (r.modelRequested) p.modelRequested = r.modelRequested;
        if (r.kind === "evidence") {
          const parsed = d.parse(capabilityFor(p), r.payload as never) as ParsedAiAnswer | null;
          // Collected but unreadable evidence is a bounded failure, never a fake answer.
          if (parsed) await landAnswer(p, r, parsed, textOf.get(p.promptId) ?? p.promptText ?? "", tenantId, runId, nowIso(), d.syncHistory);
          else failedDetail = "I collected an answer I could not read. I will retry it on the next pass.";
        } else if (r.kind === "failed") {
          // The DISPOSITION decides. repost_once = proven-dead identity: ONE clean
          // repost, then unsupported (explicit unavailable coverage). Every other
          // disposition keeps the pair POSTED for a free collect, spending nothing.
          if (r.disposition === "repost_once") {
            if ((p.reposts ?? 0) >= 1) { p.status = "unsupported"; p.cacheKey = null; p.observedAt = nowIso(); }
            else { p.status = "pending"; p.cacheKey = null; p.reposts = 1; }
          } else if (r.disposition === "quarantined") { p.status = "unsupported"; p.observedAt = nowIso(); }
          else failedDetail = pauseDetail(r.disposition, "A prompt check did not come back. I will collect it on the next pass.");
        }
      }

      // 2) post/live the stalest pending pairs, bounded batch within budget
      const now = d.now();
      const todo = pairs
        .filter((p) => p.status === "pending" || (p.status === "done" && !pairFresh(p, now)))
        .sort((a, b) => (a.observedAt ? Date.parse(a.observedAt) : 0) - (b.observedAt ? Date.parse(b.observedAt) : 0));
      let processed = 0, perp = 0, progressed = false;
      for (const p of todo) {
        if (d.now() > deadline || processed >= 20) break;
        const text = textOf.get(p.promptId);
        if (!text) continue;
        if (p.engine === "perplexity" && perp >= 3) continue;
        if (p.engine === "perplexity") perp += 1;
        const r = interp(await observeCall(d.callProvider, p, text, ids));
        track(state, r);
        p.modelRequested = r.modelRequested ?? p.modelRequested ?? null;
        if (r.kind === "waiting") { p.status = "posted"; p.cacheKey = r.cacheKey; progressed = true; }
        else if (r.kind === "evidence") {
          const parsed = d.parse(capabilityFor(p), r.payload as never) as ParsedAiAnswer | null;
          if (parsed) { await landAnswer(p, r, parsed, text, tenantId, runId, nowIso(), d.syncHistory); progressed = true; }
          else failedDetail = "I got an answer I could not read. I will retry it on the next pass.";
        } else if (r.kind === "failed") {
          // quarantined = EXPLICIT unavailable coverage (the boundary holds the
          // paid attempt; weekly re-entry retries the free recovery forever).
          if (r.disposition === "quarantined") { p.status = "unsupported"; p.cacheKey = r.cacheKey; p.observedAt = nowIso(); }
          else failedDetail = pauseDetail(r.disposition, "A prompt check did not run. I will retry it on the next pass.");
        }
        else if (r.soft === "not_configured") softUnavailable = true; // genuine unavailable coverage
        processed += 1;
      }

      state.prompts.pairs = pairs; // bounded by construction: <= 100 prompts x 4 engines + 20 scraper
      await save(d, tenantId, basis, state, ctx);
      const at = d.now();
      const complete = pairs.filter((p) => pairComplete(p, at)).length;
      const freshDone = pairs.filter((p) => pairFresh(p, at)).length;
      const unsupported = pairs.filter((p) => p.status === "unsupported").length;
      const anyPosted = pairs.some((p) => p.status === "posted");
      // Honest status over the CURRENT set only: done needs every intended pair
      // FRESHLY answered or EXPLICITLY unsupported plus one real answer; stale-done
      // is outstanding; failures pause; leftover pending pairs never fake done.
      let status: FunnelUnitOutcome["status"];
      if (pairs.length > 0 && freshDone > 0 && complete >= pairs.length) {
        status = "done";
        if (unsupported > 0) failedDetail = `${unsupported} prompt checks were unavailable from the provider this round; the rest are in.`;
      }
      else if (failedDetail) status = "failed";
      else if (anyPosted) status = "waiting";
      else if (progressed) status = "advanced";
      else if (softUnavailable) { status = "failed"; failedDetail = "I could not reach the AI engines to check your prompts. I will try again on the next pass."; }
      else if (pairs.some((p) => p.status === "pending")) { status = "failed"; failedDetail = "Some prompt checks did not run this pass. I will pick them up on the next pass."; }
      else if (freshDone === 0) { status = "failed"; failedDetail = "The provider could not return any prompt answers this round. I will try the whole set fresh on the next pass."; }
      else { status = "failed"; failedDetail = `${pairs.length - complete} prompt checks are still outstanding. I will finish them on the next pass.`; }
      return { status, cursor: { runId }, progress: pairProgress(state), ...(failedDetail ? { detail: failedDetail } : {}) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", cursor: { runId }, progress: pairProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
// ── B4: SERP analysis ───────────────────────────────────────────────────────
const refs = (parsed: ParsedSerp | null) => (parsed?.aiOverview?.references ?? []).map((r) => ({ url: r.url, domain: r.domain, title: r.title }));

function applySerp(s: FunnelSerp, parsed: ParsedSerp, nowIso: string): void {
  s.status = "done";
  s.observedAt = nowIso;
  s.reposts = undefined; // a landed look closes the incident: fresh budget next time
  s.organic = parsed.organic.slice(0, 10).map((o) => ({ rank: o.rank, url: o.url, domain: o.domain, title: o.title }));
  s.aiOverview = refs(parsed);
  s.paa = parsed.paaQuestions.map((q) => ({ question: q.question, answeringDomain: q.answeringDomain }));
  s.related = parsed.relatedSearches.slice(0, 20);
}

/** A look observed inside the weekly window; anything older is due again. */
const serpFresh = (s: FunnelSerp, now: number) => s.status === "done" && !!s.observedAt && now - Date.parse(s.observedAt) <= FRESH_MS;

const serpProgress = (s: FunnelState): FunnelCounters => ({ serpsAnalyzed: s.serps.analyzed, cacheHits: s.cycle.cacheHits, spendUsd: round(s.cycle.spentUsd) });

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
    beginCycle(state, cursor, unitKey);
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion };
    const retained = state.discovery.retained;
    if (retained.length === 0) return { status: "failed", cursor, progress: serpProgress(state), detail: "I have no researched keywords to check in search yet." };

    // PRUNE to the CURRENT chosen set: an obsolete query can never satisfy a new one.
    const chosen = rankAndCap(retained, 40).map((k) => k.keyword);
    const byQ = new Map(state.serps.queries.map((s) => [s.query, s]));
    const serps: FunnelSerp[] = chosen.map((q) => byQ.get(q) ?? { query: q, cacheKey: null, status: "pending" });
    const top5 = new Set(chosen.slice(0, 5));
    const nowIso = () => new Date(d.now()).toISOString();
    const parseSerp = (payload: unknown) => d.parse("serp_organic", payload as never) as ParsedSerp | null;
    let failedDetail: string | null = null;
    // A look older than the weekly window is DUE (done OR exhausted-failed): it
    // re-enters with a fresh per-incident budget and its AI Mode observation
    // re-opens too, so no query and no AI Mode look can freeze forever.
    for (const s of serps) {
      if ((s.status !== "done" && s.status !== "failed") || !s.observedAt || d.now() - Date.parse(s.observedAt) <= FRESH_MS) continue;
      s.status = "pending"; s.cacheKey = null; s.reposts = undefined;
      s.aiMode = undefined; s.aiModeCacheKey = null; s.aiModeReposted = undefined; s.aiModeFailed = undefined;
    }

    try {
      // 1) collect posted organic + AI Mode tasks (never repost a live key)
      for (const s of serps) {
        if (d.now() > deadline) break;
        if (s.status === "posted" && s.cacheKey) {
          const r = interp(await d.collectTask(s.cacheKey));
          track(state, r);
          if (r.kind === "evidence") { const parsed = parseSerp(r.payload); if (parsed) applySerp(s, parsed, nowIso()); }
          else if (r.kind === "failed") {
            // Disposition decides: repost_once = ONE clean repost then explicit
            // unavailable; everything else stays posted for a free collect.
            if (r.disposition === "quarantined") { s.status = "failed"; s.observedAt = nowIso(); }
            else if (r.disposition !== "repost_once") failedDetail = pauseDetail(r.disposition, "A search did not finish. I will retry it on the next pass.");
            else if ((s.reposts ?? 0) >= 1) { s.status = "failed"; s.observedAt = nowIso(); failedDetail = "A search could not be completed after a second try. I will try it fresh next week."; }
            else { s.status = "pending"; s.cacheKey = null; s.reposts = 1; }
          }
        }
        if (top5.has(s.query) && s.aiModeCacheKey && !s.aiMode && !s.aiModeFailed) {
          const r = interp(await d.collectTask(s.aiModeCacheKey));
          track(state, r);
          if (r.kind === "evidence") { s.aiMode = refs(d.parse("serp_ai_mode", r.payload as never) as ParsedSerp | null); s.aiModeReposted = undefined; }
          else if (r.kind === "failed") {
            // Terminal AI Mode collect: ONE clean repost, then explicit missing
            // coverage (never a silent gap, never an eternal dead-key collect).
            if (r.disposition === "quarantined") s.aiModeFailed = true; // explicit missing coverage, never a stall
            else if (r.disposition !== "repost_once") failedDetail = pauseDetail(r.disposition, "An AI Mode look did not finish. I will retry it on the next pass.");
            else if (s.aiModeReposted) s.aiModeFailed = true;
            else { s.aiModeCacheKey = null; s.aiModeReposted = true; }
          }
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
          else if (r.kind === "evidence") { const parsed = parseSerp(r.payload); if (parsed) applySerp(s, parsed, nowIso()); }
          else if (r.kind === "failed") {
            // One bad key never aborts the phase: quarantined = explicit
            // unavailable coverage; anything else pauses while the rest continue.
            if (r.disposition === "quarantined") { s.status = "failed"; s.observedAt = nowIso(); }
            else failedDetail = pauseDetail(r.disposition, r.detail ?? "A search did not run. I will retry it on the next pass.");
          }
          processed += 1;
        }
        if (top5.has(s.query) && s.aiModeCacheKey == null && !s.aiModeFailed && s.status !== "failed") {
          const r = interp(await d.callProvider("serp_ai_mode", { keyword: s.query }, ids));
          track(state, r);
          if (r.kind === "waiting") s.aiModeCacheKey = r.cacheKey;
          else if (r.kind === "evidence") { s.aiModeCacheKey = r.cacheKey; s.aiMode = refs(d.parse("serp_ai_mode", r.payload as never) as ParsedSerp | null); }
          else if (r.kind === "failed") {
            // blocked/transient pause WITHOUT spending the one AI Mode retry;
            // anything else spends it, and a second failure names the gap.
            if (r.disposition === "repost_once" || r.disposition === "none") { if (s.aiModeReposted) s.aiModeFailed = true; else s.aiModeReposted = true; }
            else failedDetail = pauseDetail(r.disposition, "I could not start an AI Mode look this pass. I will try again on the next pass.");
          }
        }
      }

      state.serps.queries = serps.slice(0, 60);
      state.serps.analyzed = serps.filter((s) => s.status === "done").length;
      await save(d, tenantId, basis, state, ctx);
      // AI Mode truth is judged for the CURRENT top five ONLY; a row that has since
      // dropped out of the top five can neither pause nor pollute this phase.
      const topRows = serps.filter((s) => top5.has(s.query));
      const aiModeInFlight = topRows.some((s) => s.aiModeCacheKey && !s.aiMode && !s.aiModeFailed);
      const anyPending = serps.some((s) => s.status === "pending" || s.status === "posted") || aiModeInFlight;
      const aiModeMissing = topRows.filter((s) => s.aiModeFailed).length;
      const unavailable = serps.filter((s) => s.status === "failed").length;
      // done = every CURRENT query freshly analyzed or explicitly unavailable,
      // one real look minimum, no AI Mode still live; unavailable is surfaced.
      let status: FunnelUnitOutcome["status"];
      if (state.serps.analyzed > 0 && state.serps.analyzed + unavailable >= chosen.length && !aiModeInFlight) {
        status = "done";
        if (unavailable > 0) failedDetail = `${unavailable} searches were unavailable from the provider; the rest are in.`;
        else if (aiModeMissing > 0) failedDetail = `${aiModeMissing} AI Mode looks were unavailable from the provider; the search results themselves are in.`;
      }
      else if (anyPending) status = "waiting";
      else status = "failed";
      const detail = status === "failed" ? (failedDetail ?? "Some searches did not finish. I will retry them on the next pass.") : failedDetail;
      return { status, cursor, progress: serpProgress(state), ...(detail ? { detail } : {}) };
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
    const at = s.observedAt || state.updatedAt || fallbackIso;
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
    beginCycle(state, cursor, `winning:${tenantId}`);
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
      return { status: "done", cursor: null, progress: { winningPagesFetched: fetched, cacheHits: state.cycle.cacheHits, spendUsd: round(state.cycle.spentUsd) } };
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
 *  evidence bundle plus an explicit receipt. The state is already pruned to the
 *  CURRENT set, so nothing obsolete can be projected. The receipt's money and cache
 *  numbers are THIS RUN's, not a lifetime total. PURE (no I/O, no network). */
export function projectFunnelEvidence(state: FunnelState, now: number): FunnelResearchEvidence {
  const donePairs = state.prompts.pairs.filter((p) => p.status === "done");
  const observedTimes = donePairs.map((p) => p.observedAt).filter((t): t is string => !!t).sort();
  const isStale = (at: string | undefined) => !at || now - Date.parse(at) > FRESH_MS;
  const stale = donePairs.filter((p) => isStale(p.observedAt)).length
    + state.serps.queries.filter((s) => s.status === "done" && isStale(s.observedAt)).length;
  const missing = Math.max(0, state.prompts.intendedPairs - donePairs.length)
    + state.serps.queries.filter((s) => s.status !== "done").length
    + state.serps.queries.filter((s) => s.aiModeFailed).length;
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
    receipt: { researched: state.discovery.counts.raw, retained: state.discovery.counts.retained, stale, missing, cached: state.cycle.cacheHits, spentUsd: round(state.cycle.spentUsd), freshestObservationAt: observedTimes.at(-1) ?? null },
  };
}

