import "server-only";

/**
 * answer-readback - READING THE STORED AI ANSWERS BACK. Collection buys the answers, this reads them: ONE strict structured call reads a BATCH of stored answers
 * (what each said, who it named, what it left out) and Evidence persists one reading per observation. IT COSTS NOTHING WHEN NOTHING CHANGED, a call fires only on
 * a piece nobody has read yet, and A LONG ANSWER IS READ WHOLE, IN PIECES, ACROSS AS MANY PASSES AS IT TAKES: split on its own paragraph breaks, every piece keyed
 * `id#part`, merged into ONE stored reading beside a COVERAGE CHECKPOINT naming which pieces of which answer hash are in it. Until every piece is accounted for
 * that reading carries a deliberately different hash, so the row stays due and the next pass resumes at the first unread piece. EVERY READING IS GROUNDED IN ITS
 * OWN ANSWER: each returned item is re-checked against the exact text it was read from and a failing item is dropped alone with the number named, because one
 * batch grounded as a single body of text let a number only answer A contained validate a fabricated claim about answer B. EVERY PIECE THIS PASS SENDS COMES BACK
 * SETTLED: merged, or dropped with its reason, and a piece never sent is owed.
 *
 * WHOSE FAILURE WAS IT DECIDES EVERYTHING, AND ONLY A RECEIPT SETTLES (see ReadFailure below, which names all seven). A call that returned no body leaves nothing
 * stored and the answers due, and the pass STOPS there rather than fanning one throttled batch into fifteen more calls; anything that RETURNED settles every
 * answer it covered, permanently, for that hash, after dropping to ONE CALL PER PIECE first so the readings themselves still land. EVERYTHING PURCHASED IS
 * OWED A READING: a pass reads the OLDEST day that still owes one across a ROTATING lookback of THE LAST 26 WEEKS (182 days), not the run's own day, not a fixed
 * recent week, and not any age at all, because today's fresh debt kept that week busy and permanently abandoned everything behind it. THE DETERMINISTIC VERDICT IS NEVER THE MODEL'S TO REFUSE: every answer this pass
 * settles carries mentioned true OR false, off the answer's own words and the addresses it credited, and `matchedBy` says which found it, so Visibility divides by
 * every answer read rather than by the ones the matcher happened to match. Runtime orchestrates, and Evidence never imports Decision.
 */

import { loadBrandIdentity, type BrandIdentity } from "@/domains/account/brand-identity";
import { buildGroundedNumbers, findUngroundedNumbers } from "@/domains/decision/llm/numeric-fidelity";
import { creditBreakerActive } from "@/domains/decision/llm/gateway";
import type { LlmFailure } from "@/domains/decision/llm/gateway";
import { callStructuredLLM, type CompleteFn, type StructuredDraftResult } from "@/domains/decision/llm/structured-drafter";
import { draftProseStringValues, type AnswerAnalysis, type AnswerAnalysisBatch } from "@/domains/decision/llm/schemas";
import { isAnalysisSettled, TYPED_FAILURE_RULES, type AiObservationView } from "@/domains/evidence/ai-visibility/ai-observations";
import { log } from "@/lib/logger";
import { readActiveTrackedPrompts, type TrackedQuestion } from "../prompt-set";

type AnalyzableObservation = AiObservationView;

/** Evidence owns the observation store; Runtime asks for it lazily so this module loads (and every test runs) without touching it. */
const evidenceObservations = () => import("@/domains/evidence/ai-visibility/ai-observations");

const ANSWER_ANALYSIS_SYSTEM =
  "You read one AI assistant's answer and record what it says. You are a reader, not an author. Restate only what the ANSWER TEXT contains: every claim "
  + "must use the answer's own wording, every entity, competitor, content type and question must be one the answer itself names. Never invent or infer a "
  + "URL, a number, a statistic, a price, a date, a ranking or a fact that is not in the answer text. Never add your own knowledge about the subject and "
  + "never judge whether the answer is correct. If the answer does not name the brand you are given, set mentioned to false and leave position and "
  + "context null. position is the order the name appears in the answer (1 means named first), never a search ranking. materialOmissions lists what a "
  + "reader of THIS answer still would not know, described in plain words, with no invented facts. Return every field; use an empty array when the "
  + "answer gives you nothing for it.";

/** The BATCH framing on top of exactly the same reader rules: many answers, one call, one reading each. */
const BATCH_ANALYSIS_SYSTEM = ANSWER_ANALYSIS_SYSTEM
  + " You are given SEVERAL answers, each introduced by its own OBSERVATION line. Read each answer entirely on its own: never carry a claim, an entity "
  + "or a competitor from one answer into another, and never let one answer fill a gap in another. Return exactly one entry in analyses for each "
  + "OBSERVATION, with observationId copied character for character from that OBSERVATION line. Never merge two answers into one entry, never write an "
  + "entry for an id you were not given, and never leave one out.";

