/**
 * outreach/compute-leads (BEACON_500 item 57, 2026-07-02) - PURE math that turns
 * the three existing evidence sources into a deduped, evidence-carrying lead
 * list. No I/O, no server-only. Unit-tested in compute-leads.test.ts.
 *
 * Sources (bounded loaders live in mine-leads.ts):
 *   1. wiki-gap beatable articles - the Wikipedia article citing context is not
 *      itself a reclaimable link (Wikipedia does not take direct pitches), but
 *      the mined citation hit tells us WHICH query/topic AI answers with a
 *      Wikipedia page instead of the tenant's - so the lead is the tenant's OWN
 *      gap, surfaced as a "beat this citation" outreach angle is out of scope;
 *      instead we treat any NON-Wikipedia domain surfaced by the citation miner
 *      (a blog/journalist citing the same topic) as the reclaimable lead.
 *   2. keyword-gap competitor domains - a competitor domain AI/Google already
 *      cites for topics the tenant covers is a plausible "add us too" or
 *      "reclaim the mention" pitch target.
 *   3. profound citation domains (excluding the tenant's own AI citations) -
 *      any domain AI cites in this tenant's space becomes a candidate for a
 *      "you already discuss this topic, here is the missing citation" pitch.
 *
 * Every domain runs through the shared noise/reference-domain gate so social
 * platforms, marketplaces, and mega reference sites never become "leads".
 */

import { isNoiseDomain, domainOf } from "@/domains/evidence/relevance-gate";
import {
  linkGapLeadEvidence,
  type LinkGapOutreachTarget,
} from "@/domains/link-authority/to-outreach-signals";
import type { OutreachLead, OutreachLeadSource } from "./types";

/** Reference/mega-domains that are never real outreach targets - nobody at
 *  Wikipedia or Britannica answers a cold pitch from a niche content site. */
const NON_OUTREACH_DOMAINS = ["wikipedia.org", "wikimedia.org", "wiktionary.org", "wikihow.com", "britannica.com"];

function isPitchable(domain: string): boolean {
  if (!domain) return false;
  if (isNoiseDomain(domain)) return false;
  return !NON_OUTREACH_DOMAINS.some((n) => domain === n || domain.endsWith(`.${n}`));
}

/** Stable id from source + domain (+ optional url) - the dedupe/upsert key. */
export function leadId(leadSource: OutreachLeadSource, targetDomain: string, targetUrl: string): string {
  const base = `${leadSource}:${targetDomain}:${targetUrl}`;
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) | 0;
  }
  return `outreach-${Math.abs(hash).toString(36)}`;
}

export type WikiCitingContextInput = {
  /** The citing URL - a non-Wikipedia page that also discusses the topic (e.g.
   *  an AI Overview or observation citation alongside the Wikipedia hit), or
   *  null when no third-party citing context was found for this article. */
  citingUrl: string | null;
  articleDisplayTitle: string;
  queryText: string | null;
};

export type KeywordGapCompetitorInput = {
  competitorDomain: string;
  /** A representative keyword this competitor wins, for the evidence line. */
  sampleKeyword: string | null;
  volume: number | null;
};

export type ProfoundCitationDomainInput = {
  domain: string;
  url: string;
  /** Human-readable topic label when available (never a raw UUID - see
   *  find-wiki-citations.ts's looksLikeUuid guard for the same rule). */
  topicLabel: string | null;
};

export type LeadMiningInput = {
  ownDomain: string;
  wikiCitingContexts: WikiCitingContextInput[];
  keywordGapCompetitors: KeywordGapCompetitorInput[];
  profoundCitationDomains: ProfoundCitationDomainInput[];
  /** RANK-7 (2026-07-06): competitors that out-link the tenant for a query so
   *  badly it cannot win on content - the digital-PR outreach targets. Optional
   *  so every existing caller stays byte-identical (absent -> no link_gap leads). */
  linkGapTargets?: LinkGapOutreachTarget[];
};

const fmt = (n: number): string => n.toLocaleString("en-US");

/**
 * Merge the three sources into a deduped lead list (best evidence per domain
 * wins; multiple urls from the same domain keep the first-seen one). PURE.
 */
export function computeOutreachLeads(input: LeadMiningInput): OutreachLead[] {
  const own = (input.ownDomain || "").toLowerCase().replace(/^www\./, "");
  const byKey = new Map<string, OutreachLead>();

  const consider = (lead: OutreachLead) => {
    const domain = lead.targetDomain.toLowerCase().replace(/^www\./, "");
    if (!domain || !isPitchable(domain)) return;
    if (own && (domain === own || domain.endsWith(`.${own}`))) return;
    const key = `${domain}`;
    if (byKey.has(key)) return; // first source to name a domain wins the lead slot
    byKey.set(key, { ...lead, targetDomain: domain, id: leadId(lead.leadSource, domain, lead.targetUrl) });
  };

  // Source 1: wiki-gap citing contexts - a third-party (non-Wikipedia) domain
  // that cites the same topic Wikipedia currently wins for this tenant.
  for (const hit of input.wikiCitingContexts) {
    if (!hit.citingUrl) continue;
    const domain = domainOf(hit.citingUrl);
    if (!domain) continue;
    const topic = hit.queryText || hit.articleDisplayTitle;
    consider({
      id: "",
      targetDomain: domain,
      targetUrl: hit.citingUrl,
      leadSource: "wiki_gap",
      evidence: `This page discusses "${topic}", the same topic where AI currently cites Wikipedia instead of you.`,
    });
  }

  // Source 2: keyword-gap competitor domains - a competitor domain AI/Google
  // already cites for topics the tenant also covers.
  for (const c of input.keywordGapCompetitors) {
    const domain = domainOf(c.competitorDomain) || c.competitorDomain.toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    const kwLine =
      c.sampleKeyword != null
        ? `ranks for "${c.sampleKeyword}"${c.volume != null && c.volume > 0 ? `, about ${fmt(c.volume)} searches a month` : ""}`
        : "ranks for keywords you also cover";
    consider({
      id: "",
      targetDomain: domain,
      targetUrl: `https://${domain}`,
      leadSource: "keyword_gap_competitor",
      evidence: `${domain} ${kwLine}. Your page covers the same ground and is a candidate to add or replace their link.`,
    });
  }

  // Source 3: profound citation domains - any domain AI cites in this space.
  for (const p of input.profoundCitationDomains) {
    const domain = domainOf(p.url) || p.domain.toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    const topic = p.topicLabel ? ` for "${p.topicLabel}"` : "";
    consider({
      id: "",
      targetDomain: domain,
      targetUrl: p.url,
      leadSource: "profound_citation",
      evidence: `AI cited this page${topic} in your space. It is a candidate to also cite or link to you.`,
    });
  }

  // Source 4 (RANK-7): link-gap competitors - a competitor that out-links the
  // tenant so badly it cannot win the query on content. The digital-PR play is
  // to earn the same links; the competitor domain is the starting point.
  for (const t of input.linkGapTargets ?? []) {
    const domain = (t.competitorDomain || "").toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    consider({
      id: "",
      targetDomain: domain,
      targetUrl: `https://${domain}`,
      leadSource: "link_gap",
      evidence: linkGapLeadEvidence(t),
    });
  }

  return [...byKey.values()].sort((a, b) => a.targetDomain.localeCompare(b.targetDomain));
}
