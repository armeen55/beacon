import type { ObservationRun } from "@/domains/observations/types";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";

/**
 * `buildTodaySummary` (the function that used to populate these types) was
 * deleted 2026-07-02 (UX5 legacy sweep) — it had zero callers anywhere and
 * its only reachable output, a "No urgent queue item" fallback, linked to
 * the (also now-deleted) `/pages` stub. The types below lost their last
 * consumer 2026-07-21 (Lane S deleted `today-shared-types.ts`, whose
 * `TodayClientProps.summary` was declared against them) — this module is
 * a candidate for a follow-up reap.
 */

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
