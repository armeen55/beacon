/**
 * ai-overview-gaps (2026-07-02, BEACON_500 item 20) - PURE diff over the
 * append-only dataforseo_serp_history rows (see dataforseo-serp.ts / serp-history.ts):
 * for each tracked query, does Google's AI Overview cite the tenant's own domain,
 * and how does that compare to where the tenant actually ranks organically?
 *
 * The distinct, named gap this surfaces: "you rank 3 on Google for X, but the AI
 * answer box cites someone else instead of you." That is a different failure mode
 * from a low organic rank - it can happen even when organic rank is strong, and
 * organic-rank tooling alone never sees it.
 *
 * HONESTY RULES: a query with no AI Overview at all says nothing (silence, not a
 * false negative); "cites you" requires the tenant's own domain to literally
 * appear in the parsed reference list (same domain-matching traps as
 * resolveOwnRank: schemeless urls, www, subdomains, no suffix look-alikes);
 * lost/gained transitions require two REAL observed snapshots, never inferred
 * from one point. No dashes in operator copy - hyphens only.
 */

import { rootDomain } from "./serp-provider";
import type { AiOverviewCitedDomain } from "./dataforseo-serp";

/** One history row's AI-Overview-relevant fields, as read from
 *  dataforseo_serp_history (own_rank already resolved by the writer). */
export type AiOverviewHistoryRow = {
  query: string;
  capturedAt: string;
  ownRank: number | null;
  aiOverviewPresent: boolean;
  aiOverviewDomains: AiOverviewCitedDomain[];
};

/** One query's AI Overview gap verdict, computed from its most recent snapshot. */
export type AiOverviewGapRow = {
  query: string;
  capturedAt: string;
  ownRank: number | null;
  overviewPresent: boolean;
  /** Does the overview cite the tenant's own domain? Always false when no
   *  overview rendered - never null, so callers never have to branch on absence. */
  overviewCitesYou: boolean;
  /** Domains the overview cites, tenant's own domain excluded, in cited order. */
  overviewCitedDomains: string[];
  /** True only when a real gap exists: the tenant ranks organically in the top 5
   *  AND an overview exists AND it cites someone else instead. */
  gap: boolean;
  /** One operator sentence, or null when there is nothing worth saying (no
   *  overview, or the tenant IS cited, or organic rank does not qualify). */
  sentence: string | null;
};

/** A real transition observed between two snapshots of the SAME query - never
 *  fabricated from a single point. */
export type AiOverviewTransition = {
  query: string;
  fromAt: string;
  toAt: string;
  /** "lost" = you WERE cited, now are not. "gained" = the reverse. */
  direction: "lost" | "gained";
  sentence: string;
};

/** Organic ranks at or better than this qualify for the "you rank N" framing -
 *  a rank 40 page with a citation miss is not a distinct, actionable gap. */
const QUALIFYING_RANK = 5;

const own = (domain: string, tenantDomain: string): boolean => {
  const t = rootDomain(tenantDomain) || tenantDomain.replace(/^www\./i, "").toLowerCase();
  if (!t) return false;
  const d = domain.toLowerCase();
  return d === t || d.endsWith(`.${t}`);
};

/** PURE: reduce one query's AI-Overview-relevant rows (any order, any count)
 *  down to a single gap verdict from its most recent capture. */
export function computeAiOverviewGap(rows: AiOverviewHistoryRow[], tenantDomain: string | null | undefined): AiOverviewGapRow | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const latest = sorted[sorted.length - 1];
  const domain = (tenantDomain ?? "").trim();
  const citedDomains = latest.aiOverviewPresent ? latest.aiOverviewDomains.map((d) => d.domain) : [];
  const overviewCitesYou = domain !== "" && citedDomains.some((d) => own(d, domain));
  const rivalDomains = citedDomains.filter((d) => !own(d, domain));
  const qualifies = typeof latest.ownRank === "number" && latest.ownRank <= QUALIFYING_RANK;
  const gap = latest.aiOverviewPresent && qualifies && !overviewCitesYou;

  let sentence: string | null = null;
  if (gap) {
    const rankWord = `rank ${latest.ownRank}`;
    if (rivalDomains.length > 0) {
      sentence = `You ${rankWord} on Google for ${latest.query}, but the AI answer box cites ${rivalDomains[0]} instead of you.`;
    } else {
      sentence = `You ${rankWord} on Google for ${latest.query}, but the AI answer box does not cite you.`;
    }
  }

  return {
    query: latest.query,
    capturedAt: latest.capturedAt,
    ownRank: latest.ownRank,
    overviewPresent: latest.aiOverviewPresent,
    overviewCitesYou,
    overviewCitedDomains: rivalDomains,
    gap,
    sentence,
  };
}

