import "server-only";

/**
 * due-work (V1 Truth Convergence Phase 5, 2026-07-31) - WHAT IS GENUINELY OWED RIGHT NOW,
 * computed from PERSISTED state only.
 *
 * THE PROBLEM IT EXISTS FOR. One completed UTC-day run meant no more work that day, so
 * evidence bought at 9am sat unused until tomorrow even when it was the one thing a
 * decision was waiting on. A day is not a unit of work; owed work is. This module answers
 * "is anything actually due" from rows already on file - never from a lease, a timer, or a
 * memory of what this process did - so the answer is the same for every request, every
 * instance, and every tab.
 *
 * FIVE SEPARATE CONCEPTS, deliberately not collapsed into one "is it fresh" test, because
 * conflating them is what produced both the same-day stall and the repeat spending:
 *   1. DAILY OBSERVATION ELIGIBILITY - one canonical reading per question, per engine, per
 *      UTC day (plus explicitly granted extras). Owned by the existing planner.
 *   2. EVIDENCE FRESHNESS - a connected source past its sync SLA, and research notes that
 *      moved since the last decide pass (the basis + row-version watermark).
 *   3. CASE LIVENESS - is there a frozen plan at all, and is it bound to the basis this
 *      account holds NOW. A plan frozen under a dead basis is not work, it is debris.
 *   4. BOUNDED ATTEMPTS - what this account already spent its one-per-day allowance on
 *      (the extra-sample grant, a per-case spend cap). Day-scoped markers, so they clear
 *      by rollover instead of by a cleanup pass nobody runs.
 *   5. EXTERNAL WAITS - a retry date I promised. A wait is NEVER due work; it is the
 *      reason nothing is due, and it carries the date I said I would try again.
 *
 * FAIL POSTURE. Every read is fail-soft and the result says whether it could be trusted:
 * `readable` false means I could not judge. The caller decides which way that falls, and
 * the two callers fall opposite ways on purpose: starting an EXTRA same-day pass requires
 * a positive due signal (fail closed, so an unreadable state never re-spends), while
 * finishing a run early requires a positive EMPTY signal (fail open, so an unreadable
 * state never stalls the research).
 */

import { basisTag, getTenant, loadBusinessProfile } from "@/domains/account";
import { getConnectorInfo } from "@/lib/connector-store";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { AUTO_REFRESH_STALE_HOURS, isStale } from "./source-freshness";
import { dailyChecks, utcReportingDay } from "./daily-observations";
import type { ResearchRunProgress } from "../research-run";

/** The logical units of owed work. NOT the executor's phases: the executor still runs its
 *  own ordered cycle, and this only decides whether ANOTHER cycle has anything to do. */
type DuePhase =
  | "refresh_sources"
  | "daily_observations"
  | "plan_cases"
  | "acquire_case_evidence"
  | "decide_and_prepare"
  | "verify_and_measure"
  | "publish_surfaces";

export type DueWork = {
  /** The units that genuinely have work, in the order they would be done. Empty = nothing owed. */
  due: DuePhase[];
  /** false = I could not read enough of the durable state to judge. Never a silent "nothing due". */
  readable: boolean;
  /** Today's AI checks, from the planner: how many of today's canonical readings have landed. */
  checks: { done: number; total: number };
  /** The frozen plan's topics: how many may be read now, how many are waiting on a promised date. */
  cases: { active: number; parked: number };
  /** The earliest date something waiting becomes legal again, or null when nothing is waiting. */
  nextDueAt: string | null;
  /** The research notes' current row version for the account's basis, or null when unreadable.
   *  The pass that decides off these notes stamps this as its watermark, which is what lets the
   *  NEXT pass tell new evidence from a repeat of the same question. */
  evidenceVersion: number | null;
};

/** The connector-store providers a refresh pulls (Wix is publish-only). */
const READ_PROVIDERS = ["google_gsc", "google_ga4", "clarity"] as const;

/** The account's CURRENT onboarding basis: the one fingerprint every derived read and write
 *  is scoped to. Null = not resolvable, which is a stop, never a default. */
export async function accountBasis(tenantId: string): Promise<string | null> {
  try {
    const account = await getTenant(tenantId);
    if (!account?.domain?.trim()) return null;
    return basisTag(account.id, account.domain.trim(), await loadBusinessProfile(tenantId), account.growth_goal ?? null);
  } catch {
    return null;
  }
}

