import "server-only";

/**
 * answer-readback - READING THE STORED AI ANSWERS BACK.
 *
 * Collection buys the answers, this reads them. ONE strict structured call reads a BATCH of stored answers (what each said, who it
 * named, what it left out) and Evidence persists one reading per observation. One call per answer capped a pass at five readings, so
 * a 140 answer day needed twenty-eight passes and only ever got eight. IT COSTS NOTHING WHEN NOTHING CHANGED: a call fires only on a
 * piece nobody has read yet.
 *
 * A LONG ANSWER IS READ WHOLE, IN PIECES, ACROSS AS MANY PASSES AS IT TAKES. A slot reads 5,000 characters, so a longer answer is
 * split on its own paragraph breaks and every piece rides a batch keyed `id#part`. The pieces a pass reads merge into ONE stored
 * reading beside a COVERAGE CHECKPOINT naming exactly which pieces of which answer hash are in it. An answer is ANALYZED only when
 * every piece is accounted for; until then the stored reading carries a deliberately different hash, so the row stays due and the
 * next pass resumes at the first unread piece. A six piece ceiling used to throw a long answer's tail away, and the one-at-a-time
 * fallback read 12,000 characters while stamping the FULL answer hash, so a row looked finished and the rest was lost forever.
 *
 * EVERY READING IS GROUNDED IN ITS OWN ANSWER. The gateway grounds one batch call against all fifteen answers as one body of text, so
 * a number only answer A contained could validate a fabricated claim about answer B. Each returned item is re-checked against the
 * exact text it was read from and a failing item is dropped alone, with the number named in what is stored. EVERY PIECE THIS PASS
 * SENDS COMES BACK SETTLED: merged, or dropped with the reason stored, and a piece never sent is still owed. A whole batch that comes
 * back unusable drops to ONE CALL PER PIECE, each grounded in its own piece's text, so one poisoned answer cannot stall the day.
 * Runtime orchestrates: Decision's gateway produces the reading, Evidence stores it, and Evidence never imports Decision.
 */

import { loadBrandIdentity, type BrandIdentity } from "@/domains/account/brand-identity";
import { buildGroundedNumbers, findUngroundedNumbers } from "@/domains/decision/llm/numeric-fidelity";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import { draftProseStringValues, type AnswerAnalysis, type AnswerAnalysisBatch } from "@/domains/decision/llm/schemas";
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

/** How many pieces ONE structured call reads back. Fifteen: one reading is a compact object, and fifteen
 *  pieces of 5,000 characters is roughly 19,000 tokens in, which one gpt-5-mini call reads comfortably. */
const ANSWERS_PER_BATCH = 15;
/** How many BATCH calls one pass may make. Four is 60 pieces a pass, so a 140 answer day is read back in
 *  three passes rather than the twenty-eight one-answer-per-call needed. */
const BATCH_CALLS_PER_PASS = 4;
/** How many pieces one pass may read back in total. Zero new answers still costs zero. */
const MAX_ANALYSES_PER_PASS = ANSWERS_PER_BATCH * BATCH_CALLS_PER_PASS;
/** How much of ONE answer ONE slot reads. A longer answer is not cut off: it is SPLIT into this many
 *  characters at a time, and every piece is read eventually even if that takes several passes. */
const BATCH_ANSWER_CHARS = 5_000;
/** When a whole batch comes back unusable, how many of ITS OWN pieces this pass may re-read ONE AT A TIME.
 *  Sized to cover one whole batch PER FAILED BATCH: a pass budget meant batch one's wholesale failure ate
 *  the entire allowance and batches two, three and four settled nothing at all. */
const SINGLE_FALLBACKS_PER_BATCH = ANSWERS_PER_BATCH;
/** Estimated spend: one batch call reads about fifteen pieces (gpt-5-mini, roughly 19k tokens in). */
const BATCH_ANALYSIS_COST_USD = 0.05;
/** Estimated spend for one single-piece call (gpt-5-mini, one piece in). */
const ANSWER_ANALYSIS_COST_USD = 0.01;
/** gpt-5-mini reasons before it writes, and a batch writes fifteen readings. The gateway floors every
 *  reasoning call at 90 seconds; a batch asks for more so a slow one is not thrown away half-written. */
const BATCH_TIMEOUT_MS = 180_000;

