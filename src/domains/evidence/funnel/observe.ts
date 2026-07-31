import "server-only";
/** funnel/observe (integrity closure) - the AI-answer and SERP executors + the PURE snapshot projector (the winning-page executor is funnel/winning-pages). Provider calls route through the frozen boundary by CAPABILITY; posted tasks resume via collect;
 * only a PROVEN-dead identity earns one repost per incident; a BLOCKED refusal stops the batch and pauses the run. State is basis-scoped (optimistic row_version). Provenance is TRUE: every observation carries its
 * retrieval MODE and query/prompt/engine; citations keep the null-vs-[]-vs-nonempty tri-state end to end. */
import { log } from "@/lib/logger";
import {
  buildAiObservation, projectPromptAnswerObservation,
  type AiObservationDraft, type AiObservationStatus, type DueObservation,
} from "@/domains/evidence/ai-visibility/ai-observations";
import type { CachedCallResult, CapabilityKey, FunnelCounters, FunnelUnitFn, FunnelUnitOutcome, ParsedAiAnswer, ParsedSerp } from "@/domains/evidence/dataforseo/funnel-boundary";
import { selectSerpAgenda } from "./normalize";
import { type FunnelPair, type FunnelSerp, type FunnelState } from "./state";
import { type FunnelResearchEvidence, type ObservationMode, type ResearchEngine } from "./research-evidence";
import { basisFromCursor, beginCycle, CONFLICT_DETAIL, FRESH_MS, interp, type Interp, modeOf, NO_BASIS_DETAIL, pauseDetail, resolveDeps, round, save, type SaveCtx, sha16, StateConflictError, track, type FunnelDeps, type ResolvedDeps } from "./shared";

// blocked = a HELD refusal at zero further spend; it ALWAYS pauses the run, so prefer the boundary's own detail.
const blockedNote = (r: Interp) => r.detail || pauseDetail("blocked", "");
// ── B3: prompt observation ──────────────────────────────────────────────────
const ENGINES: ResearchEngine[] = ["chatgpt", "gemini", "claude", "perplexity"];
/** CANONICAL coverage = the ChatGPT consumer search experience (the citation-grade look real people get) plus the standardized response on the other three. A chatgpt standardized_response pair is AUXILIARY: bounded, never engine coverage or a substitute. */
const canonicalMode = (e: ResearchEngine): ObservationMode => (e === "chatgpt" ? "consumer_search" : "standardized_response");
const isCanonical = (p: FunnelPair) => modeOf(p) === canonicalMode(p.engine);
/** A deliberate second sample of one pair on one day is a DIFFERENT observation, so the slot is part of the
 *  working identity exactly as it is part of the stored one. A row without a slot is slot 0. */
const slotOf = (p: FunnelPair) => p.slot ?? 0;
const pairKey = (p: FunnelPair) => `${p.promptId}|${p.engine}|${modeOf(p)}|${slotOf(p)}`;
const capabilityFor = (p: FunnelPair): CapabilityKey => (p.engine === "chatgpt" && modeOf(p) === "consumer_search" ? "llm_scraper_chatgpt" : (`llm_${p.engine}` as CapabilityKey));
/** The engines I can actually ask. Anything else is answered honestly as unsupported at ZERO spend. */
const OBSERVABLE = new Set<string>(ENGINES);

/** Each capability gets EXACTLY its documented ask: ChatGPT llm_responses web_search only (live o4-mini rejected force, 40501); Claude force + country; Gemini web_search only; perplexity none; the scraper is KEYWORD-based. */
function observeCall(callProvider: ResolvedDeps["callProvider"], p: FunnelPair, text: string, ids: { tenantId: string; unitKey: string }): Promise<CachedCallResult> {
  switch (capabilityFor(p)) {
    case "llm_scraper_chatgpt": return callProvider("llm_scraper_chatgpt", { keyword: text, force_web_search: true, expand_citations: true }, ids);
    case "llm_gemini": return callProvider("llm_gemini", { user_prompt: text, web_search: true }, ids);
    case "llm_perplexity": return callProvider("llm_perplexity", { user_prompt: text }, ids);
    case "llm_claude": return callProvider("llm_claude", { user_prompt: text, web_search: true, force_web_search: true, web_search_country_iso_code: "US" }, ids);
    default: return callProvider("llm_chatgpt", { user_prompt: text, web_search: true }, ids);
  }
}

