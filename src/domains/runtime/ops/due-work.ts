import "server-only";

/**
 * due-work (V1 Truth Convergence Phase 5, 2026-07-31) - WHAT IS GENUINELY OWED RIGHT NOW, computed from PERSISTED state only. A day is not a unit of
 * work; owed work is. Every answer comes off rows already on file, never a lease, a timer, or a memory of what this process did, so it is the same for
 * every request, every instance, every tab, and for the daily scheduler as for a visit.
 *
 * FIVE SEPARATE CONCEPTS, deliberately not collapsed into one "is it fresh" test, because conflating them is what produced both the same-day stall and
 * the repeat spending. (1) DAILY OBSERVATION ELIGIBILITY: one canonical reading per question, per engine, per reporting day, plus explicitly granted
 * extras, owned by the existing planner. (2) EVIDENCE FRESHNESS: a connected source past its sync SLA, and research notes that moved since the last
 * decide pass (the basis and row-version watermark). (3) CASE LIVENESS: is there a frozen plan at all, and is it bound to the basis this account holds
 * NOW, because a plan frozen under a dead basis is not work but debris. (4) BOUNDED ATTEMPTS: what this account already spent its one-per-day allowance
 * on, in day-scoped markers that clear by rollover instead of by a cleanup pass nobody runs. (5) EXTERNAL WAITS: a retry date I promised, which is NEVER
 * due work but the reason nothing is due, carrying the date I said I would try again.
 *
 * FAIL POSTURE. `readable` false means I could not judge, and EVERY read this answer leans on must come back for it to be true. The two callers fall
 * opposite ways on purpose: starting an EXTRA same-day pass requires a positive due signal (fail closed, so an unreadable state never re-spends), while
 * finishing a run early requires a positive EMPTY signal (fail open, so an unreadable state never stalls the research).
 */

import { basisTag, getTenant, loadBusinessProfile } from "@/domains/account";
import { getConnectorInfo } from "@/lib/connector-store";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { AUTO_REFRESH_STALE_HOURS, isStale } from "./source-freshness";
import { reportingDay } from "@/lib/reporting-day";
import { dailyChecks } from "./daily-observations";
import type { ResearchRunProgress } from "../research-run";

/** The logical units of owed work. NOT the executor's phases: a fresh daily cycle still runs its own ordered
 *  sequence. What these DO decide, when a RECOVERY pass is opened on them, is which phases that pass may run
 *  at all: a pass opened to read stored answers has no business re-buying keywords, results pages or winners. */
export type DuePhase =
  | "refresh_sources"
  | "crawl_pages"
  | "daily_observations"
  | "analyze_answers"
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
  /** Today's AI checks, from the planner: how many of today's readings are SETTLED of how many are owed,
   *  and how those settled ones landed (an answer, an engine with nothing to give, an engine I cannot ask). */
  checks: { done: number; total: number; answers: number; unavailable: number; unsupported: number };
  /** The frozen plan's topics: how many may be read now, how many are waiting on a promised date. */
  cases: { active: number; parked: number };
  /** The earliest date something waiting becomes legal again, or null when nothing is waiting. */
  nextDueAt: string | null;
  /** The research notes' current row version for the account's basis, or null when unreadable. The pass that decides off these notes stamps this as its
   * watermark, which is what lets the NEXT pass tell new evidence from a repeat of the same question. */
  evidenceVersion: number | null;
};

/** Nothing owed and nothing landed: the shape every fail-soft answer falls back to. */
const NO_CHECKS = { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 } as const;

/** WHAT A STALE SOURCE MAY OPEN A PASS ON ITS OWN. Search Console alone: it is the only source a change is ever argued from. GA4 and Clarity are MODIFIERS
 *  reporting what people did once they had already arrived, and letting either open work by itself woke the whole run for a number no decision rests on.
 *  The refresh step still pulls EVERY connected source whenever a pass runs for any other reason, so nothing goes unrefreshed. Only the trigger narrows. */
const DUE_TRIGGER_PROVIDERS = ["google_gsc"] as const;
/** How many reporting days back the unread-answer probe looks, held identical to answer-readback's own window (the probe opens the pass, the readback
 *  reads one day of it), and a test pins both to the same first day so the two can never drift apart. The probe ALSO asks the same hourly-rotating older
 *  window the readback reads, because a quiet account with only old debt would otherwise never open the pass that reaches it. */