/** THE RESUME CHECKPOINT, stored beside the reading. `read` are the pieces merged into it, `dropped` those
 *  sent that came back unusable. A piece in NEITHER is still owed, which keeps a part-read answer on the
 *  worklist. `hash` binds the checkpoint to one answer, so a changed provider answer resets the coverage. */
type Coverage = { hash: string; parts: number; read: number[]; dropped: number[] };

/** PURE. The checkpoint on this row, but ONLY if it was taken against the answer that is on file now. */
function coverageOf(row: AnalyzableObservation): Coverage | null {
  const c = (row.analysis as { coverage?: Coverage } | null)?.coverage;
  return c != null && c.hash === row.answerHash && Array.isArray(c.read) && Array.isArray(c.dropped) ? c : null;
}

/** PURE. The pieces of this answer nobody has settled yet, in the order the answer said them. */
function missingParts(row: AnalyzableObservation): number[] {
  const parts = splitAnswer(String(row.answerText ?? "")).length;
  const c = coverageOf(row);
  const settled = new Set([...(c?.read ?? []), ...(c?.dropped ?? [])]);
  return Array.from({ length: parts }, (_, i) => i + 1).filter((p) => !settled.has(p));
}

/** PURE. The reading already merged for this answer, without the bookkeeping, so a later pass merges its
 *  new pieces on top instead of starting over and re-paying for what is already read. */
function priorReading(row: AnalyzableObservation): AnswerAnalysis | null {
  if (coverageOf(row) == null || row.analysis == null) return null;
  const { coverage: _c, readParts: _p, answerReadInPart: _a, reason: _r, matchedBy: _m, rejected: _j, ...rest } =
    row.analysis as Record<string, unknown>;
  return rest as unknown as AnswerAnalysis;
}

/** PURE. The hash a PART READ answer is stamped with: derived from the answer hash and deliberately NOT
 *  equal to it, so the settled test (analysisHash === answerHash) keeps saying "not done yet". */
const partialHash = (c: Coverage): string => `${c.hash}~${c.read.length + c.dropped.length}of${c.parts}`;

/** PURE. Which stored observations still owe a reading: an answer that landed, and whose reading is missing,
 *  was taken against a DIFFERENT answer, or covers only some of this one. */
export function selectAnalysisTargets(rows: readonly AnalyzableObservation[], max = MAX_ANALYSES_PER_PASS): readonly AnalyzableObservation[] {
  // A PASS TAKES ON ONLY WHAT IT CAN FINISH, COUNTED IN PIECES. Selection packs the same batches the reader
  // packs, so the call budget can never run out mid-list. An answer with more unread pieces than one batch
  // holds claims a batch and finishes over later passes; it never stalls and is never abandoned.
  const batches = Math.max(1, Math.ceil(Math.max(0, max) / ANSWERS_PER_BATCH));
  const out: AnalyzableObservation[] = [];
  let opened = 0, filled = 0;
  for (const r of dueForAnalysis(rows)) {
    const pieces = Math.min(missingParts(r).length, ANSWERS_PER_BATCH);
    if (pieces === 0) continue;
    if (opened === 0 || filled + pieces > ANSWERS_PER_BATCH) {
      if (opened >= batches) break;
      opened += 1; filled = 0;
    }
    filled += pieces;
    out.push(r);
  }
  return out;
}

/** PURE. Every stored answer that owes a reading, before any budget is applied. */
function dueForAnalysis(rows: readonly AnalyzableObservation[]): readonly AnalyzableObservation[] {
  return rows
    .filter((r) => Boolean(r.id) && Boolean(r.answerText) && Boolean(r.answerHash))
    .filter((r) => r.analysis == null || r.analysisHash !== r.answerHash);
}

/** ONE PIECE of one answer as a call sees it: the row, the question it answered, the exact text this piece
 *  was read from, and which piece of how many it is. A short answer is one piece keyed by the observation
 *  id alone, so nothing about reading a short answer changed. */
type AnalysisTarget = {
  row: AnalyzableObservation; question: string;
  /** What the model echoes back: the observation id for a one piece answer, `id#2` for the second piece of
   *  a split one, so a reading always comes home to the piece it was taken on. */
  key: string; part: number; parts: number;
  /** The only text this piece may be checked against, which is what makes per answer grounding possible. */
  text: string;
};

/** PURE. One answer as the bounded pieces a call can read, covering ALL of it. A short answer is ONE piece.
 *  A long one is cut at the last paragraph break before the budget (then a sentence end, then a space, then
 *  the budget), so no piece starts mid sentence. NO piece ceiling: that is how a tail went unread. */
