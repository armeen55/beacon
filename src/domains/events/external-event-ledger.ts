/**
 * external-event-ledger (BEACON_500 N32, 2026-07-03) - the honest-context layer.
 *
 * ONE ledger of the things that move rankings for reasons that have nothing to
 * do with a single page edit, auto-detected from signals Beacon already has:
 *
 *   - google_update    : a confirmed Google update or a detected sitewide
 *                        traffic shock. REUSES algorithm-weather.ts's shock
 *                        windows verbatim - this module does NO shock detection
 *                        of its own and never double-counts a shock the weather
 *                        guard already surfaces (see the dedupe note below).
 *   - traffic_shock    : the SAME sitewide CUSUM shift, kept as a distinct kind
 *                        only when it is NOT a confirmed Google update (a
 *                        confirmed update is the more specific explanation and
 *                        wins). This is exactly algorithm-weather's "suspected"
 *                        window; we relabel it in plain words here.
 *   - connector_outage : the nightly data machinery stalled (deadman.ts's
 *                        stalled jobs / site-down probe). A measurement window
 *                        that overlapped an outage was reading stale numbers.
 *   - own_site_change  : a CLUSTER of the operator's own shipped changes landed
 *                        on one day (shipped_change_proof rows). Many edits on
 *                        one day move the whole site at once, so a single page's
 *                        read taken across that day carries the compound caveat.
 *
 * DESIGN: this file is PURE. No I/O, no clock (the caller passes `now` only
 * where a recency floor is needed, and even that is optional). The nightly step
 * (cron-sync.ts) loads the four already-computed inputs - shock windows from
 * algorithm-weather, the deadman verdict, the tenant's shipped ledger, and the
 * daily totals series it already read for the weather pass - hands them to
 * buildExternalEventLedger, and persists the result via external-event-store.ts.
 * Every reader (the Results page, a change card) then calls
 * overlappingExternalEvent per measurement window at $0.
 *
 * DEDUPE VS WEATHER (the load-bearing honesty rule): the algorithm-weather
 * caveat already fires on /results for any window overlapping a shock. This
 * ledger records the SAME shock as a `google_update`/`traffic_shock` entry so
 * the ledger is a complete picture, but the surfacing adapter
 * (eventCaveatForWindow) is built to be COMBINED with the weather caveat, not
 * stacked on top of it: when a window overlaps a shock, the weather guard owns
 * the sentence (we reuse weatherCaveatSentence verbatim), and this ledger only
 * ADDS a sentence for the kinds weather does NOT cover (connector outages,
 * own-site change clusters). A caller that shows both never renders two
 * sentences for the same shock. N10 (verdict-reliability) already takes the
 * shock as its `weatherQuarantined` input, so this ledger feeds N10 nothing new
 * for shocks - it only adds the two NON-shock kinds as fresh reliability inputs
 * the caller may pass through (see eventReliabilityFlagsForWindow).
 *
 * Pinned by external-event-ledger.test.ts.
 */

