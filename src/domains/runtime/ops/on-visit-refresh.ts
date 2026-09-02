import "server-only";

import { after } from "next/server";

import { getTenant } from "@/domains/account"; import { getTenantSpentTodayUsd } from "@/lib/cost/budget-ledger-supabase";
import type { FunnelUnitOutcome } from "@/domains/evidence";
import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { NO_BASIS_DETAIL } from "@/domains/evidence/funnel/shared";
import { runFocus } from "./investigation-queries";
import { reportingDay } from "@/lib/reporting-day";
import { dueWork, researchPermission, visitMayOpenResearch, type DueWork, type DuePhase } from "./due-work";
import { defaultSteps, type ResearchCycleSteps } from "./research-steps";
// The phase bodies live in research-steps; the contract between the two files is this type, so a caller that drives a run keeps importing the runner and gets the shape it must satisfy.
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

/** on-visit-refresh - the Research Run executor (Slice 4, 2026-07-24). THE canonical cycle and the ONLY orchestrator; the phase BODIES live in research-steps.ts and document themselves there. Two doors drive it: the global daily scheduler (scheduler.ts, one guarded POST per day for every account whose Pacific day still owes work) and any navigation, which recovers and resumes whatever the scheduler left unfinished. Daily research never depends on anybody opening the app; a visit is recovery, not the trigger. DURABLE: claim_research_run RESUMES the account's single unfinished run first, whatever date it started, and opens a fresh daily cycle only when none is open. A day is not a unit of work, so a completed pass no longer ends the day: another pass opens only when due-work reports something genuinely owed. THE DATABASE LEASE DECIDES WHO ADVANCES A RUN and nothing else does; a dispatch and a visit racing the same account cannot both proceed, because the second claim against a live lease returns null. TRUTH BOUNDARY: a phase advances ONLY when it truly succeeded or was a healthy no-op, and every failure pauses with a bounded last_error instead of reaching completion. THE BATCH IS NOT THE DAY: prompt_observations asks exactly what daily-observations planned (one canonical reading per question, per engine, per PACIFIC reporting day) and then RE-READS the planner: unreadable pauses fail-closed, anything still owed keeps this same phase under a renewed lease, and only settled == intended advances. COLLECTION IS NEVER HELD BY ANALYSIS: the phase move and the day's counts are BANKED first and the bounded reading of those answers runs behind them, so a reading that runs out of the turn leaves the run advanced and the analyses owed rather than both stranded. IDEMPOTENCY: each phase's attempt identity (phase, a deterministic attemptKey, the seed) is persisted through renew_research_lease BEFORE the side effect and handed to the executor, so a retry of the same run+phase reuses the PERSISTED key; advancing clears the cursor, which is why the run's frozen FOCUS rides on PROGRESS. CONFLICT: a unit reporting the structured `state_conflict` code persisted NOTHING, so its counters are DISCARDED (a stale zeroed receipt must never overwrite proven spend) and the SAME attempt is re-invoked ONCE under the same lease, key and cursor; its cached call identities keep that retry $0 and a second conflict pauses honestly. Nothing else retries. LEASE: renewed at DATABASE time before every bounded unit of work, never once per phase-worth of it, so a purchase is always the FIRST side effect after a real renewal (winning_pages splits exactly there, between persisting winners and buying the comparison; the read-back renews for the same reason). A false return from renewLease / advancePhase / finishRun means the lease was lost: abort immediately. WHAT THE LEASE IS NOT: a funnel unit's own optimistic row_version protects the research DOCUMENT and proves nothing about ownership, and no lease makes a purchase idempotent. That is the evidence cache: a durable receipt keyed on the normalized ask, written BEFORE the network call. */

/** ONE cycle's wall-clock budget, for both doors. 210s leaves enough of the 300-second function lifetime to finish the surface build; the scheduler spends its own total budget in units of this. */
export const RESEARCH_CYCLE_DEADLINE_MS = 260_000; // THE HOSTED FUNCTION ALLOWS 300 SECONDS AND THE DISPATCH WAS ONLY USING 210 (Codex, 2026-08-23). The producer's free half (snapshot, candidate compile, every $0 producer, the page readings) runs before a cent moves, and on a nearly-exhausted manifest it ate the whole drive: the last two candidates, worth 557 and 312 recoverable clicks, came back "not reached" with ZERO calls and zero dollars because the writer was never reached. The paid half gets the rest of the function's real budget, with a margin the platform keeps.
/** The least time left on a turn that is worth starting a bounded reading slice on. Under a minute and a half there is no room for one wave of readings and the writes behind it, so the turn goes straight to its phase and the reading is owed to the next one: a slice started with no time is a slice that spends money and stores nothing. */
const ANALYSIS_SLICE_MIN_MS = 90_000;
/** THE PHASES THAT CAN HOLD A RUN FOR HOURS, and the reason a turn may not simply walk back into one. The daily dispatch resumes this account's ONE unfinished run every half hour, so a run parked in the results-page or winning-pages phase was handed the whole turn again, and again: on 7 August one held the day for ten and a half hours while the 140 answers bought that morning went unread, because the only door that opens a reading pass is the one the claim never reaches while a run is open. A turn that RESUMES into one of these now reads a bounded slice of the answers already paid for FIRST, then carries on with the phase on what is left of the deadline. Once per drive, only when a reading is genuinely owed, and it buys nothing: it reads answers already on file. */
const LONG_PHASES = new Set<ResearchPhase>(["serp_analysis", "winning_pages"]);
/** A day I cannot count is never a day I finished. */
const DAY_UNREADABLE = "I could not read where today's AI checks stand, so I stopped rather than call the day finished. I will pick this up on the next pass.";

/** The four Slice 6 evidence phases, each backed by one funnel unit executor. */
const FUNNEL_PHASES = new Set<ResearchPhase>(["keyword_discovery", "prompt_observations", "serp_analysis", "winning_pages"]);

