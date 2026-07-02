/**
 * keyword-gaps (2026-07-02, master plan item 16) - PURE math for the competitor
 * keyword gap engine. Beacon already knows WHO wins (winning domains, teardown
 * targets); this module turns the DataForSEO Labs portfolio rows (ranked_keywords +
 * domain_intersection, fetched by dataforseo-labs.ts through the money gauntlet)
 * into an honest, ranked list of keywords a competitor wins that the tenant does
 * not, each with a named-evidence sentence ("supplehomes.com ranks 3 on Google for
 * X, about 1,900 searches a month").
 *
 * Rules enforced here, deterministically:
 *   - drop keywords the tenant already ranks top 10 for (GSC-known positions win)
 *   - drop competitor-brand and own-brand keywords (not winnable gaps)
 *   - dedupe across competitors (best rank wins, others named in alsoWonBy)
 *   - rank by volume x winnability (a keyword a peer holds at rank 3 is more
 *     winnable proof than one they barely hold at 40)
 *
 * No I/O, no server-only. Unit-tested in keyword-gaps.test.ts.
 */

import { isNoiseDomain, domainOf } from "@/domains/evidence/relevance-gate";
import { computeWinnability } from "./winnability";

/** Lean row shape both Labs parsers normalize to (dataforseo-labs.ts). */
export type KeywordGapRow = {
  keyword: string;
  /** Monthly search volume, or null when DataForSEO reports none (never guessed). */
  volume: number | null;
  competitorDomain: string;
  /** The competitor's Google rank for this keyword (rank_group). */
  competitorRank: number;
  /** The tenant's rank when the endpoint reports one, else null (unknown/absent). */
  ownRank: number | null;
  cpcUsd?: number | null;
  source: "ranked_keywords" | "domain_intersection";
  /** The competitor's actual ranking URL for this keyword, when the endpoint reports
   *  one (item 60's money-page aggregation groups by this). Null when absent. */
  rankingUrl?: string | null;
};

/** A GSC-known query for the tenant (impression-weighted position when known). */
export type OwnedQuery = { query: string; position: number | null };

export type KeywordGap = {
  keyword: string;
  volume: number | null;
  cpcUsd: number | null;
  competitorDomain: string;
  competitorRank: number;
  /** Best known tenant rank (Labs or GSC), null = we cannot see the tenant ranking. */
  ownRank: number | null;
  /** Other checked competitors that also rank top 20 for this keyword. */
  alsoWonBy: string[];
  /** volume x winnability - the sort key (0 when volume is unknown). */
  score: number;
  /** Named-evidence sentence, operator-facing (first person, no dashes). */
  evidence: string;
  /** Item 60: item 18's computeWinnability verdict for this gap's keyword, from
   *  CACHED Google keyword-difficulty reads only ($0 - no fresh Labs call fires
   *  just to label a gap). Null until some past verdict run cached a difficulty
   *  score for this exact keyword - an unlabeled gap is NOT the same as reject. */
  winnability?: { score: number; band: "winnable" | "hard" | "reject"; sentence: string } | null;
};

const normKeyword = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** First label of a domain ("supplehomes" from supplehomes.com) - only meaningful
 *  as a brand filter when it is long enough to not be a generic word. */
function brandToken(domain: string): string | null {
  const t = (domain.split(".")[0] ?? "").toLowerCase();
  return t.length >= 4 ? t : null;
}

/** Winnability: a keyword a peer content site holds near the top is PROVEN winnable
 *  by a site like the tenant's; one they barely hold is weaker proof. */
