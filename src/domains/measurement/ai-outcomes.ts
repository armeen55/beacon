import "server-only";
/**
 * ai-outcomes (V1 Truth Convergence Phase 7) - WHAT THE AI ENGINES ACTUALLY SAID ABOUT THIS ACCOUNT.
 * Every number is computed at read time from answers ALREADY bought and stored: nothing fetched, paid,
 * or written, so the summary can never drift from the answers it claims to summarize. SLOT 0 ONLY:
 * volatility samples are never trend (a question sampled three times must not outvote one read once).
 * NULL IS A CLAIM: "no answer of yours was analyzed" and "you were named in none" are different
 * statements, and a missing day stays absent, never filled from its neighbours. MODEL AND MODE
 * BOUNDARIES ARE VISIBLE: a change in either splits the series into named segments, so a step reads
 * as "the instrument changed here", never as a silent win or loss. ONE CHANGE IS READ ON ITS OWN
 * SEARCHES, and that read lives next door (shipment-ai-outcome.ts): it counts a citation through the
 * SAME `countLinks` this file's daily trend uses, so a trend and a Result can never disagree about
 * what being credited means.
 */

import { isAnalysisSettled, readAiObservations, type AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations";
import { reportingDay } from "@/lib/reporting-day";
import { addDays, readPartitioned } from "./outcome-windows";
import { citesOwnSite, retrievedNotCitedLinks } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";

const FIRST_READING_SLOT = 0; // slot 0: the ONE canonical reading of a question on a day

type ObservedLink = { url: string; domain: string; title: string | null };
type Analysis = { ownedBrandMention?: { mentioned?: unknown } | null };
/** The injectable read. Production passes nothing and gets the stored-observation reader itself. The DAY
 *  RANGE is part of the ask, so the store returns the requested stretch and nothing outside it, and so is
 *  the PROJECTION, so an outcome read never drags whole answers and retrieval journeys across the wire. */
type ReadRows = (tenantId: string, opts: { limit?: number; slot?: number; fromDay?: string; toDay?: string; day?: string; projection?: "full" | "outcome" | "overview" | "scoped" }) => Promise<AiObservationRecord[]>;
export type ReadOpts = { ownedHost?: string | null; readObservations?: ReadRows };
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

// ── small pure helpers, shared with the shipment read next door ─────────────

export const r3 = (n: number): number => Math.round(n * 1000) / 1000;
/** ONE DEFINITION OF A DAY, the operator's (src/lib/reporting-day): a UTC "today" put every instant
 *  from 5 PM Pacific on tomorrow, counting a change's own evening answers on its BEFORE side. Day
 *  LABEL arithmetic stays plain string math, which is not a day-from-instant at all. */
export const dayOfInstant = (d: Date): string => reportingDay(d);

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
export const cameBack = (r: AiObservationRecord): boolean => r.status === "observed";

const newestOf = (rows: AiObservationRecord[]): AiObservationRecord | null =>
  rows.reduce<AiObservationRecord | null>((best, r) => (!best || r.requested_at > best.requested_at ? r : best), null);

/** The account's own address, taken from the rows themselves (every observation carries the site it was
 *  read for), so nothing here has to go and ask another kernel who this account is. */
export function ownedRootOf(rows: readonly AiObservationRecord[], override?: string | null): string {
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

/** What the answers said about SOURCES, in counts. Every sample is the answers that REPORTED the thing
 *  being counted, never the answers that came back: a provider that says nothing about its sources is
 *  silent, not a miss. `rankSum`/`rankCount` carry the credited position so an average can be taken
 *  without a second pass over the same links. */
export type LinkCounts = {
  citationSample: number; ownedCiting: number; rankSum: number; rankCount: number;
  retrievalSample: number; ownedRetrieved: number; retrievedNotCited: number;
};

/** THE ONE DEFINITION OF A CITATION, counted in one place. The daily trend and one shipment's own
 *  remeasurement both call this, because two loops counting "credited" separately is exactly how a day
 *  said 31 of 47 answers credited a page while a card said the site was never cited. PURE. */
export function countLinks(rows: readonly AiObservationRecord[], root: string): LinkCounts {
  const out: LinkCounts = { citationSample: 0, ownedCiting: 0, rankSum: 0, rankCount: 0, retrievalSample: 0, ownedRetrieved: 0, retrievedNotCited: 0 };
  for (const r of rows) {
    if (!cameBack(r)) continue;
    const cited = (r.journey?.cited_sources ?? null) as ObservedLink[] | null;
    const read = (r.journey?.retrieved_results ?? null) as ObservedLink[] | null;
    if (cited !== null) {
      out.citationSample += 1;
      const at = cited.findIndex((c) => isOwned(c, root));
      if (at >= 0) { out.ownedCiting += 1; out.rankSum += at + 1; out.rankCount += 1; }
    }
    // Retrieved-but-not-cited needs BOTH halves: what the engine read AND what it credited. One without the
    // other cannot support the claim, so that answer leaves the sample rather than being guessed at. The
    // retrieval list is what the provider REPORTED READING and may hold pages it then credited, so the
    // subtraction runs through the one canonical-url derivation, never off the stored list.
    if (read !== null && cited !== null) {
      out.retrievalSample += 1;
      if (read.some((c) => isOwned(c, root))) {
        out.ownedRetrieved += 1;
        if (retrievedNotCitedLinks(read, cited).some((c) => isOwned(c, root))) out.retrievedNotCited += 1;
      }
    }
  }
  return out;
}

/** Everything one reporting day says, over its first readings only. */
function dayTotals(day: string, rows: AiObservationRecord[], root: string): OutcomeDay {
  const answered = rows.filter(cameBack);
  const analyzed = answered.filter((r) => namedIn(r) !== null);
  const mentioning = analyzed.filter((r) => namedIn(r) === true).length;
  const { citationSample, ownedCiting, rankSum, rankCount, retrievalSample, ownedRetrieved, retrievedNotCited } = countLinks(answered, root);

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
export const readRows = async (tenantId: string, window: { from: string; to: string }, opts: ReadOpts & { projection?: "outcome" | "overview" | "scoped" }): Promise<AiObservationRecord[]> =>
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
export function namedShare(rows: readonly AiObservationRecord[]): { checked: number; analyzed: number; mentioning: number; rate: number | null } {
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
