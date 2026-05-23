/**
 * Post-import milestone sync — runs syncMilestonesFromWorkspace after import
 * so milestones are up-to-date without writing during Today render.
 * Phase 1C-3 moved this off the render path.
 */

import "server-only";

import { getResults } from "@/lib/seed-data.server";
import { getCitationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { stripSiteOrigin, getSiteConfig } from "@/lib/site-config";
import { buildCompetitorRank } from "@/lib/performance-timeseries";
import { classifyCompetitorType } from "@/domains/competitors/classify-type";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { syncMilestonesFromWorkspace } from "./sync";

export async function runMilestoneSync(): Promise<{
  newEvents: number;
  dirty: boolean;
}> {
  const { siteDomain } = getSiteConfig();
  const citationEvidenceIndex = await getCitationEvidenceIndex();
  // MT-3B (2026-05-22) — inject tenant directoryDomains into the
  // competitor classifier (CLI-safe: resolves via BEACON_TENANT_ID env).
  const businessConfig = await getBusinessConfigForCurrentTenant();
  const competitorRank = buildCompetitorRank(
    citationEvidenceIndex,
    siteDomain,
    (domain) => classifyCompetitorType(domain, businessConfig.directoryDomains),
  );

  const { newEvents } = await syncMilestonesFromWorkspace({
    results: await getResults(),
    citationIndex: citationEvidenceIndex,
    siteDomain,
    competitorRank,
  });

  return { newEvents: newEvents.length, dirty: newEvents.length > 0 };
}
