import "server-only";

/**
 * warm-caches (2026-07-02, BEACON 500 item 13) - the nightly precompute pass.
 *
 * At ~5am Pacific the cron warms everything the operator opens first thing in
 * the morning, so the first visit is instant AND full: the demand-graph
 * snapshot, the /changes SWR surface, tonight's daily plan preview, and the
 * Today SWR surface. This is a WARM CACHE pass, not a behavior change - the
 * on-demand posture stays for refresh, and every step calls the EXISTING
 * loader/builder (zero business logic lives here; composition only).
 *
 * Step order matters and is pinned by tests:
 *   1. demand-graph        - the shared graph snapshot every surface reads
 *   2. worklist-surface    - built FROM the fresh graph
 *   3. plan-preview        - ensure tonight's plan exists (skip when it does)
 *   4. coverage-map        - reads the graph snapshot; no separate store
 *   5. displacement-check  - BEACON 500 item 82 (2026-07-02): a LOSS reflex,
 *                            not a cache warm. Finds money queries that fell
 *                            3+ Google positions vs a week ago and spends AT
 *                            MOST 3 capped live checks per tenant per night
 *                            through the existing runSerpQuery gauntlet
 *                            (untouched here). Isolated step: a failure or a
 *                            capped/dry-run outcome never affects the 5 warm
 *                            steps above it. See displacement-check.ts.
 *   6. serp-steal-lane     - DREAM SITE V1 item D3 (2026-07-02): the GAIN
 *                            mirror of displacement-check. Finds GSC keywords
 *                            where we rank 4-20 with real impressions,
 *                            resolves each one's Google top-5 (a stored
 *                            dataforseo_serp_history row first, then AT MOST
 *                            5 capped live runSerpQuery calls per tenant per
 *                            night), tears the best result down through the
 *                            existing competitor-page-audit cache, and
 *                            persists a steal brief per keyword. Isolated
 *                            step, same posture as displacement-check - a
 *                            failure here never affects any step above it.
 *                            See serp-steal-lane.ts.
 *   7. native-teardown     - DREAM SITE V1 item D2 (2026-07-02): reads the
 *                            top-cited pages per NATIVE poll prompt (up to 10
 *                            prompts/night), politely tears them down (FREE,
 *                            14d cached, same cache as the other teardown
 *                            lanes), extracts what the winners share
 *                            (teardown-commonality.ts), and routes each
 *                            prompt to an atomic-edit or new-page verdict
 *                            (teardown-commonality-verdict.ts). $0 spend
 *                            (polite fetch only, no paid API). Isolated +
 *                            fail-soft, same posture as displacement-check
 *                            and serp-steal-lane. See
 *                            native-teardown-runner.ts.
 *   8. prepare-ahead       - R20 (D6 dynamic auto-mode): PREPARE-ahead only,
 *                            gated on the operator's prepare-ahead-overnight
 *                            toggle (autopilot config, DEFAULT OFF). Off ->
 *                            a byte-identical skip (nightly path unchanged).
 *                            On -> drafts + SERP-checks the top Moves so the
 *                            morning queue is already prepared. NEVER
 *                            publishes (publishing waits for the operator, or
 *                            the separate publish-autopilot switch). Capped +
 *                            cache-first (a warm cache is $0), isolated +
 *                            fail-soft. See prepare-today-moves.ts.
 *   9. today-surface       - built LAST, after the plan and prepared drafts,
 *                            so the first render sees the completed pass.
 *
 * Money posture (verified in the callees, none edited here):
 *   - graph/changes/today loaders are cached/durable reads only ($0).
 *   - build-today-preview's paid paths are all gated: the LLM passes run only
 *     when BEACON_LLM_PROVIDER=openai AND the fail-closed budget cap allows
 *     (structured-drafter checkBudget), and the live-SERP enrichment is
 *     dry-run by default + 14-day cached + capped (enrichPickSerpPatterns).
 *     This pass front-runs the exact same bounded spend the operator's own
 *     morning "plan today" click would trigger - it adds NO new spend path,
 *     and the skip-when-fresh guard means at most one build per day.
 *   - displacement-check spends through runSerpQuery's own unmodified
 *     gauntlet (configured -> cache -> dry-run -> fail-closed monthly cap ->
 *     ledger) - capped at 3 checks/tenant/night on top of that, and an
 *     explicit 14-day per-query re-check guard so the same drop is never
 *     paid for twice inside two weeks.
 *
 * Safety posture (mirrors run-autopilot):
 *   - ambient-vs-requested tenant guard: the surface stores resolve through
 *     the ambient tenant context, so a cron fan-out must never warm a tenant
 *     the ambient context does not match (no cross-tenant cache pollution).
 *   - fail-soft per step: a failed step is recorded and the pass moves on.
 *   - bounded: sequential steps, each under a hard timeout.
 *
 * Pinned by tests/domains/ops/warm-caches.test.ts.
 */

