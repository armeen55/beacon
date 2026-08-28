import "server-only";

/**
 * daily-observations - WHAT I ASK THE AI ENGINES TODAY, and what I do with the
 * answers that come back (V1 Truth Convergence Phase 1, 2026-07-31).
 *
 * THE ONE CANONICAL SAMPLE. A tracked question on one engine gets exactly ONE reading per reporting day, and that reading is slot 0.
 * That is the whole trend: one point per question, per engine, per day, so a chart of "how often did the engines name me" compares
 * like with like. Slots 1 and 2 exist for the days an operator wants to see how much an engine wobbles and are NEVER planned
 * automatically, because an unasked second read triples the bill and reweights the average toward whichever question got sampled
 * more. They come only from an explicit ask, only after slot 0 is complete, and never past three.
 *
 * THE REPORTING DAY IS THE OPERATOR'S DAY (Pacific, src/lib/reporting-day.ts): the day the person reading Beacon is actually in, and
 * the day Search Console reports on. It is handed IN by the caller and stored verbatim on every row, so a run and its observations
 * can never disagree about which day they belong to. A MISSED DAY IS GONE and nothing here backfills: if the run never reached a
 * question on Tuesday, Tuesday has no point for it and Wednesday asks about Wednesday, because a hole filled later would put a
 * number on the chart at a date it was never true.
 *
 * A PAIR'S DAY ENDS ONE OF FOUR WAYS and the row says which: `observed` (the answer is in), `unavailable` (the engine had nothing
 * readable to give today), `unsupported` (I cannot ask this engine at all) or `failed` with its retries spent, which I settle to
 * `unavailable` keeping the provider's own reason. The planner reads all four as finished, because a row that only ever says
 * "failed" reads as owed on every look and was re-bought on every pass forever.
 *
 * IDENTITY IS (prompt id, VERSION, engine, day). A wording edit, an engine-set change, an add or a revival bumps the version in
 * prompt-set.ts, so from that day on the question is a NEW series and yesterday's readings are never mixed into it. That is why a
 * rewording shows as a break in the line and not a bend. THE ANALYSIS STEP is the other half and lives in answer-readback.ts (what
 * the answers this plan bought actually said), re-exported from here so every caller of the daily loop keeps one import.
 */

import type { CapabilityKey } from "@/domains/evidence/dataforseo/funnel-boundary";
import type { AiObservationView, DueObservation } from "@/domains/evidence/ai-visibility/ai-observations";
import { log } from "@/lib/logger";
import { patchRunProgress } from "../research-run";
import { readActiveTrackedPrompts, type TrackedQuestion } from "../prompt-set";

export { runAnswerAnalyses, selectAnalysisTargets } from "./answer-readback";

type ObservationEngine = DueObservation["engine"];
/** The engines one tracked question is read on, in the fixed order a plan uses, each mapped to the capability
 *  it is asked THROUGH. The `satisfies` is the derivation, checked by the compiler: take a capability out of
 *  the provider registry and this stops building, so the planner can never keep planning an engine the
 *  registry has no way to ask. Nothing stores a per-pair "impossible forever" flag, because such a flag would
 *  outlive the configuration change that made the engine askable again. */
const ENGINE_CAPABILITY = {
  chatgpt: "llm_scraper_chatgpt", claude: "llm_claude", gemini: "llm_gemini", perplexity: "llm_perplexity",
} as const satisfies Record<ObservationEngine, CapabilityKey>;
const OBSERVATION_ENGINES = Object.keys(ENGINE_CAPABILITY) as readonly ObservationEngine[];

/** Evidence owns both the plan's shape and the reader's view of a stored row, so
 *  a plan hands straight to the observation unit and nothing casts a database row. */
type ObservedSample = AiObservationView;

/** How many engine reads ONE pass may plan. Matches the observation unit's own
 *  per-pass ceiling, so a plan never hands over more work than a pass can do. */
export const DAILY_OBSERVATION_BATCH = 20;
/** The executor's own per-pass perplexity ceiling (observe.ts drains three, then skips). */
const PERPLEXITY_PER_PASS = 3;
/** The hard ceiling on readings of one question, one engine, one day. */
export const MAX_SAMPLES_PER_DAY = 3;
/** How many times ONE pair may be asked AGAIN on the same day after the provider broke on it. Then the row is
 *  settled as unavailable, keeping the provider's own reason, and the day stops re-buying that refusal. */