/** How many CONNECTED read sources are past their sync SLA right now. */
async function staleSourceCount(tenantId: string, now: Date): Promise<number> {
  const infos = await Promise.all(READ_PROVIDERS.map(async (p) => {
    try { return { p, info: await getConnectorInfo(p, tenantId) }; } catch { return { p, info: null }; }
  }));
  return infos.filter(({ p, info }) => info?.status === "connected" && isStale(info.last_synced_at, AUTO_REFRESH_STALE_HOURS[p], now)).length;
}

/** The account's latest run row, lean projection (never the whole history). */
async function latestRunFacts(tenantId: string): Promise<{ progress: ResearchRunProgress; open: boolean } | null> {
  const { data, error } = await getSupabaseAdmin().from("research_runs")
    .select("progress,status").eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error != null) throw new Error(error.message ?? String(error));
  if (data == null) return null;
  const row = data as { progress: ResearchRunProgress | null; status: string };
  return { progress: row.progress ?? {}, open: row.status === "running" || row.status === "paused" };
}

/** The research document's row version for THIS basis, read WITHOUT the document itself: the
 *  watermark that says "the notes moved", not the notes. */
export async function evidenceRowVersion(tenantId: string, basis: string): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin().from("research_state")
    .select("row_version").eq("tenant_id", tenantId).eq("basis_tag", basis).maybeSingle();
  if (error != null || data == null) return null;
  return Number((data as { row_version: number }).row_version) || 0;
}

/** How many applied changes have a measurement window that can run now. */
async function measurableCount(tenantId: string, now: Date): Promise<number> {
  const [{ loadShippedChangesForTenant, readLastFinalizedDate }, { isDueForMeasure }] = await Promise.all([
    import("@/domains/measurement/proof-gsc"),
    import("@/domains/measurement/proof-gsc/measure-lifecycle"),
  ]);
  const [records, lastFinal] = await Promise.all([loadShippedChangesForTenant(tenantId), readLastFinalizedDate(tenantId)]);
  return records.filter((r) => isDueForMeasure(r, lastFinal, now)).length;
}

/** How many changes the operator marked implemented that I have never checked on their live page. A
 *  shipment with no verification on file is owed work in its own right: measurement does not start until
 *  the implementation is verified or explicitly operator-confirmed, so an unverified shipment is a
 *  measurement that can never begin. Lean: it asks for ONE row, because one is enough to owe the work. */
async function unverifiedShipmentCount(tenantId: string): Promise<number> {
  const { shipmentsAwaitingVerification } = await import("@/domains/measurement/verify-shipment");
  return (await shipmentsAwaitingVerification(tenantId, 1)).length;
}

/** Is the published customer release genuinely stale (or missing)? */
async function surfaceIsStale(tenantId: string, nowMs: number): Promise<boolean> {
  const { readCustomerSurface, isCustomerSurfaceStale } = await import("@/app/(shell)/surface-release");
  const surface = await readCustomerSurface(tenantId).catch(() => null);
  return surface == null || isCustomerSurfaceStale(surface.computedAt, nowMs);
}

type DueWorkDeps = {
  staleSources?: (tenantId: string, now: Date) => Promise<number>;
  checks?: (tenantId: string, day: string) => Promise<{ done: number; total: number; due: number } | null>;
  run?: (tenantId: string) => Promise<{ progress: ResearchRunProgress; open: boolean } | null>;
  basis?: (tenantId: string) => Promise<string | null>;
  evidenceVersion?: (tenantId: string, basis: string) => Promise<number | null>;
  surfaceStale?: (tenantId: string, nowMs: number) => Promise<boolean>;
  measurable?: (tenantId: string, now: Date) => Promise<number>;
  unverified?: (tenantId: string) => Promise<number>;
};

const settled = async <T,>(p: Promise<T>, fallback: T): Promise<{ value: T; ok: boolean }> =>
  p.then((value) => ({ value, ok: true })).catch(() => ({ value: fallback, ok: false }));

/**
 * WHAT IS OWED RIGHT NOW for one account. Bounded, parallel, fail-soft, and free: every read
 * is a lean projection of state already on file, and nothing here calls a provider or spends
 * a cent. Requires an explicit tenant.
 */
