import "server-only";

import { after } from "next/server";

import { getTenant } from "@/domains/account";
import type { FunnelUnitOutcome } from "@/domains/evidence";
import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { NO_BASIS_DETAIL } from "@/domains/evidence/funnel/shared";
import { runFocus } from "./investigation-queries";
import { reportingDay } from "@/lib/reporting-day";
import { dueWork, isResearchPaused, type DueWork, type DuePhase } from "./due-work";
import { defaultSteps, type ResearchCycleSteps } from "./research-steps";
// The phase bodies live in research-steps; the contract between the two files is this type, so a
// caller that drives a run keeps importing the runner and gets the shape it must satisfy.
export type { ResearchCycleSteps } from "./research-steps";
import {
  advancePhase,
  claimRun,
  countContinuationHop,
  finishRun,
  newOwnerToken,
  nextPhase,
  phaseIdempotencyKey,
  renewLease,
  startExtraPass,
  type ResearchPhase,
  type ResearchRun,
  type ResearchRunError,
  type ResearchRunProgress,
} from "../research-run";

/** on-visit-refresh - the Research Run executor (Slice 4, 2026-07-24). THE canonical cycle and the ONLY orchestrator; the phase BODIES live in research-steps.ts and document themselves there. Two doors drive it:
 *  the global daily scheduler (scheduler.ts, one guarded POST per day for every account whose Pacific day still owes work) and any navigation, which recovers and resumes whatever the scheduler left unfinished.
 *  Daily research never depends on anybody opening the app; a visit is recovery, not the trigger. DURABLE: claim_research_run RESUMES the account's single unfinished run first, whatever date it started, and opens
 *  a fresh daily cycle only when none is open. A day is not a unit of work, so a completed pass no longer ends the day: another pass opens only when due-work reports something genuinely owed. THE DATABASE LEASE
 *  DECIDES WHO ADVANCES A RUN and nothing else does; a dispatch and a visit racing the same account cannot both proceed, because the second claim against a live lease returns null. TRUTH BOUNDARY: a phase
 *  advances ONLY when it truly succeeded or was a healthy no-op, and every failure pauses with a bounded last_error instead of reaching completion. THE BATCH IS NOT THE DAY: prompt_observations asks exactly what
 *  daily-observations planned (one canonical reading per question, per engine, per PACIFIC reporting day), reads the new answers back (derived work, bounded, $0 when nothing changed, never a pause), and then
 *  RE-READS the planner: unreadable pauses fail-closed, anything still owed keeps this same phase under a renewed lease, and only settled == intended advances. IDEMPOTENCY: each phase's attempt identity (phase,
 *  a deterministic attemptKey, the seed) is persisted through renew_research_lease BEFORE the side effect and handed to the executor, so a retry of the same run+phase reuses the PERSISTED key; advancing clears
 *  the cursor, which is why the run's frozen FOCUS rides on PROGRESS. CONFLICT: a unit reporting the structured `state_conflict` code persisted NOTHING, so its counters are DISCARDED (a stale zeroed receipt must
 *  never overwrite proven spend) and the SAME attempt is re-invoked ONCE under the same lease, key and cursor; its cached call identities keep that retry $0 and a second conflict pauses honestly. Nothing else
 *  retries. LEASE: renewed at DATABASE time before every bounded unit of work, never once per phase-worth of it, so a purchase is always the FIRST side effect after a real renewal (winning_pages splits exactly
 *  there, between persisting winners and buying the comparison; the read-back renews for the same reason). A false return from renewLease / advancePhase / finishRun means the lease was lost: abort immediately.
 *  WHAT THE LEASE IS NOT: a funnel unit's own optimistic row_version protects the research DOCUMENT and proves nothing about ownership, and no lease makes a purchase idempotent. That is the evidence cache: a
 *  durable receipt keyed on the normalized ask, written BEFORE the network call. */

/** ONE cycle's wall-clock budget, for both doors. 210s leaves enough of the 300-second function lifetime to finish the surface build; the scheduler spends its own total budget in units of this. */
export const RESEARCH_CYCLE_DEADLINE_MS = 210_000;
/** A day I cannot count is never a day I finished. */
const DAY_UNREADABLE = "I could not read where today's AI checks stand, so I stopped rather than call the day finished. I will pick this up on the next pass.";

/** The four Slice 6 evidence phases, each backed by one funnel unit executor. */
const FUNNEL_PHASES = new Set<ResearchPhase>(["keyword_discovery", "prompt_observations", "serp_analysis", "winning_pages"]);

/** WHAT EACH OWED UNIT ACTUALLY COSTS IN PHASES. Due-work decides WHETHER another pass runs; this is what turns its answer into WHAT that pass may do. Once a run
 *  opened, the executor traversed the complete cycle whatever the debt was, so recovery for one stored-answer reading re-ran keyword discovery, results pages,
 *  winner reads, a crawl and a publication: four live passes spent about 69 cents on research nobody had asked for. A recovery pass now runs the phases its own
 *  debt names and skips the rest in ONE advance. A fresh daily cycle carries no plan at all and still walks everything, in order. */
