import "server-only";

/**
 * ai-outcomes (V1 Truth Convergence Phase 7) - WHAT THE AI ENGINES ACTUALLY SAID ABOUT THIS ACCOUNT.
 *
 * Every number here is computed at read time from answers ALREADY bought and stored (ai_observations).
 * Nothing is fetched, nothing is paid for, nothing is written. That is deliberate: an AI result is
 * historical source data, so it is read fresh on the visit that asks for it rather than frozen into a
 * second store that can drift from the answers it claims to summarize.
 *
 * SLOT 0 ONLY. Slot 0 is the ONE canonical reading of a question on a day; slots 1 and 2 are extra samples
 * an operator asked for to see how much the same question wobbles. Pooling them would let a question that
 * happened to be sampled three times outvote one read once, so a trend built on them would move because of
 * how often I asked, not because of what changed. Volatility samples are never trend.
 *
 * NULL IS A CLAIM. A rate with nothing behind it is null, never 0: "no answer of yours was analyzed" and
 * "you were named in none of them" are different statements and the surface must be able to tell them
 * apart. A day with no reading is simply absent from the series; it is never filled in from its neighbours.
 *
 * MODEL AND MODE BOUNDARIES ARE VISIBLE. The engines re-point their model underneath us and a consumer-mode
 * reading is not the same instrument as an API-mode one. A change in either splits the series into segments
 * and the break is named, so a step in the line reads as "the instrument changed here", never as a silent
 * win or loss.
 *
 * DEFERRED TO PHASE 8, and named so nobody has to guess what is missing: NOTHING RENDERS THIS YET. The AI
 * half of Results (the visibility trend with its instrument breaks drawn, and the AI line on a shipped
 * change) is that phase's surface work. Every number below is computed, tested and honest today, so the day
 * those surfaces are built they read truth instead of being written against an empty column.
 */

import {
  readAiObservations,
  type AiObservationRecord,
} from "@/domains/evidence/ai-visibility/ai-observations";

/** One read pulls back at most this many FIRST readings: four engines x a dozen questions x 28
 *  days fits. The extra volatility samples are excluded by the query itself (slot below), so they
 *  never consume this cap and quietly truncate the history a trend is drawn over. */
const MAX_ROWS = 2000;
/** Slot 0: the ONE canonical reading of a question on a day. */
const FIRST_READING_SLOT = 0;
/** The longest stretch one Shipment is judged over. */
const SHIPMENT_WINDOW_DAYS = 28;
/** Under five points either way is not a move I am willing to call. */
const FLAT_BAND = 0.05;
const MAX_COMPETITORS = 10;

type ObservedLink = { url: string; domain: string; title: string | null };
type Analysis = {
  ownedBrandMention?: { mentioned?: unknown } | null;
  competitors?: Array<{ name?: unknown; position?: unknown }> | null;
};

/** The injectable read. Production passes nothing and gets the stored-observation reader itself. */
type ReadRows = (tenantId: string, opts: { limit?: number; slot?: number }) => Promise<AiObservationRecord[]>;
type ReadOpts = { ownedHost?: string | null; readObservations?: ReadRows };

/** What one engine was serving on one day. `asked` is every first reading planned that day whatever came
 *  back, `observed` the ones that actually answered, so an engine that went quiet reads as quiet. */
type EnginePresence = {
  engine: string; modelServed: string | null; mode: string;
  asked: number; observed: number; mentioning: number; citedOwned: number;
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
  /** Of the answers that read your page, the share that then credited someone else. Null when none read it. */
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
  /** Who else the answers kept naming, most-named first. */
  competitors: Array<{ name: string; answers: number; meanPosition: number | null }>;
};

/** What the AI answers did around one shipped change. Direction only: this is an observation, not a proof. */
export type ShipmentAiOutcome = {
  direction: "improved" | "worsened" | "flat" | "unclear";
  /** `checked` is the denominator the rate was computed over on this side. */
  before: { day: string | null; checked: number; mentioning: number; rate: number | null; from: "on_file" | "stored_answers" | "nothing" };
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
const utcDay = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number): string =>
  utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000));
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);