export async function dueWork(tenantId: string, now: Date = new Date(), deps: DueWorkDeps = {}): Promise<DueWork> {
  const empty: DueWork = { due: [], readable: false, checks: { done: 0, total: 0 }, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null };
  if (!tenantId?.trim()) return empty;
  const nowMs = now.getTime();
  const day = utcReportingDay(nowMs);

  const [sources, checks, run, basis] = await Promise.all([
    settled((deps.staleSources ?? staleSourceCount)(tenantId, now), 0),
    settled((deps.checks ?? (async (t, d) => {
      const c = await dailyChecks(t, d);
      return c == null ? null : { done: c.done, total: c.total, due: c.due.length };
    }))(tenantId, day), null as { done: number; total: number; due: number } | null),
    settled((deps.run ?? latestRunFacts)(tenantId), null as { progress: ResearchRunProgress; open: boolean } | null),
    settled((deps.basis ?? accountBasis)(tenantId), null as string | null),
  ]);

  const [version, surface, measurable, unverified] = await Promise.all([
    basis.value ? settled((deps.evidenceVersion ?? evidenceRowVersion)(tenantId, basis.value), null as number | null) : Promise.resolve({ value: null, ok: false }),
    settled((deps.surfaceStale ?? surfaceIsStale)(tenantId, nowMs), false),
    settled((deps.measurable ?? measurableCount)(tenantId, now), 0),
    settled((deps.unverified ?? unverifiedShipmentCount)(tenantId), 0),
  ]);

  const progress = run.value?.progress ?? {};
  const focus = progress.focus ?? null;
  // 3. CASE LIVENESS. A plan frozen under another basis names topics this account no longer
  //    holds the retry memory for, so it is not a plan I may act on.
  const bound = !!focus && !!basis.value && focus.basis === basis.value;
  const topics = bound ? focus!.topics : [];
  // 5. EXTERNAL WAITS. A promised retry date is the reason nothing is due, never work.
  const parked = topics.filter((t) => !!t.retryAfter && Date.parse(t.retryAfter) > nowMs);
  // A FROZEN PLAN IS NOT A STANDING DEBT. The pass that froze it CONSUMED it: to a completed run the
  // plan is a receipt, not a queue. Reading it as owed work meant an account whose plan named a topic
  // nothing could satisfy opened a full pass on every navigation, all day, forever. A topic is owed on
  // exactly two proofs: a retry date I promised has actually ARRIVED, or the run that froze the plan is
  // still OPEN and genuinely owes the work. Never merely because a finished pass once wrote it down.
  const arrived = (t: { retryAfter?: string | null }): boolean => !!t.retryAfter && Date.parse(t.retryAfter) <= nowMs;
  const openRun = run.value?.open === true;
  const active = topics.filter((t) => !parked.includes(t) && (!!t.query || !!t.requirement) && (openRun || arrived(t)));
  const nextDueAt = parked.map((t) => t.retryAfter!).sort()[0] ?? null;

  // 2. EVIDENCE FRESHNESS as a WATERMARK, not as a feeling: the research notes moved past the version
  //    the last decide pass ran against, or no pass has ever decided under the basis this account holds
  //    now. NOT "the notes exist" and NOT "a day passed": a pass that concluded stamps what it consumed,
  //    so re-asking the same question of unchanged notes is never owed and never charged for.
  const decided = progress.decided ?? null;
  const notesMoved = version.value != null
    && (decided == null || decided.basis !== basis.value || decided.rowVersion < version.value);

  const due: DuePhase[] = [];
  if (sources.value > 0) due.push("refresh_sources");
  if ((checks.value?.due ?? 0) > 0) due.push("daily_observations");
  // A plan is owed when the notes moved (what is stuck may have changed) or when a run is still OPEN and
  // has no plan bound to this basis: that run genuinely owes one. An idle account with no plan owes
  // nothing, because re-planning unchanged notes reaches the identical answer at the same price.
  if (notesMoved || (openRun && !bound)) due.push("plan_cases");
  if (active.length > 0) due.push("acquire_case_evidence");
  if (notesMoved) due.push("decide_and_prepare");
  // TWO SEPARATE DEBTS UNDER ONE NAME, and the first one gates the second: a change I have never checked on
  // the live page cannot be measured at all, and a change whose window has closed is owed its read. Either
  // one makes the unit due; neither costs anything to answer.
  if (measurable.value > 0 || unverified.value > 0) due.push("verify_and_measure");
  if (surface.value) due.push("publish_surfaces");

  // Trustworthy ONLY when the two reads every rule leans on came back: the run row (the frozen
  // plan, the watermarks, the day-scoped markers) and the day's check plan. A list built on a
  // read that failed is not a shorter answer, it is a different question, so it is not returned
  // at all: an unreadable state says exactly that and lets the caller decide.
  const readable = run.ok && checks.value != null;
  if (!readable) log.debug("[due-work] durable state unreadable; the caller decides which way that falls", { tenantId });
  return {
    due: readable ? due : [], readable,
    checks: { done: checks.value?.done ?? 0, total: checks.value?.total ?? 0 },
    cases: { active: active.length, parked: parked.length },
    nextDueAt,
    evidenceVersion: version.value,
  };
}
