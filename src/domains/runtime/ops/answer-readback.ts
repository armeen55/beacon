import "server-only";

/**
 * answer-readback - READING THE STORED AI ANSWERS BACK (V1 Closure, 2026-08-01).
 *
 * The other half of daily-observations: collection buys the answers, this reads
 * them. ONE strict structured call reads a BATCH of stored answers (what each
 * said, who it named, what it left out) and Evidence persists one reading per
 * observation. One call per answer capped a pass at five readings, which is
 * twenty-eight passes to read back a single day of 140 answers, and a day only
 * ever runs eight: analysis could never catch collection, so most of what Beacon
 * paid for was never read at all.
 *
 * IT COSTS NOTHING WHEN NOTHING CHANGED. A reading fires only on an answer hash
 * that has not been read yet, so a re-run of the same pass buys nothing.
 *
 * EVERY ANSWER THIS PASS TAKES ON ENDS IT ANALYZED OR EXPLICITLY REJECTED,
 * stamped with its own answer hash either way, so it leaves the worklist and the
 * same answer is never bought twice. An answer a batch left out is rejected
 * ALONE; a whole batch that comes back unusable drops to one answer at a time,
 * bounded, so one poisoned answer cannot stall the day.
 *
 * Runtime orchestrates: Decision's gateway produces the reading, Evidence stores
 * it, and Evidence never imports Decision.
 */

import { loadBrandIdentity, type BrandIdentity } from "@/domains/account/brand-identity";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { AnswerAnalysis, AnswerAnalysisBatch } from "@/domains/decision/llm/schemas";
import type { AiObservationView } from "@/domains/evidence/ai-visibility/ai-observations";
import { log } from "@/lib/logger";
import { readActiveTrackedPrompts, type TrackedQuestion } from "../prompt-set";

type AnalyzableObservation = AiObservationView;

/** Evidence owns the observation store; Runtime asks for it lazily so this module
 *  loads (and every test runs) without touching it. */
async function evidenceObservations() {
  return import("@/domains/evidence/ai-visibility/ai-observations");
}

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

/** The BATCH framing on top of exactly the same reader rules: many answers, one call, one reading each. */
const BATCH_ANALYSIS_SYSTEM = ANSWER_ANALYSIS_SYSTEM +
  " You are given SEVERAL answers, each introduced by its own OBSERVATION line. Read each answer entirely on its own: " +
  "never carry a claim, an entity or a competitor from one answer into another, and never let one answer fill a gap in another. " +
  "Return exactly one entry in analyses for each OBSERVATION, with observationId copied character for character from that " +
  "OBSERVATION line. Never merge two answers into one entry, never write an entry for an id you were not given, and never leave one out.";

/** How many answers ONE structured call reads back. Fifteen: one answer's reading is a compact object, and
 *  fifteen answers cut to 5,000 characters is roughly 19,000 tokens in, which one gpt-5-mini call reads
 *  comfortably, while emptying a 140 answer day well inside the eight passes a day actually runs. */
const ANSWERS_PER_BATCH = 15;
/** How many BATCH calls one pass may make. Four is 60 answers a pass, so a 140 answer day is read back in
 *  three passes rather than the twenty-eight one-answer-per-call needed. */
const BATCH_CALLS_PER_PASS = 4;
/** How many answers one pass may read back in total. Zero new answers still costs zero. */
const MAX_ANALYSES_PER_PASS = ANSWERS_PER_BATCH * BATCH_CALLS_PER_PASS;
/** How much of ONE answer a batch call reads. A longer answer is cut, and the stored reading SAYS it was
 *  cut, so nobody later mistakes a partial reading for a complete one. */
const BATCH_ANSWER_CHARS = 5_000;
/** When a whole batch comes back unusable, how many of ITS OWN answers this pass may re-read ONE AT A TIME.
 *  PER FAILED BATCH, sized to cover one whole batch: a pass budget meant batch one's wholesale failure ate
 *  the entire allowance and batches two, three and four settled nothing at all, so the pass left three
 *  batches' worth of answers on the worklist and the next pass bought them again. A pass now always settles
 *  what it actually read, and every answer a batch was carrying ends the pass analyzed or rejected. */
const SINGLE_FALLBACKS_PER_BATCH = ANSWERS_PER_BATCH;
/** Estimated spend: one batch call reads about fifteen answers, so it costs more than the single call it
 *  replaces and far less than the fifteen it replaces (gpt-5-mini, roughly 19k tokens in). */
