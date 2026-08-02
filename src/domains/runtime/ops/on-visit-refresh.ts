import "server-only";

import { after } from "next/server";

import { getTenant } from "@/domains/account";
import type { FunnelUnitOutcome } from "@/domains/evidence";
import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { NO_BASIS_DETAIL } from "@/domains/evidence/funnel/shared";
import { runFocus } from "./investigation-queries";
import { reportingDay } from "@/lib/reporting-day";
import { dueWork, isResearchPaused, type DueWork } from "./due-work";
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

/** on-visit-refresh - the Research Run executor (Slice 4, 2026-07-24). THE canonical cycle, driven by two doors: the global daily scheduler
 *  (src/domains/runtime/ops/scheduler.ts, one guarded POST per day for every account whose Pacific day still owes work) and any navigation, which recovers
 *  and resumes whatever the scheduler left unfinished. Daily research does not depend on anybody opening the app; a visit is recovery, not the trigger. The
 *  run is durable: claim_research_run RESUMES the account's single unfinished run first (regardless of its start date, so yesterday's paused run is never
 *  abandoned and no second open run is created), and starts a fresh daily cycle only when no run is open. A pass that already completed today no longer ENDS
 *  the day (Phase 5): the refusal is now a question, and another pass opens only when due-work reports something genuinely owed that the completed pass could
 *  not have done. THE DATABASE LEASE DECIDES WHO ADVANCES A RUN and nothing else does: a scheduler dispatch and a visit racing the same account cannot both
 *  proceed, because the second claim (a different owner token against a live lease) returns null. TRUTH BOUNDARY (Slice 4 truth-and-lease repair): a phase
 *  advances ONLY when it truly succeeded or was a healthy no-op. Every failure pauses the cycle with a bounded last_error and never reaches completion.
 *  refresh_sources - refresh stale connectors; sourcesRefreshed counts ONLY the sources that actually synced. ANY per-source failure pauses here (the
 *  succeeded ones keep their freshness stamps, so a retry targets only the rest). Zero stale sources is a healthy no-op that advances. A THROW (refresh
 *  could not run) pauses too. gsc_backfill_chunk - advance one bounded GSC deep-backfill chunk, to the bound deep-backfill.ts sizes for a serverless window
 *  rather than racing a deadline the GSC fetch cannot honour (no AbortSignal). An advance or a benign skip advances; a real error THROWS and pauses with the
 *  cursor untouched, so the retry is that same window. The four evidence phases - identity is reconciled and PERSISTED first (a throw pauses before any
 *  focus, unit or cent), then one bounded funnel unit resumes from its own durable cursor. prompt_observations asks exactly what daily-observations planned
 *  (one canonical reading per question, per engine, per PACIFIC reporting day) and then reads the new answers back; that read-back is DERIVED work on
 *  evidence already stored, so it is bounded, $0 when nothing changed, and never pauses the run. publish_surface - rebuild + publish the Today/Changes
 *  release when a source refreshed, a chunk advanced, or the saved release is genuinely stale (evidence-conditioned, never day-gated). surfacePublished is
 *  true ONLY after publishSurface RESOLVES; a THROW pauses here and the previously saved surface stays visible. IDEMPOTENCY: before each phase's side effect
 *  we persist the phase attempt identity (phase, a deterministic attemptKey, the seed) via renew_research_lease, which also renews the lease, and hand the
 *  executor that attemptKey. A retry of the same run+phase reuses the PERSISTED key; advancing clears the cursor, so the next phase mints its own, which is
 *  why the run's frozen FOCUS rides on PROGRESS. CONFLICT: an evidence unit reporting the structured `state_conflict` code persisted NOTHING, so its
 *  counters are DISCARDED (a stale zeroed receipt must never overwrite proven spend) and the SAME phase attempt is re-invoked ONCE under the same lease,
 *  attempt key and unit cursor; the unit reloads canonical state and its cached call identities keep the retry $0. A second conflict in a row pauses
 *  honestly. Nothing else retries: blocked, waiting, capped and lost-lease behaviour are untouched. LEASE: renewed at DATABASE time BEFORE every bounded
 *  unit of work, not once per phase-worth of work, so a purchase is always the FIRST side effect after a real renewal (winning_pages splits exactly there,
 *  between persisting winners and buying the comparison; the answer read-back renews before its own first call for the same reason). A funnel unit's own
 *  optimistic row_version protects the research DOCUMENT from a concurrent writer; it is NOT this lease and proves nothing about lease ownership. A false
 *  return from renewLease / advancePhase / finishRun means the lease was lost: abort immediately, no further side effects. WHAT THE LEASE IS AND IS NOT: it
 *  bounds WHICH invocation may proceed. It does not make a purchase idempotent, and it is not what stops the same comparison being bought twice when a save
 *  fails after the money moved. That is the evidence cache: a durable receipt keyed on the normalized ask, written BEFORE the network call. */

