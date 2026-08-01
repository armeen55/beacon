import "server-only";

/**
 * daily-observations - WHAT I ASK THE AI ENGINES TODAY, and what I do with the
 * answers that come back (V1 Truth Convergence Phase 1, 2026-07-31).
 *
 * THE ONE CANONICAL SAMPLE. A tracked question on one engine gets exactly ONE
 * reading per reporting day, and that reading is slot 0. That is the whole trend:
 * one point per question, per engine, per day, so a chart of "how often did the
 * engines name me" is comparing like with like. Slots 1 and 2 exist for the days
 * an operator wants to see how much an engine wobbles, and they are NEVER planned
 * automatically: a second read that nobody asked for would silently triple the
 * bill and quietly reweight the average toward whichever question got sampled
 * more. They come only from an explicit ask, only after slot 0 is complete, and
 * never past three.
 *
 * THE REPORTING DAY IS THE UTC DAY, the same day the Research Run's cycle_key is
 * built from ("<tenant>:<UTC day>"), so a run and its observations can never
 * disagree about which day they belong to.
 *
 * A MISSED DAY IS GONE. Nothing here backfills. If the run never got to a
 * question on Tuesday, Tuesday has no point for it and Wednesday asks about
 * Wednesday. Filling a hole later with a reading taken days afterwards would put
 * a number on the chart at a date it was never true.
 *
 * IDENTITY IS (prompt id, VERSION, engine, day). A wording edit, an engine-set
 * change, an add or a revival bumps the version in prompt-set.ts, so from that
 * day on the question is a NEW series and yesterday's readings are not mixed into
 * it. That is why a rewording shows as a break in the line and not a bend.
 *
 * THE ANALYSIS STEP is the other half: once an answer lands, ONE strict
 * structured call reads it back (what it said, who it named, what it left out)
 * and Evidence persists that. It is bounded to 5 per pass and costs nothing at
 * all when no answer changed, because it fires only on an answer hash that has
 * not been analysed yet. Runtime orchestrates it: Decision's gateway produces the
 * analysis, Evidence stores it, and Evidence never imports Decision.
 */

import { callStructuredLLM } from "@/domains/decision/llm/structured-drafter";
import type { AnswerAnalysis } from "@/domains/decision/llm/schemas";
import type { AiObservationView, DueObservation } from "@/domains/evidence/ai-visibility/ai-observations";
import { log } from "@/lib/logger";
import { readActiveTrackedPrompts, type TrackedQuestion } from "../prompt-set";

/** The engines one tracked question is read on, in the fixed order a plan uses. */
const OBSERVATION_ENGINES = ["chatgpt", "claude", "gemini", "perplexity"] as const;
type ObservationEngine = DueObservation["engine"];

/** Evidence owns both the plan's shape and the reader's view of a stored row, so
 *  a plan hands straight to the observation unit and nothing casts a database row. */
type ObservedSample = AiObservationView;
type AnalyzableObservation = AiObservationView;

/** How many engine reads ONE pass may plan. Matches the observation unit's own
 *  per-pass ceiling, so a plan never hands over more work than a pass can do. */
export const DAILY_OBSERVATION_BATCH = 20;
/** The executor's own per-pass perplexity ceiling (observe.ts drains three, then skips). */
const PERPLEXITY_PER_PASS = 3;
/** The hard ceiling on readings of one question, one engine, one day. */
export const MAX_SAMPLES_PER_DAY = 3;
/** How many answers ONE pass may read back. Zero new answers costs zero. */
const MAX_ANALYSES_PER_PASS = 5;
/** Estimated spend for one answer-analysis call (gpt-5-mini, one answer in). */
const ANSWER_ANALYSIS_COST_USD = 0.01;