/** THE intended pair set, MODE-stamped: 4 canonical pairs per prompt + one auxiliary chatgpt standardized pair for the first 20 prompts only. A persisted row carries forward by promptId|engine|MODE (legacy scraper = consumer_search, legacy bare chatgpt = standardized) so nothing fresh is re-bought; every other row is PRUNED (history lives in the pao table). */
function normalizePairs(prompts: { id: string }[], persisted: FunnelPair[]): FunnelPair[] {
  const byKey = new Map(persisted.map((p) => [pairKey(p), p])), intended: FunnelPair[] = [];
  for (const p of prompts) for (const engine of ENGINES) intended.push({ promptId: p.id, engine, mode: canonicalMode(engine), cacheKey: null, status: "pending" });
  for (const p of prompts.slice(0, 20)) intended.push({ promptId: p.id, engine: "chatgpt", mode: "standardized_response", cacheKey: null, status: "pending" });
  return intended.map((ip) => { const kept = byKey.get(pairKey(ip)); return kept ? { ...kept, mode: ip.mode, scraper: undefined } : ip; });
}

const pairFresh = (p: FunnelPair, now: number) => p.status === "done" && !!p.observedAt && now - Date.parse(p.observedAt) <= FRESH_MS; // fresh = inside the weekly window; done-but-STALE = outstanding
const pairComplete = (p: FunnelPair, now: number) => p.status === "unsupported" || pairFresh(p, now);

/** Progress counts CANONICAL coverage only: auxiliary research can never inflate a denominator. */
function pairProgress(s: FunnelState): FunnelCounters {
  const canon = s.prompts.pairs.filter(isCanonical);
  return { promptsChecked: new Set(canon.map((p) => p.promptId)).size, enginePairsDone: canon.filter((p) => p.status === "done").length,
    enginePairsIntended: s.prompts.intendedPairs, cacheHits: s.cycle.cacheHits, spendUsd: round(s.cycle.spentUsd) };
}

/** Who this batch of observations belongs to, resolved ONCE per pass. */
type ObsIds = { tenantId: string; site: string; runId: string };

/** The account's own website, stamped on every observation so a stored answer names the site it is about.
 *  A failed read is not a reason to stop observing, so it reads empty rather than guessing a domain. */
async function siteOf(d: ResolvedDeps, tenantId: string): Promise<string> {
  try { return (await d.getAccount(tenantId))?.domain ?? ""; } catch { return ""; }
}

/** ONE construction of the canonical observation draft, whatever the outcome. The pair carries the identity
 *  (prompt, version, engine, ask day, slot); the caller supplies only what actually happened. */
function draftOf(p: FunnelPair, ids: ObsIds, text: string, at: string, status: AiObservationStatus, over: Partial<AiObservationDraft> = {}): AiObservationDraft {
  return {
    tenantId: ids.tenantId, site: ids.site, promptId: p.promptId, promptVersion: p.promptVersion ?? 1,
    promptText: text, engine: p.engine, mode: modeOf(p), slot: slotOf(p),
    requestedAt: p.requestedAt ?? at, capability: `${capabilityFor(p)}@v3`,
    cacheKey: p.cacheKey, modelRequested: p.modelRequested ?? null, status, ...over,
  };
}

/** THE full-fidelity landing: the whole answer, the whole retrieval journey, the money receipt and the cache
 *  identity of the raw envelope land as ONE canonical row, and the historical prompt_answer_observations row
 *  is DERIVED from that same record in the same breath. Two writes, one truth: nothing composes a history row
 *  independently any more, so the two can never disagree. */
async function landAnswer(p: FunnelPair, r: Interp, parsed: ParsedAiAnswer, promptText: string, ids: ObsIds, nowIso: string, d: ResolvedDeps): Promise<void> {
  const rec = buildAiObservation(draftOf(p, ids, promptText, nowIso, "observed", { completedAt: nowIso, cacheKey: r.cacheKey, costUsd: r.costUsd, parsed }));
  p.status = "done"; p.cacheKey = r.cacheKey; p.observedAt = nowIso; p.promptText = promptText;
  p.reposts = undefined; p.requestedAt = undefined; // a landed answer closes the incident: fresh budget next time
  p.modelServed = parsed.modelServed ?? r.modelServed; p.webSearchReported = parsed.webSearchReported;
  p.citationsObserved = parsed.citations !== null;
  p.citations = parsed.citations ? parsed.citations.map((c) => ({ url: c.url, domain: c.domain, title: c.title })) : null;
  p.fanOutQueries = parsed.fanOutQueries; p.answerHash = parsed.answerText ? sha16(parsed.answerText) : null;
  await d.recordObservation(rec, ids.tenantId);
  await d.syncHistory([projectPromptAnswerObservation(rec, ids.runId)], ids.tenantId);
}