export const FAILED_RETRIES_PER_DAY = 2;

const pairKey = (promptId: string, version: number, engine: string): string => `${promptId}|${version}|${engine}`;
/** The identity a per-day retry budget is counted against: the pair AND the slot it was asked in. */
const retryKey = (o: { promptId: string; version: number; engine: string; slot: number }): string =>
  `${pairKey(o.promptId, o.version, o.engine)}|${o.slot}`;

/** IS THIS PAIR'S DAY OVER, on the evidence of the row itself? THE ONE PREDICATE, asked by the planner to
 *  decide what is still owed AND by the count to decide what has landed. Two answers to that one question is
 *  exactly how a finished day came to read 139 of 140 forever: the plan knew an honestly unavailable pair was
 *  over, the count only ever accepted an answer, and Today kept asking after nothing was left to ask.
 *  observed = the answer is in. unavailable = the engine had nothing readable to give, and a second ask today
 *  buys the same nothing. unsupported = I cannot ask at all. failed = the provider broke, which IS worth
 *  asking again, but only while the day's retry budget lasts. pending = an ask already in flight, which the
 *  next pass collects for free and therefore must stay in the plan. */
function settledForDay(row: ObservedSample, retriesSpent: number): boolean {
  if (row.status === "observed" || row.status === "unavailable" || row.status === "unsupported") return true;
  return row.status === "failed" && retriesSpent >= FAILED_RETRIES_PER_DAY;}

type ObservationPlanInput = {
  /** The operator's approved questions, each with the series it is on. */
  prompts: readonly TrackedQuestion[];
  /** Stored observations. Rows for `day` decide what is still due; every row
   *  (whatever window the caller read) decides the oldest-missing-first order.
   *  The production read names the day it is planning, so the whole day is in hand. */
  observed: readonly ObservedSample[];
  /** Engines this account can actually be read on. Anything else is EXCLUDED
   *  from the plan; it never blocks the engines that do work. */
  engines?: readonly ObservationEngine[];
  /** Individually unsupported "<promptId>|<engine>" pairs, same rule. */
  unsupportedPairs?: readonly string[];
  /** How many retries each broken pair has already spent TODAY, keyed by `retryKey`. Read off the day's own
   *  memory, never inferred: a row that says `failed` looks identical on its first refusal and its fifth. */
  retries?: Readonly<Record<string, number>>;
  /** How many EXTRA readings per pair the operator has explicitly asked for today (0, 1 or 2). Never
   *  inferred and never defaulted upward: nothing but an explicit ask plans slot 1 or 2. */
  extraSamples?: number;
  maxBatch?: number;};

type Candidate = { prompt: TrackedQuestion; engine: ObservationEngine; slot: 0 | 1 | 2; lastAt: string };

/**
 * PURE. The day's plan.
 *
 * ORDER, in exactly this priority:
 *   1. core questions before everything else,
 *   2. oldest-missing-first: the pair whose most recent reading is oldest goes
 *      first, and a pair never read at all is the oldest there is,
 *   3. the older question (created_at), then its id, then the fixed engine order
 *      chatgpt, claude, gemini, perplexity.
 * Deterministic all the way down, so the same day and the same rows always plan
 * the same work and a retry repeats it rather than reshuffling it.
 */
