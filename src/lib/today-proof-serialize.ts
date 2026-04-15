import type { Finding } from "@/domains/scanning/types";
import type { SerializedFinding } from "@/app/(shell)/today-client";

export function recommendationLineageBullets(opts: {
  sourceEvidence: string;
  type: string;
  sourceChangeId: string | null;
  dataFreshness: string | null;
  priorSuccess?: { changeId: string; pagePath: string; description: string; citationDelta: number } | null;
  expectedMetric?: string | null;
}): string[] {
  const lines: string[] = [
    `Evidence: ${opts.sourceEvidence}`,
    `Signal type: ${opts.type.replace(/_/g, " ")}`,
  ];
  if (opts.priorSuccess) {
    lines.push(
      `This move worked on ${opts.priorSuccess.pagePath}: +${Math.round(opts.priorSuccess.citationDelta)}% citations`,
    );
  }
  if (opts.expectedMetric) {
    lines.push(`Expected: ${opts.expectedMetric}`);
  }
  if (opts.sourceChangeId) {
    lines.push("Grounded in a scorecard change row when you act from Changes.");
  }
  if (opts.dataFreshness) lines.push(opts.dataFreshness);
  return lines;
}

/**
 * Serialize a scan finding for Today. Only sets `crawlProofHref` when the batch
 * id resolves to a known observation run (avoids dead-end links).
 */
export function serializeFindingForToday(
  f: Finding,
  observationRunIds: Set<string>,
): SerializedFinding {
  const linked =
    Boolean(f.scanRunId) && observationRunIds.has(f.scanRunId);
  const crawlProofHref = linked
    ? `/observations/${encodeURIComponent(f.scanRunId)}`
    : null;

  return {
    id: f.id,
    type: f.type,
    url: f.url,
    pagePath: f.pagePath,
    detectedAt: f.detectedAt,
    previousState: f.previousState,
    currentState: f.currentState,
    severity: f.severity,
    priority: f.priority,
    priorityScore: f.priorityScore,
    summary: f.summary,
    suggestedAction: f.suggestedAction,
    status: f.status,
    promotionStatus: f.promotionStatus,
    citationCount: f.citationCount,
    isHomepage: f.isHomepage,
    contradictsChangelog: f.contradictsChangelog,
    scanRunId: f.scanRunId,
    provenanceSummary:
      "Compared consecutive full-site HTML snapshots in this crawl batch.",
    crawlProofHref,
  };
}