const BATCH_ANALYSIS_COST_USD = 0.05;
/** Estimated spend for one single-answer call (gpt-5-mini, one answer in). */
const ANSWER_ANALYSIS_COST_USD = 0.01;
/** gpt-5-mini reasons before it writes, and a batch writes fifteen readings. The gateway floors every
 *  reasoning call at 90 seconds; a batch asks for more so a slow one is not thrown away half-written. */
const BATCH_TIMEOUT_MS = 180_000;

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

/** One answer as a batch call sees it: the row, the question it answered, and how much of it I read. */
type AnalysisTarget = { row: AnalyzableObservation; question: string; truncated: boolean };

type AnalysisDeps = {
  readObservations?: (tenantId: string, opts: { day?: string }) => Promise<readonly AnalyzableObservation[]>;
  persist?: (tenantId: string, observationId: string, analysis: Record<string, unknown>, analysisHash: string) => Promise<void>;
  analyze?: (input: { tenantId: string; question: string; engine: string; answerText: string; brand: string }) => Promise<AnswerAnalysis | null>;
  /** ONE call over many answers. Returns a reading per observation id; null = the whole call was unusable
   *  (a refusal, a firewall, or a shape the gateway could not validate even after its own one retry). */
  analyzeBatch?: (input: { tenantId: string; brand: string; targets: readonly AnalysisTarget[] }) => Promise<Map<string, AnswerAnalysis> | null>;
  readPrompts?: (tenantId: string) => Promise<TrackedQuestion[] | null>;
  /** WHO THIS ACCOUNT IS. Tests inject it; production always loads the real one and
   *  never falls back to an empty brand (see runAnswerAnalyses). */
  identity?: BrandIdentity;
  /** The LLM transport, so a test can exercise this exact prompt without a key. */
  complete?: CompleteFn;
  max?: number;
};

/** Which path found the account in an answer: the model's reading, the answer's own
 *  words, an address it credited, or both the model and the words. A later reader can
 *  tell a model miss from a real absence, which a bare true/false never could. */
type BrandMatchPath = "model" | "text" | "citation" | "both";

/** A name counts only as a WHOLE word, tolerant of the spacing and punctuation a
 *  writer chose ("Ritz Builders", "ritz-builders"), so "Ritz" is never found inside
 *  "Ritzy" and no substring of an unrelated word can invent a mention. */
function formPattern(form: string): RegExp | null {
  const parts = form.match(/[\p{L}\p{N}]+/gu);
  if (parts == null || parts.length === 0) return null;
  const body = parts.join("[^\\p{L}\\p{N}]{0,2}");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
}

const hostOfUrl = (raw: string): string =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";

/** PURE. Does this answer name the account, in its own text or in what it credited?
 *  null = neither, which is a real absence and not a shrug. */
function findBrand(identity: BrandIdentity, answerText: string, citationUrls: readonly string[] | null): Exclude<BrandMatchPath, "model" | "both"> | null {
  if (answerText && identity.forms.some((f) => formPattern(f)?.test(answerText) === true)) return "text";
  const host = identity.host;
  if (host && (citationUrls ?? []).some((u) => { const h = hostOfUrl(u); return h === host || h.endsWith(`.${host}`); })) return "citation";
  return null;
}

/** ONE strict structured call per answer, through the existing gateway. Returns
 *  null on anything that is not a validated draft: an analysis I could not
 *  produce is simply absent, never a half-filled one. */
async function analyzeOne(input: { tenantId: string; question: string; engine: string; answerText: string; brand: string }, complete?: CompleteFn): Promise<AnswerAnalysis | null> {
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
    ...(complete ? { complete } : {}),
  });
  return out.status === "drafted" ? (out.value as AnswerAnalysis) : null;
}

/**
 * ONE strict structured call over MANY answers, through the same gateway and the same reader rules.
 * Returns a reading per observation id; null means the whole call was unusable, which the caller degrades
 * from rather than treating as fifteen refusals.
 *
 * An entry naming an id this batch did not ask about is DROPPED, and a repeated id keeps the first entry:
 * a reading must belong to the answer it was taken on, and a model that mixes two answers up must not be
 * allowed to file one of them under the other.
 */
