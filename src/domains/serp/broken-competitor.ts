/**
 * broken-competitor (2026-07-03, BEACON_500 P9 v1 250+259) - PURE detector over
 * the append-only dataforseo_serp_history rows (see dataforseo-serp.ts /
 * serp-history.ts). It answers ONE question with $0 marginal cost, from data the
 * SERP writer already paid for and persisted: has a rival page that USED TO show
 * up on Google for a search you care about dropped off?
 *
 * THE GAP, named: the shipped feature-steal / displacement detectors react to
 * the tenant's OWN movement (you fell, someone owns your answer box). None of
 * them notice when a COMPETITOR vacates a spot - a rival page that ranked in the
 * top results for a tracked query in an earlier capture and is simply gone in
 * the latest one. That vacancy is the cleanest opening there is: the search
 * still has demand, and the page that held the spot no longer does.
 *
 * DETERMINISTIC DIFF, never inferred from absence-of-history:
 *   • A domain must have been present in the top TOP_SLOT results of at least
 *     one EARLIER capture (inside the window) and absent from the LATEST capture
 *     for that query. Two real captures minimum (like computeRankDelta) - one
 *     lone snapshot can never manufacture a "drop".
 *   • The tenant's own domain is never reported as a broken competitor.
 *   • Noise / aggregator domains (relevance-gate NOISE_DOMAINS) are skipped -
 *     a Pinterest URL cycling in and out is not an opening worth a Move.
 *   • The tenant must not already own the top slot for that query (if you are
 *     already #1 there is nothing to take).
 *
 * Empty when history has fewer than two captures for a query, when nothing
 * dropped, or when the input is empty - honest silence, byte-identical to the
 * pre-detector world. No I/O, no server-only: the caller passes already-read
 * history rows (the loader in serp-history.ts does the bounded Supabase read).
 */

import { rootDomain } from "./serp-provider";
import { isNoiseDomain } from "@/domains/evidence/relevance-gate";
import type { SerpOrganicItem } from "./dataforseo-serp";

/** One history row's broken-competitor-relevant fields, as read from
 *  dataforseo_serp_history. */
export type BrokenCompetitorHistoryRow = {
  query: string;
  capturedAt: string;
  ownRank: number | null;
  /** The ranked organic results at capture time ({ rank, domain, url }). */
  topDomains: SerpOrganicItem[];
};

/** A rival that held a top spot for a tracked query in an earlier capture and
 *  is gone from the latest one. Never fabricated - both the earlier presence and
 *  the latest absence are literal observations. */
export type BrokenCompetitorFinding = {
  query: string;
  /** The domain that dropped off. */
  domain: string;
  /** The rival's best (lowest) observed rank while it was present. */
  bestRankWhilePresent: number;
  /** The URL Google last showed for that domain (the page that vacated). */
  lastUrl: string;
  /** When we last saw that domain in the top results (before it dropped). */
  lastSeenAt: string;
  /** When we confirmed it was gone (the latest capture's timestamp). */
  droppedByAt: string;
  /** First-person, dash-clean operator sentence with the concrete facts. */
  sentence: string;
};

/** Only a drop out of THIS many top slots counts as a real vacancy. A domain
 *  sliding from rank 3 to rank 9 is a demotion, not a disappearance; we only
 *  fire when it leaves the meaningful top band entirely. Mirrors the "close
 *  enough to matter" banding the feature-steal / striking-distance detectors use. */
const TOP_SLOT = 8;

/** Windowed diff bound: only compare captures inside this many days so a rival
 *  that vanished a season ago is not surfaced as a fresh opening. */
const DEFAULT_WINDOW_DAYS = 30;

function normQuery(q: string): string {
  return q.trim().toLowerCase();
}

function ownsTopSlot(row: BrokenCompetitorHistoryRow): boolean {
  return typeof row.ownRank === "number" && row.ownRank <= TOP_SLOT;
}

/** The set of non-noise competitor domains in a capture's top slots, mapped to
 *  their best (lowest) rank + the URL Google showed. Excludes the tenant's own
 *  domain and noise/aggregator domains. */
function topCompetitors(
  row: BrokenCompetitorHistoryRow,
  ownDomain: string,
): Map<string, { rank: number; url: string }> {
  const out = new Map<string, { rank: number; url: string }>();
  for (const it of row.topDomains) {
    if (typeof it.rank !== "number" || it.rank > TOP_SLOT) continue;
    const dom = (it.domain || rootDomain(it.url)).toLowerCase();
    if (!dom || !dom.includes(".")) continue;
    if (ownDomain && (dom === ownDomain || dom.endsWith(`.${ownDomain}`))) continue;
    if (it.url && isNoiseDomain(it.url)) continue;
    const prior = out.get(dom);
    if (!prior || it.rank < prior.rank) out.set(dom, { rank: it.rank, url: it.url });
  }
  return out;
}

