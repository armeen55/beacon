/**
 * link-authority/to-outreach-signals (RANK-7, 2026-07-06) - the bridge that
 * FEEDS the built-but-starved outreach pipeline its first backlink-gap signals.
 *
 * STEP 0 audit found the outreach pipeline (mine-leads / draft-pitch / send-
 * pitch) fully built but fed ZERO link-gap signals. This PURE function turns a
 * link gap (a query where a competitor out-links you so badly you cannot win on
 * content) into the digital-PR input mine-leads already merges: the competitor
 * that owns the query becomes an outreach target - the honest starting point for
 * "study who links to their page for this topic and earn the same links".
 *
 * PURE - no I/O, no server-only. The dedupe/noise gate lives in compute-leads.ts
 * (isPitchable), so this only shapes the signal; a competitor that is Wikipedia
 * or a social platform is dropped THERE, not fabricated into a lead here.
 */

import type { LinkGap } from "./link-gap";

/** The link-gap-derived outreach input mine-leads.ts merges into its lead set.
 *  Mirrors the shape of the other loader inputs (KeywordGapCompetitorInput). */
export type LinkGapOutreachTarget = {
  /** The competitor domain that out-links you for the query (the pitch target). */
  competitorDomain: string;
  /** The query this competitor's link authority wins - the pitch angle. */
  keyword: string;
  /** How many times more links from other sites they have (referring-domain
   *  multiple) - the honest reason this is a link play, not a content play. */
  referringDomainMultiple: number;
  /** Monthly search volume when known (never guessed). */
  volume: number | null;
};

const fmt = (n: number): string => n.toLocaleString("en-US");

/** Shape a batch of link gaps into outreach targets. Bounded, deduped by
 *  competitor domain (the strongest gap per domain wins the slot). PURE. */
export function linkGapsToOutreachTargets(
  gaps: ReadonlyArray<LinkGap>,
  max = 20,
): LinkGapOutreachTarget[] {
  const byDomain = new Map<string, LinkGapOutreachTarget>();
  for (const g of gaps) {
    const domain = (g.competitorDomain || "").toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    const prev = byDomain.get(domain);
    if (prev && prev.referringDomainMultiple >= g.referringDomainMultiple) continue;
    byDomain.set(domain, {
      competitorDomain: domain,
      keyword: g.keyword,
      referringDomainMultiple: g.referringDomainMultiple,
      volume: g.volume,
    });
  }
  return [...byDomain.values()]
    .sort((a, b) => b.referringDomainMultiple - a.referringDomainMultiple || a.competitorDomain.localeCompare(b.competitorDomain))
    .slice(0, max);
}

/** The named-evidence line for a link-gap outreach lead. First person, a
 *  concrete number, a next step, no lab words, no em or en dashes. */
export function linkGapLeadEvidence(t: LinkGapOutreachTarget): string {
  const demand =
    t.volume != null && t.volume > 0
      ? ` (about ${fmt(t.volume)} searches a month)`
      : "";
  return `${t.competitorDomain} ranks for "${t.keyword}"${demand} with about ${t.referringDomainMultiple}x the links from other sites that you have. Study who links to their page for this topic and earn the same links to catch up.`;
}