/** WHAT EACH OWED UNIT ACTUALLY COSTS IN PHASES. Due-work decides WHETHER another pass runs; this is what turns its answer into WHAT that pass may do. Once a run opened, the executor traversed the complete cycle whatever the debt was, so recovery for one stored-answer reading re-ran keyword discovery, results pages, winner reads, a crawl and a publication: four live passes spent about 69 cents on research nobody had asked for. A recovery pass now runs the phases its own debt names and skips the rest in ONE advance. A fresh daily cycle carries no plan at all and still walks everything, in order. */
const PHASES_FOR: Record<DuePhase, readonly ResearchPhase[]> = {
  // A STOCK SHORTFALL OPENS THE RUN AND BUYS NOTHING. It rides the first funnel phase because that is where the inventory check lives, and a drive whose ONLY reason is the shortfall skips that phase's own buying (`stockOnly` below): the top-up finishes stored work, and wanting more finished changes is not a reason to buy fresh evidence.
  replenish_ready: ["keyword_discovery"],
  refresh_sources: ["refresh_sources", "gsc_backfill_chunk"],
  crawl_pages: ["crawl_pages"],
  daily_observations: ["prompt_observations"],
  // The reading of answers already bought rides the observation phase, and buys nothing: see the analyze-only branch below.
  analyze_answers: ["prompt_observations"],
  // A SETTLED READING IS SPENT BY HARVESTING IT AND DECIDING AGAIN, and by nothing else: keyword discovery reads what those answers named, and the surface publishes what that changed. No results page, no winner read, no crawl, no refresh, no measurement, and above all no second answer bought to read an answer already in hand.
  consume_analyses: ["keyword_discovery", "publish_surface"],
  plan_cases: ["keyword_discovery", "serp_analysis"],
  acquire_case_evidence: ["serp_analysis", "winning_pages"], check_page_facts: ["fact_check"], decide_and_prepare: ["publish_surface"],
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
/** One phase's outcome: the merged progress, plus an optional `pause` error when the phase reported a recoverable failure that is NOT a throw (a partial connector refresh). A thrown error is handled separately by the cycle loop, which records the error and pauses. */
type PhaseOutcome = { progress: ResearchRunProgress; pause?: ResearchRunError };

/** THE ONLY FACT-CHECK FAILURES THAT STOP A RUN: a lost or spent lease, a write that did not land, a thrown step. Everything else owes one more claim. */
const FACT_CHECK_HARD_STOP = new Set(["lease_lost", "lease_exhausted", "inventory_write_failed", "store_write_failed", "step_error"]);async function runPhase(phase: ResearchPhase, tenantId: string, now: Date, progress: ResearchRunProgress, attemptKey: string, steps: ResearchCycleSteps, lease: { remainingMs: () => number; renew: () => Promise<boolean> }): Promise<PhaseOutcome> {
  if (phase === "refresh_sources") {
    const result = await steps.refreshSources(tenantId, now, attemptKey);
    // Union the freshly-synced provider identities with any that synced on an earlier attempt of this same cycle, so a provider that failed once and later succeeded is counted EXACTLY once. Failed ones never.
    const refreshedProviders = [...new Set([...(progress.refreshedProviders ?? []), ...result.succeeded])];
    const next = { ...progress, refreshedProviders, sourcesRefreshed: refreshedProviders.length };
    if (result.failures.length > 0) {
      // Some connected sources failed to refresh: pause at refresh_sources with a bounded receipt. The succeeded ones kept their freshness stamps, so the retry targets only the remaining stale/failed sources. Do NOT publish off a failed refresh.
      return { progress: next, pause: { phase: "refresh_sources", failures: result.failures, at: now.toISOString(),
        message: `${result.failures.length} of ${result.attempted} connected sources failed to refresh`.slice(0, 300) } };
    }
    return { progress: next };
  }
  if (phase === "gsc_backfill_chunk") {
    const result = await steps.backfillChunk(tenantId, now, attemptKey);
    return { progress: { ...progress, backfill: result.kind === "advanced" ? { ran: true, complete: result.complete, daysPulled: result.daysPulled } : { ran: false } } };
  }
  // fact_check - one page's claims against outside sources, under this drive's lease. A FACT CHECK THAT CANNOT FINISH WITHHOLDS THAT CORRECTION, NOT BEACON (Codex, 2026-08-19): pausing the run on ordinary incompleteness let one waiting search stop every growth phase. The receipt persists either way.
  if (phase === "fact_check") {
    const checked = await steps.factCheck(tenantId, lease.remainingMs(), lease.renew);
    log.info("[research-run] checked what your pages claim against sources outside them", { tenantId, ...checked });
    const moved = { ...progress, factsChecked: (progress.factsChecked ?? 0) + checked.banked, factCheck: { status: checked.status, banked: checked.banked, pagesComplete: checked.pagesComplete, failure: checked.failure ?? null, reason: checked.reason ?? null } };
    return checked.status === "failed" && checked.banked === 0 && FACT_CHECK_HARD_STOP.has(checked.failure ?? "")
      ? { progress: moved, pause: { phase: "fact_check", at: now.toISOString(), message: `fact check ${checked.failure ?? "failed"}: ${checked.reason ?? "nothing advanced"}`.slice(0, 300) } } : { progress: moved };
  }
  // publish_surface - evidence-conditioned, never day-gated, never every visit.
  const shouldPublish = (progress.sourcesRefreshed ?? 0) >= 1 || progress.backfill?.ran === true || (await steps.surfaceStale(tenantId, now.getTime()));
  // surfacePublished is true ONLY after publishSurface RESOLVES; a throw pauses here. When there is nothing to publish, advance with surfacePublished:false.
  if (shouldPublish) await steps.publishSurface(tenantId, attemptKey);
  return { progress: { ...progress, surfacePublished: shouldPublish } };
}

/** Read-or-create the attempt identity for a phase. An interrupted retry of the same run+phase reuses the PERSISTED attemptKey (proving it is the same unit of work); a fresh phase mints a deterministic key. The seed is the cycle key: the run+phase scope already makes the key unique per attempt, and it needs no extra I/O (the persisted backfill cursor date is not cheaply available here). */
function resolveAttemptKey(tenantId: string, runId: string, cycleKey: string, phase: ResearchPhase, cursor: Record<string, unknown> | null): string {
  if (cursor != null && cursor.phase === phase && typeof cursor.attemptKey === "string") return cursor.attemptKey;
  return phaseIdempotencyKey(tenantId, runId, phase, { seed: cycleKey });
}

/** WHAT THE RUN DURABLY BECAME, read off the state that actually landed and never off "the function returned": completed and paused landed on the row, lost_lease means another instance owns it, failed means execution threw or the state did not persist. The daily dispatch counts its receipt off exactly this. */
type DriveReceipt = "completed" | "paused" | "failed" | "lost_lease";

/** Execute the claimed run from its current_phase to done, or pause durably. The DATABASE lease we hold (via ownerToken) is renewed BEFORE every phase; if a renew / advance / finish reports our lease was lost, we abort immediately. */
async function driveRun(run: ResearchRun, ownerToken: string, nowFn: () => Date, deadline: number, steps: ResearchCycleSteps, work: DueWork): Promise<DriveReceipt> {
  const tenantId = run.tenant_id;
  /** EVERY TERMINAL PATH STAMPS THE MONEY. The funnel counter sees only search buys, so a pass whose money went on model calls stamped $0 forever: 20 of 22 real runs. The day ledger holds EVERY platform's spend, so the BIGGER of the funnel number and the ledger's movement across the run is stamped; a run crossing midnight keeps the funnel number. A PAUSED RUN STAMPS EXACTLY AS A COMPLETED ONE DOES (operator, 2026-08-21): the live run sat paused at $0.00 while the day's ledger held $0.90, because only completion ever wrote the accumulator. A pause is only a pause once it LANDED: finishRun answers false when the lease was gone, and a pause nobody recorded is a failure. */
  const dayAtStart = new Date().toISOString().slice(0, 10), ledgerAtStart = await getTenantSpentTodayUsd(tenantId).catch(() => null);
  const spentSoFar = async (funnel: number): Promise<number> => {
    const end = new Date().toISOString().slice(0, 10) === dayAtStart ? await getTenantSpentTodayUsd(tenantId).catch(() => null) : null;
    const delta = ledgerAtStart != null && end != null ? Math.max(0, Math.round((end - ledgerAtStart) * 1e6) / 1e6) : 0;
    return Math.max(Number(funnel) || 0, delta); };
  const pause = async (errorInfo: ResearchRunError | null = null): Promise<DriveReceipt> =>
    (await finishRun(tenantId, run.id, ownerToken, "paused", errorInfo, await spentSoFar(Number(progress.funnel?.spendUsd) || 0))) ? "paused" : "failed";
  const complete = async (p: ResearchRunProgress): Promise<DriveReceipt> =>
    (await finishRun(tenantId, run.id, ownerToken, "completed", null, await spentSoFar(Number(p.funnel?.spendUsd) || 0))) ? "completed" : "failed";
  // PROGRESS IS PERSISTED, NOT ASSEMBLED PER RENDER: every count comes from the ONE due-work read this pass already made, so no two requests can compute them differently.
  let progress: ResearchRunProgress = { ...(run.progress ?? {}), state: { ...(run.progress?.state ?? {}),
    checksDone: work.checks.done, checksTotal: work.checks.total, checksAnswers: work.checks.answers,
    checksUnavailable: work.checks.unavailable, checksUnsupported: work.checks.unsupported,
    casesActive: work.cases.active, casesParked: work.cases.parked, nextDueAt: work.nextDueAt, blocker: null } };
  let phase = run.current_phase;
  let cursor: Record<string, unknown> | null = run.phase_cursor ?? null;
  /** THE PASS RUNS WHAT IT WAS OPENED FOR. Null on the day's first genuine run, which walks the whole cycle. */
  const allowed = plannedPhases(run.progress ?? null);
  // THE ONLY REASON THIS RUN OPENED IS THE FINISHED-CHANGE STOCK, so it tops the stock up and buys NO NEW RESEARCH EVIDENCE: no results page, no crawl, no answer. It does spend the bounded drafting allowance, which is the whole point of it, and saying it "buys nothing" was false (Codex, 2026-08-22).
  const stockOnly = (run.progress?.plan?.units ?? []).length > 0 && (run.progress?.plan?.units ?? []).every((u) => u === "replenish_ready");
  /** This pass owes a READING of answers already bought, and owes nobody a new one: the observation phase reads and buys nothing. */
  const planUnits = run.progress?.plan?.units ?? [];
  const readingOnly = planUnits.includes("analyze_answers") && !planUnits.includes("daily_observations");
  /** ONE bounded reading of answers already bought, folded into the run's OWN receipt. Fail-soft by contract: the expensive part is already persisted, so a reading I could not produce is absent and never a pause. The three numbers go down together, because a bare "0 analyzed" cannot tell a quiet pass from one that took forty answers on and could store none of them. */
  const readAnswersBack = async (): Promise<void> => {
    const pass = await steps.analyzeAnswers(tenantId, run.cycle_key.slice(-10), Math.max(0, deadline - nowFn().getTime())).catch(() => null);
    if (pass == null || pass.attempted === 0) return;
    const f = progress.funnel ?? {};
    // THE ACCOUNTING RIDES WITH THE COUNTS. The reading pass returns one bucket per answer it took on and the buckets add up to what it attempted, so the row carries the explanation beside the shape that needs one. Read structurally: the step seam names the three numbers it has always named, and a pass that produces no accounting simply contributes nothing to it.
    const answersOutcomes = { ...(f.answersOutcomes ?? {}) };
    for (const [bucket, n] of Object.entries(pass.outcomes ?? {})) answersOutcomes[bucket] = (answersOutcomes[bucket] ?? 0) + n;
    progress = { ...progress, funnel: { ...f, answersAnalyzed: (f.answersAnalyzed ?? 0) + pass.read,
      answersAttempted: (f.answersAttempted ?? 0) + pass.attempted, answersRefused: (f.answersRefused ?? 0) + pass.refused,
      ...(Object.keys(answersOutcomes).length > 0 ? { answersOutcomes } : {}) } };
  };
  /** Does THIS turn owe the reading before the phase it resumed into? Only a turn that arrived already inside a long phase, and only when a reading is due. */
  let readBeforePhase = LONG_PHASES.has(run.current_phase) && work.due.includes("analyze_answers");
  /** ONE bounded reading slice per drive, wherever this turn owes it: in front of a long phase it resumed into, on a pass opened to read alone, or straight after a day's collection is BANKED. Worth starting only with room left to store what it buys, so under the floor the debt keeps its place and the next pass reads it. */
  let slices = 3; const roomToRead = (): boolean => slices > 0 && deadline - nowFn().getTime() >= ANALYSIS_SLICE_MIN_MS; // THREE slices, not one: 616 purchased answers sat unread while every drive read at most forty and handed the rest of its clock to phases that buy more. The deadline floor still bounds each slice, so reading can never eat the drive, and a pass with no debt spends nothing
  /** The phase whose attempt already spent its ONE state-conflict retry (never global). */
  let conflictRetried: ResearchPhase | null = null;

  /** How many observation WINDOWS one drive may chain. Seven cover 35 questions on four engines at twenty a pass; the rest is slack, and past it I pause rather than let a planner and an executor that disagree turn this into a hot loop on the database until the deadline kills it. MAX_CRAWL_ROUNDS is the same idea for the website: four fifteen-page batches is sixty pages a pass, and the rest is owed to the next pass. */
  const MAX_DAY_WINDOWS = 12, MAX_CRAWL_ROUNDS = 4; let windows = 0, crawlRounds = 0;
  const REPLENISH_MIN_MS = 45_000, REPLENISH_RESERVE_MS = 60_000, REPLENISH_BOX_MS = 240_000, LEASE_REPROVE_AFTER_MS = 1_000, STOP_STARTING_MS = 40_000;
  // MIN gates entry, RESERVE stays banked for the phases behind, BOX bounds the wait, and STOP_STARTING is the margin the pass keeps back so whatever it starts can finish and be filed. Ninety-five seconds (one reasoning call's TIMEOUT FLOOR) proved far too cautious: it is a ceiling, not a typical latency, and reserving it left a 150-second runway with fifty-five usable seconds, so nothing was ever started. Forty-five covers a normal call; a rare one that runs to its floor gets cut off, and a cut-off is safe now because the receipt says not_reached and settles nothing.
  let replenished = false; // one inventory check per DAY before the first exploratory phase
  while (phase !== "done") {
    if (nowFn().getTime() >= deadline) return pause(); // out of time before this phase; leave durable progress and resume next visit
    // A DEAD DAY IS NEVER WORKED LATE, FROM ANY PHASE. Every phase's work is scoped to the RUN'S OWN reporting day, so a run that paused before midnight Pacific and resumed after it would buy, crawl, publish and stamp for a day that is gone: a missed day is missed. This guard used to fire only on the observation phase, so a run paused at keyword_discovery, serp_analysis, winning_pages, crawl_pages, gsc_backfill_chunk or publish_surface could pause its way across midnight over and over and HOLD the one-open-run index against today's own cycle. It sits at the top of EVERY resumed drive now, in front of the lease renewal and therefore in front of any paid or externally visible side effect in any phase; the pass closes with every piece of evidence it wrote intact and its remainder visibly short forever, and closing is what frees TODAY's cycle to be claimed.
    if (run.cycle_key.slice(-10) !== reportingDay(nowFn().getTime())) {
      log.info("[research-run] this pass belongs to a day that has ended, so I closed it and start today fresh", { tenantId, day: run.cycle_key.slice(-10) });
      // THE DEAD RUN KEEPS ITS OWN NUMBERS. `progress` above carries the counters this pass's due-work read for the day that has ALREADY begun, so closing with them stamped the new day's denominator onto yesterday's receipt: a day that reached 96 of 140 closed reading 3 of 140.
      await advancePhase(tenantId, run.id, ownerToken, { phase, progress: { ...progress, state: run.progress?.state ?? {} }, cursor: null });
      return complete(progress);
    }

    // A DEBT IS NOT A CYCLE. A phase this pass's plan never named is skipped in ONE advance rather than walked: no lease renewal, no basis read, no unit, no provider, no cent. The skip happens in front of every side effect for exactly that reason, and a plan whose phases are all behind us simply reaches done.
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

    // FAIRNESS FIRST: a long phase never starves the reading of answers already paid for (see LONG_PHASES above). It runs HERE, in front of the phase, because a reading spends money and this is the first moment after a real lease renewal, and its counters are persisted at once so the row says what this turn did even if the phase behind it runs out of time. What it could not reach is still owed, as on any pass.
    if (readBeforePhase && LONG_PHASES.has(phase) && roomToRead()) {
      readBeforePhase = false; slices -= 1;
      await readAnswersBack();
      log.info("[research-run] I read your stored answers before carrying on with the slower step, so a long step cannot hold them up", { tenantId, phase, read: progress.funnel?.answersAnalyzed ?? 0 });
      if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return "lost_lease";
    }

    // A DEBT OF READING IS NOT A DEBT OF BUYING. A pass opened because answers already paid for have never been read closely reads THEM and asks no engine anything: no plan, no observation unit, no re-read of the day's standing, and no basis to resolve first. It runs here under the lease just renewed, because a reading spends money, and it is fail-soft like every other derived step.
    if (phase === "prompt_observations" && allowed != null && readingOnly) {
      if (roomToRead()) { slices -= 1; await readAnswersBack(); } // no room is never a reason to buy a reading and strand it: the debt keeps its place and the pass advances on what it already knows
      const next = nextPlanned(nextPhase(phase), allowed);
      if (!await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: null })) return "lost_lease";
      phase = next; cursor = null; continue;
    }

    // Every funnel unit runs under the account's CURRENT basis; a change in website/profile/goal mints a new basis and strands prior derived state. PUBLISHING NEEDS THAT BASIS TOO, because a run resumed straight at publish_surface would otherwise reach the staleness check and the release build with a basis nobody could read. NO BASIS, NO WORK OF ANY KIND: a basis I cannot read PAUSES this same phase before reconciliation, before any focus, unit, provider call, website fetch or surface write, so surfacePublished is never set and the release already saved stays visible. The retry re-resolves the basis, reconciles, then freezes, and it re-runs no completed evidence phase to get there.
    const basis = FUNNEL_PHASES.has(phase) || phase === "publish_surface" ? (await steps.currentBasis(tenantId)) || null : "";
    if (basis === null) return pause({ phase, message: NO_BASIS_DETAIL, at: nowFn().toISOString() });

    // READY BEFORE ACQUISITION, FROM WHICHEVER PHASE THIS PASS IS ON (operator, 2026-08-22). Bound to keyword_discovery alone, a run already parked at serp_analysis could never replenish at all, so a blocked account stayed blocked for ever. It now runs before the exploratory work of ANY funnel phase. SUCCESS IS PROVEN, NEVER ASSUMED: the marker is stamped only when the step re-read the queue and found the stock at target or genuinely grown, so a credit-exhausted, budget-refused, boxed or empty-handed attempt leaves the day retryable instead of recording itself as today's completed replenishment.
    if (FUNNEL_PHASES.has(phase) && !replenished && progress.replenish?.closed !== "candidates_exhausted") {
      replenished = true;
      const day = run.cycle_key.slice(-10), mem = progress.replenish?.day === day ? progress.replenish : null;
      // A DRIVE TOPPING UP A SHORT STOCK BANKS NO RESERVE. The reserve exists for the phases BEHIND this one, and inventory comes before acquisition anyway: if the top-up uses the drive, those phases resume on the next dispatch, which is exactly what pausing is for. Measured live at 22:30Z: a 150-second runway less a 95-second margin left FIFTY-FIVE seconds to start any paid work, the free producers ate them, and every funded candidate came back not_reached. The stock got nothing while the drive was nominally spent on it.
      const shortStock = (work?.due ?? []).includes("replenish_ready");
      const runway = deadline - nowFn().getTime() - (stockOnly || shortStock ? 0 : REPLENISH_RESERVE_MS);
      let answered = false, r: Awaited<ReturnType<ResearchCycleSteps["replenishReady"]>> = null;
      // WHAT WAS ALREADY PAID FOR IS FINISHED FIRST, AND IT IS FREE (falsifier, 2026-09-02): posted provider tasks are charged at post and collected with a GET, and the only collector ran on a scheduler tick that never fires while hosting is paused, so results pages this account had already bought sat pending for days and every gate asking for one answered no. GET only, nothing posted, bounded, and before a cent of drafting is funded.
      const collected = await steps.collectBought(Math.max(5_000, Math.min(20_000, deadline - nowFn().getTime()))).catch(() => null);
      if (collected) progress = { ...progress, collected };
      if (runway > REPLENISH_MIN_MS) {
        const began = nowFn().getTime();
        // BOXED IS NOT THE SAME AS ANSWERED NOTHING. A step that ran and came back empty-handed HAD its chance, and the drive may go on; one the box cut off never got to look, and that is the case that must not turn into buying instead.
        const raced = await Promise.race([
          steps.replenishReady(tenantId, nowFn(), { fingerprint: mem?.fingerprint ?? null, attempted: mem?.attempted ?? [], tried: mem?.tried ?? [] }, nowFn().getTime() + Math.min(runway, REPLENISH_BOX_MS) - STOP_STARTING_MS).then((v) => ({ v })).catch(() => ({ v: null })),
          new Promise<null>((res) => setTimeout(() => res(null), Math.min(runway, REPLENISH_BOX_MS))),
        ]);
        r = raced?.v ?? null;
        answered = raced != null;
        log.info("[research-run] ready inventory checked before buying evidence", { tenantId, ...(r ?? { answered, boxed: !answered }) });
        // ONE ANSWER MAY END THE DAY'S OBLIGATION AND NO OTHER: every candidate on the current manifest was spent on and settled. A count is never that answer (operator, 2026-08-30). A quota failure, a provider failure, a boxed drive and an unreadable read all leave it OPEN, because none of them proves the next candidate would fail too. What the drive did learn is kept either way, so the following pass walks further down the ranking rather than paying for the same refusal again.
        if (r) {
          const closed = r.reason === "candidates_exhausted" ? r.reason : undefined;
          progress = { ...progress, replenish: { day, fingerprint: r.fingerprint, attempted: r.attempted, ...(r.tried && r.tried.length > 0 ? { tried: r.tried } : {}), ...(closed ? { closed } : {}), ...(r.outcomes ? { outcomes: r.outcomes } : {}) } };
          if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return "lost_lease"; // the day's memory persists and the lease is re-proven before the phase spends
        // A STEP THAT TOOK REAL TIME RE-PROVES THE LEASE BEFORE THE PHASE SPENDS; one that answered at once proves nothing new and does not spend a renewal the phase behind it is counting on.
        } else if (nowFn().getTime() - began >= LEASE_REPROVE_AFTER_MS && !await renewLease(tenantId, run.id, ownerToken, attemptCursor)) return "lost_lease";
      }
      // AND A DRIVE THAT COULD NOT CHECK THE STOCK DOES NOT GO ON TO BUY EVIDENCE INSTEAD. "Inventory before acquisition" was true only when the check happened to fit: this phase sits behind four free ones, the whole drive is 210 seconds, and on the FIRST funded cycle (2026-08-22 21:30Z, live) those four ate the runway, the check was skipped, and the same drive then spent $0.12 buying keywords with the finished-change queue still on zero. That is the exact trade the rule exists to forbid. A drive that could not get an answer PAUSES here instead, leaving the phase and its cursor untouched; the next dispatch resumes AT this phase with a whole drive in hand, checks the stock first, and buys afterwards. It cannot stall: a resumed run does not re-walk the free phases, so the retry always has the runway the first attempt lacked. ...AND ONLY WHEN THE STOCK IS ACTUALLY SHORT. Due-work already said so in this drive's own plan, and it costs nothing to ask: a drive whose inventory is full has nothing to put first, so a short turn still does its phase.
      if (!answered && shortStock) {
        log.warn("[research-run] no room to check the finished-change stock, so this drive buys no evidence and leaves the phase for the next one", { tenantId, phase, runway });
        return pause(); }
      // AN OPEN REPLENISH OBLIGATION NO LONGER ENDS THE DISPATCH (operator, 2026-08-30). The pause that lived here
      // ended every drive whose manifest had not exhausted before the discovery phases could run, so production's own
      // open queue starved the search for NEW opportunities, and while the drafting provider was out of credit it
      // starved the $0 work too. Finishing still outranks starting, by phase ORDER: this phase runs first and may
      // spend the whole drive; whatever runway survives it flows on to discovery instead of being handed back.
      const owedFacts = (r?.evidenceOwed ?? []).length > 0; // TYPED, never a regex over English (Codex, 2026-08-23): "No results page for X is on file" matched no phrase the old pattern knew, so the one reading that finishes the account's strongest page was never fetched.
      // AND THE DISPATCH GOES AND GETS IT (Codex, 2026-08-23). Storing the requirement, logging it and checking it as a boolean is not acquisition: the reading was never bought, so the next drive drafted from the same missing evidence. The exact search a funded candidate named is fetched HERE, through the transport the funnel already uses, whatever phase set this dispatch opened with. A reading that lands leaves the work resumable; one that does not stays owed with its own receipt and is never called settled.
      let remaining = [...(r?.evidenceOwed ?? [])]; // the persisted remainder shrinks as needs land: recomputing it from the pre-loop list re-listed the first landed need whenever a pass acquired two
      for (const need of (r?.evidenceOwed ?? []).slice(0, 2)) {
        const got = await steps.acquireEvidence(tenantId, need, basis || null, Math.max(20_000, Math.min(90_000, deadline - nowFn().getTime() - STOP_STARTING_MS))).catch(() => ({ acquired: false, detail: "the acquisition threw" }));
        log.info("[research-run] the exact reading a funded candidate was refused for", { tenantId, key: need.key, kind: need.kind, query: need.query, acquired: got.acquired, detail: got.detail });
        if (got.acquired) remaining = remaining.filter((n) => n.key !== need.key);
        progress = { ...progress, evidenceOwed: remaining };
        // WHAT LANDS IS USED AT ONCE. A reading banked and then left until tomorrow is the deadlock with an extra step
        // in it: the same invocation drafts against it, ONCE, and only for the work that asked (Codex, 2026-08-23).
        if (got.acquired) {
          // THE PAGE THAT JUST GAINED ITS EVIDENCE IS RETRIED FIRST, not last: `tried` ranks a page behind untried
          // work while its acquisition is IN FLIGHT, and leaving it there after the reading LANDED handed the very
          // next drive to unrelated candidates while the newly-informed page waited another day. Its key comes off
          // the retry list for this same-turn draft, so it ranks by its own impact again.
          const again = await steps.replenishReady(tenantId, nowFn(), { fingerprint: mem?.fingerprint ?? null, attempted: mem?.attempted ?? [], tried: (mem?.tried ?? []).filter((k) => k !== need.key) },
            nowFn().getTime() + Math.min(deadline - nowFn().getTime(), REPLENISH_BOX_MS) - STOP_STARTING_MS).catch(() => null);
          if (again) { r = again;
            // A SECOND REQUIREMENT RETURNED BY THE SAME-TURN DRAFT IS KEPT, NEVER LOST: `remaining` was rebuilt only
            // from the pre-loop list, so a fresh need the redraft minted (the next rung of its ladder) vanished from
            // the persisted debt and the deadlock reopened one acquisition later. Merge by key, newest wins.
            const fresh = again.evidenceOwed ?? [];
            remaining = [...remaining.filter((n) => !fresh.some((f) => f.key === n.key)), ...fresh];
            // AND THE REDRAFT'S OWN DAY MEMORY PERSISTS, exactly as the pre-acquisition drive's did: dropping it
            // meant the next dispatch re-funded and re-bought refusals this one already paid for.
            const closed2 = again.reason === "candidates_exhausted" ? again.reason : undefined;
            progress = { ...progress, evidenceOwed: remaining,
              replenish: { day: reportingDay(nowFn().getTime()), fingerprint: again.fingerprint, attempted: again.attempted, ...(again.tried && again.tried.length > 0 ? { tried: again.tried } : {}), ...(closed2 ? { closed: closed2 } : {}), ...(again.outcomes ? { outcomes: again.outcomes } : {}) } };
            // WRITTEN, NOT JUST ASSIGNED: the pause below ends the run through finishRun, which never writes progress, so the memory only exists if it is stored HERE.
            if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return "lost_lease";
            log.info("[research-run] the reading landed, so the work that asked for it was drafted in the same turn", { tenantId, key: need.key, ready: again.ready, reason: again.reason }); } }
      }
      // A reading still owed stays first in line next dispatch; it no longer ends this one (operator, 2026-08-30).
      // A DRIVE THAT OPENED ONLY FOR THE STOCK BUYS NO NEW RESEARCH EVIDENCE: no results page, no crawl, no answer. It DOES spend the bounded drafting allowance, which is the whole point of it. THE OBLIGATION OUTLIVES THE RUN: a stock still short stays owed in due-work, and a later dispatch that finds this run closed opens ANOTHER pass on that same due list, bounded by the day's own runaway ceiling.
      // A STOCK-ONLY RUN STILL EXECUTES THE READING A FUNDED CANDIDATE NAMED. Skipping straight on was the second half
      // of the deadlock: the requirement was raised, persisted, and then jumped over, so the next drive drafted from
      // the same missing evidence. Broad exploration still waits; this exact reading does not.
      if (stockOnly && !owedFacts) {
        const next = nextPlanned(nextPhase(phase), allowed ?? new Set<ResearchPhase>());
        if (!await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: null })) return "lost_lease";
        phase = next; cursor = null; continue;
      }
    }

    if (FUNNEL_PHASES.has(phase)) {
      // FREEZE THE INVESTIGATION ONCE PER RUN, durably, BEFORE a cent is spent: the ordered topic, the exact search it owes, the date it may next be retried and the basis it was chosen under, picked when this run first reaches the results-page phase and reused unchanged by winning-pages and the comparison, through advancePhase on the SAME phase. Only a REAL focus is frozen: an open run can span days, so one transient empty read must not silence it for that whole life. IDENTITY IS RECONCILED AND PERSISTED ON EVERY PHASE FIRST, not only when a plan is frozen, and A FAILURE PAUSES THIS SAME PHASE AND SPENDS NOTHING. THE READING IS BOUNDED PER RUN, NOT PER UNIT ITERATION: a phase iterates many times, so the marker rides run PROGRESS (the extraSamples pattern), persisted the moment an attempt is made, so a resumed run does not ask again; the plan this run froze rides along and is reviewed first.
      let asked = false;
      try { await steps.reconcileCases(tenantId, basis, { planKeys: (progress.focus?.topics ?? []).map((t) => t.topicKey).filter((k): k is string => !!k), maySynthesize: progress.synthesisAttempted !== true, mark: () => { asked = true; } }); }
      catch (error) { return pause({ phase, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), at: nowFn().toISOString() }); }
      if (asked) { progress = { ...progress, synthesisAttempted: true }; if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return "lost_lease"; }
      if (phase === "serp_analysis" && progress.focus == null) {
        const frozen = await steps.investigationFocus(tenantId, basis).catch(() => null);
        if (frozen && frozen.topics.length > 0) { progress = { ...progress, focus: frozen };
          if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return "lost_lease"; }
      }
      // One bounded evidence unit. advanced = keep iterating this phase, and the loop top RENEWS THE RUN LEASE before the next one (winning_pages splits itself there so its comparison spends on a freshly renewed lease); waiting = durable provider work is pending (pause honestly, resume next visit; NOT a failure and NOT completion); done = phase complete; failed = bounded pause.
      let unit: FunnelUnitOutcome;
      // The REAL run identity travels with the cursor: history rows carry this run's id, and the funnel's receipt resets per cycle instead of drifting.
      try { unit = await steps.funnelUnit(phase, tenantId, { ...(priorUnit ?? {}), basis, runId: run.id, cycle: run.cycle_key }, deadline - nowFn().getTime(), runFocus(progress)); }
      catch (error) { return pause({ phase, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), at: nowFn().toISOString() }); }
      // A state conflict persisted NOTHING, so the unit's counters are a stale snapshot (its per-run receipt read zero) and must never overwrite what this run already proved: DISCARD them either way. Then retry the SAME phase attempt exactly once (same run, lease owner, attempt key and unit cursor), because the re-invoked unit reloads canonical state and every cached call identity makes its provider work $0. A second conflict in a row pauses honestly. Narrowed to failed: no coded non-failed outcome retries.
      const conflicted = unit.status === "failed" && unit.code === "state_conflict";
      if (!conflicted) progress = { ...progress, funnel: { ...progress.funnel, ...unit.progress } };
      else if (conflictRetried !== phase) { conflictRetried = phase;
        log.warn("[research-run] research notes moved underneath the writer; retrying this phase once", { tenantId, phase });
        continue; } // loop top renews the SAME lease with the SAME attempt cursor
      const unitCursor = unit.cursor ? { ...attemptCursor, unit: unit.cursor } : { phase, attemptKey, seed: run.cycle_key };
      if (unit.status !== "done") {
        // THE CASE THE SPENDING CEILING STOPPED, recorded per case so a case receipt can say "I did not buy this one because the ceiling was reached", and scoped to the day it happened on. The marker rides run progress (an existing row, an existing column, no second store) and clears by day rollover, because a ceiling reached yesterday explains nothing about today.
        const capped = typeof unit.cursor?.cappedCase === "string" ? unit.cursor.cappedCase : null;
        if (capped) { const capDay = run.cycle_key.slice(-10), held = progress.capped?.day === capDay ? progress.capped.caseIds : [];
          progress = { ...progress, capped: { day: capDay, caseIds: [...new Set([...held, capped])].slice(0, 20) } }; }
        if (unit.status === "failed") progress = { ...progress, state: { ...progress.state, blocker: (unit.detail ?? "").slice(0, 300) || null } };
        // EVERY non-done outcome persists the SAME phase with its durable unit cursor FIRST, so nothing the unit achieved is stranded and a lost lease aborts here with no pause written. Then: advanced loops for the next unit (the loop top renews the lease first), waiting pauses with no error at all (a durable provider wait is not a failure), failed pauses with the unit's own bounded reason.
        if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: unitCursor })) return "lost_lease";
        if (unit.status === "advanced") { cursor = unitCursor; continue; }
        // THE SPENDING CAP IS A CEILING ON MONEY, NEVER A WALL ACROSS THE DAY. A refusal from our own money door used to pause the RUN here, so the $0 phases behind it (the decision pass and the publish) never ran and the queue sat stale until midnight: on 17 August the daily dollar did its job at $1.02 and the day's free work died with it. The cap's refusal DEGRADES instead: the blocker stays on the receipt, the paid phase ends where the money ended, and the free phases still run today. Keyed on our own door's wording; owed a structured code on the outcome.
        if (unit.status === "failed" && /spending cap|cap reached|cap refused|budget is spent|budget for this kind of work/i.test(unit.detail ?? "")) {
          const past = nextPhase(phase);
          log.info("[research-run] the spending cap ended paid evidence for today; the free phases continue", { tenantId, from: phase, to: past });
          if (!await advancePhase(tenantId, run.id, ownerToken, { phase: past, progress, cursor: null })) return "lost_lease";
          phase = past; cursor = null; continue; }
        return pause(unit.status === "waiting" ? null : { phase, message: (unit.detail ?? "evidence step could not finish").slice(0, 300), at: nowFn().toISOString() });
      }
      // THE BATCH IS NOT THE DAY. The unit answers for the window it was handed; the DAY is what the operator was promised, so a settled window RE-READS the canonical planner before this phase may move on. Unreadable pauses fail-closed, anything still owed keeps this same phase under a renewed lease, and only settled == intended advances, carrying the whole day's breakdown so completion reports the day and never the last batch.
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
      const collected = phase === "prompt_observations", nextAfterFunnel = nextPhase(phase); // done, and the day agrees: on to the next phase
      if (!await advancePhase(tenantId, run.id, ownerToken, { phase: nextAfterFunnel, progress, cursor: null })) return "lost_lease";
      phase = nextAfterFunnel; cursor = null;
      // WHAT WAS COLLECTED IS BANKED BEFORE ONE ANSWER IS READ. The reading used to sit between the settled observation unit and this advance, so the hosting ceiling killing it half way lost the phase move and the day's own counters with it: on 13 August ten dispatches in a row died at exactly 300 seconds, one run held this phase for five and a half hours with all 140 answers stored and settled, and every surface still read 0 of 140 because each write that would have said otherwise sat behind the reading. The advance above LANDED first, so a reading that cannot finish now leaves the phase moved, the day's counts recorded and the analyses OWED, which is exactly what due-work's analyze_answers reopens a pass for; the answers are already bought, so nothing is ever re-bought to read them. It spends money, so it runs on the lease that advance just extended, it is bounded by what is left of this turn, and its counters go down at once so the row says what this turn did even if the turn ends here.
      if (collected && roomToRead()) { slices -= 1; await readAnswersBack();
        if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: null })) return "lost_lease"; }
      continue;
    }

    // THE WEBSITE, READ UNTIL THERE IS NOTHING LEFT TO READ. One bounded batch per pass meant an account holding two hundred pages nobody had opened waited most of a year for its own inventory, which is not the product. The phase REPEATS its batch now, each round under a lease renewed at the loop top (a crawl is a real fetch, so it never runs on an unrenewed lease), until a batch reads nothing at all, the round cap stops it, or the pass runs out of time. A batch that reads nothing is the honest terminal answer (every page crawled, blocked with a retry date, unsupported, gone, or deferred by a bound on file) and the durable inventory keeps the whole score, so nothing here remembers anything between passes.
    if (phase === "crawl_pages") {
      let read = 0;
      try { read = await steps.crawlPages(tenantId, nowFn()); }
      catch (error) { return pause({ phase, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), at: nowFn().toISOString() }); }
      if (read > 0) log.info("[research-run] read more of your website", { tenantId, pages: read });
      const again = read > 0 && (crawlRounds += 1) < MAX_CRAWL_ROUNDS, next = again ? phase : nextPhase(phase);
      if (!await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: again ? attemptCursor : null })) return "lost_lease";
      phase = next; cursor = again ? attemptCursor : null; continue;
    }

    // VERIFY BEFORE ANYTHING IS PUBLISHED OFF IT (verify_and_measure). A change the operator marked as done is a claim until I have read their page, and Results answers "did Beacon verify it on the live website" off exactly this. It runs here, in front of the surface build, under the lease this loop just renewed: bounded to three pages, free (owned reads on the polite-fetch path, never a provider), and fail-soft, because a page I could not read must not pause a pass.
    if (phase === "publish_surface" && work.due.includes("verify_and_measure")) {
      const verified = await steps.verifyShipments(tenantId, nowFn()).catch(() => 0);
      if (verified > 0) log.info("[research-run] checked what you marked as done on your live pages", { tenantId, verified });
      // AND THEN THE READING ITSELF. Verifying was only ever the first half: measuring is what turns a verified change into a won or lost verdict, and it fired ONLY from a Results render, so an account holding sixteen changes whose windows had closed could never settle one of them without somebody opening the page. It runs here, under the same renewed lease, right after the verification it depends on: free (Search Console and Analytics are already synced), bounded per pass, fail-soft, and it rebuilds the Results surface itself when a reading actually moved, so the first view serves the fresh truth.
      const measured = await steps.measureShipments(tenantId, nowFn()).catch(() => 0);
      if (measured > 0) log.info("[research-run] read how what you shipped is doing", { tenantId, measured });
    }

    let outcome: PhaseOutcome;
    try {
      outcome = await runPhase(phase, tenantId, nowFn(), progress, attemptKey, steps, { remainingMs: () => Math.max(0, deadline - nowFn().getTime()), renew: () => renewLease(tenantId, run.id, ownerToken, attemptCursor).then((h) => !!h).catch(() => false) });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      log.warn("[research-run] phase threw; pausing (recoverable)", { tenantId, phase, error: message });
      return pause({ phase, message, at: nowFn().toISOString() });
    }
    if (outcome.pause) {
      log.warn("[research-run] phase reported failures; pausing (recoverable)", { tenantId, phase, failures: outcome.pause.failures?.length ?? 0 });
      // Persist the partial success (the providers that DID sync) durably BEFORE pausing, at the SAME phase with the SAME attempt cursor, so a mixed attempt never strands its succeeded sources. If our lease was lost, abort with no finish call.
      const saved = await advancePhase(tenantId, run.id, ownerToken,
        { phase, progress: { ...outcome.progress, state: { ...outcome.progress.state, blocker: outcome.pause.message } }, cursor: attemptCursor });
      if (!saved) return "lost_lease";
      return pause(outcome.pause);
    }
    progress = outcome.progress;
    // THE DECIDE WATERMARK. A pass that reached the end of the decision step stamps the basis and the research-notes version it consumed, published or not: in both cases it looked and concluded. Notes that move PAST this are new evidence, which is what makes another pass the same day worth its money instead of a repeat. It is read here, after this pass's own writes, so a pass never counts its own discovery as somebody else's news and re-opens itself forever.
    if (phase === "publish_surface" && basis) {
      const version = await steps.evidenceVersion(tenantId, basis).catch(() => null);
      if (version != null) progress = { ...progress, decided: { basis, rowVersion: version } };
    }

    const next = nextPhase(phase); // advancing replaces the cursor (clears the completed phase's attempt identity)
    if (!await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: null })) return "lost_lease"; // our lease was recovered by another instance
    phase = next; cursor = null;
  }

  // Reached only when every phase succeeded or was a healthy no-op, and COMPLETED is what the finish landed, never what this loop believes it did.
  return complete(progress);
}