/** The reporting day: the UTC day, exactly what cycle_key is built from. */
export function utcReportingDay(now: number | Date = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

const pairKey = (promptId: string, version: number, engine: string): string => `${promptId}|${version}|${engine}`;

type ObservationPlanInput = {
  /** The operator's approved questions, each with the series it is on. */
  prompts: readonly TrackedQuestion[];
  /** Stored observations. Rows for `day` decide what is still due; every row
   *  (whatever window the caller read) decides the oldest-missing-first order. */
  observed: readonly ObservedSample[];
  /** Engines this account can actually be read on. Anything else is EXCLUDED
   *  from the plan; it never blocks the engines that do work. */
  engines?: readonly ObservationEngine[];
  /** Individually unsupported "<promptId>|<engine>" pairs, same rule. */
  unsupportedPairs?: readonly string[];
  /** How many EXTRA readings per pair the operator has explicitly asked for today (0, 1 or 2). Never
   *  inferred and never defaulted upward: nothing but an explicit ask plans slot 1 or 2. */
  extraSamples?: number;
  maxBatch?: number;
};

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
    if (at > (lastAt.get(k) ?? "")) lastAt.set(k, at);
  }
  // Readings that actually landed today, per pair and per slot.
  const doneToday = new Map<string, Set<number>>();
  for (const o of today) {
    if (o.status !== "observed") continue;
    const k = pairKey(o.promptId, o.version, o.engine);
    const slots = doneToday.get(k) ?? new Set<number>();
    slots.add(o.slot);
    doneToday.set(k, slots);
  }

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
      candidates.push({ prompt, engine, slot: next as 1 | 2, lastAt: at });
    }
  }

  const engineRank = (e: ObservationEngine) => OBSERVATION_ENGINES.indexOf(e);
  candidates.sort((a, b) =>
    Number(b.prompt.core) - Number(a.prompt.core)
    || a.lastAt.localeCompare(b.lastAt)
    || String(a.prompt.createdAt).localeCompare(String(b.prompt.createdAt))
    || a.prompt.id.localeCompare(b.prompt.id)
    || engineRank(a.engine) - engineRank(b.engine));

  // THE PLANNER KNOWS THE EXECUTOR'S CEILINGS. The unit drains at most three perplexity asks per
  // pass, and a skipped pair writes no row, so it re-sorted to the head of the very next plan: the
  // perplexity block grew until it owned half the batch and every other engine's coverage decayed
  // with it. The plan now carries at most one pass's worth of perplexity and fills the rest of the
  // batch with work the pass can actually finish.
  const picked: typeof candidates = []; let perp = 0;
  for (const c of candidates) {
    if (picked.length >= maxBatch) break;
    if (c.engine === "perplexity" && perp >= PERPLEXITY_PER_PASS) continue;
    if (c.engine === "perplexity") perp += 1;
    picked.push(c);
  }
  // THE REPORTING DAY TRAVELS WITH THE PLAN. The executor stores it verbatim, so a run resumed past midnight
  // lands its rows on the day it was planning for, which is the day the analysis pass then reads.
  return picked.map((c) => ({
    promptId: c.prompt.id, version: c.prompt.version, text: c.prompt.text, engine: c.engine, slot: c.slot, day,
  }));
}

/** PURE. Is one MORE reading legitimate today, and what would it be. Refuses while today's one canonical
 *  round is unfinished (an extra read of a few questions before every question has one would tilt the day's
 *  average toward whichever ones got sampled twice), and refuses once every pair has three.
 *  `input.extraSamples` is what was ALREADY granted today, so each press asks for exactly one more. */
export function extraSampleVerdict(day: string, input: ObservationPlanInput): { granted: boolean; reason: string; due: DueObservation[] } {
  const canonical = planObservations(day, { ...input, extraSamples: 0, maxBatch: Number.MAX_SAFE_INTEGER });
  if (canonical.length > 0) {
    return { granted: false, reason: `I still owe today's one reading on ${canonical.length} question and engine pairs, and an extra read before that is done would tilt today's average. I finish today's round first, then a second read is worth taking.`, due: [] };
  }
  const extra = planObservations(day, { ...input, extraSamples: (input.extraSamples ?? 0) + 1 });
  if (extra.length === 0) {
    return { granted: false, reason: `I already have ${MAX_SAMPLES_PER_DAY} readings of every question on every engine today, which is as far as one day goes. Your next fresh round starts tomorrow.`, due: [] };
  }
  return { granted: true, reason: `I will take a second reading on ${extra.length} question and engine pairs on the next pass.`, due: extra };
}

/**
 * THE DURABLE GRANT. Pressing Update data is the ask, but the readings it authorizes are planned on the
 * NEXT pass, so the answer has to outlive the press: a verdict that reached only a log line authorized
 * nothing, and slots 1 and 2 were unreachable in production. It rides the account's current research run
 * progress (existing row, existing column, no new store). `granted` is how many EXTRA readings per pair the
 * operator asked for on `day`, so a stale grant from yesterday can never spend today's money.
 */
