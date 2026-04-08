import {
  opportunities,
  briefs,
  changelogEntries,
  results,
  competitors,
} from "./seed-data.server";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Brief } from "@/domains/briefs/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Competitor } from "@/domains/competitors/types";

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// ── Change → Results (reverse: which results attribute this change) ──

export function getResultsForChange(changeId: string): Result[] {
  return results.filter((r) =>
    r.attributed_changelog_ids.includes(changeId)
  );
}

// ── Result → Changes (via attributed_changelog_ids) ──

export function getChangesForResult(resultId: string): ChangelogEntry[] {
  const result = results.find((r) => r.id === resultId);
  if (!result) return [];
  return changelogEntries.filter((c) =>
    result.attributed_changelog_ids.includes(c.id)
  );
}

// ── Change → Brief (direct FK) ──

export function getBriefForChange(changeId: string): Brief | null {
  const change = changelogEntries.find((c) => c.id === changeId);
  if (!change?.brief_id) return null;
  return briefs.find((b) => b.id === change.brief_id) ?? null;
}

// ── Change → Opportunity (direct FK) ──

export function getOpportunityForChange(changeId: string): Opportunity | null {
  const change = changelogEntries.find((c) => c.id === changeId);
  if (!change?.opportunity_id) return null;
  return opportunities.find((o) => o.id === change.opportunity_id) ?? null;
}

// ── Brief → Opportunities (via opportunity_ids) ──

export function getOpportunityForBrief(briefId: string): Opportunity[] {
  const brief = briefs.find((b) => b.id === briefId);
  if (!brief) return [];
  return opportunities.filter((o) => brief.opportunity_ids.includes(o.id));
}

// ── Opportunity → Briefs (linked_brief_ids + reverse lookup) ──

export function getBriefsForOpportunity(opportunityId: string): Brief[] {
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

export function getChangesForOpportunity(
  opportunityId: string
): ChangelogEntry[] {
  const opp = opportunities.find((o) => o.id === opportunityId);
  const directIds = opp?.linked_changelog_ids ?? [];
  const fromDirect = changelogEntries.filter((c) => directIds.includes(c.id));
  const fromFK = changelogEntries.filter(
    (c) => c.opportunity_id === opportunityId
  );
  return dedupe([...fromDirect, ...fromFK]);
}

// ── Opportunity → Results (through connected changes) ──

export function getResultsForOpportunity(opportunityId: string): Result[] {
  const changes = getChangesForOpportunity(opportunityId);
  const changeIds = new Set(changes.map((c) => c.id));
  return results.filter((r) =>
    r.attributed_changelog_ids.some((id) => changeIds.has(id))
  );
}

// ── Brief → Changes (via linked_changelog_ids) ──

export function getChangesForBrief(briefId: string): ChangelogEntry[] {
  const brief = briefs.find((b) => b.id === briefId);
  if (!brief) return [];
  return changelogEntries.filter((c) =>
    brief.linked_changelog_ids.includes(c.id)
  );
}

// ── Brief → Results (through connected changes) ──

export function getResultsForBrief(briefId: string): Result[] {
  const changes = getChangesForBrief(briefId);
  const changeIds = new Set(changes.map((c) => c.id));
  return results.filter((r) =>
    r.attributed_changelog_ids.some((id) => changeIds.has(id))
  );
}

// ── Competitor → Opportunities (by competitor_ids array) ──

export function getOpportunitiesForCompetitor(
  competitorId: string
): Opportunity[] {
  return opportunities.filter((o) => o.competitor_ids.includes(competitorId));
}

// ── Opportunity → Competitors (by competitor_ids array) ──

export function getCompetitorsForOpportunity(
  opportunityId: string
): Competitor[] {
  const opp = opportunities.find((o) => o.id === opportunityId);
  if (!opp || opp.competitor_ids.length === 0) return [];
  return competitors.filter((c) => opp.competitor_ids.includes(c.id));
}

// ── Opportunity → Related Opportunities ──

export function getRelatedOpportunities(
  opportunityId: string
): Opportunity[] {
  const opp = opportunities.find((o) => o.id === opportunityId);
  if (!opp || opp.related_opportunity_ids.length === 0) return [];
  return opportunities.filter((o) =>
    opp.related_opportunity_ids.includes(o.id)
  );
}

// ── Single-entity lookups ──

export function getChangeById(changeId: string): ChangelogEntry | null {
  return changelogEntries.find((c) => c.id === changeId) ?? null;
}

export function getBriefById(briefId: string): Brief | null {
  return briefs.find((b) => b.id === briefId) ?? null;
}

// ── Full causal chain for a Result ──

import type { Attribution, ChangeVerdictData } from "@/domains/attribution/types";
import {
  computeAttributionsForResult,
  computeChangeVerdict,
} from "@/domains/attribution/compute";

export type ChainLink = {
  opportunity: Opportunity | null;
  brief: Brief | null;
  change: ChangelogEntry;
  attribution: Attribution | null;
};

export function getFullChainForResult(resultId: string): ChainLink[] {
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

// ── Attribution lookups ──

export function getAttributionsForResult(resultId: string): Attribution[] {
  return computeAttributionsForResult(
    resultId,
    changelogEntries,
    results,
    opportunities
  );
}

export function getChangeVerdictData(changeId: string): ChangeVerdictData {
  const change = changelogEntries.find((c) => c.id === changeId);
  if (!change) {
    return { verdict: "pending", attributions: [], summary: "Change not found" };
  }
  return computeChangeVerdict(change, results, opportunities);
}
