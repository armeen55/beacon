import {
  getOpportunities,
  getBriefs,
  getChangelogEntries,
  getResults,
} from "./seed-data.server";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Brief } from "@/domains/briefs/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// ── Opportunity → Briefs (linked_brief_ids + reverse lookup) ──

export async function getBriefsForOpportunity(
  opportunityId: string,
): Promise<Brief[]> {
  const [opportunities, briefs] = await Promise.all([
    getOpportunities(),
    getBriefs(),
  ]);
  const opp = opportunities.find((o) => o.id === opportunityId);
  const fromDirect = opp?.linked_brief_ids
    ? briefs.filter((b) => opp.linked_brief_ids.includes(b.id))
    : [];
  const fromReverse = briefs.filter((b) =>
    b.opportunity_ids.includes(opportunityId)
  );
  return dedupe([...fromDirect, ...fromReverse]);
}

// ── Opportunity → Changes (linked_changelog_ids + change.opportunity_id) ──

export async function getChangesForOpportunity(
  opportunityId: string
): Promise<ChangelogEntry[]> {
  const [opportunities, changelogEntries] = await Promise.all([
    getOpportunities(),
    getChangelogEntries(),
  ]);
  const opp = opportunities.find((o) => o.id === opportunityId);
  const directIds = opp?.linked_changelog_ids ?? [];
  const fromDirect = changelogEntries.filter((c) => directIds.includes(c.id));
  const fromFK = changelogEntries.filter(
    (c) => c.opportunity_id === opportunityId
  );
  return dedupe([...fromDirect, ...fromFK]);
}

// ── Opportunity → Results (through connected changes) ──

export async function getResultsForOpportunity(
  opportunityId: string,
): Promise<Result[]> {
  const [changes, results] = await Promise.all([
    getChangesForOpportunity(opportunityId),
    getResults(),
  ]);
  const changeIds = new Set(changes.map((c) => c.id));
  return results.filter((r) =>
    r.attributed_changelog_ids.some((id) => changeIds.has(id))
  );
}

// ── Brief → Changes (via linked_changelog_ids) ──

export async function getChangesForBrief(
  briefId: string,
): Promise<ChangelogEntry[]> {
  const [briefs, changelogEntries] = await Promise.all([
    getBriefs(),
    getChangelogEntries(),
  ]);
  const brief = briefs.find((b) => b.id === briefId);
  if (!brief) return [];
  return changelogEntries.filter((c) =>
    brief.linked_changelog_ids.includes(c.id)
  );
}

// ── Competitor → Opportunities (by competitor_ids array) ──

export async function getOpportunitiesForCompetitor(
  competitorId: string
): Promise<Opportunity[]> {
  const opportunities = await getOpportunities();
  return opportunities.filter((o) => o.competitor_ids.includes(competitorId));
}

// ── Opportunity → Related Opportunities ──

export async function getRelatedOpportunities(
  opportunityId: string
): Promise<Opportunity[]> {
  const opportunities = await getOpportunities();
  const opp = opportunities.find((o) => o.id === opportunityId);
  if (!opp || opp.related_opportunity_ids.length === 0) return [];
  return opportunities.filter((o) =>
    opp.related_opportunity_ids.includes(o.id)
  );
}

// ── Full causal chain for a Result ──

import type { Attribution } from "@/domains/attribution/types";
import { computeAttributionsForResult } from "@/domains/attribution/compute";

export type ChainLink = {
  opportunity: Opportunity | null;
  brief: Brief | null;
  change: ChangelogEntry;
  attribution: Attribution | null;
};

export async function getFullChainForResult(
  resultId: string,
): Promise<ChainLink[]> {
  const [results, changelogEntries, opportunities, briefs] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
    getBriefs(),
  ]);
  const result = results.find((r) => r.id === resultId);
  if (!result) return [];

  const attributions = computeAttributionsForResult(
    resultId,
    changelogEntries,
    results,
    opportunities
  );

  return changelogEntries
    .filter((c) => result.attributed_changelog_ids.includes(c.id))
    .map((change) => {
      const brief = change.brief_id
        ? (briefs.find((b) => b.id === change.brief_id) ?? null)
        : null;

      let opportunity: Opportunity | null = null;
      if (change.opportunity_id) {
        opportunity =
          opportunities.find((o) => o.id === change.opportunity_id) ?? null;
      } else if (brief && brief.opportunity_ids.length > 0) {
        opportunity =
          opportunities.find((o) => o.id === brief.opportunity_ids[0]) ?? null;
      }

      const attribution =
        attributions.find((a) => a.change_id === change.id) ?? null;

      return { opportunity, brief, change, attribution };
    });
}
