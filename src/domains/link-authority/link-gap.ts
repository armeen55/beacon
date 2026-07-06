/**
 * link-authority/link-gap (RANK-7, 2026-07-06) - the "#1 ranking" half. PURE
 * math that turns two already-cached, $0 reads into an honest link-authority
 * finding: a query where competitors RANK and have far more links from other
 * sites (referring domains) than you, so you likely cannot outrank them on
 * content alone. The play is to build authority first (digital PR / earned
 * links), not to keep polishing a page that Google's link math already caps.
 *
 * WHY THIS EXISTS (STEP 0 audit): dataforseo-labs.ts already reads referring
 * domains (runBacklinksSummary) and winnability.ts already does the backlink-gap
 * arithmetic (theirAvg / ownCount, a >50x reject unless difficulty is low), but
 * NOTHING turned that into a Move, and the fully-built outreach pipeline
 * (mine-leads / draft-pitch / send-pitch) was fed ZERO backlink-gap signals.
 * This module is the missing detection layer + the outreach feed.
 *
 * DETERMINISTIC + EMPTY-SAFE (the pins):
 *   - no backlink read for a gap -> that gap is skipped (no Move, no signal).
 *   - referring-domain multiple within the threshold -> skipped (a beatable
 *     gap belongs to the keyword-gap engine, not here).
 *   - competitor does not actually rank, or you already rank well -> skipped.
 *   - an empty input list -> [] (byte-identical to before RANK-7).
 * No I/O, no server-only. The reads happen in load-link-gaps.ts and are passed
 * in already-parsed. Reuses computeWinnability's backlink arithmetic so the two
 * surfaces can never disagree on when a gap is "cannot close with content".
 *
 * Beacon voice everywhere: first person, a concrete number, a next step, no lab
 * words, no em or en dashes. "Referring domains" and "links from other sites"
 * are both concrete and allowed.
 */

import { computeWinnability } from "@/domains/serp/winnability";

/** One candidate query/page for the link-gap check, pre-joined in the loader. */
export type LinkGapCandidate = {
  /** The demand query competitors win and you do not (or barely) win. */
  keyword: string;
  /** Monthly search volume, or null when unknown (never guessed). */
  volume: number | null;
  /** The strongest competitor's domain that ranks for this query. */
  competitorDomain: string;
  /** The competitor's Google rank for the query (rank_group, 1 = top). */
  competitorRank: number;
  /** The competitor's actual ranking URL, when known (for the backlink read). */
  competitorUrl: string | null;
  /** Your own rank when known (Labs or GSC), null = you do not show up. */
  ownRank: number | null;
  /** Referring domains pointing at the competitor's ranking page, or null. */
  competitorReferringDomains: number | null;
  /** Referring domains pointing at your own page for this topic, or null. */
  ownReferringDomains: number | null;
  /** Google keyword-difficulty (0-100) when a cached read has it, else null.
   *  A low-difficulty query stays winnable on merit even with a big link gap. */
  difficulty?: number | null;
};

export type LinkGap = {
  keyword: string;
  volume: number | null;
  competitorDomain: string;
  competitorRank: number;
  competitorUrl: string | null;
  ownRank: number | null;
  competitorReferringDomains: number;
  ownReferringDomains: number;
  /** Rounded competitorReferringDomains / max(ownReferringDomains, 1). */
  referringDomainMultiple: number;
  /** volume x how strongly a real link gap caps this query - the sort key. */
  score: number;
};

/** A competitor must actually rank near the top for the query to be a genuine
 *  "they win this" gap (not a page buried at 40). */
export const COMPETITOR_RANK_CEILING = 20;
/** You are "not winning on content" when you are outside the top 10 (or absent).
 *  A page already in the top 10 does not need an authority intervention. */
export const OWN_RANK_FLOOR = 10;
/** The referring-domain multiple that makes a query "cannot close with content
 *  alone" - matches winnability.ts REJECT_BACKLINK_MULTIPLE so the two agree. */
export const LINK_GAP_MULTIPLE = 50;
/** Below this Google difficulty a big link gap does NOT cap the query - Google
 *  itself says the term is not contested, so content can still win it. Matches
 *  winnability.ts LOW_DIFFICULTY. */
export const LOW_DIFFICULTY = 30;