/** The intended set when Runtime's planner hands me exactly what is DUE: one row per (prompt, version,
 *  engine, slot), each in that engine's canonical retrieval mode. A persisted row carries forward on the
 *  same identity so nothing fresh is re-bought; everything else is pruned exactly as the standing set is. */
function pairsFromDue(due: DueObservation[], persisted: FunnelPair[]): FunnelPair[] {
  const byKey = new Map(persisted.map((p) => [pairKey(p), p]));
  return due.map((x) => {
    const ip: FunnelPair = { promptId: x.promptId, engine: x.engine, mode: canonicalMode(x.engine), slot: x.slot,
      promptVersion: x.version, promptText: x.text, cacheKey: null, status: "pending" };
    const kept = byKey.get(pairKey(ip));
    return kept ? { ...kept, mode: ip.mode, slot: ip.slot, promptVersion: ip.promptVersion, promptText: x.text, scraper: undefined } : ip;
  });
}

/** `due`: the exact (prompt, version, engine, slot) observations Runtime's planner says are owed right now.
 *  Empty keeps the standing behaviour (every active question on every engine), so nothing is implied by
 *  silence. A due engine I cannot ask is answered as unsupported at ZERO spend, never quietly dropped. */
export function promptObservationUnit(deps: FunnelDeps = {}, due: DueObservation[] = []): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const unitKey = `prompts:${tenantId}`, ids = { tenantId, unitKey }, deadline = d.now() + Math.max(1000, budgetMs);
    const loaded = await d.loadState(tenantId, basis), state = loaded.state;
    const runId = beginCycle(state, cursor, unitKey), ctx: SaveCtx = { rowVersion: loaded.rowVersion };
    const nowIso = () => new Date(d.now()).toISOString();
    const obs: ObsIds = { tenantId, site: await siteOf(d, tenantId), runId };
    let pairs: FunnelPair[], textOf: Map<string, string>;
    if (due.length > 0) {
      // EXACTLY the pairs the planner says are owed. An engine I cannot ask still gets its own honest row,
      // written as unsupported without a single provider call, so a gap is named rather than disappearing.
      for (const x of due.filter((y) => !OBSERVABLE.has(y.engine))) {
        await d.recordObservation(buildAiObservation({ tenantId, site: obs.site, promptId: x.promptId, promptVersion: x.version, promptText: x.text,
          engine: x.engine, mode: canonicalMode(x.engine), slot: x.slot, requestedAt: nowIso(), capability: "unavailable", status: "unsupported",
          failureReason: `I cannot ask ${x.engine} for you yet, so I spent nothing on it.` }), tenantId);
      }
      const askable = due.filter((x) => x.promptId && x.text && OBSERVABLE.has(x.engine)).slice(0, 400);
      if (askable.length === 0) return { status: "failed", cursor, progress: pairProgress(state), detail: "None of the questions that came due can be checked on an engine I can reach yet, so I spent nothing. I will pick them up as soon as one is available." };
      pairs = pairsFromDue(askable, state.prompts.pairs);
      state.prompts.intendedPairs = pairs.length;
      textOf = new Map(askable.map((x) => [x.promptId, x.text]));
    } else {
      const loadedPrompts = await d.loadActivePrompts(tenantId);
      // A FAILED read (null) is not "zero questions": that once told a 35-question account it had none.
      if (loadedPrompts === null) return { status: "failed", cursor, progress: pairProgress(state), detail: "I could not read your tracked questions just now, so I stopped here. I will try again on your next visit." };
      // A loader override must not be able to rotate the bounded auxiliary sample.
      const prompts = loadedPrompts.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 100);
      if (prompts.length === 0) return { status: "failed", cursor, progress: pairProgress(state), detail: "I am not tracking any questions for you yet, so I stopped here. Choose them in Settings and I will pick up on your next visit." };
      pairs = normalizePairs(prompts, state.prompts.pairs);
      state.prompts.intendedPairs = prompts.length * ENGINES.length; // CANONICAL coverage only
      textOf = new Map(prompts.map((p) => [p.id, p.text]));
    }
    /** Every outcome that is NOT a landed answer still earns its canonical row, on the same identity a retry
     *  reuses, so an unread answer, a refusal and an in-flight ask are all readable facts instead of silence. */
    const note = (p: FunnelPair, status: AiObservationStatus, reason: string | null, over: Partial<AiObservationDraft> = {}) =>
      d.recordObservation(buildAiObservation(draftOf(p, obs, textOf.get(p.promptId) ?? p.promptText ?? "", nowIso(), status, { failureReason: reason, ...over })), tenantId);
    let failedDetail: string | null = null, blockedDetail: string | null = null, limitDetail: string | null = null, softUnavailable = false;
    /** Only a CANONICAL pair can pause the unit (auxiliary gaps block nothing); blocked is the one exception, handled separately as account-level truth from ANY pair. */
    const fail = (p: FunnelPair, detail?: string | null) => { if (isCanonical(p) && detail) failedDetail = detail; };
    // Budgets are per INCIDENT: a stale unsupported pair re-enters weekly with a fresh repost budget.
    for (const p of pairs) if (p.status === "unsupported" && p.observedAt && d.now() - Date.parse(p.observedAt) > FRESH_MS) { p.status = "pending"; p.cacheKey = null; p.reposts = undefined; }

    try {
      // 1) collect prior posted tasks (only a PROVEN-dead identity ever reposts)
      for (const p of pairs.filter((x) => x.status === "posted" && x.cacheKey)) {
        if (d.now() > deadline) break;
        const r = interp(await d.collectTask(p.cacheKey!)); track(state, r);
        if (r.modelRequested) p.modelRequested = r.modelRequested;
        if (r.kind === "evidence") {
          const parsed = d.parse(capabilityFor(p), r.payload as never) as ParsedAiAnswer | null; // unreadable evidence is a bounded failure, never a fake answer
          if (parsed) await landAnswer(p, r, parsed, textOf.get(p.promptId) ?? p.promptText ?? "", obs, nowIso(), d);
          else { await note(p, "unavailable", "The provider answered with something I could not read.", { cacheKey: r.cacheKey }); fail(p, "I collected an answer I could not read. I will retry it on the next pass."); }
        } else if (r.kind === "failed") {
          // The DISPOSITION decides. blocked on a CANONICAL pair = held refusal (row untouched, batch stops, run pauses); on an AUXILIARY pair it reads unsupported and never holds the run hostage. repost_once = ONE.
          await note(p, "failed", r.detail ?? null, { cacheKey: r.cacheKey });
          if (r.disposition === "daily_limit") { limitDetail = r.detail ?? null; break; }
          if (r.disposition === "blocked") { if (isCanonical(p)) { blockedDetail = blockedNote(r); break; } p.status = "unsupported"; p.observedAt = nowIso(); continue; }
          if (r.disposition === "repost_once") { if ((p.reposts ?? 0) >= 1) { p.status = "unsupported"; p.cacheKey = null; p.observedAt = nowIso(); } else { p.status = "pending"; p.cacheKey = null; p.reposts = 1; } }
          else if (r.disposition === "quarantined") { p.status = "unsupported"; p.observedAt = nowIso(); }
          else fail(p, r.detail ?? pauseDetail(r.disposition, "A prompt check did not come back. I will collect it on the next pass."));
        }
      }

      // 2) post/live stalest pending pairs, bounded. CANONICAL takes every slot first; auxiliary gets leftovers.
      const now = d.now();
      const todo = pairs.filter((p) => p.status === "pending" || (p.status === "done" && !pairFresh(p, now)))
        .sort((a, b) => (Number(isCanonical(b)) - Number(isCanonical(a))) || (a.observedAt ? Date.parse(a.observedAt) : 0) - (b.observedAt ? Date.parse(b.observedAt) : 0));
      let processed = 0, perp = 0, progressed = false;
      for (const p of todo) {
        if (blockedDetail || limitDetail || d.now() > deadline || processed >= 20) break;
        const text = textOf.get(p.promptId);
        if (!text || (p.engine === "perplexity" && perp >= 3)) continue;
        if (p.engine === "perplexity") perp += 1;
        const r = interp(await observeCall(d.callProvider, p, text, ids)); track(state, r);
        p.modelRequested = r.modelRequested ?? p.modelRequested ?? null;
        // The ask day is stamped BEFORE the row is written, so a task collected tomorrow keeps today's identity.
        if (r.kind === "waiting") { p.status = "posted"; p.cacheKey = r.cacheKey; p.requestedAt = nowIso(); progressed = true; await note(p, "pending", null, { costUsd: r.costUsd }); }
        else if (r.kind === "evidence") {
          const parsed = d.parse(capabilityFor(p), r.payload as never) as ParsedAiAnswer | null;
          if (parsed) { await landAnswer(p, r, parsed, text, obs, nowIso(), d); progressed = true; }
          else { await note(p, "unavailable", "The provider answered with something I could not read.", { cacheKey: r.cacheKey }); fail(p, "I got an answer I could not read. I will retry it on the next pass."); }
        } else if (r.kind === "failed") {
          // Same ladder as the collect above; quarantined = EXPLICIT unavailable coverage.
          await note(p, "failed", r.detail ?? null, { cacheKey: r.cacheKey });
          if (r.disposition === "daily_limit") { limitDetail = r.detail ?? null; break; }
          if (r.disposition === "blocked") { if (isCanonical(p)) { blockedDetail = blockedNote(r); break; } p.status = "unsupported"; p.observedAt = nowIso(); processed += 1; continue; }
          if (r.disposition === "quarantined") { p.status = "unsupported"; p.cacheKey = r.cacheKey; p.observedAt = nowIso(); fail(p, r.detail); }
          else fail(p, r.detail ?? pauseDetail(r.disposition, "A prompt check did not run. I will retry it on the next pass."));
        }
        else if (r.soft === "not_configured" && isCanonical(p)) softUnavailable = true; // genuine unavailable coverage
        processed += 1;
      }

      state.prompts.pairs = pairs; // bounded by construction: <= 100 prompts x 4 canonical + 20 auxiliary
      await save(d, tenantId, basis, state, ctx);
      if (limitDetail) return { status: "failed", cursor: { runId }, progress: pairProgress(state), detail: limitDetail }; // a reset-able ceiling, nothing held
      if (blockedDetail) return { status: "failed", cursor: { runId }, progress: pairProgress(state), detail: blockedDetail }; // a held refusal OUTRANKS done/advanced/waiting: never buried under unavailable counts
      const at = d.now(), canon = pairs.filter(isCanonical); // completion is judged on CANONICAL coverage ONLY
      const complete = canon.filter((p) => pairComplete(p, at)).length, freshDone = canon.filter((p) => pairFresh(p, at)).length;
      const unsupported = canon.filter((p) => p.status === "unsupported").length, anyPosted = canon.some((p) => p.status === "posted");
      // Honest status over the CURRENT canonical set: done needs every intended pair FRESHLY answered or EXPLICITLY unsupported plus one real answer; stale-done is outstanding.
      let status: FunnelUnitOutcome["status"];
      if (canon.length > 0 && freshDone > 0 && complete >= canon.length) { status = "done";
        if (unsupported > 0) failedDetail = `${unsupported} prompt checks were unavailable from the provider this round; the rest are in.`; }
      else if (failedDetail) status = "failed";
      else if (anyPosted) status = "waiting";
      else if (progressed) status = "advanced";
      else if (softUnavailable) { status = "failed"; failedDetail = "I could not reach the AI engines to check your prompts. I will try again on the next pass."; }
      else if (canon.some((p) => p.status === "pending")) { status = "failed"; failedDetail = "Some prompt checks did not run this pass. I will pick them up on the next pass."; }
      else if (freshDone === 0) { status = "failed"; failedDetail = "The provider could not return any prompt answers this round. I will try the whole set fresh on the next pass."; }
      else { status = "failed"; failedDetail = `${canon.length - complete} prompt checks are still outstanding. I will finish them on the next pass.`; }
      return { status, cursor: { runId }, progress: pairProgress(state), ...(failedDetail ? { detail: failedDetail } : {}) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", code: "state_conflict", cursor: { runId }, progress: pairProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
// ── B4: SERP analysis ───────────────────────────────────────────────────────
const refs = (parsed: ParsedSerp | null) => (parsed?.aiOverview?.references ?? []).map((r) => ({ url: r.url, domain: r.domain, title: r.title }));

function applySerp(s: FunnelSerp, parsed: ParsedSerp, nowIso: string): void {
  s.status = "done"; s.observedAt = nowIso; s.aiOverview = refs(parsed); s.related = parsed.relatedSearches.slice(0, 20);
  s.reposts = undefined; s.organic = parsed.organic.slice(0, 10).map((o) => ({ rank: o.rank, url: o.url, domain: o.domain, title: o.title })); // a landed look closes the incident
  s.paa = parsed.paaQuestions.map((q) => ({ question: q.question, answeringDomain: q.answeringDomain }));
}

const serpProgress = (s: FunnelState): FunnelCounters => ({ serpsAnalyzed: s.serps.analyzed, cacheHits: s.cycle.cacheHits, spendUsd: round(s.cycle.spentUsd) });

/** `priorityQueries`: plain strings from the caller (Evidence never reads Decision), the exact searches an open investigation cannot close without. Empty is honest and leaves the agenda exactly as it was. */
export function serpAnalysisUnit(deps: FunnelDeps = {}, priorityQueries: string[] = []): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const unitKey = `serps:${tenantId}`, ids = { tenantId, unitKey }, deadline = d.now() + Math.max(1000, budgetMs);
    const loaded = await d.loadState(tenantId, basis), state = loaded.state;
    beginCycle(state, cursor, unitKey);
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion }, retained = state.discovery.retained;
    // PRUNE to the CURRENT chosen set: an obsolete query can never satisfy a new one. The agenda is
    // DECISION-scoped, never volume-ranked (my own page queries, my tracked questions, every confirmed
    // theme, then bounded exploration), and every trusted query is bought in the customer's own words.
    const profile = await d.loadProfile(tenantId).catch(() => null);
    const themes = profile ? [...profile.offerings.value, ...profile.topicsToOwn.value, ...profile.customerProblems.value] : [];
    const byPrompt = new Map<string, { text: string; fanOutQueries: string[] }>(); // ONE row per tracked question: approved text + every fan-out observed for it
    for (const p of state.prompts.pairs) { const row = byPrompt.get(p.promptId) ?? { text: "", fanOutQueries: [] }; if (!row.text && p.promptText) row.text = p.promptText; row.fanOutQueries.push(...(p.fanOutQueries ?? [])); byPrompt.set(p.promptId, row); }
    const prompts = [...byPrompt.values()].filter((p) => p.text || p.fanOutQueries.length > 0);
    const pageQueries = await d.loadPageQueries(tenantId).catch(() => null);
    // FAIL BEFORE SPEND: no readable business basics, no readable page queries and no tracked questions means I have
    // NO trusted starting point, so I buy nothing this pass and leave the research already saved exactly as it is.
    if (profile === null && pageQueries === null && prompts.length === 0) return { status: "failed", cursor, progress: serpProgress(state), detail: "I could not read any of your trusted starting points this pass, so I spent nothing. I will try again on your next visit." };
    const agenda = selectSerpAgenda({ retained, themes, prompts, pageQueries: pageQueries ?? [], priorityQueries }, 40);
    const chosen = agenda.queries; // an empty researched set no longer blocks the phase: my own page queries are checked verbatim, researched or not
    if (chosen.length === 0) return { status: "failed", cursor, progress: serpProgress(state), detail: "I have no researched keywords to check in search yet." };
    // Internal progress truth only: what I could not defend and what the provider would refuse. Never customer copy.
    if (agenda.uncoveredThemes.length > 0 || agenda.skipped.length > 0) log.info("[research-funnel] serp agenda gaps", { tenantId, uncoveredThemes: agenda.uncoveredThemes, skipped: agenda.skipped });
    const byQ = new Map(state.serps.queries.map((s) => [s.query, s])), top5 = new Set(chosen.slice(0, 5));
    const serps: FunnelSerp[] = chosen.map((q) => byQ.get(q) ?? { query: q, cacheKey: null, status: "pending" });
    const nowIso = () => new Date(d.now()).toISOString(), parseSerp = (payload: unknown) => d.parse("serp_organic", payload as never) as ParsedSerp | null;
    let failedDetail: string | null = null, blockedDetail: string | null = null;
    // A look older than the weekly window is DUE (done OR exhausted-failed): it re-enters with a fresh per-incident budget and its AI Mode observation re-opens, so nothing freezes forever.
    for (const s of serps) {
      if ((s.status !== "done" && s.status !== "failed") || !s.observedAt || d.now() - Date.parse(s.observedAt) <= FRESH_MS) continue;
      s.status = "pending"; s.cacheKey = null; s.reposts = undefined;
      s.aiMode = undefined; s.aiModeCacheKey = null; s.aiModeReposted = undefined; s.aiModeFailed = undefined;
    }

    try {
      // 1) collect posted organic + AI Mode tasks (never repost a live key)
      for (const s of serps) {
        if (blockedDetail || d.now() > deadline) break;
        if (s.status === "posted" && s.cacheKey) {
          const r = interp(await d.collectTask(s.cacheKey)); track(state, r);
          if (r.kind === "evidence") { const parsed = parseSerp(r.payload); if (parsed) applySerp(s, parsed, nowIso()); }
          else if (r.kind === "failed") {
            // blocked leaves the row posted and STOPS the batch; everything else stays posted, free.
            if (r.disposition === "blocked") blockedDetail = blockedNote(r);
            else if (r.disposition === "quarantined") { s.status = "failed"; s.observedAt = nowIso(); failedDetail = r.detail ?? failedDetail; }
            else if (r.disposition !== "repost_once") failedDetail = r.detail ?? pauseDetail(r.disposition, "A search did not finish. I will retry it on the next pass.");
            else if ((s.reposts ?? 0) >= 1) { s.status = "failed"; s.observedAt = nowIso(); failedDetail = "A search could not be completed after a second try. I will try it fresh next week."; }
            else { s.status = "pending"; s.cacheKey = null; s.reposts = 1; }
          }
        }
        if (!blockedDetail && top5.has(s.query) && s.aiModeCacheKey && !s.aiMode && !s.aiModeFailed) {
          const r = interp(await d.collectTask(s.aiModeCacheKey)); track(state, r);
          if (r.kind === "evidence") { s.aiMode = refs(d.parse("serp_ai_mode", r.payload as never) as ParsedSerp | null); s.aiModeReposted = undefined; }
          else if (r.kind === "failed") {
            // blocked STOPS the batch; quarantined names the gap; repost_once gets ONE clean repost. Never silent.
            if (r.disposition === "blocked") blockedDetail = blockedNote(r);
            else if (r.disposition === "quarantined") s.aiModeFailed = true;
            else if (r.disposition !== "repost_once") failedDetail = r.detail ?? pauseDetail(r.disposition, "An AI Mode look did not finish. I will retry it on the next pass.");
            else if (s.aiModeReposted) s.aiModeFailed = true;
            else { s.aiModeCacheKey = null; s.aiModeReposted = true; }
          }
        }
      }

      // 2) post pending organic (and AI Mode for the strongest few)
      let processed = 0;
      for (const s of serps) {
        if (blockedDetail || d.now() > deadline || processed >= 40) break;
        if (s.status === "pending") {
          const r = interp(await d.callProvider("serp_organic", { keyword: s.query }, ids)); track(state, r);
          if (r.kind === "waiting") { s.status = "posted"; s.cacheKey = r.cacheKey; }
          else if (r.kind === "evidence") { const parsed = parseSerp(r.payload); if (parsed) applySerp(s, parsed, nowIso()); }
          else if (r.kind === "failed") {
            // blocked is the ONE stop; quarantined = explicit unavailable coverage; the rest continue.
            if (r.disposition === "blocked") blockedDetail = blockedNote(r);
            else if (r.disposition === "quarantined") { s.status = "failed"; s.observedAt = nowIso(); }
            else failedDetail = pauseDetail(r.disposition, r.detail ?? "A search did not run. I will retry it on the next pass.");
          }
          processed += 1;
        }
        if (!blockedDetail && top5.has(s.query) && s.aiModeCacheKey == null && !s.aiModeFailed && s.status !== "failed") {
          const r = interp(await d.callProvider("serp_ai_mode", { keyword: s.query }, ids)); track(state, r);
          if (r.kind === "waiting") s.aiModeCacheKey = r.cacheKey;
          else if (r.kind === "evidence") { s.aiModeCacheKey = r.cacheKey; s.aiMode = refs(d.parse("serp_ai_mode", r.payload as never) as ParsedSerp | null); }
          else if (r.kind === "failed") {
            // As the collect twin, except repost_once and none spend the ONE AI Mode retry before the gap is named.
            if (r.disposition === "blocked") blockedDetail = blockedNote(r);
            else if (r.disposition === "quarantined") s.aiModeFailed = true;
            else if (r.disposition === "repost_once" || r.disposition === "none") { if (s.aiModeReposted) s.aiModeFailed = true; else s.aiModeReposted = true; }
            else failedDetail = pauseDetail(r.disposition, "I could not start an AI Mode look this pass. I will try again on the next pass.");
          }
        }
      }

      state.serps.queries = serps.slice(0, 60); state.serps.analyzed = serps.filter((s) => s.status === "done").length;
      await save(d, tenantId, basis, state, ctx);
      if (blockedDetail) return { status: "failed", cursor, progress: serpProgress(state), detail: blockedDetail }; // a held refusal OUTRANKS the done arithmetic and every unavailable count
      // AI Mode truth is judged for the CURRENT top five ONLY: a dropped row can neither pause nor pollute this phase.
      const topRows = serps.filter((s) => top5.has(s.query)), aiModeMissing = topRows.filter((s) => s.aiModeFailed).length;
      const aiModeInFlight = topRows.some((s) => s.aiModeCacheKey && !s.aiMode && !s.aiModeFailed), unavailable = serps.filter((s) => s.status === "failed").length;
      const anyPending = serps.some((s) => s.status === "pending" || s.status === "posted") || aiModeInFlight;
      // done = every CURRENT query freshly analyzed or explicitly unavailable, one real look minimum, no AI Mode live; unavailable is surfaced.
      let status: FunnelUnitOutcome["status"];
      if (state.serps.analyzed > 0 && state.serps.analyzed + unavailable >= chosen.length && !aiModeInFlight) { status = "done";
        if (unavailable > 0) failedDetail = `${unavailable} searches were unavailable from the provider; the rest are in.`;
        else if (aiModeMissing > 0) failedDetail = `${aiModeMissing} AI Mode looks were unavailable from the provider; the search results themselves are in.`; }
      else if (anyPending) status = "waiting";
      else status = "failed";
      const detail = status === "failed" ? (failedDetail ?? "Some searches did not finish. I will retry them on the next pass.") : failedDetail;
      return { status, cursor, progress: serpProgress(state), ...(detail ? { detail } : {}) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", code: "state_conflict", cursor, progress: serpProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
// ── B6: PURE snapshot projector ─────────────────────────────────────────────

const competitionLevel = (c: number | null): "low" | "medium" | "high" | null => (c == null ? null : c < 0.34 ? "low" : c < 0.67 ? "medium" : "high");

/** Read-only: normalize the persisted funnel state into the canonical research evidence bundle plus an explicit receipt. The state is already pruned to the CURRENT set, so nothing obsolete can be projected. The receipt's money and cache numbers are THIS RUN's, not a lifetime total. PURE. */
export function projectFunnelEvidence(state: FunnelState, now: number): FunnelResearchEvidence {
  const donePairs = state.prompts.pairs.filter((p) => p.status === "done");
  const observedTimes = donePairs.map((p) => p.observedAt).filter((t): t is string => !!t).sort(), isStale = (at: string | undefined) => !at || now - Date.parse(at) > FRESH_MS;
  // Receipt denominators are CANONICAL only, derived from the pairs themselves so a pre-6I persisted intendedPairs (which included auxiliary work) can never overstate missing.
  const canonIntended = state.prompts.pairs.filter(isCanonical).length;
  const stale = donePairs.filter((p) => isCanonical(p) && isStale(p.observedAt)).length
    + state.serps.queries.filter((s) => s.status === "done" && isStale(s.observedAt)).length;
  const missing = Math.max(0, canonIntended - donePairs.filter(isCanonical).length)
    + state.serps.queries.filter((s) => s.status !== "done").length + state.serps.queries.filter((s) => s.aiModeFailed).length;
  const doneSerps = state.serps.queries.filter((s) => s.status === "done");
  return {
    // LINEAGE rides along: how each keyword was found, and the confirmed theme it was found from. Both are recorded facts, so nothing downstream has to guess them.
    retainedKeywords: state.discovery.retained.map((k) => ({ query: k.keyword, searchVolume: k.searchVolume, competition: k.competition, competitionLevel: k.competitionLevel ?? competitionLevel(k.competition), difficulty: k.difficulty ?? null, intent: k.intent, discoveredVia: k.discoveredVia, seed: k.seed ?? null, rankedUrl: k.rankedUrl ?? null, rankedRank: k.rankedRank ?? null })),
    aiObservations: donePairs.map((p) => ({
      promptId: p.promptId, promptText: p.promptText ?? "", engine: p.engine, observationMode: modeOf(p),
      modelRequested: p.modelRequested ?? null, modelServed: p.modelServed ?? null,
      webSearchReported: p.webSearchReported ?? null, citationsObserved: p.citationsObserved ?? (p.citations != null),
      citations: p.citations ?? null, fanOutQueries: p.fanOutQueries ?? null, observedAt: p.observedAt ?? "",
    })),
    serpEvidence: doneSerps.map((s) => ({
      query: s.query,
      observedAt: s.observedAt ?? null,
      organic: (s.organic ?? []).map((o) => ({ rank: o.rank, domain: o.domain, url: o.url, title: o.title ?? null })),
      aiOverview: (s.aiOverview ?? []).map((a) => ({ url: a.url, domain: a.domain, title: a.title ?? null })),
      aiMode: (s.aiMode ?? []).map((a) => ({ url: a.url, domain: a.domain, title: a.title ?? null })),
      paa: s.paa ?? [], related: s.related ?? [],
    })),
    winningPages: state.winningPages.map((w) => ({ url: w.url, domain: w.domain, engines: w.engines, examplePrompts: w.examplePrompts, appearances: w.appearances, extract: w.extract, readOutcome: w.readOutcome ?? null })),
    // Stored in the canonical shape, so this carries it through UNTRANSLATED: a reader matches on the topic AND the normalized ask, and never trusts that an answer in hand is the one it asked for.
    pageComparisons: state.pageComparisons, ownedReads: state.ownedReads ?? [],
    receipt: { researched: state.discovery.counts.raw, retained: state.discovery.counts.retained, stale, missing, cached: state.cycle.cacheHits, spentUsd: round(state.cycle.spentUsd), freshestObservationAt: observedTimes.at(-1) ?? null },
  };
}
