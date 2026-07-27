import "server-only";

import { after } from "next/server";

import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
import { basisTag, getTenant, loadBusinessProfile } from "@/domains/account";
import {
  keywordDiscoveryUnit, promptObservationUnit, serpAnalysisUnit, winningPagesUnit,
  type FunnelUnitOutcome,
} from "@/domains/evidence";
import { continueDeepBackfillIfStarted } from "@/lib/connectors/gsc/deep-backfill";
import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { warmFreeSurfaces } from "./warm-caches"; import { topInvestigationQueries } from "./investigation-queries";
import {
  advancePhase,
  claimRun,
  finishRun,
  newOwnerToken,
  phaseIdempotencyKey,
  renewLease,
  type ResearchPhase,
  type ResearchRun,
  type ResearchRunError,
  type ResearchRunProgress,
} from "../research-run";

/**
 * on-visit-refresh - the Research Run executor (Slice 4, 2026-07-24).
 *
 * Every navigation schedules ONE post-response Research Run for the tenant. The run is durable:
 * claim_research_run RESUMES the account's single unfinished run first (regardless of its start date, so
 * yesterday's paused run is never abandoned and no second open run is created), blocks a redundant pass when
 * one completed earlier this UTC day, and starts a fresh daily cycle only when no run is open. It leases the
 * run so exactly one invocation advances it, and the persisted phase + progress let a crash or lambda timeout
 * resume where it left off. No scheduler, cron, heartbeat, in-memory dedupe, or job queue: the DATABASE lease
 * is the whole correctness mechanism (a concurrent claim with a different owner token returns null).
 *
 * TRUTH BOUNDARY (Slice 4 truth-and-lease repair): a phase advances ONLY when it
 * truly succeeded or was a healthy no-op. Every failure pauses the cycle with a
 * bounded last_error and never reaches completion:
 *   1. refresh_sources     - refresh stale connectors. sourcesRefreshed counts ONLY the sources that
 *                            actually synced. ANY per-source failure pauses here (the succeeded ones keep
 *                            their freshness stamps, so a retry targets only the rest). Zero stale sources
 *                            is a healthy no-op that advances. A THROW (refresh could not run) pauses too.
 *   2. gsc_backfill_chunk  - advance one bounded GSC deep-backfill chunk. The chunk is bounded BY DESIGN
 *                            (deep-backfill.ts sizes it to a serverless window), so we run it to that bound
 *                            rather than racing a deadline the GSC fetch cannot honour (no AbortSignal). An
 *                            advance or a benign skip advances; a real error THROWS and pauses with the
 *                            cursor untouched (deep-backfill never advances on a failed pull), so the retry
 *                            is the same window.
 *   3. publish_surface     - rebuild + publish the Today/Changes release when phase 1 refreshed >=1 source,
 *                            phase 2 advanced a chunk, or the saved release is genuinely stale
 *                            (evidence-conditioned, never day-gated). surfacePublished is true ONLY after
 *                            publishSurface RESOLVES; a THROW pauses here and the previously saved surface
 *                            stays visible (the retry rebuilds from truth).
 *
 * IDEMPOTENCY: before each phase's side effect we persist the phase attempt identity (phase, a deterministic
 * attemptKey, the seed) via renew_research_lease, which also renews the lease, and hand the executor that
 * attemptKey. A retry of the same run+phase reuses the PERSISTED key; advancing clears the cursor, so the
 * next phase mints its own. The run's frozen priority queries ride on PROGRESS for exactly that reason.
 *
 * CONFLICT: an evidence unit reporting the structured `state_conflict` code persisted
 * NOTHING, so its counters are DISCARDED (a stale zeroed receipt must never overwrite
 * proven spend) and the SAME phase attempt is re-invoked ONCE under the same lease,
 * attempt key and unit cursor - the unit reloads canonical state and its cached call
 * identities keep the retry $0. A second conflict in a row pauses honestly. Nothing
 * else retries: blocked, waiting, capped and lost-lease behaviour are untouched.
 *
 * LEASE: renewed at DATABASE time BEFORE every bounded phase, so no phase inside the 210s cycle deadline can
 * knowingly outlive its 240s lease. A false return from renewLease / advancePhase / finishRun means the lease
 * was lost or expired: abort immediately with no further side effects (pre-phase renew aborts before it).
 */

/** Leave enough of the shell's 300-second lifetime to finish the surface build. */
export const RESEARCH_CYCLE_DEADLINE_MS = 210_000;

