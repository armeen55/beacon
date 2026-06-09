/**
 * 2026-06-09 — CallRail connector types (§9.B — close the calls loop).
 *
 * CallRail attributes each inbound call to the page the caller landed on.
 * Beacon counts QUALIFIED calls per owned URL per day so the already-built
 * Mode A outcome engine (`qualifiedCallCount` → `post_live_qualified_calls`,
 * K4 ≥1-call branch) can say "this page received N sessions and M calls
 * in the X days since you shipped this edit." Pure types; no I/O.
 */

/** One call from CallRail's list-calls endpoint (the fields we use). */
export type CallRailCall = {
  landingPageUrl: string | null;
  answered: boolean;
  durationSec: number;
  /** CallRail lead scoring: "good_lead" | "not_a_lead" | "not_scored" | null. */
  leadStatus: string | null;
  /** ISO start time (used to bucket by UTC date). */
  startTimeIso: string | null;
};

/** What counts as a "qualified" call (v1 heuristic, tunable). */
export type CallRailQualifiedRule = {
  /** A call qualifies if CallRail scored it good_lead, OR it was answered
   *  and lasted at least this many seconds. */
  minAnsweredDurationSec: number;
};

export const DEFAULT_QUALIFIED_RULE: CallRailQualifiedRule = {
  minAnsweredDurationSec: 60,
};

/** Per-(canonical URL, UTC date) qualified + total call counts. */
export type CallRailUrlDayCount = {
  /** Canonical landing URL (via canonicalizeCitationUrl). */
  url: string;
  date: string; // YYYY-MM-DD
  qualifiedCalls: number;
  totalCalls: number;
};

export type CallRailFetchFailReason =
  | "no_key"
  | "disconnected"
  | "api_error"
  | "empty";

export type CallRailFetchResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: CallRailFetchFailReason; detail?: string };
