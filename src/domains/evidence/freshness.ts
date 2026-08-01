/**
 * evidence/freshness - THE freshness matrix, and the one comparison every caller makes against it.
 *
 * ONE table, because "current" used to mean seven days for a results page, a winner's body and a page of the
 * account's own alike, and those three things move at completely different speeds. It is a LEAF on purpose:
 * the provider registry, the page-extract store, the pure results-shape projection, the funnel executors and
 * Decision's coverage gates all consult the SAME table, and several of them sit on both sides of the funnel
 * boundary, so any home with imports of its own would have made a cycle and a second constant would have
 * drifted away from this one again. AI ANSWERS ARE NOT IN IT: Runtime's daily planner is the one freshness
 * authority there, because it reads the stored observations.
 */

type FreshnessKind =
  /** A results page a case in the frozen research plan is stuck on: checked DAILY, because the whole run
   *  is waiting on it and a day-old look is the difference between closing a case and carrying it. */
  | "serp_hot"
  /** Every other results page: weekly, which is how often rankings meaningfully move. */
  | "serp_cold"
  /** Search volume and difficulty: the provider reports them monthly, so buying them sooner buys nothing. */
  | "keyword_volume"
  /** A page of the account's OWN: weekly, unless something changed it underneath me (see isCurrent). */
  | "owned_page"
  /** A winning page's BODY moves far slower than its ranking: a month-old read still describes the page. */
  | "winner_extract"
  /** A dated measurement of a day that has already passed. It can never go stale: it is what happened. */
  | "historical";

const DAY_MS = 24 * 3600 * 1000;
const FRESHNESS_MS: Record<FreshnessKind, number> = {
  serp_hot: DAY_MS,
  serp_cold: 7 * DAY_MS,
  keyword_volume: 30 * DAY_MS,
  owned_page: 7 * DAY_MS,
  winner_extract: 30 * DAY_MS,
  historical: Number.POSITIVE_INFINITY,
};

/** How long an observation of this kind stays current. Also the cache lifetime of the paid call that buys
 *  it: a row the matrix still calls current must never be a row the provider registry has already expired. */
export function freshnessMsFor(kind: FreshnessKind): number {
  return FRESHNESS_MS[kind];
}

/** THE one comparison every caller makes, so nobody writes the arithmetic twice and nobody forgets that an
 *  UNDATED observation is not a current one. `bustedAt` is the moment a page's truth changed underneath me
 *  (an implementation the operator marked, or a content hash that moved): a read taken BEFORE it is worth
 *  nothing however recent, and a read taken after it is judged on the ordinary window. Pure. */
export function isCurrent(kind: FreshnessKind, observedAt: string | null | undefined, nowMs: number, bustedAt?: string | null): boolean {
  const at = observedAt ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(at)) return false;
  const bust = bustedAt ? Date.parse(bustedAt) : NaN;
  if (Number.isFinite(bust) && at < bust) return false;
  return nowMs - at <= FRESHNESS_MS[kind];
}