function splitAnswer(text: string, budget = BATCH_ANSWER_CHARS): string[] {
  if (text.length <= budget) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > budget) {
    const window = rest.slice(0, budget), floor = Math.floor(budget / 2);
    const para = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    const dot = window.lastIndexOf(". "), space = window.lastIndexOf(" ");
    const cut = para >= floor ? para : dot >= floor ? dot + 1 : space >= floor ? space : budget;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/** PURE. The pieces of ONE answer read as ONE reading, ACROSS PASSES. The account is mentioned when ANY
 *  piece named it, and every list is unioned in the order the answer said things and deduped, so what the
 *  last third introduced survives instead of being lost with the tail. Caps mirror the schema's own. */
function mergeAnswerReadings(readings: readonly AnswerAnalysis[]): AnswerAnalysis | null {
  if (readings.length === 0) return null;
  if (readings.length === 1) return readings[0] ?? null; // a short answer merges to itself, byte for byte
  const union = <X,>(pick: (a: AnswerAnalysis) => readonly X[] | undefined, key: (x: X) => string, max: number): X[] => {
    const seen = new Set<string>(), out: X[] = [];
    for (const r of readings) for (const x of pick(r) ?? []) {
      const k = key(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
      if (out.length >= max) return out;
    }
    return out;
  };
  const named = readings.find((r) => r.ownedBrandMention?.mentioned === true);
  return {
    sections: union((r) => r.sections, (s) => `${s.heading}|${s.covers}`, 12),
    claims: union((r) => r.claims, (c) => `${c.subject}|${c.text}`, 24),
    topicEntities: union((r) => r.topicEntities, (e) => e.toLowerCase(), 30),
    ownedBrandMention: named?.ownedBrandMention ?? { mentioned: false, position: null, context: null },
    competitors: union((r) => r.competitors, (c) => c.name.toLowerCase(), 20),
    contentTypesRecommended: union((r) => r.contentTypesRecommended, (c) => c.toLowerCase(), 12),
    questionsAnswered: union((r) => r.questionsAnswered, (q) => q.toLowerCase(), 15),
    materialOmissions: union((r) => r.materialOmissions, (m) => m.toLowerCase(), 10),
    caveats: union((r) => r.caveats, (c) => c.toLowerCase(), 10),
  };
}

/** PURE. The number this reading restates that ITS OWN answer never says, or null. Every returned item is
 *  re-checked against the exact text it was read from, and only that item is dropped. */
function numberNotInOwnAnswer(analysis: AnswerAnalysis, ownText: string): string | null {
  const ledger = buildGroundedNumbers(ownText);
  return findUngroundedNumbers(draftProseStringValues(analysis).join("\n"), ledger)[0] ?? null;
}

type AnalysisDeps = {
  readObservations?: (tenantId: string, opts: { day?: string }) => Promise<readonly AnalyzableObservation[]>;
  persist?: (tenantId: string, observationId: string, analysis: Record<string, unknown>, analysisHash: string) => Promise<void>;
  analyze?: (input: { tenantId: string; question: string; engine: string; answerText: string; brand: string }) => Promise<AnswerAnalysis | null>;
  /** ONE call over many pieces. Returns a reading per piece key; null = the whole call was unusable
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

/** ONE strict structured call per PIECE. The piece's own text is the whole input and the whole grounding, so
 *  a fallback reading is grounded exactly like a batch one. Null on anything that is not a validated draft. */
async function analyzeOne(input: { tenantId: string; question: string; engine: string; answerText: string; brand: string }, complete?: CompleteFn): Promise<AnswerAnalysis | null> {
  const user = [
    `BRAND TO LOOK FOR: ${input.brand || "(none supplied)"}`,
    `QUESTION ASKED: ${input.question}`,
    `ENGINE: ${input.engine}`,
    "ANSWER TEXT (the only thing you may restate):",
    input.answerText,
  ].join("\n");
  const out = await callStructuredLLM({
    kind: "answer_analysis",
    tenantId: input.tenantId,
    system: ANSWER_ANALYSIS_SYSTEM,
    user,
    grounded: input.answerText,
    projectedCostUsd: ANSWER_ANALYSIS_COST_USD,
    maxTokens: 3000,
    ...(complete ? { complete } : {}),
  });
  return out.status === "drafted" ? (out.value as AnswerAnalysis) : null;
}

/**
 * ONE strict structured call over MANY pieces, same gateway, same reader rules. Returns a reading per piece
 * key; null means the whole call was unusable, which the caller degrades from rather than treating as fifteen
 * refusals. An entry naming a key this batch did not ask about is DROPPED and a repeated key keeps the first:
 * a reading must belong to the piece it was taken on.
 */
async function analyzeMany(input: { tenantId: string; brand: string; targets: readonly AnalysisTarget[] }, complete?: CompleteFn): Promise<Map<string, AnswerAnalysis> | null> {
  const bodies = input.targets.map((t) => t.text);
  const user = [`BRAND TO LOOK FOR: ${input.brand || "(none supplied)"}`, `Read all ${input.targets.length} answers below. Return one entry per OBSERVATION.`]
    .concat(input.targets.map((t, i) => [
      `OBSERVATION ${t.key}`,
      `QUESTION ASKED: ${t.question}`,
      `ENGINE: ${t.row.engine}`,
      t.parts > 1
        ? `ANSWER TEXT (the only thing you may restate; this is PART ${t.part} OF ${t.parts} of one long answer, so read this part on its own and do not guess what the other parts say):`
        : "ANSWER TEXT (the only thing you may restate):",
      bodies[i] ?? "",
    ].join("\n"))).join("\n\n");
  const out = await callStructuredLLM({
    kind: "answer_analysis_batch",
    tenantId: input.tenantId,
    system: BATCH_ANALYSIS_SYSTEM,
    user,
    // A COARSE FIRST NET ONLY. The gateway reads every piece here as one body of text, so it catches a number
    // no piece in the batch contains and cannot catch a number carried from one answer to another. The real
    // firewall is numberNotInOwnAnswer, which re-checks each returned item against its own piece's text.
    grounded: bodies.join("\n"),
    projectedCostUsd: BATCH_ANALYSIS_COST_USD,
    maxTokens: 18_000,
    timeoutMs: BATCH_TIMEOUT_MS,
    ...(complete ? { complete } : {}),
  });
  if (out.status !== "drafted") {
    log.warn("[daily-observations] a batch reading of stored answers came back unusable; falling back to one piece at a time", { tenantId: input.tenantId, pieces: input.targets.length, status: out.status });
    return null;
  }
  const asked = new Set(input.targets.map((t) => t.key));
  const byId = new Map<string, AnswerAnalysis>();
  for (const entry of (out.value as AnswerAnalysisBatch).analyses) {
    const { observationId, ...analysis } = entry;
    if (!asked.has(observationId) || byId.has(observationId)) continue;
    byId.set(observationId, analysis as AnswerAnalysis);
  }
  return byId;
}

/**
 * Read back the day's new answers, bounded and RESUMABLE. Returns how many readings were PERSISTED, never
 * how many were attempted. $0 when nothing is new. Fail-soft by contract: analysis is derived from evidence
 * already safely stored, so a failure here must never pause the run that just did the expensive part.
 *
 * THE TERMINAL CONDITION: every PIECE this pass sends ends it merged or dropped with the reason stored, and
 * an answer whose every piece is accounted for is stamped with its own answer hash and leaves the worklist.
 * A piece never sent is still owed, so the next pass reads it and nothing is paid for twice.
 */
export async function runAnswerAnalyses(tenantId: string, day: string, deps: AnalysisDeps = {}): Promise<number> {
  const readObservations = deps.readObservations ?? (async (t, o) => (await evidenceObservations()).readAiObservationViews(t, o));
  const persist = deps.persist
    ?? (async (t, id, analysis, hash) => (await evidenceObservations()).persistAnswerAnalysis(t, id, analysis, hash));
  const rows = await readObservations(tenantId, { day }).catch(() => null);
  if (rows == null || rows.length === 0) return 0;
  const budget = deps.max ?? MAX_ANALYSES_PER_PASS;
  const targets = selectAnalysisTargets(rows, budget);
  if (targets.length === 0) return 0; // nothing new: no call, no cent
  // WHAT THIS PASS IS NOT TAKING ON, said out loud. Deferred answers stay due and the next pass reads them.
  const deferred = dueForAnalysis(rows).length - targets.length;
  if (deferred > 0) log.info("[daily-observations] more new answers than one pass reads back; the rest stay due", { tenantId, day, reading: targets.length, deferred });

  // WHO AM I LOOKING FOR. The pass used to send an EMPTY brand, so the model was asked whether an answer
  // named nobody and every reading came back "not mentioned". An identity with no forms buys nothing.
  const identity = deps.identity ?? await loadBrandIdentity(tenantId).catch(() => null);
  if (identity == null || identity.forms.length === 0) {
    log.warn("[daily-observations] no business name or website on file, so I am not reading answers back for a brand I cannot name", { tenantId, day });
    return 0;
  }

  const prompts = await (deps.readPrompts ?? readActiveTrackedPrompts)(tenantId).catch(() => null);
  const textOf = new Map((prompts ?? []).map((p) => [p.id, p.text]));
  const analyze = deps.analyze ?? ((i: Parameters<typeof analyzeOne>[0]) => analyzeOne(i, deps.complete));
  const analyzeBatch = deps.analyzeBatch ?? ((i: Parameters<typeof analyzeMany>[0]) => analyzeMany(i, deps.complete));
  // The SAME budget selection packed against, so the two can never disagree about what this pass owns.
  let calls = Math.max(1, Math.ceil(Math.max(0, budget) / ANSWERS_PER_BATCH)), written = 0;

  /** ONE reading lands for ONE answer, whatever produced it. `analysis` null means I could not produce a
   *  reliable one; `extra` carries what the stored reading must admit about itself, including the coverage
   *  checkpoint; `hash` is the answer's own hash only when the answer is finished. */
  const settleOne = async (row: AnalyzableObservation, analysis: AnswerAnalysis | null, reason: string, extra: Record<string, unknown>, hash: string): Promise<void> => {
    const answerText = String(row.answerText ?? "");
    // THE SECOND PAIR OF EYES, on the WHOLE answer even when the model was handed one piece of it. The model
    // reads the piece; this reads the same answer for the account's own name and its own address. The verdict
    // is either one of them, and `matchedBy` records which found it, so a model miss never looks like a real absence.
    const found = findBrand(identity, answerText, row.citationUrls);
    // A REFUSAL IS A RESULT, stored against the answer it was taken on. Persisting nothing left the row at the
    // top of the worklist, so a rejection re-bought the same calls every pass, forever. What I DID see in the
    // text still rides along: a refusal is not a reason to lose a mention I can prove.
    if (analysis == null) {
      const rejection = {
        rejected: true, reason, ...extra,
        ...(found ? { ownedBrandMention: { mentioned: true, position: null, context: null }, matchedBy: found } : {}),
      };
      // A REFUSAL IS WRITTEN WITH THE SAME DISCIPLINE AS A READING: one retry, and a loss said out loud.
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
      // HOW MUCH OF THIS ANSWER I ACTUALLY READ, on the record. A reading of some of a long answer is never
      // allowed to look like a reading of all of it.
      ...extra,
    } as unknown as Record<string, unknown>;
    // ONE retry on a lost write. Still lost leaves the row for the next pass, where the gateway's own call
    // cache serves the identical request at $0, so a retry costs nothing but the round trip.
    const saved = await persist(tenantId, row.id, record, hash).then(() => true)
      .catch(() => persist(tenantId, row.id, record, hash).then(() => true).catch(() => false));
    if (saved) written += 1;
  };

  /** ONE ANSWER'S PIECES, SETTLED AS ONE ANSWER, ACROSS PASSES. Each piece is checked against its own text,
   *  what landed is merged ON TOP of what earlier passes merged, and the checkpoint records exactly which
   *  pieces are accounted for. Only an answer with nothing left owing is stamped with its own hash. */
  const settleAnswer = async (pieces: readonly AnalysisTarget[], readings: Map<string, AnswerAnalysis>): Promise<void> => {
    const row = pieces[0]!.row, parts = pieces[0]!.parts, was = coverageOf(row), prior = priorReading(row);
    const read = [...(was?.read ?? [])], dropped = [...(was?.dropped ?? [])];
    const landed: AnswerAnalysis[] = [], lost: string[] = [];
    for (const p of pieces) {
      const of = parts > 1 ? `part ${p.part} of ${parts} of this answer` : "this answer";
      const reading = readings.get(p.key);
      if (reading == null) { lost.push(`I read a batch of answers back and ${of} came back missing from the reading.`); dropped.push(p.part); continue; }
      // PER ANSWER GROUNDING. A number is checked against the text THIS piece was read from, never the batch.
      const invented = numberNotInOwnAnswer(reading, p.text);
      if (invented != null) { lost.push(`The reading of ${of} used the number ${invented}, which that text never says, so I dropped it rather than store a number the answer cannot back.`); dropped.push(p.part); continue; }
      landed.push(reading); read.push(p.part);
    }
    const coverage: Coverage = { hash: String(row.answerHash), parts, read: [...read].sort((a, b) => a - b), dropped: [...dropped].sort((a, b) => a - b) };
    const owed = parts - read.length - dropped.length;
    // A one piece answer needs no checkpoint: it is settled the moment it is read, either way.
    const book = parts > 1 ? { coverage } : {};
    const hash = owed > 0 ? partialHash(coverage) : String(row.answerHash);
    const merged = mergeAnswerReadings([...(prior ? [prior] : []), ...landed]);
    if (merged == null) {
      await settleOne(row, null, `${lost.join(" ")} I recorded that rather than paying to be told nothing twice.`.trim(), book, hash);
      return;
    }
    const note = [...lost, ...(owed > 0
      ? [`I have read ${read.length} of this answer's ${parts} parts so far; the next pass reads part ${parts - owed + 1} onward and pays nothing for the parts already read.`]
      : [])].join(" ");
    await settleOne(row, merged, "", {
      ...(parts > 1 ? { readParts: read.length } : {}),
      ...(note ? { answerReadInPart: true, reason: `${note} What I did read is stored, and a new answer is what asks again.` } : {}),
      ...book,
    }, hash);
  };

  /** The degrade: re-read what a broken batch was carrying, ONE CALL PER PIECE, each grounded in that piece's
   *  own text, bounded to THAT batch. What the bound leaves is untouched, so the next pass picks it up free. */
  const readOneByOne = async (group: readonly (readonly AnalysisTarget[])[]): Promise<void> => {
    let singles = SINGLE_FALLBACKS_PER_BATCH;
    for (const pieces of group) {
      if (singles <= 0) return; // untouched, unpaid, still owed
      const readings = new Map<string, AnswerAnalysis>();
      const sent: AnalysisTarget[] = [];
      for (const p of pieces) {
        if (singles <= 0) break;
        singles -= 1;
        sent.push(p);
        const one = await analyze({ tenantId, question: p.question, engine: p.row.engine, answerText: p.text, brand: identity.name }).catch(() => null);
        if (one != null) readings.set(p.key, one);
      }
      await settleAnswer(sent, readings);
    }
  };

  // ONE ANSWER'S UNREAD PIECES TRAVEL TOGETHER, so a long answer is merged inside the call that read it.
  const groups: AnalysisTarget[][] = [];
  for (const row of targets) {
    const question = row.promptText || textOf.get(row.promptId) || "";
    const all = splitAnswer(String(row.answerText ?? ""));
    const owed = new Set(missingParts(row));
    const pieces = all
      .map((text, i) => ({ row, question, key: all.length > 1 ? `${row.id}#${i + 1}` : row.id, part: i + 1, parts: all.length, text }))
      .filter((p) => owed.has(p.part))
      .slice(0, ANSWERS_PER_BATCH);
    if (pieces.length === 0) continue;
    const last = groups[groups.length - 1];
    if (last == null || last.length + pieces.length > ANSWERS_PER_BATCH) groups.push([...pieces]);
    else last.push(...pieces);
  }
  for (const group of groups) {
    // Selection already packed these groups against the same budget, so this can only trip if a caller
    // hands a budget the selector never saw. It stays as the floor, and it can no longer strand pieces.
    if (calls <= 0) break;
    calls -= 1;
    const byAnswer = [...group.reduce((m, p) => m.set(p.row.id, [...(m.get(p.row.id) ?? []), p]), new Map<string, AnalysisTarget[]>()).values()];
    const readings = await analyzeBatch({ tenantId, brand: identity.name, targets: group }).catch(() => null);
    // WHOLESALE FAILURE. The gateway already retried this call once against the same schema, so a second
    // identical batch would buy the same refusal: the group drops to one piece at a time instead.
    if (readings == null) { await readOneByOne(byAnswer); continue; }
    // A MISSING, UNKNOWN OR UNGROUNDED PIECE IS ONE DROP, not fifteen. Its neighbours keep their readings.
    for (const pieces of byAnswer) await settleAnswer(pieces, readings);
  }
  if (written > 0) log.info("[daily-observations] read back new AI answers", { tenantId, day, written });
  return written;
}