/** How many pieces ONE structured call reads back, how many such calls a pass may make, and the pass total. FIVE, not fifteen: a fifteen piece batch is about 75,000 input tokens
 *  on its own, which trips the account's per-minute token ceiling by itself, so every pass sent the giant batch, took a throttle twice, and read nothing at all. Five is roughly
 *  7,000 tokens, four of them is 20 pieces a pass, and a 140 answer day is read back over seven of the day's passes. SINGLES_PER_PASS bounds the one-at-a-time fallback at roughly
 *  15,000 tokens a pass, which trickles through the very ceiling one batch used to blow: a CAP, not a sleep, because a bound is exact where a delay is a guess. */
const ANSWERS_PER_BATCH = 5, BATCH_CALLS_PER_PASS = 4, MAX_ANALYSES_PER_PASS = ANSWERS_PER_BATCH * BATCH_CALLS_PER_PASS, SINGLES_PER_PASS = 10;
/** How much of ONE answer ONE slot reads (a longer answer is not cut off, it is SPLIT into this many characters at a time and every piece is read eventually), the
 *  estimated spend for one batch call and for one single-piece call, and the batch timeout: gpt-5-mini reasons before it writes, so a batch asks for more than the
 *  gateway's 90 second reasoning floor rather than have a slow one thrown away half-written. */
const BATCH_ANSWER_CHARS = 5_000, BATCH_ANALYSIS_COST_USD = 0.05, ANSWER_ANALYSIS_COST_USD = 0.01, BATCH_TIMEOUT_MS = 180_000;
/** WHICH DAY A PASS READS, and the honest bound on how far back it can see. Seven days ending today was a PERMANENT ABANDONMENT: today keeps producing fresh debt, so
 *  that window was never quiet and an answer bought eight days ago could never be reached again however many passes ran. A pass now reads at most TWO lean windows,
 *  the seven days the clock has ROTATED to and the recent seven, and takes the OLDEST day either still owes. The rotation moves every hour and wraps at
 *  LOOKBACK_WINDOWS, so every one of THE LAST 26 WEEKS (182 days) is reached within about a day of passes and the per-pass cost stays two lean projections and one
 *  day of rows. An answer older than 182 days is never read back: that is the bound I state rather than hide, and no surface may call it "any age". `dayMinus` is `day` less n days as a label, taken at noon so no daylight-saving edge can move it. */
const READBACK_WINDOW_DAYS = 7, LOOKBACK_WINDOWS = 26, WINDOW_ROTATION_MS = 3_600_000;
const dayMinus = (day: string, n: number): string => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

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
  const parts = splitAnswer(String(row.answerText ?? "")).length, c = coverageOf(row);
  const settled = new Set([...(c?.read ?? []), ...(c?.dropped ?? [])]);
  return Array.from({ length: parts }, (_, i) => i + 1).filter((p) => !settled.has(p));
}

/** PURE. The reading already merged for this answer, without the bookkeeping, so a later pass merges its new pieces on top instead of starting over. */
function priorReading(row: AnalyzableObservation): AnswerAnalysis | null {
  if (coverageOf(row) == null || row.analysis == null) return null;
  const { coverage: _c, readParts: _p, answerReadInPart: _a, reason: _r, matchedBy: _m, rejected: _j, outcome: _o, ...rest } =
    row.analysis as Record<string, unknown>;
  return rest as unknown as AnswerAnalysis;
}

/** PURE. The hash a PART READ answer is stamped with: derived from the answer hash and deliberately NOT equal to it, so the settled test says "not yet". */
const partialHash = (c: Coverage): string => `${c.hash}~${c.read.length + c.dropped.length}of${c.parts}`;

/** PURE. Which stored observations still owe a reading: an answer that landed whose reading is missing, was taken against a DIFFERENT answer, covers
 *  only some of this one, or was rejected for a reason that was never the answer's own. */