export function planObservations(day: string, input: ObservationPlanInput): DueObservation[] {
  const engines = (input.engines ?? OBSERVATION_ENGINES).filter((e) => OBSERVATION_ENGINES.includes(e));
  const excluded = new Set(input.unsupportedPairs ?? []);
  const today = input.observed.filter((o) => o.day === day);
  const maxBatch = Math.max(1, input.maxBatch ?? DAILY_OBSERVATION_BATCH);

  // Newest reading per (prompt, version, engine) across every row the caller read.
  const lastAt = new Map<string, string>();
  for (const o of input.observed) {
    const k = pairKey(o.promptId, o.version, o.engine);
    const at = String(o.observedAt ?? o.day ?? "");
    if (at > (lastAt.get(k) ?? "")) lastAt.set(k, at);}
  // Readings whose day is OVER, per pair and per slot: an answer in hand, or an honest terminal state that
  // asking again today cannot improve on.
  const retries = input.retries ?? {};
  const doneToday = new Map<string, Set<number>>();
  for (const o of today) {
    if (!settledForDay(o, retries[retryKey(o)] ?? 0)) continue;
    const k = pairKey(o.promptId, o.version, o.engine);
    const slots = doneToday.get(k) ?? new Set<number>();
    slots.add(o.slot);
    doneToday.set(k, slots);}

  // One canonical reading, plus exactly as many extra ones as were explicitly asked for, never past three.
  const allowed = 1 + Math.min(MAX_SAMPLES_PER_DAY - 1, Math.max(0, Math.trunc(input.extraSamples ?? 0)));
  const candidates: Candidate[] = [];
  for (const prompt of input.prompts) {
    if (!prompt.id || !prompt.text) continue;
    for (const engine of engines) {
      const k = pairKey(prompt.id, prompt.version, engine);
      if (excluded.has(`${prompt.id}|${engine}`)) continue;
      const slots = doneToday.get(k) ?? new Set<number>();
      const at = lastAt.get(k) ?? "";
      // Slot 0 is the canonical daily sample: due whenever today has none.
      if (!slots.has(0)) { candidates.push({ prompt, engine, slot: 0, lastAt: at }); continue; }
      // Slots 1 and 2 only on an explicit ask, only after slot 0 landed, never past three.
      if (slots.size >= allowed) continue;
      const next = slots.has(1) ? 2 : 1;
      candidates.push({ prompt, engine, slot: next as 1 | 2, lastAt: at });}}

  const engineRank = (e: ObservationEngine) => OBSERVATION_ENGINES.indexOf(e);
  candidates.sort((a, b) =>
    Number(b.prompt.core) - Number(a.prompt.core)
    || a.lastAt.localeCompare(b.lastAt)
    || String(a.prompt.createdAt).localeCompare(String(b.prompt.createdAt))
    || a.prompt.id.localeCompare(b.prompt.id)
    || engineRank(a.engine) - engineRank(b.engine));

  // THE PLANNER KNOWS THE EXECUTOR'S CEILINGS. The unit drains at most three perplexity asks per
  // with it. The plan now carries at most one pass's worth of perplexity and fills the rest of the
  // batch with work the pass can actually finish.
  const picked: typeof candidates = []; let perp = 0;
  for (const c of candidates) {
    if (picked.length >= maxBatch) break;
    if (c.engine === "perplexity" && perp >= PERPLEXITY_PER_PASS) continue;
    if (c.engine === "perplexity") perp += 1;
    picked.push(c);}
  // THE REPORTING DAY TRAVELS WITH THE PLAN. The executor stores it verbatim, so a run resumed past midnight
  // lands its rows on the day it was planning for, which is the day the analysis pass then reads.
  return picked.map((c) => ({
    promptId: c.prompt.id, version: c.prompt.version, text: c.prompt.text, engine: c.engine, slot: c.slot, day,}));
}

/** PURE. Is one MORE reading legitimate today, and what would it be. Refuses while today's one canonical
 *  round is unfinished (an extra read of a few questions before every question has one would tilt the day's
 *  average toward whichever ones got sampled twice), and refuses once every pair has three.
 *  `input.extraSamples` is what was ALREADY granted today, so each press asks for exactly one more. */
/** Answers on file carrying text nobody has analysed: one narrow count, no rows read. UNREAD_BACKLOG_MAX is how far the reading may fall behind before the buying stops, about one ordinary day of answers. */
async function unreadAnswerCount(tenantId: string): Promise<number> {
  const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
  const { count, error } = await getSupabaseAdmin().from("ai_observations")
    .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("analysis", null).not("answer_text", "is", null);
  if (error) throw new Error(error.message); return count ?? 0;
}
const UNREAD_BACKLOG_MAX = 200;