/** Reasons the deep-backfill continuation returns when there is simply nothing to
 *  do (no backfill started, already finished, or no synced property yet). These
 *  are healthy no-ops for every tenant that never started a backfill; they advance
 *  the phase without a failure. Any OTHER reason is a real error and throws. */
const BENIGN_BACKFILL_SKIPS = new Set(["not_started", "already_complete", "no_synced_property", "no_cursor"]);

/** The ordered execution phases (excluding the terminal `done`). */
const PHASE_SEQUENCE: ResearchPhase[] = [
  "refresh_sources", "gsc_backfill_chunk", "keyword_discovery",
  "prompt_observations", "serp_analysis", "winning_pages", "publish_surface",
];
/** The four Slice 6 evidence phases, each backed by one funnel unit executor. */ const FUNNEL_PHASES = new Set<ResearchPhase>(["keyword_discovery", "prompt_observations", "serp_analysis", "winning_pages"]);

/** The refresh_sources phase outcome: how many sources were attempted, the
 *  identities of the ones that actually synced, and the bounded per-source failure
 *  detail for the rest. `succeeded` is a list of provider identities (not a count)
 *  so retries can UNION distinct successes rather than double-count them. */
export type RefreshSourcesResult = {
  attempted: number;
  succeeded: string[];
  failures: Array<{ provider: string; detail: string }>;
};

/** The gsc_backfill_chunk phase outcome. `advanced` = a chunk pulled (or the
 *  backfill defensively completed); `no_work` = a benign skip. A real error is a
 *  THROW, never a value. */
export type BackfillChunkResult = { kind: "advanced"; complete?: boolean; daysPulled?: number } | { kind: "no_work" };

/** Injectable phase bodies + clock/deadline so the runner is testable with a
 *  short budget and stub executors; production passes nothing and uses the real
 *  implementations below. Every executor receives the persisted attemptKey so a
 *  retry can prove it is the same unit of work. */
export type ResearchCycleSteps = {
  refreshSources: (tenantId: string, now: Date, attemptKey: string) => Promise<RefreshSourcesResult>;
  backfillChunk: (tenantId: string, now: Date, attemptKey: string) => Promise<BackfillChunkResult>;
  /** The four Slice 6 evidence executors (evidence facade), one per funnel phase. */
  funnelUnit: (phase: ResearchPhase, tenantId: string, cursor: Record<string, unknown> | null, budgetMs: number, priorityQueries: string[]) => Promise<FunnelUnitOutcome>;
  /** THIS run's investigation priorities, asked for ONCE (Runtime asks Decision, Evidence gets strings). */
  investigationPriorities: (tenantId: string) => Promise<string[]>;
  /** The account's CURRENT onboarding basis (the one Account fingerprint); the
   *  funnel scopes every derived read/write to it. Null = not resolvable. */
  currentBasis: (tenantId: string) => Promise<string | null>;
  publishSurface: (tenantId: string, attemptKey: string) => Promise<void>;
  surfaceStale: (tenantId: string, nowMs: number) => Promise<boolean>;
};

export type ResearchCycleOptions = {
  now?: () => Date;
  deadlineMs?: number;
  steps?: Partial<ResearchCycleSteps>;
};

