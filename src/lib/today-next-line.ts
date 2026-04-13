import type { CoverageState } from "@/lib/coverage-state";
import type { CoverageTone } from "@/lib/today-proof-context";
import type { FindingPriority } from "@/domains/scanning/types";
import type { RecResponseStatus } from "@/lib/today-ritual";

/** Signals for crawl / visibility / coverage sample only (no scan phase). */
export type TodayDataTruthSignals = {
  crawlStale: boolean;
  visibilityStaleVsCrawl: boolean;
  coverageState: CoverageState;
  coverageTone: CoverageTone;
};

export type TodayNextLineInput = {
  isDemoMode: boolean;
  /** Last persisted scan phase is `failed` (`.data/scan-state.json`) — operator-facing truth blocker. */
  scanPhaseFailed: boolean;
  /**
   * True when visibility results or observation timestamps already exist (Settings → Import path applies).
   * Used only for copy/routing — no new scoring.
   */
  hasImportedVisibility: boolean;
  localUrgentStrip: { href: string } | null;
  localAttentionStrip: { href: string } | null;
  primaryAction: { headline: string; href: string; responseStatus?: RecResponseStatus } | null;
  pendingFindings: { priority: FindingPriority }[];
  allClear: boolean;
  crawlStale: boolean;
  visibilityStaleVsCrawl: boolean;
  coverageState: CoverageState;
  coverageTone: CoverageTone;
};

export type TodayNextLineResult = {
  /** Full sentence including the "Next: " prefix */
  text: string;
  /** When set, the whole line is rendered as this single navigation target */
  href: string | null;
};

function primaryIsHandled(primary: TodayNextLineInput["primaryAction"]): boolean {
  if (!primary) return true;
  const s = primary.responseStatus;
  return s === "accepted" || s === "dismissed";
}

/** Same notion of coverage / crawl staleness as `shouldShowTodayAllClear` — no new thresholds. */
export function isTodayDataTruthBlocked(s: TodayDataTruthSignals): boolean {
  if (s.crawlStale) return true;
  if (s.visibilityStaleVsCrawl) return true;
  if (s.coverageTone === "partial") return true;
  return (
    s.coverageState === "critical" ||
    s.coverageState === "stale" ||
    s.coverageState === "partial"
  );
}

/** Scan failure or material data-truth limits — takes priority over local tasks and recommendations. */
export function isTodayTruthBlocked(
  p: TodayDataTruthSignals & { scanPhaseFailed: boolean },
): boolean {
  if (p.scanPhaseFailed) return true;
  return isTodayDataTruthBlocked(p);
}

/** Visibility / coverage staleness (not scan failure, not crawl-age alone). Drives hard “import first” Today mode. */
export function isVisibilityCoverageStaleTruth(
  p: Pick<
    TodayNextLineInput,
    "isDemoMode" | "scanPhaseFailed" | "visibilityStaleVsCrawl" | "coverageState" | "coverageTone"
  >,
): boolean {
  if (p.isDemoMode || p.scanPhaseFailed) return false;
  return (
    p.visibilityStaleVsCrawl ||
    p.coverageState === "stale" ||
    p.coverageState === "critical" ||
    p.coverageState === "partial" ||
    p.coverageTone === "partial" ||
    p.coverageTone === "degraded"
  );
}

function truthFirstNextLine(p: TodayNextLineInput): TodayNextLineResult {
  const hrefPages = "/pages" as const;
  const hrefImport = "/settings/import" as const;
  if (p.scanPhaseFailed) {
    return {
      text: "Next: Fix the failed scan before acting on recommendations.",
      href: hrefPages,
    };
  }

  const visCovStale = isVisibilityCoverageStaleTruth(p);
  if (visCovStale && p.hasImportedVisibility) {
    return {
      text: "Next: Upload your latest visibility export before acting.",
      href: hrefImport,
    };
  }

  if (p.coverageState === "critical") {
    return {
      text: "Next: Fix data freshness before trusting recommendations.",
      href: p.hasImportedVisibility ? hrefImport : hrefPages,
    };
  }
  if (p.coverageState === "stale") {
    return {
      text: "Next: Resolve stale coverage before acting.",
      href: hrefPages,
    };
  }
  return {
    text: "Next: Refresh Beacon data before acting.",
    href: hrefPages,
  };
}

/**
 * Single "Next:" directive for Today — strict precedence, routing only on existing inputs.
 *
 * Order: demo → truth blockers (scan failed / stale–critical coverage / same data gates as all-clear) → local urgent → local attention → primary → critical findings → all clear / fallbacks.
 */
export function deriveTodayNextLine(p: TodayNextLineInput): TodayNextLineResult {
  if (p.isDemoMode) {
    return {
      text: "Next: Import your data to begin tracking.",
      href: "/settings/import",
    };
  }

  if (isTodayTruthBlocked(p)) {
    return truthFirstNextLine(p);
  }

  if (p.localUrgentStrip) {
    return {
      text: "Next: Review local issue → /local",
      href: p.localUrgentStrip.href,
    };
  }

  if (p.localAttentionStrip) {
    return {
      text: "Next: Check local presence → /local",
      href: p.localAttentionStrip.href,
    };
  }

  if (p.primaryAction && !primaryIsHandled(p.primaryAction)) {
    return {
      text: `Next: ${p.primaryAction.headline}`,
      href: p.primaryAction.href,
    };
  }

  const hasCritical = p.pendingFindings.some((f) => f.priority === "critical");
  if (hasCritical) {
    return {
      text: "Next: Review top critical finding",
      href: "/#today-findings",
    };
  }

  if (p.allClear) {
    return {
      text: "Next: Nothing required in Beacon today.",
      href: null,
    };
  }

  if (p.pendingFindings.length > 0) {
    return {
      text: "Next: Review findings in the queue below.",
      href: "/#today-findings",
    };
  }

  return {
    text: "Next: Review Today below.",
    href: null,
  };
}
