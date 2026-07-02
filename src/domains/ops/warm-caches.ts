import "server-only";

/**
 * warm-caches (2026-07-02, BEACON 500 item 13) - the nightly precompute pass.
 *
 * At ~5am Pacific the cron warms everything the operator opens first thing in
 * the morning, so the first visit is instant AND full: the demand-graph
 * snapshot, the /worklist SWR surface, tonight's daily plan preview, and the
 * Today SWR surface. This is a WARM CACHE pass, not a behavior change - the
 * on-demand posture stays for refresh, and every step calls the EXISTING
 * loader/builder (zero business logic lives here; composition only).
 *
 * Step order matters and is pinned by tests:
 *   1. demand-graph        - the shared graph snapshot every surface reads
 *   2. worklist-surface    - built FROM the fresh graph
 *   3. plan-preview        - ensure tonight's plan exists (skip when it does)
 *   4. today-surface       - built AFTER the preview so Today shows the plan
 *   5. coverage-map        - no persistent store today; recorded as skipped
 *                            (it reads the demand-graph snapshot warmed in 1)
 *   6. displacement-check  - BEACON 500 item 82 (2026-07-02): a LOSS reflex,
 *                            not a cache warm. Finds money queries that fell
 *                            3+ Google positions vs a week ago and spends AT
 *                            MOST 3 capped live checks per tenant per night
 *                            through the existing runSerpQuery gauntlet
 *                            (untouched here). Isolated step: a failure or a
 *                            capped/dry-run outcome never affects the 5 warm
 *                            steps above it. See displacement-check.ts.
 *
 * Money posture (verified in the callees, none edited here):
 *   - graph/worklist/today loaders are cached/durable reads only ($0).
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
import type { WarmRunReceipt, WarmStepReceipt } from "./warm-receipt-store";

export type WarmCachesDeps = {
  /** The ambient tenant the per-tenant stores will actually resolve to. */
  ambientTenantId: () => Promise<string>;
  /** Rebuild + persist the demand-graph SWR snapshot (build-then-write). */
  refreshDemandGraph: (tenantId: string) => Promise<void>;
  /** Rebuild + persist the /worklist SWR surface. */
  refreshWorklist: (tenantId: string) => Promise<void>;
  /** Rebuild + persist the Today SWR surface (ambient tenant). */
  refreshToday: () => Promise<void>;
  /** Latest persisted preview plan, if any. */
  getLatestPreviewPlan: (tenantId: string) => Promise<DailyExperimentPlanRecord | null>;
  /** Latest still-open accepted plan, if any. */
  getAcceptedPlan: (tenantId: string) => Promise<DailyExperimentPlanRecord | null>;
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
  await writeGraphSnapshot(fresh, new Date().toISOString());
}

async function defaultRefreshWorklist(tenantId: string): Promise<void> {
  const { refreshWorklistSurface } = await import("@/app/(shell)/moves/moves-data");
  await refreshWorklistSurface(tenantId);
}

async function defaultRefreshToday(): Promise<void> {
  const { refreshTodaySurface } = await import("@/app/(shell)/today-view-data");
  await refreshTodaySurface();
}

async function defaultGetLatestPreviewPlan(tenantId: string): Promise<DailyExperimentPlanRecord | null> {
  const { getLatestPreviewPlan } = await import("@/domains/experiments/daily-experiment-plan-store");
  return await getLatestPreviewPlan(tenantId);
}

async function defaultGetAcceptedPlan(tenantId: string): Promise<DailyExperimentPlanRecord | null> {
  const { getAcceptedPlan } = await import("@/domains/experiments/daily-experiment-plan-store");
  return await getAcceptedPlan(tenantId);
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

const defaultDeps: WarmCachesDeps = {
  ambientTenantId: defaultAmbientTenantId,
  refreshDemandGraph: defaultRefreshDemandGraph,
  refreshWorklist: defaultRefreshWorklist,
  refreshToday: defaultRefreshToday,
  getLatestPreviewPlan: defaultGetLatestPreviewPlan,
  getAcceptedPlan: defaultGetAcceptedPlan,
  expirePlans: defaultExpirePlans,
  buildPreview: defaultBuildPreview,
  persistPreview: defaultPersistPreview,
  today: pacificDay,
  runDisplacementChecks: defaultRunDisplacementChecks,
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
  if (accepted) {
    return { skipped: true, note: "an accepted batch is still open, so we left the plan alone" };
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
  steps.push(await runStep("today-surface", async () => { await deps.refreshToday(); return null; }));
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

  return {
    tenant_id: tenantId,
    date,
    ran_at: ranAt,
    ok: steps.every((s) => s.ok),
    totalMs: Date.now() - t0,
    steps,
  };
}