/** ONE cycle's wall-clock budget, for both doors. 210s leaves enough of the 300-second function lifetime to
 *  finish the surface build; the scheduler spends its own total budget in units of this. */
export const RESEARCH_CYCLE_DEADLINE_MS = 210_000;

/** The four Slice 6 evidence phases, each backed by one funnel unit executor. */ const FUNNEL_PHASES = new Set<ResearchPhase>(["keyword_discovery", "prompt_observations", "serp_analysis", "winning_pages"]);

type ResearchCycleOptions = { now?: () => Date; deadlineMs?: number; steps?: Partial<ResearchCycleSteps> };

/** One phase's outcome: the merged progress, plus an optional `pause` error when the phase reported a recoverable failure that is NOT a throw (a partial
 *  connector refresh). A thrown error is handled separately by the cycle loop, which records the error and pauses. */
type PhaseOutcome = { progress: ResearchRunProgress; pause?: ResearchRunError };

/** Run one phase's body, returning the merged progress (and any returned-failure pause). */
async function runPhase(
  phase: ResearchPhase, tenantId: string, now: Date, progress: ResearchRunProgress, attemptKey: string, steps: ResearchCycleSteps,
): Promise<PhaseOutcome> {
  if (phase === "refresh_sources") {
    const result = await steps.refreshSources(tenantId, now, attemptKey);
    // Union the freshly-synced provider identities with any that synced on an earlier attempt of this same cycle, so a provider that failed once and later
    // succeeded is counted EXACTLY once. Failed ones never.
    const refreshedProviders = [...new Set([...(progress.refreshedProviders ?? []), ...result.succeeded])];
    const next = { ...progress, refreshedProviders, sourcesRefreshed: refreshedProviders.length };
    if (result.failures.length > 0) {
      // Some connected sources failed to refresh: pause at refresh_sources with a bounded receipt. The succeeded ones kept their freshness stamps, so the
      // retry targets only the remaining stale/failed sources. Do NOT publish off a failed refresh.
      return {
        progress: next,
        pause: {
          phase: "refresh_sources",
          message: `${result.failures.length} of ${result.attempted} connected sources failed to refresh`.slice(0, 300),
          at: now.toISOString(),
          failures: result.failures,
        },
      };
    }
    return { progress: next };
  }
  if (phase === "gsc_backfill_chunk") {
    const result = await steps.backfillChunk(tenantId, now, attemptKey);
    const backfill =
      result.kind === "advanced"
        ? { ran: true, complete: result.complete, daysPulled: result.daysPulled }
        : { ran: false };
    return { progress: { ...progress, backfill } };
  }
  // publish_surface - evidence-conditioned, never day-gated, never every visit.
  const shouldPublish =
    (progress.sourcesRefreshed ?? 0) >= 1 ||
    progress.backfill?.ran === true ||
    (await steps.surfaceStale(tenantId, now.getTime()));
  // surfacePublished is true ONLY after publishSurface RESOLVES; a throw pauses here. When there is nothing to publish, advance with surfacePublished:false.
  if (shouldPublish) await steps.publishSurface(tenantId, attemptKey);
  return { progress: { ...progress, surfacePublished: shouldPublish } };
}

