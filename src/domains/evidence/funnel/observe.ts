import "server-only";
import { reportingDay } from "@/lib/reporting-day";
/** Canonical capture, SERP execution and pure projection. Posted tasks resume; blocked refusals stop spend. */
import { log } from "@/lib/logger";
import {
  buildAiObservation,
  type AiObservationDraft, type AiObservationStatus, type DueObservation,
} from "@/domains/evidence/ai-visibility/ai-observations";
import type { CachedCallResult, CapabilityKey, FunnelCounters, FunnelUnitFn, FunnelUnitOutcome, ParsedAiAnswer, ParsedSerp } from "@/domains/evidence/dataforseo/funnel-boundary";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { normalizeKeyword, selectSerpAgenda } from "./normalize";
import { type FunnelPair, type FunnelSerp, type FunnelState } from "./state";
import { type FunnelResearchEvidence, type ObservationMode, type ResearchEngine } from "./research-evidence";
import { isCurrent } from "@/domains/evidence/freshness";
import { basisFromCursor, beginCycle, CONFLICT_DETAIL, interp, type Interp, modeOf, NO_BASIS_DETAIL, pauseDetail, resolveDeps, round, save, type SaveCtx, sha16, StateConflictError, track, type FunnelDeps, type ResolvedDeps } from "./shared";
// blocked = a HELD refusal at zero further spend; it ALWAYS pauses the run, so prefer the boundary's own detail.
const blockedNote = (r: Interp) => r.detail || pauseDetail("blocked", "");
// ── B3: prompt observation ──────────────────────────────────────────────────
const ENGINES: ResearchEngine[] = ["chatgpt", "gemini", "claude", "perplexity"];
/** CANONICAL coverage = the ChatGPT consumer search experience (the citation-grade look real people get) plus the standardized response on the other three. */
const canonicalMode = (e: ResearchEngine): ObservationMode => (e === "chatgpt" ? "consumer_search" : "standardized_response");
/** A deliberate second sample of one pair on one day is a DIFFERENT observation, so the slot is part of the working identity exactly as it is part of the stored one. A row without a slot is slot 0. */
const slotOf = (p: FunnelPair) => p.slot ?? 0;
/** Working and stored identities include the reporting day: yesterday is never today's retry. */
const pairKey = (p: FunnelPair) => `${p.promptId}|${p.engine}|${modeOf(p)}|${slotOf(p)}|${p.day ?? ""}`;
const capabilityFor = (p: FunnelPair): CapabilityKey => (p.engine === "chatgpt" && modeOf(p) === "consumer_search" ? "llm_scraper_chatgpt" : (`llm_${p.engine}` as CapabilityKey));
/** The engines I can actually ask. Anything else is answered honestly as unsupported at ZERO spend. */
const OBSERVABLE = new Set<string>(ENGINES);
/** How many readings wait on their assistant at once. Four keeps every provider well inside its own concurrency
 *  and one pass inside its deadline, and it is what the page reader already uses. The per-engine ceilings above still decide WHICH readings are asked; this only decides how many wait at the same time. */
const ASK_AT_ONCE = 4;
/** Each capability gets EXACTLY its documented ask: ChatGPT llm_responses web_search only (live o4-mini rejected force, 40501); Claude force + country; Gemini web_search only; perplexity none; the scraper is KEYWORD-based.
 *  The plan's reporting day and a deliberate second slot ride ALONGSIDE that ask: the registry keys on them
 *  and no builder emits them, so tomorrow's reading and a second sample are genuinely new questions to the  provider instead of a $0 replay of the answer already in the one-day cache. */
function observeCall(callProvider: ResolvedDeps["callProvider"], p: FunnelPair, text: string, ids: { tenantId: string; unitKey: string }): Promise<CachedCallResult> {
  const obs = { observation_day: p.day, ...(slotOf(p) > 0 ? { sample_slot: slotOf(p) } : {}) };
  switch (capabilityFor(p)) {
    case "llm_scraper_chatgpt": return callProvider("llm_scraper_chatgpt", { keyword: text, force_web_search: true, expand_citations: true, ...obs }, ids);
    case "llm_gemini": return callProvider("llm_gemini", { user_prompt: text, web_search: true, ...obs }, ids);
    case "llm_perplexity": return callProvider("llm_perplexity", { user_prompt: text, ...obs }, ids);
    case "llm_claude": return callProvider("llm_claude", { user_prompt: text, web_search: true, force_web_search: true, web_search_country_iso_code: "US", ...obs }, ids);
    default: return callProvider("llm_chatgpt", { user_prompt: text, web_search: true, ...obs }, ids);
  }
}

/** Progress over exactly the readings this pass was asked to take. */
function pairProgress(s: FunnelState): FunnelCounters {
  const pairs = s.prompts.pairs;
  return { promptsChecked: new Set(pairs.map((p) => p.promptId)).size, enginePairsDone: pairs.filter((p) => p.status === "done").length,
    enginePairsIntended: s.prompts.intendedPairs, cacheHits: s.cycle.cacheHits, spendUsd: round(s.cycle.spentUsd) };
}

/** Who this batch of observations belongs to, resolved ONCE per pass. */
type ObsIds = { tenantId: string; site: string; runId: string };

/** The account's own website, stamped on every observation so a stored answer names the site it is about.
 *  A failed read is not a reason to stop observing, so it reads empty rather than guessing a domain. */
async function siteOf(d: ResolvedDeps, tenantId: string): Promise<string> {
  try { return (await d.getAccount(tenantId))?.domain ?? ""; } catch { return ""; }
}

/** ONE construction of the canonical observation draft, whatever the outcome. The pair carries the identity (prompt, version, engine, ask day, slot); the caller supplies only what actually happened. */
function draftOf(p: FunnelPair, ids: ObsIds, text: string, at: string, status: AiObservationStatus, over: Partial<AiObservationDraft> = {}): AiObservationDraft {
  return {
    tenantId: ids.tenantId, site: ids.site, promptId: p.promptId, promptVersion: p.promptVersion ?? 1,
    promptText: text, engine: p.engine, mode: modeOf(p), slot: slotOf(p),
    // Every pair in the working set carries the plan's own day (the planned ones by construction, a carried
    // in-flight one because only a dated row is carried), so the clock here is unreachable defense.
    day: p.day ?? at.slice(0, 10),
    requestedAt: p.requestedAt ?? at, capability: `${capabilityFor(p)}@v3`,
    // THE RUN THIS READING WAS TAKEN ON rides the canonical row too. It reached the derived history row from
    // the first day and stopped there, so the record that IS the truth could not name its own run and no
    // reader could ask "which pass bought this answer" without going through the projection to find out.
    cacheKey: p.cacheKey, modelRequested: p.modelRequested ?? null, runId: ids.runId, status, ...over,
  };
}

