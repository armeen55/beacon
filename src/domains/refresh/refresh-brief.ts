/**
 * refresh/refresh-brief (BEACON_500 item 56) - PURE builder for the refresh production
 * line's per-page brief: the three evidence parts a refresh Move needs to be convincing -
 * (1) queries the page earns impressions for that no H2 on the page answers, (2) the queries
 * it is actually losing (quarter-over-quarter, from the decay-queue rank), (3) the winner's
 * newer section, when a cached competitor teardown names one this page lacks. Each part is
 * INDEPENDENT and each is honestly absent when its source data is missing - never a guessed
 * or templated line standing in for a part with no evidence.
 *
 * PURE: this module takes pre-loaded rows only. The bounded loaders (loadRefreshBriefInputs)
 * live in refresh-brief-loader.ts and do the actual (capped, page-scoped) I/O.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { RefreshCandidateRank } from "./decay-queue";

/** A query the page earns impressions for with no H2 on the page answering it. */
export type NewQueryGap = {
  query: string;
  impressions: number;
};

/** A query the page is losing (mirrors QueryDecline's shape, kept local so this module has
 *  no dependency on the daily-experiment lane). */
export type LosingQuery = {
  query: string;
  priorClicks: number;
  recentClicks: number;
  dropPct: number;
};

/** The winning competitor's newer section this page lacks. */
export type WinnerSectionGap = {
  domain: string;
  /** The section heading the competitor has that this page's own H2 list has no match for. */
  sectionTitle: string;
  /** ISO date the competitor's page was last known fresh, when the teardown carries one. */
  freshnessDate: string | null;
};

export type RefreshBriefInput = {
  rank: RefreshCandidateRank;
  /** This page's top GSC queries by impressions (best-first), or []. */
  pageQueries: Array<{ query: string; impressions: number }>;
  /** This page's own crawled H2 headings, or []. */
  ownH2s: string[];
  /** Declining queries for this exact page (already windowed/ranked by the caller), or []. */
  losingQueries: LosingQuery[];
  /** The cached competitor teardown's outline (H2-equivalent section titles) for the page's top
   *  competitor, or null when no teardown exists yet. */
  competitor?: { domain: string; outline: string[]; freshnessDate: string | null } | null;
};

export type RefreshBrief = {
  page: string;
  rank: RefreshCandidateRank;
  newQueryGaps: NewQueryGap[];
  losingQueries: LosingQuery[];
  winnerSection: WinnerSectionGap | null;
  /** True when at least one of the three evidence parts has real data - a brief with all
   *  three parts empty is not worth showing (the caller should skip the candidate). */
  hasEvidence: boolean;
};

/** At most this many "new query, no H2" gaps and losing queries surface per brief - a card
 *  reads as evidence, not a data dump. */
const MAX_GAPS_PER_PART = 3;
/** A query needs at least this many impressions to be worth naming as a gap - a 2-impression
 *  query is not a real content opportunity. */
const MIN_GAP_IMPRESSIONS = 20;

/**
 * Corpus-relative "head" tokens: a token that recurs across MULTIPLE of the page's own texts
 * (its queries AND its H2s combined - the whole page-topic corpus) carries no distinguishing
 * intent (e.g. "cat" on every query and H2 of a cats page - the site-wide GENERIC list in
 * relevance-gate.ts only strips brand terms like "persian", not a page-specific topic word
 * like "cat"). A token appearing on only ONE text is, by definition, specific to that text -
 * it cannot be a page-wide head word - so the bar is simply "appears more than once across
 * the combined corpus", which degrades gracefully down to a single-query, single-H2 input.
 */
function headTokens(corpus: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const t of corpus) {
    for (const tok of new Set(topicTokens(t))) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  const head = new Set<string>();
  for (const [tok, c] of counts) if (c > 1) head.add(tok);
  return head;
}

function distinguishing(text: string, head: Set<string>): string[] {
  return topicTokens(text).filter((t) => !head.has(t));
}

/** Does `candidate` (a query or a competitor section) have a DISTINGUISHING token (after
 *  stripping the page's head tokens) that also appears in `text` (an H2)? True = covered;
 *  false = a real gap. A candidate with zero distinguishing tokens (pure head words) is
 *  treated as generic, not a specific gap worth naming. */
function coveredBy(candidate: string, text: string, head: Set<string>): boolean {
  const dc = distinguishing(candidate, head);
  if (dc.length === 0) return true; // nothing specific to claim as a gap
  const dt = new Set(distinguishing(text, head));
  return dc.some((t) => dt.has(t));
}

/**
 * Which of the page's top queries have NO matching H2 on the page - the corpus-relative
 * "head" tokens (derived from the page's own queries) are excluded from the match test so a
 * query isn't falsely called "covered" just because it shares the page's own topic word with
 * an H2 that says nothing about the query's actual distinguishing intent. Pure.
 */