async function analyzeMany(input: { tenantId: string; brand: string; targets: readonly AnalysisTarget[] }, complete?: CompleteFn): Promise<Map<string, AnswerAnalysis> | null> {
  const bodies = input.targets.map((t) => String(t.row.answerText ?? "").slice(0, BATCH_ANSWER_CHARS));
  const user = [`BRAND TO LOOK FOR: ${input.brand || "(none supplied)"}`, `Read all ${input.targets.length} answers below. Return one entry per OBSERVATION.`]
    .concat(input.targets.map((t, i) => [
      `OBSERVATION ${t.row.id}`,
      `QUESTION ASKED: ${t.question}`,
      `ENGINE: ${t.row.engine}`,
      t.truncated ? "ANSWER TEXT (the only thing you may restate; it was longer than this and I read the first part only):" : "ANSWER TEXT (the only thing you may restate):",
      bodies[i] ?? "",
    ].join("\n"))).join("\n\n");
  const out = await callStructuredLLM({
    kind: "answer_analysis_batch",
    tenantId: input.tenantId,
    system: BATCH_ANALYSIS_SYSTEM,
    user,
    // Every answer in the batch IS the grounding, so a number any reading restates is grounded and one it
    // invents is still caught. The firewall reads them as one body of text, which is looser than reading
    // each answer against its own numbers: a number is judged invented only if NO answer here contains it.
    grounded: bodies.join("\n"),
    projectedCostUsd: BATCH_ANALYSIS_COST_USD,
    maxTokens: 18_000,
    timeoutMs: BATCH_TIMEOUT_MS,
    ...(complete ? { complete } : {}),
  });
  if (out.status !== "drafted") {
    log.warn("[daily-observations] a batch reading of stored answers came back unusable; falling back to one answer at a time", { tenantId: input.tenantId, answers: input.targets.length, status: out.status });
    return null;
  }
  const asked = new Set(input.targets.map((t) => t.row.id));
  const byId = new Map<string, AnswerAnalysis>();
  for (const entry of (out.value as AnswerAnalysisBatch).analyses) {
    const { observationId, ...analysis } = entry;
    if (!asked.has(observationId) || byId.has(observationId)) continue;
    byId.set(observationId, analysis as AnswerAnalysis);
  }
  return byId;
}

/**
 * Read back the day's new answers, bounded. Returns how many analyses were
 * PERSISTED, never how many were attempted. $0 when nothing is new. Fail-soft by
 * contract: analysis is derived from evidence that is already safely stored, so a
 * failure here must never pause the run that just did the expensive part.
 *
 * THE TERMINAL CONDITION: every answer this pass takes on ends the pass either ANALYZED or explicitly
 * REJECTED against its own answer hash, so it leaves the worklist either way and the same answer is never
 * bought twice. An answer missing from a batch response is rejected ALONE and never sinks its neighbours;
 * a whole batch that comes back unusable is re-read one answer at a time, bounded, so one poisoned answer
 * cannot stall the day.
 */