import { overlappingShock, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import type { DailyPoint } from "@/domains/proof-gsc/changepoint";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type ExternalEventKind =
  | "google_update"
  | "traffic_shock"
  | "connector_outage"
  | "own_site_change";

/** How wide the event's blast radius is - a caveat surface can rank a sitewide
 *  event above a single-page one. `sitewide` = the whole site moved;
 *  `machinery` = Beacon's own data pipeline (a measurement was reading stale
 *  numbers, not that the site moved). */
export type ExternalEventScope = "sitewide" | "machinery";

/** How sure we are the event is real. `confirmed` = a Google-published update
 *  or a stalled-job receipt we can point at. `detected` = our own CUSUM /
 *  cluster heuristic found it. Mirrors ShockWindow.kind's confirmed/suspected
 *  split so the two vocabularies line up. */
export type ExternalEventConfidence = "confirmed" | "detected";

export type ExternalEventEntry = {
  /** Deterministic from its inputs, so re-running the nightly pass over the
   *  same data yields the same id (idempotent latest-wins persistence). */
  id: string;
  kind: ExternalEventKind;
  scope: ExternalEventScope;
  /** Event span, inclusive, YYYY-MM-DD. A single-day event has start === end. */
  start: string;
  end: string;
  /** First-person plain sentence, no dashes, no lab jargon. */
  plainDescription: string;
  confidence: ExternalEventConfidence;
};

// ---------------------------------------------------------------------------
// Small pure helpers (leaf-level, matching the sibling-module convention of
// keeping a local copy rather than importing across domains)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const dateOnly = (iso: string): string => (iso || "").slice(0, 10);
const toMs = (iso: string): number => Date.parse(`${dateOnly(iso)}T00:00:00Z`);

function fmtDay(iso: string): string {
  const d = new Date(`${dateOnly(iso)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return dateOnly(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Inclusive overlap of two [start, end] YYYY-MM-DD ranges. */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMs(aStart) <= toMs(bEnd) && toMs(bStart) <= toMs(aEnd);
}

// ---------------------------------------------------------------------------
// Detectors (each maps ONE already-computed input into ledger entries; none
// re-derives detection logic that lives elsewhere)
// ---------------------------------------------------------------------------

/** google_update + traffic_shock: reuse algorithm-weather's shock windows
 *  VERBATIM. A confirmed window becomes a `google_update`; a suspected window
 *  becomes a `traffic_shock`. This function does NO detection - it only
 *  relabels the weather guard's own output into ledger entries so the ledger
 *  is complete, and it dedupes so a suspected shock whose window is fully
 *  contained in a confirmed one is dropped (the confirmed update is the more
 *  specific explanation). PURE. */
export function shockEntriesFromWeather(
  shocks: ReadonlyArray<ShockWindow>,
): ExternalEventEntry[] {
  const confirmed = shocks.filter((s) => s.kind === "confirmed");
  const entries: ExternalEventEntry[] = [];
  for (const s of shocks) {
    const start = dateOnly(s.start);
    const end = dateOnly(s.end);
    if (s.kind === "suspected") {
      // Dedupe: a suspected shock whose window overlaps ANY confirmed update is
      // the same event seen two ways - the confirmed one wins, we drop the
      // suspected duplicate so the ledger never lists the same movement twice.
      const coveredByConfirmed = confirmed.some((c) =>
        rangesOverlap(start, end, dateOnly(c.start), dateOnly(c.end)),
      );
      if (coveredByConfirmed) continue;
      entries.push({
        id: `evt-traffic-${start}`,
        kind: "traffic_shock",
        scope: "sitewide",
        start,
        end,
        plainDescription: `The whole site's traffic shifted around ${fmtDay(start)} for a reason I could not tie to any one change I made.`,
        confidence: "detected",
      });
    } else {
      entries.push({
        id: `evt-google-${start}`,
        kind: "google_update",
        scope: "sitewide",
        start,
        end,
        plainDescription: `${s.label} landed around ${fmtDay(start)}, which can move the whole site's rankings at once.`,
        confidence: "confirmed",
      });
    }
  }
  return entries;
}

/** One stalled/late job or a site-down reading, reduced to what the outage
 *  detector needs. Mirrors deadman.ts's JobPace / SiteProbeReading so the
 *  caller passes the deadman verdict straight through with a one-line map. */
export type OutageSignal = {
  /** The plain subject sentence deadman already composed, or a fallback. */
  label: string;
  /** ISO of the last successful run before the gap (window start). Null when
   *  the job never ran - such a signal contributes no dated window (we can't
   *  caveat a measurement against an outage with no known dates). */
  lastRunAt: string | null;
  /** ISO of the reference "now" when the outage was observed (window end). */
  observedAt: string;
  /** stalled jobs and a down site are real outages; a merely "late" job is
   *  weather, not a fire - the caller filters to stalled/down before mapping. */
  severe: boolean;
};

/** connector_outage: a stalled data job or a down site means any measurement
 *  window overlapping [lastRunAt, observedAt] was reading numbers that stopped
 *  updating. Only `severe` signals with a known lastRunAt produce an entry -
 *  an outage with no start date can't be overlapped against a window honestly,
 *  so it is silently skipped rather than fabricated. PURE. */
export function outageEntries(signals: ReadonlyArray<OutageSignal>): ExternalEventEntry[] {
  const entries: ExternalEventEntry[] = [];
  for (const sig of signals) {
    if (!sig.severe || !sig.lastRunAt) continue;
    const start = dateOnly(sig.lastRunAt);
    const end = dateOnly(sig.observedAt);
    if (!start || !end || toMs(start) > toMs(end)) continue;
    entries.push({
      id: `evt-outage-${start}-${end}`,
      kind: "connector_outage",
      scope: "machinery",
      start,
      end,
      plainDescription: `My data pipeline stalled between ${fmtDay(start)} and ${fmtDay(end)}, so any result measured in that stretch was reading numbers that had stopped updating.`,
      confidence: "confirmed",
    });
  }
  return entries;
}

