import "server-only";
/**
 * shipment-ai-outcome - WHAT THE AI ANSWERS DID AROUND ONE SHIPPED CHANGE, on the change's OWN searches,
 * judged on its declared objective, credited through ai-outcomes' one countLinks so the trend and a Result
 * agree. Four rules: MEMBERSHIP IS EXACT and does not wait (observation ids, prompt ids, exact wordings, or
 * a journey that RAN the search, off the scoped projection). MODEL AND MODE NEVER FILTER (operator pin): a
 * change of instrument is REPORTED, never subtracted. THE OBJECTIVE IS THE CHANGE'S OWN: rising mentions
 * beside a flat citation are said, never sold. A BASELINE IS FROZEN AT MARK DONE OR IT DOES NOT EXIST.
 */

import { createHash } from "node:crypto";

import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { readAiObservations, type AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations";
import { reportingDay } from "@/lib/reporting-day";
import { cameBack, countLinks, dayOfInstant, namedShare, ownedRootOf, r3, readRows, type LinkCounts, type ReadOpts } from "./ai-outcomes";
import { addDays, daysBetween, mergeRanges, overlaps, readPartitioned } from "./outcome-windows";
import { AI_OUTCOME_LINES } from "./shipment-ai-lines";
// Same lazy rule on this side of the pair.
const boundaryOf: typeof AI_OUTCOME_LINES.boundaryOf = (...a) => AI_OUTCOME_LINES.boundaryOf(...a);
const engineLabel: typeof AI_OUTCOME_LINES.engineLabel = (...a) => AI_OUTCOME_LINES.engineLabel(...a);
const metricLinesOf: typeof AI_OUTCOME_LINES.metricLinesOf = (...a) => AI_OUTCOME_LINES.metricLinesOf(...a);
const outcomeLine: typeof AI_OUTCOME_LINES.outcomeLine = (...a) => AI_OUTCOME_LINES.outcomeLine(...a);

const SHIPMENT_WINDOW_DAYS = 28; // the longest stretch one Shipment is judged over
/** A VERDICT NEEDS THREE THINGS AT ONCE (Codex, 2026-08-21): a move bigger than the practical threshold, a
 *  difference the day-to-day noise cannot explain (the two-proportion interval excludes zero), and enough
 *  answers read closely on BOTH sides for either to mean anything. The old five point band sat under the
 *  measured day-to-day noise of these rates, so ordinary wobble printed as wins and losses. Anything short
 *  of all three is "no clear movement yet", and an unsupported "flat" is never printed. */
const PRACTICAL_MOVE = 0.1; // ten points either way is the smallest move worth calling
const MIN_SIDE = 10;        // answers on each side of a rate before the two are comparable
const Z_CALL = 1.96;        // the interval that must exclude zero
/** How many of the newest first readings are scanned to find the day a change's own answers end on. It counts nothing: the day it names is
 *  then read whole. Wide enough that a change aimed at a handful of searches inside a 140 answer day still finds them, bounded so no press ever reads the whole history. */
const BASELINE_PROBE_ROWS = 1000;

/** WHAT THIS CHANGE WAS MADE TO MOVE, declared once at mark time and never re-derived at read time. The metric used to be hard-coded to
 *  mentions for every AI card, so a change raised to earn a CITATION was graded a win the moment it was named more often, which is the
 *  thing it was already doing. */
export type ShipmentObjective = "ai_retrieval" | "ai_citation_conversion" | "ai_citation" | "ai_mentions" | "clicks";
const OBJECTIVES: ReadonlySet<string> = new Set(["ai_retrieval", "ai_citation_conversion", "ai_citation", "ai_mentions", "clicks"]);

/** THE ONE MAPPING from the AI stage a card was minted in to the metric its Result is judged on. Called where a change is recorded, never
 *  where it is read. A card with no AI claim never reaches here: its objective is clicks, which the caller states rather than inferring
 *  from an absent stage. */
export function objectiveOfStage(stage: string | null | undefined): ShipmentObjective {
  if (stage === "rivals_cited_own_not_retrieved") return "ai_retrieval";
  if (stage === "owned_retrieved_not_cited") return "ai_citation_conversion";
  // A QUESTION WHOSE ANSWERS NEVER SAY WHAT THEY USED IS A REPORTING GAP, and grading it on mentions would hand it a win on the one axis its own problem does not touch. It is judged on the citation, whose sample is empty exactly while the reporting is missing, so the result reads unmeasurable rather than flattering. No producer mints that stage today (an unreported case mints nothing), and if one ever does it lands on the honest metric.
  return stage === "owned_mentioned_not_cited" || stage === "citations_unreported" ? "ai_citation" : "ai_mentions";
}

export type Direction = "improved" | "worsened" | "no_clear_movement" | "mixed" | "unclear";
/** ONE SIDE OF ONE METRIC. `sample` is the answers that REPORTED the thing being counted, so a rate is null when nothing reported it: a
 *  zero there would say "AI credited you on none of them" about answers whose engine never said what it credited at all. */
export type ScopedMetric = { sample: number; hits: number; rate: number | null };
type Instrument = { engine: string; modelServed: string | null; mode: string; answers: number };
/** THE AI HALF OF ONE SHIPMENT'S STARTING NUMBERS, frozen at mark time. Every field past `mentioning` is optional, so a row stored before
 *  this existed still decodes and simply reads as a baseline that never counted sources. */
export type HeldAiBaseline = {
  day: string; checked: number; analyzed?: number; mentioning: number;
  citationSample?: number; ownedCiting?: number; rankSum?: number; rankCount?: number;
  retrievalSample?: number; ownedRetrieved?: number; retrievedNotCited?: number;
  engines?: string[]; models?: string[]; modes?: string[]; scopeFingerprint?: string; objective?: ShipmentObjective;
  /** THE EXACT INSTRUMENT TUPLES the starting numbers were read on, `engine|model|mode` each (Codex, 2026-08-23): the record of the pairings themselves, where the marginal lists above can only cross. */
  instruments?: string[];
};

/** What the AI answers did around one shipped change. Direction only: this is an observation, not a proof. */
export type ShipmentAiOutcome = {
  /** The direction OF THE DECLARED OBJECTIVE. A citation change named more often but credited no more often is not improved, however good
   *  the mention line reads. `mentionDirection` is kept beside it because the mention sentence still has to be true. */
  direction: Direction;
  mentionDirection: Direction;
  objective: ShipmentObjective;
  /** `checked` is the denominator the rate was computed over on this side, which is always the answers read closely. `from` says where the
   *  number came from: the starting number written at mark time (`on_file`), the stored answers themselves (`stored_answers`), nothing at
   *  all (`nothing`), a starting number counted the old way whose own day is no longer on file (`on_file_legacy`, never comparable), or a
   *  read of the stored answers that did not land this time (`unavailable`). */
  before: { day: string | null; checked: number; mentioning: number; rate: number | null; from: "on_file" | "stored_answers" | "nothing" | "unavailable" };
  /** `checked` = answers that came back, `analyzed` = the ones read closely enough to say whether you were named, and `rate` =
   *  mentioning / analyzed. Null when nothing was analyzed; a zero there would read as "AI never named you" over answers nobody has read. */
  after: { from: string; to: string; checked: number; analyzed: number; mentioning: number; rate: number | null };
  /** Being CREDITED, over the answers that reported their sources, plus the average place in that list. */
  citations: { before: ScopedMetric; after: ScopedMetric; rankBefore: number | null; rankAfter: number | null };
  /** Being READ, over the answers that reported both what they read and what they credited. */
  retrieval: { before: ScopedMetric; after: ScopedMetric };
  /** Read and passed over, over the answers that read a page of yours. */
  retrievedNotCited: { before: ScopedMetric; after: ScopedMetric };
  /** What each answer since was served on, and one sentence when a model or a mode appeared, disappeared or changed inside the window.
   *  Null boundary = the whole stretch was read on one instrument. */
  instruments: Instrument[];
  boundary: string | null;
  /** The objective's own numbers, in sentences, appended to `line` and rendered on their own rows. */
  metricLines: string[];
  /** Days I actually read against days that have passed. A missed day is missing, never filled in. */
  coverage: { daysObserved: number; daysElapsed: number };
  /** THE CONTROLS: the account's own approved questions OUTSIDE this change's scope, read over the same
   *  window on the same instrument, never bought for the purpose. Their drift is subtracted before any
   *  verdict, so the world moving is never sold as the change working. Null = too few to hold anything. */
  controls: { questions: number; mentionDrift: number | null; citationDrift: number | null } | null;
  /** Each assistant's own verdict on the declared objective, where its rows can carry one. The overall
   *  direction is `mixed` when these genuinely disagree, never an average of opposites. */
  perEngine: Array<{ engine: string; direction: Direction }>;
  /** TRUE when nothing later can change this answer (no scope kept, or no baseline frozen): the row is Not
   *  measurable, terminally, rather than "reading" forever. */
  terminal?: boolean;
  line: string;
};

/** WHAT THE AI ANSWERS DID AROUND ONE SHIPPED CHANGE: the held starting number (or the last stored day ahead of the stamp), against
 *  stamp-to-now bounded to 28 days, both counted the same way. Coverage rides the answer; under half is `unclear`; no stamp means null. */
type ShipmentForOutcome = {
  implementedAt: string | null;
  shipmentBaseline?: { ai: HeldAiBaseline | null } | null;
  /** THE SEARCHES THIS ONE CHANGE WAS AIMED AT, frozen onto the Shipment at mark time: a tracked question's own id, or the search itself in
   *  words. Empty or absent = I cannot tell which answers belong to this change, and it says so rather than reading the whole account on
   *  this one page's behalf. */
  scopeQueries?: readonly string[] | null;
  /** THE TYPED SCOPE, when the shipment preserved one: the exact prompt ids, the fan-out cluster and the answers the claim was minted from.
   *  It wins over scopeQueries because it is the claim itself, not a flattening of it. `models` and `modes` are recorded and NEVER filter. */
  aiScope?: {
    caseKey?: string; promptIds: readonly string[]; promptVersions?: readonly number[]; engines: readonly string[];
    models?: readonly string[]; modes?: readonly string[]; fanoutKey?: string; fanouts: readonly string[];
    observationIds?: readonly string[]; stage: string;
  } | null;
};
/** ONE SHIPMENT'S MEMBERSHIP, in four exact routes. Null when the change carries no scope at all, which is a state and not an empty
 *  filter. PURE. */
type ShipmentScope = { observationIds: Set<string>; promptIds: Set<string>; queryKeys: Set<string>; fanoutKeys: Set<string>; engines: Set<string> | null };
function scopeKeysOf(shipment: ShipmentForOutcome): ShipmentScope | null {
  const typed = shipment.aiScope;
  const s: ShipmentScope = { observationIds: new Set(), promptIds: new Set(), queryKeys: new Set(), fanoutKeys: new Set(), engines: null };
  if (typed && (typed.promptIds.length > 0 || typed.fanouts.length > 0 || (typed.observationIds?.length ?? 0) > 0 || (typed.fanoutKey ?? "").length > 0)) {
    for (const id of typed.observationIds ?? []) if (id.trim().length > 0) s.observationIds.add(id.trim());
    for (const id of typed.promptIds) if (id.trim().length > 0) s.promptIds.add(id.trim());
    for (const q of typed.fanouts) { const k = canonicalQueryKey(q); if (k.length > 0) { s.queryKeys.add(k); s.fanoutKeys.add(k); } }
    // The cluster's own canonical identity, taken as given AND canonicalized, so a stored key and a freshly canonicalized fan-out text
    // both land on the same entry.
    if (typed.fanoutKey) { s.fanoutKeys.add(typed.fanoutKey); const k = canonicalQueryKey(typed.fanoutKey); if (k.length > 0) s.fanoutKeys.add(k); }
    // ENGINE STILL BOUNDS IT: a claim made about ChatGPT is not evidence about Perplexity. Model and mode do not, on purpose.
    s.engines = typed.engines.length > 0 ? new Set(typed.engines) : null;
    return s;
  }
  // An untyped scope is ten flattened strings that may be an id OR a wording, so both routes take each of them.
  for (const raw of shipment.scopeQueries ?? []) {
    const text = (raw ?? "").trim();
    if (text.length > 0) { s.promptIds.add(text); const k = canonicalQueryKey(text); if (k.length > 0) s.queryKeys.add(k); }
  }
  return s.promptIds.size > 0 || s.queryKeys.size > 0 ? s : null;
}

/** DOES THIS ANSWER BELONG TO THIS CHANGE? The closed rule Decision holds (decision/membership.ts), spelled out here because Measurement
 *  may not import Decision. Four exact routes and nothing else: a word an account puts on everything is not evidence about one page. PURE. */
function answerJoinsScope(rec: AiObservationRecord, scope: ShipmentScope): boolean {
  if (scope.engines != null && !scope.engines.has(rec.engine)) return false;
  if (scope.observationIds.has(rec.id)) return true;    // durable membership: the answers the claim was minted from
  if (scope.promptIds.has(rec.prompt_id)) return true;  // the tracked question itself
  const asked = canonicalQueryKey(rec.prompt_text ?? "");
  if (asked.length > 0 && scope.queryKeys.has(asked)) return true; // the exact wording the change claimed
  // AND THE ANSWER RAN THE SEARCH. The journey rides the scoped projection for this one route: without it a change aimed at a follow-up
  // search measured nothing until somebody promoted that wording to a tracked question, so the read waited on an unrelated decision.
  return (rec.journey?.fan_outs ?? []).some((f) => { const k = canonicalQueryKey(f); return k.length > 0 && scope.fanoutKeys.has(k); });
}

/** A stable identity for EVERYTHING THAT DECIDES WHICH ANSWERS a baseline was frozen over, so a later read can tell whether it is
 *  comparing against the same claim. It used to hash the prompt ids, the cluster key and the engines only, which is a fraction of what
 *  membership is made of: a scope that swapped its exact wordings, its models, its modes, its own observation ids or its stage kept the
 *  fingerprint of a claim it had stopped being, and a starting point frozen over one set of answers read as the starting point of
 *  another. Every list is sorted and every fan-out canonicalized, so the order a producer happened to write them in can never change the
 *  identity, and the objective rides along because a before side frozen under a different yardstick is not the same before side. */
const scopeFingerprint = (s: NonNullable<ShipmentForOutcome["aiScope"]>): string =>
  createHash("sha256").update(JSON.stringify([
    [...s.promptIds].sort(), [...(s.promptVersions ?? [])].sort((a, b) => a - b), [...s.engines].sort(),
    [...(s.models ?? [])].sort(), [...(s.modes ?? [])].sort(), s.fanoutKey ?? "", s.fanouts.map(canonicalQueryKey).sort(),
    [...(s.observationIds ?? [])].sort(), s.stage, objectiveOfStage(s.stage),
  ])).digest("hex").slice(0, 16);

/** A stored stamp as a reporting day: a full instant resolves through the operator's zone, and a value already stored as a bare day label
 *  is already a day and is never shifted. null = not a moment I can read. */
const dayOfStamp = (raw: string | null): string | null => {
  const s = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const at = Date.parse(s);
  return Number.isFinite(at) ? reportingDay(at) : null;
};

/** The two ends of ONE shipment's read: the 28 days ahead of the stamp, where the fallback before-number is found, and the 28 days after
 *  it, bounded by today. Null when the change carries no stamp to measure from. */
function shipmentWindow(shipment: ShipmentForOutcome, nowDay: string): { stamp: string; from: string; to: string } | null {
  const stamp = dayOfStamp(shipment.implementedAt);
  if (!stamp) return null;
  // 28 reporting days COUNTING the day it was marked done, so the days I read and the days that passed are
  // counted the same way and coverage can never read as more days than have actually elapsed.
  const last = addDays(stamp, SHIPMENT_WINDOW_DAYS - 1);
  return { stamp, from: addDays(stamp, -SHIPMENT_WINDOW_DAYS), to: nowDay < last ? nowDay : last };
}

/** THE DAYS ONE SHIPMENT NEEDS ON FILE: its own 56 day window and nothing else. The legacy-baseline recount
 *  that once widened this was DELETED (Codex, 2026-08-21): zero live rows carry a pre-`analyzed` baseline,
 *  so the apparatus defended nothing, and a future row that somehow lacks a denominator reads as no baseline. */
function rangesFor(_shipment: ShipmentForOutcome, window: { stamp: string; from: string; to: string }): ReturnType<typeof mergeRanges> {
  return [{ from: window.from, to: window.to }];
}

/** Days I actually read against days that have passed, counted the same way on both sides. */
const elapsedSince = (stamp: string, to: string): number => Math.max(1, Math.min(daysBetween(stamp, to) + 1, SHIPMENT_WINDOW_DAYS));
/** EVERY SHIPMENT ON ONE LEDGER, OFF ONE SET OF BOUNDED READS. Per-shipment 56 day reads in a Promise.all timed statements out before,
 *  and one whole-union read hits the store's 40,000 row ceiling at a year of 140 readings a day, nulling every outcome at once. So the
 *  union is merged, partitioned into pieces one read can hold, and shared; a piece that will not read fails only the shipments whose
 *  windows touch it (see outcome-windows.ts). */
export async function aiOutcomesForShipments(tenantId: string, shipments: readonly ShipmentForOutcome[], opts: ReadOpts & { now?: Date } = {}): Promise<(ShipmentAiOutcome | null)[]> {
  const nowDay = dayOfInstant(opts.now ?? new Date());
  const windows = shipments.map((s) => shipmentWindow(s, nowDay));
  // A CHANGE WITH NO SCOPE ASKS FOR NOTHING. Reading the account's whole window on its behalf is what made
  // one page's answers into another page's result, so an unscopable Shipment never widens this read at all.
  const scopes = shipments.map(scopeKeysOf);
  const needed = shipments.map((s, i) => (windows[i] && scopes[i] ? rangesFor(s, windows[i]!) : []));
  // THE SCOPED PROJECTION, not the lean one: the fan-out route above is a claim this read can only keep with the journey in hand. The
  // daily trend still reads the overview and never pays for it.
  const { rows, failed } = await readPartitioned(mergeRanges(needed.flat()), (from, to) => readRows(tenantId, { from, to }, { ...opts, projection: "scoped" }));
  return shipments.map((s, i) => {
    const w = windows[i];
    if (w == null) return null;
    const objective = objectiveOf(s), scope = scopes[i];
    if (scope == null) return unscopableOutcome(w, objective);
    if (failed.some((f) => needed[i]!.some((r) => overlaps(f, r)))) return unreadableOutcome(w, objective);
    // THE BASELINE IS FROZEN OR THERE IS NONE (operator pin). A change that declared an AI objective and has no starting numbers on file
    // is UNMEASURABLE on AI: the implementation is recorded either way, and a before side rebuilt from today's answers would be whatever
    // today happens to say.
    if (s.aiScope != null && (s.shipmentBaseline?.ai ?? null) == null) return unmeasurableOutcome(w, objective);
    return outcomeFromRows(rows.filter((r) => answerJoinsScope(r, scope)), rows.filter((r) => !answerJoinsScope(r, scope)),
      s, w, objective, opts.ownedHost ?? null, scope.engines);
  });
}

export async function aiOutcomeForShipment(tenantId: string, shipment: ShipmentForOutcome, opts: ReadOpts & { now?: Date } = {}): Promise<ShipmentAiOutcome | null> {
  return (await aiOutcomesForShipments(tenantId, [shipment], opts))[0] ?? null;
}

/** THE OBJECTIVE THIS ONE IS JUDGED ON: what was frozen at mark time wins, because that is the declaration; a shipment recorded before
 *  objectives existed falls back to the stage its scope preserved, and a change with no AI claim at all is judged on clicks and carries
 *  the AI line only as an observation. */
function objectiveOf(shipment: ShipmentForOutcome): ShipmentObjective {
  const held = shipment.shipmentBaseline?.ai?.objective;
  return held != null && OBJECTIVES.has(held) ? held : shipment.aiScope ? objectiveOfStage(shipment.aiScope.stage) : "clicks";
}

/** THE AI STARTING NUMBERS FOR ONE CHANGE'S OWN SEARCHES, from answers ALREADY on file. Zero provider calls, zero cost. Null when the
 *  scope's answers are not on file at all, which is a different claim from zero and is stored as such: Results then reports the AI outcome
 *  unmeasurable rather than inventing a before side later. Called by the ONE writer of `shipmentBaseline` (proof-gsc/measure-pass). */
export async function aiBaselineFor(tenantId: string, aiScope: NonNullable<ShipmentForOutcome["aiScope"]>, opts: ReadOpts = {}): Promise<HeldAiBaseline | null> {
  const scope = scopeKeysOf({ implementedAt: null, aiScope });
  if (scope == null) return null;
  const read = opts.readObservations ?? readAiObservations;
  const mine = (r: AiObservationRecord) => r.tenant_id === tenantId && r.sample_slot === 0 && cameBack(r) && answerJoinsScope(r, scope);
  // The day is FOUND on a bounded probe and then READ WHOLE by name. Counting off the probe froze a baseline over a fraction of a day and
  // compared every later reading against it.
  const day = (await read(tenantId, { slot: 0, limit: BASELINE_PROBE_ROWS, projection: "scoped" })).filter(mine).map((r) => r.reporting_day).sort().pop();
  if (!day) return null;
  const onDay = (await read(tenantId, { day, slot: 0, projection: "scoped" })).filter((r) => mine(r) && r.reporting_day === day);
  if (onDay.length === 0) return null;
  const share = namedShare(onDay);
  const distinct = (pick: (r: AiObservationRecord) => string | null): string[] =>
    [...new Set(onDay.map(pick).filter((v): v is string => v != null && v.length > 0))].sort();
  return {
    day, checked: share.checked, analyzed: share.analyzed, mentioning: share.mentioning,
    ...countLinks(onDay, ownedRootOf(onDay, opts.ownedHost)),
    engines: distinct((r) => r.engine), models: distinct((r) => r.model_served), modes: distinct((r) => r.observation_mode),
    instruments: distinct((r) => `${r.engine}|${r.model_served ?? ""}|${r.observation_mode ?? ""}`),
    scopeFingerprint: scopeFingerprint(aiScope), objective: objectiveOfStage(aiScope.stage),
  };
}
/** NOTHING READ, AND WHY. Not a verdict and not a zero: every count is honestly empty and the line says which of the silences this is. */
function noReadOutcome(window: { stamp: string; to: string }, objective: ShipmentObjective, line: string): ShipmentAiOutcome {
  const none: ScopedMetric = { sample: 0, hits: 0, rate: null };
  return {
    direction: "unclear", mentionDirection: "unclear", objective,
    before: { day: null, checked: 0, mentioning: 0, rate: null, from: "unavailable" },
    after: { from: window.stamp, to: window.to, checked: 0, analyzed: 0, mentioning: 0, rate: null },
    citations: { before: none, after: none, rankBefore: null, rankAfter: null },
    retrieval: { before: none, after: none }, retrievedNotCited: { before: none, after: none },
    instruments: [], boundary: null, metricLines: [],
    coverage: { daysObserved: 0, daysElapsed: elapsedSince(window.stamp, window.to) },
    controls: null, perEngine: [], line,
  };
}
/** THE ANSWERS ARE ON FILE AND I COULD NOT GET TO THEM THIS TIME. */
const unreadableOutcome = (w: { stamp: string; to: string }, objective: ShipmentObjective): ShipmentAiOutcome =>
  noReadOutcome(w, objective, "The answers for this period could not be read just now. They are safe, and the next refresh reads them.");
/** The two TERMINAL silences: no scope kept, or no baseline frozen. Nothing later changes either answer, so
 *  the row is Not measurable rather than reading forever (Codex, 2026-08-21). */
const terminalOutcome = (w: { stamp: string; to: string }, objective: ShipmentObjective, line: string): ShipmentAiOutcome =>
  ({ ...noReadOutcome(w, objective, line), terminal: true });
/** I CANNOT TELL WHICH ANSWERS BELONG TO THIS CHANGE, and above all I will not hand it the whole account's. */
const unscopableOutcome = (w: { stamp: string; to: string }, objective: ShipmentObjective): ShipmentAiOutcome =>
  terminalOutcome(w, objective, "Not measurable: which searches this change was aimed at was not kept, so which AI answers belong to it cannot be said, and every answer this account bought is never handed to one page. Every change recorded from now on carries its own searches.");
/** THE STARTING NUMBERS WERE NEVER FROZEN, so there is no before side and one is never built after the fact. The implementation itself is
 *  recorded and stays recorded: what was applied is a fact, and whether it can be compared is a different one. */
const unmeasurableOutcome = (w: { stamp: string; to: string }, objective: ShipmentObjective): ShipmentAiOutcome =>
  terminalOutcome(w, objective, "Not measurable: where the AI answers stood when this was marked done was not on file, so what happened since cannot be read as a direction, and a starting point is never rebuilt after the fact. The change itself is recorded.");
const metricOf = (sample: number, hits: number): ScopedMetric => ({ sample, hits, rate: sample > 0 ? r3(hits / sample) : null });
const citationsOf = (c: LinkCounts): ScopedMetric => metricOf(c.citationSample, c.ownedCiting);
const retrievalOf = (c: LinkCounts): ScopedMetric => metricOf(c.retrievalSample, c.ownedRetrieved);
const passedOverOf = (c: LinkCounts): ScopedMetric => metricOf(c.ownedRetrieved, c.retrievedNotCited);
const rankOf = (c: LinkCounts): number | null => (c.rankCount > 0 ? r3(c.rankSum / c.rankCount) : null);
/** The counts a baseline froze, or null where it froze none. A baseline written before sources were counted carries no citation numbers
 *  and NONE are recounted for it: see the header. */
const heldLinks = (h: HeldAiBaseline | null): LinkCounts | null =>
  h != null && typeof h.citationSample === "number"
    ? { citationSample: h.citationSample, ownedCiting: h.ownedCiting ?? 0, rankSum: h.rankSum ?? 0, rankCount: h.rankCount ?? 0,
      retrievalSample: h.retrievalSample ?? 0, ownedRetrieved: h.ownedRetrieved ?? 0, retrievedNotCited: h.retrievedNotCited ?? 0 }
    : null;
/** THE ONE COVERAGE RULE, both sides of a shipped change: under half the answers read closely means the share is a fact about how much
 *  analysis finished, not what AI said, so the outcome reads unclear rather than a direction. */
const tooThin = (s: { checked: number; analyzed: number }): boolean => s.analyzed <= 0 || s.analyzed * 2 < s.checked;
/** One metric's direction under the three-part rule, WITH ITS POLARITY STATED (read-and-passed-over is a BAD
 *  rate: it rises when a page here is read more often and still credited nowhere). `drift` is the control
 *  movement over the same window on the account's own unaffected questions, subtracted so the world moving
 *  is never sold as the change working. Either side unreported is `unclear`, never a verdict: nothing was
 *  measured, so nothing held still. */
const gapDir = (before: ScopedMetric, after: ScopedMetric, polarity: "good_rate" | "bad_rate", drift = 0): Direction => {
  if (before.rate == null || after.rate == null) return "unclear";
  if (before.sample < MIN_SIDE || after.sample < MIN_SIDE) return "no_clear_movement"; // inadequate denominators never support a verdict
  const raw = (after.rate - before.rate - drift) * (polarity === "bad_rate" ? -1 : 1);
  const se = Math.sqrt((before.rate * (1 - before.rate)) / before.sample + (after.rate * (1 - after.rate)) / after.sample);
  const supported = Math.abs(raw) >= PRACTICAL_MOVE && (se === 0 ? Math.abs(raw) > 0 : Math.abs(raw) / se >= Z_CALL);
  return supported ? (raw > 0 ? "improved" : "worsened") : "no_clear_movement";
};

/** What every answer since was served on, one row per engine, model and mode. */
function instrumentsOf(rows: readonly AiObservationRecord[]): Instrument[] {
  const held = new Map<string, Instrument>();
  for (const r of rows) {
    const at = held.get(`${r.engine}|${r.model_served ?? ""}|${r.observation_mode ?? ""}`);
    if (at) at.answers += 1;
    else held.set(`${r.engine}|${r.model_served ?? ""}|${r.observation_mode ?? ""}`, { engine: r.engine, modelServed: r.model_served ?? null, mode: r.observation_mode ?? "", answers: 1 });
  }
  return [...held.values()].sort((a, b) => a.engine.localeCompare(b.engine) || (a.modelServed ?? "").localeCompare(b.modelServed ?? ""));
}

/** A metric's before side in words, or nothing at all where nothing reported it. */

/** The declared objective's direction. A conversion objective takes BOTH halves: credited more often AND read and passed over less often,
 *  because a citation rate that rose only because fewer answers read the page at all is not the change working. */
function directionOf(objective: ShipmentObjective, mentionDirection: Direction,
  citations: ShipmentAiOutcome["citations"], retrieval: ShipmentAiOutcome["retrieval"], passedOver: ShipmentAiOutcome["retrievedNotCited"]): Direction {
  if (objective === "clicks" || objective === "ai_mentions") return mentionDirection;
  if (objective === "ai_retrieval") return gapDir(retrieval.before, retrieval.after, "good_rate");
  const cited = gapDir(citations.before, citations.after, "good_rate");
  if (objective === "ai_citation") return cited;
  // BOTH HALVES, EACH ON ITS OWN POLARITY: credited more often AND passed over less often. A rise in being passed over is a loss on the
  // very thing this card was raised to stop, whatever the citation line does beside it, and it used to come back flat.
  const over = gapDir(passedOver.before, passedOver.after, "bad_rate");
  if (cited === "unclear" || over === "unclear") return "unclear";
  if (cited === "worsened" || over === "worsened") return "worsened";
  return cited === "improved" && over === "improved" ? "improved" : "no_clear_movement";
}

/** THE CONTROLS: the account's own approved questions OUTSIDE this change's scope, over the same window on
 *  the same engines, straight off rows already read. Never bought for the purpose; too few answers on either
 *  side holds nothing. Drift = after rate minus before rate, per metric, in raw points. */
function controlsOf(nonMembers: readonly AiObservationRecord[], stamp: string, engines: ReadonlySet<string> | null,
  ownedHost: string | null, sameInstrument: (r: AiObservationRecord) => boolean): ShipmentAiOutcome["controls"] {
  // ON THE SAME INSTRUMENT TUPLE AS THE READING THEY ADJUST (Codex, 2026-08-23): a control answered on an excluded instrument would subtract that other instrument's weather from this verdict.
  const pool = nonMembers.filter((r) => cameBack(r) && (r.prompt_id ?? "").length > 0 && (engines == null || engines.has(r.engine)) && sameInstrument(r));
  if (pool.length === 0) return null;
  const beforeC = pool.filter((r) => r.reporting_day < stamp), afterC = pool.filter((r) => r.reporting_day >= stamp);
  const mB = namedShare(beforeC), mA = namedShare(afterC);
  const root = ownedRootOf(pool, ownedHost);
  const cB = citationsOf(countLinks(beforeC, root)), cA = citationsOf(countLinks(afterC, root));
  const enough = (n: number) => n >= MIN_SIDE;
  return {
    questions: new Set(pool.map((r) => r.prompt_id)).size,
    mentionDrift: mB.rate != null && mA.rate != null && enough(mB.analyzed) && enough(mA.analyzed) ? r3(mA.rate - mB.rate) : null,
    citationDrift: cB.rate != null && cA.rate != null && enough(cB.sample) && enough(cA.sample) ? r3((cA.rate ?? 0) - (cB.rate ?? 0)) : null,
  };
}

/** PURE over rows already in hand: one shipment's before, after, coverage and direction. `nonMembers` are the
 *  window's rows OUTSIDE this change's scope, the raw material of the controls. */
function outcomeFromRows(all: readonly AiObservationRecord[], nonMembers: readonly AiObservationRecord[], shipment: ShipmentForOutcome,
  window: { stamp: string; from: string; to: string }, objective: ShipmentObjective, ownedHost: string | null,
  scopeEngines: ReadonlySet<string> | null): ShipmentAiOutcome {
  const { stamp, to } = window;
  const rows = all.filter((r) => r.reporting_day >= window.from && r.reporting_day <= to);
  const held = shipment.shipmentBaseline?.ai ?? null;
  const beforeRows = rows.filter((r) => r.reporting_day < stamp && cameBack(r));
  const lastBeforeDay = beforeRows.map((r) => r.reporting_day).sort().pop() ?? null;
  /** One side of the comparison, named by the denominator its own rate was computed over, plus whether that
   *  denominator is too thin to trust: under half the answers on this side were read closely. */
  const sideOf = (day: string | null, s: { checked: number; analyzed: number; mentioning: number; rate: number | null },
    from: ShipmentAiOutcome["before"]["from"]) =>
    ({ side: { day, checked: s.analyzed, mentioning: s.mentioning, rate: s.rate, from }, thin: tooThin(s) });
  const beforeSide = held && typeof held.analyzed === "number"
    ? sideOf(held.day, { checked: held.checked, analyzed: held.analyzed, mentioning: held.mentioning,
      rate: held.analyzed > 0 ? r3(held.mentioning / held.analyzed) : null }, "on_file")
    : lastBeforeDay ? sideOf(lastBeforeDay, namedShare(beforeRows.filter((r) => r.reporting_day === lastBeforeDay)), "stored_answers")
      : { side: { day: null, checked: 0, mentioning: 0, rate: null, from: "nothing" as const }, thin: true };
  const before: ShipmentAiOutcome["before"] = beforeSide.side;

  const afterAll = rows.filter((r) => r.reporting_day >= stamp && r.reporting_day <= to);
  // AN INSTRUMENT CHANGE STARTS A NEW SEGMENT, NEVER A FOOTNOTE UNDER A CROSS-INSTRUMENT NUMBER (Codex, 2026-08-23).
  // THE INSTRUMENT IS AN EXACT TUPLE: engine, served model and mode together (Codex, 2026-08-23). Marginal lists
  // were CROSSED here before, so a start read on ChatGPT's API and Gemini's consumer search authorized ChatGPT's
  // consumer search, a pairing nobody observed. Exactness comes from the best record available: tuples frozen at
  // mark time, else the tuples on this change's own stored answers from before the stamp, else marginals ONLY
  // where they name one pairing (one model or one mode); marginals crossing on both sides certify nothing, so
  // every later answer starts its own segment. Excluded answers leave the DIRECTION arithmetic only: they still
  // appear in `instruments`, the boundary sentence and the named-segments line below.
  const tupleOf = (r: AiObservationRecord): string => `${r.engine}|${r.model_served ?? ""}|${r.observation_mode ?? ""}`;
  const sameInstrument: (r: AiObservationRecord) => boolean = (() => {
    if (held == null) return () => true;
    if (held.instruments?.length) { const s = new Set(held.instruments); return (r: AiObservationRecord) => s.has(tupleOf(r)); }
    if (beforeRows.length > 0) { const s = new Set(beforeRows.map(tupleOf)); return (r: AiObservationRecord) => s.has(tupleOf(r)); }
    const es = held.engines ?? [], ms = held.models ?? [], os = held.modes ?? [];
    if (ms.length === 0 && os.length === 0) return () => true;
    if (ms.length > 1 && os.length > 1) return () => false;
    return (r: AiObservationRecord) => (es.length === 0 || es.includes(r.engine)) && (ms.length === 0 || ms.includes(r.model_served ?? ""))
      && (os.length === 0 || os.includes(r.observation_mode ?? ""));
  })();
  const afterRows = afterAll.filter(sameInstrument);
  const answered = afterRows.filter(cameBack);
  const newInstrumentRows = afterAll.length - afterRows.length;
  const share = namedShare(afterRows);
  const after: ShipmentAiOutcome["after"] = { from: stamp, to, checked: share.checked, analyzed: share.analyzed, mentioning: share.mentioning, rate: share.rate };
  const coverage = { daysObserved: new Set(answered.map((r) => r.reporting_day)).size, daysElapsed: elapsedSince(stamp, to) };

  // THE SOURCE COUNTS, BOTH SIDES, THROUGH THE ONE countLinks. The before side is only ever the frozen baseline: recounting it from
  // whatever is on file today would move the starting point every time the page is opened, which is the whole reason it is written once.
  const startLinks = heldLinks(held), endLinks = countLinks(afterRows, ownedRootOf(all, ownedHost));
  const citations = { before: startLinks ? citationsOf(startLinks) : metricOf(0, 0), after: citationsOf(endLinks),
    rankBefore: startLinks ? rankOf(startLinks) : null, rankAfter: rankOf(endLinks) };
  const retrieval = { before: startLinks ? retrievalOf(startLinks) : metricOf(0, 0), after: retrievalOf(endLinks) };
  const passedOver = { before: startLinks ? passedOverOf(startLinks) : metricOf(0, 0), after: passedOverOf(endLinks) };

  // Three ways this stays honest rather than becoming a verdict: too few days read, nothing to compare
  // against, or too few answers actually read closely enough to say whether you were named. THE SAME
  // COVERAGE RULE ON BOTH SIDES, because a direction is a subtraction and one thin side is enough to make it
  // meaningless.
  const thinDays = coverage.daysObserved * 2 < coverage.daysElapsed;
  const thin = thinDays || before.rate == null || after.rate == null || beforeSide.thin || tooThin(share);
  // THE CONTROLS' OWN DRIFT comes off the verdicts, per metric, so the account's whole world moving is never
  // sold as this change working. Where too few controls hold, drift is zero and the receipt says none held.
  const controls = controlsOf(nonMembers.filter((r) => r.reporting_day >= window.from && r.reporting_day <= to), stamp, scopeEngines, ownedHost, sameInstrument);
  const mDrift = controls?.mentionDrift ?? 0, cDrift = controls?.citationDrift ?? 0;
  const mentionDirection: Direction = thin ? "unclear"
    : gapDir(metricOf(before.checked, before.mentioning), metricOf(after.analyzed, after.mentioning), "good_rate", mDrift);
  // A metric direction still needs the days: reading three of eleven days is not a trend on any metric.
  const citationsAdj = { ...citations, before: citations.before.rate == null ? citations.before
    : { ...citations.before, rate: r3((citations.before.rate ?? 0) + cDrift) } };
  const rawDirection = thinDays ? "unclear" : directionOf(objective, mentionDirection, citationsAdj, retrieval, passedOver);
  // A VERDICT LANDS AT DAY 28 AND NOT BEFORE (Codex, 2026-08-21): until the window has elapsed, a supported
  // move is reported as movement in the line and the direction stays "no clear movement yet".
  const mature = coverage.daysElapsed >= SHIPMENT_WINDOW_DAYS;
  const movement = !mature && (rawDirection === "improved" || rawDirection === "worsened")
    ? `Moving ${rawDirection === "improved" ? "up" : "down"} so far; a verdict lands once ${SHIPMENT_WINDOW_DAYS} days are read.` : null;
  const direction: Direction = mature ? rawDirection : rawDirection === "unclear" ? "unclear" : "no_clear_movement";
  // PER ASSISTANT FIRST: each engine's own answers, both sides off stored rows, judged by the same rule. The
  // overall verdict is `mixed` when two assistants genuinely disagree, never an average of opposites.
  const engines = [...new Set(answered.map((r) => r.engine))];
  const perEngine = engines.map((engine) => {
    const eb = beforeRows.filter((r) => r.engine === engine), ea = afterRows.filter((r) => r.engine === engine);
    const rootE = ownedRootOf(all, ownedHost);
    const dir = objective === "clicks" || objective === "ai_mentions"
      ? gapDir(metricOf(namedShare(eb).analyzed, namedShare(eb).mentioning), metricOf(namedShare(ea).analyzed, namedShare(ea).mentioning), "good_rate", mDrift)
      : objective === "ai_retrieval"
        ? gapDir(retrievalOf(countLinks(eb, rootE)), retrievalOf(countLinks(ea, rootE)), "good_rate")
        : gapDir(citationsOf(countLinks(eb, rootE)), citationsOf(countLinks(ea, rootE)), "good_rate", cDrift);
    return { engine, direction: dir };
  });
  const called = perEngine.filter((e) => e.direction === "improved" || e.direction === "worsened");
  const conflicted = mature && new Set(called.map((e) => e.direction)).size > 1;
  const finalDirection: Direction = conflicted ? "mixed" : direction;
  const metricLines = metricLinesOf(objective, startLinks != null, mentionDirection, citationsAdj, retrieval, passedOver);
  const extraLines = [
    ...(movement ? [movement] : []),
    ...(newInstrumentRows > 0 ? [(() => { const label = (t: string) => { const [e, m, o] = t.split("|"); return `${engineLabel(e ?? "")} on ${m || "an unnamed model"} (${(o || "unknown mode").replace(/_/g, " ")})`; };
      const named = [...new Set(afterAll.filter((r) => !sameInstrument(r)).map(tupleOf))].sort().map(label).join(", ");
      return `${newInstrumentRows} answers arrived on ${named}, which this change's starting numbers never saw; each starts its own segment and none is compared against them, because an instrument swap is not a result.`; })()] : []),
    ...(conflicted ? [`The assistants disagree: ${called.map((e) => `${engineLabel(e.engine)} ${e.direction}`).join(", ")}. A split verdict is reported as a split, never averaged.`] : []),
    ...(controls && (controls.mentionDrift != null || controls.citationDrift != null)
      ? [`Read against ${controls.questions} of your own unaffected questions over the same days; their movement is subtracted before anything is called.`]
      : [`No unaffected question of yours held enough answers over these days to act as a control, so nothing was subtracted and no verdict leans on one.`]),
  ];
  return {
    direction: finalDirection, mentionDirection, objective, before, after, citations, retrieval, retrievedNotCited: passedOver,
    instruments: instrumentsOf(afterAll.filter(cameBack)), boundary: boundaryOf(held, beforeRows, afterAll.filter(cameBack)), metricLines, coverage,
    controls, perEngine,
    // THE MENTION SENTENCE IS STILL THE MENTION'S. It is written off the mention direction, never the objective's, or a citation change
    // with rising mentions would print "the same share as before".
    line: [outcomeLine(mentionDirection, before, after, coverage), ...metricLines, ...extraLines].join(" "),
  };
}

/** THE SHARED CORE the sentence layer reads back: one bundle, one export. */
export const AI_OUTCOME_SHARED = { gapDir } as const;