const UNREAD_WINDOW_DAYS = 7, UNREAD_LOOKBACK_WINDOWS = 26, UNREAD_ROTATION_MS = 3_600_000;

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

/** THE OPERATOR'S OWN OFF SWITCH for daily research, read and written in the one place that answers "is anything owed". It is a column of its own
 * (tenants.research_paused), never an overload of the account status: pausing research must not suspend the account. Both doors honour it, the fleet
 * enumeration in its WHERE clause and the visit path through this read. RESUME NEVER BACKFILLS: the planner only ever asks what TODAY owes, so days that
 * passed while research was paused stay unplanned and unbought, forever. Fail-soft on read (a database I cannot reach is not evidence the operator paused
 * anything, and the claim below is guarded anyway); honest on write, so no surface may claim a pause the database never took. */
export async function isResearchPaused(tenantId: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin().from("tenants").select("research_paused").eq("id", tenantId).maybeSingle();
    if (error != null || data == null) return false;
    return (data as { research_paused: boolean | null }).research_paused === true;
  } catch { return false; }
}

/** Turn the daily research run off or on for one account. True = the database holds the new answer, PROVED by the row it handed back. An update that matched
 * nothing answers 204 with no error at all, so a bare "no error" reported success over a database that never heard of this account and the switch flipped on
 * screen for the rest of the day. Row or nothing. */
