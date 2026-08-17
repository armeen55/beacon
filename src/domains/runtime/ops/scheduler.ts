import "server-only";

/** scheduler (2026-08-03) - THE DAILY DISPATCH. Beacon promises a reading of your AI answers every calendar day, and until now a reading only happened because somebody opened the app: an operator who
 *  did not visit on Tuesday simply had no Tuesday. ONE global Supabase pg_cron job POSTs, through pg_net, to ONE guarded non-customer endpoint (src/app/api/cron/scheduler/route.ts), and that endpoint
 *  calls this. No per-account schedule, no queue, no worker fleet, no second orchestrator: this claims ONE account at a time under the SAME database leases a visit claims under and drives it through
 *  the SAME canonical cycle (driveClaimed). SAFE TO FIRE TWICE. claim_due_research_work claims each account through claim_research_run, which takes a per-account advisory lock and refuses a foreign
 *  live lease, and the partial unique index allows at most one unfinished run per account. A duplicate dispatch claims nothing the first one holds and reports zero; a dispatch racing a live visit
 *  loses the same way. A COMPLETED PASS IS NOT A FINISHED DAY, and the claim cannot tell them apart: it excludes an account the moment any run completed today, so a pass that settled its batch and
 *  left the day short went unclaimed and the rest of the day never happened. An empty claim therefore probes who is genuinely short and opens ONE more pass through the shared same-day opener. NEVER:
 *  a continuation hop (browser-recovery machinery), a cent outside the existing per-cycle deadline and spend caps, or a day that has already passed. Resume after a pause picks up TODAY; missed days stay missed. */

import { log } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenant-context";
import { reportingDay } from "@/lib/reporting-day";
import { claimDueRuns, finishRun, newOwnerToken, startExtraPass, type ResearchRun } from "../research-run";
import { driveClaimed, RESEARCH_CYCLE_DEADLINE_MS, type ResearchCycleSteps } from "./on-visit-refresh";
import { defaultSteps } from "./research-steps";

/** The dispatch's OWN wall-clock budget, well inside the 300-second function lifetime, so the HTTP request always returns a receipt instead of being killed mid-account. Each account additionally
 *  gets at most the ordinary RESEARCH_CYCLE_DEADLINE_MS. The budget is also the whole bound on how many accounts one dispatch touches: with the minimum slice below, 240 seconds can reach at most
 *  eight of them. */
const SCHEDULER_BUDGET_MS = 240_000;

/** The least time an account is worth STARTING on. Under half a minute there is no room for a renewed lease and a real bounded unit, so claiming would only park a live lease in front of the
 *  operator's own visit. Nothing is claimed instead, and the account is first in line on the next dispatch. */
const MIN_ACCOUNT_SLICE_MS = 30_000;

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

/** Claim ONE account that still owes work for its current reporting day (America/Los_Angeles until tenant timezones exist: see src/lib/reporting-day.ts), drive it, then claim the next while the
 *  budget allows. ONE LIVE CLAIM AT A TIME, deliberately. Claiming the batch up front and then driving it serially meant the second and third accounts held live foreign leases for minutes while
 *  nothing ran on them, and an operator who opened Beacon in that window was refused by a lease taken on their behalf. An account is now claimed only when this dispatch is about to work on it, and is
 *  RELEASED (paused, lease cleared) rather than held whenever it cannot be driven to the end. */
