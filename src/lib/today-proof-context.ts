/**
 * Serializable context for Tier 1A proof UI on Today (and optional reuse on Pages).
 */

export type TodayProofContext = {
  crawlRunId: string | null;
  crawlCompletedAt: string | null;
  crawlHref: string | null;
  visibilityRunId: string | null;
  visibilityCompletedAt: string | null;
  visibilityHref: string | null;
  citationIndexBuiltAt: string | null;
  visibilitySynthetic: boolean;
  visibilitySource: string | null;
  resultsRowCount: number;
  resultsThrough: string | null;
  visibilityStaleVsCrawl: boolean;
  visibilityStaleNote: string | null;
  crawlAgeDays: number | null;
  crawlStale: boolean;
  /** Amber: synthetic visibility row or missing citation_index_built_at while crawl exists */
  visibilityPartialSample: boolean;
};

export type CoverageTone = "ok" | "partial" | "degraded" | "critical";

export function deriveCoverageTone(ctx: TodayProofContext): CoverageTone {
  if (ctx.crawlAgeDays !== null && ctx.crawlAgeDays > 30) return "critical";
  if (ctx.crawlStale && ctx.crawlAgeDays !== null && ctx.crawlAgeDays > 14) return "degraded";
  if (ctx.visibilityStaleVsCrawl) return "degraded";
  if (ctx.visibilityPartialSample) return "partial";
  return "ok";
}