export function winnability(competitorRank: number): number {
  if (competitorRank <= 3) return 1;
  if (competitorRank <= 10) return 0.85;
  if (competitorRank <= 20) return 0.6;
  return 0.35;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

/** The named-evidence sentence for one gap. First person, concrete numbers,
 *  no em or en dashes, no lab words. */
export function gapEvidenceSentence(g: {
  keyword: string;
  volume: number | null;
  competitorDomain: string;
  competitorRank: number;
  ownRank: number | null;
}): string {
  const who = `${g.competitorDomain} ranks ${g.competitorRank} on Google for "${g.keyword}"`;
  const demand =
    g.volume != null && g.volume > 0
      ? `and people search it about ${fmt(g.volume)} times a month.`
      : `but Google does not report a monthly search number for it.`;
  const you =
    g.ownRank != null
      ? `You sit at ${g.ownRank} today, so there is room to climb.`
      : `You do not show up for it yet.`;
  return `${who} ${demand} ${you}`;
}

/**
 * Merge + filter + dedupe + rank the raw Labs rows into the final gap list. PURE.
 *
 * @param rows          parsed Labs rows (both endpoints, all competitors)
 * @param ownedQueries  GSC-known queries with positions - the "already ranks" join
 * @param ownDomain     the tenant's domain (for the own-brand keyword filter)
 * @param max           output cap (default 100)
 */
export function computeKeywordGaps(input: {
  rows: KeywordGapRow[];
  ownedQueries?: OwnedQuery[];
  ownDomain?: string;
  max?: number;
}): KeywordGap[] {
  const max = input.max ?? 100;
  const ownBrand = input.ownDomain ? brandToken(input.ownDomain) : null;

  // GSC join: best (lowest) known position per normalized query.
  const gscPos = new Map<string, number>();
  for (const q of input.ownedQueries ?? []) {
    if (q.position == null || !(q.position > 0)) continue;
    const k = normKeyword(q.query);
    if (!k) continue;
    const prev = gscPos.get(k);
    if (prev == null || q.position < prev) gscPos.set(k, q.position);
  }

  type Acc = {
    keyword: string;
    volume: number | null;
    cpcUsd: number | null;
    competitorDomain: string;
    competitorRank: number;
    ownRank: number | null;
    alsoWonBy: Set<string>;
  };
  const byKeyword = new Map<string, Acc>();

  for (const row of input.rows) {
    const keyword = normKeyword(row.keyword);
    if (keyword.length < 3) continue; // junk fragment
    const rank = row.competitorRank;
    if (!Number.isFinite(rank) || rank < 1 || rank > 100) continue;

    // Brand keywords are not winnable gaps (theirs or ours).
    const compBrand = brandToken(row.competitorDomain);
    if (compBrand && keyword.includes(compBrand)) continue;
    if (ownBrand && keyword.includes(ownBrand)) continue;

    // "Already ranks" join: the intersection endpoint's own rank when reported,
    // else the GSC impression-weighted position. Top 10 = not a gap, drop.
    const gsc = gscPos.get(keyword);
    const ownRank = row.ownRank ?? (gsc != null ? Math.round(gsc) : null);
    if (ownRank != null && ownRank <= 10) continue;

    const prev = byKeyword.get(keyword);
    if (!prev) {
      byKeyword.set(keyword, {
        keyword,
        volume: row.volume,
        cpcUsd: row.cpcUsd ?? null,
        competitorDomain: row.competitorDomain,
        competitorRank: rank,
        ownRank,
        alsoWonBy: new Set(),
      });
      continue;
    }
    // Dedupe: the best (lowest) competitor rank represents the gap; other
    // competitors get named in alsoWonBy. Never lose a known volume/ownRank.
    if (row.competitorDomain !== prev.competitorDomain) {
      if (rank < prev.competitorRank) {
        prev.alsoWonBy.add(prev.competitorDomain);
        prev.competitorDomain = row.competitorDomain;
        prev.competitorRank = rank;
      } else {
        prev.alsoWonBy.add(row.competitorDomain);
      }
    } else if (rank < prev.competitorRank) {
      prev.competitorRank = rank;
    }
    if (prev.volume == null && row.volume != null) prev.volume = row.volume;
    if (prev.cpcUsd == null && row.cpcUsd != null) prev.cpcUsd = row.cpcUsd;
    if (prev.ownRank == null && ownRank != null) prev.ownRank = ownRank;
  }

  const gaps: KeywordGap[] = [...byKeyword.values()].map((a) => {
    const score = Math.round((a.volume ?? 0) * winnability(a.competitorRank));
    return {
      keyword: a.keyword,
      volume: a.volume,
      cpcUsd: a.cpcUsd,
      competitorDomain: a.competitorDomain,
      competitorRank: a.competitorRank,
      ownRank: a.ownRank,
      alsoWonBy: [...a.alsoWonBy].sort(),
      score,
      evidence: gapEvidenceSentence(a),
    };
  });

  gaps.sort(
    (x, y) =>
      y.score - x.score ||
      (y.volume ?? 0) - (x.volume ?? 0) ||
      x.competitorRank - y.competitorRank ||
      x.keyword.localeCompare(y.keyword),
  );
  return gaps.slice(0, max);
}

/** Reference mega-domains whose portfolios are useless as gap targets - the tenant
 *  is not competing with an encyclopedia for its whole keyword universe. */
const REFERENCE_DOMAINS = [
  "wikipedia.org",
  "wikimedia.org",
  "wiktionary.org",
  "wikihow.com",
  "britannica.com",
];

function isReferenceDomain(domain: string): boolean {
  return REFERENCE_DOMAINS.some((n) => domain === n || domain.endsWith(`.${n}`));
}

/**
 * Pick the top gap-check targets from the demand graph's competitor evidence: the
 * domains most often cited instead of the tenant, minus social/marketplace noise,
 * reference mega-sites, and the tenant itself. PURE. Bounded to `max`.
 */
export function pickGapCompetitorDomains(
  moves: ReadonlyArray<{ competitorUrls: string[] }>,
  ownDomain: string,
  max = 3,
): string[] {
  const own = ownDomain.toLowerCase().replace(/^www\./, "");
  const counts = new Map<string, number>();
  for (const m of moves) {
    const seen = new Set<string>();
    for (const url of m.competitorUrls) {
      const d = domainOf(url);
      if (!d || seen.has(d)) continue;
      seen.add(d);
      if (own && (d === own || d.endsWith(`.${own}`))) continue;
      if (isNoiseDomain(d) || isReferenceDomain(d)) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([d]) => d);
}

/**
 * Item 60: label each gap with item 18's honest winnability verdict, from a
 * CACHED difficulty-only read (no fresh Labs spend - the caller passes in
 * whatever readAllCachedKeywordDifficulty already has). PURE. A keyword with no
 * cached difficulty score keeps `winnability: null` - unlabeled, not rejected;
 * the gap still appears, just without the extra corroboration. Never drops a
 * gap here (the plan calls for HONEST LABELING, not silent removal) - the caller
 * decides whether to sort/badge/hide "reject"-band gaps.
 */
export function applyWinnabilityToGaps(
  gaps: readonly KeywordGap[],
  cachedDifficulty: ReadonlyMap<string, number | null>,
): KeywordGap[] {
  return gaps.map((g) => {
    const difficulty = cachedDifficulty.get(g.keyword.toLowerCase());
    if (difficulty === undefined) return { ...g, winnability: null };
    const w = computeWinnability({ difficulty });
    return { ...g, winnability: { score: w.score, band: w.band, sentence: w.sentence } };
  });
}