const PHASES_FOR: Record<DuePhase, readonly ResearchPhase[]> = {
  refresh_sources: ["refresh_sources", "gsc_backfill_chunk"],
  crawl_pages: ["crawl_pages"],
  daily_observations: ["prompt_observations"],
  // The reading of answers already bought rides the observation phase, and buys nothing: see the analyze-only branch below.
  analyze_answers: ["prompt_observations"],
  // A SETTLED READING IS SPENT BY HARVESTING IT AND DECIDING AGAIN, and by nothing else: keyword discovery reads
  // what those answers named, and the surface publishes what that changed. No results page, no winner read, no
  // crawl, no refresh, no measurement, and above all no second answer bought to read an answer already in hand.
  consume_analyses: ["keyword_discovery", "publish_surface"],
  plan_cases: ["keyword_discovery", "serp_analysis"],
  acquire_case_evidence: ["serp_analysis", "winning_pages"],
  decide_and_prepare: ["publish_surface"],
  verify_and_measure: ["publish_surface"],
  publish_surfaces: ["publish_surface"],
};

/** PURE. The phases one pass's plan allows, or null when it has none (a fresh daily cycle: everything, in order). */
function plannedPhases(progress: ResearchRunProgress | null): Set<ResearchPhase> | null {
  const units = progress?.plan?.units;
  if (!Array.isArray(units) || units.length === 0) return null;
  const out = new Set<ResearchPhase>();
  for (const u of units) for (const p of PHASES_FOR[u] ?? []) out.add(p);
  return out;
}

/** PURE. The next phase this plan actually allows, walking the SAME ordered cycle; `done` when none is left. */
function nextPlanned(phase: ResearchPhase, allowed: Set<ResearchPhase>): ResearchPhase {
  let next = phase;
  while (next !== "done" && !allowed.has(next)) next = nextPhase(next);
  return next;
}
type ResearchCycleOptions = { now?: () => Date; deadlineMs?: number; steps?: Partial<ResearchCycleSteps> };
/** One phase's outcome: the merged progress, plus an optional `pause` error when the phase reported a recoverable failure that is NOT a throw (a partial
 *  connector refresh). A thrown error is handled separately by the cycle loop, which records the error and pauses. */
type PhaseOutcome = { progress: ResearchRunProgress; pause?: ResearchRunError };

/** Run one phase's body, returning the merged progress (and any returned-failure pause). */
async function runPhase(phase: ResearchPhase, tenantId: string, now: Date, progress: ResearchRunProgress, attemptKey: string, steps: ResearchCycleSteps): Promise<PhaseOutcome> {
  if (phase === "refresh_sources") {
    const result = await steps.refreshSources(tenantId, now, attemptKey);
    // Union the freshly-synced provider identities with any that synced on an earlier attempt of this same cycle, so a provider that failed once and later
    // succeeded is counted EXACTLY once. Failed ones never.
    const refreshedProviders = [...new Set([...(progress.refreshedProviders ?? []), ...result.succeeded])];
    const next = { ...progress, refreshedProviders, sourcesRefreshed: refreshedProviders.length };
    if (result.failures.length > 0) {
      // Some connected sources failed to refresh: pause at refresh_sources with a bounded receipt. The succeeded ones kept their freshness stamps, so the
      // retry targets only the remaining stale/failed sources. Do NOT publish off a failed refresh.
      return { progress: next, pause: { phase: "refresh_sources", failures: result.failures, at: now.toISOString(),
        message: `${result.failures.length} of ${result.attempted} connected sources failed to refresh`.slice(0, 300) } };
    }
    return { progress: next };
  }
  if (phase === "gsc_backfill_chunk") {
    const result = await steps.backfillChunk(tenantId, now, attemptKey);
    return { progress: { ...progress, backfill: result.kind === "advanced" ? { ran: true, complete: result.complete, daysPulled: result.daysPulled } : { ran: false } } };
  }
  // publish_surface - evidence-conditioned, never day-gated, never every visit.
  const shouldPublish = (progress.sourcesRefreshed ?? 0) >= 1 || progress.backfill?.ran === true || (await steps.surfaceStale(tenantId, now.getTime()));
  // surfacePublished is true ONLY after publishSurface RESOLVES; a throw pauses here. When there is nothing to publish, advance with surfacePublished:false.
  if (shouldPublish) await steps.publishSurface(tenantId, attemptKey);
  return { progress: { ...progress, surfacePublished: shouldPublish } };
}

/** Read-or-create the attempt identity for a phase. An interrupted retry of the same run+phase reuses the PERSISTED attemptKey (proving it is the same
 *  unit of work); a fresh phase mints a deterministic key. The seed is the cycle key: the run+phase scope already makes the key unique per attempt, and
 *  it needs no extra I/O (the persisted backfill cursor date is not cheaply available here). */
