import "server-only";
/**
 * ai-outcomes (V1 Truth Convergence Phase 7) - WHAT THE AI ENGINES ACTUALLY SAID ABOUT THIS ACCOUNT.
 * Every number is computed at read time from answers ALREADY bought and stored: nothing fetched, paid,
 * or written, so the summary can never drift from the answers it claims to summarize. SLOT 0 ONLY:
 * volatility samples are never trend (a question sampled three times must not outvote one read once).
 * NULL IS A CLAIM: "no answer of yours was analyzed" and "you were named in none" are different
 * statements, and a missing day stays absent, never filled from its neighbours. MODEL AND MODE
 * BOUNDARIES ARE VISIBLE: a change in either splits the series into named segments, so a step reads
 * as "the instrument changed here", never as a silent win or loss. AND ONE CHANGE IS READ ON ITS OWN
 * SEARCHES: a Shipment's AI outcome sees only the answers its own scope claims, never the account's.
 */

import { isAnalysisSettled, readAiObservations, type AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations";
import { reportingDay } from "@/lib/reporting-day";
import { addDays, daysBetween, mergeRanges, overlaps, readPartitioned, type DayRange } from "./outcome-windows";
import { citesOwnSite, retrievedNotCitedLinks } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";

const FIRST_READING_SLOT = 0; // slot 0: the ONE canonical reading of a question on a day
const SHIPMENT_WINDOW_DAYS = 28; // the longest stretch one Shipment is judged over
const FLAT_BAND = 0.05; // under five points either way is not a move I am willing to call

type ObservedLink = { url: string; domain: string; title: string | null };
type Analysis = { ownedBrandMention?: { mentioned?: unknown } | null };
/** The injectable read. Production passes nothing and gets the stored-observation reader itself. The DAY
 *  RANGE is part of the ask, so the store returns the requested stretch and nothing outside it, and so is
 *  the PROJECTION, so an outcome read never drags whole answers and retrieval journeys across the wire. */
type ReadRows = (tenantId: string, opts: { limit?: number; slot?: number; fromDay?: string; toDay?: string; projection?: "full" | "outcome" | "overview" }) => Promise<AiObservationRecord[]>;
type ReadOpts = { ownedHost?: string | null; readObservations?: ReadRows };
/** What one engine was serving on one day. `asked` is every first reading planned that day whatever came back, `observed` the ones that actually answered, so an
 *  engine that went quiet reads as quiet. `analyzed` is how many of those answers a settled reading exists for, counted by the SAME rule the day pools (namedIn),
 *  so the engines sum to the day and a surface can say "3 of the 4 I read on ChatGPT" instead of falling back to one pooled fraction of a part-read day. Without
 *  it a per-engine `mentioning` had no denominator of its own and every engine line had to borrow the day's. */
type EnginePresence = {
  engine: string; modelServed: string | null; mode: string;
  asked: number; observed: number; analyzed: number; mentioning: number; citedOwned: number;
};
/** One reporting day, pooled across engines. Counts ride beside every rate so the surface can say what the
 *  rate was computed over instead of implying the whole day: `analyzed` is the answers read closely enough
 *  to say whether you were named, `citationSample` the answers whose engine reported what it credited, and
 *  `retrievalSample` the ones that reported BOTH what it read and what it credited. Rank 1 = credited first. */
type OutcomeDay = {
  day: string; observed: number; analyzed: number; mentioning: number;
  /** mentioning / analyzed. Null when nothing was analyzed, which is not the same as zero mentions. */
  mentionRate: number | null;
  citationSample: number; ownedCiting: number; ownedCitationRate: number | null; ownedCitationRank: number | null;
  retrievalSample: number; ownedRetrieved: number; retrievedNotCited: number;
  /** Of the answers that read a page of yours, the share where that page was not among the ones credited.
   *  Derived by subtracting the citations from the retrieval list, never read off the list. Null when
   *  no answer read a page of yours at all. */
  retrievedNotCitedRate: number | null;
  byEngine: EnginePresence[];
};
/** A stretch of days read on ONE instrument. A new segment starts the day a model or a mode changed, and
 *  `boundary` names exactly what changed, so the line is never quietly joined across the break. */
type OutcomeSegment = {
  from: string; to: string;
  /** What each engine was serving through this stretch. */
  models: Array<{ engine: string; modelServed: string | null; mode: string }>;
  boundary: Array<{ engine: string; day: string; fromModel: string | null; toModel: string | null; fromMode: string; toMode: string }> | null;
  days: OutcomeDay[];
};
/** The daily trend read over stored answers, split wherever the instrument changed. */
export type AiOutcomeReport = {
  from: string; to: string;
  /** Days in the range that carry at least one first reading. A missed day stays missed. */
  daysObserved: number;
  segments: OutcomeSegment[];
};

/** What the AI answers did around one shipped change. Direction only: this is an observation, not a proof. */
export type ShipmentAiOutcome = {
  direction: "improved" | "worsened" | "flat" | "unclear";
  /** `checked` is the denominator the rate was computed over on this side, which is always the answers read
   *  closely. `from` says where the number came from: the starting number written at mark time (`on_file`),
   *  the stored answers themselves (`stored_answers`), nothing at all (`nothing`), a starting number counted
   *  the old way whose own day is no longer on file (`on_file_legacy`, never comparable), or a read of the
   *  stored answers that did not land this time (`unavailable`). */
  before: { day: string | null; checked: number; mentioning: number; rate: number | null; from: "on_file" | "on_file_legacy" | "stored_answers" | "nothing" | "unavailable" };
  /** `checked` = answers that came back, `analyzed` = the ones read closely enough to say whether
   *  you were named, and `rate` = mentioning / analyzed. Null when nothing was analyzed; a zero
   *  there would read as "AI never named you" over answers nobody has read yet. */
  after: { from: string; to: string; checked: number; analyzed: number; mentioning: number; rate: number | null };
  /** Days I actually read against days that have passed. A missed day is missing, never filled in. */
  coverage: { daysObserved: number; daysElapsed: number };
  line: string;
};

// ── small pure helpers ──────────────────────────────────────────────────────

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
/** ONE DEFINITION OF A DAY, the operator's (src/lib/reporting-day): a UTC "today" put every instant
 *  from 5 PM Pacific on tomorrow, counting a change's own evening answers on its BEFORE side. Day
 *  LABEL arithmetic stays plain string math, which is not a day-from-instant at all. */
const dayOfInstant = (d: Date): string => reportingDay(d);
/** A stored stamp as a reporting day: a full instant resolves through the operator's zone, and a value
 *  already stored as a bare day label is already a day and is never shifted. null = not a moment I can read. */
const dayOfStamp = (raw: string | null): string | null => {
  const s = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const at = Date.parse(s);
  return Number.isFinite(at) ? reportingDay(at) : null;
};

const hostOf = (raw: string): string =>
  (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
/** ONE PREDICATE, SHARED WITH THE DECISION KERNEL (evidence/ai-visibility). This surface said 31 of 47 answers
 *  credited a page of theirs while a card said the site was never cited, because each side had written its own
 *  version of this test. There is one now, and both sides call it. */
const isOwned = (link: ObservedLink, root: string): boolean => citesOwnSite([link], root);

/** Was this account named in the answer? Null = nobody has read the WHOLE answer yet: a reading
 *  still missing pieces is real work, not a finished check, so it never enters a denominator. */
function namedIn(rec: AiObservationRecord): boolean | null {
  if (!isAnalysisSettled({ analysis: rec.analysis, analysisHash: rec.analysis_hash ?? null, answerHash: rec.answer_hash ?? null })) return null;
  const a = rec.analysis as Analysis | null;
  if (!a || a.ownedBrandMention == null) return null;
  return a.ownedBrandMention.mentioned === true;
}

/** THE canonical row filter: one first reading of one question, that actually came back. */
const isFirstReading = (r: AiObservationRecord): boolean => r.sample_slot === 0;
const cameBack = (r: AiObservationRecord): boolean => r.status === "observed";

const newestOf = (rows: AiObservationRecord[]): AiObservationRecord | null =>
  rows.reduce<AiObservationRecord | null>((best, r) => (!best || r.requested_at > best.requested_at ? r : best), null);

/** The account's own address, taken from the rows themselves (every observation carries the site it was
 *  read for), so nothing here has to go and ask another kernel who this account is. */
function ownedRootOf(rows: AiObservationRecord[], override?: string | null): string {
  if (override) return hostOf(override);
  const withSite = rows.find((r) => (r.site ?? "").trim().length > 0);
  return withSite ? hostOf(withSite.site) : "";
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

// ── the daily read ──────────────────────────────────────────────────────────

/** One engine's standing on one day. `asked` counts every first reading planned that day, answered or not,
 *  so an engine that went quiet reads as quiet instead of disappearing from the day entirely. */
function presenceOf(engine: string, rows: AiObservationRecord[], root: string): EnginePresence {
  const answered = rows.filter(cameBack);
  const newest = newestOf(answered) ?? newestOf(rows);
  return {
    engine,
    modelServed: newest?.model_served ?? null,
    mode: newest?.observation_mode ?? "",
    asked: new Set(rows.map((r) => r.prompt_id)).size,
    observed: new Set(answered.map((r) => r.prompt_id)).size,
    // The denominator `mentioning` is a share OF. A reading that landed says true or false; one nobody has finished says nothing at all and enters neither count.
    analyzed: answered.filter((r) => namedIn(r) !== null).length,
    mentioning: answered.filter((r) => namedIn(r) === true).length,
    citedOwned: answered.filter((r) => (r.journey?.cited_sources ?? null)?.some((c) => isOwned(c, root)) === true).length,
  };
}

/** Everything one reporting day says, over its first readings only. */
function dayTotals(day: string, rows: AiObservationRecord[], root: string): OutcomeDay {
  const answered = rows.filter(cameBack);
  const analyzed = answered.filter((r) => namedIn(r) !== null);
  const mentioning = analyzed.filter((r) => namedIn(r) === true).length;

  let citationSample = 0, ownedCiting = 0, rankSum = 0, rankCount = 0;
  let retrievalSample = 0, ownedRetrieved = 0, retrievedNotCited = 0;
  for (const r of answered) {
    const cited = (r.journey?.cited_sources ?? null) as ObservedLink[] | null;
    const read = (r.journey?.retrieved_results ?? null) as ObservedLink[] | null;
    if (cited !== null) {
      citationSample += 1;
      const at = cited.findIndex((c) => isOwned(c, root));
      if (at >= 0) { ownedCiting += 1; rankSum += at + 1; rankCount += 1; }
    }
    // Retrieved-but-not-cited needs BOTH halves: what the engine read AND what it credited. One without the
    // other cannot support the claim, so that answer leaves the sample rather than being guessed at. The
    // retrieval list is what the provider REPORTED READING and may hold pages it then credited, so the
    // subtraction runs through the one canonical-url derivation, never off the stored list.
    if (read !== null && cited !== null) {
      retrievalSample += 1;
      if (read.some((c) => isOwned(c, root))) {
        ownedRetrieved += 1;
        if (retrievedNotCitedLinks(read, cited).some((c) => isOwned(c, root))) retrievedNotCited += 1;
      }
    }
  }

  return {
    day,
    observed: answered.length,
    analyzed: analyzed.length,
    mentioning,
    mentionRate: analyzed.length > 0 ? r3(mentioning / analyzed.length) : null,
    citationSample,
    ownedCiting,
    ownedCitationRate: citationSample > 0 ? r3(ownedCiting / citationSample) : null,
    ownedCitationRank: rankCount > 0 ? r3(rankSum / rankCount) : null,
    retrievalSample,
    ownedRetrieved,
    retrievedNotCited,
    retrievedNotCitedRate: ownedRetrieved > 0 ? r3(retrievedNotCited / ownedRetrieved) : null,
    byEngine: [...groupBy(rows, (r) => r.engine).entries()]
      .map(([engine, forEngine]) => presenceOf(engine, forEngine, root))
      .sort((a, b) => a.engine.localeCompare(b.engine)),
  };
}

/** Cut the day series wherever an engine changed the model it serves or the mode it was read in. An engine
 *  that answered nothing that day proves no change, so it never breaks the line on its own. */
function segmentize(days: OutcomeDay[]): OutcomeSegment[] {
  const segments: OutcomeSegment[] = [];
  const lastSeen = new Map<string, { model: string | null; mode: string }>();
  let current: OutcomeSegment | null = null;
  for (const d of days) {
    const changed: NonNullable<OutcomeSegment["boundary"]> = [];
    for (const e of d.byEngine) {
      if (e.observed === 0) continue;
      const prev = lastSeen.get(e.engine);
      if (prev && (prev.model !== e.modelServed || prev.mode !== e.mode)) {
        changed.push({ engine: e.engine, day: d.day, fromModel: prev.model, toModel: e.modelServed, fromMode: prev.mode, toMode: e.mode });
      }
      lastSeen.set(e.engine, { model: e.modelServed, mode: e.mode });
    }
    if (!current || changed.length > 0) {
      current = { from: d.day, to: d.day, models: [], boundary: changed.length > 0 ? changed : null, days: [] };
      segments.push(current);
    }
    current.days.push(d);
    current.to = d.day;
  }
  for (const s of segments) {
    const held = new Map<string, { engine: string; modelServed: string | null; mode: string }>();
    for (const d of s.days) for (const e of d.byEngine) {
      if (e.observed > 0) held.set(e.engine, { engine: e.engine, modelServed: e.modelServed, mode: e.mode });
    }
    s.models = [...held.values()].sort((a, b) => a.engine.localeCompare(b.engine));
  }
  return segments;
}

/** The stored first readings OVER ONE DAY RANGE: range and slot are asked for in the QUERY and the
 *  store pages until the range is exhausted (the newest-2,000 shot built a 28 day report from a
 *  fortnight). The filter after the read is the belt to those braces. */
const readRows = async (tenantId: string, window: { from: string; to: string }, opts: ReadOpts & { projection?: "outcome" | "overview" }): Promise<AiObservationRecord[]> =>
  (await (opts.readObservations ?? readAiObservations)(tenantId, { fromDay: window.from, toDay: window.to, slot: FIRST_READING_SLOT,
    ...(opts.projection ? { projection: opts.projection } : {}) }))
    .filter((r) => r.tenant_id === tenantId && isFirstReading(r) && r.reporting_day >= window.from && r.reporting_day <= window.to);

/** THE DAILY TREND READ over stored answers. Pure over what is on file; a failed read THROWS, because an empty report reads as "AI never mentions you", which is a different and false claim. */
export async function aiOutcomes(tenantId: string, range: { from: string; to: string } & ReadOpts): Promise<AiOutcomeReport> {
  // Read in bounded pieces for the same reason the ledger is: a year of first readings is past the store's
  // own row ceiling. The trend still THROWS on a piece it could not read, because a short series drawn as if
  // it were the whole stretch would read as days AI said nothing, which is a different and false claim. AND IT ASKS FOR WHAT IT READS: a trend needs the day, the instrument, the verdict and the two journey lists, so it takes the overview projection and never the whole row, whose answer text alone is 6 MB over 28 days.
  const { rows, failed } = await readPartitioned([{ from: range.from, to: range.to }], (from, to) => readRows(tenantId, { from, to }, { ...range, projection: "overview" }));
  if (failed.length > 0) throw new Error(`[ai-outcomes] could not read ${failed[0]!.from} to ${failed[0]!.to}`);
  const root = ownedRootOf(rows, range.ownedHost);
  const days = [...groupBy(rows, (r) => r.reporting_day).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, forDay]) => dayTotals(day, forDay, root))
    .filter((d) => d.observed > 0 || d.byEngine.length > 0);
  return { from: range.from, to: range.to, daysObserved: days.filter((d) => d.observed > 0).length, segments: segmentize(days) };
}

/**
 * THE TREND CHART'S READ: the last `days` reporting days, already cut at every model or mode change so the
 * surface can draw the break instead of joining two different instruments into one line.
 */
export async function visibilitySeries(tenantId: string, days: number, opts: ReadOpts & { now?: Date } = {}): Promise<AiOutcomeReport["segments"]> {
  const to = dayOfInstant(opts.now ?? new Date());
  const span = Math.max(1, Math.min(Math.floor(days), 365));
  return (await aiOutcomes(tenantId, { from: addDays(to, -(span - 1)), to, ...opts })).segments;
}

/** How often this account was named, over the answers with a SETTLED CHECK (a close reading or the
 *  deterministic name-and-address match): the rate divides by
 *  `analyzed`, never `checked`, the same rule on both sides of a shipment, null when nothing was
 *  analyzed (a different claim from a zero share, and it stays different). */
function namedShare(rows: AiObservationRecord[]): { checked: number; analyzed: number; mentioning: number; rate: number | null } {
  const answered = rows.filter(cameBack);
  const analyzed = answered.filter((r) => namedIn(r) !== null);
  const mentioning = analyzed.filter((r) => namedIn(r) === true).length;
  return {
    checked: answered.length,
    analyzed: analyzed.length,
    mentioning,
    rate: analyzed.length > 0 ? r3(mentioning / analyzed.length) : null,
  };
}

/** THE ONE COVERAGE RULE, both sides of a shipped change: under half the answers read closely means
 *  the share is a fact about how much analysis finished, not what AI said, so the outcome reads
 *  unclear rather than a direction. */
const tooThin = (s: { checked: number; analyzed: number }): boolean => s.analyzed <= 0 || s.analyzed * 2 < s.checked;

function outcomeLine(direction: ShipmentAiOutcome["direction"], before: ShipmentAiOutcome["before"], after: ShipmentAiOutcome["after"], coverage: ShipmentAiOutcome["coverage"]): string {
  const since = `I collected ${after.checked} AI ${after.checked === 1 ? "answer" : "answers"} on ${coverage.daysObserved} of the ${coverage.daysElapsed} days since you marked this done`;
  if (direction === "unclear") {
    if (before.from === "nothing") {
      return `${since}, and I have nothing from before the change to compare them against. I keep reading every day and will say which way this went once both sides are there.`;
    }
    // TWO DIFFERENT COUNTS ARE NOT A DIRECTION. An old starting number counted every answer that came back,
    // read or not, and the answers from that day are gone, so there is nothing to recount it from.
    if (before.from === "on_file_legacy") {
      return `${since}. The starting number I saved for this change was counted a different way from the answers I read now, and that day's answers are no longer on file, so I will not turn the two into a direction. I keep reading every day.`;
    }
    return `${since}, which is too little to call either way yet. I keep reading every day.`;
  }
  // The denominator the share was computed over, said out loud, and named for what it is: a settled check,
  // which may be a name-and-address match rather than a close reading, so "finished checking" never overclaims.
  const now = `you were named in ${after.mentioning} of the ${after.analyzed} I have finished checking`;
  const then = `${before.mentioning} of ${before.checked} before it`;
  if (direction === "improved") return `${since}, ${now}, up from ${then}. I keep reading every day.`;
  if (direction === "worsened") return `${since}, ${now}, down from ${then}. I keep reading every day, and I will bring you the next move on this page.`;
  return `${since}, ${now}, the same share as ${then}. I keep reading every day.`;
}

/** WHAT THE AI ANSWERS DID AROUND ONE SHIPPED CHANGE: the held starting number (or the last stored day
 *  ahead of the stamp), against stamp-to-now bounded to 28 days, both counted the same way. Coverage
 *  rides the answer; under half is `unclear`, not a verdict; no stamp means null. */
type ShipmentForOutcome = {
  implementedAt: string | null;
  shipmentBaseline?: { ai: { day: string; checked: number; analyzed?: number; mentioning: number } | null } | null;
  /** THE SEARCHES THIS ONE CHANGE WAS AIMED AT, frozen onto the Shipment at mark time: a tracked question's
   *  own id, or the search itself in words. Empty or absent = I cannot tell which answers belong to this
   *  change, and it says so rather than reading the whole account on this one page's behalf. */
  scopeQueries?: readonly string[] | null;
  /** THE TYPED SCOPE, when the shipment preserved one: exact prompt ids, the assistants the claim was made
   *  on, and the fan-out cluster. It wins over scopeQueries because it is the claim itself, not a flattening
   *  of it; the fan-out texts join so a follow-up search later promoted to a tracked question lands here. */
  aiScope?: { promptIds: readonly string[]; engines: readonly string[]; fanouts: readonly string[]; stage: string } | null;
};

/** ONE SHIPMENT'S MEMBERSHIP: ids matched exactly, wordings matched on their canonical words, and, when the
 *  shipment preserved its typed AI scope, ONLY the assistants the claim was made on. Null when the change
 *  carries no scope at all, which is a state and not an empty filter. PURE. */
type ShipmentScope = { keys: Set<string>; engines: Set<string> | null };
function scopeKeysOf(shipment: ShipmentForOutcome): ShipmentScope | null {
  const typed = shipment.aiScope;
  if (typed && (typed.promptIds.length > 0 || typed.fanouts.length > 0)) {
    const keys = new Set<string>();
    for (const id of typed.promptIds) if (id.trim().length > 0) keys.add(id.trim());
    for (const q of typed.fanouts) { const k = canonicalQueryKey(q); if (k.length > 0) keys.add(k); }
    return { keys, engines: typed.engines.length > 0 ? new Set(typed.engines) : null };
  }
  const keys = new Set<string>();
  for (const raw of shipment.scopeQueries ?? []) {
    const text = (raw ?? "").trim();
    if (text.length > 0) { keys.add(text); const k = canonicalQueryKey(text); if (k.length > 0) keys.add(k); }
  }
  return keys.size > 0 ? { keys, engines: null } : null;
}

/** DOES THIS ANSWER BELONG TO THIS CHANGE? The closed rule Decision holds (decision/membership.ts), spelled
 *  out here because Measurement may not import Decision, and narrowed to what THIS read can actually see:
 *  the question asked is one of the change's tracked ids, or its exact wording. Nothing else is a route in:
 *  a word an account puts on everything is not evidence about one page. PURE. */
function answerJoinsScope(rec: AiObservationRecord, scope: ShipmentScope): boolean {
  if (scope.engines != null && !scope.engines.has(rec.engine)) return false;
  if (scope.keys.has(rec.prompt_id)) return true;
  const asked = canonicalQueryKey(rec.prompt_text ?? "");
  // Two routes only, because the lean outcome projection this read runs on carries no journey: the exact
  // question id, or the exact question wording (a preserved fan-out text joins by the same wording rule the
  // day it becomes a tracked question). A journey-based route here would be a claim the read cannot keep.
  return asked.length > 0 && scope.keys.has(asked);
}

/** The two ends of ONE shipment's read: the 28 days ahead of the stamp, where the fallback before-number is
 *  found, and the 28 days after it, bounded by today. Null when the change carries no stamp to measure from. */
function shipmentWindow(shipment: ShipmentForOutcome, nowDay: string): { stamp: string; from: string; to: string } | null {
  const stamp = dayOfStamp(shipment.implementedAt);
  if (!stamp) return null;
  // 28 reporting days COUNTING the day it was marked done, so the days I read and the days that passed are
  // counted the same way and coverage can never read as more days than have actually elapsed.
  const last = addDays(stamp, SHIPMENT_WINDOW_DAYS - 1);
  return { stamp, from: addDays(stamp, -SHIPMENT_WINDOW_DAYS), to: nowDay < last ? nowDay : last };
}

/** EVERY SHIPMENT ON ONE LEDGER, OFF ONE SET OF BOUNDED READS. Per-shipment 56 day reads in a
 *  Promise.all timed statements out before, and one whole-union read hits the store's 40,000 row
 *  ceiling at a year of 140 readings a day, nulling every outcome at once. So the union is merged,
 *  partitioned into pieces one read can hold, and shared; a piece that will not read fails only the
 *  shipments whose windows touch it (see outcome-windows.ts). */
export async function aiOutcomesForShipments(tenantId: string, shipments: readonly ShipmentForOutcome[], opts: ReadOpts & { now?: Date } = {}): Promise<(ShipmentAiOutcome | null)[]> {
  const nowDay = dayOfInstant(opts.now ?? new Date());
  const windows = shipments.map((s) => shipmentWindow(s, nowDay));
  // A CHANGE WITH NO SCOPE ASKS FOR NOTHING. Reading the account's whole window on its behalf is what made
  // one page's answers into another page's result, so an unscopable Shipment never widens this read at all.
  const scopes = shipments.map(scopeKeysOf);
  const needed = shipments.map((s, i) => (windows[i] && scopes[i] ? rangesFor(s, windows[i]!) : []));
  const { rows, failed } = await readPartitioned(mergeRanges(needed.flat()), (from, to) => readRows(tenantId, { from, to }, { ...opts, projection: "outcome" }));
  return shipments.map((s, i) => {
    const w = windows[i];
    if (w == null) return null;
    const scope = scopes[i];
    if (scope == null) return unscopableOutcome(w);
    if (failed.some((f) => needed[i]!.some((r) => overlaps(f, r)))) return unreadableOutcome(w);
    return outcomeFromRows(rows.filter((r) => answerJoinsScope(r, scope)), s, w);
  });
}

export async function aiOutcomeForShipment(tenantId: string, shipment: ShipmentForOutcome, opts: ReadOpts & { now?: Date } = {}): Promise<ShipmentAiOutcome | null> {
  return (await aiOutcomesForShipments(tenantId, [shipment], opts))[0] ?? null;
}

/** THE DAYS ONE SHIPMENT NEEDS ON FILE: its own 56 day window, plus the day a legacy starting number was
 *  captured on when that day sits outside the window, because that day is what the old number is recounted
 *  from. Nothing else is ever asked for on a shipment's behalf. */
function rangesFor(shipment: ShipmentForOutcome, window: { stamp: string; from: string; to: string }): DayRange[] {
  const held = shipment.shipmentBaseline?.ai ?? null;
  const legacy = held != null && typeof held.analyzed !== "number" ? held.day : null;
  return legacy && (legacy < window.from || legacy > window.to)
    ? [{ from: window.from, to: window.to }, { from: legacy, to: legacy }]
    : [{ from: window.from, to: window.to }];
}

/** Days I actually read against days that have passed, counted the same way on both sides. */
const elapsedSince = (stamp: string, to: string): number =>
  Math.max(1, Math.min(daysBetween(stamp, to) + 1, SHIPMENT_WINDOW_DAYS));

/** NOTHING READ, AND WHY. Not a verdict and not a zero: every count is honestly empty and the line says which
 *  of the two silences this is. */
function noReadOutcome(window: { stamp: string; to: string }, line: string): ShipmentAiOutcome {
  return {
    direction: "unclear",
    before: { day: null, checked: 0, mentioning: 0, rate: null, from: "unavailable" },
    after: { from: window.stamp, to: window.to, checked: 0, analyzed: 0, mentioning: 0, rate: null },
    coverage: { daysObserved: 0, daysElapsed: elapsedSince(window.stamp, window.to) },
    line,
  };
}

/** THE ANSWERS ARE ON FILE AND I COULD NOT GET TO THEM THIS TIME. */
const unreadableOutcome = (window: { stamp: string; to: string }): ShipmentAiOutcome =>
  noReadOutcome(window, "I could not read the answers for this period just now. They are safe and I will read them on the next refresh.");

/** I CANNOT TELL WHICH ANSWERS BELONG TO THIS CHANGE, and above all I will not hand it the whole account's. */
const unscopableOutcome = (window: { stamp: string; to: string }): ShipmentAiOutcome =>
  noReadOutcome(window, "I did not keep which searches this change was aimed at, so I cannot say which AI answers belong to it, and I will not hand it every answer this account bought. Every change I record from now on carries its own searches.");

/** PURE over rows already in hand: one shipment's before, after, coverage and direction. */
function outcomeFromRows(all: readonly AiObservationRecord[], shipment: ShipmentForOutcome, window: { stamp: string; from: string; to: string }): ShipmentAiOutcome {
  const { stamp, to } = window;
  const rows = all.filter((r) => r.reporting_day >= window.from && r.reporting_day <= to);

  const held = shipment.shipmentBaseline?.ai ?? null;
  const beforeRows = rows.filter((r) => r.reporting_day < stamp && cameBack(r));
  const lastBeforeDay = beforeRows.map((r) => r.reporting_day).sort().pop() ?? null;
  // A LEGACY STARTING NUMBER counted every answer that came back, so its share is a different measure from
  // the one the after side computes and the two can never be subtracted. Its own day is recounted from the
  // answers still on file for that exact day; the store was asked for that day for this reason.
  const legacyDay = held != null && typeof held.analyzed !== "number" ? held.day : null;
  const legacyRows = legacyDay ? all.filter((r) => r.reporting_day === legacyDay && cameBack(r)) : [];
  /** One side of the comparison, named by the denominator its own rate was computed over, plus whether that
   *  denominator is too thin to trust: under half the answers on this side were read closely. */
  const sideOf = (day: string | null, s: { checked: number; analyzed: number; mentioning: number; rate: number | null },
    from: ShipmentAiOutcome["before"]["from"]) =>
    ({ side: { day, checked: s.analyzed, mentioning: s.mentioning, rate: s.rate, from }, thin: tooThin(s) });
  const beforeSide = held && typeof held.analyzed === "number"
    ? sideOf(held.day, { checked: held.checked, analyzed: held.analyzed, mentioning: held.mentioning,
      rate: held.analyzed > 0 ? r3(held.mentioning / held.analyzed) : null }, "on_file")
    : legacyDay && legacyRows.length > 0 ? sideOf(legacyDay, namedShare(legacyRows), "stored_answers")
      : legacyDay
        ? { side: { day: legacyDay, checked: held!.checked, mentioning: held!.mentioning, rate: null, from: "on_file_legacy" as const }, thin: true }
        : lastBeforeDay ? sideOf(lastBeforeDay, namedShare(beforeRows.filter((r) => r.reporting_day === lastBeforeDay)), "stored_answers")
          : { side: { day: null, checked: 0, mentioning: 0, rate: null, from: "nothing" as const }, thin: true };
  const before: ShipmentAiOutcome["before"] = beforeSide.side;

  const afterRows = rows.filter((r) => r.reporting_day >= stamp && r.reporting_day <= to);
  const share = namedShare(afterRows);
  const after: ShipmentAiOutcome["after"] = { from: stamp, to, checked: share.checked, analyzed: share.analyzed, mentioning: share.mentioning, rate: share.rate };
  const coverage = {
    daysObserved: new Set(afterRows.filter(cameBack).map((r) => r.reporting_day)).size,
    daysElapsed: elapsedSince(stamp, to),
  };

  // Three ways this stays honest rather than becoming a verdict: too few days read, nothing to compare
  // against, or too few answers actually read closely enough to say whether you were named. THE SAME
  // COVERAGE RULE ON BOTH SIDES, because a direction is a subtraction and one thin side is enough to make it
  // meaningless.
  const thin = coverage.daysObserved * 2 < coverage.daysElapsed
    || before.rate == null || after.rate == null
    || beforeSide.thin || tooThin(share);
  const gap = thin ? 0 : (after.rate ?? 0) - (before.rate ?? 0);
  const direction: ShipmentAiOutcome["direction"] = thin ? "unclear"
    : gap > FLAT_BAND ? "improved"
      : gap < -FLAT_BAND ? "worsened" : "flat";
  return { direction, before, after, coverage, line: outcomeLine(direction, before, after, coverage) };
}
