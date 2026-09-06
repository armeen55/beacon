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
  | "replenish_ready"
  | "refresh_sources"
  | "crawl_pages"
  | "daily_observations"
  | "analyze_answers"
  | "consume_analyses"
  | "plan_cases"
  | "acquire_case_evidence"
  | "read_winner_pages"
  | "check_page_facts"
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
  checks: { done: number; total: number; answers: number; unavailable: number; unsupported: number;
    /** How many already-paid answers are waiting to be read WHEN that backlog is what stopped today's buying. Absent = the meter was read and nothing is blocking. Null = the meter could not be read, which is unknown and never a truthful zero. */
    readingBacklog?: number | null };
  /** The frozen plan's topics: how many may be read now, how many are waiting on a promised date. */
  cases: { active: number; parked: number };
  /** The earliest date something waiting becomes legal again, or null when nothing is waiting. */
  nextDueAt: string | null;
  /** The research notes' current row version for the account's basis, or null when unreadable. The pass that decides off these notes stamps this as its
   * watermark, which is what lets the NEXT pass tell new evidence from a repeat of the same question. */
  evidenceVersion: number | null;
  /** THE PAGES THAT WIN THIS ACCOUNT'S SEARCHES AND HAVE NEVER BEEN READ AS PAGES: the count that makes the read owed, carried on the receipt so a surface can say WHY a pass opened. Null = the research document could not be read, which is unknown and never a truthful zero. */
  winners: { unread: number | null };
};

/** Nothing owed and nothing landed: the shape every fail-soft answer falls back to. */
const NO_CHECKS = { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 } as const;

/** WHAT A STALE SOURCE MAY OPEN A PASS ON ITS OWN. Search Console alone: it is the only source a change is ever argued from. GA4 and Clarity are MODIFIERS
 *  reporting what people did once they had already arrived, and letting either open work by itself woke the whole run for a number no decision rests on.
 *  The refresh step still pulls EVERY connected source whenever a pass runs for any other reason, so nothing goes unrefreshed. Only the trigger narrows. */
const DUE_TRIGGER_PROVIDERS = ["google_gsc"] as const;
/** How many reporting days back the recent unread-answer probe looks, held identical to answer-readback's own window (the probe opens the pass, the
 *  readback reads one day of it). Older debt is ONE indexed existence read over everything before that window, so an account whose only debt is old
 *  still opens the pass that drains it on every probe, not one hour in twenty-six. */
const UNREAD_WINDOW_DAYS = 7;

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
 * passed while research was paused stay unplanned and unbought, forever. THREE STATES, because there are three, and the third one used to be spent through:
 * a switch over PAID work that answered "not paused" whenever the database could not be reached read every outage as permission to buy. Only an explicit,
 * readable false is permission. An error, a thrown client, a missing account row and a null column are all `unreadable`, which is no work at either door,
 * a named log line where the money would have been spent, and no claim of either state on any screen. */
type ResearchPermission = "paused" | "running" | "unreadable";
export async function researchPermission(tenantId: string): Promise<ResearchPermission> {
  try {
    const { data, error } = await getSupabaseAdmin().from("tenants").select("research_paused").eq("id", tenantId).maybeSingle();
    if (error != null || data == null) return "unreadable";
    const flag = (data as { research_paused: boolean | null }).research_paused;
    return flag === true ? "paused" : flag === false ? "running" : "unreadable";
  } catch { return "unreadable"; }
}

/** Turn the daily research run off or on for one account. True = the database holds the new answer, PROVED TWICE. Once by the row the update handed back: an
 * update that matched nothing answers 204 with no error at all, so a bare "no error" reported success over a database that never heard of this account and the
 * switch flipped on screen for the rest of the day. Once more by READING THE SWITCH BACK, because a row that matched is not yet a value that stuck. Row and
 * readback, or nothing. */