const hostOf = (raw: string): string =>
  (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
const isOwned = (link: ObservedLink, root: string): boolean => {
  if (!root) return false;
  const h = hostOf(link.domain || link.url);
  return h === root || h.endsWith(`.${root}`);
};

/** Was this account named in the answer? Null = nobody has read the answer closely yet. */
function namedIn(rec: AiObservationRecord): boolean | null {
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
    // other cannot support the claim, so that answer is left out of the sample rather than guessed at.
    if (read !== null && cited !== null) {
      retrievalSample += 1;
      if (read.some((c) => isOwned(c, root))) {
        ownedRetrieved += 1;
        if (!cited.some((c) => isOwned(c, root))) retrievedNotCited += 1;
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

/** Who else the answers named, over the answers that were actually read closely. */
function competitorsIn(rows: AiObservationRecord[]): AiOutcomeReport["competitors"] {
  const tally = new Map<string, { answers: number; posSum: number; posCount: number }>();
  for (const r of rows) {
    const named = ((r.analysis as Analysis | null)?.competitors ?? []) as Array<{ name?: unknown; position?: unknown }>;
    const seen = new Set<string>();
    for (const c of named) {
      const name = typeof c?.name === "string" ? c.name.trim() : "";
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const acc = tally.get(name) ?? { answers: 0, posSum: 0, posCount: 0 };
      acc.answers += 1;
      if (typeof c.position === "number" && Number.isFinite(c.position)) { acc.posSum += c.position; acc.posCount += 1; }
      tally.set(name, acc);
    }
  }
  return [...tally.entries()]
    .map(([name, a]) => ({ name, answers: a.answers, meanPosition: a.posCount > 0 ? r3(a.posSum / a.posCount) : null }))
    .sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name))
    .slice(0, MAX_COMPETITORS);
}

/** The stored first readings for one account. The slot is asked for in the QUERY so the cap holds
 *  first readings only; the row filter after it is the belt to that braces, and the one that holds
 *  when a caller injects its own reader. */
const readRows = async (tenantId: string, opts: ReadOpts): Promise<AiObservationRecord[]> =>
  (await (opts.readObservations ?? readAiObservations)(tenantId, { limit: MAX_ROWS, slot: FIRST_READING_SLOT }))
    .filter((r) => r.tenant_id === tenantId && isFirstReading(r));

/**
 * THE DAILY TREND READ over stored answers: how often AI named this account, how often it credited its
 * pages, where in the credited list it stood, who else kept being named, and how much of each day's
 * question list each engine actually answered. Pure over what is on file; a read that fails THROWS,
 * because an empty report reads as "AI never mentions you", which is a different and false claim.
 */
export async function aiOutcomes(
  tenantId: string,
  range: { from: string; to: string } & ReadOpts,
): Promise<AiOutcomeReport> {
  const rows = (await readRows(tenantId, range)).filter((r) => r.reporting_day >= range.from && r.reporting_day <= range.to);
  const root = ownedRootOf(rows, range.ownedHost);
  const days = [...groupBy(rows, (r) => r.reporting_day).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, forDay]) => dayTotals(day, forDay, root))
    .filter((d) => d.observed > 0 || d.byEngine.length > 0);
  return {
    from: range.from,
    to: range.to,
    daysObserved: days.filter((d) => d.observed > 0).length,
    segments: segmentize(days),
    competitors: competitorsIn(rows.filter(cameBack)),
  };
}

/**
 * THE TREND CHART'S READ: the last `days` reporting days, already cut at every model or mode change so the
 * surface can draw the break instead of joining two different instruments into one line.
 */
export async function visibilitySeries(
  tenantId: string,
  days: number,
  opts: ReadOpts & { now?: Date } = {},
): Promise<AiOutcomeReport["segments"]> {
  const to = utcDay(opts.now ?? new Date());
  const span = Math.max(1, Math.min(Math.floor(days), 365));
  return (await aiOutcomes(tenantId, { from: addDays(to, -(span - 1)), to, ...opts })).segments;
}

/**
 * How often this account was named, over the answers ACTUALLY READ CLOSELY. The rate divides by
 * `analyzed`, never by `checked`: an answer nobody has read yet cannot say whether you were named,
 * so counting it as a miss reported a change in how much analysis had finished as if it were a
 * change in what AI said. The same rule the daily trend uses, so before and after are one measure.
 * Null when nothing was analyzed, which is a different claim from a zero share and stays different.
 */
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