/** DRIVE A RUN THIS CALLER ALREADY HOLDS THE LEASE ON. The one entry both doors go through: the daily scheduler hands it a run claimed by claim_due_research_work, a visit hands it the run claimed here. It never claims and never re-leases, so there is exactly one orchestrator and no second copy of it. NOTHING DUE, NOTHING SPENT. A pass that opened with a readable and empty due list closes right here at $0 rather than walking seven phases to discover the same thing. Only a pass at its very first phase may close this way: a RESUMED run carries work of its own (a half-finished backfill, a unit cursor) that due-work does not speak for. IT RETURNS WHAT IT DURABLY LEFT BEHIND. Returning normally used to be the only answer it gave, so a pause, a provider wait and a lost lease were indistinguishable from a finished day and the daily dispatch counted every one of them as a success. The visit door may still ignore the receipt; the dispatch must not. */
export async function driveClaimed(run: ResearchRun, ownerToken: string, work: DueWork | null, nowFn: () => Date, deadline: number, steps: ResearchCycleSteps): Promise<DriveReceipt> {
  const tenantId = run.tenant_id;
  const fresh = run.current_phase === "refresh_sources" && run.phase_cursor == null;
  if (fresh && work != null && work.readable && work.due.length === 0) {
    log.info("[research-run] nothing is due; closing the pass at zero cost", { tenantId, nextDueAt: work.nextDueAt });
    // The numbers go down BEFORE the close, on the same row, so a finished-with-nothing-owed pass can still tell the operator what it checked and the date the waiting ends. A pass that closes silently looks identical to one that never ran.
    await advancePhase(tenantId, run.id, ownerToken, { phase: run.current_phase, cursor: null, progress: { ...(run.progress ?? {}),
      state: { ...(run.progress?.state ?? {}), checksDone: work.checks.done, checksTotal: work.checks.total,
        checksAnswers: work.checks.answers, checksUnavailable: work.checks.unavailable, checksUnsupported: work.checks.unsupported,
        casesActive: work.cases.active, casesParked: work.cases.parked, nextDueAt: work.nextDueAt, blocker: null } } });
    return (await finishRun(tenantId, run.id, ownerToken, "completed", null, Number(run.progress?.funnel?.spendUsd) || 0)) ? "completed" : "failed"; // and it stamps 0 rather than leaving the spend column silent: zero spend is a fact about this pass, never a missing number
  }
  return driveRun(run, ownerToken, nowFn, deadline, steps,
    work ?? { due: [], readable: false, checks: { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 }, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null });
}