/** One shipped change, reduced to its ship day. Mirrors
 *  ShippedChangeRecord.{path, shippedAt} so the caller passes the ledger
 *  straight through. */
export type ShippedChangeDay = { path: string; shippedAt: string };

/** How many DISTINCT pages must be shipped on ONE day before it counts as a
 *  site-moving cluster. A single edit is a page_level change (the proof ledger
 *  already attributes it); two-plus distinct pages on one day is the "many
 *  edits at once" pattern that muddies any single page's read taken across that
 *  day. Documented, not tunable by a caller. */
export const MIN_PAGES_FOR_OWN_SITE_CLUSTER = 2;

/** own_site_change: a day on which the operator shipped changes to
 *  MIN_PAGES_FOR_OWN_SITE_CLUSTER or more DISTINCT pages. Counts distinct
 *  pages, never raw row count, so five metadata tweaks to one page never trip
 *  the cluster (that is a single page_level event the ledger already owns). A
 *  cluster is a single-day event (start === end). PURE. */
export function ownSiteClusterEntries(
  changes: ReadonlyArray<ShippedChangeDay>,
): ExternalEventEntry[] {
  const pagesByDay = new Map<string, Set<string>>();
  for (const c of changes) {
    const day = dateOnly(c.shippedAt);
    if (!day) continue;
    const set = pagesByDay.get(day) ?? new Set<string>();
    set.add(c.path || "");
    pagesByDay.set(day, set);
  }
  const entries: ExternalEventEntry[] = [];
  for (const [day, pages] of pagesByDay) {
    if (pages.size < MIN_PAGES_FOR_OWN_SITE_CLUSTER) continue;
    entries.push({
      id: `evt-ownsite-${day}`,
      kind: "own_site_change",
      scope: "sitewide",
      start: day,
      end: day,
      plainDescription: `I shipped changes to ${pages.size} pages on ${fmtDay(day)}, so a result measured across that day mixes several changes together.`,
      confidence: "confirmed",
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Rank order for a stable, meaningful sort: newest first, and within a day the
 *  most specific/confident kind first. */
const KIND_RANK: Record<ExternalEventKind, number> = {
  google_update: 0,
  traffic_shock: 1,
  connector_outage: 2,
  own_site_change: 3,
};

export type BuildExternalEventLedgerInput = {
  /** Shock windows already computed by algorithm-weather.ts's buildShockWindows
   *  (confirmed Google updates + detected sitewide CUSUM shifts). Optional -
   *  omitted yields no shock entries. This module NEVER runs the detector. */
  shockWindows?: ReadonlyArray<ShockWindow>;
  /** Severe outage signals reduced from deadman.ts's verdict. Optional. */
  outageSignals?: ReadonlyArray<OutageSignal>;
  /** The tenant's shipped changes, reduced to (path, shippedAt). Optional. */
  shippedChanges?: ReadonlyArray<ShippedChangeDay>;
  /** Present for symmetry / future kinds; unused today. Keeping the daily
   *  series in the input shape means a future own-site or shock kind that
   *  needs the raw series does not change the signature. */
  dailySeries?: ReadonlyArray<DailyPoint>;
};

/**
 * Merge every detector's entries into ONE ledger, deduped by id (a later entry
 * with the same id wins - detectors never collide today, but the dedupe makes
 * re-running idempotent) and sorted newest-first, then most-specific-kind
 * first within a day. PURE.
 */
export function buildExternalEventLedger(
  input: BuildExternalEventLedgerInput,
): ExternalEventEntry[] {
  const all = [
    ...shockEntriesFromWeather(input.shockWindows ?? []),
    ...outageEntries(input.outageSignals ?? []),
    ...ownSiteClusterEntries(input.shippedChanges ?? []),
  ];
  const byId = new Map<string, ExternalEventEntry>();
  for (const e of all) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => {
    if (a.start !== b.start) return b.start.localeCompare(a.start);
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });
}

// ---------------------------------------------------------------------------
// Overlap read (the $0 per-window surface, mirroring overlappingShock)
// ---------------------------------------------------------------------------

/** Does a measurement window [start, end] overlap ANY ledger event? Returns the
 *  first (by the ledger's own newest-first / most-specific-kind order) or null.
 *  PURE - the caller supplies the window's own dates. */
export function overlappingExternalEvent(
  windowStart: string,
  windowEnd: string,
  events: ReadonlyArray<ExternalEventEntry>,
): ExternalEventEntry | null {
  if (!windowStart || !windowEnd) return null;
  const hit = events.find((e) => rangesOverlap(windowStart, windowEnd, e.start, e.end));
  return hit ?? null;
}

/**
 * The honest caveat sentence for a measurement window, DEDUPED against the
 * weather guard. This is the ONE function a /results row or change card calls.
 *
 * Rule (the load-bearing dedupe): if the window overlaps an algorithm-weather
 * shock, the WEATHER guard owns the sentence - we reuse weatherCaveatSentence
 * verbatim (identical wording to what /results already renders) and never add a
 * second sentence for the same shock. Only when the window overlaps a NON-shock
 * ledger event (a connector outage or an own-site change cluster) do we return
 * this ledger's own plainDescription. Returns null when nothing overlaps (the
 * caller renders no caveat - absence already says "clean").
 *
 * Because google_update/traffic_shock entries are dropped here in favor of the
 * weather sentence, a caller that renders BOTH the weather caveat AND this one
 * never shows two sentences for the same event.
 */
export function eventCaveatForWindow(args: {
  windowStart: string;
  windowEnd: string;
  events: ReadonlyArray<ExternalEventEntry>;
  /** The shock windows the weather guard already checks - when the window
   *  overlaps one of these, the weather sentence wins (dedupe). Pass the SAME
   *  list you passed to buildExternalEventLedger. */
  shockWindows?: ReadonlyArray<ShockWindow>;
  /** The exact weather caveat sentence for the overlapping shock, when the
   *  caller has it (from algorithm-weather.ts's weatherCaveatSentence). Passing
   *  it keeps the two surfaces byte-identical; omitting it falls back to the
   *  ledger's own shock description so this function never returns an empty
   *  caveat for a real shock. */
  weatherSentence?: string | null;
}): string | null {
  const shock = overlappingShock(args.windowStart, args.windowEnd, args.shockWindows ?? []);
  if (shock) {
    // Weather owns it - reuse the caller's exact weather sentence when given,
    // else the ledger's matching shock description (still one sentence, never two).
    if (args.weatherSentence) return args.weatherSentence;
    const shockEntry = overlappingExternalEvent(args.windowStart, args.windowEnd, args.events);
    return shockEntry ? shockEntry.plainDescription : null;
  }
  // No shock: surface only the NON-shock kinds (outage / own-site cluster).
  const nonShock = args.events.filter(
    (e) => e.kind === "connector_outage" || e.kind === "own_site_change",
  );
  const hit = overlappingExternalEvent(args.windowStart, args.windowEnd, nonShock);
  return hit ? hit.plainDescription : null;
}

/**
 * Reliability inputs a window's ledger overlap contributes to N10
 * (verdict-reliability.ts), WITHOUT double-counting the shock. The shock is
 * already N10's `weatherQuarantined` input, so this returns it as
 * `weatherQuarantined` only for symmetry / a caller that has not wired the
 * weather flag directly, and returns the two NON-shock kinds as a single
 * `machineryOrCompoundFlagged` bit the caller can OR into an existing
 * integrity flag. PURE. A window with no overlap yields all-false (byte-
 * identical to not calling this at all).
 */
export function eventReliabilityFlagsForWindow(args: {
  windowStart: string;
  windowEnd: string;
  events: ReadonlyArray<ExternalEventEntry>;
}): { weatherQuarantined: boolean; machineryOrCompoundFlagged: boolean } {
  const hit = overlappingExternalEvent(args.windowStart, args.windowEnd, args.events);
  if (!hit) return { weatherQuarantined: false, machineryOrCompoundFlagged: false };
  const isShock = hit.kind === "google_update" || hit.kind === "traffic_shock";
  return {
    weatherQuarantined: isShock,
    machineryOrCompoundFlagged: !isShock,
  };
}