const defaultSteps: ResearchCycleSteps = {
  async refreshSources(tenantId, now) {
    // autoRefreshStaleConnectorsForTenant is fail-soft PER SOURCE and returns one
    // { ok } result per ATTEMPTED stale source. We count ONLY the ok:true ones as
    // refreshed; any ok:false is a bounded failure the runner pauses on. We do NOT
    // .catch here: a THROW means the whole refresh could not run, and the runner
    // must pause rather than record a false "0 sources, all healthy".
    const results = await autoRefreshStaleConnectorsForTenant(tenantId, now);
    const succeeded = results.filter((r) => r.ok).map((r) => String(r.provider));
    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({ provider: String(r.provider), detail: String(r.detail).slice(0, 200) }));
    return { attempted: results.length, succeeded, failures };
  },
  async backfillChunk(tenantId, now) {
    // No deadline race: the chunk is bounded by design and its GSC fetch has no
    // AbortSignal, so a race would release the lease while live side-effecting
    // work kept running. continueDeepBackfillIfStarted converts a thrown error
    // into { ran:false, reason }, so a non-benign reason here is a real failure.
    const result = await continueDeepBackfillIfStarted(tenantId, now);
    if (result.ran) {
      log.info("[research-run] gsc deep backfill chunk advanced", {
        tenantId,
        daysPulled: result.daysPulled,
        complete: result.complete,
      });
      return { kind: "advanced", complete: result.complete, daysPulled: result.daysPulled };
    }
    if (BENIGN_BACKFILL_SKIPS.has(result.reason)) return { kind: "no_work" };
    // A real failure (auth / quota / network / unexpected): throw so the runner
    // pauses AT gsc_backfill_chunk. deep-backfill leaves its cursor untouched on a
    // failed pull, so the retry is the identical window.
    throw new Error(`gsc backfill chunk did not advance: ${result.reason}`.slice(0, 200));
  },
  async currentBasis(tenantId) {
    try {
      const account = await getTenant(tenantId);
      if (!account?.domain?.trim()) return null;
      const profile = await loadBusinessProfile(tenantId);
      return basisTag(account.id, account.domain.trim(), profile, account.growth_goal ?? null);
    } catch {
      return null;
    }
  },
  async investigationPriorities(tenantId) {
    return topInvestigationQueries(tenantId).catch(() => [] as string[]);
  },
  async funnelUnit(phase, tenantId, cursor, budgetMs, priorityQueries) {
    // An OPEN INVESTIGATION needs BOTH halves of its evidence: the results page for that
    // exact search AND the pages that actually win it. The list is the RUN's, frozen by
    // the caller, never re-resolved here: landing a results page closes that search, so a
    // second lookup handed winning-pages a different three than the ones just paid for.
    if (phase === "serp_analysis" || phase === "winning_pages") {
      return (phase === "serp_analysis" ? serpAnalysisUnit : winningPagesUnit)({}, priorityQueries)(tenantId, cursor, budgetMs);
    }
    const fn = {
      keyword_discovery: keywordDiscoveryUnit,
      prompt_observations: promptObservationUnit,
    }[phase as "keyword_discovery" | "prompt_observations"];
    return fn()(tenantId, cursor, budgetMs); // each facade export is a deps factory returning the executor
  },
  async publishSurface(tenantId) {
    // warmFreeSurfaces now PROPAGATES failure (no internal swallow): a throw here
    // pauses publish_surface and the previously saved surface stays visible.
    await warmFreeSurfaces(tenantId);
  },
  async surfaceStale(tenantId, nowMs) {
    const { readCustomerSurface, isCustomerSurfaceStale } = await import("@/app/(shell)/surface-release");
    const surface = await readCustomerSurface(tenantId).catch(() => null);
    if (surface == null) return true; // no saved release yet → genuinely needs a first publish
    return isCustomerSurfaceStale(surface.computedAt, nowMs);
  },
};

/** Distinct values in first-seen order (small provider lists; order is cosmetic). */
function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** One phase's outcome: the merged progress, plus an optional `pause` error when
 *  the phase reported a recoverable failure that is NOT a throw (a partial
 *  connector refresh). A thrown error is handled separately by the cycle loop. */
type PhaseOutcome = { progress: ResearchRunProgress; pause?: ResearchRunError };

/** Run one phase's body, returning the merged progress (and any returned-failure
 *  pause). Throws propagate to the cycle loop, which records the error and pauses. */
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
    // Union the freshly-synced provider identities with any that synced on an
    // earlier attempt of this same cycle, so a provider that failed once and later
    // succeeded is counted EXACTLY once. Failed providers are never added.
    const refreshedProviders = dedupe([...(progress.refreshedProviders ?? []), ...result.succeeded]);
    const next = { ...progress, refreshedProviders, sourcesRefreshed: refreshedProviders.length };
    if (result.failures.length > 0) {
      // Some connected sources failed to refresh: pause at refresh_sources with a
      // bounded receipt. The succeeded ones kept their freshness stamps, so the
      // retry targets only the remaining stale/failed sources. Do NOT publish off
      // a failed refresh.
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
  // surfacePublished is true ONLY after publishSurface RESOLVES; a throw pauses
  // here. When there is nothing to publish, advance with surfacePublished:false.
  if (shouldPublish) await steps.publishSurface(tenantId, attemptKey);
  return { progress: { ...progress, surfacePublished: shouldPublish } };
}

/** The next phase after `phase` in the sequence, or `done`. */
function nextPhase(phase: ResearchPhase): ResearchPhase {
  const i = PHASE_SEQUENCE.indexOf(phase);
  return i < 0 || i + 1 >= PHASE_SEQUENCE.length ? "done" : PHASE_SEQUENCE[i + 1]!;
}