/** How many EXTRA same-day passes THE VISIT DOOR may open for one account. A visit is a chance, not a debt: every navigation is another opportunity to open one, so this door keeps the eight it was sized for. The daily dispatch carries its own allowance (it claims first, and opens a recovery pass only for a day left short), and the day's absolute runaway stop inside research-run still bounds every door together. */
const VISIT_EXTRA_PASSES_PER_DAY = 8;
/** THE VISIT DOOR: claim, resume, or start the account's Research Run and drive it. A DAY IS NOT A UNIT OF WORK: a refused claim asks the one free question that matters (due-work, from persisted state alone) and opens another pass only when something is genuinely due. FAIL CLOSED both ways: an unreadable state opens nothing, an empty one opens nothing at $0, and a pass that opens with nothing due closes immediately. */
export async function runResearchCycle(tenantId: string, options: ResearchCycleOptions = {}): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? RESEARCH_CYCLE_DEADLINE_MS;
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const deadline = nowFn().getTime() + deadlineMs;

  // Slice 5 pre-activation gate: no research work runs before an account is active, and none runs unless the pause switch READS as running. FAIL CLOSED: a missing/unknown account, any read error, and a switch that could not be read at all are each a no-op (logged), never a claim. claim_research_run carries NEITHER guard (the fleet enumeration does), so this is the whole gate on the visit door, and the money is spent past it.
  const account = await getTenant(tenantId).catch(() => null);
  if (!account || account.status !== "active") {
    log.debug("[research-run] skipped: account not active (no research before activation)", { tenantId, status: account?.status ?? "unknown" }); return; }
  const permission = await researchPermission(tenantId);
  if (permission !== "running") { log.debug(permission === "paused" ? "[research-run] skipped: research is paused for this account"
    : "[research-run] skipped: permission could not be verified, because the research pause switch could not be read", { tenantId }); return; }

  await runWithTenant(tenantId, async () => {
    const ownerToken = newOwnerToken();
    const now = nowFn();
      // A claim that FAILED (the database could not answer) is not a claim that was refused: it ends the visit here, with no pass and no due-work question.
    let run = await claimRun(tenantId, ownerToken).catch(() => "unavailable" as const);
    if (run === "unavailable") return;
    const work = await steps.dueWork(tenantId, now).catch(() => null);
    if (run == null) {
      // Refused: either another instance holds the open run, or a pass already completed today. Only a POSITIVE due signal opens a second pass, and the one-open-run index still refuses it while any run is unfinished, so the "held elsewhere" case cannot slip through this door.
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

/* continueResearch DELETED (operator program, 2026-08-30): exported with zero callers once the arrival rule made the layout the one visit trigger, and the operator declined the paid-press control it existed for. The scheduler and the arrival door are the two ways research runs; a third door with no button was bloat wearing an export. */

/** Schedule one post-response Research Run from the app shell. Every navigation may call this; the DATABASE lease (not any in-memory guard) prevents two instances from both advancing the cycle. after() is only valid in a request scope, so tests and scripts get a safe no-op. A visit may not open a pass this account cannot pay for: see visitMayOpenResearch in due-work. */
export function ensureResearchRunOnVisit(tenantId: string, arrival: boolean): void {
  if (!tenantId || !arrival) return; // arrival is a REQUIRED argument so no caller can silently re-arm research from a repaint
  try {
    after(async () => {
      try {
        const may = await visitMayOpenResearch(tenantId); if (!may.allowed) return void log.info("[research-run] no paid research opened by this visit", { tenantId, reason: may.reason }); // the MONEY gate on this door; researchPermission is the CONSENT one
        await runResearchCycle(tenantId);
      } catch (error) {
        log.warn("[research-run] cycle failed (non-blocking)", { tenantId, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      }
    });
  } catch {
    // after() outside a request scope - no-op.
  }
}