export async function runDueAccounts(options: SchedulerOptions = {}): Promise<SchedulerReceipt> {
  const nowFn = options.now ?? (() => new Date());
  const steps: ResearchCycleSteps = { ...defaultSteps, ...options.steps };
  const endsAt = nowFn().getTime() + (options.budgetMs ?? SCHEDULER_BUDGET_MS);
  const ownerToken = newOwnerToken();

  let claimed = 0, attempted = 0, succeeded = 0, paused = 0, failed = 0, released = 0;
  const leaseHeldUntil: string[] = [];
  /** WHAT THIS DISPATCH HAS DONE SO FAR, buildable at any moment. The failure path needs it as much as the return does: an account really was driven, and a
   *  throw that carried none of that turned a 503 into "nothing happened", which is its own quiet lie about a day. */
  const receipt = (): SchedulerReceipt => ({ claimed, attempted, succeeded, paused, failed, leaseHeldUntil, released, remaining: claimed - succeeded });
  /** Hand the lease back through the canonical state. Only a finish that did not land is a held lease. */
  const handBack = async (run: { tenant_id: string; id: string; lease_expires_at: string | null }) => {
    const ok = await finishRun(run.tenant_id, run.id, ownerToken, "paused");
    if (!ok) leaseHeldUntil.push(run.lease_expires_at ?? "");
    return ok;
  };

  const worked = new Set<string>();
  /** THE STRANDED DAY, and why it is a SECOND phase of this loop rather than a branch of the claim. The fleet claim excludes an account the moment ANY run completed
   *  today, so a pass that settled its batch and left the day short was owed nothing further and the remaining checks simply never happened. This asks the canonical
   *  planner who is genuinely short and opens ONE more bounded pass through the SAME opener a visit uses; that opener refuses while any run is unfinished, so a
   *  repeat tick and a racing tick open at most one between them, and a terminal day opens nothing at all. */
  const stranded = async (): Promise<ResearchRun | undefined> => {
    const nowMs = nowFn().getTime();
    // A PROBE THAT COULD NOT READ IS NOT AN EMPTY FLEET. This swallowed every failure into an empty list, so an outage, a revoked permission and a genuinely finished
    // fleet were one answer and the dispatch reported a clean 200 over a day nothing was recovered on. The failure travels now, and the endpoint answers 503.
    // THE WORK ALREADY LANDED IS NOT ERASED BY THE PROBE THAT FAILED AFTER IT. The accounts above this line were genuinely claimed and driven, so the receipt
    // goes down as a receipt and rides ON the thrown error, and a caller that must answer 503 can still say what the dispatch actually did before it broke.
    for (const t of await steps.strandedToday(nowMs).catch((error: unknown) => {
      const done = receipt();
      log.warn("[research-run] the recovery probe could not read the fleet, so this dispatch fails; here is what it did land first", done);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { receipt: done }); })) {
      if (worked.has(t.tenantId)) continue;
      // THE PROBE ALREADY KNOWS WHY. It computed this account's due list to decide it was short, and the pass it opens carries that list, so recovery for one
      // debt settles that debt instead of walking a whole research cycle around it.
      const opened = await startExtraPass(t.tenantId, ownerToken, reportingDay(nowMs), undefined, t.due);
      if (opened != null) { log.info("[research-run] today's checks were left short, so I opened one more pass", { tenantId: t.tenantId, due: t.due }); return opened; }
    }
    return undefined; };
  /** The stale-surface republish a paused or failed account still owes its customer: a bounded, zero-dollar
   *  release rebuild, only when the held release is stale, fail-soft with its own log line. */
  const republished = new Set<string>();
  const republishStale = async (tenantId: string): Promise<void> => {
    if (republished.has(tenantId)) return;
    republished.add(tenantId);
    try {
      const { readCustomerSurface, isCustomerSurfaceStale, refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
      const held = await runWithTenant(tenantId, () => readCustomerSurface(tenantId));
      if (!held || isCustomerSurfaceStale(held.computedAt, nowFn().getTime())) {
        await runWithTenant(tenantId, () => refreshCustomerSurface(tenantId, { maxDrafts: 0 }));
        log.info("[research-run] a paused day still publishes: the stale surface was rebuilt at zero dollars", { tenantId });
      }
    } catch (error) {
      log.warn("[research-run] the stale surface could not republish on this tick", { tenantId, error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
    }
  };
  let claiming = true; // the claim comes first; once it drains, or hands back an account already worked, the rest of this dispatch belongs to the probe
  while (endsAt - nowFn().getTime() >= MIN_ACCOUNT_SLICE_MS) {
    let run = claiming ? (await claimDueRuns(ownerToken, 1) as Array<ResearchRun | undefined>)[0] : undefined;
    if (run != null && worked.has(run.tenant_id)) {
      // ONE TURN PER ACCOUNT PER DISPATCH: a paused account is due again the moment it is released, so without this a failing account is re-claimed and
      // re-failed until the budget dies while the fleet waits. Its next turn is the next dispatch's. Ending the whole dispatch here was the second half of
      // that bug: an account the claim can no longer see at all never got probed. The re-claim still lands in a bucket, so receipts sum.
      claimed += 1;
      if (await handBack(run)) paused += 1; else failed += 1;
      claiming = false; run = undefined;
    }
    if (run == null) { claiming = false; run = await stranded(); }
    if (run == null) break; // nothing else is owed, or what is owed is somebody else's live work
    worked.add(run.tenant_id);
    claimed += 1;
    const left = endsAt - nowFn().getTime();
    if (left < MIN_ACCOUNT_SLICE_MS) {
      // The claim spent the slice: never sit on the lease. A hand-back that did not land is a failure.
      if (await handBack(run)) paused += 1; else failed += 1;
      continue;
    }
    attempted += 1;
    const deadline = nowFn().getTime() + Math.min(RESEARCH_CYCLE_DEADLINE_MS, left);
    // THE RECEIPT IS THE DRIVER'S, NOT THIS LOOP'S. driveClaimed answers with the state it durably left on the
    // row, so a provider wait, a phase pause, a basis it could not read and a lease another instance recovered
    // are each counted as themselves. Only a landed completion is a success.
    const outcome = await runWithTenant(run.tenant_id, async () => {
      const work = await steps.dueWork(run.tenant_id, nowFn()).catch(() => null);
      return driveClaimed(run, ownerToken, work, nowFn, deadline, steps);
    }).catch((error) => {
      log.warn("[research-run] the daily dispatch could not finish this account; it resumes on the next one",
        { tenantId: run.tenant_id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      return "failed" as const;
    });
    if (outcome === "completed") { succeeded += 1; continue; }
    // A PAUSED DAY STILL PUBLISHES WHAT IT HOLDS (operator, 2026-08-17: the customer surface trailed the store
    // by ten hours while every tick succeeded). publish_surface is a late phase, so a run paused on the cap
    // never reached it and Today and Changes served yesterday's release all day. A pause now republishes a
    // STALE surface at zero dollars before the tick moves on; fresh releases and failures cost nothing extra.
    if (outcome === "paused") { paused += 1; await republishStale(run.tenant_id); continue; } // the pause landed durably, which released the lease with it
    // A THROW LEAVES A LIVE LEASE the cycle never finished. Returning it is what lets the next dispatch, or the operator's own visit, pick the account up
    // instead of waiting out the lease. A lease another instance already recovered is not mine to hand back, and reporting its expiry would be a second lie.
    failed += 1;
    if (outcome !== "lost_lease" && await handBack(run)) released += 1;
  }
  if (claimed === 0) log.info("[research-run] the daily dispatch found nothing owed right now", {});
  else for (const t of worked) if (nowFn().getTime() < endsAt) await republishStale(t);
  else log.info("[research-run] daily dispatch done", { claimed, succeeded, failed, paused });
  return receipt();
}