export type ExtraSampleGrant = { day: string; granted: number };

async function latestRunRow(tenantId: string): Promise<{ id: string; progress: Record<string, unknown> } | null> {
  const admin = (await import("@/lib/persistence/supabase")).getSupabaseAdmin();
  const { data, error } = await admin.from("research_runs").select("id,progress")
    .eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error || data == null) return null;
  const row = data as { id: string; progress: Record<string, unknown> | null };
  return { id: String(row.id), progress: row.progress ?? {} };
}

/** null = no grant on file (or none readable). A grant is only ever spent on the day it names. */
async function readExtraSampleGrant(tenantId: string): Promise<ExtraSampleGrant | null> {
  const row = await latestRunRow(tenantId).catch(() => null);
  const g = row?.progress?.extraSamples as ExtraSampleGrant | undefined;
  return g && typeof g.day === "string" && Number.isFinite(g.granted) ? { day: g.day, granted: Math.max(0, Math.trunc(g.granted)) } : null;
}

/** false = the grant was NOT saved, so the operator is told no rather than promised a reading nothing planned. */
async function writeExtraSampleGrant(tenantId: string, grant: ExtraSampleGrant): Promise<boolean> {
  const row = await latestRunRow(tenantId).catch(() => null);
  if (row == null) return false;
  const admin = (await import("@/lib/persistence/supabase")).getSupabaseAdmin();
  const { error } = await admin.from("research_runs").update({ progress: { ...row.progress, extraSamples: grant } })
    .eq("tenant_id", tenantId).eq("id", row.id);
  return error == null;
}

type PlannerDeps = {
  readPrompts?: (tenantId: string) => Promise<TrackedQuestion[] | null>;
  readObservations?: (tenantId: string, opts: { day?: string; promptId?: string }) => Promise<readonly ObservedSample[]>;
  readGrant?: (tenantId: string) => Promise<ExtraSampleGrant | null>;
  writeGrant?: (tenantId: string, grant: ExtraSampleGrant) => Promise<boolean>;
  engines?: readonly ObservationEngine[];
  unsupportedPairs?: readonly string[];
  maxBatch?: number;
};

/** Evidence owns the observation store; Runtime asks for it lazily so this module
 *  loads (and every test runs) without touching it. */
async function evidenceObservations() {
  return import("@/domains/evidence/ai-visibility/ai-observations");
}

/** PURE. Today's canonical round as a COUNT: every (question, engine) pair that owes a
 *  reading today, and how many of them already landed. The progress number Today shows is
 *  this one, so it is the planner's own arithmetic and never a second, drifting tally. */
function checkCounts(day: string, input: Pick<ObservationPlanInput, "prompts" | "observed" | "engines" | "unsupportedPairs">): { done: number; total: number } {
  const engines = (input.engines ?? OBSERVATION_ENGINES).filter((e) => OBSERVATION_ENGINES.includes(e));
  const excluded = new Set(input.unsupportedPairs ?? []);
  const landed = new Set(input.observed
    .filter((o) => o.day === day && o.status === "observed" && o.slot === 0)
    .map((o) => pairKey(o.promptId, o.version, o.engine)));
  let done = 0, total = 0;
  for (const p of input.prompts) {
    if (!p.id || !p.text) continue;
    for (const engine of engines) {
      if (excluded.has(`${p.id}|${engine}`)) continue;
      total += 1;
      if (landed.has(pairKey(p.id, p.version, engine))) done += 1;
    }
  }
  return { done, total };
}

/**
 * THE DAILY PLAN for one account, WITH the day's standing: what is still due, and how much
 * of today's one canonical round already landed. `null` means I COULD NOT READ what is due
 * (the question list or the observation store), which is a different claim from "nothing is
 * owed" and gets a different answer everywhere it is consumed.
 */