export async function setResearchPaused(tenantId: string, paused: boolean): Promise<boolean> {
  if (!tenantId?.trim()) return false;
  try {
    const { data, error } = await getSupabaseAdmin().from("tenants").update({ research_paused: paused }).eq("id", tenantId).select("id");
    if (error != null) {
      log.warn("[due-work] the research pause switch did not land, so nothing changed", { tenantId, error: error.message ?? String(error) });
      return false;
    }
    if (!Array.isArray(data) || data.length === 0) {
      log.warn("[due-work] the research pause switch matched no account, so nothing changed", { tenantId });
      return false;
    }
    return true;
  } catch (error) {
    log.warn("[due-work] the research pause switch could not be written", { tenantId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** IS ANY PAGE OF THIS ACCOUNT'S OWN WEBSITE OWED A READ? One bounded question to the durable inventory, which answers in exactly the crawl's own priority
 * order: never-read pages first, then reads gone stale past the 30-day ladder, then pages that refused us whose promised retry date has arrived. One row is
 * the whole answer, so this is the cheapest read on this path. Free, fail-soft, and it fetches nothing from the website itself. */
async function pagesAwaitCrawl(tenantId: string, now: Date): Promise<boolean> {
  const { nextCrawlCandidates } = await import("@/domains/evidence/scanning/owned-pages-store");
  return (await nextCrawlCandidates(tenantId, 1, now)).length > 0;
}

/** ANSWERS ALREADY BOUGHT THAT NOBODY HAS READ CLOSELY, over a BOUNDED WINDOW of recent days rather than today alone. A day can be fully COLLECTED and
 *  still owe every verdict on it, and a probe that only ever asked about today meant a day whose answers were bought and never read could requeue only
 *  if a pass happened to run on that same day: the day before it was unreachable forever. The window length is answer-readback's own (seven days), and
 *  the pass it opens reads ONE day of it. Lean projection on purpose (identity, status, the two settlement hashes; never the answer text or the
 *  journey). Free, and it calls nothing. */
async function answersAwaitAnalysis(tenantId: string, fromDay: string, toDay: string): Promise<boolean> {
  const { isAnalysisSettled, readAiObservations } = await import("@/domains/evidence");
  return (await readAiObservations(tenantId, { fromDay, toDay, projection: "outcome" })).some((r) => r.status === "observed"
    && r.answer_hash != null && !isAnalysisSettled({ analysis: r.analysis, analysisHash: r.analysis_hash ?? null, answerHash: r.answer_hash ?? null }));
}

/** The unread probe over BOTH windows the readback reads: the recent seven days, and the hourly-rotating
 *  older seven wrapping at 26 weeks (answer-readback's own formula), so old debt on an otherwise quiet
 *  account still opens the pass that reaches it. Two lean reads, short-circuiting on the first hit. */
async function probeUnread(ask: (t: string, from: string, to: string) => Promise<boolean>, tenantId: string, nowMs: number, day: string): Promise<boolean> {
  // Day labels move by plain label arithmetic anchored at noon UTC, the readback's own method, so a
  // daylight-saving edge can never make the probe and the reader disagree about a window's first day.
  const minus = (n: number): string => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  if (await ask(tenantId, minus(UNREAD_WINDOW_DAYS - 1), day)) return true;
  const back = UNREAD_WINDOW_DAYS * (Math.floor(nowMs / UNREAD_ROTATION_MS) % UNREAD_LOOKBACK_WINDOWS);
  if (back === 0) return false; // the rotated window IS the recent one this hour
  return ask(tenantId, minus(back + UNREAD_WINDOW_DAYS - 1), minus(back));
}

/** How many CONNECTED trigger sources are past their sync SLA right now. A READ THAT FAILED IS NOT A FRESH SOURCE: this swallowed its own failure per
 *  provider, so an unreachable connector store counted as zero stale sources and this leg could never tell dueWork it was blind. It throws now. */
const staleSourceCount = async (tenantId: string, now: Date): Promise<number> =>
  (await Promise.all(DUE_TRIGGER_PROVIDERS.map(async (p) => ({ p, info: await getConnectorInfo(p, tenantId) }))))
    .filter(({ p, info }) => info?.status === "connected" && isStale(info.last_synced_at, AUTO_REFRESH_STALE_HOURS[p], now)).length;

/** The account's latest run row, lean projection (never the whole history). */
async function latestRunFacts(tenantId: string): Promise<{ progress: ResearchRunProgress; open: boolean } | null> {
  const { data, error } = await getSupabaseAdmin().from("research_runs")
    .select("progress,status").eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error != null) throw new Error(error.message ?? String(error));
  if (data == null) return null;
  const row = data as { progress: ResearchRunProgress | null; status: string };
  return { progress: row.progress ?? {}, open: row.status === "running" || row.status === "paused" };
}

/** The research document's row version for THIS basis, read WITHOUT the document itself: the watermark that says "the notes moved", not the notes. */
export async function evidenceRowVersion(tenantId: string, basis: string): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin().from("research_state")
    .select("row_version").eq("tenant_id", tenantId).eq("basis_tag", basis).maybeSingle();
  if (error != null || data == null) return null;
  return Number((data as { row_version: number }).row_version) || 0;
}

/** THE TWO MEASUREMENT DEBTS, off ONE read of the ledger. They used to be two independent probes and the ledger came back twice per due-work call, doubling
 * the egress of the biggest read on this path for a count. They are also the same debt in sequence: `unverified` is a change I have never checked on the live
 * page, and until that check lands `isDueForMeasure` refuses to measure it at all, so the first number gates the second. Free either way, and fail-soft to
 * zero through the caller's `settled`. */
async function measurementDebt(tenantId: string, now: Date): Promise<{ measurable: number; unverified: number }> {
  const [{ loadShippedChangesForTenant, readLastFinalizedDate }, { isDueForMeasure }] = await Promise.all([
    import("@/domains/measurement/proof-gsc"),
    import("@/domains/measurement/proof-gsc/measure-lifecycle"),
  ]);
  const [records, lastFinal] = await Promise.all([loadShippedChangesForTenant(tenantId), readLastFinalizedDate(tenantId)]);
  // THE REPORTING DAY (src/lib/reporting-day.ts holds the contract), not the UTC one: a recheck promised
  // for the 4th became legal at 5 PM on the 3rd.
  const today = reportingDay(now.getTime());
  return {
    measurable: records.filter((r) => isDueForMeasure(r, lastFinal, now)).length,
    // Never checked, or a site that did not answer whose one promised retry day has arrived: the same
    // rule the verifier itself applies, read off the rows already in hand.
    unverified: records.filter((r) => !!r.implementedAt
      && (r.verification == null || (!!r.verification.recheckAfter && today >= r.verification.recheckAfter))).length,
  };
}

/** Is the published customer release genuinely stale (or missing)? A read I could not make is neither, so it THROWS and this leg goes unreadable:
 *  readCustomerSurface already separates "no release yet" (null) from "I could not read it", and swallowing that here erased the distinction again. */
async function surfaceIsStale(tenantId: string, nowMs: number): Promise<boolean> {
  const { readCustomerSurface, isCustomerSurfaceStale } = await import("@/app/(shell)/surface-release");
  const surface = await readCustomerSurface(tenantId);
  return surface == null || isCustomerSurfaceStale(surface.computedAt, nowMs); }

type DueWorkDeps = {
  staleSources?: (tenantId: string, now: Date) => Promise<number>;
  checks?: (tenantId: string, day: string) => Promise<(DueWork["checks"] & { due: number }) | null>;
  run?: (tenantId: string) => Promise<{ progress: ResearchRunProgress; open: boolean } | null>;
  basis?: (tenantId: string) => Promise<string | null>;
  evidenceVersion?: (tenantId: string, basis: string) => Promise<number | null>;
  surfaceStale?: (tenantId: string, nowMs: number) => Promise<boolean>;
  debt?: (tenantId: string, now: Date) => Promise<{ measurable: number; unverified: number }>;
  pagesToCrawl?: (tenantId: string, now: Date) => Promise<boolean>;
  answersToAnalyze?: (tenantId: string, fromDay: string, toDay: string) => Promise<boolean>;
};

const settled = async <T,>(p: Promise<T>, fallback: T): Promise<{ value: T; ok: boolean }> =>
  p.then((value) => ({ value, ok: true })).catch(() => ({ value: fallback, ok: false }));

/** WHAT IS OWED RIGHT NOW for one account. Bounded, parallel, fail-soft, and free: every read is a lean projection of state already on file, and nothing here
 * calls a provider or spends a cent. Requires an explicit tenant. */
export async function dueWork(tenantId: string, now: Date = new Date(), deps: DueWorkDeps = {}): Promise<DueWork> {
  const empty: DueWork = { due: [], readable: false, checks: NO_CHECKS, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null };
  if (!tenantId?.trim()) return empty;
  const nowMs = now.getTime();
  // THE REPORTING DAY, and src/lib/reporting-day.ts is the one place that defines it (V1 binds every account to the same zone; there is no per-account
  // midnight to honour). Judging owed work against a UTC day meant that for the last seven hours of every day Beacon asked "what is owed" about tomorrow
  // while the person reading it was still in today. Days already stored under a UTC label are history and are never rewritten: where the labels land on the
  // same day, the readings on file just mean that work is done.
  const day = reportingDay(nowMs);

  const [sources, checks, run, basis] = await Promise.all([
    settled((deps.staleSources ?? staleSourceCount)(tenantId, now), 0),
    settled((deps.checks ?? (async (t, d) => {
      const c = await dailyChecks(t, d);
      return c == null ? null : { ...c, due: c.due.length };
    }))(tenantId, day), null as (DueWork["checks"] & { due: number }) | null),
    settled((deps.run ?? latestRunFacts)(tenantId), null as { progress: ResearchRunProgress; open: boolean } | null),
    settled((deps.basis ?? accountBasis)(tenantId), null as string | null),
  ]);

  const [version, surface, debt, pages, unread] = await Promise.all([
    // No basis is not a failed read: nothing was asked, so nothing failed, and the basis read above is what says whether it resolved at all.
    basis.value ? settled((deps.evidenceVersion ?? evidenceRowVersion)(tenantId, basis.value), null as number | null) : Promise.resolve({ value: null, ok: true }),
    settled((deps.surfaceStale ?? surfaceIsStale)(tenantId, nowMs), false),
    settled((deps.debt ?? measurementDebt)(tenantId, now), { measurable: 0, unverified: 0 }),
    settled((deps.pagesToCrawl ?? pagesAwaitCrawl)(tenantId, now), false),
    settled(probeUnread(deps.answersToAnalyze ?? answersAwaitAnalysis, tenantId, nowMs, day), false),
  ]);

  const progress = run.value?.progress ?? {};
  const focus = progress.focus ?? null;
  // 3. CASE LIVENESS. A plan frozen under another basis names topics this account no longer
  //    holds the retry memory for, so it is not a plan I may act on.
  const bound = !!focus && !!basis.value && focus.basis === basis.value;
  const topics = bound ? focus!.topics : [];
  // 5. EXTERNAL WAITS. A promised retry date is the reason nothing is due, never work.
  const parked = topics.filter((t) => !!t.retryAfter && Date.parse(t.retryAfter) > nowMs);
  // A FROZEN PLAN IS NOT A STANDING DEBT. The pass that froze it CONSUMED it: to a completed run the plan is a receipt, not a queue. Reading it as owed work
  // meant an account whose plan named a topic nothing could satisfy opened a full pass on every navigation, all day, forever. A topic is owed on exactly two
  // proofs: a retry date I promised has actually ARRIVED, or the run that froze the plan is still OPEN and genuinely owes the work. Never merely because a
  // finished pass once wrote it down.
  const arrived = (t: { retryAfter?: string | null }): boolean => !!t.retryAfter && Date.parse(t.retryAfter) <= nowMs;
  const openRun = run.value?.open === true;
  const active = topics.filter((t) => !parked.includes(t) && (!!t.query || !!t.requirement) && (openRun || arrived(t)));
  const nextDueAt = parked.map((t) => t.retryAfter!).sort()[0] ?? null;

  // 2. EVIDENCE FRESHNESS as a WATERMARK, not as a feeling: the research notes moved past the version the last decide pass ran against, or no pass has ever
  // decided under the basis this account holds now. NOT "the notes exist" and NOT "a day passed": a pass that concluded stamps what it consumed, so re-asking
  // the same question of unchanged notes is never owed and never charged for.
  const decided = progress.decided ?? null;
  const notesMoved = version.value != null
    && (decided == null || decided.basis !== basis.value || decided.rowVersion < version.value);

  const due: DuePhase[] = [];
  if (sources.value > 0) due.push("refresh_sources");
  // THE WEBSITE IS A SOURCE TOO, and reading it is the one piece of evidence nobody else supplies. An account
  // whose inventory still holds pages I have never opened is owed a batch, whatever else is quiet today.
  if (pages.value) due.push("crawl_pages");
  if ((checks.value?.due ?? 0) > 0) due.push("daily_observations");
  // AN ANSWER BOUGHT AND NEVER READ IS OWED WORK. It rides the observation phase, so naming it here OPENS a pass for a day that collected everything and read none.
  if (unread.value) due.push("analyze_answers");
  // A plan is owed when the notes moved (what is stuck may have changed) or when a run is still OPEN and has no plan bound to this basis: that run genuinely
  // owes one. An idle account with no plan owes nothing, because re-planning unchanged notes reaches the identical answer at the same price.
  if (notesMoved || (openRun && !bound)) due.push("plan_cases");
  if (active.length > 0) due.push("acquire_case_evidence");
  if (notesMoved) due.push("decide_and_prepare");
  // TWO SEPARATE DEBTS UNDER ONE NAME, and the first one gates the second: a change I have never checked on
  // the live page cannot be measured at all (isDueForMeasure refuses it), and a change whose window has
  // closed is owed its read. Either one makes the unit due; both come off the one ledger read above.
  if (debt.value.measurable > 0 || debt.value.unverified > 0) due.push("verify_and_measure");
  if (surface.value) due.push("publish_surfaces");

  // Trustworthy ONLY when EVERY read this answer leans on came back. A list built on a read that failed is not a shorter answer, it is a different
  // question, so it is not returned at all. It used to lean on two of the nine, so a crawl debt, a measurement ledger, a surface, a source, a basis or
  // an unread-answer probe that THREW was swallowed into "nothing is due" and the scheduler reported a healthy idle over a day it could not judge. An
  // individually EMPTY signal is untouched by this: zero stale sources is an honest zero, not an outage.
  const readable = run.ok && checks.value != null && sources.ok && basis.ok && version.ok && surface.ok && debt.ok && pages.ok && unread.ok;
  if (!readable) log.debug("[due-work] durable state unreadable; the caller decides which way that falls", { tenantId });
  return {
    due: readable ? due : [], readable,
    checks: checks.value ? { done: checks.value.done, total: checks.value.total, answers: checks.value.answers,
      unavailable: checks.value.unavailable, unsupported: checks.value.unsupported } : NO_CHECKS,
    cases: { active: active.length, parked: parked.length },
    nextDueAt,
    evidenceVersion: version.value,
  };
}
