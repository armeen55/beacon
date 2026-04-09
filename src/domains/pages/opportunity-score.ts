/**
 * Deterministic page opportunity scoring (0–100).
 * Combines citation demand, structure quality gaps, attribution friction,
 * trust gaps, and technical risk into one operator-useful priority number.
 */

import type { TrustSource } from "@/domains/attribution/scorecard";
import type { PageSnapshot } from "./types";

const TRUST_RANK: Record<TrustSource, number> = {
  operator_confirmed: 0,
  auto_cleared: 1,
  system_primary: 2,
  contributing: 3,
  candidate: 4,
  operator_rejected: 5,
};

export type PageOpportunityInput = {
  totalCitations: number;
  totalChanges: number;
  validatedChanges: number;
  partialChanges: number;
  unresolvedEvents: number;
  bestTrust: TrustSource | null;
  snap: PageSnapshot | null;
};

export type PageOpportunityBreakdown = {
  citations: number;
  structureGap: number;
  attribution: number;
  trust: number;
  demandStructureGap: number;
  technical: number;
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function structureQualityFromSnapshot(snap: PageSnapshot): number {
  const faqQ = snap.faqs.length >= 1 ? 1 : 0;
  const schemaQ = snap.schema_types.length >= 1 ? 1 : 0;
  const wc = snap.word_count;
  const wordQ = wc >= 600 ? 1 : wc >= 350 ? 0.65 : wc >= 200 ? 0.35 : 0;
  const il = snap.internal_link_count;
  const linkQ = il >= 30 ? 1 : il >= 12 ? 0.55 : il >= 5 ? 0.3 : 0;
  return 0.3 * faqQ + 0.3 * schemaQ + 0.25 * wordQ + 0.15 * linkQ;
}

export function computePageOpportunityScore(
  input: PageOpportunityInput
): { score: number; breakdown: PageOpportunityBreakdown } {
  const normCite = clamp01(input.totalCitations / 100);

  const structureQuality = input.snap
    ? structureQualityFromSnapshot(input.snap)
    : 0.35;
  const structureGap = 1 - structureQuality;

  const attrOpp = clamp01(
    0.55 * Math.min(1, input.unresolvedEvents / 4) +
      0.25 * (input.partialChanges > 0 ? 1 : 0) +
      0.35 *
        (input.totalChanges > 0 &&
        input.validatedChanges === 0 &&
        input.partialChanges === 0
          ? 1
          : 0) +
      0.3 * (input.totalChanges === 0 && input.totalCitations >= 15 ? 1 : 0)
  );

  const trustGap = input.bestTrust
    ? TRUST_RANK[input.bestTrust] / 5
    : 0.5;

  const demandStruct = clamp01(normCite * structureGap * 1.15);

  let tech = 0;
  if (input.snap) {
    const robotsNoindex = !!input.snap.robots_meta
      ?.toLowerCase()
      .includes("noindex");
    const httpNotOk = input.snap.http_status !== 200;
    tech = clamp01(
      (input.snap.has_canonical_mismatch ? 0.45 : 0) +
        (robotsNoindex ? 0.55 : 0) +
        (httpNotOk ? 0.35 : 0)
    );
  }

  const citations = Math.round(25 * normCite);
  const struct = Math.round(20 * structureGap);
  const attribution = Math.round(22 * attrOpp);
  const trust = Math.round(13 * trustGap);
  const ds = Math.round(15 * demandStruct);
  const technical = Math.round(5 * tech);

  return {
    score: Math.min(100, citations + struct + attribution + trust + ds + technical),
    breakdown: {
      citations,
      structureGap: struct,
      attribution,
      trust,
      demandStructureGap: ds,
      technical,
    },
  };
}