export function selectAnalysisTargets(rows: readonly AnalyzableObservation[], max = MAX_ANALYSES_PER_PASS): readonly AnalyzableObservation[] {
  // A PASS TAKES ON ONLY WHAT IT CAN FINISH, COUNTED IN PIECES. Selection packs the same batches the reader packs, so the call budget can never run out
  // mid-list. An answer with more unread pieces than one batch holds claims a batch and finishes over later passes; it never stalls and is never abandoned.
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

/** PURE. Every stored answer that owes a reading, before any budget is applied, on the SAME rule Evidence's own `isAnalysisSettled` applies, so the
 *  planner, the due-work probe and this pass can never disagree about what is finished. */
function dueForAnalysis(rows: readonly AnalyzableObservation[]): readonly AnalyzableObservation[] {
  return rows
    .filter((r) => Boolean(r.id) && Boolean(r.answerText) && Boolean(r.answerHash))
    .filter((r) => !isAnalysisSettled({ analysis: r.analysis, analysisHash: r.analysisHash, answerHash: r.answerHash }));
}

/** ONE PIECE of one answer as a call sees it: the row, the question it answered, the exact text this piece was read from (the only text it may be
 *  checked against, which is what makes per answer grounding possible), and which piece of how many it is. `key` is what the model echoes back: the
 *  observation id for a one piece answer, `id#2` for the second piece of a split one, so a reading always comes home to the piece it was taken on. */
type AnalysisTarget = { row: AnalyzableObservation; question: string; key: string; part: number; parts: number; text: string };

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

/** PURE. The pieces of ONE answer read as ONE reading, ACROSS PASSES. The account is mentioned when ANY piece named it, and every list is unioned in the
 * order the answer said things and deduped, so what the last third introduced survives instead of being lost with the tail. Caps mirror the schema's own. */
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

/** WHY A READING DID NOT LAND, BY NAME, AND THE NAME IS THE TRANSPORT'S OWN TYPE (gateway.ts's LlmFailure, threaded through the drafter). One word, `refused`,
 *  used to cover a reader saying no, an output whose shape I could not parse, an answer cut off half way and a call I abandoned at my own timeout, so nobody could
 *  tell a provider's failure from a bug of mine and every one of them was made permanent on the same evidence. Each name decides two things: does the answer settle
 *  for good, and does the pass go on. IT RETURNED A BODY AND A USAGE RECEIPT, so it is PERMANENT for this answer at this hash: `provider_refused` (the reader
 *  refused the content), `schema_invalid` (a shape I could not use, or a number its own answer never says; ledgered) and `incomplete` (it returned and left this
 *  answer out, or cut it off). NO BODY AND NO RECEIPT, so nothing is stored and the answer stays owed: `transient` (a throttle, a server fault, a dead connection,
 *  a request the provider would not take), `client_timeout` (I abandoned the call at my own deadline, which returned nothing and carries no receipt, so I cannot
 *  prove the reader ever began or that a cent was charged; the storm it used to justify settling is prevented by the BOUNDED LADDER instead, one batch attempt then
 *  bounded singles, and a single that also runs past the deadline stops the pass at two unbilled calls, so an answer that keeps timing out stays owed at that price
 *  and settles itself the first time any reading lands), `credit_exhausted` (the ACCOUNT'S own provider balance) and `budget` (Beacon's
 *  own cap: no call was made). The last three also STOP the pass. NOTHING IS MATCHED OUT OF AN ERROR SENTENCE ANY MORE: anchoring on the exact string
 *  `llm_openai_429` meant the same throttle wearing the code OpenAI actually sends (`openai_429_rate_limit_exceeded`) fell through to schema_invalid, and 50
 *  answers on 3 August were settled as refused, stamped with their own answer hash, for calls that returned nothing and cost nothing. */
type ReadFailure = LlmFailure;
/** The names a PERMANENT non-reading is stored under, every one of them a call that RETURNED. `attempts_exhausted` is the bounded ladder itself running out: one
 *  batch, then one call for this piece alone, neither usable and both billed, so a third ask only buys the same nothing. */
type ReadOutcome = "provider_refused" | "schema_invalid" | "incomplete" | "attempts_exhausted";
/** What each named non-reading says on the record, in the operator's own words. */
const WHY_SAID: Record<ReadOutcome, string> = { provider_refused: "the reader refused to read it", schema_invalid: "the reading came back in a shape I could not use",
  incomplete: "it was left out of the reading that came back", attempts_exhausted: "I asked for it in a batch and then on its own, and neither came back usable" };

type AnalysisDeps = {
  readObservations?: (tenantId: string, opts: { day?: string }) => Promise<readonly AnalyzableObservation[]>;
  /** Which recent days still owe a reading, oldest first, off the CHEAPEST projection there is (identity, status and the two settlement hashes, never the
   *  answer text or the journey): a whole-window read of full rows is megabytes an account per pass and is the shape that has timed a statement out here. */
  unreadDays?: (tenantId: string, fromDay: string, toDay: string) => Promise<readonly string[]>;
  persist?: (tenantId: string, observationId: string, analysis: Record<string, unknown>, analysisHash: string) => Promise<void>;
  analyze?: (input: { tenantId: string; question: string; engine: string; answerText: string; brand: string }) => Promise<AnswerAnalysis | ReadFailure | null>;
  /** ONE call over many pieces. Returns a reading per piece key, or WHY the whole call produced none. Null is
   *  read as `refused`, so a caller that only knows "unusable" still degrades exactly as it always did. */
  analyzeBatch?: (input: { tenantId: string; brand: string; targets: readonly AnalysisTarget[] }) => Promise<Map<string, AnswerAnalysis> | ReadFailure | null>;
  readPrompts?: (tenantId: string) => Promise<TrackedQuestion[] | null>;
  /** The clock the lookback ROTATES on. Tests move it to prove an old day is reached; production passes nothing. */
  now?: number;
  /** WHO THIS ACCOUNT IS. Tests inject it; production always loads the real one and never falls back to an empty brand (see runAnswerAnalyses). */
  identity?: BrandIdentity;
  complete?: CompleteFn; // the LLM transport, so a test can exercise this exact prompt without a key
  max?: number;
};

/** Which path found the account in an answer: the model's reading, the answer's own words, an address it credited, or both the model and the words. A
 *  later reader can tell a model miss from a real absence, which a bare true/false never could. */
type BrandMatchPath = "model" | "text" | "citation" | "both";

/** A name counts only as a WHOLE word, tolerant of the spacing and punctuation a writer chose ("Ritz Builders", "ritz-builders"), so "Ritz" is never
 *  found inside "Ritzy" and no substring of an unrelated word can invent a mention. */
function formPattern(form: string): RegExp | null {
  const parts = form.match(/[\p{L}\p{N}]+/gu);
  if (parts == null || parts.length === 0) return null;
  const body = parts.join("[^\\p{L}\\p{N}]{0,2}");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
}

const hostOfUrl = (raw: string): string =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";

/** PURE. Does this answer name the account, in its own text or in what it credited? null = neither, a real absence and not a shrug. */
function findBrand(identity: BrandIdentity, answerText: string, citationUrls: readonly string[] | null): Exclude<BrandMatchPath, "model" | "both"> | null {
  if (answerText && identity.forms.some((f) => formPattern(f)?.test(answerText) === true)) return "text";
  const host = identity.host;
  if (host && (citationUrls ?? []).some((u) => { const h = hostOfUrl(u); return h === host || h.endsWith(`.${host}`); })) return "citation";
  return null;
}

/** PURE. WHICH named failure a non-drafted result was, read off the TYPE the transport put on it rather than out of its own error text. A status that never
 *  reached the transport at all (no allowance, no key) is my own side saying no: no call was made, so nothing is owed to anybody but the answer itself. */
function failureOf(out: StructuredDraftResult<unknown>): ReadFailure {
  return out.status === "validation_failed" ? out.failure : "budget";
}

/** THE REJECTION LEDGER, wired. llm_rejections was created for exactly this and has been empty since: a call that RETURNED and could not be used is money already
 *  spent on nothing. Fail-soft, because a ledger I could not write is never a reason to lose the verdict persisted beside it. */
async function recordRejection(tenantId: string, row: AnalyzableObservation, reason: string): Promise<void> {
  try {
    await (await import("@/lib/persistence/supabase")).getSupabaseAdmin().from("llm_rejections").insert({
      id: `rej_${row.id}_${row.answerHash}`.slice(0, 120), tenant_id: tenantId, rec_id: row.id, provider_name: "openai",
      model: "gpt-5-mini", evidence_hash: row.answerHash, validation_error: reason.slice(0, 500) });
  } catch { /* recorded or not, the reading verdict beside it already landed */ } }

/** ONE strict structured call per PIECE: the piece's own text is the whole input and the whole grounding, so a fallback reading is grounded exactly like a batch
 *  one. Otherwise, whose failure it was. */
async function analyzeOne(input: { tenantId: string; question: string; engine: string; answerText: string; brand: string }, complete?: CompleteFn): Promise<AnswerAnalysis | ReadFailure> {
  const user = [`BRAND TO LOOK FOR: ${input.brand || "(none supplied)"}`, `QUESTION ASKED: ${input.question}`, `ENGINE: ${input.engine}`,
    "ANSWER TEXT (the only thing you may restate):", input.answerText].join("\n");
  const out = await callStructuredLLM({ kind: "answer_analysis", tenantId: input.tenantId, system: ANSWER_ANALYSIS_SYSTEM, user, grounded: input.answerText,
    projectedCostUsd: ANSWER_ANALYSIS_COST_USD, maxTokens: 3000, ...(complete ? { complete } : {}) });
  return out.status === "drafted" ? (out.value as AnswerAnalysis) : failureOf(out);
}

/** ONE strict structured call over MANY pieces, same gateway, same reader rules. Returns a reading per piece key, or WHOSE failure produced none, which the caller
 * degrades from rather than treating as fifteen refusals. An entry naming a key this batch did not ask about is DROPPED and a repeated key keeps the first. */
async function analyzeMany(input: { tenantId: string; brand: string; targets: readonly AnalysisTarget[] }, complete?: CompleteFn): Promise<Map<string, AnswerAnalysis> | ReadFailure> {
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
  // `grounded` IS A COARSE FIRST NET ONLY. The gateway reads every piece here as one body of text, so it catches a number no piece in the batch contains and
  // cannot catch one carried from answer to answer. The real firewall is numberNotInOwnAnswer, which re-checks each returned item against its own piece's text.
  const out = await callStructuredLLM({ kind: "answer_analysis_batch", tenantId: input.tenantId, system: BATCH_ANALYSIS_SYSTEM, user, grounded: bodies.join("\n"),
    projectedCostUsd: BATCH_ANALYSIS_COST_USD, maxTokens: 7_000, timeoutMs: BATCH_TIMEOUT_MS, ...(complete ? { complete } : {}) });
  if (out.status !== "drafted") {
    const why = failureOf(out);
    log.warn("[daily-observations] a batch reading of stored answers did not land", { tenantId: input.tenantId, pieces: input.targets.length, status: out.status, why });
    return why; }
  const asked = new Set(input.targets.map((t) => t.key)), byId = new Map<string, AnswerAnalysis>();
  for (const entry of (out.value as AnswerAnalysisBatch).analyses) {
    const { observationId, ...analysis } = entry;
    if (asked.has(observationId) && !byId.has(observationId)) byId.set(observationId, analysis as AnswerAnalysis); }
  return byId;
}

/** Read back the day's new answers, bounded and RESUMABLE. Returns how many readings were PERSISTED, never how many were attempted. $0 when nothing is
 *  new, and fail-soft by contract: analysis is derived from evidence already safely stored, so a failure here must never pause the run that just did the
 *  expensive part. THE TERMINAL CONDITION: every PIECE this pass sends ends it merged or dropped with the reason stored, an answer whose every piece is
 *  accounted for is stamped with its own answer hash and leaves the worklist, and a piece never sent is still owed. Nothing is ever paid for twice. */
export async function runAnswerAnalyses(tenantId: string, day: string, deps: AnalysisDeps = {}): Promise<number> {
  const readObservations = deps.readObservations ?? (async (t, o) => (await evidenceObservations()).readAiObservationViews(t, o));
  const persist = deps.persist
    ?? (async (t, id, analysis, hash) => (await evidenceObservations()).persistAnswerAnalysis(t, id, analysis, hash));
  // THE DAY THIS PASS READS IS THE OLDEST ONE THAT STILL OWES A READING, never the run's own: an answer bought on Monday is a debt on Tuesday too.
  const unreadDays = deps.unreadDays ?? (async (t: string, from: string, to: string) => {
    const ev = await evidenceObservations(), seen = await ev.readAiObservations(t, { fromDay: from, toDay: to, projection: "outcome" });
    return [...new Set(seen.filter((r) => r.status === "observed" && r.answer_hash != null
      && !ev.isAnalysisSettled({ analysis: r.analysis, analysisHash: r.analysis_hash ?? null, answerHash: r.answer_hash ?? null })).map((r) => r.reporting_day))].sort(); });
  // OLDEST UNSETTLED FIRST, ACROSS THE STORE AND NOT ACROSS ONE WEEK. Two lean window reads at most (the seven days the rotation points at, then the recent
  // seven) and the oldest day either owes is what this pass reads. BOTH reads failing falls back to the run's own day, which is what it always did when blind.
  const back = (READBACK_WINDOW_DAYS * (Math.floor((deps.now ?? Date.now()) / WINDOW_ROTATION_MS) % LOOKBACK_WINDOWS));
  const owed: string[] = []; let looked = false;
  for (const n of back === 0 ? [0] : [back, 0]) {
    const to = dayMinus(day, n);
    const seen = await unreadDays(tenantId, dayMinus(to, READBACK_WINDOW_DAYS - 1), to).catch(() => null);
    if (seen != null) { looked = true; owed.push(...seen); } }
  const reading = (looked ? owed.sort()[0] : null) ?? day, // the day this pass actually reads, which every line below names rather than the run's own
    rows = await readObservations(tenantId, { day: reading }).catch(() => null);
  if (rows == null || rows.length === 0) return 0;
  const budget = deps.max ?? MAX_ANALYSES_PER_PASS, targets = selectAnalysisTargets(rows, budget);
  if (targets.length === 0) return 0; // nothing new: no call, no cent
  const deferred = dueForAnalysis(rows).length - targets.length; // what this pass is NOT taking on, said out loud: a deferred answer stays due
  if (deferred > 0) log.info("[daily-observations] more new answers than one pass reads back; the rest stay due", { tenantId, day: reading, answers: targets.length, deferred });
  // WHO AM I LOOKING FOR. The pass used to send an EMPTY brand, so the model was asked whether an answer named nobody and every reading came back "not mentioned".
  const identity = deps.identity ?? await loadBrandIdentity(tenantId).catch(() => null);
  if (identity == null || identity.forms.length === 0) {
    log.warn("[daily-observations] no business name or website on file, so I am not reading answers back for a brand I cannot name", { tenantId, day });
    return 0; }

  // NOTHING IS BOUGHT AGAINST A SPENT ACCOUNT. The gateway's durable account-level stop is the one authority on that, and asking it costs one read against a row
  // no monthly cap can see; a balance at zero cannot produce a reading, so a pass that spends its whole ladder discovering that bought nothing and lost the time.
  if (await creditBreakerActive(tenantId).catch(() => false)) {
    log.warn("[daily-observations] your AI provider credit is spent, so I read nothing back and every answer is still owed a reading", { tenantId, day: reading, owed: targets.length });
    return 0; }

  const prompts = await (deps.readPrompts ?? readActiveTrackedPrompts)(tenantId).catch(() => null);
  const textOf = new Map((prompts ?? []).map((p) => [p.id, p.text]));
  // WHAT THIS PASS HAS ALREADY SPENT AND ALREADY SETTLED. `billed` counts the calls that genuinely returned something, so a pass that paid and stored nothing is a
  // contradiction I say out loud; `attempted` makes ONE attempt per answer per pass structural, so no ladder below can send the same answer twice in one pass.
  let billed = 0, settledHere = 0, singlesLeft = SINGLES_PER_PASS; const attempted = new Set<string>();
  const analyze = deps.analyze ?? ((i: Parameters<typeof analyzeOne>[0]) => analyzeOne(i, deps.complete));
  const analyzeBatch = deps.analyzeBatch ?? ((i: Parameters<typeof analyzeMany>[0]) => analyzeMany(i, deps.complete));
  // The SAME budget selection packed against, so the two can never disagree about what this pass owns.
  let calls = Math.max(1, Math.ceil(Math.max(0, budget) / ANSWERS_PER_BATCH)), written = 0;

  /** ONE reading lands for ONE answer, whatever produced it. `analysis` null means none could be produced; `extra` carries what the stored reading must admit about
   * itself, including the coverage checkpoint; `hash` is the answer's own hash only when the answer is finished; `why` names the failure a null reading settles as. */
  const settleOne = async (row: AnalyzableObservation, analysis: AnswerAnalysis | null, reason: string, extra: Record<string, unknown>, hash: string, why: ReadOutcome = "incomplete"): Promise<void> => {
    const answerText = String(row.answerText ?? "");
    // THE SECOND PAIR OF EYES, on the WHOLE answer even when the model was handed one piece of it. The model reads the piece; this reads the same answer for the
    // account's own name and its own address. The verdict is either one of them, and `matchedBy` records WHICH found it, so a model miss never looks like a real
    // absence and no surface may call a deterministic name match a close reading.
    const found = findBrand(identity, answerText, row.citationUrls);
    // A NON-READING THAT RETURNED IS A RESULT, stored against the answer it was taken on and named PERMANENT, so the row leaves the worklist instead of re-buying
    // the same nothing every pass; a call that never returned never reaches here at all. THE DETERMINISTIC VERDICT RIDES ALONG IN BOTH POLARITIES: storing it only
    // when the name was found is what left every negative with no verdict, so the mention rate divided by its own matches and read 100 percent on a day nothing
    // was read. `outcome` is the PERMANENCE token Evidence's settle test reads; `readOutcome` is WHICH named failure it was, so four facts stay four facts.
    if (analysis == null) {
      // `verdictRules` says WHICH rules decided this, and it is what brings the buried rows back with no migration and no row rewritten: a schema_invalid settled
      // under rules 1 could be an ordinary throttle wearing a coded name, so Evidence reads it as owed again, while everything settled under these rules stands.
      const rejection = { rejected: true, outcome: "refused", readOutcome: why, verdictRules: TYPED_FAILURE_RULES, reason, ...extra,
        ownedBrandMention: { mentioned: found != null, position: null, context: null }, matchedBy: found };
      // A REFUSAL IS WRITTEN WITH THE SAME DISCIPLINE AS A READING: one retry, and a loss said out loud.
      const kept = await persist(tenantId, row.id, rejection, hash).then(() => true)
        .catch(() => persist(tenantId, row.id, rejection, hash).then(() => true).catch(() => false));
      if (kept) { settledHere += 1; await recordRejection(tenantId, row, reason); }
      else log.warn("[daily-observations] I could not record that I was refused a reading of this answer, so it will be asked for again", { tenantId, observationId: row.id });
      return; }
    const byModel = analysis.ownedBrandMention?.mentioned === true;
    // `extra` carries HOW MUCH OF THIS ANSWER I ACTUALLY READ: a reading of some of a long answer never looks like a reading of all of it.
    const record = { ...analysis, ownedBrandMention: { ...analysis.ownedBrandMention, mentioned: byModel || found != null },
      matchedBy: (byModel && found ? "both" : byModel ? "model" : found) as BrandMatchPath | null, ...extra } as unknown as Record<string, unknown>;
    // ONE retry on a lost write. Still lost leaves the row for the next pass, where the gateway's own call cache serves the identical request at $0.
    const saved = await persist(tenantId, row.id, record, hash).then(() => true)
      .catch(() => persist(tenantId, row.id, record, hash).then(() => true).catch(() => false));
    if (saved) { written += 1; settledHere += 1; }
  };

  /** ONE ANSWER'S PIECES, SETTLED AS ONE ANSWER, ACROSS PASSES. Each piece is checked against its own text, what landed is merged ON TOP of what earlier
   * passes merged, and the checkpoint records exactly which pieces are accounted for. Only an answer with nothing left owing is stamped with its own hash. */
  const settleAnswer = async (pieces: readonly AnalysisTarget[], readings: Map<string, AnswerAnalysis>, classOf?: Map<string, ReadOutcome>): Promise<void> => {
    const row = pieces[0]!.row, parts = pieces[0]!.parts, was = coverageOf(row), prior = priorReading(row);
    const read = [...(was?.read ?? [])], dropped = [...(was?.dropped ?? [])], landed: AnswerAnalysis[] = [], lost: string[] = [], named: ReadOutcome[] = [];
    for (const p of pieces) {
      const of = parts > 1 ? `part ${p.part} of ${parts} of this answer` : "this answer";
      const reading = readings.get(p.key);
      if (reading == null) {
        // A piece the call NAMED a reason for keeps that reason; one a returned call simply left out is incomplete.
        const why = classOf?.get(p.key) ?? "incomplete";
        lost.push(`I asked for a reading of ${of} and ${WHY_SAID[why]}.`); dropped.push(p.part); named.push(why); continue; }
      // PER ANSWER GROUNDING. A number is checked against the text THIS piece was read from, never the batch.
      const invented = numberNotInOwnAnswer(reading, p.text);
      if (invented != null) { lost.push(`The reading of ${of} used the number ${invented}, which that text never says, so I dropped it rather than store a number the answer cannot back.`); dropped.push(p.part); named.push("schema_invalid"); continue; }
      landed.push(reading); read.push(p.part);
    }
    const coverage: Coverage = { hash: String(row.answerHash), parts, read: [...read].sort((a, b) => a - b), dropped: [...dropped].sort((a, b) => a - b) },
      owed = parts - read.length - dropped.length;
    // A one piece answer needs no checkpoint: it is settled the moment it is read, either way.
    const book = parts > 1 ? { coverage } : {};
    const hash = owed > 0 ? partialHash(coverage) : String(row.answerHash);
    const merged = mergeAnswerReadings([...(prior ? [prior] : []), ...landed]);
    if (merged == null) {
      // An unusable SHAPE outranks a missing piece: it is the more specific thing that went wrong, and the one the ledger exists for.
      const why = named.includes("schema_invalid") ? "schema_invalid" : named[0] ?? "incomplete";
      await settleOne(row, null, `${lost.join(" ")} I recorded that rather than paying to be told nothing twice.`.trim(), book, hash, why);
      return; }
    const note = [...lost, ...(owed > 0
      ? [`I have read ${read.length} of this answer's ${parts} parts so far; the next pass reads part ${parts - owed + 1} onward and pays nothing for the parts already read.`]
      : [])].join(" ");
    await settleOne(row, merged, "", { ...(parts > 1 ? { readParts: read.length } : {}),
      ...(note ? { answerReadInPart: true, reason: `${note} What I did read is stored, and a new answer is what asks again.` } : {}), ...book }, hash);
  };

  /** The degrade: re-read what an UNUSABLE batch was carrying, ONE CALL PER PIECE, each grounded in that piece's own text. A provider fault ENDS the fallback where
   *  it happened: what was already read is settled, the rest is untouched, unpaid and still owed. Fanning a rate limit into fifteen more calls is the storm. */
  const readOneByOne = async (group: readonly (readonly AnalysisTarget[])[]): Promise<boolean> => {
    for (const pieces of group) {
      const readings = new Map<string, AnswerAnalysis>(), classOf = new Map<string, ReadOutcome>(), sent: AnalysisTarget[] = [];
      let stalled = false;
      for (const p of pieces) {
        if (singlesLeft <= 0) { stalled = true; break; } // the pass's token allowance for single reads is spent; the rest is owed, unbought
        singlesLeft -= 1;
        // A reader that names no reason at all has now failed this piece TWICE, both billed: the ladder is spent, and that is the name it is settled under.
        const one = await analyze({ tenantId, question: p.question, engine: p.row.engine, answerText: p.text, brand: identity.name }).catch(() => "transient" as const) ?? ("attempts_exhausted" as const);
        // A single that returned nothing (a throttle, my own deadline, a spent balance, my own cap) stores nothing for this piece: the pass ends here and it is still owed.
        if (one === "transient" || one === "client_timeout" || one === "budget" || one === "credit_exhausted") { stalled = true; break; }
        billed += 1; sent.push(p);
        if (typeof one === "string") classOf.set(p.key, one); else readings.set(p.key, one);
      }
      if (sent.length > 0) await settleAnswer(sent, readings, classOf);
      if (stalled) return true; // the provider is refusing to serve; the next batch would only ask it again
    }
    return false;
  };

  // ONE ANSWER'S UNREAD PIECES TRAVEL TOGETHER, so a long answer is merged inside the call that read it.
  const groups: AnalysisTarget[][] = [];
  for (const row of targets) {
    const question = row.promptText || textOf.get(row.promptId) || "", all = splitAnswer(String(row.answerText ?? "")), owed = new Set(missingParts(row));
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
    if (group.every((p) => attempted.has(p.row.id))) continue; // never twice in one pass, whatever the ladder did with it
    for (const p of group) attempted.add(p.row.id);
    // Selection already packed these groups against the same budget, so this can only trip if a caller
    // hands a budget the selector never saw. It stays as the floor, and it can no longer strand pieces.
    if (calls <= 0) break;
    calls -= 1;
    const byAnswer = [...group.reduce((m, p) => m.set(p.row.id, [...(m.get(p.row.id) ?? []), p]), new Map<string, AnalysisTarget[]>()).values()];
    const readings = await analyzeBatch({ tenantId, brand: identity.name, targets: group }).catch(() => "transient" as const) ?? ("schema_invalid" as const);
    // A RATE LIMIT IS NOT FIFTEEN REFUSALS. One throttled batch used to fan into fifteen immediate single calls, which is how ten batch 429s became
    // sixty-nine more; the pass stops here and everything it was carrying stays due, unstamped and unpaid.
    if (readings === "budget") { log.warn("[daily-observations] there is no allowance left to read answers back, so I stopped and left them due", { tenantId, day: reading, owed: group.length }); break; }
    // AN EMPTY ACCOUNT BUYS NOTHING, EVER. A spent provider balance cannot answer, so every further call this pass would make is a call that can only fail:
    // it stops here, stores nothing at all, and leaves every answer it was carrying due for the pass that runs once the account has credit again.
    if (readings === "credit_exhausted") { log.error("[daily-observations] your AI provider credit is spent, so I stopped reading answers back and left every one of them owed a reading", { tenantId, day: reading, owed: group.length }); break; }
    // A THROTTLE IS NOT A DEAD PASS. The batch was ~75,000 tokens, tripped the per-minute ceiling by itself and took a 429 twice, so the pass ended having tried nothing at all,
    // forever. The batch is small now, and a throttled one still degrades to single reads on THIS pass at ~1,500 tokens each. Nothing is stored against a throttled batch: it was
    // never billed, so every answer it carried is still due and is asked one at a time instead.
    if (readings === "transient") { log.warn("[daily-observations] the batch read was throttled, so I am reading these answers one at a time instead", { tenantId, day: reading, owed: group.length }); if (await readOneByOne(byAnswer)) break; continue; }
    // MY OWN DEADLINE IS NOT A PURCHASE AND NOT A VERDICT. The call was abandoned with no body and no usage receipt, so nothing here proves the reader began or that
    // anything was charged: it is never counted as billed, nothing is stored against the answers it carried, and they are asked one at a time on THIS pass instead.
    if (readings === "client_timeout") { log.warn("[daily-observations] the batch read ran past my own deadline, so I am reading these answers one at a time instead", { tenantId, day: reading, owed: group.length }); if (await readOneByOne(byAnswer)) break; continue; }
    billed += 1;
    // IT RETURNED AND I COULD NOT USE IT: a refusal, a shape I could not parse, or a body cut off half way. The gateway already retried this call once against the
    // same schema, so a second identical batch buys the same answer: the group drops to one piece at a time instead, each named by whatever the single read says,
    // and ends this pass settled either way.
    if (typeof readings === "string") { if (await readOneByOne(byAnswer)) break; continue; }
    // A MISSING, UNKNOWN OR UNGROUNDED PIECE IS ONE DROP, not fifteen. Its neighbours keep their readings.
    for (const pieces of byAnswer) await settleAnswer(pieces, readings);
  }
  // A PASS THAT PAID AND STORED NOTHING IS A BUG, NOT A QUIET DAY: it is the exact shape of the leak (calls that returned, nothing written down, the next pass buying the identical work), so it stops here and says so.
  if (billed > 0 && settledHere === 0) log.error("[daily-observations] I paid for readings of your answers and could not store a single verdict, so I stopped rather than buy the same thing again", { tenantId, day: reading, billed, answers: targets.length });
  else if (written > 0) log.info("[daily-observations] read back new AI answers", { tenantId, day: reading, written });
  return written;
}
