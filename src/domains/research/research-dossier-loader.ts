import "server-only";

import { runWithTenant } from "@/lib/tenant-context";
import { loadKeywordLibraryForTenant } from "./keyword-library";
import { readCachedSerpPatterns } from "@/domains/serp/research-enrichment-producer";
import { readCloneBriefResults } from "@/domains/serp/clone-brief-store";
import { loadQuestionUniverseForTenant } from "./question-universe-loader";
import type { ResearchCorpus } from "./research-dossier";
import { readCitationIntelligenceForTenant } from "@/domains/ai-visibility/citation-intelligence-snapshot";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { loadCompetitorForensicsForTenant } from "./competitor-forensics-loader";

/**
 * Read every already-paid/crawled research store needed to build per-move
 * dossiers. The explicit tenant context is applied to the few legacy
 * tenant-routed json stores; global row stores still filter by tenant ID.
 * No research producer, live SERP pull, crawl, or paid API call is invoked here;
 * this boundary only reads Beacon's existing persisted caches.
 */
export async function loadResearchCorpusForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<ResearchCorpus> {
  if (!tenantId) {
    return {
      keywordLibrary: { rows: [], volumeCoverage: 0, total: 0, bySource: {} as ResearchCorpus["keywordLibrary"]["bySource"] },
      serpPatterns: new Map(),
      cloneBriefs: [],
      questions: [],
      citationIntelligence: null,
      claritySignals: new Map(),
      competitorForensics: [],
    };
  }
  return await runWithTenant(tenantId, async () => {
    const [keywordLibrary, serpPatterns, cloneResult, questions, citationIntelligence, claritySignals, competitorForensics] = await Promise.all([
      loadKeywordLibraryForTenant(tenantId).catch(() => ({ rows: [], volumeCoverage: 0, total: 0, bySource: {} as ResearchCorpus["keywordLibrary"]["bySource"] })),
      readCachedSerpPatterns().catch(() => new Map()),
      readCloneBriefResults(tenantId, now).catch(() => null),
      loadQuestionUniverseForTenant(tenantId).catch(() => []),
      readCitationIntelligenceForTenant(tenantId).catch(() => null),
      loadClarityPageSignalsForTenant(tenantId, now).catch(() => new Map()),
      loadCompetitorForensicsForTenant(tenantId).catch(() => []),
    ]);
    return {
      keywordLibrary,
      serpPatterns,
      cloneBriefs: cloneResult?.briefs ?? [],
      questions,
      citationIntelligence,
      claritySignals,
      competitorForensics,
    };
  });
}