export async function dailyChecks(tenantId: string, reportingDay: string, opts: PlannerDeps = {}): Promise<{ done: number; total: number; due: DueObservation[] } | null> {
  const readPrompts = opts.readPrompts ?? readActiveTrackedPrompts;
  const readObservations = opts.readObservations ?? (async (t, o) => (await evidenceObservations()).readAiObservationViews(t, o));
  const prompts = await readPrompts(tenantId).catch(() => null);
  if (prompts == null) {
    log.warn("[daily-observations] tracked questions unreadable; planning nothing this pass", { tenantId, reportingDay });
    return null;
  }
  if (prompts.length === 0) return { done: 0, total: 0, due: [] };
  const observed = await readObservations(tenantId, {}).catch(() => null);
  if (observed == null) {
    log.warn("[daily-observations] observation history unreadable; planning nothing this pass", { tenantId, reportingDay });
    return null;
  }
  // An extra reading is planned ONLY against a grant the operator actually earned, on THIS day.
  const grant = await (opts.readGrant ?? readExtraSampleGrant)(tenantId).catch(() => null);
  const shared = { prompts, observed, engines: opts.engines, unsupportedPairs: opts.unsupportedPairs };
  return {
    ...checkCounts(reportingDay, shared),
    due: planObservations(reportingDay, { ...shared, extraSamples: grant?.day === reportingDay ? grant.granted : 0, maxBatch: opts.maxBatch }),
  };
}

/** The ONLY selector the observation unit has: the due list alone, with the same null
 *  meaning (I could not read what is due, so ask nothing). */
export async function dueObservations(tenantId: string, reportingDay: string, opts: PlannerDeps = {}): Promise<DueObservation[] | null> {
  return (await dailyChecks(tenantId, reportingDay, opts))?.due ?? null;
}

/**
 * The Update-data path's gate. The press itself is the request; this answers
 * honestly whether an extra reading is legitimate right now, and PERSISTS the
 * grant so the next pass actually plans it. It adds no button and no surface.
 */
export async function requestExtraSample(tenantId: string, day: string, opts: PlannerDeps = {}): Promise<{ granted: boolean; reason: string; due: DueObservation[] }> {
  const readPrompts = opts.readPrompts ?? readActiveTrackedPrompts;
  const readObservations = opts.readObservations ?? (async (t, o) => (await evidenceObservations()).readAiObservationViews(t, o));
  const prompts = await readPrompts(tenantId).catch(() => null);
  const observed = await readObservations(tenantId, {}).catch(() => null);
  if (prompts == null || observed == null) {
    return { granted: false, reason: "I could not read where today's checks stand, so I am not adding a second reading on a guess. I will try again on your next visit.", due: [] };
  }
  const stored = await (opts.readGrant ?? readExtraSampleGrant)(tenantId).catch(() => null);
  const already = stored?.day === day ? stored.granted : 0;
  const verdict = extraSampleVerdict(day, { prompts, observed, engines: opts.engines, unsupportedPairs: opts.unsupportedPairs, extraSamples: already });
  if (!verdict.granted) return verdict;
  const saved = await (opts.writeGrant ?? writeExtraSampleGrant)(tenantId, { day, granted: already + 1 }).catch(() => false);
  if (!saved) return { granted: false, reason: "I could not save your request for a second reading, so I am not promising one. Press Update data again on your next visit.", due: [] };
  return verdict;
}

// ── the analysis step ───────────────────────────────────────────────────────

const ANSWER_ANALYSIS_SYSTEM =
  "You read one AI assistant's answer and record what it says. You are a reader, not an author. " +
  "Restate only what the ANSWER TEXT contains: every claim must use the answer's own wording, every entity, " +
  "competitor, content type and question must be one the answer itself names. " +
  "Never invent or infer a URL, a number, a statistic, a price, a date, a ranking or a fact that is not in the answer text. " +
  "Never add your own knowledge about the subject and never judge whether the answer is correct. " +
  "If the answer does not name the brand you are given, set mentioned to false and leave position and context null. " +
  "position is the order the name appears in the answer (1 means named first), never a search ranking. " +
  "materialOmissions lists what a reader of THIS answer still would not know, described in plain words, with no invented facts. " +
  "Return every field; use an empty array when the answer gives you nothing for it.";

/** PURE. Which stored observations still owe an analysis: an answer that landed,
 *  and whose analysis is either missing or was taken against a DIFFERENT answer
 *  than the one on file. An unchanged answer is never re-read, so a re-run of the
 *  same pass costs nothing. */
export function selectAnalysisTargets(rows: readonly AnalyzableObservation[], max = MAX_ANALYSES_PER_PASS): readonly AnalyzableObservation[] {
  return rows
    .filter((r) => Boolean(r.id) && Boolean(r.answerText) && Boolean(r.answerHash))
    .filter((r) => r.analysis == null || r.analysisHash !== r.answerHash)
    .slice(0, Math.max(0, max));
}