import type { DailyExperimentPlanRecord } from "@/domains/experiments/daily-plan-types";
import type { TodayPreviewResult } from "@/domains/experiments/build-today-preview";
import type { DisplacementCheckSummary } from "@/domains/serp/displacement-check";
import type { StealLaneRunSummary } from "@/domains/serp/serp-steal-lane";
import type { NativeTeardownRunSummary } from "@/domains/demand-graph/native-teardown-runner";
import type { PrepareMovesSummary } from "@/domains/demand-graph/prepare-today-moves";
import type { WarmRunReceipt, WarmStepReceipt } from "./warm-receipt-store";

export type WarmCachesDeps = {
  /** The ambient tenant the per-tenant stores will actually resolve to. */
  ambientTenantId: () => Promise<string>;
  /** Rebuild + persist the demand-graph SWR snapshot (build-then-write). */
  refreshDemandGraph: (tenantId: string) => Promise<void>;
  /** Rebuild + persist the /changes SWR surface. */
  refreshWorklist: (tenantId: string) => Promise<void>;
  /** Rebuild + persist the Today SWR surface. `tenantId` threads explicitly into the
   *  write so it can never disagree with json-store's ambient resolution (sibling
   *  fix, 2026-07-10 hygiene batch - same P2-f discipline as refreshWorklist above). */
  refreshToday: (tenantId: string) => Promise<void>;
  /** Latest persisted preview plan, if any. */
  getLatestPreviewPlan: (tenantId: string) => Promise<DailyExperimentPlanRecord | null>;
  /** Latest still-open accepted plan, if any. */
  getAcceptedPlan: (tenantId: string) => Promise<DailyExperimentPlanRecord | null>;
  /** Close a stale (prior-day) accepted plan so it stops blocking today's plan; its proof
   *  rows keep measuring independently. Returns whether a row was completed. */
  completeAcceptedPlan: (tenantId: string, planId: string, now: Date) => Promise<boolean>;
  /** Best-effort plan hygiene (same call the operator action makes first). */
  expirePlans: (tenantId: string, now: Date) => Promise<number>;
  /** The EXISTING preview builder entry point (never reimplemented here). */
  buildPreview: (tenantId: string, now: Date) => Promise<TodayPreviewResult>;
  /** Persist the built preview (fail-closed in the store). */
  persistPreview: (record: DailyExperimentPlanRecord) => Promise<void>;
  /** Pacific date key for "tonight". */
  today: (now: Date) => string;
  /** BEACON 500 item 82: the capped nightly money-query displacement check
   *  (find real position drops -> at most 3 live Google checks -> persist
   *  verdicts). Returns a short summary for the step's receipt note. */
  runDisplacementChecks: (tenantId: string, now: Date) => Promise<DisplacementCheckSummary>;
  /** DREAM SITE V1 item D3: the capped nightly SERP-steal lane (find beaten
   *  keywords -> resolve top-5 -> tear down -> persist steal briefs).
   *  Returns a short summary for the step's receipt note. */
  runStealLane: (tenantId: string, now: Date) => Promise<StealLaneRunSummary>;
  /** DREAM SITE V1 item D2: the capped nightly native-cited teardown +
   *  commonality + gap-verdict lane (top-5 cited pages per native prompt ->
   *  tear down -> what winners share -> atomic-edit or new-page verdict).
   *  Returns a short summary for the step's receipt note. */
  runNativeTeardown: (tenantId: string, now: Date) => Promise<NativeTeardownRunSummary>;
  /** R20 (D6 dynamic auto-mode): is prepare-ahead-overnight turned on for this
   *  tenant? Read from the SAME autopilot config the settings toggle writes.
   *  Default OFF - a false here makes the prepare-ahead step a byte-identical
   *  skip, so the nightly path is unchanged until the operator opts in. */
  isPrepareAheadEnabled: (tenantId: string) => Promise<boolean>;
  /** R20: the capped nightly PREPARE-ahead pass (draft + SERP-check the top
   *  Moves so the morning queue is already prepared). PREPARE only - it NEVER
   *  publishes. Reuses the exact operator-triggered prepare pipeline, capped
   *  and cache-first (a warm cache is $0). Returns a short summary for the
   *  step's receipt note. */
  runPrepareAhead: (tenantId: string, now: Date) => Promise<PrepareMovesSummary>;
};