function resolveAttemptKey(tenantId: string, runId: string, cycleKey: string, phase: ResearchPhase, cursor: Record<string, unknown> | null): string {
  if (cursor != null && cursor.phase === phase && typeof cursor.attemptKey === "string") return cursor.attemptKey;
  return phaseIdempotencyKey(tenantId, runId, phase, { seed: cycleKey });
}

/** WHAT THE RUN DURABLY BECAME, read off the state that actually landed and never off "the function returned". `completed` = the completion landed on the row.
 *  `paused` = a pause landed on it. `lost_lease` = another instance owns the row, so nothing here may write to it or hand anything back. `failed` = execution
 *  threw, or the state I meant to persist did not. The visit door may ignore this; the daily dispatch counts its receipt off exactly this, which is what stops
 *  a paused or lease-lost account being reported as a finished day. */
type DriveReceipt = "completed" | "paused" | "failed" | "lost_lease";

/** Execute the claimed run from its current_phase to done, or pause durably. The DATABASE lease we hold (via ownerToken) is renewed BEFORE every phase;
 *  if a renew / advance / finish reports our lease was lost, we abort immediately. */
async function driveRun(run: ResearchRun, ownerToken: string, nowFn: () => Date, deadline: number, steps: ResearchCycleSteps, work: DueWork): Promise<DriveReceipt> {
  const tenantId = run.tenant_id;
  /** A PAUSE IS ONLY A PAUSE ONCE IT LANDED: finishRun answers false when the lease was gone or no row matched, and a pause nobody recorded is a failure. */
  const pause = async (errorInfo: ResearchRunError | null = null): Promise<DriveReceipt> =>
    (await finishRun(tenantId, run.id, ownerToken, "paused", errorInfo)) ? "paused" : "failed";
  // PROGRESS IS PERSISTED, NOT ASSEMBLED PER RENDER. The run writes the numbers every surface then reads back from this row: today's checks, the plan's live
  // and waiting topics, the date a wait ends. They come from the ONE due-work read this pass already made, so no two requests can compute them differently.
  let progress: ResearchRunProgress = { ...(run.progress ?? {}), state: { ...(run.progress?.state ?? {}),
    checksDone: work.checks.done, checksTotal: work.checks.total, checksAnswers: work.checks.answers,
    checksUnavailable: work.checks.unavailable, checksUnsupported: work.checks.unsupported,
    casesActive: work.cases.active, casesParked: work.cases.parked, nextDueAt: work.nextDueAt, blocker: null } };
  let phase = run.current_phase;
  let cursor: Record<string, unknown> | null = run.phase_cursor ?? null;
  /** THE PASS RUNS WHAT IT WAS OPENED FOR. Null on the day's first genuine run, which walks the whole cycle. */
  const allowed = plannedPhases(run.progress ?? null);
  /** This pass owes a READING of answers already bought, and owes nobody a new one: the observation phase reads and buys nothing. */
  const planUnits = run.progress?.plan?.units ?? [];
  const readingOnly = planUnits.includes("analyze_answers") && !planUnits.includes("daily_observations");
  /** The phase whose attempt already spent its ONE state-conflict retry (never global). */
  let conflictRetried: ResearchPhase | null = null;

  /** How many observation WINDOWS one drive may chain. Seven cover 35 questions on four engines at twenty a pass; the rest is slack, and past it I pause rather than
   *  let a planner and an executor that disagree turn this into a hot loop on the database until the deadline kills it. MAX_CRAWL_ROUNDS is the same idea for the
   *  website: four fifteen-page batches is sixty pages a pass, inside the cycle deadline with room to spare, and the rest is owed to the next pass. */
  const MAX_DAY_WINDOWS = 12, MAX_CRAWL_ROUNDS = 4; let windows = 0, crawlRounds = 0;
  while (phase !== "done") {
    if (nowFn().getTime() >= deadline) return pause(); // out of time before this phase; leave durable progress and resume next visit
    // A DEAD DAY IS NEVER WORKED LATE, FROM ANY PHASE. Every phase's work is scoped to the RUN'S OWN reporting day, so a run that paused before midnight Pacific and
    // resumed after it would buy, crawl, publish and stamp for a day that is gone: a missed day is missed. This guard used to fire only on the observation phase, so a
    // run paused at keyword_discovery, serp_analysis, winning_pages, crawl_pages, gsc_backfill_chunk or publish_surface could pause its way across midnight over and
    // over and HOLD the one-open-run index against today's own cycle. It sits at the top of EVERY resumed drive now, in front of the lease renewal and therefore in
    // front of any paid or externally visible side effect in any phase; the pass closes with every piece of evidence it wrote intact and its remainder visibly short
    // forever, and closing is what frees TODAY's cycle to be claimed.
    if (run.cycle_key.slice(-10) !== reportingDay(nowFn().getTime())) {
      log.info("[research-run] this pass belongs to a day that has ended, so I closed it and start today fresh", { tenantId, day: run.cycle_key.slice(-10) });
      // THE DEAD RUN KEEPS ITS OWN NUMBERS. `progress` above carries the counters this pass's due-work read for the day that has ALREADY begun, so
      // closing with them stamped the new day's denominator onto yesterday's receipt: a day that reached 96 of 140 closed reading 3 of 140.
      await advancePhase(tenantId, run.id, ownerToken, { phase, progress: { ...progress, state: run.progress?.state ?? {} }, cursor: null });
      return (await finishRun(tenantId, run.id, ownerToken, "completed")) ? "completed" : "failed";
    }

    // A DEBT IS NOT A CYCLE. A phase this pass's plan never named is skipped in ONE advance rather than walked: no lease renewal, no basis read, no unit, no
    // provider, no cent. The skip happens in front of every side effect for exactly that reason, and a plan whose phases are all behind us simply reaches done.
    if (allowed != null && !allowed.has(phase)) {
      const next = nextPlanned(nextPhase(phase), allowed);
      log.debug("[research-run] this pass was not opened for that phase, so it skips it", { tenantId, phase, next });
      if (!await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: null })) return "lost_lease";
      phase = next; cursor = null; continue;
    }

    // Persist the phase attempt identity + renew the lease BEFORE the side effect. Funnel phases carry their durable unit cursor forward inside the attempt cursor.
    const attemptKey = resolveAttemptKey(tenantId, run.id, run.cycle_key, phase, cursor);
    const priorUnit = cursor?.phase === phase && cursor.unit != null ? (cursor.unit as Record<string, unknown>) : null;
    const attemptCursor: Record<string, unknown> = { phase, attemptKey, seed: run.cycle_key, ...(priorUnit ? { unit: priorUnit } : {}) };
    const held = await renewLease(tenantId, run.id, ownerToken, attemptCursor);
    if (!held) return "lost_lease"; // lease lost/expired → abort BEFORE any side effect
    cursor = attemptCursor;

    // A DEBT OF READING IS NOT A DEBT OF BUYING. A pass opened because answers already paid for have never been read closely reads THEM and asks no engine
    // anything: no plan, no observation unit, no re-read of the day's standing, and no basis to resolve first. It runs here under the lease just renewed,
    // because a reading spends money, and it is fail-soft like every other derived step.
    if (phase === "prompt_observations" && allowed != null && readingOnly) {
      const analysed = await steps.analyzeAnswers(tenantId, run.cycle_key.slice(-10)).catch(() => 0);
      if (analysed > 0) progress = { ...progress, funnel: { ...progress.funnel, answersAnalyzed: (progress.funnel?.answersAnalyzed ?? 0) + analysed } };
      const next = nextPlanned(nextPhase(phase), allowed);
      if (!await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: null })) return "lost_lease";
      phase = next; cursor = null; continue;
    }

    // Every funnel unit runs under the account's CURRENT basis; a change in website/profile/goal mints a new basis and strands prior derived state.
    // PUBLISHING NEEDS THAT BASIS TOO, because a run resumed straight at publish_surface would otherwise reach the staleness check and the release build with
    // a basis nobody could read. NO BASIS, NO WORK OF ANY KIND: a basis I cannot read PAUSES this same phase before reconciliation, before any focus, unit,
    // provider call, website fetch or surface write, so surfacePublished is never set and the release already saved stays visible. The retry re-resolves the
    // basis, reconciles, then freezes, and it re-runs no completed evidence phase to get there.
    const basis = FUNNEL_PHASES.has(phase) || phase === "publish_surface" ? (await steps.currentBasis(tenantId)) || null : "";
    if (basis === null) return pause({ phase, message: NO_BASIS_DETAIL, at: nowFn().toISOString() });

    if (FUNNEL_PHASES.has(phase)) {
      // FREEZE THE INVESTIGATION ONCE PER RUN, durably, BEFORE a cent is spent: the ordered topic, the exact search it owes, the date it may next be retried and
      // the basis it was chosen under, picked when this run first reaches the results-page phase and reused unchanged by winning-pages and the comparison,
      // through advancePhase on the SAME phase. Only a REAL focus is frozen: an open run can span days, so one transient empty read must not silence it for that
      // whole life. IDENTITY IS RECONCILED AND PERSISTED ON EVERY PHASE FIRST, not only when a plan is frozen, and A FAILURE PAUSES THIS SAME PHASE AND SPENDS
      // NOTHING. THE READING IS BOUNDED PER RUN, NOT PER UNIT ITERATION: a phase iterates many times, so the marker rides run PROGRESS (the extraSamples
      // pattern), persisted the moment an attempt is made, so a resumed run does not ask again; the plan this run froze rides along and is reviewed first.
      let asked = false;
      try { await steps.reconcileCases(tenantId, basis, { planKeys: (progress.focus?.topics ?? []).map((t) => t.topicKey).filter((k): k is string => !!k), maySynthesize: progress.synthesisAttempted !== true, mark: () => { asked = true; } }); }
      catch (error) { return pause({ phase, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), at: nowFn().toISOString() }); }
      if (asked) { progress = { ...progress, synthesisAttempted: true }; if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return "lost_lease"; }
      if (phase === "serp_analysis" && progress.focus == null) {
        const frozen = await steps.investigationFocus(tenantId, basis).catch(() => null);
        if (frozen && frozen.topics.length > 0) { progress = { ...progress, focus: frozen };
          if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return "lost_lease"; }
      }
      // One bounded evidence unit. advanced = keep iterating this phase, and the loop top RENEWS THE RUN LEASE before the next one (winning_pages splits
      // itself there so its comparison spends on a freshly renewed lease); waiting = durable provider work is pending (pause honestly, resume next visit; NOT
      // a failure and NOT completion); done = phase complete; failed = bounded pause.
      let unit: FunnelUnitOutcome;
      // The REAL run identity travels with the cursor: history rows carry this run's id, and the funnel's receipt resets per cycle instead of drifting.
      try { unit = await steps.funnelUnit(phase, tenantId, { ...(priorUnit ?? {}), basis, runId: run.id, cycle: run.cycle_key }, deadline - nowFn().getTime(), runFocus(progress)); }
      catch (error) { return pause({ phase, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), at: nowFn().toISOString() }); }
      // A state conflict persisted NOTHING, so the unit's counters are a stale snapshot (its per-run receipt read zero) and must never overwrite what this run
      // already proved: DISCARD them either way. Then retry the SAME phase attempt exactly once (same run, lease owner, attempt key and unit cursor), because the
      // re-invoked unit reloads canonical state and every cached call identity makes its provider work $0. A second conflict in a row pauses honestly. Narrowed
      // to failed: no coded non-failed outcome retries.
      const conflicted = unit.status === "failed" && unit.code === "state_conflict";
      if (!conflicted) progress = { ...progress, funnel: { ...progress.funnel, ...unit.progress } };
      else if (conflictRetried !== phase) { conflictRetried = phase;
        log.warn("[research-run] research notes moved underneath the writer; retrying this phase once", { tenantId, phase });
        continue; } // loop top renews the SAME lease with the SAME attempt cursor
      // READ BACK what the engines just said, on the SAME phase, right after the answers are safely stored, under a FRESHLY renewed lease because it spends
      // money. Bounded per pass, $0 when no answer changed, and fail-soft: the expensive part is already persisted, so an analysis I could not produce is absent.
      if (phase === "prompt_observations" && !conflicted) {
        if (!await renewLease(tenantId, run.id, ownerToken, attemptCursor)) return "lost_lease";
        const analysed = await steps.analyzeAnswers(tenantId, run.cycle_key.slice(-10)).catch(() => 0);
        if (analysed > 0) progress = { ...progress, funnel: { ...progress.funnel, answersAnalyzed: (progress.funnel?.answersAnalyzed ?? 0) + analysed } };
      }
      const unitCursor = unit.cursor ? { ...attemptCursor, unit: unit.cursor } : { phase, attemptKey, seed: run.cycle_key };
      if (unit.status !== "done") {
        // THE CASE THE SPENDING CEILING STOPPED, recorded per case so a case receipt can say "I did not buy this one because the ceiling was reached", and
        // scoped to the day it happened on. The marker rides run progress (an existing row, an existing column, no second store) and clears by day rollover,
        // because a ceiling reached yesterday explains nothing about today.
        const capped = typeof unit.cursor?.cappedCase === "string" ? unit.cursor.cappedCase : null;
        if (capped) { const capDay = run.cycle_key.slice(-10), held = progress.capped?.day === capDay ? progress.capped.caseIds : [];
          progress = { ...progress, capped: { day: capDay, caseIds: [...new Set([...held, capped])].slice(0, 20) } }; }
        if (unit.status === "failed") progress = { ...progress, state: { ...progress.state, blocker: (unit.detail ?? "").slice(0, 300) || null } };
        // EVERY non-done outcome persists the SAME phase with its durable unit cursor FIRST, so nothing the unit achieved is stranded and a lost lease aborts
        // here with no pause written. Then: advanced loops for the next unit (the loop top renews the lease first), waiting pauses with no error at all (a
        // durable provider wait is not a failure), failed pauses with the unit's own bounded reason.
        if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: unitCursor })) return "lost_lease";
        if (unit.status === "advanced") { cursor = unitCursor; continue; }
        return pause(unit.status === "waiting" ? null : { phase, message: (unit.detail ?? "evidence step could not finish").slice(0, 300), at: nowFn().toISOString() });
      }
      // THE BATCH IS NOT THE DAY. The unit answers for the window it was handed; the DAY is what the operator was promised, so a settled window RE-READS the
      // canonical planner before this phase may move on. Unreadable pauses fail-closed, anything still owed keeps this same phase under a renewed lease, and
      // only settled == intended advances, carrying the whole day's breakdown so completion reports the day and never the last batch.
      if (phase === "prompt_observations") {
        const day = await steps.dayStanding(tenantId, run.cycle_key.slice(-10)).catch(() => null);
        if (day == null) return pause({ phase, message: DAY_UNREADABLE, at: nowFn().toISOString() });
        progress = { ...progress, state: { ...progress.state, checksDone: day.done, checksTotal: day.total,
          checksAnswers: day.answers, checksUnavailable: day.unavailable, checksUnsupported: day.unsupported } };
        if (day.done < day.total) {
          // The ceiling is the number of rounds, so the round that REACHES it is the last: `>` let a thirteenth window through.
          if ((windows += 1) >= MAX_DAY_WINDOWS) return pause({ phase, at: nowFn().toISOString(),
            message: `I ran ${MAX_DAY_WINDOWS} rounds of checks on this pass and ${day.total - day.done} of today's ${day.total} AI checks are still owed. I will pick the rest up on the next pass.` });
          if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: unitCursor })) return "lost_lease";
          cursor = unitCursor; continue; }
      }
      const nextAfterFunnel = nextPhase(phase); // done, and the day agrees: on to the next phase
      if (!await advancePhase(tenantId, run.id, ownerToken, { phase: nextAfterFunnel, progress, cursor: null })) return "lost_lease";
      phase = nextAfterFunnel; cursor = null;
      continue;
    }

    // THE WEBSITE, READ UNTIL THERE IS NOTHING LEFT TO READ. One bounded batch per pass meant an account holding two hundred pages nobody had opened waited most of a
    // year for its own inventory, which is not the product. The phase REPEATS its batch now, each round under a lease renewed at the loop top (a crawl is a real fetch,
    // so it never runs on an unrenewed lease), until a batch reads nothing at all, the round cap stops it, or the pass runs out of time. A batch that reads nothing is
    // the honest terminal answer (every page crawled, blocked with a retry date, unsupported, gone, or deferred by a bound on file) and the durable inventory keeps the
    // whole score, so nothing here remembers anything between passes.
    if (phase === "crawl_pages") {
      let read = 0;
      try { read = await steps.crawlPages(tenantId, nowFn()); }
      catch (error) { return pause({ phase, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), at: nowFn().toISOString() }); }
      if (read > 0) log.info("[research-run] read more of your website", { tenantId, pages: read });
      const again = read > 0 && (crawlRounds += 1) < MAX_CRAWL_ROUNDS, next = again ? phase : nextPhase(phase);
      if (!await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: again ? attemptCursor : null })) return "lost_lease";
      phase = next; cursor = again ? attemptCursor : null; continue;
    }

    // VERIFY BEFORE ANYTHING IS PUBLISHED OFF IT (verify_and_measure). A change the operator marked as done is a claim until I have read their page, and Results
    // answers "did Beacon verify it on the live website" off exactly this. It runs here, in front of the surface build, under the lease this loop just renewed:
    // bounded to three pages, free (owned reads on the polite-fetch path, never a provider), and fail-soft, because a page I could not read must not pause a pass.
    if (phase === "publish_surface" && work.due.includes("verify_and_measure")) {
      const verified = await steps.verifyShipments(tenantId, nowFn()).catch(() => 0);
      if (verified > 0) log.info("[research-run] checked what you marked as done on your live pages", { tenantId, verified });
      // AND THEN THE READING ITSELF. Verifying was only ever the first half: measuring is what turns a verified change into a won or lost verdict, and it fired
      // ONLY from a Results render, so an account holding sixteen changes whose windows had closed could never settle one of them without somebody opening the
      // page. It runs here, under the same renewed lease, right after the verification it depends on: free (Search Console and Analytics are already synced),
      // bounded per pass, fail-soft, and it rebuilds the Results surface itself when a reading actually moved, so the first view serves the fresh truth.
      const measured = await steps.measureShipments(tenantId, nowFn()).catch(() => 0);
      if (measured > 0) log.info("[research-run] read how what you shipped is doing", { tenantId, measured });
    }

    let outcome: PhaseOutcome;
    try {
      outcome = await runPhase(phase, tenantId, nowFn(), progress, attemptKey, steps);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      log.warn("[research-run] phase threw; pausing (recoverable)", { tenantId, phase, error: message });
      return pause({ phase, message, at: nowFn().toISOString() });
    }
    if (outcome.pause) {
      log.warn("[research-run] phase reported failures; pausing (recoverable)", {
        tenantId,
        phase,
        failures: outcome.pause.failures?.length ?? 0,
      });
      // Persist the partial success (the providers that DID sync) durably BEFORE pausing, at the SAME phase with the SAME attempt cursor, so a mixed attempt
      // never strands its succeeded sources. If our lease was lost, abort with no finish call.
      const saved = await advancePhase(tenantId, run.id, ownerToken, {
        phase,
        progress: { ...outcome.progress, state: { ...outcome.progress.state, blocker: outcome.pause.message } },
        cursor: attemptCursor,
      });
      if (!saved) return "lost_lease";
      return pause(outcome.pause);
    }
    progress = outcome.progress;
    // THE DECIDE WATERMARK. A pass that reached the end of the decision step stamps the basis and the research-notes version it consumed, published or not:
    // in both cases it looked and concluded. Notes that move PAST this are new evidence, which is what makes another pass the same day worth its money
    // instead of a repeat. It is read here, after this pass's own writes, so a pass never counts its own discovery as somebody else's news and re-opens
    // itself forever.
    if (phase === "publish_surface" && basis) {
      const version = await steps.evidenceVersion(tenantId, basis).catch(() => null);
      if (version != null) progress = { ...progress, decided: { basis, rowVersion: version } };
    }

    const next = nextPhase(phase); // advancing replaces the cursor (clears the completed phase's attempt identity)
    if (!await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: null })) return "lost_lease"; // our lease was recovered by another instance
    phase = next; cursor = null;
  }

  // Reached only when every phase succeeded or was a healthy no-op, and COMPLETED is what the finish landed, never what this loop believes it did.
  return (await finishRun(tenantId, run.id, ownerToken, "completed")) ? "completed" : "failed";
}