/** Read-or-create the attempt identity for a phase. An interrupted retry of the
 *  same run+phase reuses the PERSISTED attemptKey (proving it is the same unit of
 *  work); a fresh phase mints a deterministic key. The seed is the cycle key: the
 *  run+phase scope already makes the key unique per attempt, and it needs no extra
 *  I/O (the persisted backfill cursor date is not cheaply available here). */
function resolveAttemptKey(
  tenantId: string,
  runId: string,
  cycleKey: string,
  phase: ResearchPhase,
  cursor: Record<string, unknown> | null,
): string {
  if (cursor != null && cursor.phase === phase && typeof cursor.attemptKey === "string") {
    return cursor.attemptKey;
  }
  return phaseIdempotencyKey(tenantId, runId, phase, { seed: cycleKey });
}

/**
 * Execute the claimed run from its current_phase to done, or pause durably. The
 * DATABASE lease we hold (via ownerToken) is renewed BEFORE every phase; if a
 * renew / advance / finish reports our lease was lost, we abort immediately.
 */
async function driveRun(
  run: ResearchRun,
  ownerToken: string,
  nowFn: () => Date,
  deadline: number,
  steps: ResearchCycleSteps,
): Promise<void> {
  const tenantId = run.tenant_id;
  let progress: ResearchRunProgress = run.progress ?? {};
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

    // Persist the phase attempt identity + renew the lease BEFORE the side effect.
    // Funnel phases carry their durable unit cursor forward inside the attempt cursor.
    const attemptKey = resolveAttemptKey(tenantId, run.id, run.cycle_key, phase, cursor);
    const priorUnit = cursor?.phase === phase && cursor.unit != null ? (cursor.unit as Record<string, unknown>) : null;
    const attemptCursor: Record<string, unknown> = { phase, attemptKey, seed: run.cycle_key, ...(priorUnit ? { unit: priorUnit } : {}) };
    const held = await renewLease(tenantId, run.id, ownerToken, attemptCursor);
    if (!held) return; // lease lost/expired → abort BEFORE any side effect
    cursor = attemptCursor;

    if (FUNNEL_PHASES.has(phase)) {
      // FREEZE THE PRIORITIES ONCE PER RUN, durably, BEFORE a cent is spent: chosen when this run first
      // reaches the results-page phase and reused unchanged by winning-pages, so the searches Beacon pays to
      // look up are the ones it then reads competitors for. Persisted through advancePhase on the SAME phase.
      // Only a REAL list is frozen: an open run can span days, so one transient empty read must not silence
      // its priorities for that whole life. Empty stays unfrozen and both units keep the broad agenda, which
      // is coherent either way because winning-pages never resolves a list of its own.
      if (phase === "serp_analysis" && progress.priorityQueries == null) {
        const frozen = await steps.investigationPriorities(tenantId).catch(() => [] as string[]);
        if (frozen.length > 0) { progress = { ...progress, priorityQueries: frozen };
          if (!await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: attemptCursor })) return; }
      }
      // One bounded evidence unit. advanced = keep iterating this phase; waiting =
      // durable provider work is pending (pause honestly, resume next visit; NOT a
      // failure and NOT completion); done = phase complete; failed = bounded pause.
      let unit: FunnelUnitOutcome;
      try {
        // Every funnel unit runs under the account's CURRENT basis; a change in
        // website/profile/goal mints a new basis and strands prior derived state.
        const basis = await steps.currentBasis(tenantId);
        // The REAL run identity travels with the cursor: history rows carry this
        // run's id, and the funnel's receipt resets per cycle instead of drifting.
        unit = await steps.funnelUnit(phase, tenantId, { ...(priorUnit ?? {}), ...(basis ? { basis } : {}), runId: run.id, cycle: run.cycle_key },
          deadline - nowFn().getTime(), progress.priorityQueries ?? []);
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        await finishRun(tenantId, run.id, ownerToken, "paused", { phase, message, at: nowFn().toISOString() });
        return;
      }
      // A state conflict persisted NOTHING, so the unit's counters are a stale snapshot
      // (its per-run receipt read zero) and must never overwrite what this run already
      // proved: DISCARD them either way. Then retry the SAME phase attempt exactly once
      // - same run, same lease owner, same attempt key, same unit cursor - because the
      // re-invoked unit reloads canonical state and every cached call identity makes its
      // provider work $0. A second conflict in a row pauses honestly with the same copy.
      // Narrowed to failed: a coded non-failed outcome must never enter the retry loop.
      const conflicted = unit.status === "failed" && unit.code === "state_conflict";
      if (!conflicted) progress = { ...progress, funnel: { ...progress.funnel, ...unit.progress } };
      else if (conflictRetried !== phase) {
        conflictRetried = phase;
        log.warn("[research-run] research notes moved underneath the writer; retrying this phase once", { tenantId, phase });
        continue; } // loop top renews the SAME lease with the SAME attempt cursor
      const unitCursor = unit.cursor ? { ...attemptCursor, unit: unit.cursor } : { phase, attemptKey, seed: run.cycle_key };
      if (unit.status === "failed") {
        const saved = await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: unitCursor });
        if (!saved) return;
        await finishRun(tenantId, run.id, ownerToken, "paused", {
          phase, message: (unit.detail ?? "evidence step could not finish").slice(0, 300), at: nowFn().toISOString(),
        });
        return;
      }
      if (unit.status === "waiting") {
        const saved = await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: unitCursor });
        if (!saved) return;
        await finishRun(tenantId, run.id, ownerToken, "paused"); // honest resumable wait, no error
        return;
      }
      if (unit.status === "advanced") {
        const saved = await advancePhase(tenantId, run.id, ownerToken, { phase, progress, cursor: unitCursor });
        if (!saved) return;
        cursor = unitCursor;
        continue; // same phase, next unit (deadline check at loop top)
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
      // Persist the partial success (the providers that DID sync) durably BEFORE
      // pausing, at the SAME phase with the SAME attempt cursor, so a mixed attempt
      // never strands its succeeded sources. If our lease was lost, abort with no
      // finish call.
      const saved = await advancePhase(tenantId, run.id, ownerToken, {
        phase,
        progress: outcome.progress,
        cursor: attemptCursor,
      });
      if (!saved) return;
      await finishRun(tenantId, run.id, ownerToken, "paused", outcome.pause);
      return;
    }
    progress = outcome.progress;

    const next = nextPhase(phase);
    // Advancing replaces the cursor (clears the completed phase's attempt identity).
    const advanced = await advancePhase(tenantId, run.id, ownerToken, { phase: next, progress, cursor: null });
    if (!advanced) return; // our lease was recovered by another instance - abort, no side effects
    phase = next;
    cursor = null;
  }

  // Reached only when all three phases succeeded or were healthy no-ops.
  await finishRun(tenantId, run.id, ownerToken, "completed");
}