/** YYYY-MM-DD in America/Los_Angeles (same helper family as run-autopilot). */
export function pacificDay(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function defaultAmbientTenantId(): Promise<string> {
  const { currentTenantId } = await import("@/lib/tenant-context");
  return await currentTenantId();
}

/**
 * Build the graph fresh, THEN persist the snapshot - the same two exported
 * calls the SWR loader's miss path composes (load-graph buildAndPersistOnce).
 * Build-then-write means a failed build keeps the previous snapshot.
 */
async function defaultRefreshDemandGraph(tenantId: string): Promise<void> {
  const { loadDemandGraphForTenant } = await import("@/domains/demand-graph/load-graph");
  const { writeGraphSnapshot } = await import("@/domains/demand-graph/graph-snapshot-store");
  const fresh = await loadDemandGraphForTenant(tenantId);
  await writeGraphSnapshot(fresh, new Date().toISOString(), tenantId);
}

async function defaultRefreshWorklist(tenantId: string): Promise<void> {
  const [{ refreshWorklistSurface }, { rebuildChangesSurface }] = await Promise.all([
    import("@/app/(shell)/moves/moves-data"),
    import("@/app/(shell)/changes-data"),
  ]);
  // The worklist and Changes have separate durable SWR snapshots. Research
  // changes the inputs to both, so warming only /moves leaves /changes serving
  // the previous ranking until its independent TTL expires. Rebuild in
  // dependency order: canonical worklist first, then the fused Changes view.
  await refreshWorklistSurface(tenantId);
  await rebuildChangesSurface(tenantId);
}

async function defaultRefreshToday(tenantId: string): Promise<void> {
  const { refreshCustomerSurface } = await import("@/app/(shell)/customer-surface-refresh");
  await refreshCustomerSurface(tenantId);
}

/**
 * The FREE cache-warm subset only: rebuild the shared demand-graph snapshot,
 * then the /changes worklist surface, then the Today surface, in dependency
 * order, each fail-soft. This is steps 1-2-4 of the nightly pass with NONE of
 * the paid/nightly-only steps (no displacement check, SERP-steal, teardown, or
 * prepare-ahead), so it is safe to call synchronously from a request-context
 * server action.
 *
 * Why it exists (2026-07-08): the manual "Update data" refresh pulls fresh data
 * and then repaints via `revalidatePath("/")`. Without this, that repaint pays
 * the full ~6s cold demand-graph build right when the operator is watching, and
 * the deadline-raced Today sections fall back to "here on your next visit".
 * Warming here (build-then-write always rebuilds from the just-pulled data) makes
 * the post-refresh repaint instant and complete. Composition only; zero logic.
 */
export async function warmFreeSurfaces(tenantId: string): Promise<void> {
  await defaultRefreshDemandGraph(tenantId).catch(() => {});
  await defaultRefreshWorklist(tenantId).catch(() => {});
  await defaultRefreshToday(tenantId).catch(() => {});
}

async function defaultGetLatestPreviewPlan(tenantId: string): Promise<DailyExperimentPlanRecord | null> {
  const { getLatestPreviewPlan } = await import("@/domains/experiments/daily-experiment-plan-store");
  return await getLatestPreviewPlan(tenantId);
}

async function defaultGetAcceptedPlan(tenantId: string): Promise<DailyExperimentPlanRecord | null> {
  const { getAcceptedPlan } = await import("@/domains/experiments/daily-experiment-plan-store");
  return await getAcceptedPlan(tenantId);
}

async function defaultCompleteAcceptedPlan(tenantId: string, planId: string, now: Date): Promise<boolean> {
  const { completePlan } = await import("@/domains/experiments/daily-experiment-plan-store");
  return await completePlan(tenantId, planId, now);
}

async function defaultExpirePlans(tenantId: string, now: Date): Promise<number> {
  const { expirePlans } = await import("@/domains/experiments/daily-experiment-plan-store");
  return await expirePlans(tenantId, now);
}

async function defaultBuildPreview(tenantId: string, now: Date): Promise<TodayPreviewResult> {
  const { buildTodayExperimentPreview } = await import("@/domains/experiments/build-today-preview");
  return await buildTodayExperimentPreview(tenantId, now);
}

async function defaultPersistPreview(record: DailyExperimentPlanRecord): Promise<void> {
  const { createPreviewPlan } = await import("@/domains/experiments/daily-experiment-plan-store");
  await createPreviewPlan(record);
}

/** BEACON 500 item 82: at most 3 capped live checks per tenant per night. */
const MAX_DISPLACEMENT_CHECKS_PER_NIGHT = 3;

async function defaultRunDisplacementChecks(tenantId: string, now: Date): Promise<DisplacementCheckSummary> {
  const { runDisplacementCheckForTenant } = await import("@/domains/serp/displacement-check");
  return await runDisplacementCheckForTenant(tenantId, { maxChecks: MAX_DISPLACEMENT_CHECKS_PER_NIGHT, now: () => now });
}

/** DREAM SITE V1 item D3: at most 10 beaten keywords considered, at most 5
 *  of those spend a capped live SERP pull per tenant per night. */
const MAX_STEAL_KEYWORDS_PER_NIGHT = 10;
const MAX_STEAL_LIVE_SERP_PULLS_PER_NIGHT = 5;

async function defaultRunStealLane(tenantId: string, now: Date): Promise<StealLaneRunSummary> {
  const { runStealLaneForTenant } = await import("@/domains/serp/serp-steal-lane");
  return await runStealLaneForTenant(tenantId, {
    maxKeywords: MAX_STEAL_KEYWORDS_PER_NIGHT,
    maxLiveSerpPulls: MAX_STEAL_LIVE_SERP_PULLS_PER_NIGHT,
    now: () => now,
  });
}

/** DREAM SITE V1 item D2: at most 10 native-poll prompts analyzed per night
 *  (free polite fetch, 14d cache, no paid API in this lane). */
const MAX_NATIVE_TEARDOWN_PROMPTS_PER_NIGHT = 10;

async function defaultRunNativeTeardown(tenantId: string, _now: Date): Promise<NativeTeardownRunSummary> {
  const { runNativeTeardownForTenant } = await import("@/domains/demand-graph/native-teardown-runner");
  return await runNativeTeardownForTenant(tenantId, { maxPrompts: MAX_NATIVE_TEARDOWN_PROMPTS_PER_NIGHT });
}

/** R20: prepare-ahead is read from the SAME autopilot config the settings toggle writes,
 *  fail-CLOSED (any read error -> false -> the step skips), so a store hiccup can never turn
 *  prepare-ahead on by accident. */
async function defaultIsPrepareAheadEnabled(_tenantId: string): Promise<boolean> {
  try {
    const { getAutopilotConfig } = await import("@/domains/autopilot/autopilot-store");
    return (await getAutopilotConfig()).prepareAheadOvernight === true;
  } catch {
    return false;
  }
}

/** R20: at most this many top Moves prepared per night, under a hard per-run $ cap so the
 *  prepare-ahead lane can never outspend the existing budgets. Cache-first (a warm cache is $0). */
const MAX_PREPARE_AHEAD_MOVES_PER_NIGHT = 10;
const MAX_PREPARE_AHEAD_USD_PER_NIGHT = 0.15;

async function defaultRunPrepareAhead(tenantId: string, now: Date): Promise<PrepareMovesSummary> {
  const [{ prepareTodayMovesForTenant }, { readChangesSurface }] = await Promise.all([
    import("@/domains/demand-graph/prepare-today-moves"),
    import("@/app/(shell)/changes-surface-store"),
  ]);
  const rankedEntries = (await readChangesSurface(tenantId).catch(() => null))
    ?.view.rankedPreparationEntries ?? [];
  return await prepareTodayMovesForTenant(tenantId, {
    maxN: MAX_PREPARE_AHEAD_MOVES_PER_NIGHT,
    maxUsd: MAX_PREPARE_AHEAD_USD_PER_NIGHT,
    now: () => now,
    rankedEntries,
  });
}

const defaultDeps: WarmCachesDeps = {
  ambientTenantId: defaultAmbientTenantId,
  refreshDemandGraph: defaultRefreshDemandGraph,
  refreshWorklist: defaultRefreshWorklist,
  refreshToday: defaultRefreshToday,
  completeAcceptedPlan: defaultCompleteAcceptedPlan,
  getLatestPreviewPlan: defaultGetLatestPreviewPlan,
  getAcceptedPlan: defaultGetAcceptedPlan,
  expirePlans: defaultExpirePlans,
  buildPreview: defaultBuildPreview,
  persistPreview: defaultPersistPreview,
  today: pacificDay,
  runDisplacementChecks: defaultRunDisplacementChecks,
  runStealLane: defaultRunStealLane,
  runNativeTeardown: defaultRunNativeTeardown,
  isPrepareAheadEnabled: defaultIsPrepareAheadEnabled,
  runPrepareAhead: defaultRunPrepareAhead,
};

/** Hard per-step ceiling - a hung step is recorded as failed and the pass moves on. */
const STEP_TIMEOUT_MS = 120_000;

type StepOutcome = { skipped?: boolean; note?: string } | null | undefined;

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${name} exceeded the ${Math.round(ms / 1000)}s step ceiling`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function runStep(name: string, fn: () => Promise<StepOutcome>): Promise<WarmStepReceipt> {
  const t0 = Date.now();
  try {
    const outcome = await withTimeout(fn(), STEP_TIMEOUT_MS, name);
    return {
      name,
      ok: true,
      ms: Date.now() - t0,
      ...(outcome?.skipped ? { skipped: true } : {}),
      ...(outcome?.note ? { note: outcome.note } : {}),
    };
  } catch (e) {
    return {
      name,
      ok: false,
      ms: Date.now() - t0,
      note: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

/**
 * Ensure tonight's plan preview exists. Skip when an accepted batch is still
 * open (the dashboard shows it; a fresh preview would fight it) or when a
 * preview for the current Pacific day (or later) is already persisted. The
 * build itself is the EXISTING entry point, mirrored from the operator's
 * plan action: expire -> build -> persist only when something was selected.
 */
async function ensurePlanPreview(
  tenantId: string,
  now: Date,
  date: string,
  deps: WarmCachesDeps,
): Promise<StepOutcome> {
  const [accepted, preview] = await Promise.all([
    deps.getAcceptedPlan(tenantId).catch(() => null),
    deps.getLatestPreviewPlan(tenantId).catch(() => null),
  ]);
  if (accepted && accepted.date >= date) {
    // TODAY's accepted batch is still being worked - don't fight it with a fresh plan.
    return { skipped: true, note: "today's accepted batch is still open, so we left the plan alone" };
  }
  if (accepted && accepted.date < date) {
    // A PRIOR-day accepted batch must NOT block today. Its moves are already applied and
    // measuring in the background (proof rows measure independently of the plan's status),
    // so complete it to free the daily loop, then build today's fresh plan. Without this an
    // accepted batch the operator never clicked "Finish for today" on blocked new plans for
    // days - the "same 6 changes every day" bug (2026-07-08). Any of its moves that were
    // never applied stay in the backlog and get re-picked, so nothing is lost.
    await deps.completeAcceptedPlan(tenantId, accepted.id, now).catch(() => {});
  }
  if (preview && preview.date >= date) {
    return { skipped: true, note: `tonight's plan already exists with ${preview.selected.length} picks` };
  }
  await deps.expirePlans(tenantId, now).catch(() => 0);
  const { record } = await deps.buildPreview(tenantId, now);
  if (record.selected.length === 0) {
    return { note: "nothing eligible tonight, so no plan was persisted" };
  }
  await deps.persistPreview(record);
  return { note: `built tonight's plan with ${record.selected.length} picks` };
}