/** THE full-fidelity landing: the whole answer, the whole retrieval journey, the money receipt and the cache identity of the raw envelope land as ONE
 * canonical row, and the historical prompt_answer_observations row is DERIVED from that same record in the same breath. Two writes, one truth: nothing
 * composes a history row independently any more, so the two can never disagree. */
async function landAnswer(p: FunnelPair, r: Interp, parsed: ParsedAiAnswer, promptText: string, ids: ObsIds, nowIso: string, d: ResolvedDeps): Promise<void> {
  // THE MONEY IS THE PLACEMENT'S. A posted ask is finished by a FREE collect, so the cost on the final row is what the placement paid PLUS whatever this landing itself cost; the collect's own zero never erases it.
  const rec = buildAiObservation(draftOf(p, ids, promptText, nowIso, "observed", { completedAt: nowIso, cacheKey: r.cacheKey ?? p.cacheKey, costUsd: round(r.costUsd + (p.postCostUsd ?? 0)), parsed }));
  // AN IDENTITY POSTED BEFORE the pair carried its own cost still holds the paid placement on the pending row this upserts over: when the landing computed nothing, keep what is on file rather than zeroing a receipt.
  if (rec.cost_usd === 0) rec.cost_usd = await d.readObservationCost(ids.tenantId, rec.id).catch(() => 0);
  p.status = "done"; p.cacheKey = r.cacheKey ?? p.cacheKey; p.observedAt = nowIso; p.promptText = promptText;
  p.reposts = undefined; p.requestedAt = undefined; p.postCostUsd = undefined; // a landed answer closes the incident: fresh budget next time
  p.modelServed = parsed.modelServed ?? r.modelServed; p.webSearchReported = parsed.webSearchReported;
  p.citationsObserved = parsed.citations !== null;
  p.citations = parsed.citations ? parsed.citations.map((c) => ({ url: c.url, domain: c.domain, title: c.title })) : null;
  p.fanOutQueries = parsed.fanOutQueries; p.answerHash = parsed.answerText ? sha16(parsed.answerText) : null;
  // THE RETRIEVAL LIST AND THE ENGINE'S OWN BRAND LIST travel to the snapshot AS REPORTED: the canonical row held both from Phase 1, but the funnel projection dropped them, so Decision could never ask "was I read
  // and passed over" - the exact question the observation was bought to answer. It subtracts.
  p.retrievedResults = parsed.retrievedResults ? parsed.retrievedResults.map((c) => ({ url: c.url, domain: c.domain, title: c.title })) : null;
  p.brandMentions = parsed.brandMentions ?? null;
  await d.recordObservation(rec, ids.tenantId);
}

/** The set Runtime's planner says is DUE: one row per (prompt, version, engine, slot, reporting day), each in that engine's canonical retrieval mode. THE
 * PLANNER IS THE FRESHNESS AUTHORITY (it reads the stored observations), so a persisted row NEVER overrules it: only an in-flight task on the very same
 * identity carries forward, and only so today's free collect finishes what today's post started. */
function pairsFromDue(due: DueObservation[], persisted: FunnelPair[]): FunnelPair[] {
  const byKey = new Map(persisted.map((p) => [pairKey(p), p]));
  return due.map((x) => {
    const ip: FunnelPair = { promptId: x.promptId, engine: x.engine, mode: canonicalMode(x.engine), slot: x.slot, day: x.day,
      promptVersion: x.version, promptText: x.text, cacheKey: null, status: "pending" };
    const kept = byKey.get(pairKey(ip));
    if (kept?.status === "posted" && kept.cacheKey) return { ...ip, status: "posted", cacheKey: kept.cacheKey, reposts: kept.reposts, requestedAt: kept.requestedAt, modelRequested: kept.modelRequested, postCostUsd: kept.postCostUsd };
    // A pair PROVEN unavailable on this very day keeps that answer: the repost budget is per incident, and
    // an incident is one day. Without it every visit re-posted a dead identity at full price all day long.
    if (kept?.status === "unsupported") return { ...ip, status: "unsupported", cacheKey: kept.cacheKey, observedAt: kept.observedAt, reposts: kept.reposts };
    return ip;
  });
}

/** `due`: the exact (prompt, version, engine, slot, reporting day) observations Runtime's planner says are owed right now. THE PLANNER IS THE ONLY SELECTOR.
 * There is no standing sweep of the tracked set here any more: two selectors meant one of them re-asked a question the other had already read today, and the
 * fallback fired precisely when the observation store was unreadable, which is the one moment re-asking the whole set is worst. So silence is never a
 * licence: null = the planner could not read what is due -> I do nothing and spend nothing. [] = nothing is owed -> today's round is already complete. A due
 * engine I cannot ask is answered as unsupported at ZERO spend, never quietly dropped. */