/** PURE: gap verdicts for every query present in the input, most-recent-first
 *  per query, sorted so the sharpest named gaps (best organic rank first) come
 *  first. Queries where nothing qualifies as a gap are still returned (silence
 *  lives in `.sentence === null` and `.gap === false`, never by disappearing). */
export function computeAiOverviewGaps(
  rowsByQuery: AiOverviewHistoryRow[],
  tenantDomain: string | null | undefined,
): AiOverviewGapRow[] {
  const grouped = new Map<string, AiOverviewHistoryRow[]>();
  for (const r of rowsByQuery) {
    const list = grouped.get(r.query) ?? [];
    list.push(r);
    grouped.set(r.query, list);
  }
  const out: AiOverviewGapRow[] = [];
  for (const rows of grouped.values()) {
    const verdict = computeAiOverviewGap(rows, tenantDomain);
    if (verdict) out.push(verdict);
  }
  return out.sort((a, b) => {
    if (a.gap !== b.gap) return a.gap ? -1 : 1;
    const ar = a.ownRank ?? Number.MAX_SAFE_INTEGER;
    const br = b.ownRank ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return a.query.localeCompare(b.query);
  });
}

/** PURE: detect real lost/gained AI Overview citation transitions across a
 *  query's full observed history. Needs at least two snapshots where an
 *  overview was present - a query that never had an overview, or only ever had
 *  one snapshot with one, has no transition to report. */
export function computeAiOverviewTransitions(
  rows: AiOverviewHistoryRow[],
  tenantDomain: string | null | undefined,
): AiOverviewTransition[] {
  const domain = (tenantDomain ?? "").trim();
  if (!domain) return [];
  const byQuery = new Map<string, AiOverviewHistoryRow[]>();
  for (const r of rows) {
    if (!r.aiOverviewPresent) continue;
    const list = byQuery.get(r.query) ?? [];
    list.push(r);
    byQuery.set(r.query, list);
  }
  const transitions: AiOverviewTransition[] = [];
  for (const [query, list] of byQuery) {
    const sorted = [...list].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevCited = prev.aiOverviewDomains.some((d) => own(d.domain, domain));
      const currCited = curr.aiOverviewDomains.some((d) => own(d.domain, domain));
      if (prevCited === currCited) continue;
      const direction: "lost" | "gained" = prevCited ? "lost" : "gained";
      const sentence =
        direction === "lost"
          ? `Google's AI answer box stopped citing you for ${query} between ${prev.capturedAt.slice(0, 10)} and ${curr.capturedAt.slice(0, 10)}.`
          : `Google's AI answer box started citing you for ${query} as of ${curr.capturedAt.slice(0, 10)}.`;
      transitions.push({ query, fromAt: prev.capturedAt, toAt: curr.capturedAt, direction, sentence });
    }
  }
  return transitions.sort((a, b) => Date.parse(b.toAt) - Date.parse(a.toAt));
}

// ---------------------------------------------------------------------------
// Operator copy (Beacon voice: first person read where applicable, concrete
// numbers, hyphens only - no em or en dashes).
// ---------------------------------------------------------------------------

/**
 * One honest headline for the Today AI band, or null when there is nothing to
 * say. Caps at 1 line + up to 2 named examples, e.g.: "Google's AI answer box
 * cites someone else on 3 searches where you rank top 5. Examples: persian
 * carpets (carpetencyclopedia.com), nowruz traditions (wikipedia.org)."
 */
export function aiOverviewGapHeadline(gaps: AiOverviewGapRow[]): string | null {
  const real = gaps.filter((g) => g.gap);
  if (real.length === 0) return null;
  const head = `Google's AI answer box cites someone else on ${real.length} search${real.length === 1 ? "" : "es"} where you rank top ${QUALIFYING_RANK}.`;
  const examples = real
    .slice(0, 2)
    .map((g) => (g.overviewCitedDomains[0] ? `${g.query} (${g.overviewCitedDomains[0]})` : g.query))
    .join(", ");
  return examples ? `${head} Examples: ${examples}.` : head;
}