export function extraSampleVerdict(day: string, input: ObservationPlanInput): { granted: boolean; reason: string; due: DueObservation[] } {
  const canonical = planObservations(day, { ...input, extraSamples: 0, maxBatch: Number.MAX_SAFE_INTEGER });
  if (canonical.length > 0) {
    return { granted: false, reason: `Today's one reading is still owed on ${canonical.length} question and engine pairs, and an extra read before that is done would tilt today's average. The round finishes first, then a second read is worth taking.`, due: [] };
  }
  const extra = planObservations(day, { ...input, extraSamples: (input.extraSamples ?? 0) + 1 });
  if (extra.length === 0) {
    return { granted: false, reason: `Every question already has ${MAX_SAMPLES_PER_DAY} readings on every engine today, which is as far as one day goes. Your next fresh round starts tomorrow.`, due: [] };
  }
  return { granted: true, reason: `A second reading on ${extra.length} question and engine pairs runs on the next pass.`, due: extra };
}

/**
 * THE DURABLE GRANT. Pressing Update data is the ask, but the readings it authorizes are planned on the
 * NEXT pass, so the answer has to outlive the press: a verdict that reached only a log line authorized
 * nothing, and slots 1 and 2 were unreachable in production. It rides the account's current research run
 * progress (existing row, existing column, no new store). `granted` is how many EXTRA readings per pair the
 * operator asked for on `day`, so a stale grant from yesterday can never spend today's money.
 */
export type ExtraSampleGrant = { day: string; granted: number };

/** WHAT THE DAY ALREADY KNOWS, in ONE read of the account's current run row: the operator's extra-reading
 *  grant, and how many retries each broken pair has already spent. Both are day-stamped, so they clear by
 *  rollover instead of by a cleanup nobody runs, and both are inherited by every pass that opens the same
 *  day (research-run carries them onto a new row), so a second pass never hands out a fresh allowance. */
export type DayMarkers = { extraSamples?: ExtraSampleGrant;
  /** `counts` is how many retries each broken pair has SPENT today; `askedAt` is the ask stamp each count
   *  was last taken against, so a retry is spent when the provider was really asked again and never merely
   *  because a plan named the pair. */
  observationRetries?: { day: string; counts: Record<string, number>; askedAt?: Record<string, string> } };
/** How many pairs one day's retry ledger may name. Bounded so a broken provider cannot inflate a run row. */
const MAX_RETRY_KEYS = 300;

async function latestRunRow(tenantId: string): Promise<{ id: string; progress: Record<string, unknown> } | null> {
  const admin = (await import("@/lib/persistence/supabase")).getSupabaseAdmin();
  const { data, error } = await admin.from("research_runs").select("id,progress")
    .eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error || data == null) return null;
  const row = data as { id: string; progress: Record<string, unknown> | null };
  return { id: String(row.id), progress: row.progress ?? {} };
}

/** null = nothing readable on file. Every marker is validated before it is trusted: a half-written one is
 *  the same as none, never a number a plan then spends against. */
async function readDayMarkers(tenantId: string): Promise<DayMarkers | null> {
  const row = await latestRunRow(tenantId).catch(() => null);
  if (row == null) return null;
  const g = row.progress?.extraSamples as ExtraSampleGrant | undefined;
  const r = row.progress?.observationRetries as NonNullable<DayMarkers["observationRetries"]> | undefined;
  return {
    ...(g && typeof g.day === "string" && Number.isFinite(g.granted) ? { extraSamples: { day: g.day, granted: Math.max(0, Math.trunc(g.granted)) } } : {}),
    ...(r && typeof r.day === "string" && r.counts != null && typeof r.counts === "object"
      ? { observationRetries: { day: r.day, counts: r.counts, ...(r.askedAt != null && typeof r.askedAt === "object" ? { askedAt: r.askedAt } : {}) } } : {}),
  };
}

/** false = the marker was NOT saved, so the operator is told no rather than promised a reading nothing
 *  planned. ONE atomic merge at DATABASE time: rebuilding the whole progress object from a read taken
 *  moments earlier meant a marker write silently erased whatever landed in between, which on this row is the
 *  continuation counter, the frozen focus, the decide watermark and the day's own persisted counts. */
async function writeDayMarkers(tenantId: string, patch: DayMarkers): Promise<boolean> {
  const row = await latestRunRow(tenantId).catch(() => null);
  if (row == null) return false;
  const landed = await patchRunProgress(tenantId, row.id, patch as Record<string, unknown>).catch(() => null);
  return landed != null;
}

