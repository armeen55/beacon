import "server-only";

/**
 * scheduler (2026-08-03) - THE DAILY DISPATCH. Beacon promises a reading of your AI answers every calendar
 * day, and until now a reading only happened because somebody opened the app: an operator who did not visit
 * on Tuesday simply had no Tuesday. ONE global Supabase pg_cron job POSTs, through pg_net, to ONE guarded
 * non-customer endpoint (src/app/api/cron/scheduler/route.ts), and that endpoint calls this. No per-account
 * schedule, no queue, no worker fleet, no second orchestrator: this claims ONE account at a time under the
 * SAME database leases a visit claims under and drives it through the SAME canonical cycle (driveClaimed).
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

/** The dispatch's OWN wall-clock budget, well inside the 300-second function lifetime, so the HTTP request
 *  always returns a receipt instead of being killed mid-account. Each account additionally gets at most the
 *  ordinary RESEARCH_CYCLE_DEADLINE_MS. The budget is also the whole bound on how many accounts one
 *  dispatch touches: with the minimum slice below, 240 seconds can reach at most eight of them. */
const SCHEDULER_BUDGET_MS = 240_000;

/** The least time an account is worth STARTING on. Under half a minute there is no room for a renewed
 *  lease and a real bounded unit, so claiming would only park a live lease in front of the operator's own
 *  visit. Nothing is claimed instead, and the account is first in line on the next dispatch. */
const MIN_ACCOUNT_SLICE_MS = 30_000;

/** What one dispatch actually did. Counts only: no account name, no token, no secret. */
export type SchedulerReceipt = { claimed: number; driven: number; remaining: number };

type SchedulerOptions = { now?: () => Date; budgetMs?: number; steps?: Partial<ResearchCycleSteps> };

/**
 * Claim ONE account that still owes work for its current Pacific day, drive it, then claim the next while
 * the budget allows. Returns a receipt of counts.
 *
 * ONE LIVE CLAIM AT A TIME, deliberately. Claiming the batch up front and then driving it serially meant
 * the second and third accounts held live foreign leases for minutes while nothing ran on them, and an
 * operator who opened Beacon in that window was refused by a lease taken on their behalf. An account is
 * now claimed only when this dispatch is about to work on it, and is RELEASED (paused, lease cleared)
 * rather than held if the claim itself spent the last of the budget.
 */
export async function runDueAccounts(options: SchedulerOptions = {}): Promise<SchedulerReceipt> {
  const nowFn = options.now ?? (() => new Date());
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const endsAt = nowFn().getTime() + (options.budgetMs ?? SCHEDULER_BUDGET_MS);
  const ownerToken = newOwnerToken();

  let claimed = 0, driven = 0;
  while (endsAt - nowFn().getTime() >= MIN_ACCOUNT_SLICE_MS) {
    const [run] = await claimDueRuns(ownerToken, 1);
    if (run == null) break; // nothing else is owed, or what is owed is somebody else's live work
    claimed += 1;
    const left = endsAt - nowFn().getTime();
    if (left < MIN_ACCOUNT_SLICE_MS) {
      // The claim itself spent the slice: hand the account back rather than sit on its lease.
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
  if (claimed === 0) log.info("[research-run] the daily dispatch found nothing owed right now", {});
  else log.info("[research-run] daily dispatch done", { claimed, driven });
  return { claimed, driven, remaining: claimed - driven };
}
