import {
  getOpportunities,
  getBriefs,
  getChangelogEntries,
  getResults,
} from "./seed-data.server";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Brief } from "@/domains/briefs/types";
import type { ChangelogEntry } from "@/domains/changelog/types";

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