type PlannerDeps = {
  readPrompts?: (tenantId: string) => Promise<TrackedQuestion[] | null>;
  readObservations?: (tenantId: string, opts: { day?: string; promptId?: string }) => Promise<readonly ObservedSample[]>;
  readMarkers?: (tenantId: string) => Promise<DayMarkers | null>;
  writeMarkers?: (tenantId: string, patch: DayMarkers) => Promise<boolean>;
  /** Settle a row the day is done retrying. Evidence owns the write; this is the test seam. */
  settle?: (tenantId: string, observationId: string, status: "unavailable" | "unsupported") => Promise<void>;
  /** The engines this account can be read on. Absent = every engine the provider registry can ask today. */
  engines?: readonly ObservationEngine[];
  unsupportedPairs?: readonly string[];
  /** How many already-paid answers are on file that nothing has read yet. The test seam for the backlog gate below. */
  unreadBacklog?: (tenantId: string) => Promise<number>;
  maxBatch?: number;
};

/** Evidence owns the observation store; Runtime asks for it lazily so this module
 *  loads (and every test runs) without touching it. */
async function evidenceObservations() {
  return import("@/domains/evidence/ai-visibility/ai-observations");
}

/** Today's canonical round as a count: how many pairs are SETTLED of how many are owed, and how the settled
 *  ones actually landed. `done` and `total` are what a surface shows; the three below are what makes a day
 *  that did not land 140 answers still readable as finished. */
type DayChecks = { done: number; total: number; answers: number; unavailable: number; unsupported: number };

/** PURE. Every (question, engine) pair that owes a reading today, and how many of them are settled, on the
 *  SAME predicate the planner uses. A pair whose retries ran out is bucketed the way spendFailureBudget is
 *  about to settle it, so the count and the row it will write cannot disagree. */
function checkCounts(day: string, input: Pick<ObservationPlanInput, "prompts" | "observed" | "engines" | "unsupportedPairs" | "retries">): DayChecks {
  const engines = (input.engines ?? OBSERVATION_ENGINES).filter((e) => OBSERVATION_ENGINES.includes(e));
  const excluded = new Set(input.unsupportedPairs ?? []), retries = input.retries ?? {};
  const landed = new Map<string, "answers" | "unavailable" | "unsupported">();
  // A SETTLED ROW IS READ OFF ITS OWN STORED STATUS, never re-derived from today's engine list: that list is
  // exactly what an unsupported row is missing from, so "I cannot ask" was a state the count could never
  // reach and the pair vanished from the day it was owed on.
  const closed = new Map<string, ObservationEngine[]>();
  for (const o of input.observed) {
    if (o.day !== day || o.slot !== 0 || !settledForDay(o, retries[retryKey(o)] ?? 0)) continue;
    const how = o.status === "observed" ? "answers" : o.status === "unsupported" ? "unsupported" : "unavailable";
    landed.set(pairKey(o.promptId, o.version, o.engine), how);
    if (how === "unsupported" && !engines.includes(o.engine as ObservationEngine)) {
      const k = `${o.promptId}|${o.version}`;
      closed.set(k, [...(closed.get(k) ?? []), o.engine as ObservationEngine]);
    }
  }
  const out: DayChecks = { done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0 };
  for (const p of input.prompts) {
    if (!p.id || !p.text) continue;
    // Every engine still askable, plus one this day asked and closed as unaskable: both were owed today.
    for (const engine of [...engines, ...(closed.get(`${p.id}|${p.version}`) ?? [])]) {
      if (excluded.has(`${p.id}|${engine}`)) continue;
      out.total += 1;
      const how = landed.get(pairKey(p.id, p.version, engine));
      if (how != null) { out.done += 1; out[how] += 1; }
    }
  }
  return out;
}

/** THE ENGINES THE PROVIDER REGISTRY CAN ACTUALLY ASK, derived from the registry itself at the moment the
 *  plan is made. An engine whose capability is not wired is excluded from every plan while that is true and
 *  planned again the day it returns, so nothing has to store an "impossible forever" flag that would outlive
 *  the configuration change. Loaded lazily, exactly like the observation store, so this module (and every
 *  test of it) keeps loading without the provider transport; unreadable means I exclude nobody. */