/** Read-or-create the attempt identity for a phase. An interrupted retry of the same run+phase reuses the PERSISTED attemptKey (proving it is the same
 *  unit of work); a fresh phase mints a deterministic key. The seed is the cycle key: the run+phase scope already makes the key unique per attempt, and
 *  it needs no extra I/O (the persisted backfill cursor date is not cheaply available here). */
function resolveAttemptKey(
  tenantId: string,
  runId: string,
  cycleKey: string,
  phase: ResearchPhase,
  cursor: Record<string, unknown> | null,
): string {
  if (cursor != null && cursor.phase === phase && typeof cursor.attemptKey === "string") return cursor.attemptKey;
  return phaseIdempotencyKey(tenantId, runId, phase, { seed: cycleKey });
}

/** Execute the claimed run from its current_phase to done, or pause durably. The DATABASE lease we hold (via ownerToken) is renewed BEFORE every phase;
 *  if a renew / advance / finish reports our lease was lost, we abort immediately. */
async function driveRun(
  run: ResearchRun, ownerToken: string, nowFn: () => Date, deadline: number, steps: ResearchCycleSteps, work: DueWork,
): Promise<void> {
  const tenantId = run.tenant_id;
  // PROGRESS IS PERSISTED, NOT ASSEMBLED PER RENDER. The run writes the numbers every surface then reads back
  // from this row: today's checks, the plan's live and waiting topics, the date a wait ends. They come from
  // the ONE due-work read this pass already made, so no two requests can compute them differently.
  let progress: ResearchRunProgress = {
    ...(run.progress ?? {}),
    state: {
      ...(run.progress?.state ?? {}),
      checksDone: work.checks.done, checksTotal: work.checks.total, checksAnswers: work.checks.answers,
      checksUnavailable: work.checks.unavailable, checksUnsupported: work.checks.unsupported,
      casesActive: work.cases.active, casesParked: work.cases.parked,
      nextDueAt: work.nextDueAt, blocker: null,
    },
  };
  let phase = run.current_phase;
  let cursor: Record<string, unknown> | null = run.phase_cursor ?? null;
  /** The phase whose attempt already spent its ONE state-conflict retry (never global). */
  let conflictRetried: ResearchPhase | null = null;

  while (phase !== "done") {
    if (nowFn().getTime() >= deadline) {
      // Out of time before this phase; leave durable progress and resume next visit.
      await finishRun(tenantId, run.id, ownerToken, "paused");
      return;
    }

    // Persist the phase attempt identity + renew the lease BEFORE the side effect. Funnel phases carry their durable unit cursor forward inside the attempt
    // cursor.
    const attemptKey = resolveAttemptKey(tenantId, run.id, run.cycle_key, phase, cursor);
    const priorUnit = cursor?.phase === phase && cursor.unit != null ? (cursor.unit as Record<string, unknown>) : null;
    const attemptCursor: Record<string, unknown> = { phase, attemptKey, seed: run.cycle_key, ...(priorUnit ? { unit: priorUnit } : {}) };
    const held = await renewLease(tenantId, run.id, ownerToken, attemptCursor);
    if (!held) return; // lease lost/expired → abort BEFORE any side effect
    cursor = attemptCursor;

    // Every funnel unit runs under the account's CURRENT basis; a change in website/profile/goal mints a new basis and strands prior derived state.
    // PUBLISHING NEEDS THAT BASIS TOO, because a run resumed straight at publish_surface would otherwise reach the staleness check and the release build with
    // a basis nobody could read. NO BASIS, NO WORK OF ANY KIND: a basis I cannot read PAUSES this same phase before reconciliation, before any focus, unit,
    // provider call, website fetch or surface write, so surfacePublished is never set and the release already saved stays visible. The retry re-resolves the
    // basis, reconciles, then freezes, and it re-runs no completed evidence phase to get there.
    const basis = FUNNEL_PHASES.has(phase) || phase === "publish_surface" ? (await steps.currentBasis(tenantId)) || null : "";
    if (basis === null) { await finishRun(tenantId, run.id, ownerToken, "paused", { phase, message: NO_BASIS_DETAIL, at: nowFn().toISOString() }); return; }

    if (FUNNEL_PHASES.has(phase)) {
      // FREEZE THE INVESTIGATION ONCE PER RUN, durably, BEFORE a cent is spent: the ordered topic, the exact search it owes, the date it may next be retried
      // and the basis it was chosen under, picked when this run first reaches the results-page phase and reused unchanged by winning-pages and the
      // comparison, through advancePhase on the SAME phase. Only a REAL focus is frozen: an open run can span days, so one transient empty read must not
      // silence it for that whole life. IDENTITY IS RECONCILED AND PERSISTED ON EVERY PHASE FIRST, not only when a plan is frozen, and A FAILURE PAUSES THIS
      // SAME PHASE AND SPENDS NOTHING. THE READING IS BOUNDED PER RUN, NOT PER UNIT ITERATION: reconciliation runs before every funnel unit and a phase
      // iterates many times, so the marker rides run PROGRESS (the extraSamples pattern), persisted the moment an attempt is made, so a resumed run does not
      // ask again either; the plan this run froze rides along, and those cases are reviewed before any other.
      let asked = false;
      try { await steps.reconcileCases(tenantId, basis, { planKeys: (progress.focus?.topics ?? []).map((t) => t.topicKey).filter((k): k is string => !!k), maySynthesize: progress.synthesisAttempted !== true, mark: () => { asked = true; } }); }
      catch (error) { await finishRun(tenantId, run.id, ownerToken, "paused", { phase, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), at: nowFn().toISOString() }); return; }
      if (asked) { progress = { ...progress, synthesisAttempted: true }; if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return; }
      if (phase === "serp_analysis" && progress.focus == null) {
        const frozen = await steps.investigationFocus(tenantId, basis).catch(() => null);
        if (frozen && frozen.topics.length > 0) { progress = { ...progress, focus: frozen };
          if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return; }
      }
      // One bounded evidence unit. advanced = keep iterating this phase, and the loop top RENEWS THE RUN LEASE before the next one (winning_pages splits
      // itself there so its comparison spends on a freshly renewed lease); waiting = durable provider work is pending (pause honestly, resume next visit; NOT
      // a failure and NOT completion); done = phase complete; failed = bounded pause.
      let unit: FunnelUnitOutcome;
      try {
        // The REAL run identity travels with the cursor: history rows carry this run's id, and the funnel's receipt resets per cycle instead of drifting.
        unit = await steps.funnelUnit(phase, tenantId, { ...(priorUnit ?? {}), basis, runId: run.id, cycle: run.cycle_key },
          deadline - nowFn().getTime(), runFocus(progress));
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        await finishRun(tenantId, run.id, ownerToken, "paused", { phase, message, at: nowFn().toISOString() });
        return;
      }
      // A state conflict persisted NOTHING, so the unit's counters are a stale snapshot (its per-run receipt read zero) and must never overwrite what this
      // run already proved: DISCARD them either way. Then retry the SAME phase attempt exactly once (same run, lease owner, attempt key and unit cursor),
      // because the re-invoked unit reloads canonical state and every cached call identity makes its provider work $0. A second conflict in a row pauses
      // honestly. Narrowed to failed: no coded non-failed outcome retries.
      const conflicted = unit.status === "failed" && unit.code === "state_conflict";
      if (!conflicted) progress = { ...progress, funnel: { ...progress.funnel, ...unit.progress } };
      else if (conflictRetried !== phase) {
        conflictRetried = phase;
        log.warn("[research-run] research notes moved underneath the writer; retrying this phase once", { tenantId, phase });
        continue; } // loop top renews the SAME lease with the SAME attempt cursor
      // READ BACK what the engines just said. It runs on the SAME phase, right after the answers are safely stored, under a FRESHLY renewed lease because it
      // spends money. Bounded to a handful per pass, $0 when no answer changed, and fail-soft: the expensive part is already persisted, so an analysis I
      // could not produce is simply absent and never turns a good observation pass into a pause.
      if (phase === "prompt_observations" && !conflicted) {
        if (!await renewLease(tenantId, run.id, ownerToken, attemptCursor)) return;
        const analysed = await steps.analyzeAnswers(tenantId, run.cycle_key.slice(-10)).catch(() => 0);
        if (analysed > 0) progress = { ...progress, funnel: { ...progress.funnel, answersAnalyzed: (progress.funnel?.answersAnalyzed ?? 0) + analysed } };
      }
      const unitCursor = unit.cursor ? { ...attemptCursor, unit: unit.cursor } : { phase, attemptKey, seed: run.cycle_key };
      if (unit.status !== "done") {
        // THE CASE THE SPENDING CEILING STOPPED, recorded per case so a case receipt can say "I did not buy
        // this one because the ceiling was reached", and scoped to the day it happened on. The marker rides
        // run progress (an existing row, an existing column, no second store) and clears by day rollover,
        // because a ceiling reached yesterday explains nothing about today.
        const capped = typeof unit.cursor?.cappedCase === "string" ? unit.cursor.cappedCase : null;
        if (capped) {
          const day = run.cycle_key.slice(-10);
          const held = progress.capped?.day === day ? progress.capped.caseIds : [];
          progress = { ...progress, capped: { day, caseIds: [...new Set([...held, capped])].slice(0, 20) } };
        }
        if (unit.status === "failed") progress = { ...progress, state: { ...progress.state, blocker: (unit.detail ?? "").slice(0, 300) || null } };
        // EVERY non-done outcome persists the SAME phase with its durable unit cursor FIRST, so nothing the unit achieved is stranded and a lost lease aborts
        // here with no pause written. Then: advanced loops for the next unit (the loop top renews the lease before it), waiting pauses with no error at all
        // (a durable provider wait is not a failure), failed pauses with the unit's own bounded reason.
        if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: unitCursor })) return;
        if (unit.status === "advanced") { cursor = unitCursor; continue; }
        await finishRun(tenantId, run.id, ownerToken, "paused", unit.status === "waiting" ? null
          : { phase, message: (unit.detail ?? "evidence step could not finish").slice(0, 300), at: nowFn().toISOString() });
        return;
      }
      // unit.status === "done" -> fall through to the normal next-phase advance.
      const nextAfterFunnel = nextPhase(phase);
      const advancedFunnel = await advancePhase(tenantId, run.id, ownerToken, { phase: nextAfterFunnel, progress, cursor: null });
      if (!advancedFunnel) return;
      phase = nextAfterFunnel;
      cursor = null;
      continue;
    }

    // VERIFY BEFORE ANYTHING IS PUBLISHED OFF IT (verify_and_measure). A change the operator marked as done
    // is a claim until I have read their page, and Results answers "did Beacon verify it on the live
    // website" off exactly this. It runs here, in front of the surface build, under the lease this loop just
    // renewed: bounded to three pages, free (owned reads on the polite-fetch path, never a provider, never
    // the winner budget), and fail-soft, because a page I could not read must never pause a research pass.
    if (phase === "publish_surface" && work.due.includes("verify_and_measure")) {
      const verified = await steps.verifyShipments(tenantId, nowFn()).catch(() => 0);
      if (verified > 0) log.info("[research-run] checked what you marked as done on your live pages", { tenantId, verified });
    }

    let outcome: PhaseOutcome;
    try {
      outcome = await runPhase(phase, tenantId, nowFn(), progress, attemptKey, steps);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      log.warn("[research-run] phase threw; pausing (recoverable)", { tenantId, phase, error: message });
      await finishRun(tenantId, run.id, ownerToken, "paused", { phase, message, at: nowFn().toISOString() });
      return;
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
      if (!saved) return;
      await finishRun(tenantId, run.id, ownerToken, "paused", outcome.pause);
      return;
    }
    progress = outcome.progress;
    // THE DECIDE WATERMARK. A pass that reached the end of the decision step stamps the basis and the
    // research-notes version it consumed, published or not: in both cases it looked and concluded.
    // Notes that move PAST this are new evidence, which is what makes another pass the same day worth
    // its money instead of a repeat. It is read here, after this pass's own writes, so a pass never
    // counts its own discovery as somebody else's news and re-opens itself forever.
    if (phase === "publish_surface" && basis) {
      const version = await steps.evidenceVersion(tenantId, basis).catch(() => null);
      if (version != null) progress = { ...progress, decided: { basis, rowVersion: version } };
    }

    const next = nextPhase(phase);
    // Advancing replaces the cursor (clears the completed phase's attempt identity).
    const advanced = await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: null });
    if (!advanced) return; // our lease was recovered by another instance - abort, no side effects
    phase = next;
    cursor = null;
  }

  // Reached only when every phase succeeded or was a healthy no-op.
  await finishRun(tenantId, run.id, ownerToken, "completed");
}