function buildSentence(query: string, domain: string, bestRank: number): string {
  return (
    `${domain} used to show up at #${bestRank} on Google for "${query}" and just dropped off. ` +
    `The search still has demand, so this is your opening to take that spot.`
  );
}

/**
 * PURE: reduce ONE query's captures into its broken-competitor findings. Needs
 * at least two captures inside the window with real top-slot data. Returns []
 * when nothing dropped, when the tenant owns the top slot (nothing to take),
 * or when there is only one usable capture (never inferred from a single point).
 */
export function computeBrokenCompetitorsForQuery(
  rows: BrokenCompetitorHistoryRow[],
  ownDomain: string,
  opts: { windowDays?: number; now?: Date } = {},
): BrokenCompetitorFinding[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const usable = rows
    .filter((r) => {
      const t = Date.parse(r.capturedAt);
      return Number.isFinite(t) && t >= cutoffMs && t <= now.getTime() && r.topDomains.length > 0;
    })
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  if (usable.length < 2) return [];

  const latest = usable[usable.length - 1];
  // A tenant already holding a top slot in the LATEST capture has nothing to
  // take here - the opening is only meaningful if the tenant is not already up there.
  if (ownsTopSlot(latest)) return [];

  const latestCompetitors = topCompetitors(latest, ownDomain);
  const query = latest.query;

  // For every earlier capture in the window, remember the best rank + last URL +
  // last-seen time for each competitor that WAS present. The latest capture is
  // the "now"; anything present earlier but absent now is a drop.
  const earlierPresence = new Map<string, { bestRank: number; lastUrl: string; lastSeenAt: string }>();
  for (let i = 0; i < usable.length - 1; i += 1) {
    const comps = topCompetitors(usable[i], ownDomain);
    for (const [dom, info] of comps) {
      const prior = earlierPresence.get(dom);
      // Track the best (lowest) rank ever held + the MOST RECENT url/timestamp
      // (later earlier-captures overwrite the last-seen fields).
      const bestRank = prior ? Math.min(prior.bestRank, info.rank) : info.rank;
      earlierPresence.set(dom, { bestRank, lastUrl: info.url, lastSeenAt: usable[i].capturedAt });
    }
  }

  const out: BrokenCompetitorFinding[] = [];
  for (const [dom, presence] of earlierPresence) {
    if (latestCompetitors.has(dom)) continue; // still present - not a drop
    out.push({
      query,
      domain: dom,
      bestRankWhilePresent: presence.bestRank,
      lastUrl: presence.lastUrl,
      lastSeenAt: presence.lastSeenAt,
      droppedByAt: latest.capturedAt,
      sentence: buildSentence(query, dom, presence.bestRank),
    });
  }
  // The rival that held the highest spot (lowest rank number) is the biggest
  // opening - surface it first.
  return out.sort((a, b) => a.bestRankWhilePresent - b.bestRankWhilePresent || a.domain.localeCompare(b.domain));
}

/**
 * PURE: broken-competitor findings across every query in the input. Groups rows
 * by normalized query, diffs each query's captures, and returns the openings
 * ranked by the vacated spot's strength (a rival that held #1 first, then #2,
 * ...). Empty when nothing dropped anywhere.
 */
export function computeBrokenCompetitors(
  rows: BrokenCompetitorHistoryRow[],
  ownDomain: string | null | undefined,
  opts: { windowDays?: number; now?: Date } = {},
): BrokenCompetitorFinding[] {
  const own = rootDomain((ownDomain ?? "").trim());
  const byQuery = new Map<string, BrokenCompetitorHistoryRow[]>();
  for (const r of rows) {
    const key = normQuery(r.query);
    if (!key) continue;
    const list = byQuery.get(key) ?? [];
    list.push(r);
    byQuery.set(key, list);
  }
  const out: BrokenCompetitorFinding[] = [];
  for (const list of byQuery.values()) {
    out.push(...computeBrokenCompetitorsForQuery(list, own, opts));
  }
  return out.sort((a, b) => a.bestRankWhilePresent - b.bestRankWhilePresent || a.query.localeCompare(b.query));
}

/** At most this many broken-competitor openings reach the plan per night - the
 *  same bounded-hint precedent as feature-steal (MAX_FEATURE_STEAL_HINTS_PER_NIGHT)
 *  and displacement-check (DEFAULT_MAX_CANDIDATES), so one busy week never floods. */
export const MAX_BROKEN_COMPETITOR_CANDIDATES = 3;