async function registryEngines(): Promise<readonly ObservationEngine[]> {
  try {
    const { capabilityAskable } = await import("@/domains/evidence/dataforseo/funnel-boundary");
    return OBSERVATION_ENGINES.filter((e) => capabilityAskable(ENGINE_CAPABILITY[e]));
  } catch {
    return OBSERVATION_ENGINES;
  }
}

/** Everything one day's decision needs, read ONCE: the approved questions, the day's own readings, the
 *  engines I can ask, and what the day already knows. `null` = I could not read it, which is never
 *  "nothing is owed". */
type DayState = { prompts: TrackedQuestion[]; observed: readonly ObservedSample[]; markers: DayMarkers | null; engines: readonly ObservationEngine[] };

async function readDayState(tenantId: string, day: string, opts: PlannerDeps): Promise<DayState | null> {
  const prompts = await (opts.readPrompts ?? readActiveTrackedPrompts)(tenantId).catch(() => null);
  if (prompts == null) {
    log.warn("[daily-observations] tracked questions unreadable; planning nothing this pass", { tenantId, day });
    return null;
  }
  const engines = opts.engines ?? await registryEngines();
  if (prompts.length === 0) return { prompts: [], observed: [], markers: null, engines };
  const readObservations = opts.readObservations ?? (async (t, o) => (await evidenceObservations()).readAiObservationViews(t, o));
  // THE DAY IS NAMED, so the reader hands back the whole day instead of its newest page. An unnamed read
  // defaults to 500 rows, and an account asking 35 questions of 4 engines writes more than that in a day:
  // the planner was deciding what was still owed off a truncated day and re-buying what it could not see.
  const observed = await readObservations(tenantId, { day }).catch(() => null);
  if (observed == null) {
    log.warn("[daily-observations] observation history unreadable; planning nothing this pass", { tenantId, day });
    return null;
  }
  return { prompts, observed, engines, markers: await (opts.readMarkers ?? readDayMarkers)(tenantId).catch(() => null) };
}

/** PURE. THE DAY'S RETRY LEDGER, reconciled against the rows in hand. A broken pair spends a retry when the
 *  ask behind its row actually MOVED since the ledger last looked at it, which is the row's own proof that
 *  the provider was asked again; the first sight of a broken pair records that ask and spends nothing,
 *  because that ask is the one that failed rather than a retry of it. `changed` = there is something new to
 *  write down. Bounded by MAX_RETRY_KEYS so a broken provider cannot inflate a run row. */
function reconcileRetries(day: string, s: DayState): { counts: Record<string, number>; askedAt: Record<string, string>; changed: boolean } {
  const ledger = s.markers?.observationRetries?.day === day ? s.markers.observationRetries : null;
  const counts = { ...(ledger?.counts ?? {}) }, askedAt = { ...(ledger?.askedAt ?? {}) };
  let changed = false;
  for (const row of s.observed) {
    if (row.day !== day || row.status !== "failed" || !row.id) continue;
    const k = retryKey(row), at = row.requestedAt || row.day;
    if (askedAt[k] === at || !(Object.keys(counts).length < MAX_RETRY_KEYS || k in counts)) continue;
    counts[k] = k in askedAt ? (counts[k] ?? 0) + 1 : (counts[k] ?? 0);
    askedAt[k] = at;
    changed = true;
  }
  return { counts, askedAt, changed };
}

/** PURE. The day's standing and its plan off one already-read state. An extra reading is planned ONLY
 *  against a grant the operator actually earned, on THIS day, and a broken pair is retried only while
 *  the day's retry budget lasts. */
function planFrom(day: string, s: DayState, opts: PlannerDeps): DayChecks & { due: DueObservation[] } {
  const grant = s.markers?.extraSamples;
  const retries = reconcileRetries(day, s).counts;
  const shared = { prompts: s.prompts, observed: s.observed, engines: s.engines, unsupportedPairs: opts.unsupportedPairs, retries };
  return {
    ...checkCounts(day, shared),
    due: planObservations(day, { ...shared, extraSamples: grant?.day === day ? grant.granted : 0, maxBatch: opts.maxBatch }),
  };
}