/**
 * DRIVE A RUN THIS CALLER ALREADY HOLDS THE LEASE ON. The one entry both doors go through: the daily
 * scheduler hands it a run claimed by claim_due_research_work, a visit hands it the run claimed here. It
 * never claims and never re-leases, so there is exactly one orchestrator and no second copy of it.
 *
 * NOTHING DUE, NOTHING SPENT. A pass that opened with a readable and empty due list closes right here at $0
 * rather than walking seven phases to discover the same thing. Only a pass at its very first phase may close
 * this way: a RESUMED run carries work of its own (a half-finished backfill, a unit cursor) that due-work
 * does not speak for.
 */
export async function driveClaimed(
  run: ResearchRun, ownerToken: string, work: DueWork | null, nowFn: () => Date, deadline: number, steps: ResearchCycleSteps,
): Promise<void> {
  const tenantId = run.tenant_id;
  const fresh = run.current_phase === "refresh_sources" && run.phase_cursor == null;
  if (fresh && work != null && work.readable && work.due.length === 0) {
    log.info("[research-run] nothing is due; closing the pass at zero cost", { tenantId, nextDueAt: work.nextDueAt });
    // The numbers go down BEFORE the close, on the same row, so a finished-with-nothing-owed pass can
    // still tell the operator what it checked and the date the waiting ends. A pass that closes
    // silently looks identical to one that never ran.
    await advancePhase(tenantId, run.id, ownerToken, { phase: run.current_phase, cursor: null, progress: {
      ...(run.progress ?? {}),
      state: { ...(run.progress?.state ?? {}), checksDone: work.checks.done, checksTotal: work.checks.total,
        checksAnswers: work.checks.answers, checksUnavailable: work.checks.unavailable, checksUnsupported: work.checks.unsupported,
        casesActive: work.cases.active, casesParked: work.cases.parked, nextDueAt: work.nextDueAt, blocker: null },
    } });
    await finishRun(tenantId, run.id, ownerToken, "completed");
    return;
  }
  await driveRun(run, ownerToken, nowFn, deadline, steps,
    work ?? { due: [], readable: false, checks: { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 }, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null });
}

