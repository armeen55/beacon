import "server-only";

/**
 * rank-recheck (2026-07-02, BEACON_500 item 19) - the third proof lane, alongside
 * trafficOutcome (GA4) and citationOutcome (AI mentions): a REAL live-SERP re-check
 * at each due 7/14/28-day proof window, so a win can say "Google moved us 9 to 4"
 * instead of leaning on GSC's blended average position alone.
 *
 * Built on item 17 (dataforseo_serp_history, resolveOwnRank, serp-history.ts
 * readers) and item 17's daily-card sentence builder (buildRankMovementSentence).
 * This module is the proof-ledger side: it decides WHEN a re-check is worth
 * spending on, fires ONE cache-busted runSerpQuery, and turns the was/now pair
 * into the same honest sentence shape the daily card already uses.
 *
 * Cost + safety posture (mirrors traffic-outcome / citation-outcome):
 *   - computed-only. NEVER mutates windows/verdicts/baseline - the GSC verdict
 *     path is untouchable by anything in this file.
 *   - fail-soft everywhere: a SERP failure, a missing query, a disabled connector,
 *     a dry run - all resolve to null, never an error thrown into the measure pass.
 *   - idempotent per (change, window) using the append-only serp history table
 *     ITSELF as the marker: a window only re-checks when history has no captured
 *     row on/after that window's check date yet. No new table, no new column.
 *   - bounded per pass by the caller (auto-measure.ts), not this module - kept
 *     here as a documented constant so the two stay in lockstep.
 */

import { rankSeriesFor, type SerpRankPoint } from "@/domains/serp/serp-history";
import { runSerpQuery, resolveOwnRank } from "@/domains/serp/dataforseo-serp";
import { proofCheckDates, type ProofWindowDay } from "./measure";
import type { ShippedChangeRecord } from "./shipped-change-store";

/** Bounded re-checks per measure pass (constant the caller enforces). Kept next
 *  to the logic it bounds so both never drift apart. */
export const MAX_RANK_RECHECKS_PER_PASS = 8;

/** A "was rank X, is now rank Y" read for one shipped change at one proof window.
 *  Computed-only - never persisted as a column; the caller may cache it in memory
 *  for one render, exactly like trafficOutcome/citationOutcome. */
export type RankRecheckResult = {
  window: ProofWindowDay;
  query: string;
  wasRank: number;
  wasAt: string;
  nowRank: number | null;
  nowAt: string;
  /** Positive = moved up (lower rank number), negative = moved down, null = one side unknown. */
  delta: number | null;
  /** "Google moved this page 9 to 4 for 'persian singers' since the change." Null
   *  when there is nothing honest to say (e.g. the page fell out of the results). */
  sentence: string | null;
};

/**
 * The query this shipped change is judged against for a rank re-check. Pure -
 * inspects only the record's own fields, in the order GSC itself would pick a
 * "the" query for this page: the first tracked target query. Returns null when
 * the record has no target query (informational-only changes, e.g. a schema-only
 * ship with no single ranking query) - honest skip, not a fabricated guess.
 */
export function resolveTargetQuery(change: Pick<ShippedChangeRecord, "targetQueries">): string | null {
  const q = (change.targetQueries ?? []).find((raw) => (raw ?? "").trim().length > 0);
  return q ? q.trim() : null;
}

/** The earliest observed history point within `withinDays` of `shipDate`, or null.
 *  This is the "was" side of the re-check: the rank Google showed at or shortly
 *  after ship, before any measurement-time re-check. Pure. */
export function pickWasRank(
  points: SerpRankPoint[],
  shipDate: string,
  withinDays: number = 3,
): { rank: number; capturedAt: string } | null {
  const shipMs = Date.parse(`${shipDate}T00:00:00Z`);
  if (!Number.isFinite(shipMs)) return null;
  const cutoffMs = shipMs + withinDays * 86_400_000;
  const usable = points
    .filter((p) => typeof p.ownRank === "number" && Date.parse(p.capturedAt) <= cutoffMs)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  if (usable.length === 0) return null;
  const first = usable[0];
  return { rank: first.ownRank as number, capturedAt: first.capturedAt };
}

/**
 * Has this (change, window) already had its live-SERP re-check? Idempotency
 * check reusing the append-only history table as the marker (item 17's writer),
 * so no new store/column is needed: a window is "done" once history holds a
 * captured row for this query on/after that window's check date.
 */
export function windowAlreadyRechecked(points: SerpRankPoint[], checkOn: string): boolean {
  const checkMs = Date.parse(`${checkOn}T00:00:00Z`);
  if (!Number.isFinite(checkMs)) return false;
  return points.some((p) => Date.parse(p.capturedAt) >= checkMs);
}

/** Which of a change's due proof windows still needs a live-SERP re-check right
 *  now. PURE - takes the already-loaded history points so callers can share one
 *  read across every window of a change. `dueWindows` = the windows the GSC pass
 *  just judged (window.ran) OR is about to judge this run; we only ever re-check
 *  a window whose calendar date has arrived. */