/**
 * THE DAILY PLAN for one account, WITH the day's standing: what is still due, how much of today's one
 * canonical round is SETTLED, and how those settled readings landed. `null` means I COULD NOT READ what is
 * due (the question list or the observation store), which is a different claim from "nothing is owed" and
 * gets a different answer everywhere it is consumed. READ ONLY: nothing here writes, so a surface may ask it
 * on every render.
 */
export async function dailyChecks(tenantId: string, reportingDay: string, opts: PlannerDeps = {}): Promise<(DayChecks & { due: DueObservation[] }) | null> {
  const state = await readDayState(tenantId, reportingDay, opts);
  return state == null ? null : planFrom(reportingDay, state, opts);
}

/**
 * The ONLY selector the observation unit has: the due list alone, with the same null meaning (I could not
 * read what is due, so ask nothing). This is the RUN path, so it is also where the day's failure budget is
 * kept: a pair this plan is asking again after a refusal spends one retry, and a pair whose retries are
 * spent stops saying "failed" on the row and says `unavailable`, with the provider's reason left in place.
 */
export async function dueObservations(tenantId: string, reportingDay: string, opts: PlannerDeps = {}): Promise<DueObservation[] | null> {
  // MONEY IS NOT SPENT ON A NEW ANSWER WHILE PAID ANSWERS SIT UNREAD, on the SCHEDULED path exactly as on the button: the extra-sample door got this refusal after 891 unread answers carrying $7.75 and the run path kept buying through it. Reading stays due (analyze_answers plans separately) so a backlog drains and sampling resumes on its own; a count that cannot be read fails open, because a broken meter must not stop the day's one canonical round.
  const behind = await (opts.unreadBacklog ?? unreadAnswerCount)(tenantId).catch(() => 0);
  if (behind > UNREAD_BACKLOG_MAX) { log.info("[daily-observations] buying paused: paid answers are waiting to be read", { tenantId, unread: behind }); return []; }
  const state = await readDayState(tenantId, reportingDay, opts);
  if (state == null) return null;
  const { due } = planFrom(reportingDay, state, opts);
  await spendFailureBudget(tenantId, reportingDay, state, opts);
  return due;
}

/** How many rows one pass may settle. Bounded: a whole day of refusals settles over a few passes rather
 *  than turning one plan into a hundred writes. */
const MAX_SETTLES_PER_PASS = 40;

/**
 * WRITE DOWN WHAT THE DAY LEARNED, from rows already in hand, in at most one update each way.
 *
 * A `failed` row is the only status that means "ask again", so it is the only one counted. THE RETRY IS
 * SPENT WHERE THE ASK ACTUALLY HAPPENED, never where a plan named it: a pair the plan carried but the pass
 * never reached (the batch cap, the pass deadline, a provider that stopped the batch) used to burn a retry
 * unasked and could settle unavailable having been asked exactly once. The row itself is the proof: every
 * ask stamps a fresh `requested_at` on that identity, so a stamp that moved since the last look IS one
 * retry and a stamp that did not is a pair still owed its turn.
 *
 * A row with nothing left to spend is settled so every later reader (the planner, the count on Today, the
 * trend) sees one honest terminal state instead of pending work forever: `unavailable` when the engine could
 * be asked and gave nothing, `unsupported` when the registry cannot ask it at all. The provider's own words
 * stay in failure_reason either way, so the row still explains itself.
 *
 * THE MARKER NEVER OUTRUNS THE PROOF. The settle used to be fired and forgotten while the exhausted-retry
 * marker landed regardless, so a failed settle left the row saying `failed` with no budget left to ask
 * again: permanently owed and contradicted by the ledger beside it. Settlement happens FIRST and PER PAIR,
 * only a pair whose settle resolved has its retry count advanced, and a pair whose settle threw is rolled
 * back to what the day already had on file, so it stays due, gets asked again, and says so in the log.
 */
