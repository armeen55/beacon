import "server-only";

import { after } from "next/server";

import { getTenant } from "@/domains/account";
import type { FunnelUnitOutcome } from "@/domains/evidence";
import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { NO_BASIS_DETAIL } from "@/domains/evidence/funnel/shared";
import { runFocus } from "./investigation-queries";
import { utcReportingDay } from "./daily-observations";
import { dueWork, type DueWork } from "./due-work";
import { defaultSteps, type ResearchCycleSteps } from "./research-steps";
// The phase bodies live in research-steps; the contract between the two files is this type, so a
// caller that drives a run keeps importing the runner and gets the shape it must satisfy.
export type { ResearchCycleSteps } from "./research-steps";
import {
  advancePhase,
  claimRun,
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

/** on-visit-refresh - the Research Run executor (Slice 4, 2026-07-24). Every navigation schedules ONE post-response Research Run for the tenant. The run
 *  is durable: claim_research_run RESUMES the account's single unfinished run first (regardless of its start date, so yesterday's paused run is never
 *  abandoned and no second open run is created), and starts a fresh daily cycle only when no run is open. A pass that already completed today no longer
 *  ENDS the day (Phase 5): the refusal is now a question, and another pass opens only when due-work reports something genuinely owed that the completed
 *  pass could not have done. It leases the run so exactly one invocation advances it, and the persisted phase + progress let a crash or lambda timeout resume
 *  where it left off. No scheduler, cron, heartbeat, in-memory dedupe or job queue: the DATABASE lease is the whole mechanism (a concurrent claim with a
 *  different owner token returns null). TRUTH BOUNDARY (Slice 4 truth-and-lease repair): a phase advances ONLY when it truly succeeded or was a healthy
 *  no-op. Every failure pauses the cycle with a bounded last_error and never reaches completion: refresh_sources - refresh stale connectors.
 *  sourcesRefreshed counts ONLY the sources that actually synced. ANY per-source failure pauses here (the succeeded ones keep their freshness stamps, so
 *  a retry targets only the rest). Zero stale sources is a healthy no-op that advances. A THROW (refresh could not run) pauses too. gsc_backfill_chunk -
 *  advance one bounded GSC deep-backfill chunk, to the bound deep-backfill.ts sizes for a serverless window rather than racing a deadline the GSC fetch
 *  cannot honour (no AbortSignal). An advance or a benign skip advances; a real error THROWS and pauses with the cursor untouched (it never advances on a
 *  failed pull), so the retry is that window. the four evidence - identity is reconciled and PERSISTED first (a throw pauses before any focus, unit or
 *  cent), then one bounded funnel unit resumes from its own durable cursor. prompt_observations asks exactly what daily-observations planned (one
 *  canonical reading per question, per engine, per UTC day) and then reads the new answers back; that read-back is DERIVED work on evidence already
 *  stored, so it is bounded, $0 when nothing changed, and never pauses the run. publish_surface - rebuild + publish the Today/Changes release when a
 *  source refreshed, a chunk advanced, or the saved release is genuinely stale (evidence-conditioned, never day-gated). surfacePublished is true ONLY
 *  after publishSurface RESOLVES; a THROW pauses here and the previously saved surface stays visible. IDEMPOTENCY: before each phase's side effect we
 *  persist the phase attempt identity (phase, a deterministic attemptKey, the seed) via renew_research_lease, which also renews the lease, and hand the
 *  executor that attemptKey. A retry of the same run+phase reuses the PERSISTED key; advancing clears the cursor, so the next phase mints its own. The
 *  run's frozen FOCUS rides on PROGRESS for exactly that reason. CONFLICT: an evidence unit reporting the structured `state_conflict` code persisted
 *  NOTHING, so its counters are DISCARDED (a stale zeroed receipt must never overwrite proven spend) and the SAME phase attempt is re-invoked ONCE under
 *  the same lease, attempt key and unit cursor - the unit reloads canonical state and its cached call identities keep the retry $0. A second conflict in
 *  a row pauses honestly. Nothing else retries: blocked, waiting, capped and lost-lease behaviour are untouched. LEASE: renewed at DATABASE time BEFORE
 *  every bounded unit of work, not once per phase-worth of work: a unit that reads many pages before it reaches a paid request hands the run back first
 *  (winning_pages splits exactly there, between persisting winners and buying the comparison; the answer read-back renews before its own first call for
 *  the same reason), so a purchase is always the FIRST side effect after a real renewal. A funnel unit's own optimistic row_version protects the research
 *  DOCUMENT from a concurrent writer; it is NOT this lease and proves nothing about lease ownership. A false return from renewLease / advancePhase /
 *  finishRun means the lease was lost: abort immediately, no further side effects. WHAT THE LEASE IS AND IS NOT: it bounds WHICH invocation may proceed.
 *  It does not make a purchase idempotent, and it is not what stops the same comparison being bought twice when a save fails after the money moved. That
 *  is the evidence cache: a durable receipt keyed on the normalized ask, written BEFORE the network call. */

/** Leave enough of the shell's 300-second lifetime to finish the surface build. */
const RESEARCH_CYCLE_DEADLINE_MS = 210_000;

/** The four Slice 6 evidence phases, each backed by one funnel unit executor. */ const FUNNEL_PHASES = new Set<ResearchPhase>(["keyword_discovery", "prompt_observations", "serp_analysis", "winning_pages"]);

type ResearchCycleOptions = {
  now?: () => Date;
  deadlineMs?: number;
  steps?: Partial<ResearchCycleSteps>;
};

/** One phase's outcome: the merged progress, plus an optional `pause` error when the phase reported a recoverable failure that is NOT a throw (a partial
 *  connector refresh). A thrown error is handled separately by the cycle loop, which records the error and pauses. */
type PhaseOutcome = { progress: ResearchRunProgress; pause?: ResearchRunError };

/** Run one phase's body, returning the merged progress (and any returned-failure pause). */
async function runPhase(
  phase: ResearchPhase,
  tenantId: string,
  now: Date,
  progress: ResearchRunProgress,
  attemptKey: string,
  steps: ResearchCycleSteps,
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
  run: ResearchRun,
  ownerToken: string,
  nowFn: () => Date,
  deadline: number,
  steps: ResearchCycleSteps,
  work: DueWork,
): Promise<void> {
  const tenantId = run.tenant_id;
  // PROGRESS IS PERSISTED, NOT ASSEMBLED PER RENDER. The run writes the numbers every surface then
  // reads back from this row: today's checks, the plan's live and waiting topics, the date a wait
  // ends. They come from the ONE due-work read this pass already made, so they cost nothing extra
  // and no two requests can compute them differently.
  let progress: ResearchRunProgress = {
    ...(run.progress ?? {}),
    state: {
      ...(run.progress?.state ?? {}),
      checksDone: work.checks.done, checksTotal: work.checks.total,
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
    // PUBLISHING NEEDS THAT BASIS TOO: the gate below sat inside the funnel branch, and publish_surface is not a funnel phase, so a run resumed straight at
    // publish_surface reached the staleness check and the release build with a basis nobody could read. NO BASIS, NO WORK OF ANY KIND. Reconciliation used to
    // return quietly when the basis was unreadable, reporting SUCCESS for identities it could not possibly have persisted, and the run went on to freeze a
    // null-basis plan, spend against it and publish off it. A basis I cannot read PAUSES this same phase before reconciliation, before any focus, unit,
    // provider call, website fetch or surface write, so surfacePublished is never set and the release already saved stays visible. The retry re-resolves the
    // basis, reconciles, then freezes, and it re-runs no completed evidence phase to get there.
    const basis = FUNNEL_PHASES.has(phase) || phase === "publish_surface" ? (await steps.currentBasis(tenantId)) || null : "";
    if (basis === null) { await finishRun(tenantId, run.id, ownerToken, "paused", { phase, message: NO_BASIS_DETAIL, at: nowFn().toISOString() }); return; }

    if (FUNNEL_PHASES.has(phase)) {
      // FREEZE THE INVESTIGATION ONCE PER RUN, durably, BEFORE a cent is spent: the ordered topic, the exact search it owes, the date it may next be retried
      // and the basis it was chosen under, picked when this run first reaches the results-page phase and reused unchanged by winning-pages and the
      // comparison, through advancePhase on the SAME phase. Only a REAL focus is frozen: an open run can span days, so one transient empty read must not
      // silence it for that whole life; empty stays unfrozen and both units keep the agenda. IDENTITY IS RECONCILED AND PERSISTED ON EVERY PHASE FIRST, not
      // only when a plan is frozen. A FAILURE PAUSES THIS SAME PHASE AND SPENDS NOTHING: catching it and carrying on (twice over) let a run freeze a plan,
      // read winners and buy a comparison against an identity nothing on file had ever written.
      // THE READING IS BOUNDED PER RUN, NOT PER UNIT ITERATION. Reconciliation runs before every funnel unit and a phase iterates many times, so an unbounded
      // attempt asked the same question over and over inside one cycle. The marker rides run PROGRESS (the extraSamples pattern), persisted the moment an
      // attempt is made, so a resumed run does not ask again either; the plan this run froze rides along, and those cases are reviewed before any other.
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
        // THE CASE THE CEILING STOPPED, recorded per case and scoped to the day it happened on. The
        // discovery unit stops honestly when the spending ceiling is reached, but nothing per CASE was
        // persisted, so a case receipt could not say "I did not buy this one because the ceiling was
        // reached" the way it already can for a page by page comparison. The marker rides run progress
        // (the extra-sample pattern: an existing row, an existing column, no second store) and clears
        // by day rollover, because a ceiling reached yesterday explains nothing about today.
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
 * Claim, resume, or start the account's Research Run and drive it, and report whether work is STILL owed
 * when it hands back.
 *
 * A DAY IS NOT A UNIT OF WORK. The claim used to refuse outright once a run had completed in the current
 * UTC day, so evidence bought at 9am could not become a decision until tomorrow: a retry date that passed
 * at noon, a source that refreshed, an extra reading the operator asked for and paid attention to, all sat
 * until midnight. Now a refused claim asks the ONE free question that matters (due-work: what is genuinely
 * owed, from persisted state alone) and opens another pass only when something is actually due. FAIL
 * CLOSED both ways: an unreadable state opens nothing, and a readable EMPTY state opens nothing and costs
 * nothing. A pass that opens with nothing due closes immediately at $0 and blocks no later pass, because
 * completion is not a claim about the day, only about that pass.
 */
export async function runResearchCycle(tenantId: string, options: ResearchCycleOptions = {}): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? RESEARCH_CYCLE_DEADLINE_MS;
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const deadline = nowFn().getTime() + deadlineMs;

  // Slice 5 pre-activation gate: no research work runs before an account is active. FAIL CLOSED: a missing/unknown account, or any read error, is a no-op
  // (logged), never a claim. The database claim_research_run RPC carries the same active-account guard; this is the runtime-level mirror so we never even
  // reach the claim for a pending account.
  const account = await getTenant(tenantId).catch(() => null);
  if (!account || account.status !== "active") {
    log.debug("[research-run] skipped: account not active (no research before activation)", { tenantId, status: account?.status ?? "unknown" });
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
      run = await startExtraPass(tenantId, ownerToken, utcReportingDay(now.getTime()));
      if (run == null) return;
      log.info("[research-run] same-day pass opened on genuinely due work", { tenantId, due: work.due });
    }
    // NOTHING DUE, NOTHING SPENT. A pass that opened with a readable and empty due list closes right here
    // at $0 rather than walking seven phases to discover the same thing. Only a pass at its very first
    // phase may close this way: a RESUMED run carries work of its own (a half-finished backfill, a unit
    // cursor) that due-work does not speak for.
    const fresh = run.current_phase === "refresh_sources" && run.phase_cursor == null;
    if (fresh && work != null && work.readable && work.due.length === 0) {
      log.info("[research-run] nothing is due; closing the pass at zero cost", { tenantId, nextDueAt: work.nextDueAt });
      // The numbers go down BEFORE the close, on the same row, so a finished-with-nothing-owed pass can
      // still tell the operator what it checked and the date the waiting ends. A pass that closes
      // silently looks identical to one that never ran.
      await advancePhase(tenantId, run.id, ownerToken, { phase: run.current_phase, cursor: null, progress: {
        ...(run.progress ?? {}),
        state: { ...(run.progress?.state ?? {}), checksDone: work.checks.done, checksTotal: work.checks.total,
          casesActive: work.cases.active, casesParked: work.cases.parked, nextDueAt: work.nextDueAt, blocker: null },
      } });
      await finishRun(tenantId, run.id, ownerToken, "completed");
      return;
    }
    await driveRun(run, ownerToken, nowFn, deadline, steps,
      work ?? { due: [], readable: false, checks: { done: 0, total: 0 }, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null });
  });
}

/** How many continuations ONE trigger may chain. The bound is the whole safety story: each hop is its own
 *  request with its own lease claim, so a closed tab simply stops, and this stops a live one from looping
 *  forever on a due list it can never clear. */
const MAX_CONTINUATIONS = 6;

/**
 * ONE bounded continuation hop, and an honest answer about whether another is owed.
 *
 * The trigger stays what it was: next/after on render, one hop, no unawaited promise living past the
 * response. What is new is that a hop reports back, so the surface that asked for it can ask again while
 * work remains. Each hop is a SEPARATE request that claims the lease for itself, which is why a closed tab
 * stops safely, a reopened one resumes exactly where the row says, and two tabs cannot both advance a run.
 */
export async function continueResearch(tenantId: string, hop = 0, options: ResearchCycleOptions = {}): Promise<{ hop: number; more: boolean }> {
  const next = Math.max(0, Math.trunc(hop)) + 1;
  if (!tenantId || next > MAX_CONTINUATIONS) return { hop: Math.max(0, Math.trunc(hop)), more: false };
  await runResearchCycle(tenantId, options).catch((error) => {
    log.warn("[research-run] continuation hop failed (non-blocking)", { tenantId, hop: next, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
  });
  const work = await (options.steps?.dueWork ?? dueWork)(tenantId, (options.now ?? (() => new Date()))()).catch(() => null);
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
