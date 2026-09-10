import { getSupabaseAdmin } from "@/lib/persistence/supabase";
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
import { claimDueRuns, finishRun, newOwnerToken, RESEARCH_RUN_LEASE_SECONDS, startExtraPass, type ResearchRun } from "../research-run";
import { driveClaimed, RESEARCH_CYCLE_DEADLINE_MS, type ResearchCycleSteps } from "./on-visit-refresh";
import { defaultSteps } from "./research-steps";

/** The dispatch's OWN wall-clock budget, well inside the hosted function lifetime (800 seconds on Pro with Fluid compute since 2026-09-10), so the HTTP request always returns a receipt instead of being killed mid-account. Each account additionally
 *  gets at most the ordinary RESEARCH_CYCLE_DEADLINE_MS. The budget is also the whole bound on how many accounts one dispatch touches: with the minimum slice below, 240 seconds can reach at most
 *  eight of them. */
const SCHEDULER_BUDGET_MS = RESEARCH_RUN_LEASE_SECONDS * 1000 - 60_000; // derived from the one window source (operator raise, 2026-09-10): a minute inside the 800-second function lifetime, exactly the margin 240 kept inside 300

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

/** Claim ONE account that owes work for its reporting day, drive it, claim the next while the budget allows. ONE LIVE CLAIM AT A TIME: batch-claiming held foreign leases for minutes while nothing ran, and an operator opening Beacon in that window was refused. An account is claimed only when about to be worked, and RELEASED rather than held whenever it cannot be driven to the end. */
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
  const handBack = async (run: { tenant_id: string; id: string; lease_expires_at: string | null; progress?: { funnel?: { spendUsd?: number } } | null }) => {
    // The row keeps its own accumulated spend on the way back: a hand-back is a pause, and a paused row
    // reading $0.00 over a funnel that already spent is the receipt bug this closure removes.
    const ok = await finishRun(run.tenant_id, run.id, ownerToken, "paused", null, Number(run.progress?.funnel?.spendUsd) || 0);
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
    republished.add(tenantId); /** AND THE REBUILD ASKS THIS TICK'S OWN CLOCK BEFORE IT STARTS (live 15:00Z, 2026-09-05). The rebuild reads the account, judges every stored row again and writes one release: measured at 5.8, 7.0 and 22.3 seconds on the three afternoon drives, and begun 71.3, 86.3 and 94.1 seconds AFTER the drive's own deadline every time, because the drive handed its steps the deadline as a budget instead of asking it. On the third the tick was killed by the hosting ceiling six seconds into this rebuild, holding a release half written. WHY THE PRODUCER STILL RUNS INSIDE IT, rather than republishing the rows untouched: this is the one door that turns what the walk just wrote into the release Today and Changes read, and a republish that skipped the judgement would serve copy whose rules moved since it was banked. The second judgement is not what costs: measured over four consecutive drives, the eleven California descriptions and the Pahlavi answer were re-judged and refused twice a drive and not one of them moved a version, and the whole store moved 2, 5, 7 and 3 versions, every one of them the walk's own funded work. What cost was WHEN it ran. The dispatch keeps forty seconds back for this, the drive's deadline is that reserve, and now that every step of the drive asks the deadline the reserve is there by construction, so the first account worked publishes because it is inside the budget rather than because this loop ignores the budget for it. */ if (nowFn().getTime() >= endsAt) return void log.info("[research-run] this tick ran out of its own time before the surface rebuild, so the release on file stands and the next tick rebuilds it", { tenantId, overrunMs: nowFn().getTime() - endsAt });
    try {
      const { readCustomerSurface, isCustomerSurfaceStale, refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
      const held = await runWithTenant(tenantId, () => readCustomerSurface(tenantId));
      if (!held || isCustomerSurfaceStale(held.computedAt, nowFn().getTime())) {
        // THE CROSS-INSTANCE HOLD LIVES INSIDE refreshCustomerSurface NOW, at the one body every entrance
        // shares, so this tick claims nothing of its own: a second dispatcher inside the boundary is handed
        // the release on file instead of duplicating the build, and a nested claim here would only collide
        // with the boundary's own. The pause is read there too, so a paused account's rebuild buys nothing.
        await runWithTenant(tenantId, () => refreshCustomerSurface(tenantId, { maxDrafts: 0 }));
        log.info("[research-run] a paused day still publishes: the stale surface was rebuilt and bought nothing", { tenantId });
      }
    } catch (error) {
      log.warn("[research-run] the stale surface could not republish on this tick", { tenantId, error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
    }
  };
  /** A PAUSED ACCOUNT IS STILL A CUSTOMER: the claim never reaches it, so its surfaces froze at the last
   *  unpaused pass. Bounded per tick, zero spend, no lease taken, failures local to one account. */
  /** ALREADY-BOUGHT TASKS FINISH FOR FREE, PAUSED OR NOT: the pause stranded posted tasks until they expired
   *  provider-side. Bounded per tick, GET-only through collectCapability, nothing posted, nothing reserved;
   *  the republish below rebuilds from what landed. */
  // ONE COLLECTOR, TWO DOORS (falsifier, 2026-09-02): the tick's own copy was the only one, so with hosting paused the tick never ran and 51 already-paid tasks stayed pending for days. It lives beside the other phase bodies now (research-steps' `collectBought`) and the visit cycle runs the same one before it funds any drafting.
  const collectBoughtTasks = async (): Promise<void> => { await defaultSteps.collectBought(Math.max(0, endsAt - nowFn().getTime())); };
  const PAUSED_REPUBLISH_PER_TICK = 3;
  const republishPaused = async (): Promise<void> => {
    try {
      const { data, error } = await getSupabaseAdmin().from("tenants").select("id")
        .eq("status", "active").eq("research_paused", true).order("id", { ascending: true }).limit(PAUSED_REPUBLISH_PER_TICK);
      if (error != null) return void log.warn("[research-run] the paused fleet could not be read, so nothing was republished for it", { error: error.message.slice(0, 160) });
      for (const row of (data ?? []) as Array<{ id: string }>) {
        if (nowFn().getTime() >= endsAt) break;
        // A MARKED CHANGE ON A PAUSED ACCOUNT STILL GETS ITS LIVE CHECK: verification is a bounded $0 public
        // read, and leaving it to the research cycle alone meant a paused account showed wins nothing had
        // verified (operator, 2026-08-21). Same per-pass cap the cycle uses; failures stay local.
        await import("@/domains/measurement/verify-shipment").then((m) => m.verifyDueShipments(String(row.id))).catch(() => 0);
        await republishStale(String(row.id));
      }
    } catch (error) {
      log.warn("[research-run] the paused republish could not run on this tick", { error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
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
    // THE PUBLISH IS RESERVED, NEVER LEFTOVERS. A drive was handed every millisecond that was left, so a tick that
    // worked its whole window reached the republish below with nothing to spend and skipped it, and the customer's
    // Today and Changes kept serving an older release while the store moved underneath them: rows rewritten at
    // 06:59 against a release stamped 06:31 (measured, 2026-08-25). This is the same trailing-surface failure the
    // paused path already fixed, on the SUCCESSFUL path. Research now stops early enough to publish what it found.
    const deadline = nowFn().getTime() + Math.min(RESEARCH_CYCLE_DEADLINE_MS, Math.max(MIN_ACCOUNT_SLICE_MS, left - PUBLISH_RESERVE_MS));
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
  await collectBoughtTasks(); // first the evidence already paid for, so the republish below can use it
  await republishPaused(); // the accounts the claim can never see, and the only work they are owed
  if (claimed === 0) log.info("[research-run] the daily dispatch found nothing owed right now", {});
  else {
    // EVERY ACCOUNT WORKED PUBLISHES INSIDE THE BUDGET, and the first no longer publishes OUTSIDE it: the exception written here bought
    // the customer nothing the reserve was not already buying, and the three drives of 2026-09-05 that overran the deadline by 71, 86 and
    // 94 seconds are exactly the ones where publishing anyway meant a tick killed at the hosting ceiling with the release half written.
    for (const t of worked) await republishStale(t); // the clock is asked once, inside the rebuild, so this path and the paused one cannot answer it differently
    log.info("[research-run] daily dispatch done", { claimed, succeeded, failed, paused });
  }
  return receipt();
}