export function findNewQueryGaps(
  pageQueries: Array<{ query: string; impressions: number }>,
  ownH2s: string[],
  limit: number = MAX_GAPS_PER_PART,
): NewQueryGap[] {
  const head = headTokens([...pageQueries.map((q) => q.query), ...ownH2s]);
  const out: NewQueryGap[] = [];
  for (const q of [...pageQueries].sort((a, b) => b.impressions - a.impressions)) {
    if (q.impressions < MIN_GAP_IMPRESSIONS) continue;
    if (!q.query.trim()) continue;
    const covered = ownH2s.some((h2) => coveredBy(q.query, h2, head));
    if (covered) continue; // an existing H2 already covers this query's intent
    out.push({ query: q.query, impressions: q.impressions });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The competitor's newest section this page's own H2 list has no match for - honest null
 * when there is no cached teardown, the teardown has no outline, or every competitor
 * section already has a matching H2 here (nothing to steal). Head tokens are derived from
 * BOTH sides' headings combined (this page's H2s + the competitor's outline), so a topic
 * word both pages naturally share (e.g. "cat" on two cat pages) never masquerades as
 * coverage of a specific section like "pricing". Pure.
 */
export function findWinnerSectionGap(
  competitor: { domain: string; outline: string[]; freshnessDate: string | null } | null | undefined,
  ownH2s: string[],
): WinnerSectionGap | null {
  if (!competitor || competitor.outline.length === 0) return null;
  const head = headTokens([...ownH2s, ...competitor.outline]);
  for (const section of competitor.outline) {
    if (!section.trim()) continue;
    const covered = ownH2s.some((h2) => coveredBy(section, h2, head));
    if (covered) continue; // this page already has an equivalent section
    return { domain: competitor.domain, sectionTitle: section.trim(), freshnessDate: competitor.freshnessDate };
  }
  return null;
}

/** Build the plain-business sentence for a winner-section gap, e.g. "The winning page added a
 *  Pricing section; yours still stops short." Names the year only when the competitor's
 *  freshness date carries one worth citing. No em or en dashes ever. */
export function buildWinnerSectionSentence(gap: WinnerSectionGap): string {
  const yearPart = gap.freshnessDate ? ` in ${gap.freshnessDate.slice(0, 4)}` : "";
  return `The winning page (${gap.domain}) added a "${gap.sectionTitle}" section${yearPart}. Yours does not cover that yet.`;
}

/** Build the plain-business sentence naming the new-query gaps, e.g. "People search 'X' (140
 *  searches a month) but no section on this page answers it." No em or en dashes ever. */
export function buildNewQueryGapSentence(gaps: NewQueryGap[]): string | null {
  if (gaps.length === 0) return null;
  const top = gaps[0]!;
  const more = gaps.length > 1 ? `, plus ${gaps.length - 1} more` : "";
  return `People search "${top.query}" (${top.impressions.toLocaleString("en-US")} searches) but no section on this page answers it${more}.`;
}

/** Build the plain-business sentence naming the losing queries, e.g. "You are losing 'X'
 *  (down 40%)." No em or en dashes ever. */
export function buildLosingQuerySentence(losing: LosingQuery[]): string | null {
  if (losing.length === 0) return null;
  const top = losing[0]!;
  const more = losing.length > 1 ? `, plus ${losing.length - 1} more` : "";
  return `You are losing "${top.query}" (down ${top.dropPct}% from ${top.priorClicks} clicks)${more}.`;
}

/**
 * Assemble the full refresh brief for one ranked page. Pure - never fetches, never guesses:
 * a missing part (no competitor teardown, no crawled H2s, no per-query decline data) is
 * simply absent from the output, and the caller decides whether an evidence-free brief is
 * still worth queuing (rank alone can still justify a refresh even with a thin brief).
 */
export function buildRefreshBrief(input: RefreshBriefInput): RefreshBrief {
  const newQueryGaps = findNewQueryGaps(input.pageQueries, input.ownH2s);
  const losingQueries = input.losingQueries.slice(0, MAX_GAPS_PER_PART);
  const winnerSection = findWinnerSectionGap(input.competitor, input.ownH2s);
  return {
    page: input.rank.page,
    rank: input.rank,
    newQueryGaps,
    losingQueries,
    winnerSection,
    hasEvidence: newQueryGaps.length > 0 || losingQueries.length > 0 || winnerSection != null,
  };
}

/** Every non-empty evidence sentence from a brief, in a fixed evidence order (new queries,
 *  losing queries, winner section) - the exact lines the card's "how we know" reads. Pure. */
export function briefSentences(brief: RefreshBrief): string[] {
  const out: string[] = [];
  const newQ = buildNewQueryGapSentence(brief.newQueryGaps);
  if (newQ) out.push(newQ);
  const losing = buildLosingQuerySentence(brief.losingQueries);
  if (losing) out.push(losing);
  if (brief.winnerSection) out.push(buildWinnerSectionSentence(brief.winnerSection));
  return out;
}