export async function setResearchPaused(tenantId: string, paused: boolean): Promise<boolean> {
  if (!tenantId?.trim()) return false;
  try {
    const { data, error } = await getSupabaseAdmin().from("tenants").update({ research_paused: paused }).eq("id", tenantId).select("id");
    if (error != null) { log.warn("[due-work] the research pause switch did not land, so nothing changed", { tenantId, error: error.message ?? String(error) }); return false; }
    if (!Array.isArray(data) || data.length === 0) { log.warn("[due-work] the research pause switch matched no account, so nothing changed", { tenantId }); return false; }
    if (await researchPermission(tenantId) !== (paused ? "paused" : "running")) {
      log.warn("[due-work] the research pause switch did not read back as asked, so no surface may claim it", { tenantId, paused }); return false; }
    // The verified flip settles the spend boundary's memo: a fresh pause refuses the very next paid call.
    const { settleSpendPause } = await import("@/lib/spend-scope");
    settleSpendPause(tenantId, paused);
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
  // ONE indexed existence row, not a paged window walk: the unreadOnly filter rides the partial index, so this probe is lean over ANY range, which is what lets probeUnread ask about the whole store instead of a rotating band.
  const { readAiObservations } = await import("@/domains/evidence");
  return (await readAiObservations(tenantId, { fromDay, toDay, projection: "outcome", unreadOnly: true, limit: 1 })).length > 0;
}

/** THE CANONICAL SETTLED-ANALYSIS FINGERPRINT RIGHT NOW, computed over EXACTLY the rows the harvest consumes:
 *  the stamps come from the same paged walk the canonical loader itself runs (same scope, same latest-per-pair
 *  rule, same page ceiling and early stop), so the fingerprint and the harvest's watermark are incapable of
 *  reading different windows; a one-page copy of that walk lived here once and disagreed forever the moment a
 *  pair's newest answer sat past the first page, which re-opened paid discovery on every probe. null = this
 *  account has no canonical answer at all, which is nothing to consume and therefore never a debt. A read that
 *  FAILED throws, so this leg goes unreadable rather than inventing quiet. */
async function analysisFingerprint(tenantId: string): Promise<string | null> {
  const [{ readCanonicalAnalysisStamps }, { analysisWatermark }] = await Promise.all([
    import("@/domains/evidence/ai-visibility/ai-observations"), import("@/domains/evidence/funnel/state")]);
  const stamps = await readCanonicalAnalysisStamps(tenantId);
  return stamps.length === 0 ? null : analysisWatermark(stamps);
}

/** WHAT THE HARVEST HAS ALREADY CONSUMED, read WITHOUT the research document itself: one small string off a json
 *  path, never the notes. Null = no basis row yet or nothing harvested under it, which is an honest debt. */
async function consumedAnalyses(tenantId: string, basis: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().from("research_state")
    .select("wm:state->discovery->>consumedAnalyses").eq("tenant_id", tenantId).eq("basis_tag", basis).maybeSingle();
  if (error != null) throw new Error(error.message ?? String(error));
  return data == null ? null : ((data as { wm: string | null }).wm ?? null);
}

/** THE WINNERS THIS ACCOUNT HOLDS ON FILE, read WITHOUT the research document itself: one json path off the row (the same array the winning-pages unit loads, and the narrowest read of it there is). A read that FAILED throws, so this leg goes unreadable rather than inventing a quiet zero; no row and no array both mean no winners, an honest none. */
async function winnerRowsOnFile(tenantId: string, basis: string): Promise<readonly unknown[]> {
  const { data, error } = await getSupabaseAdmin().from("research_state")
    .select("winners:state->winningPages").eq("tenant_id", tenantId).eq("basis_tag", basis).maybeSingle();
  if (error != null) throw new Error(error.message ?? String(error));
  const rows = data == null ? null : (data as { winners: unknown }).winners;
  return Array.isArray(rows) ? rows : [];
}

/** PURE. IS THIS WINNER OWED A READ OF THE PAGE ITSELF? A winner banked before the reading existed carries an extract with no words in it at all, and
 *  `pageExtractFromRecord` decodes exactly that row as `mainText` null with `truncated` null; a read that honestly found NO words banks `truncated: false`,
 *  which IS a reading and is never bought again. The other answer is a retry date: a publisher that refused is waiting, and a date that has passed is owed
 *  again. Measured on production 2026-09-06: 20 winners on file, 14 carrying an extract, not one carrying a word, so hub case after hub case settled
 *  terminal against pages nothing had ever read. */
const winnerAwaitsReading = (row: unknown, nowMs: number): boolean => {
  if (row == null || typeof row !== "object") return false;
  const w = row as { extract?: { mainText?: unknown; truncated?: unknown } | null; readOutcome?: { retryAfter?: unknown } | null };
  if (typeof w.extract?.mainText === "string" || typeof w.extract?.truncated === "boolean") return false;
  const retryAfter = w.readOutcome?.retryAfter; return !(typeof retryAfter === "string" && Date.parse(retryAfter) > nowMs);
};

/** The unread probe over BOTH ranges the readback reads: the recent seven days, then EVERYTHING OLDER in one
 *  indexed existence read. The hourly rotation that stood here made each older band reachable roughly one hour
 *  in twenty-six, so an account with only old debt looked quiet on most probes and the pass that would drain it
 *  never opened. Two lean reads, short-circuiting on the first hit. */
async function probeUnread(ask: (t: string, from: string, to: string) => Promise<boolean>, tenantId: string, _nowMs: number, day: string): Promise<boolean> {
  // Day labels move by plain label arithmetic anchored at noon UTC, the readback's own method, so a
  // daylight-saving edge can never make the probe and the reader disagree about a window's first day.
  const minus = (n: number): string => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  if (await ask(tenantId, minus(UNREAD_WINDOW_DAYS - 1), day)) return true;
  return ask(tenantId, minus(365), minus(UNREAD_WINDOW_DAYS));
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
  analysisFingerprint?: (tenantId: string) => Promise<string | null>;
  consumedAnalyses?: (tenantId: string, basis: string) => Promise<string | null>;
  factDebt?: (tenantId: string) => Promise<{ owed: number; everChecked: boolean } | null>;
  winnerRows?: (tenantId: string, basis: string) => Promise<readonly unknown[]>;
  readyStock?: (tenantId: string) => Promise<number | null>;
  creditHeld?: (tenantId: string) => Promise<boolean>;
};

/** THE LOW-STOCK ALARM MINIMUM, and the one place it is written down. AN ALARM, NEVER A TARGET (operator,
 *  2026-08-30): no number of Ready rows is success, a ceiling, or a stopping condition. This level colors
 *  receipts and urgency only; production runs to typed candidate exhaustion whatever the count. Internal:
 *  never a customer setting, never UI. */
export const READY_STOCK_ALARM = 5;

/** THE ALARM LEVEL ADAPTS TO THE OPERATOR'S OWN PACE (operator ruling, 2026-08-29): roughly TWO DAYS of recent applied pace, read off the
 *  shipment ledger at $0, clamped so the urgency signal stays legible. REPORTING ONLY (operator, 2026-08-30): it sizes no batch, closes no
 *  day, funds no manifest, and no gate weakens to reach it. Consumed by receipts and logs alone. */
const READY_FLOOR_MIN = READY_STOCK_ALARM, READY_FLOOR_MAX = 40; export async function readyStockFloor(tenantId: string): Promise<number> {
  const applied = await (async () => { const { loadShippedChangesForTenant } = await import("@/domains/measurement"); const weekAgo = Date.now() - 7 * 86_400_000;
    return (await loadShippedChangesForTenant(tenantId)).filter((r) => { const at = Date.parse(r.implementedAt ?? r.shippedAt ?? ""); return Number.isFinite(at) && at >= weekAgo; }).length; })().catch(() => 0);
  return Math.min(READY_FLOOR_MAX, Math.max(READY_FLOOR_MIN, Math.ceil((applied / 7) * 2))); }

/** How many finished changes THE CUSTOMER CAN SEE right now. $0. Counted off the released queue Today and Changes read, never off raw rows: a row is saved by one act and released by another, so a pass that
 *  persisted three finished changes and published none reported stock 3 against a screen showing 0, and the day closed on work nobody could reach. Undelivered work is not stock. */
async function readyStock(tenantId: string): Promise<number | null> {
  const d = await import("@/domains/decision");
  const basis = await d.resolveCurrentBasis(tenantId).catch(() => null);
  const page = await d.readQueuePage(tenantId, "ready", basis ?? "", 0, 25);
  return d.stockOf(page.rows); // the SAME stock rule the replenish drive reads, or the two doors disagree about whether the day is owed
}

/** CLAIMS THE PAGES MAKE THAT NOBODY HAS CHECKED against a source outside them. */
async function factDebt(tenantId: string): Promise<{ owed: number; everChecked: boolean } | null> {
  const { owedClaimDebt } = await import("@/domains/evidence/pages/fact-checks");
  return owedClaimDebt(tenantId);
}

const settled = async <T,>(p: Promise<T>, fallback: T): Promise<{ value: T; ok: boolean }> =>
  p.then((value) => ({ value, ok: true })).catch(() => ({ value: fallback, ok: false }));

/** WHAT IS OWED RIGHT NOW for one account. Bounded, parallel, fail-soft, and free: every read is a lean projection of state already on file, and nothing here
 * calls a provider or spends a cent. Requires an explicit tenant. */
export async function dueWork(tenantId: string, now: Date = new Date(), deps: DueWorkDeps = {}): Promise<DueWork> {
  const empty: DueWork = { due: [], readable: false, checks: NO_CHECKS, cases: { active: 0, parked: 0 }, nextDueAt: null, evidenceVersion: null, winners: { unread: null } };
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

  const [version, surface, debt, pages, unread, analyses, consumed, facts, winners] = await Promise.all([
    // No basis is not a failed read: nothing was asked, so nothing failed, and the basis read above is what says whether it resolved at all.
    basis.value ? settled((deps.evidenceVersion ?? evidenceRowVersion)(tenantId, basis.value), null as number | null) : Promise.resolve({ value: null, ok: true }),
    settled((deps.surfaceStale ?? surfaceIsStale)(tenantId, nowMs), false),
    settled((deps.debt ?? measurementDebt)(tenantId, now), { measurable: 0, unverified: 0 }),
    settled((deps.pagesToCrawl ?? pagesAwaitCrawl)(tenantId, now), false),
    settled(probeUnread(deps.answersToAnalyze ?? answersAwaitAnalysis, tenantId, nowMs, day), false),
    settled((deps.analysisFingerprint ?? analysisFingerprint)(tenantId), null as string | null),
    // The watermark is basis-scoped like every other derived row, so with no basis there is nothing to compare against and nothing was asked.
    basis.value ? settled((deps.consumedAnalyses ?? consumedAnalyses)(tenantId, basis.value), null as string | null) : Promise.resolve({ value: null, ok: true }),
    settled((deps.factDebt ?? factDebt)(tenantId), null as { owed: number; everChecked: boolean } | null),
    // The winners are basis-scoped like every other derived row, so with no basis there is no research document to hold any and nothing was asked.
    basis.value ? settled((deps.winnerRows ?? winnerRowsOnFile)(tenantId, basis.value), [] as readonly unknown[]) : Promise.resolve({ value: [] as readonly unknown[], ok: true }),
  ]);
  // THE STOCK, AND WHETHER TOPPING IT UP CAN ACHIEVE ANYTHING RIGHT NOW. Both are $0 reads of durable state. The
  // credit stop is asked with the PURE reader, so asking can never spend the probe the transport is owed.
  const [ready, creditHeld] = await Promise.all([
    settled((deps.readyStock ?? readyStock)(tenantId), null as number | null),
    settled((deps.creditHeld ?? (async (t: string) => (await import("@/domains/decision/llm/gateway")).creditBreakerHeld(t)))(tenantId), false),
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
  // 1. THE FINISHED-CHANGE STOCK. A queue under the target is owed work until it reaches the target or a drive
  //    proves nothing can finish, and the day's close is stamped on the run with its reason, so this cannot spin.
  //    While the provider's own credit is spent there is nothing a drive could achieve, so nothing is owed and the
  //    day is NOT closed either: the moment the credit is back this is due again, without waiting for tomorrow.
  // CLOSED means the day's obligation was DISCHARGED, and only two answers do that (see runtime/research-run's `replenish`): the stock reached the target, or every candidate on the current manifest was spent on and none produced. A quota failure, a provider failure or an empty bounded batch leaves it open, so the work is owed again the moment the block lifts.
  // AND A CLOSED DAY REOPENS THE MOMENT ITS ANSWER STOPS BEING TRUE. Two ways that happens. The question changed:
  // the memory is stamped with the basis and the evidence version it was answered under, so fresh evidence for the
  // very same pages makes the stock owed again today rather than tomorrow. Or the stock itself moved: a day closed
  // because it REACHED five says nothing once the operator implements one and four are left, so only a proven
  // exhaustion may hold the day shut (Codex, 2026-08-22).
  const stockClosed = progress.replenish?.day === day && progress.replenish.closed === "candidates_exhausted" // AND WORK A FACT WOKE UP IS WORK STILL OWED, whatever the exhaustion said: that answer was earned before this evidence existed
    && (progress.replenish.awakened ?? []).length === 0 && progress.replenish.closedUnder === `${basis.value ?? ""}::v${version.value ?? ""}`;
  // A COUNT IS NOT A REASON TO STOP WORKING. This asked for a top-up only while the stock sat BELOW five, so an
  // account holding fourteen finished changes was never even asked, and a press returned "nothing due" with real
  // evidenced work standing unwritten. The floor still decides URGENCY everywhere else; what ends the day is a
  // SETTLED MANIFEST, which is what `stockClosed` reads. Unreadable stock still holds, because an unread count is
  // not a proven one.
  if (ready.value != null && !stockClosed && !creditHeld.value) due.push("replenish_ready");
  if (sources.value > 0) due.push("refresh_sources");
  // THE WEBSITE IS A SOURCE TOO, and reading it is the one piece of evidence nobody else supplies. An account
  // whose inventory still holds pages I have never opened is owed a batch, whatever else is quiet today.
  if (pages.value) due.push("crawl_pages");
  if ((checks.value?.due ?? 0) > 0) due.push("daily_observations");
  // AN ANSWER BOUGHT AND NEVER READ IS OWED WORK. It rides the observation phase, so naming it here OPENS a pass for a day that collected everything and read none.
  if (unread.value) due.push("analyze_answers");
  // A READING THAT SETTLED IS EVIDENCE NOBODY HAS SPENT YET. Storing a verdict on an answer moved no keyword, no case
  // and no decision, so an account could read 140 answers a day and decide off none of them. The fingerprint of the
  // canonical set past what the harvest has consumed is that debt, said in one string, and consuming it clears it.
  const analysesMoved = analyses.value != null && analyses.value !== consumed.value;
  if (analysesMoved) due.push("consume_analyses");
  // A plan is owed when the notes moved (what is stuck may have changed) or when a run is still OPEN and has no plan bound to this basis: that run genuinely
  // owes one. An idle account with no plan owes nothing, because re-planning unchanged notes reaches the identical answer at the same price.
  if (notesMoved || (openRun && !bound)) due.push("plan_cases");
  if (active.length > 0) due.push("acquire_case_evidence");
  // A WINNER ON FILE THAT NOTHING HAS READ AS A PAGE IS OWED A READ, whatever the frozen plan is doing: the comparison that settles a body case reads the winners' own words, so an account whose winners were all banked before the reading existed settles case after case as "nothing to say" against pages nobody ever opened.
  // Its OWN unit and deliberately not `acquire_case_evidence`, which costs a results page as well (PHASES_FOR in on-visit-refresh): this pass carries no case and so no focus query, and buying searches out of the broad agenda spends for nothing and can hold the drive in the results-page phase ahead of the read it exists for.
  const unreadWinners = winners.value.filter((w) => winnerAwaitsReading(w, nowMs)).length;
  if (unreadWinners > 0) due.push("read_winner_pages");
  // A CLAIM THE PAGE MAKES AND NOBODY HAS CHECKED IS OWED WORK, and an account that has never checked one owes
  // its first pass. Without this the phase was reachable only on a fresh daily cycle, which is one page's worth
  // of statements a day at best. An unreadable count is never a quiet "nothing owed": it says nothing here.
  // AND NOT WHILE THE PROVIDER THAT HAS TO JUDGE IT IS OUT OF CREDIT. Checking a claim buys a search and a page
  // fetch from one provider and then asks a SECOND one to read them. With the credit stop on, the first two are
  // still bought in full and the unit dies at the judge, so the account pays for evidence nothing can weigh.
  // Live on 2026-08-27: the balance emptied mid-run and the remaining passes bought searches to no purpose.
  if (facts.value && (facts.value.owed > 0 || !facts.value.everChecked) && !creditHeld.value) due.push("check_page_facts");
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
  // ...AND THE FACT DEBT IS ONE OF THEM. It was read, judged and then left out of this line, so a fact-check store that THREW reported a readable day with check_page_facts quietly missing from it: exactly the swallowed outage this rule exists to stop, on the one debt nothing else can infer (Codex, 2026-08-22). The stock and the credit stop join it for the same reason.
  const readable = run.ok && checks.value != null && sources.ok && basis.ok && version.ok && surface.ok && debt.ok && pages.ok && unread.ok && analyses.ok && consumed.ok && facts.ok && ready.ok && creditHeld.ok && winners.ok;
  if (!readable) log.debug("[due-work] durable state unreadable; the caller decides which way that falls", { tenantId });
  return {
    due: readable ? due : [], readable,
    checks: checks.value ? { done: checks.value.done, total: checks.value.total, answers: checks.value.answers,
      unavailable: checks.value.unavailable, unsupported: checks.value.unsupported,
      ...(checks.value.readingBacklog !== undefined ? { readingBacklog: checks.value.readingBacklog } : {}) } : NO_CHECKS,
    cases: { active: active.length, parked: parked.length },
    nextDueAt,
    evidenceVersion: version.value,
    winners: { unread: winners.ok ? unreadWinners : null }, // a count nothing could read is unknown, never zero
  };
}

/** The cheapest paid step a pass can take, used only to ask the budget door a REAL question: it refuses on
 *  `spend + projected > cap`, so a zero probe still answers "allowed" against a ceiling reached to the cent. */
const VISIT_RESEARCH_PROBE_USD = 0.01;
type VisitBudgetProbe = (tenantId: string, projectedCostUsd: number) => Promise<{ allowed: boolean; reason?: string }>;
const defaultVisitBudgetProbe: VisitBudgetProbe = async (tenantId, projectedCostUsd) =>
  (await import("@/domains/decision/llm/adjudicator-budget")).checkBudget({ tenantId, projectedCostUsd });

/** Is this request somebody ARRIVING, or an internal repaint of a page that is already open?
 *
 *  $0 IS A PROPERTY OF THE CONTROL, NOT OF WHAT THE ACCOUNT CAN AFFORD (2026-08-29). visitMayOpenResearch
 *  below answers "can this account pay for research". It cannot answer "did this research start because
 *  somebody pressed a control labelled free", and that second question is the only one a free control can
 *  be judged by. With the month's allowance restored, the free press still ran its refresh, called
 *  router.refresh(), re-rendered the shell, and the shell armed visit recovery, which can open a paid pass
 *  across the whole canonical cycle rather than only its OpenAI half. An affordability gate would have
 *  waved that through, correctly, and the button would still have bought research.
 *
 *  So recovery is tied to an ARRIVAL, for every surface, instead of an exception carved out for one
 *  button. Next.js asks for a page in two shapes: a full document request carries no RSC header, while a
 *  client navigation, a router.refresh() and a Server Action's own response are all RSC payloads, and a
 *  Server Action carries Next-Action besides. Only the first is a person turning up. The scheduler is
 *  untouched and remains what actually drives the day, and an explicit control may still name a spend and
 *  run it. FAIL CLOSED: headers that cannot be read are not an arrival. */
export function isDocumentArrival(h: { get(name: string): string | null } | null | undefined): boolean {
  try { return !!h && !h.get("rsc") && !h.get("next-action"); } catch { return false; }
}

/** May a VISIT open paid research right now? The MONEY gate on the visit door, sitting beside
 *  researchPermission above, which is the CONSENT one.
 *
 *  A VISIT MAY NOT OPEN A PASS THE ACCOUNT CANNOT PAY FOR (2026-08-29). ensureResearchRunOnVisit is the
 *  only paid research trigger a person reaches without asking for one: it fires on every render of the app
 *  shell, including the repaint the $0 "Update data" control asks for when it has finished, and it then
 *  opened a brand-new same-day pass through startExtraPass whenever anything read as due. So a control
 *  that said it pulls numbers could spend the month's allowance, and nothing on screen said so.
 *
 *  The gate at each paid call is still the last line of defence for the money. This is the line that stops
 *  a visit opening work it can only fail, burning the day's extra-pass allowance and leaving a run that
 *  looks alive because the call cache answers before the budget does. It lives here, not inside that
 *  after() callback, because after() is a no-op outside a request scope: a decision left in there can
 *  never be put under test. UNREADABLE MEANS UNAFFORDABLE, a visit that cannot prove the account can pay
 *  does not get to spend on the strength of not knowing. */
export async function visitMayOpenResearch(tenantId: string, probe: VisitBudgetProbe = defaultVisitBudgetProbe): Promise<{ allowed: boolean; reason: string }> {
  const budget = await probe(tenantId, VISIT_RESEARCH_PROBE_USD).catch(() => null);
  if (budget == null) return { allowed: false, reason: "this account's spend could not be read, so no paid research is opened by a visit" };
  return budget.allowed ? { allowed: true, reason: "" } : { allowed: false, reason: budget.reason ?? "this account's model budget is spent" };
}
