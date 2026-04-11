import type { ObservationRun } from "@/domains/observations/types";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import { listWebsiteCrawlRuns } from "@/domains/observations/read";
import { citationRollupVisibilityRun } from "@/domains/observations/visibility-read";
import { visibilitySampleStaleVsCrawl } from "@/domains/observations/staleness";

export type TodayVerifiedFix = {
  issueId: string;
  pagePath: string;
  href: string;
  verifiedAt: string;
  summary: string;
  /** Live verify fetch ObservationRun (`website_verify`). */
  verificationObservationRunId?: string | null;
  /** Crawl snapshot run on disk before verify; null if legacy / unknown. */
  verificationBaselineObservationRunId?: string | null;
  /** True when this issue predates verify-time run binding. */
  verificationBindingLegacy?: boolean;
};

export type TodayNextMove = {
  title: string;
  href: string;
  evidence: string;
  /** Crawl-side drill-down when relevant. */
  observationRunId?: string | null;
  evidenceScope: "crawl" | "visibility" | "mixed" | "review_heuristic";
};

export type TodaySummary = {
  crawl: {
    activeObservationRun: ObservationRun | null;
    activeObservationHref: string | null;
    hasObservationFile: boolean;
    priorCompletedAt: string | null;
    deltaVsPrior: {
      pagesChanged: number;
      pagesWithErrors: number;
      guardrailAlerts: number;
    } | null;
  };
  visibility: {
    activeObservationRun: VisibilityObservationRun | null;
    activeObservationHref: string | null;
    hasObservationFile: boolean;
    /** Citation index older than latest crawl completion — sample may lag HTML truth. */
    staleVsCrawl: boolean;
    staleNote: string | null;
  };
  /** Review / attribution queue — not an ObservationRun. */
  reviewHeuristicLine: string;
  competitorLine: string | null;
  verifiedFixes: TodayVerifiedFix[];
  nextMove: TodayNextMove;
};

/**
 * Build Today with explicit crawl vs visibility observation scopes.
 */
export function buildTodaySummary(opts: {
  verifiedFixes: TodayVerifiedFix[];
  nextMoveCandidates: (TodayNextMove | null)[];
  competitorLine?: string | null;
  /** Row-majority visibility run from Sample history (same identity as /results header). */
  primaryVisibilityRun: VisibilityObservationRun | null;
}): TodaySummary {
  const crawls = listWebsiteCrawlRuns();
  const lastCrawl = crawls[0] ?? null;
  const priorCrawl = crawls[1] ?? null;

  const deltaVsPrior =
    lastCrawl && priorCrawl
      ? {
          pagesChanged: lastCrawl.pages_changed - priorCrawl.pages_changed,
          pagesWithErrors:
            lastCrawl.pages_with_errors - priorCrawl.pages_with_errors,
          guardrailAlerts:
            lastCrawl.guardrail_alerts - priorCrawl.guardrail_alerts,
        }
      : null;

  const nextMove: TodayNextMove =
    opts.nextMoveCandidates.find((m) => m != null) ?? {
      title: "No urgent queue item",
      href: "/pages",
      evidence:
        "Nothing in the fix/verify/review queues matched opening criteria — continue in Pages or Opportunities.",
      observationRunId: lastCrawl?.run_id ?? null,
      evidenceScope: "crawl",
    };

  const vis = opts.primaryVisibilityRun;
  const rollup = citationRollupVisibilityRun();
  const { stale, note } = visibilitySampleStaleVsCrawl(
    rollup,
    lastCrawl?.completed_at ?? null
  );

  return {
    crawl: {
      activeObservationRun: lastCrawl,
      activeObservationHref: lastCrawl
        ? `/observations/${encodeURIComponent(lastCrawl.run_id)}`
        : null,
      hasObservationFile: crawls.length > 0,
      priorCompletedAt: priorCrawl?.completed_at ?? null,
      deltaVsPrior,
    },
    visibility: {
      activeObservationRun: vis,
      activeObservationHref: vis
        ? `/observations/${encodeURIComponent(vis.run_id)}`
        : null,
      hasObservationFile: vis != null,
      staleVsCrawl: stale,
      staleNote: note,
    },
    reviewHeuristicLine:
      "Attribution is based on imported visibility data and change timing. It is correlation-based, not proven cause and effect.",
    competitorLine: opts.competitorLine ?? null,
    verifiedFixes: opts.verifiedFixes.slice(0, 5),
    nextMove,
  };
}