export function nextRecheckableWindow(
  change: Pick<ShippedChangeRecord, "shippedAt" | "windows">,
  points: SerpRankPoint[],
  now: Date = new Date(),
): ProofWindowDay | null {
  const checks = proofCheckDates(change.shippedAt);
  const today = now.toISOString().slice(0, 10);
  const windows: ProofWindowDay[] = [7, 14, 28];
  for (const day of windows) {
    const checkOn = checks[day];
    if (today < checkOn) continue; // window not open yet
    if (windowAlreadyRechecked(points, checkOn)) continue; // already re-checked, never twice
    return day;
  }
  return null;
}

export type RunRankRecheckDeps = {
  now: () => Date;
  /** Injectable so tests never spend / never hit Supabase. Defaults to the real
   *  cache-first-but-force-fresh SERP runner + the real history reader. */
  fetchSeries: (tenantId: string, query: string) => Promise<SerpRankPoint[]>;
  fetchFresh: (
    query: string,
  ) => Promise<{ status: string; snapshot: { results: Array<{ rank: number; domain: string; url: string }> } | null }>;
  tenantDomain: () => Promise<string | null>;
};

async function defaultTenantDomain(): Promise<string | null> {
  try {
    const { currentTenant } = await import("@/lib/tenant-context");
    return (await currentTenant()).domain ?? null;
  } catch {
    return null;
  }
}

const defaultDeps: RunRankRecheckDeps = {
  now: () => new Date(),
  fetchSeries: rankSeriesFor,
  fetchFresh: (query) => runSerpQuery(query, { forceFresh: true }),
  tenantDomain: defaultTenantDomain,
};

/**
 * Fire ONE cache-busted live-SERP re-check for a shipped change's due window.
 * Fail-soft end to end: any missing query, disabled connector, dry run, or fetch
 * failure resolves to null - never throws, never blocks the caller's GSC verdict.
 *
 * "was" comes from serp-history (the earliest observed row within 3 days of
 * ship - the backfilled/live cache row item 17 already banked); "now" comes from
 * THIS fresh, cache-busted read, which item 17's writer durably banks as a new
 * history row the moment it lands (so the next call's idempotency check sees it).
 */
export async function runRankRecheck(
  tenantId: string,
  change: Pick<ShippedChangeRecord, "shippedAt" | "targetQueries" | "windows">,
  window: ProofWindowDay,
  depsOverride: Partial<RunRankRecheckDeps> = {},
): Promise<RankRecheckResult | null> {
  const deps = { ...defaultDeps, ...depsOverride };
  const query = resolveTargetQuery(change);
  if (!query) return null;

  const shipDate = change.shippedAt.length > 10 ? change.shippedAt.slice(0, 10) : change.shippedAt;

  let points: SerpRankPoint[];
  try {
    points = await deps.fetchSeries(tenantId, query);
  } catch {
    points = [];
  }

  const was = pickWasRank(points, shipDate);
  if (!was) return null; // no honest "was" side - stay silent rather than guess

  const checkOn = proofCheckDates(change.shippedAt)[window];
  if (windowAlreadyRechecked(points, checkOn)) return null; // idempotent - never twice

  let fresh: Awaited<ReturnType<RunRankRecheckDeps["fetchFresh"]>>;
  try {
    fresh = await deps.fetchFresh(query);
  } catch {
    return null;
  }
  if (fresh.status !== "ok" || !fresh.snapshot) return null;

  let ownDomain: string | null;
  try {
    ownDomain = await deps.tenantDomain();
  } catch {
    ownDomain = null;
  }
  const own = resolveOwnRank(fresh.snapshot.results, ownDomain);
  const nowAt = deps.now().toISOString();
  const nowRank = own.ownRank;

  const delta = nowRank != null ? was.rank - nowRank : null; // positive = moved up
  const sentence = buildSentence(query, was.rank, nowRank);

  return {
    window,
    query,
    wasRank: was.rank,
    wasAt: was.capturedAt,
    nowRank,
    nowAt,
    delta,
    sentence,
  };
}

/**
 * "Google moved this page 9 to 4 for 'persian singers' since the change." Same
 * literal-numbers-only honesty as buildRankMovementSentence (item 17), adapted
 * for the proof row: the query is named (a proof row lists many changes, unlike
 * the daily card which is already scoped to one page+query pair) and no
 * re-derived date (the row already shows the ship date elsewhere). Null when the
 * page fell out of the tracked results (nowRank unknown) - honest silence rather
 * than a fabricated "gone" claim.
 */
function buildSentence(query: string, wasRank: number, nowRank: number | null): string | null {
  if (nowRank == null) return null;
  if (wasRank === nowRank) {
    return `Google has held this page at spot ${nowRank} for "${query}" since the change.`;
  }
  return `Google moved this page ${wasRank} to ${nowRank} for "${query}" since the change.`;
}