function outcomeLine(direction: ShipmentAiOutcome["direction"], before: ShipmentAiOutcome["before"], after: ShipmentAiOutcome["after"], coverage: ShipmentAiOutcome["coverage"]): string {
  const since = `I read ${after.checked} AI ${after.checked === 1 ? "answer" : "answers"} on ${coverage.daysObserved} of the ${coverage.daysElapsed} days since you marked this done`;
  if (direction === "unclear") {
    return before.from === "nothing"
      ? `${since}, and I have nothing from before the change to compare them against. I keep reading every day and will say which way this went once both sides are there.`
      : `${since}, which is too little to call either way yet. I keep reading every day.`;
  }
  // The denominator the share was computed over, said out loud: "36 of 60" would compare a count
  // over the answers I read closely against a total that includes answers nobody has read.
  const now = `you were named in ${after.mentioning} of the ${after.analyzed} I read closely`;
  const then = `${before.mentioning} of ${before.checked} before it`;
  if (direction === "improved") return `${since}, ${now}, up from ${then}. I keep reading every day.`;
  if (direction === "worsened") return `${since}, ${now}, down from ${then}. I keep reading every day, and I will bring you the next move on this page.`;
  return `${since}, ${now}, the same share as ${then}. I keep reading every day.`;
}

/**
 * WHAT THE AI ANSWERS DID AROUND ONE SHIPPED CHANGE. The before side is the starting number written onto the
 * Shipment when the operator marked it done, or, when none was held, the last day of stored answers ahead of
 * the stamp. The after side is the stamp to now, bounded to 28 days. Both sides count the same way.
 *
 * Coverage rides the answer: days I actually read against days that have passed. A missed day is missing and
 * is never filled in from its neighbours, and under half coverage is `unclear`, not a verdict. Null when the
 * change carries no stamp, because there is then no moment to measure from.
 */
export async function aiOutcomeForShipment(
  tenantId: string,
  shipment: { implementedAt: string | null; shipmentBaseline?: { ai: { day: string; checked: number; mentioning: number } | null } | null },
  opts: ReadOpts & { now?: Date } = {},
): Promise<ShipmentAiOutcome | null> {
  const stamp = (shipment.implementedAt ?? "").slice(0, 10);
  if (!stamp || !Number.isFinite(Date.parse(`${stamp}T00:00:00.000Z`))) return null;
  const now = utcDay(opts.now ?? new Date());
  // 28 reporting days COUNTING the day it was marked done, so the days I read and the days that passed are
  // counted the same way and coverage can never read as more days than have actually elapsed.
  const last = addDays(stamp, SHIPMENT_WINDOW_DAYS - 1);
  const to = now < last ? now : last;
  const rows = await readRows(tenantId, opts);

  const held = shipment.shipmentBaseline?.ai ?? null;
  const beforeRows = rows.filter((r) => r.reporting_day < stamp && cameBack(r));
  const lastBeforeDay = beforeRows.map((r) => r.reporting_day).sort().pop() ?? null;
  const computed = namedShare(beforeRows.filter((r) => r.reporting_day === lastBeforeDay));
  const before: ShipmentAiOutcome["before"] = held
    ? { day: held.day, checked: held.checked, mentioning: held.mentioning, rate: held.checked > 0 ? r3(held.mentioning / held.checked) : null, from: "on_file" }
    // The before side names the same denominator its own rate was computed over.
    : lastBeforeDay
      ? { day: lastBeforeDay, checked: computed.analyzed, mentioning: computed.mentioning, rate: computed.rate, from: "stored_answers" }
      : { day: null, checked: 0, mentioning: 0, rate: null, from: "nothing" };

  const afterRows = rows.filter((r) => r.reporting_day >= stamp && r.reporting_day <= to);
  const share = namedShare(afterRows);
  const after: ShipmentAiOutcome["after"] = { from: stamp, to, checked: share.checked, analyzed: share.analyzed, mentioning: share.mentioning, rate: share.rate };
  const coverage = {
    daysObserved: new Set(afterRows.filter(cameBack).map((r) => r.reporting_day)).size,
    daysElapsed: Math.max(1, Math.min(daysBetween(stamp, to) + 1, SHIPMENT_WINDOW_DAYS)),
  };

  // Three ways this stays honest rather than becoming a verdict: too few days read, nothing to compare
  // against, or too few answers actually read closely enough to say whether you were named.
  const thin = coverage.daysObserved * 2 < coverage.daysElapsed
    || before.rate == null || after.rate == null
    || share.analyzed * 2 < share.checked;
  const gap = thin ? 0 : (after.rate ?? 0) - (before.rate ?? 0);
  const direction: ShipmentAiOutcome["direction"] = thin ? "unclear"
    : gap > FLAT_BAND ? "improved"
      : gap < -FLAT_BAND ? "worsened" : "flat";
  return { direction, before, after, coverage, line: outcomeLine(direction, before, after, coverage) };
}
