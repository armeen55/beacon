import "server-only";

/**
 * scheduler (2026-08-03) - THE DAILY DISPATCH. Beacon promises a reading of your AI answers every calendar
 * day, and until now a reading only happened because somebody opened the app: an operator who did not visit
 * on Tuesday simply had no Tuesday. ONE global Supabase pg_cron job POSTs, through pg_net, to ONE guarded
 * non-customer endpoint (src/app/api/cron/scheduler/route.ts), and that endpoint calls this. No per-account
 * schedule, no queue, no worker fleet, no second orchestrator: this claims bounded work under the SAME
 * database leases a visit claims under and drives it through the SAME canonical cycle (driveClaimed).
 *
 * SAFE TO FIRE TWICE. claim_due_research_work claims each account through claim_research_run, which takes a
 * per-account advisory lock and refuses a foreign live lease, and the partial unique index allows at most one
 * unfinished run per account. A duplicate dispatch claims nothing the first one holds and reports zero; a
 * dispatch racing a live visit loses the same way.
 *
 * NEVER: a continuation hop (browser-recovery machinery), a cent outside the existing per-cycle deadline and
 * spend caps, or a day that has already passed. Resume after a pause picks up TODAY; missed days stay missed.
 */

import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { claimDueRuns, finishRun, newOwnerToken } from "../research-run";
import { driveClaimed, RESEARCH_CYCLE_DEADLINE_MS, type ResearchCycleSteps } from "./on-visit-refresh";
import { defaultSteps } from "./research-steps";

/** How many accounts ONE dispatch may claim. Small on purpose: the request has a hard lifetime, and an
 *  account the budget could not reach is simply released for the next dispatch, never dropped. */
export const SCHEDULER_ACCOUNTS_PER_RUN = 3;

/** The dispatch's OWN wall-clock budget, well inside the 300-second function lifetime, so the HTTP request
 *  always returns a receipt instead of being killed mid-account. Each account additionally gets at most the
 *  ordinary RESEARCH_CYCLE_DEADLINE_MS. */
const SCHEDULER_BUDGET_MS = 240_000;

/** What one dispatch actually did. Counts only: no account name, no token, no secret. */
export type SchedulerReceipt = { claimed: number; driven: number; remaining: number };

type SchedulerOptions = { now?: () => Date; limit?: number; budgetMs?: number; steps?: Partial<ResearchCycleSteps> };

/**
 * Claim up to `limit` accounts that still owe work for their current Pacific day and drive each one, in
 * sequence, until this dispatch's own budget is spent. Returns a receipt of counts.
 *
 * An account claimed but not reached is RELEASED (paused, lease cleared) rather than left holding a lease
 * nobody is using, so the next dispatch or the operator's next visit resumes it immediately.
 */
export async function runDueAccounts(options: SchedulerOptions = {}): Promise<SchedulerReceipt> {
  const nowFn = options.now ?? (() => new Date());
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const limit = Math.max(1, Math.trunc(options.limit ?? SCHEDULER_ACCOUNTS_PER_RUN));
  const endsAt = nowFn().getTime() + (options.budgetMs ?? SCHEDULER_BUDGET_MS);
  const ownerToken = newOwnerToken();

  const claimed = await claimDueRuns(ownerToken, limit);
  if (claimed.length === 0) {
    log.info("[research-run] the daily dispatch found nothing owed right now", {});
    return { claimed: 0, driven: 0, remaining: 0 };
  }

  let driven = 0;
  for (const run of claimed) {
    const left = endsAt - nowFn().getTime();
    // No time for a real phase: release this account's lease and let the next dispatch take it.
    if (left <= 0) {
      await finishRun(run.tenant_id, run.id, ownerToken, "paused");
      continue;
    }
    const deadline = nowFn().getTime() + Math.min(RESEARCH_CYCLE_DEADLINE_MS, left);
    await runWithTenant(run.tenant_id, async () => {
      const work = await steps.dueWork(run.tenant_id, nowFn()).catch(() => null);
      await driveClaimed(run, ownerToken, work, nowFn, deadline, steps);
    }).catch((error) => {
      log.warn("[research-run] the daily dispatch could not finish this account; it resumes on the next one",
        { tenantId: run.tenant_id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    });
    driven += 1;
  }
  log.info("[research-run] daily dispatch done", { claimed: claimed.length, driven });
  return { claimed: claimed.length, driven, remaining: claimed.length - driven };
}