/** DRIVE A RUN THIS CALLER ALREADY HOLDS THE LEASE ON. The one entry both doors go through: the daily scheduler hands it a run claimed by claim_due_research_work, a visit hands it the run claimed
 *  here. It never claims and never re-leases, so there is exactly one orchestrator and no second copy of it. NOTHING DUE, NOTHING SPENT. A pass that opened with a readable and empty due list closes
 *  right here at $0 rather than walking seven phases to discover the same thing. Only a pass at its very first phase may close this way: a RESUMED run carries work of its own (a half-finished
 *  backfill, a unit cursor) that due-work does not speak for. IT RETURNS WHAT IT DURABLY LEFT BEHIND. Returning normally used to be the only answer it gave, so a pause, a provider wait and a lost
 *  lease were indistinguishable from a finished day and the daily dispatch counted every one of them as a success. The visit door may still ignore the receipt; the dispatch must not. */
export async function driveClaimed(run: ResearchRun, ownerToken: string, work: DueWork | null, nowFn: () => Date, deadline: number, steps: ResearchCycleSteps): Promise<DriveReceipt> {
  const tenantId = run.tenant_id;
  const fresh = run.current_phase === "refresh_sources" && run.phase_cursor == null;
  if (fresh && work != null && work.readable && work.due.length === 0) {
    log.info("[research-run] nothing is due; closing the pass at zero cost", { tenantId, nextDueAt: work.nextDueAt });
    // The numbers go down BEFORE the close, on the same row, so a finished-with-nothing-owed pass can still tell the operator what it checked and the date the
    // waiting ends. A pass that closes silently looks identical to one that never ran.
    await advancePhase(tenantId, run.id, ownerToken, { phase: run.current_phase, cursor: null, progress: { ...(run.progress ?? {}),
      state: { ...(run.progress?.state ?? {}), checksDone: work.checks.done, checksTotal: work.checks.total,
        checksAnswers: work.checks.answers, checksUnavailable: work.checks.unavailable, checksUnsupported: work.checks.unsupported,
        casesActive: work.cases.active, casesParked: work.cases.parked, nextDueAt: work.nextDueAt, blocker: null } } });
    return (await finishRun(tenantId, run.id, ownerToken, "completed")) ? "completed" : "failed";
  }
  return driveRun(run, ownerToken, nowFn, deadline, steps,
    work ?? { due: [], readable: false, checks: { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 }, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null });
}