export function promptObservationUnit(deps: FunnelDeps = {}, due: DueObservation[] | null = null): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    // The planner could not read what is owed. NOTHING is implied by that: no plan, no work, no spend.
    if (due === null) return { status: "failed", cursor, progress: {}, detail: "Which questions are due to be checked today could not be read, so nothing was asked and nothing was spent. The next visit picks this up." };
    // Nothing is owed: today's one reading of every question on every engine is already in.
    if (due.length === 0) return { status: "done", cursor, progress: {} };
    const unitKey = `prompts:${tenantId}`, ids = { tenantId, unitKey }, deadline = d.now() + Math.max(1000, budgetMs);
    const loaded = await d.loadState(tenantId, basis), state = loaded.state;
    const runId = beginCycle(state, cursor, unitKey), ctx: SaveCtx = { rowVersion: loaded.rowVersion };
    const nowIso = () => new Date(d.now()).toISOString();
    const obs: ObsIds = { tenantId, site: await siteOf(d, tenantId), runId };
    // The planner already excludes an engine it cannot ask, so this is DEFENSE against plan-versus-execution drift (a newly added engine, an older plan): the
    // row is written unsupported without a provider call, so the gap is named rather than disappearing.
    for (const x of due.filter((y) => !OBSERVABLE.has(y.engine))) {
      await d.recordObservation(buildAiObservation({ tenantId, site: obs.site, runId, promptId: x.promptId, promptVersion: x.version, promptText: x.text,
        engine: x.engine, mode: canonicalMode(x.engine), slot: x.slot, day: x.day, requestedAt: nowIso(), capability: "unavailable", status: "unsupported",
        failureReason: `I cannot ask ${x.engine} for you yet, so I spent nothing on it.` }), tenantId);
    }
    const askable = due.filter((x) => x.promptId && x.text && x.day && OBSERVABLE.has(x.engine)).slice(0, 400);
    if (askable.length === 0) return { status: "failed", cursor, progress: pairProgress(state), detail: "None of the questions that came due can be checked on an engine I can reach yet, so I spent nothing. I will pick them up as soon as one is available." };
    const planned = pairsFromDue(askable, state.prompts.pairs), plannedKeys = new Set(planned.map(pairKey));
    // A task posted on an EARLIER day is collected FREE and lands on ITS OWN day: the money already moved, so abandoning it would be waste. It is never
    // re-posted, because a missed day is gone. A pre-repair posted pair carries no day; its money is already spent, so it is collected ONCE onto the day it
    // lands rather than abandoned (legacy rows only, they die out after one collect).
    const carried = state.prompts.pairs.filter((p) => p.status === "posted" && p.cacheKey && !plannedKeys.has(pairKey(p))).slice(0, 40);
    const pairs = [...carried, ...planned];
    state.prompts.intendedPairs = planned.length;
    const textOf = new Map(askable.map((x) => [x.promptId, x.text]));
    /** Every outcome that is NOT a landed answer still earns its canonical row, on the same identity a retry
     *  reuses, so an unread answer, a refusal and an in-flight ask are all readable facts instead of silence. */
    const note = (p: FunnelPair, status: AiObservationStatus, reason: string | null, over: Partial<AiObservationDraft> = {}) =>
      d.recordObservation(buildAiObservation(draftOf(p, obs, textOf.get(p.promptId) ?? p.promptText ?? "", nowIso(), status, { failureReason: reason, ...over })), tenantId);
    let failedDetail: string | null = null, blockedDetail: string | null = null, limitDetail: string | null = null, softUnavailable = false;
    const fail = (detail?: string | null) => { if (detail) failedDetail = detail; };

    try {
      // 0) RECONCILE STATE AGAINST THE CANONICAL ROW, once, before anything is collected or bought. A pair terminalizes where its disposition LANDS, and a pair
      //    already set aside never crosses that code again: the collect below skips it (not posted) and the post below skips it (not pending). So a pair the old
      //    code settled in memory alone kept a canonical row reading `failed`, the whole-day gate is derived from those rows, and two Perplexity checks held a
      //    140 reading day at 138 through every recovery window for four days. THE PLANNER IS THE PROOF: it only hands me identities whose stored row it still
      //    reads as owed, so a PLANNED pair already terminal in state IS that divergence and this is the one write that closes it. Free: no provider call, no
      //    repost, no spend, and it settles the class rather than the instance.
      for (const p of planned.filter((x) => x.status === "unsupported").slice(0, 40)) {
        await note(p, "unavailable", "I set this check aside earlier today so I would not run it twice, and I could not confirm what the provider did with it.",
          { cacheKey: p.cacheKey, completedAt: p.observedAt ?? nowIso() });
      }

      // 1) collect prior posted tasks (only a PROVEN-dead identity ever reposts)
      for (const p of pairs.filter((x) => x.status === "posted" && x.cacheKey)) {
        if (d.now() > deadline) break;
        const r = interp(await d.collectTask(p.cacheKey!)); track(state, r);
        if (r.modelRequested) p.modelRequested = r.modelRequested;
        if (r.kind === "evidence") {
          const parsed = d.parse(capabilityFor(p), r.payload as never) as ParsedAiAnswer | null; // unreadable evidence is a bounded failure, never a fake answer
          if (parsed) await landAnswer(p, r, parsed, textOf.get(p.promptId) ?? p.promptText ?? "", obs, nowIso(), d);
          else { await note(p, "unavailable", "The provider answered with something I could not read.", { cacheKey: r.cacheKey }); fail("I collected an answer I could not read. I will retry it on the next pass."); }
        } else if (r.kind === "failed") {
          // The DISPOSITION decides: blocked = held refusal (row untouched, batch stops, run pauses); repost_once = ONE. A cleared requestedAt is the
          // point of the recovery ones: whatever lands later stamps its OWN moment. AND THE CANONICAL ROW SAYS WHAT THE DISPOSITION DECIDED, because a
          // pair set aside for good went `unsupported` in memory and `failed` on the stored row: the planner read it as owed on every window, so on
          // 4 August two of them repeated 138 of 140 every half hour for nine hours and the day never crawled, never synthesized and never published.
          const dead = r.disposition === "quarantined" || (r.disposition === "repost_once" && (p.reposts ?? 0) >= 1);
          await note(p, dead ? "unavailable" : "failed", r.detail ?? null, { cacheKey: r.cacheKey, ...(dead ? { completedAt: nowIso() } : {}) });
          if (r.disposition === "daily_limit") { limitDetail = r.detail ?? null; break; }
          if (r.disposition === "blocked") { blockedDetail = blockedNote(r); break; }
          if (r.disposition === "repost_once") { p.cacheKey = null; p.requestedAt = undefined; if (dead) { p.status = "unsupported"; p.observedAt = nowIso(); } else { p.status = "pending"; p.reposts = 1; } }
          else if (r.disposition === "quarantined") { p.status = "unsupported"; p.observedAt = nowIso(); p.requestedAt = undefined; }
          else fail(r.detail ?? pauseDetail(r.disposition, "A prompt check did not come back. I will collect it on the next pass."));
        }
      }

      // 2) post the pending readings, IN THE PLANNER'S OWN ORDER (core first, oldest missing first), bounded.
      //    A carried in-flight pair from another day is collected above and never re-posted here.
      const todo = pairs.filter((p) => p.status === "pending" && plannedKeys.has(pairKey(p)));
      let processed = 0, perp = 0, progressed = false;
      // THE WAVE, NOT THE QUEUE. Every reading was asked one at a time, and an assistant that searches before it
      // answers takes over a minute, so a pass spent its whole deadline on three readings and a day of a hundred
      // and forty needed dozens of passes across dozens of half-hourly ticks to finish work worth a few minutes.
      // The eligible readings are chosen FIRST, in the planner's own order and under the same ceilings, and then
      // asked ASK_AT_ONCE at a time: the order, the ceilings, the per-pair writes and every disposition below are exactly what they were, and only the waiting overlaps.
      const wave: typeof todo = [];
      for (const p of todo) {
        if (wave.length >= 20) break;
        const t = textOf.get(p.promptId);
        if (!t || (p.engine === "perplexity" && perp >= 3)) continue;
        if (p.engine === "perplexity") perp += 1;
        wave.push(p);
      }
      let taken = 0;
      const ask = async (p: (typeof wave)[number]): Promise<void> => {
        const text = textOf.get(p.promptId);
        if (!text) return;
        const r = interp(await observeCall(d.callProvider, p, text, ids)); track(state, r);
        p.modelRequested = r.modelRequested ?? p.modelRequested ?? null;
        if (r.kind === "waiting") { p.status = "posted"; p.cacheKey = r.cacheKey; p.requestedAt = nowIso(); p.postCostUsd = (p.postCostUsd ?? 0) + r.costUsd; progressed = true; await note(p, "pending", null, { costUsd: r.costUsd }); }
        else if (r.kind === "evidence") {
          const parsed = d.parse(capabilityFor(p), r.payload as never) as ParsedAiAnswer | null;
          if (parsed) { await landAnswer(p, r, parsed, text, obs, nowIso(), d); progressed = true; }
          else { await note(p, "unavailable", "The provider answered with something I could not read.", { cacheKey: r.cacheKey }); fail("I got an answer I could not read. I will retry it on the next pass."); }
        } else if (r.kind === "failed") {
          const held = r.disposition === "quarantined"; // same ladder as the collect above, and the same terminal row: quarantined = EXPLICIT unavailable coverage
          await note(p, held ? "unavailable" : "failed", r.detail ?? null, { cacheKey: r.cacheKey, ...(held ? { completedAt: nowIso() } : {}) });
          if (r.disposition === "daily_limit") { limitDetail = r.detail ?? null; return; }
          if (r.disposition === "blocked") { blockedDetail = blockedNote(r); return; }
          if (r.disposition === "quarantined") { p.status = "unsupported"; p.cacheKey = r.cacheKey; p.observedAt = nowIso(); p.requestedAt = undefined; fail(r.detail); }
          else fail(r.detail ?? pauseDetail(r.disposition, "A prompt check did not run. I will retry it on the next pass."));
        }
        else if (r.soft === "not_configured") softUnavailable = true; // genuine unavailable coverage
        processed += 1;
      };
      // A REFUSAL STOPS EVERYTHING, so the first reading is asked ALONE. A provider that is blocked, out of credit
      // or past its daily ceiling says so on that one call, and nothing else has been sent or stored: the batch
      // dies exactly where it died before. Only once one reading has come back clean do the rest overlap, and a refusal inside the wave still stops anything that has not been picked up.
      if (!blockedDetail && !limitDetail && wave.length > 0 && d.now() <= deadline) await ask(wave[taken++]!);
      await Promise.all(Array.from({ length: Math.min(ASK_AT_ONCE, Math.max(0, wave.length - taken)) }, async () => {
        for (;;) {
          if (blockedDetail || limitDetail || d.now() > deadline) return;
          const p = wave[taken++];
          if (!p) return;
          await ask(p);
        }
      }));

      state.prompts.pairs = pairs; // bounded by construction: one bounded daily plan plus its carried in-flight tasks
      await save(d, tenantId, basis, state, ctx);
      if (limitDetail) return { status: "failed", cursor: { runId }, progress: pairProgress(state), detail: limitDetail }; // a reset-able ceiling, nothing held
      if (blockedDetail) return { status: "failed", cursor: { runId }, progress: pairProgress(state), detail: blockedDetail }; // a held refusal OUTRANKS done/advanced/waiting: never buried under unavailable counts
      // Completion is judged on THE PLAN: what the planner asked for today, answered or explicitly unavailable.
      const done = planned.filter((p) => p.status === "done").length, unsupported = planned.filter((p) => p.status === "unsupported").length;
      const anyPosted = planned.some((p) => p.status === "posted");
      let status: FunnelUnitOutcome["status"];
      // A DAY PROVEN UNAVAILABLE IS A FINISHED DAY. Completion used to require a NEW answer in this very window, so a recovery round that only
      // terminalized the last two identities could never close and the phase repeated on itself forever.
      if (planned.length > 0 && done + unsupported >= planned.length) { status = "done";
        if (unsupported > 0) failedDetail = done === 0 // "the rest are in" over a day where NOTHING came back is a claim about answers that do not exist
          ? `I could not get an answer to any of today's ${planned.length} prompt checks; the provider had nothing to give on every one. Tomorrow's round asks them again.`
          : `${done} of today's ${planned.length} prompt checks came back; the other ${unsupported} were unavailable from the provider this round. Tomorrow's round asks those again.`; }
      else if (failedDetail) status = "failed";
      else if (anyPosted) status = "waiting";
      else if (progressed) status = "advanced";
      else if (softUnavailable) { status = "failed"; failedDetail = "I could not reach the AI engines to check your prompts. I will try again on the next pass."; }
      else if (planned.some((p) => p.status === "pending")) { status = "failed"; failedDetail = "Some prompt checks did not run this pass. I will pick them up on the next pass."; }
      else if (done === 0) { status = "failed"; failedDetail = "I did not get any new prompt answers this round. I will pick the rest up on the next pass."; }
      else { status = "failed"; failedDetail = `${planned.length - done - unsupported} prompt checks are still outstanding. I will finish them on the next pass.`; }
      return { status, cursor: { runId }, progress: pairProgress(state), ...(failedDetail ? { detail: failedDetail } : {}) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", code: "state_conflict", cursor: { runId }, progress: pairProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
// ── B4: SERP analysis ───────────────────────────────────────────────────────
const refs = (parsed: ParsedSerp | null) => (parsed?.aiOverview?.references ?? []).map((r) => ({ url: r.url, domain: r.domain, title: r.title }));

/** THE SEARCH THE PROVIDER SAYS IT RAN, off the envelope it sent back: the SERP result block echoes the ask
 *  (tasks[0].result[0].keyword) and the task carries the same string on its stored data. The typed ParsedSerp keeps only the results, so the echo is read here from the envelope itself. null = this payload echoed
 *  nothing, which is never proof of a match and is never treated as one. */
function echoedKeyword(payload: unknown): string | null {
  const task = (payload as { tasks?: { data?: { keyword?: unknown }; result?: { keyword?: unknown }[] }[] } | null)?.tasks?.[0];
  const echo = (Array.isArray(task?.result) ? task.result[0]?.keyword : undefined) ?? task?.data?.keyword;
  return typeof echo === "string" && echo.trim() ? echo : null;
}

/** A LANDING IS ACCEPTED ONLY WHERE THE PROVIDER ANSWERED THE SEARCH THAT WAS ASKED. The keyword it echoes is
 *  compared under the SAME normalization the ask was sent in; a mismatch is named on the row, held as unavailable coverage and kept out of evidence rather than stored as this search's own results page. An
 *  envelope that echoes NOTHING is not a mismatch: it is a match nobody can prove, so the results stand and what is verified is only what the response itself carries (its rows and its status). */
function applySerp(s: FunnelSerp, parsed: ParsedSerp, nowIso: string, payload: unknown, tenantId: string): void {
  const echo = echoedKeyword(payload), served = echo ? normalizeKeyword(echo) : null;
  if (served && served !== normalizeKeyword(s.query)) {
    log.warn("[research-funnel] serp identity mismatch", { tenantId, asked: s.query, served });
    s.status = "failed"; s.observedAt = nowIso; s.reposts = undefined; s.identityMismatch = { asked: s.query, served };
    return;
  }
  s.identityMismatch = undefined; // a clean landing closes an earlier mismatch on this row
  s.status = "done"; s.observedAt = nowIso; s.aiOverview = refs(parsed); s.related = parsed.relatedSearches.slice(0, 20);
  // EVERY ROW THIS LOOK PAID FOR IS KEPT, AND WHAT EACH ONE SAYS WITH IT. The request buys SERP_DEPTH results and the provider bills per ten, so slicing at ten threw away half of every purchase and every owned position past
  // nine; keeping ranks and urls alone threw away the words the results actually show, which is the only part a diagnosis can read a missing proposition out of. Every string arrives bounded from the parser.
  s.reposts = undefined; s.organic = parsed.organic.slice(0, SERP_ROWS_BOUGHT).map((o) => ({ rank: o.rank, url: o.url, domain: o.domain, title: o.title, snippet: o.snippet })); // a landed look closes the incident
  s.paa = parsed.paaQuestions.map((q) => ({ question: q.question, answeringDomain: q.answeringDomain, answer: q.answer }));
  // AND THE REST OF WHAT THE PAGE ALREADY CARRIED: its block list, its answer box with the answer in it, and the overview's own words. EACH IS WRITTEN ONLY WHERE THE PAYLOAD ACTUALLY SPOKE, so a response with no block
  // list leaves both unknown rather than claiming this page has no answer box. AN OUTSTANDING ASYNCHRONOUS STUB IS NOT AN OBSERVED ABSENCE either: `aiOverview: []` said both, so a search whose overview had simply not
  // landed yet read downstream as one Google shows no overview for, and `aiOverviewState` is the only place that difference is recorded. ONLY THE PROVIDER SENDING NO OVERVIEW BLOCK AT ALL IS ABSENCE: a block arriving with neither words nor references and claiming no outstanding load is a response nobody can read, so the state is left UNSET and projects as unknown, never as a page Google shows no overview on.
  if (parsed.itemTypes != null) { s.itemTypes = parsed.itemTypes.slice(0, 30); s.featured = parsed.featuredSnippet ?? null; }
  const excerpt = parsed.aiOverview?.excerpt; if (typeof excerpt === "string" && excerpt.trim()) s.aiOverviewText = excerpt; /* WORDS ALREADY BOUGHT ARE NEVER WIPED BY AN EMPTY STUB (reviewer, 2026-09-02): a query leaving the hot set returns an empty asynchronous block, and the old overwrite re-reported bought words as pending */ if (parsed.aiOverview != null) s.aiOverviewState = (typeof excerpt === "string" && excerpt.trim()) || s.aiOverview.length > 0 ? "observed" : parsed.aiOverview.asynchronous ? "pending" : undefined; else if (parsed.itemTypes != null) s.aiOverviewState = "absent"; // absence is a known block list with no overview block; an unreadable shape leaves the state as it was
}

const serpProgress = (s: FunnelState): FunnelCounters => ({ serpsAnalyzed: s.serps.analyzed, cacheHits: s.cycle.cacheHits, spendUsd: round(s.cycle.spentUsd) });

/** HOW MANY RESULTS PAGES ONE CYCLE MAY READ, with the cost math stated once so it is checkable against the files that hold each number. It was 40 agenda slots and 40 posts a pass, so an account with twenty two pages losing clicks waited a week before I had even LOOKED at the searches those pages live on.
 *  THE REAL CEILING IS 104, NOT 120. SERP_AGENDA_CAP is the cap the portfolios fill INTO, and the last one stops short of it on purpose: normalize.ts fills researched keywords to 80% of the cap (96 at 120) and then allows exploration a flat +8, so a full portfolio can name at most 104 searches. 120 is headroom, never a number this unit reaches.
 *  RESERVED COST AT THAT CEILING (reservations sit ABOVE the charge; reconcile drops every one to actual): 104 organic results pages x $0.0021 = $0.2184, plus 5 AI Mode looks x $0.0100 = $0.0500, so one cycle's whole exact-SERP allowance reserves $0.2684, against $0.1340 for the old 40 slots. Both per-call prices are serp_organic / serp_ai_mode estCostUsd in dataforseo/capabilities.ts.
 *  THE TWO CEILINGS THAT ACTUALLY REFUSE A CALL are elsewhere and neither moved: the per-account, per-platform MONTHLY cap (DEFAULT_MONTHLY_CAP_USD = $250 in dataforseo/client.ts, checked by reserve_provider_spend before every call, answering `capped`), and the PROVIDER's own daily cost limit (error 40203, arriving as the `daily_limit` disposition that stops the batch below). This constant is a work bound, not a money bound. CACHE DISCIPLINE IS UNCHANGED and is what makes the raise nearly free in practice: a query still inside its freshness window is never re-posted (serp_hot daily for a search the frozen plan is stuck on, serp_cold weekly for the rest), so a settled agenda replays at $0 and only genuinely due queries reach a provider. Every per-call reservation, disposition and repost rule below is untouched: this raises a bound, it removes none. */
const SERP_AGENDA_CAP = 120, SERP_POSTS_PER_PASS = 120, SERP_ROWS_KEPT = 160;
/** HOW MANY ORGANIC ROWS ONE LOOK KEEPS, which is every row the request bought: capabilities.ts asks for SERP_DEPTH (20) and DataForSEO bills per ten results, so half of every results page was paid for and dropped. */
const SERP_ROWS_BOUGHT = 20;

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
    // PRUNE to the CURRENT chosen set: an obsolete query can never satisfy a new one. The agenda is DECISION-scoped, never volume-ranked (my own page
    // queries, my tracked questions, every confirmed theme, then bounded exploration), and every trusted query is bought in the customer's own words.
    const profile = await d.loadProfile(tenantId).catch(() => null);
    const themes = profile ? [...profile.offerings.value, ...profile.topicsToOwn.value, ...profile.customerProblems.value] : [];
    const byPrompt = new Map<string, { text: string; fanOutQueries: string[] }>();
    const toDay = reportingDay(d.now()), fromDay = new Date(Date.parse(`${toDay}T12:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
    let observations;
    try { observations = await d.loadCanonicalObservations(tenantId, { fromDay, toDay }); }
    catch { return { status: "failed", cursor, progress: serpProgress(state), detail: "I could not read your stored AI evidence, so I spent nothing and kept your saved research." }; }
    for (const p of observations) { const row = byPrompt.get(p.promptId) ?? { text: "", fanOutQueries: [] }; if (!row.text) row.text = p.promptText; row.fanOutQueries.push(...(p.fanOutQueries ?? [])); byPrompt.set(p.promptId, row); }
    const prompts = [...byPrompt.entries()].map(([promptId, p]) => ({ ...p, promptId })).filter((p) => p.text || p.fanOutQueries.length > 0);
    const pageQueries = await d.loadPageQueries(tenantId).catch(() => null);
    // FAIL BEFORE SPEND: no readable business basics, no readable page queries and no tracked questions means I have
    // NO trusted starting point, so I buy nothing this pass and leave the research already saved exactly as it is.
    if (profile === null && pageQueries === null && prompts.length === 0) return { status: "failed", cursor, progress: serpProgress(state), detail: "I could not read any of your trusted starting points this pass, so I spent nothing. I will try again on your next visit." };
    const agenda = selectSerpAgenda({ retained, themes, prompts, pageQueries: pageQueries ?? [], priorityQueries }, SERP_AGENDA_CAP);
    const chosen = agenda.queries; // an empty researched set no longer blocks the phase: my own page queries are checked verbatim, researched or not
    if (chosen.length === 0) return { status: "failed", cursor, progress: serpProgress(state), detail: "I have no researched keywords to check in search yet." };
    // Internal progress truth only: what I could not defend and what the provider would refuse. Never customer copy.
    if (agenda.uncoveredThemes.length > 0 || agenda.skipped.length > 0) log.info("[research-funnel] serp agenda gaps", { tenantId, uncoveredThemes: agenda.uncoveredThemes, skipped: agenda.skipped });
    const byQ = new Map(state.serps.queries.map((s) => [s.query, s])), top5 = new Set(chosen.slice(0, 5));
    // WHO ASKED FOR THIS SEARCH rides the row from the moment it enters the agenda: a results page can then name
    // the question behind it instead of being matched back to one by its words, which no longer says WHICH question.
    const serps: FunnelSerp[] = chosen.map((q) => { const row = byQ.get(q) ?? { query: q, cacheKey: null, status: "pending" as const };
      const parent = agenda.parents[q]; return { ...row, ...(agenda.sources[q] ? { source: agenda.sources[q] } : {}), ...(parent ? { parentPromptId: parent } : {}) }; });
    const nowIso = () => new Date(d.now()).toISOString(), parseSerp = (payload: unknown) => d.parse("serp_organic", payload as never) as ParsedSerp | null;
    // A DAILY-LIMIT REFUSAL STOPS THE BATCH, exactly as it does on the AI-answer loops above: the provider answers 40203 the same way to every call it will take today, so carrying on asked it up to a hundred and four more times for a hundred and four identical refusals. A stopped row is still `pending`, which IS the owed state, so nothing is lost and nothing is re-bought: tomorrow's pass takes the same searches with a fresh limit.
    let failedDetail: string | null = null, blockedDetail: string | null = null, limitDetail: string | null = null;
    // HOT VERSUS COLD, and the plan is what tells them apart: a search a frozen case is stuck on is checked DAILY, because the whole run is waiting on it,
    // and every other search keeps the weekly window. One constant for both meant a case diagnosed this morning sat on yesterday's look for six more days.
    const hot = new Set((priorityQueries ?? []).map((q) => canonicalQueryKey(normalizeKeyword(q))).filter(Boolean));
    // A look older than ITS OWN window is DUE (done OR exhausted-failed): it re-enters with a fresh per-incident budget and its AI Mode observation re-opens, so nothing freezes forever.
    for (const s of serps) {
      if ((s.status !== "done" && s.status !== "failed") || !s.observedAt) continue;
      if (isCurrent(hot.has(canonicalQueryKey(s.query)) ? "serp_hot" : "serp_cold", s.observedAt, d.now())) continue;
      s.status = "pending"; s.cacheKey = null; s.reposts = undefined; s.identityMismatch = undefined;
      s.aiMode = undefined; s.aiModeCacheKey = null; s.aiModeReposted = undefined; s.aiModeFailed = undefined;
    }

    try {
      // 1) collect posted organic + AI Mode tasks (never repost a live key)
      for (const s of serps) {
        if (blockedDetail || limitDetail || d.now() > deadline) break;
        if (s.status === "posted" && s.cacheKey) {
          const r = interp(await d.collectTask(s.cacheKey)); track(state, r);
          if (r.kind === "evidence") { const parsed = parseSerp(r.payload); if (parsed) applySerp(s, parsed, nowIso(), r.payload, tenantId); }
          else if (r.kind === "failed") {
            // daily_limit and blocked both STOP the batch (the row stays posted, so its collect is still free tomorrow); everything else stays posted, free.
            if (r.disposition === "daily_limit") limitDetail = r.detail ?? null;
            else if (r.disposition === "blocked") blockedDetail = blockedNote(r);
            else if (r.disposition === "quarantined") { s.status = "failed"; s.observedAt = nowIso(); failedDetail = r.detail ?? failedDetail; }
            else if (r.disposition !== "repost_once") failedDetail = r.detail ?? pauseDetail(r.disposition, "A search did not finish. I will retry it on the next pass.");
            else if ((s.reposts ?? 0) >= 1) { s.status = "failed"; s.observedAt = nowIso(); failedDetail = "A search could not be completed after a second try. I will try it fresh next week."; }
            else { s.status = "pending"; s.cacheKey = null; s.reposts = 1; }
          }
        }
        if (!blockedDetail && !limitDetail && top5.has(s.query) && s.aiModeCacheKey && !s.aiMode && !s.aiModeFailed) {
          const r = interp(await d.collectTask(s.aiModeCacheKey)); track(state, r);
          if (r.kind === "evidence") { s.aiMode = refs(d.parse("serp_ai_mode", r.payload as never) as ParsedSerp | null); s.aiModeReposted = undefined; }
          else if (r.kind === "failed") {
            // daily_limit and blocked STOP the batch; quarantined names the gap; repost_once gets ONE clean repost. Never silent.
            if (r.disposition === "daily_limit") limitDetail = r.detail ?? null;
            else if (r.disposition === "blocked") blockedDetail = blockedNote(r);
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
        if (blockedDetail || limitDetail || d.now() > deadline || processed >= SERP_POSTS_PER_PASS) break;
        if (s.status === "pending") {
          // THE OVERVIEW IS BOUGHT ONLY WHERE IT IS READ. `load_async_ai_overview` costs $0.0006 a request (refunded when the search has no async overview), so it rides exactly the searches an open investigation or a
          // funded row named, which is the same `hot` set the daily freshness window is granted to, and never the broad discovery agenda.
          const r = interp(await d.callProvider("serp_organic", { keyword: s.query, ...(hot.has(canonicalQueryKey(s.query)) ? { loadAiOverview: true } : {}) }, ids)); track(state, r);
          if (r.kind === "waiting") { s.status = "posted"; s.cacheKey = r.cacheKey; }
          else if (r.kind === "evidence") { const parsed = parseSerp(r.payload); if (parsed) applySerp(s, parsed, nowIso(), r.payload, tenantId); }
          else if (r.kind === "failed") {
            // daily_limit and blocked are the stops; quarantined = explicit unavailable coverage; the rest continue.
            if (r.disposition === "daily_limit") limitDetail = r.detail ?? null;
            else if (r.disposition === "blocked") blockedDetail = blockedNote(r);
            else if (r.disposition === "quarantined") { s.status = "failed"; s.observedAt = nowIso(); }
            else failedDetail = pauseDetail(r.disposition, r.detail ?? "A search did not run. I will retry it on the next pass.");
          }
          processed += 1;
        }
        if (!blockedDetail && !limitDetail && top5.has(s.query) && s.aiModeCacheKey == null && !s.aiModeFailed && s.status !== "failed") {
          const r = interp(await d.callProvider("serp_ai_mode", { keyword: s.query }, ids)); track(state, r);
          if (r.kind === "waiting") s.aiModeCacheKey = r.cacheKey;
          else if (r.kind === "evidence") { s.aiModeCacheKey = r.cacheKey; s.aiMode = refs(d.parse("serp_ai_mode", r.payload as never) as ParsedSerp | null); }
          else if (r.kind === "failed") {
            // As the collect twin, except repost_once and none spend the ONE AI Mode retry before the gap is named.
            if (r.disposition === "daily_limit") limitDetail = r.detail ?? null;
            else if (r.disposition === "blocked") blockedDetail = blockedNote(r);
            else if (r.disposition === "quarantined") s.aiModeFailed = true;
            else if (r.disposition === "repost_once" || r.disposition === "none") { if (s.aiModeReposted) s.aiModeFailed = true; else s.aiModeReposted = true; }
            else failedDetail = pauseDetail(r.disposition, "I could not start an AI Mode look this pass. I will try again on the next pass.");
          }
        }
      }

      // CARRY THE PAID RECEIPTS, NOT JUST THE AGENDA. A posted task's cacheKey lives ONLY on this row: rebuilding the list from the current agenda dropped any posted query that churned out of it, and the paid task sat pending in the cache with nothing ever able to collect it until the 30 day expiry recycled the money. A dropped row that is still `posted` rides along until it is collected, exactly as winning-pages carries unexpired read outcomes.
      const kept = new Set(serps.map((s) => s.query));
      const carried = state.serps.queries.filter((s) => !kept.has(s.query) && ((s.status === "posted" && s.cacheKey != null) || (s.status === "done" && !!s.observedAt && isCurrent("serp_hot", s.observedAt, d.now())))); // AND A PAID PAGE THAT IS STILL CURRENT (live 2026-09-02): a results page bought for one owed row was pruned by the next phase run because its agenda no longer named the query, so eight readings vanished before the replay could use them
      state.serps.queries = [...serps, ...carried].slice(0, SERP_ROWS_KEPT + carried.length); state.serps.analyzed = serps.filter((s) => s.status === "done").length;
      await save(d, tenantId, basis, state, ctx);
      if (blockedDetail) return { status: "failed", cursor, progress: serpProgress(state), detail: blockedDetail }; // a held refusal OUTRANKS the done arithmetic and every unavailable count
      if (limitDetail) return { status: "failed", cursor, progress: serpProgress(state), detail: limitDetail }; // today's ceiling: everything already collected is saved, the rest stays owed and costs nothing to resume
      // AI Mode truth is judged for the CURRENT top five ONLY: a dropped row can neither pause nor pollute this phase.
      const topRows = serps.filter((s) => top5.has(s.query)), aiModeMissing = topRows.filter((s) => s.aiModeFailed).length;
      const aiModeInFlight = topRows.some((s) => s.aiModeCacheKey && !s.aiMode && !s.aiModeFailed), unavailable = serps.filter((s) => s.status === "failed").length;
      const anyPending = serps.some((s) => s.status === "pending" || s.status === "posted") || aiModeInFlight;
      // A RESULTS PAGE FOR ANOTHER PHRASE IS NAMED WHICHEVER WAY THE ARITHMETIC LANDS, so it is never reported as an ordinary provider outage.
      const mismatched = serps.filter((s) => s.identityMismatch).length;
      if (mismatched > 0) failedDetail = `${mismatched} ${mismatched === 1 ? "search" : "searches"} came back for a different phrase than the one asked, so ${mismatched === 1 ? "it was" : "they were"} left out and will be checked again.`;
      // done = every CURRENT query freshly analyzed or explicitly unavailable, one real look minimum, no AI Mode live; unavailable is surfaced.
      let status: FunnelUnitOutcome["status"];
      if (state.serps.analyzed > 0 && state.serps.analyzed + unavailable >= chosen.length && !aiModeInFlight) { status = "done";
        // A NAMED MISMATCH OUTRANKS BOTH counts below: it already says what happened, and reporting it as a provider outage would be the wrong claim.
        if (mismatched === 0 && unavailable > 0) failedDetail = `${unavailable} searches were unavailable from the provider; the rest are in.`;
        else if (mismatched === 0 && aiModeMissing > 0) failedDetail = `${aiModeMissing} AI Mode looks were unavailable from the provider; the search results themselves are in.`; }
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
  // The freshest look THIS STATE holds, over both lanes. The snapshot takes the newer of this and the canonical answers it loads, so freshness is never dated by a working set that no longer carries the answers.
  const observedTimes = [...donePairs.map((p) => p.observedAt), ...state.serps.queries.map((s) => s.observedAt)]
    .filter((t): t is string => !!t).sort();
  const isStale = (at: string | undefined) => !isCurrent("serp_cold", at, now);
  // Receipt denominators are derived from the pairs themselves, so a persisted intendedPairs written by an older selector can never overstate missing.
  const stale = donePairs.filter((p) => isStale(p.observedAt)).length
    + state.serps.queries.filter((s) => s.status === "done" && isStale(s.observedAt)).length;
  const missing = Math.max(0, state.prompts.pairs.length - donePairs.length)
    + state.serps.queries.filter((s) => s.status !== "done" || !!s.identityMismatch).length + state.serps.queries.filter((s) => s.aiModeFailed).length;
  // FAIL CLOSED ON IDENTITY: a look the provider answered for a DIFFERENT phrase is missing coverage, never this search's evidence, so it is counted above and dropped here however its row happens to be marked.
  const doneSerps = state.serps.queries.filter((s) => s.status === "done" && !s.identityMismatch);
  return {
    // LINEAGE rides along: how each keyword was found, the confirmed theme it was found from, the case it joined, the page of my own that already ranks for it, and what acting on it would mean. Every one is a recorded fact, so nothing downstream has to guess them. THE WHOLE JOURNEY rides along too (`origins`), so a fan-out can be traced back to the question, the engine, the day and the stored answer that produced it; a row stored before it was kept projects without it rather than with an invented one.
    retainedKeywords: state.discovery.retained.map((k) => ({ query: k.keyword, searchVolume: k.searchVolume, competition: k.competition, competitionLevel: k.competitionLevel ?? competitionLevel(k.competition), difficulty: k.difficulty ?? null, intent: k.intent, discoveredVia: k.discoveredVia, seed: k.seed ?? null, ownedRankingUrl: k.ownedRankingUrl ?? null, ownedPosition: k.ownedPosition ?? null, parentCaseId: k.caseId ?? null, supports: k.supports ?? null, ...(k.origins ? { origins: k.origins } : {}), ...(k.moreOrigins ? { moreOrigins: k.moreOrigins } : {}) })),
    // Canonical AI evidence is filled by the loader, never the transient working window.
    aiObservations: [],
    // WHAT THE RESULTS PAGE SAYS TRAVELS WITH THE ADDRESSES IT SAYS IT AT. The row was paying for snippets, an answer box, a block list, an overview and PAA answers and projecting none of them, so the writer's packet could see WHERE rivals rank and never WHAT they claim. A LOOK TAKEN BEFORE THE OVERVIEW STATE WAS STAMPED IS UNKNOWN, NEVER ABSENT: it reads observed where it carries the overview and null otherwise.
    serpEvidence: doneSerps.map((s) => ({
      query: s.query, observedAt: s.observedAt ?? null, itemTypes: s.itemTypes ?? null, featured: s.featured ?? null, aiOverviewText: s.aiOverviewText ?? null, aiOverviewState: s.aiOverviewState ?? ((s.aiOverview?.length ?? 0) > 0 || s.aiOverviewText ? "observed" as const : null),
      organic: (s.organic ?? []).map((o) => ({ rank: o.rank, domain: o.domain, url: o.url, title: o.title ?? null, snippet: o.snippet ?? null })), related: s.related ?? [],
      aiOverview: (s.aiOverview ?? []).map((a) => ({ url: a.url, domain: a.domain, title: a.title ?? null })), aiMode: (s.aiMode ?? []).map((a) => ({ url: a.url, domain: a.domain, title: a.title ?? null })),
      paa: (s.paa ?? []).map((p) => ({ question: p.question, answeringDomain: p.answeringDomain, answer: p.answer ?? null })) })),
    winningPages: state.winningPages.map((w) => ({ url: w.url, domain: w.domain, engines: w.engines, examplePrompts: w.examplePrompts, appearances: w.appearances, extract: w.extract, readOutcome: w.readOutcome ?? null })),
    // Stored in the canonical shape, so this carries it through UNTRANSLATED: a reader matches on the topic AND the normalized ask, and never trusts that an answer in hand is the one it asked for.
    pageComparisons: state.pageComparisons, ownedReads: state.ownedReads ?? [], caseCompetitors: state.discovery.caseCompetitors ?? [],
    receipt: { researched: state.discovery.counts.raw, retained: state.discovery.counts.retained, stale, missing, cached: state.cycle.cacheHits, spentUsd: round(state.cycle.spentUsd), freshestObservationAt: observedTimes.at(-1) ?? null },
  };
}