/**
 * Warm every morning surface for one tenant. Sequential, bounded, fail-soft
 * per step; returns the receipt the cron persists and /diagnostics reads.
 */
export async function warmTenantCaches(
  tenantId: string,
  now: Date = new Date(),
  depsOverride: Partial<WarmCachesDeps> = {},
): Promise<WarmRunReceipt> {
  const deps: WarmCachesDeps = { ...defaultDeps, ...depsOverride };
  const date = deps.today(now);
  const ranAt = new Date().toISOString();
  const t0 = Date.now();

  // Cross-tenant safety: the surface stores resolve through the ambient tenant
  // context. Warming a tenant the ambient context does not match would write
  // that tenant's computed data under ANOTHER tenant's cache scope - skip.
  let ambient: string | null = null;
  try {
    ambient = await deps.ambientTenantId();
  } catch {
    ambient = null;
  }
  if (ambient !== tenantId) {
    return {
      tenant_id: tenantId,
      date,
      ran_at: ranAt,
      ok: false,
      totalMs: Date.now() - t0,
      steps: [{
        name: "tenant-guard",
        ok: false,
        ms: 0,
        skipped: true,
        note: `the active tenant context is ${ambient ?? "unset"}, not ${tenantId}, so we skipped to protect its caches`,
      }],
    };
  }

  const steps: WarmStepReceipt[] = [];
  steps.push(await runStep("demand-graph", async () => { await deps.refreshDemandGraph(tenantId); return null; }));
  steps.push(await runStep("worklist-surface", async () => { await deps.refreshWorklist(tenantId); return null; }));
  steps.push(await runStep("plan-preview", () => ensurePlanPreview(tenantId, now, date, deps)));
  // Coverage map has no persistent snapshot store today - it derives from the
  // demand-graph snapshot warmed in step 1, so there is nothing extra to write.
  steps.push({
    name: "coverage-map",
    ok: true,
    ms: 0,
    skipped: true,
    note: "no stored snapshot of its own; it reads the graph we just warmed",
  });
  // Displacement check (BEACON 500 item 82) - isolated on purpose: this is a
  // LOSS reflex, not a cache warm, and it is the one step in this pass that
  // can spend real money (through runSerpQuery's own unmodified gauntlet,
  // capped at MAX_DISPLACEMENT_CHECKS_PER_NIGHT). A failure here must never
  // affect the 5 warm steps above it - runStep already isolates it the same
  // way every other step is isolated.
  steps.push(
    await runStep("displacement-check", async () => {
      const summary = await deps.runDisplacementChecks(tenantId, now);
      const note =
        summary.verdicts.length > 0
          ? `checked ${summary.checked + summary.cached} money query drop(s), found ${summary.verdicts.length} still displaced, skipped ${summary.skippedNoBudget} past the nightly cap`
          : `no qualifying money query drops to check tonight (skipped ${summary.skippedRecent} already checked recently, ${summary.skippedNoBudget} past the nightly cap)`;
      return { note };
    }),
  );
  // DREAM SITE V1 item D3: the GAIN mirror of displacement-check - isolated
  // the same way (a failure here never affects any step above it).
  steps.push(
    await runStep("serp-steal-lane", async () => {
      const summary = await deps.runStealLane(tenantId, now);
      if (summary.beatenKeywordsFound === 0) {
        return { skipped: true, note: "no beaten keywords (rank 4-20 with real impressions) found tonight" };
      }
      const note = `found ${summary.beatenKeywordsFound} beaten keyword(s), read ${summary.teardownsTorndown} competitor page(s) (${summary.storedSerpHits} from stored SERPs, ${summary.livePullsUsed} live), built ${summary.briefsBuilt} steal brief(s)`;
      return { note };
    }),
  );
  // DREAM SITE V1 item D2: native-cited teardown + commonality + gap verdict -
  // isolated the same way (a failure here never affects any step above it).
  // $0 spend (polite fetch only), so unlike the two SERP steps above it has no
  // live-pull budget line to report, just prompts analyzed / pages torn down.
  steps.push(
    await runStep("native-teardown", async () => {
      const summary = await deps.runNativeTeardown(tenantId, now);
      if (summary.promptsAnalyzed === 0) {
        return { skipped: true, note: "no native-poll prompts with cited pages to tear down tonight" };
      }
      const note = `analyzed ${summary.promptsAnalyzed} native prompt(s), read ${summary.torndownPages} competitor page(s) (${summary.fromCache} from cache), verdicts: ${summary.verdicts.filter((v) => v.outcome === "atomic_edit").length} atomic edit, ${summary.verdicts.filter((v) => v.outcome === "new_page").length} new page, ${summary.verdicts.filter((v) => v.outcome === "no_verdict").length} not enough winners yet`;
      return { note };
    }),
  );
  // R20 (D6 dynamic auto-mode): prepare-ahead-overnight. DEFAULT OFF, so with the toggle off
  // this step is a byte-identical skip (no config read side effect, no prepare, no spend) - the
  // nightly path is unchanged until the operator opts in. When ON, it PREPARES (drafts +
  // SERP-checks) the top Moves so the morning queue is already prepared; it NEVER publishes.
  // Isolated + fail-soft like every step above; capped + cache-first (a warm cache is $0), so
  // it stays inside the existing budgets. Today is refreshed after this step so newly prepared
  // drafts are visible on the first post-pass render, not one visit later.
  steps.push(
    await runStep("prepare-ahead", async () => {
      const enabled = await deps.isPrepareAheadEnabled(tenantId);
      if (!enabled) {
        return { skipped: true, note: "prepare-ahead-overnight is off, so the morning queue prepares on demand" };
      }
      const summary = await deps.runPrepareAhead(tenantId, now);
      const note = `prepared ${summary.prepared} Move(s) (${summary.cached} already prepared, ${summary.readyToReview} ready to review), spent $${summary.llmCostUsd.toFixed(3)}${summary.stoppedForBudget ? " (stopped at the nightly cap)" : ""}${summary.failed ? `, ${summary.failed} need a look` : ""}`;
      return { note };
    }),
  );
  steps.push(await runStep("today-surface", async () => { await deps.refreshToday(tenantId); return null; }));

  return {
    tenant_id: tenantId,
    date,
    ran_at: ranAt,
    ok: steps.every((s) => s.ok),
    totalMs: Date.now() - t0,
    steps,
  };
}
