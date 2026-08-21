import "server-only";
/** shipment-ai-lines - the SENTENCES one shipment's AI outcome says, split from shipment-ai-outcome when it
 *  crossed its ceiling. One direction only: the outcome engine imports THIS as one bundle. */
import type { AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations";
import { AI_OUTCOME_SHARED, type Direction, type HeldAiBaseline, type ScopedMetric, type ShipmentAiOutcome, type ShipmentObjective } from "./shipment-ai-outcome";
// Accessed at CALL time, never destructured at load: the two halves import each other by design, and a
// top-level destructure runs before the exporting half has finished loading.
const gapDir: typeof AI_OUTCOME_SHARED.gapDir = (...a) => AI_OUTCOME_SHARED.gapDir(...a);

const ENGINE_LABELS: Readonly<Record<string, string>> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", perplexity: "Perplexity" };
const MODE_LABELS: Readonly<Record<string, string>> = { api: "the standard answer", consumer_search: "the consumer search answer" };
const engineLabel = (e: string): string => ENGINE_LABELS[e] ?? e;
const modeLabel = (m: string): string => MODE_LABELS[m] ?? "an answer of an unnamed kind";


/** ONE SENTENCE WHEN THE INSTRUMENT MOVED UNDER THE READING. A step in a rate the day a provider swapped models is a fact about the
 *  provider, and a Result that does not say so hands the operator a win or a loss they did not earn. Null on either half of a pair means
 *  it was never known, and what was never known never moved. */
function boundaryOf(before: HeldAiBaseline | null, beforeRows: readonly AiObservationRecord[], after: readonly AiObservationRecord[]): string | null {
  type Served = { model: string | null; mode: string | null };
  const byDay = (rows: readonly AiObservationRecord[]) => [...rows].sort((a, b) => a.reporting_day.localeCompare(b.reporting_day));
  const was = new Map<string, Served>();
  for (const r of byDay(beforeRows)) was.set(r.engine, { model: r.model_served ?? null, mode: r.observation_mode ?? null });
  // A frozen baseline names its own instrument, and where one is on file it IS the before side, because the rows behind it may be long
  // gone. One value means one instrument; several means that day was already mixed and no single thing can be said to have moved.
  for (const e of before?.engines ?? []) {
    if (!was.has(e)) was.set(e, { model: before?.models?.length === 1 ? before.models[0]! : null, mode: before?.modes?.length === 1 ? before.modes[0]! : null });
  }
  const first = new Map<string, Served>(), last = new Map<string, Served>();
  for (const r of byDay(after)) {
    const served: Served = { model: r.model_served ?? null, mode: r.observation_mode ?? null };
    if (!first.has(r.engine)) first.set(r.engine, served);
    last.set(r.engine, served);
  }
  const notes: string[] = [];
  for (const [engine, now] of last) {
    const then = was.get(engine) ?? first.get(engine)!;
    if (then.model != null && now.model != null && then.model !== now.model) notes.push(`${engineLabel(engine)} moved from ${then.model} to ${now.model}`);
    if (then.mode != null && now.mode != null && then.mode !== now.mode) notes.push(`${engineLabel(engine)} moved from ${modeLabel(then.mode)} to ${modeLabel(now.mode)}`);
    // An engine is only NEW against a before side that exists; with none on file every engine would read new.
    if (!was.has(engine) && was.size > 0) notes.push(`${engineLabel(engine)} started answering inside this window`);
  }
  for (const engine of was.keys()) if (!last.has(engine)) notes.push(`${engineLabel(engine)} stopped answering inside this window`);
  return notes.length === 0 ? null : `The instrument changed under this reading: ${notes.join(", ")}. A step here is the instrument, not the change.`;
}


function outcomeLine(direction: Direction, before: ShipmentAiOutcome["before"], after: ShipmentAiOutcome["after"], coverage: ShipmentAiOutcome["coverage"]): string {
  const since = `${after.checked} AI ${after.checked === 1 ? "answer" : "answers"} collected on ${coverage.daysObserved} of the ${coverage.daysElapsed} days since this was marked done`;
  if (direction === "unclear") {
    if (before.from === "nothing") {
      return `${since}, with nothing from before the change to compare them against. Reading continues every day, and the direction lands once both sides are there.`;
    }
    return `${since}, which is too little to call either way yet. Reading continues every day.`;
  }
  // The denominator the share was computed over, said out loud, and named for what it is: a settled check,
  // which may be a name-and-address match rather than a close reading, so "finished checking" never overclaims.
  const now = `you were named in ${after.mentioning} of the ${after.analyzed} finished checking`;
  const then = `${before.mentioning} of ${before.checked} before it`;
  if (direction === "improved") return `${since}, ${now}, up from ${then}. Reading continues every day.`;
  if (direction === "worsened") return `${since}, ${now}, down from ${then}. Reading continues every day, and the next move for this page lands on Changes.`;
  // NEVER AN UNSUPPORTED "SAME": the honest middle is that nothing moved far enough, against enough answers,
  // to call, and it is said as exactly that (Codex, 2026-08-21).
  return `${since}, ${now}, no clear movement from ${then}. Reading continues every day.`;
}


/** A metric's before side in words, or nothing at all where nothing reported it. */
const fromClause = (b: ScopedMetric): string => (b.rate == null ? "" : `, from ${b.hits} of ${b.sample}`);

/** THE OBJECTIVE'S OWN NUMBERS, in sentences. A change judged on clicks or on mentions adds nothing here: the mention sentence above
 *  already is its whole reading. */
function metricLinesOf(objective: ShipmentObjective, frozen: boolean, mentionDirection: Direction,
  citations: ShipmentAiOutcome["citations"], retrieval: ShipmentAiOutcome["retrieval"], passedOver: ShipmentAiOutcome["retrievedNotCited"]): string[] {
  if (objective === "clicks" || objective === "ai_mentions") return [];
  const lines: string[] = [];
  if (!frozen) lines.push("Where this change's own AI numbers stood when it was marked done was never written down, so this side of it is not a direction yet. Every change recorded from now on freezes its own.");
  if (objective === "ai_retrieval") {
    lines.push(retrieval.after.rate == null
      ? "No answer since the change reported what it read, so being read cannot be counted yet."
      : `Read on ${retrieval.after.hits} of the ${retrieval.after.sample} answers that reported what they read${fromClause(retrieval.before)}.`);
    // A RISE IN BEING READ IS NOT THE WIN. The page is in front of the model and still uncredited, which is the next problem, not the
    // finish; calling it done here is how a half-move gets banked as a result.
    if (gapDir(retrieval.before, retrieval.after, "good_rate") === "improved" && gapDir(citations.before, citations.after, "good_rate") !== "improved") {
      lines.push("Read on more answers than before, and not yet credited on them: progress, not the win.");
    }
    return lines;
  }
  lines.push(citations.after.rate == null
    ? "No answer since the change reported which sources it used, so the citation cannot be read yet."
    : `Credited on ${citations.after.hits} of the ${citations.after.sample} answers that reported their sources${fromClause(citations.before)}.`);
  if (citations.rankAfter != null) {
    lines.push(citations.rankBefore == null
      ? `Credited in position ${citations.rankAfter} on average, with nothing before it to compare against.`
      : `Credited in position ${citations.rankAfter} on average, from position ${citations.rankBefore}.`);
  }
  if (objective === "ai_citation_conversion") {
    lines.push(passedOver.after.rate == null
      ? "No answer since the change both read a page of yours and reported what it credited, so being passed over cannot be counted yet."
      : `Read and passed over on ${passedOver.after.hits} of the ${passedOver.after.sample} answers that read a page of yours${fromClause(passedOver.before)}.`);
    // AND A RISE THERE IS SAID OUT LOUD. Being passed over more often is the exact thing this card was raised to stop, and it used to
    // be graded as though a bigger number were better, so a conversion getting worse printed a flat result under a rising citation line.
    if (gapDir(passedOver.before, passedOver.after, "bad_rate") === "worsened") lines.push("Read and passed over on a larger share than before, which is the thing this change was raised to stop.");
  }
  // MORE MENTIONS IS NOT THE CITATION. Being named more often is the thing this account was already doing; the change was raised to be
  // CREDITED, and grading it on mentions banked a win it never earned.
  if (mentionDirection === "improved" && gapDir(citations.before, citations.after, "good_rate") !== "improved") {
    lines.push("Mentions rose, and the citation this change was aimed at has not moved yet.");
  }
  return lines;
}


/** ONE module surface. */
export const AI_OUTCOME_LINES = { boundaryOf, engineLabel, metricLinesOf, outcomeLine } as const;