/**
 * Claim, resume, or start the account's Research Run and drive it. The claim
 * resumes any unfinished run first (any date); a lost claim (null) means another
 * instance holds the open run, or research already completed this UTC day - do
 * nothing.
 */
export async function runResearchCycle(tenantId: string, options: ResearchCycleOptions = {}): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? RESEARCH_CYCLE_DEADLINE_MS;
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const deadline = nowFn().getTime() + deadlineMs;

  // Slice 5 pre-activation gate: no research work runs before an account is
  // active. FAIL CLOSED: a missing/unknown account, or any read error, is a
  // no-op (logged), never a claim. The database claim_research_run RPC carries
  // the same active-account guard; this is the runtime-level mirror so we never
  // even reach the claim for a pending account.
  const account = await getTenant(tenantId).catch(() => null);
  if (!account || account.status !== "active") {
    log.debug("[research-run] skipped: account not active (no research before activation)", {
      tenantId,
      status: account?.status ?? "unknown",
    });
    return;
  }

  await runWithTenant(tenantId, async () => {
    const ownerToken = newOwnerToken();
    const run = await claimRun(tenantId, ownerToken);
    if (run == null) {
      log.debug("[research-run] no claim (held elsewhere or complete today)", { tenantId });
      return;
    }
    await driveRun(run, ownerToken, nowFn, deadline, steps);
  });
}

/**
 * Schedule one post-response Research Run from the app shell. Every navigation
 * may call this; the DATABASE lease (not any in-memory guard) prevents two
 * instances from both advancing the cycle. after() is only valid in a request
 * scope, so tests and scripts get a safe no-op.
 */
export function ensureResearchRunOnVisit(tenantId: string): void {
  if (!tenantId) return;
  try {
    after(async () => {
      try {
        await runResearchCycle(tenantId);
      } catch (error) {
        log.warn("[research-run] cycle failed (non-blocking)", {
          tenantId,
          error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
      }
    });
  } catch {
    // after() outside a request scope - no-op.
  }
}