/** How many EXTRA same-day passes THE VISIT DOOR may open for one account. A visit is a chance, not a debt:
 *  every navigation is another opportunity to open one, so this door keeps the eight it was sized for. The
 *  daily scheduler is unaffected, because it opens its pass through the claim and never through this door,
 *  and the day's absolute runaway stop inside research-run still bounds every door together. */
const VISIT_EXTRA_PASSES_PER_DAY = 8;

/**
 * THE VISIT DOOR: claim, resume, or start the account's Research Run and drive it. A DAY IS NOT A UNIT OF
 * WORK: a refused claim asks the one free question that matters (due-work, from persisted state alone) and
 * opens another pass only when something is genuinely due. FAIL CLOSED both ways: an unreadable state opens
 * nothing, an empty one opens nothing at $0, and a pass that opens with nothing due closes immediately.
 */
export async function runResearchCycle(tenantId: string, options: ResearchCycleOptions = {}): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? RESEARCH_CYCLE_DEADLINE_MS;
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const deadline = nowFn().getTime() + deadlineMs;

  // Slice 5 pre-activation gate: no research work runs before an account is active, and none runs for an
  // account whose operator paused research. FAIL CLOSED: a missing/unknown account, or any read error, is a
  // no-op (logged), never a claim. claim_research_run itself carries NEITHER guard (the fleet enumeration
  // does), so this is the whole gate on the visit door.
  const account = await getTenant(tenantId).catch(() => null);
  if (!account || account.status !== "active") {
    log.debug("[research-run] skipped: account not active (no research before activation)", { tenantId, status: account?.status ?? "unknown" });
    return;
  }
  if (await isResearchPaused(tenantId)) {
    log.debug("[research-run] skipped: research is paused for this account", { tenantId });
    return;
  }

  await runWithTenant(tenantId, async () => {
    const ownerToken = newOwnerToken();
    const now = nowFn();
    // A claim that FAILED (the database could not answer) is not a claim that was refused: it ends the
    // visit here, with no pass and no due-work question, because there is nothing trustworthy to ask it of.
    let run = await claimRun(tenantId, ownerToken).catch(() => "unavailable" as const);
    if (run === "unavailable") return;
    const work = await steps.dueWork(tenantId, now).catch(() => null);
    if (run == null) {
      // Refused: either another instance holds the open run, or a pass already completed today. Only a
      // POSITIVE due signal opens a second pass, and the one-open-run index still refuses it while any
      // run is unfinished, so the "held elsewhere" case cannot slip through this door.
      if (work == null || !work.readable || work.due.length === 0) {
        log.debug("[research-run] no claim and nothing due; nothing runs", { tenantId, due: work?.due.length ?? null });
        return;
      }
      run = await startExtraPass(tenantId, ownerToken, reportingDay(now.getTime()), VISIT_EXTRA_PASSES_PER_DAY);
      if (run == null) return;
      log.info("[research-run] same-day pass opened on genuinely due work", { tenantId, due: work.due });
    }
    await driveClaimed(run, ownerToken, work, nowFn, deadline, steps);
  });
}

/** How many continuations ONE account may chain in ONE reporting day. BROWSER RECOVERY MACHINERY ONLY: a
 *  hop exists so an open tab can finish work the scheduler left, and the daily scheduler never uses one. The
 *  bound is the whole safety story: each hop is its own request with its own lease claim, so a closed tab
 *  simply stops, and this stops a live one from looping forever on a due list it can never clear. */
const MAX_CONTINUATIONS = 6;

/**
 * ONE bounded continuation hop, and an honest answer about whether another is owed.
 *
 * The trigger stays what it was: next/after on render, one hop, no unawaited promise living past the
 * response. What is new is that a hop reports back, so the surface that asked for it can ask again while
 * work remains. Each hop is a SEPARATE request that claims the lease for itself, which is why a closed tab
 * stops safely, a reopened one resumes exactly where the row says, and two tabs cannot both advance a run.
 *
 * THE HOP IS NOT THE CLIENT'S TO COUNT. It arrives from the browser, so a caller that kept sending 0 got a
 * fresh allowance every time and the bound bounded nothing. The count is kept on the account's own row,
 * scoped to the reporting day, inherited by every pass that opens that day, and the ceiling is enforced
 * against THAT number; the client's claim is a fallback for the one case where nothing can be counted yet.
 */
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