async function spendFailureBudget(tenantId: string, day: string, s: DayState, opts: PlannerDeps): Promise<void> {
  const broken = s.observed.filter((o) => o.day === day && o.status === "failed" && Boolean(o.id));
  if (broken.length === 0) return;
  const { counts, askedAt, changed } = reconcileRetries(day, s);
  const held = s.markers?.observationRetries?.day === day ? s.markers.observationRetries : null;
  const askable = new Set(s.engines);
  const settle = opts.settle ?? (async (t: string, id: string, status: "unavailable" | "unsupported") =>
    (await evidenceObservations()).settleFailedObservation(t, id, status));
  let settled = 0, tried = 0;
  for (const row of broken) {
    const k = retryKey(row);
    if ((counts[k] ?? 0) < FAILED_RETRIES_PER_DAY || tried >= MAX_SETTLES_PER_PASS) continue;
    tried += 1;
    try {
      await settle(tenantId, row.id, askable.has(row.engine as ObservationEngine) ? "unavailable" : "unsupported");
      settled += 1;
    } catch (error) {
      // ROLL THIS PAIR BACK TO THE LAST THING THAT WAS PROVED. Its count stays where the day already had it,
      // so the pair is still owed a real ask instead of being marked spent against a settle that never landed.
      if (held?.counts?.[k] != null) counts[k] = held.counts[k]!; else delete counts[k];
      if (held?.askedAt?.[k] != null) askedAt[k] = held.askedAt[k]!; else delete askedAt[k];
      log.error("[daily-observations] a check the provider refused could not be closed out, so it stays owed",
        { tenantId, day, observationId: row.id, engine: row.engine, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (settled > 0) log.info("[daily-observations] settled checks the provider could not answer today", { tenantId, day, settled });
  if (changed) await (opts.writeMarkers ?? writeDayMarkers)(tenantId, { observationRetries: { day, counts, askedAt } }).catch(() => false);
}

/**
 * The Update-data path's gate. The press itself is the request; this answers
 * honestly whether an extra reading is legitimate right now, and PERSISTS the
 * grant so the next pass actually plans it. It adds no button and no surface.
 */
export async function requestExtraSample(tenantId: string, day: string, opts: PlannerDeps = {}): Promise<{ granted: boolean; reason: string; due: DueObservation[] }> {
  const state = await readDayState(tenantId, day, opts);
  if (state == null) {
    return { granted: false, reason: "Where today's checks stand could not be read, so no second reading is added on a guess. It is retried on your next visit.", due: [] };
  }
  // MONEY IS NOT SPENT ON A NEW ANSWER WHILE PAID ANSWERS SIT UNREAD (operator, 2026-08-27). The grant asked
  // only whether the day had room for another reading, never whether anything had read the last ones. Live, 891
  // answers carrying $7.75 of paid text had never been analysed, every one of them dated 2026-08-16 or later,
  // and the button that buys more was still saying yes. Buying more of what nobody is reading is the one spend
  // this product can never justify, so the refusal names the backlog and the money rather than a policy.
  const behind = await (opts.unreadBacklog ?? unreadAnswerCount)(tenantId).catch(() => null); // AND A METER THAT WILL NOT READ MAY NOT GRANT THE EXTRA: both gates treated a failed count as zero, so buying proceeded exactly when the protection could not be measured (Codex, 2026-08-28). The SCHEDULED round above keeps failing OPEN on purpose, because a broken meter must not stop the canonical day; this is the discretionary grant and it fails closed.
  if (behind == null) return { granted: false, due: [], reason: "how many paid answers are still unread could not be read, and an extra sample is not bought while that is unknown" };
  if (behind > UNREAD_BACKLOG_MAX) return { granted: false, due: [], reason: `${behind.toLocaleString("en-US")} answers already paid for are still waiting to be read, so no more are bought today. Reading those comes first, and the next fresh round starts once they are read.` };
  const grant = state.markers?.extraSamples;
  const already = grant?.day === day ? grant.granted : 0;
  const verdict = extraSampleVerdict(day, { prompts: state.prompts, observed: state.observed, engines: state.engines,
    unsupportedPairs: opts.unsupportedPairs, extraSamples: already, retries: reconcileRetries(day, state).counts });
  if (!verdict.granted) return verdict;
  const saved = await (opts.writeMarkers ?? writeDayMarkers)(tenantId, { extraSamples: { day, granted: already + 1 } }).catch(() => false);
  if (!saved) return { granted: false, reason: "Your request for a second reading could not be saved, so none is promised. Press Update data again on your next visit.", due: [] };
  return verdict;
}