/** How many EXTRA same-day passes THE VISIT DOOR may open for one account. A visit is a chance, not a debt: every navigation is another opportunity to open one, so this door keeps the eight it was
 *  sized for. The daily dispatch carries its own allowance (it claims first, and opens a recovery pass only for a day left short), and the day's absolute runaway stop inside research-run still bounds
 *  every door together. */
const VISIT_EXTRA_PASSES_PER_DAY = 8;
/** /** THE VISIT DOOR: claim, resume, or start the account's Research Run and drive it. A DAY IS NOT A UNIT OF WORK: a refused claim asks the one free question that matters (due-work, from persisted
 *  state alone) and opens another pass only when something is genuinely due. FAIL CLOSED both ways: an unreadable state opens nothing, an empty one opens nothing at $0, and a pass that opens with
 *  nothing due closes immediately. */
export async function runResearchCycle(tenantId: string, options: ResearchCycleOptions = {}): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? RESEARCH_CYCLE_DEADLINE_MS;
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const deadline = nowFn().getTime() + deadlineMs;

  // Slice 5 pre-activation gate: no research work runs before an account is active, and none runs for an account whose operator paused research. FAIL CLOSED: a
  // missing/unknown account, or any read error, is a no-op (logged), never a claim. claim_research_run carries NEITHER guard (the fleet enumeration does), so
  // this is the whole gate on the visit door.
  const account = await getTenant(tenantId).catch(() => null);
  if (!account || account.status !== "active") {
    log.debug("[research-run] skipped: account not active (no research before activation)", { tenantId, status: account?.status ?? "unknown" });
    return; }
  if (await isResearchPaused(tenantId)) { log.debug("[research-run] skipped: research is paused for this account", { tenantId }); return; }

  await runWithTenant(tenantId, async () => {
    const ownerToken = newOwnerToken();
    const now = nowFn();
    // A claim that FAILED (the database could not answer) is not a claim that was refused: it ends the visit here, with no pass and no due-work question.
    let run = await claimRun(tenantId, ownerToken).catch(() => "unavailable" as const);
    if (run === "unavailable") return;
    const work = await steps.dueWork(tenantId, now).catch(() => null);
    if (run == null) {
      // Refused: either another instance holds the open run, or a pass already completed today. Only a POSITIVE due signal opens a second pass, and the
      // one-open-run index still refuses it while any run is unfinished, so the "held elsewhere" case cannot slip through this door.
      if (work == null || !work.readable || work.due.length === 0) {
        log.debug("[research-run] no claim and nothing due; nothing runs", { tenantId, due: work?.due.length ?? null });
        return; }
      // The pass is opened ON that due list, so it carries it: this door already knows exactly why it opened one.
      run = await startExtraPass(tenantId, ownerToken, reportingDay(now.getTime()), VISIT_EXTRA_PASSES_PER_DAY, work.due);
      if (run == null) return;
      log.info("[research-run] same-day pass opened on genuinely due work", { tenantId, due: work.due });
    }
    await driveClaimed(run, ownerToken, work, nowFn, deadline, steps);
  });
}

