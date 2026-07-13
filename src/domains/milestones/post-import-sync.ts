/**
 * Post-import milestone sync — runs syncMilestonesFromWorkspace after import
 * so milestones are up-to-date without writing during Today render.
 * Phase 1C-3 moved this off the render path.
 */

import "server-only";

import { getResults } from "@/lib/seed-data.server";
import { getCitationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { buildCompetitorRank } from "@/lib/performance-timeseries";
import { classifyCompetitorType } from "@/domains/competitors/classify-type";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { syncMilestonesFromWorkspace } from "./sync";

export async function runMilestoneSync(): Promise<{
  newEvents: number;
  dirty: boolean;
}> {
  // One current-tenant config drives both owned-domain attribution and the
  // competitor taxonomy. These reads are independent, so import completion
  // does not pay an avoidable three-step waterfall.
  const [businessConfig, citationEvidenceIndex, results] = await Promise.all([
    getBusinessConfigForCurrentTenant(),
    getCitationEvidenceIndex(),
    getResults(),
  ]);
  const siteDomain = businessConfig.domain.trim().toLowerCase().replace(/^www\./, "");
  if (!siteDomain) {
    throw new Error("Cannot sync milestones without the current tenant's domain");
  }
  const competitorRank = buildCompetitorRank(
    citationEvidenceIndex,
    siteDomain,
    (domain) => classifyCompetitorType(domain, businessConfig.directoryDomains),
  );

  const { newEvents } = await syncMilestonesFromWorkspace({
    results,
    citationIndex: citationEvidenceIndex,
    siteDomain,
    competitorRank,
  });

  return { newEvents: newEvents.length, dirty: newEvents.length > 0 };
}