export async function runAnswerAnalyses(tenantId: string, day: string, deps: AnalysisDeps = {}): Promise<number> {
  const readObservations = deps.readObservations ?? (async (t, o) => (await evidenceObservations()).readAiObservationViews(t, o));
  const persist = deps.persist
    ?? (async (t, id, analysis, hash) => (await evidenceObservations()).persistAnswerAnalysis(t, id, analysis, hash));
  const rows = await readObservations(tenantId, { day }).catch(() => null);
  if (rows == null || rows.length === 0) return 0;
  const targets = selectAnalysisTargets(rows, deps.max ?? MAX_ANALYSES_PER_PASS);
  if (targets.length === 0) return 0; // nothing new: no call, no cent

  // WHO AM I LOOKING FOR. The pass used to send an EMPTY brand, so the model was asked
  // whether an answer named nobody and every reading came back "not mentioned". An
  // identity with no forms at all buys nothing: I say so and stop, rather than spend on
  // a question I cannot ask.
  const identity = deps.identity ?? await loadBrandIdentity(tenantId).catch(() => null);
  if (identity == null || identity.forms.length === 0) {
    log.warn("[daily-observations] no business name or website on file, so I am not reading answers back for a brand I cannot name", { tenantId, day });
    return 0;
  }

  const prompts = await (deps.readPrompts ?? readActiveTrackedPrompts)(tenantId).catch(() => null);
  const textOf = new Map((prompts ?? []).map((p) => [p.id, p.text]));
  const analyze = deps.analyze ?? ((i: Parameters<typeof analyzeOne>[0]) => analyzeOne(i, deps.complete));
  const analyzeBatch = deps.analyzeBatch ?? ((i: Parameters<typeof analyzeMany>[0]) => analyzeMany(i, deps.complete));
  let calls = BATCH_CALLS_PER_PASS, written = 0;

  /** ONE reading lands, whatever produced it. `analysis` null means I could not produce a reliable one. */
  const settleOne = async (t: AnalysisTarget, analysis: AnswerAnalysis | null, reason: string): Promise<void> => {
    const row = t.row, hash = String(row.answerHash), answerText = String(row.answerText ?? "");
    // THE SECOND PAIR OF EYES, on the WHOLE answer even when the model was handed a truncated one. The model
    // reads the answer; this reads the same answer for the account's own name and its own address. The verdict
    // is either one of them, and `matchedBy` records which found it, so a model miss never looks like a real absence.
    const found = findBrand(identity, answerText, row.citationUrls);
    // A REFUSAL IS A RESULT, and it is stored against the answer it was taken on. Persisting nothing left the
    // same row at the top of the worklist, so a firewall or schema rejection re-bought the same calls every
    // single pass, forever. A NEW answer hash re-qualifies the row; the same answer never asks twice.
    // What I DID see in the text still rides along: a refusal is not a reason to lose a mention I can prove.
    if (analysis == null) {
      const rejection = {
        rejected: true, reason,
        ...(found ? { ownedBrandMention: { mentioned: true, position: null, context: null }, matchedBy: found } : {}),
      };
      // A REFUSAL IS WRITTEN WITH THE SAME DISCIPLINE AS A READING: one retry, and a loss said out loud.
      // Swallowed silently, the row stayed at the top of the worklist and the same refusal was re-bought on
      // every pass, with nothing in the log to say why the day never emptied.
      const kept = await persist(tenantId, row.id, rejection, hash).then(() => true)
        .catch(() => persist(tenantId, row.id, rejection, hash).then(() => true).catch(() => false));
      if (!kept) log.warn("[daily-observations] I could not record that I was refused a reading of this answer, so it will be asked for again", { tenantId, observationId: row.id });
      return;
    }
    const byModel = analysis.ownedBrandMention?.mentioned === true;
    const record = {
      ...analysis,
      ownedBrandMention: { ...analysis.ownedBrandMention, mentioned: byModel || found != null },
      matchedBy: (byModel && found ? "both" : byModel ? "model" : found) as BrandMatchPath | null,
      // An answer longer than a batch call reads is recorded as READ IN PART, never as read whole.
      ...(t.truncated ? { answerReadInPart: true } : {}),
    } as unknown as Record<string, unknown>;
    // ONE retry on a lost write. Still lost leaves the row for the next pass, where the gateway's own call
    // cache serves the identical request at $0, so a retry costs nothing but the round trip.
    const saved = await persist(tenantId, row.id, record, hash).then(() => true)
      .catch(() => persist(tenantId, row.id, record, hash).then(() => true).catch(() => false));
    if (saved) written += 1;
  };

  /** The degrade: re-read what a broken batch was carrying, ONE answer at a time, bounded to THAT batch.
   *  Whatever the bound leaves is simply not touched this pass, so the next pass picks it up unchanged and
   *  unpaid for. */
  const readOneByOne = async (group: readonly AnalysisTarget[]): Promise<void> => {
    let singles = SINGLE_FALLBACKS_PER_BATCH;
    for (const t of group) {
      if (singles <= 0) return;
      singles -= 1;
      const analysis = await analyze({ tenantId, question: t.question, engine: t.row.engine, answerText: String(t.row.answerText ?? ""), brand: identity.name }).catch(() => null);
      await settleOne(t, analysis, "I could not produce a reliable reading of this answer, so I recorded that instead of paying to be refused again.");
    }
  };

  const queue: AnalysisTarget[] = targets.map((row) => {
    const answerText = String(row.answerText ?? "");
    return { row, question: row.promptText || textOf.get(row.promptId) || "", truncated: answerText.length > BATCH_ANSWER_CHARS };
  });
  for (let i = 0; i < queue.length && calls > 0; i += ANSWERS_PER_BATCH) {
    const group = queue.slice(i, i + ANSWERS_PER_BATCH);
    calls -= 1;
    const readings = await analyzeBatch({ tenantId, brand: identity.name, targets: group }).catch(() => null);
    // WHOLESALE FAILURE. The gateway already retried this call once against the same schema, so a second
    // identical batch would buy the same refusal: the group drops to one answer at a time instead.
    if (readings == null) { await readOneByOne(group); continue; }
    for (const t of group) {
      // A MISSING OR UNKNOWN ITEM IS ONE REJECTION, not fifteen. The answer is settled against its own hash
      // with an honest reason, so it leaves the worklist and its neighbours keep their readings.
      await settleOne(t, readings.get(t.row.id) ?? null,
        "I read a batch of answers back and this one came back missing from the reading, so I recorded that rather than paying to be told nothing twice.");
    }
  }
  if (written > 0) log.info("[daily-observations] read back new AI answers", { tenantId, day, written });
  return written;
}