type AnalysisDeps = {
  readObservations?: (tenantId: string, opts: { day?: string }) => Promise<readonly AnalyzableObservation[]>;
  persist?: (tenantId: string, observationId: string, analysis: Record<string, unknown>, analysisHash: string) => Promise<void>;
  analyze?: (input: { tenantId: string; question: string; engine: string; answerText: string; brand: string }) => Promise<AnswerAnalysis | null>;
  readPrompts?: (tenantId: string) => Promise<TrackedQuestion[] | null>;
  brand?: string;
  max?: number;
};

/** ONE strict structured call per answer, through the existing gateway. Returns
 *  null on anything that is not a validated draft: an analysis I could not
 *  produce is simply absent, never a half-filled one. */
async function analyzeOne(input: { tenantId: string; question: string; engine: string; answerText: string; brand: string }): Promise<AnswerAnalysis | null> {
  const user = [
    `BRAND TO LOOK FOR: ${input.brand || "(none supplied)"}`,
    `QUESTION ASKED: ${input.question}`,
    `ENGINE: ${input.engine}`,
    "ANSWER TEXT (the only thing you may restate):",
    input.answerText.slice(0, 12_000),
  ].join("\n");
  const out = await callStructuredLLM({
    kind: "answer_analysis",
    tenantId: input.tenantId,
    system: ANSWER_ANALYSIS_SYSTEM,
    user,
    // The answer text IS the grounding, so every number the analysis restates is
    // grounded and any number it invents is caught by the numeric firewall.
    grounded: input.answerText.slice(0, 12_000),
    projectedCostUsd: ANSWER_ANALYSIS_COST_USD,
    maxTokens: 3000,
  });
  return out.status === "drafted" ? (out.value as AnswerAnalysis) : null;
}

/**
 * Read back the day's new answers, bounded. Returns how many analyses were
 * PERSISTED, never how many were attempted. $0 when nothing is new. Fail-soft by
 * contract: analysis is derived from evidence that is already safely stored, so a
 * failure here must never pause the run that just did the expensive part.
 */
export async function runAnswerAnalyses(tenantId: string, day: string, deps: AnalysisDeps = {}): Promise<number> {
  const readObservations = deps.readObservations ?? (async (t, o) => (await evidenceObservations()).readAiObservationViews(t, o));
  const persist = deps.persist
    ?? (async (t, id, analysis, hash) => (await evidenceObservations()).persistAnswerAnalysis(t, id, analysis, hash));
  const rows = await readObservations(tenantId, { day }).catch(() => null);
  if (rows == null || rows.length === 0) return 0;
  const targets = selectAnalysisTargets(rows, deps.max ?? MAX_ANALYSES_PER_PASS);
  if (targets.length === 0) return 0; // nothing new: no call, no cent

  const prompts = await (deps.readPrompts ?? readActiveTrackedPrompts)(tenantId).catch(() => null);
  const textOf = new Map((prompts ?? []).map((p) => [p.id, p.text]));
  const analyze = deps.analyze ?? analyzeOne;
  let written = 0;
  for (const row of targets) {
    const question = row.promptText || textOf.get(row.promptId) || "";
    const hash = String(row.answerHash);
    const analysis = await analyze({
      tenantId, question, engine: row.engine, answerText: String(row.answerText ?? ""), brand: deps.brand ?? "",
    }).catch(() => null);
    // A REFUSAL IS A RESULT, and it is stored against the answer it was taken on. Persisting nothing left the
    // same row at the top of the worklist, so a firewall or schema rejection re-bought the same five calls
    // every single pass, forever. A NEW answer hash re-qualifies the row; the same answer never asks twice.
    if (analysis == null) {
      await persist(tenantId, row.id, { rejected: true, reason: "I could not produce a reliable reading of this answer, so I recorded that instead of paying to be refused again." }, hash).catch(() => {});
      continue;
    }
    // ONE retry on a lost write. Still lost leaves the row for the next pass, where the gateway's own call
    // cache serves the identical request at $0, so a retry costs nothing but the round trip.
    const saved = await persist(tenantId, row.id, analysis as unknown as Record<string, unknown>, hash).then(() => true)
      .catch(() => persist(tenantId, row.id, analysis as unknown as Record<string, unknown>, hash).then(() => true).catch(() => false));
    if (saved) written += 1;
  }
  if (written > 0) log.info("[daily-observations] read back new AI answers", { tenantId, day, written });
  return written;
}
