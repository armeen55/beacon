import "server-only";

/** scheduler (2026-08-03) - THE DAILY DISPATCH. ONE global Supabase pg_cron job POSTs to ONE guarded endpoint, which claims at most one account through the same database lease and canonical cycle a
 *  visit uses. Database admission is durable: fresh Pacific-day work, expired leases, elapsed pause backoff, or an elapsed completed-run wake. Settled and not-yet-due accounts are never loaded into the
 *  runtime. Duplicate dispatches and visits contend on the same advisory lock and unfinished-run invariant. Missed days stay missed; no queue, worker fleet, continuation hop, or second orchestrator. */

import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { researchRunSpendUsd } from "@/lib/cost/spend-reservations";
import { claimDueRuns, finishRun, loadResearchRun, newOwnerToken } from "../research-run";
import { driveClaimed, RESEARCH_CYCLE_DEADLINE_MS, type ResearchCycleSteps } from "./on-visit-refresh";
import { defaultSteps } from "./research-steps";

/** The scheduled door gets a fixed 240-second wall-clock budget inside its 300-second route. The 800-second
 * recovery lease remains deliberately longer: a lock lifetime is a crash-safety boundary, not a compute budget.
 * Deriving this value from the lease made every ten-minute tick eligible to consume the platform maximum. */
const SCHEDULER_BUDGET_MS = 240_000;

/** The least time an account is worth STARTING on. Under half a minute there is no room for a renewed lease and a real bounded unit, so claiming would only park a live lease in front of the
 *  operator's own visit. Nothing is claimed instead, and the account is first in line on the next dispatch. */
const MIN_ACCOUNT_SLICE_MS = 30_000;

/** WHAT THE DISPATCH KEEPS BACK SO THE CUSTOMER SEES THE DAY'S WORK. A zero-dollar release rebuild takes seconds; research
 *  will always fill whatever it is given, so the publish has to be reserved rather than left over. Enough for the rebuild of
 *  every account this dispatch touched, and small beside the drive's own window. */
const PUBLISH_RESERVE_MS = 40_000;

/** What one dispatch actually did. Counts only: no account name, no token, no secret. A THROW IS NOT A DRIVE, AND NEITHER IS A PAUSE. The receipt used to carry one number, `driven`, incremented
 *  inside the very catch block that logged the failure; then it counted every normal return as a success, which a provider wait, a phase pause and a lost lease all are. Each outcome now has its own
 *  name, taken from the DURABLE state the cycle left on the row: `attempted` is how many this dispatch started, `succeeded` is how many landed a completed run, `paused` is how many landed a paused
 *  one (a claim handed straight back for want of budget counts here too), and `failed` is how many threw or could not persist the state they meant to, including a run whose lease another instance had
 *  already recovered. `released` counts the failures whose lease this dispatch still managed to return through the canonical paused finish; `leaseHeldUntil` names the moment each unreturnable lease
 *  expires on its own, which is the only remaining honest thing to say about it. `remaining` is what was claimed and did not succeed. */
export type SchedulerReceipt = {
  claimed: number; attempted: number; succeeded: number; paused: number;
  failed: number; leaseHeldUntil: string[]; released: number; remaining: number;
};

type SchedulerOptions = { now?: () => Date; budgetMs?: number; steps?: Partial<ResearchCycleSteps> };

/** Claim and drive at most ONE due account. A live lease is acquired only for work this invocation can start; visits recover through the same claim path. */
export async function runDueAccounts(options: SchedulerOptions = {}): Promise<SchedulerReceipt> {
  const nowFn = options.now ?? (() => new Date());
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const endsAt = nowFn().getTime() + (options.budgetMs ?? SCHEDULER_BUDGET_MS);
  const ownerToken = newOwnerToken();
  let claimed = 0, attempted = 0, succeeded = 0, paused = 0, failed = 0, released = 0;
  const leaseHeldUntil: string[] = [];
  const receipt = (): SchedulerReceipt => ({ claimed, attempted, succeeded, paused, failed, leaseHeldUntil, released, remaining: claimed - succeeded });
  const handBack = async (run: { tenant_id: string; id: string; lease_expires_at: string | null; spend_usd?: number; progress?: { funnel?: { spendUsd?: number } } | null }): Promise<boolean> => {
    const durable = await loadResearchRun(run.tenant_id, run.id), attributed = await researchRunSpendUsd(run.id).catch(() => null);
    const spend = attributed ?? Math.max(Number(durable?.progress?.funnel?.spendUsd) || 0, Number(durable?.spend_usd) || 0,
      Number(run.progress?.funnel?.spendUsd) || 0, Number(run.spend_usd) || 0);
    const canonicalUnreadable = durable == null && attributed == null;
    const ok = await finishRun(run.tenant_id, run.id, ownerToken, "paused", null, canonicalUnreadable ? null : spend);
    if (!ok) leaseHeldUntil.push(run.lease_expires_at ?? "");
    return ok;
  };
  const republishStale = async (tenantId: string): Promise<void> => {
    if (nowFn().getTime() >= endsAt) return;
    try {
      const { readCustomerSurface, isCustomerSurfaceStale, refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
      const held = await runWithTenant(tenantId, () => readCustomerSurface(tenantId));
      if (!held || isCustomerSurfaceStale(held.computedAt, nowFn().getTime())) {
        await runWithTenant(tenantId, () => refreshCustomerSurface(tenantId, { maxDrafts: 0 }));
        log.info("[research-run] the worked account's stale surface was rebuilt at zero paid calls", { tenantId });
      }
    } catch (error) {
      log.warn("[research-run] the stale surface could not republish on this tick", { tenantId, error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
    }
  };
  if (endsAt - nowFn().getTime() < MIN_ACCOUNT_SLICE_MS) return receipt();
  const run = (await claimDueRuns(ownerToken, 1))[0];
  if (run == null) {
    await steps.collectBought(Math.min(20_000, Math.max(0, endsAt - nowFn().getTime())));
    return receipt();
  }
  claimed = 1;
  const left = endsAt - nowFn().getTime();
  if (left < MIN_ACCOUNT_SLICE_MS) {
    if (await handBack(run)) paused = 1; else failed = 1;
    return receipt();
  }
  attempted = 1;
  const deadline = nowFn().getTime() + Math.min(RESEARCH_CYCLE_DEADLINE_MS, Math.max(MIN_ACCOUNT_SLICE_MS, left - PUBLISH_RESERVE_MS));
  const outcome = await runWithTenant(run.tenant_id, async () => {
    await (await import("@/domains/evidence/dataforseo/client")).DATAFORSEO_READINESS.recover(run.tenant_id).catch(() => "unreadable" as const);
    const work = await steps.dueWork(run.tenant_id, nowFn()).catch(() => null);
    return driveClaimed(run, ownerToken, work, nowFn, deadline, steps);
  }).catch((error) => {
    log.warn("[research-run] the daily dispatch could not finish its admitted account", { tenantId: run.tenant_id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    return "failed" as const;
  });
  if (outcome === "completed") succeeded = 1;
  else if (outcome === "paused") paused = 1;
  else { failed = 1; if (outcome !== "lost_lease" && await handBack(run)) released = 1; }
  await republishStale(run.tenant_id);
  log.info("[research-run] scheduled admission finished", { claimed, succeeded, failed, paused });
  return receipt();
}
