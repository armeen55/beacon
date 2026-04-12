import type { BeaconRecommendation } from "@/domains/product/recommendation-engine";
import type { ReplicationCard } from "@/domains/product/replication-engine";

export type SerializedReplicationCard = {
  id: string;
  headline: string;
  summaryLine: string;
  winnerTier: string;
  patternName: string | null;
  patternId: string | null;
  sourceChangeId: string | null;
  confidence: string;
  expectedNextStep: string;
  watchAfter: string;
  cardObserved: string[];
  cardInferred: string[];
  targets: Array<{
    recId: string;
    recType: string;
    targetPageUrl: string;
    targetPagePath: string;
    pagesHref: string;
    citationOpportunity: number;
    /** Snapshot baseline from citation index when available */
    baselineCitations: number;
    similarityReasons: string[];
    observed: string[];
    inferred: string[];
  }>;
};

function normUrl(u: string): string {
  return u.replace(/\/+$/, "").toLowerCase();
}

export function serializeReplicationCards(
  cards: ReplicationCard[],
  recommendations: BeaconRecommendation[],
  pagesHref: (url: string) => string,
  citationCountByUrl?: Map<string, number>,
): SerializedReplicationCard[] {
  const recById = new Map(recommendations.map((r) => [r.id, r]));
  return cards.map((c) => ({
    id: c.id,
    headline: c.headline,
    summaryLine: c.summaryLine,
    winnerTier: c.winnerTier,
    patternName: c.patternName,
    patternId: c.patternId,
    sourceChangeId: c.sourceChangeId,
    confidence: c.confidence,
    expectedNextStep: c.expectedNextStep,
    watchAfter: c.watchAfter,
    cardObserved: c.cardObserved,
    cardInferred: c.cardInferred,
    targets: c.targets.map((t) => {
      const rec = recById.get(t.recId);
      const fromIndex = citationCountByUrl?.get(normUrl(t.targetPageUrl));
      const baselineCitations =
        fromIndex !== undefined && fromIndex !== null
          ? fromIndex
          : t.citationOpportunity;
      return {
        recId: t.recId,
        recType: rec?.type ?? "replicate",
        targetPageUrl: t.targetPageUrl,
        targetPagePath: t.targetPagePath,
        pagesHref: pagesHref(t.targetPageUrl),
        citationOpportunity: t.citationOpportunity,
        baselineCitations,
        similarityReasons: t.similarityReasons,
        observed: t.observed,
        inferred: t.inferred,
      };
    }),
  }));
}