/**
 * Compute the link-authority gaps from pre-joined candidates. PURE. A candidate
 * only becomes a gap when EVERY condition holds:
 *   - the competitor genuinely ranks (rank <= COMPETITOR_RANK_CEILING),
 *   - you do not already win it (ownRank absent or > OWN_RANK_FLOOR),
 *   - both referring-domain reads are present (never a call just to fire this),
 *   - the referring-domain multiple exceeds LINK_GAP_MULTIPLE, AND
 *   - Google's difficulty is not low enough to keep it winnable on merit.
 * Missing backlink data on a candidate skips it (empty-safe). Sorted by score.
 */
export function computeLinkGaps(
  candidates: ReadonlyArray<LinkGapCandidate>,
  max = 20,
): LinkGap[] {
  const out: LinkGap[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const keyword = (c.keyword || "").trim();
    if (keyword.length < 3) continue;

    // The competitor must actually rank for this to be a real "they win it" gap.
    if (!Number.isFinite(c.competitorRank) || c.competitorRank < 1 || c.competitorRank > COMPETITOR_RANK_CEILING) {
      continue;
    }
    // A page already winning does not need an authority play.
    if (c.ownRank != null && c.ownRank <= OWN_RANK_FLOOR) continue;

    // Both backlink reads MUST be present - no invented number, and we never
    // fire a call just to label this (the loader passes cached reads only).
    const theirs = typeof c.competitorReferringDomains === "number" && c.competitorReferringDomains >= 0
      ? c.competitorReferringDomains
      : null;
    const ours = typeof c.ownReferringDomains === "number" && c.ownReferringDomains >= 0
      ? c.ownReferringDomains
      : null;
    if (theirs == null || ours == null) continue;

    // Reuse winnability's arithmetic so the two surfaces never disagree on when
    // a gap is "cannot close with content alone". The backlink band drives us.
    const verdict = computeWinnability({
      difficulty: c.difficulty ?? null,
      backlinkGap: { theirAvgReferringDomains: theirs, ownReferringDomains: ours },
    });
    // A low-difficulty query stays winnable on merit even with a big link gap
    // (winnability.ts's documented exception). computeWinnability already
    // encodes it: with difficulty < LOW_DIFFICULTY it does NOT reject on the
    // backlink multiple. So a "reject" band is our fire condition.
    if (verdict.band !== "reject") continue;

    const multiple = ours === 0 ? theirs : theirs / ours;
    // Guard: the reject could have come from a high-difficulty read rather than
    // the link gap itself. Require the link multiple to genuinely be large so we
    // never mislabel a hard-but-linkable query as a link-authority problem.
    if (!(multiple >= LINK_GAP_MULTIPLE)) continue;

    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const referringDomainMultiple = Math.round(multiple);
    // Score: demand x how strongly the gap caps the query. A capped high-volume
    // query is the most valuable authority target. Capped at a sane ceiling so
    // one freakishly large multiple does not dominate the whole list.
    const score = Math.round((c.volume ?? 0) * Math.min(referringDomainMultiple / LINK_GAP_MULTIPLE, 4));

    out.push({
      keyword,
      volume: c.volume,
      competitorDomain: c.competitorDomain,
      competitorRank: c.competitorRank,
      competitorUrl: c.competitorUrl ?? null,
      ownRank: c.ownRank ?? null,
      competitorReferringDomains: theirs,
      ownReferringDomains: ours,
      referringDomainMultiple,
      score,
    });
  }

  out.sort(
    (a, b) =>
      b.score - a.score ||
      (b.volume ?? 0) - (a.volume ?? 0) ||
      b.referringDomainMultiple - a.referringDomainMultiple ||
      a.keyword.localeCompare(b.keyword),
  );
  return out.slice(0, max);
}

const fmt = (n: number): string => n.toLocaleString("en-US");

/**
 * The operator-facing evidence sentence for one link gap. First person, a
 * concrete number, a next step, no lab words, no em or en dashes.
 */
export function linkGapEvidenceSentence(g: LinkGap): string {
  const who = `${g.competitorDomain} ranks ${g.competitorRank} on Google for "${g.keyword}"`;
  const demand =
    g.volume != null && g.volume > 0
      ? ` and people search it about ${fmt(g.volume)} times a month.`
      : `.`;
  const gap = ` Their page has about ${g.referringDomainMultiple}x the links from other sites that yours does (${fmt(g.competitorReferringDomains)} referring domains to your ${fmt(g.ownReferringDomains)}).`;
  const next = ` You likely cannot outrank them on content alone here, so build authority first: earn a few strong links to this topic before you keep editing the page.`;
  return `${who}${demand}${gap}${next}`;
}