/** How many continuations ONE account may chain in ONE reporting day. BROWSER RECOVERY MACHINERY ONLY: a hop exists so an open tab can finish work the
 * scheduler left, and the daily scheduler never uses one. The bound is the whole safety story: each hop is its own request with its own lease claim, so a
 * closed tab simply stops, and this stops a live one from looping forever on a due list it can never clear. */
const MAX_CONTINUATIONS = 6;

/** ONE bounded continuation hop, and an honest answer about whether another is owed. The trigger stays what it was: next/after on render, one hop, no unawaited promise living past the response. What
 *  is new is that a hop reports back, so the surface that asked for it can ask again while work remains. Each hop is a SEPARATE request that claims the lease for itself, which is why a closed tab
 *  stops safely, a reopened one resumes exactly where the row says, and two tabs cannot both advance a run. THE HOP IS NOT THE CLIENT'S TO COUNT. It arrives from the browser, so a caller that kept
 *  sending 0 got a fresh allowance every time and the bound bounded nothing. The count is kept on the account's own row, scoped to the reporting day, inherited by every pass that opens that day, and
 *  the ceiling is enforced against THAT number; the client's claim is a fallback for the one case where nothing can be counted yet. */
export async function continueResearch(tenantId: string, hop = 0, options: ResearchCycleOptions = {}): Promise<{ hop: number; more: boolean }> {
  const claimed = Math.max(0, Math.trunc(hop));
  if (!tenantId) return { hop: claimed, more: false };
  const nowFn = options.now ?? (() => new Date());
  const counted = await countContinuationHop(tenantId, reportingDay(nowFn().getTime()));
  const next = counted ?? claimed + 1;
  if (next > MAX_CONTINUATIONS) {
    log.debug("[research-run] today's continuation bound is spent; this hop runs nothing", { tenantId, hop: next });
    return { hop: next, more: false };
  }
  await runResearchCycle(tenantId, options).catch((error) => {
    log.warn("[research-run] continuation hop failed (non-blocking)", { tenantId, hop: next, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
  });
  const work = await (options.steps?.dueWork ?? dueWork)(tenantId, nowFn()).catch(() => null);
  return { hop: next, more: next < MAX_CONTINUATIONS && !!work?.readable && work.due.length > 0 };
}

/** Schedule one post-response Research Run from the app shell. Every navigation may call this; the DATABASE lease (not any in-memory guard) prevents two
 *  instances from both advancing the cycle. after() is only valid in a request scope, so tests and scripts get a safe no-op. */
export function ensureResearchRunOnVisit(tenantId: string): void {
  if (!tenantId) return;
  try {
    after(async () => {
      try {
        await runResearchCycle(tenantId);
      } catch (error) {
        log.warn("[research-run] cycle failed (non-blocking)", { tenantId, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      }
    });
  } catch {
    // after() outside a request scope - no-op.
  }
}
